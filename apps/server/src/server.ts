import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt, randomUUID } from 'node:crypto';

import Fastify from 'fastify';

import {
  type Clock,
  type IdSource,
  type RandomSource,
} from '@sheishiwodi/shared';

import { createDatabase, type AppDatabase } from './db/client.js';
import { migrateDatabase } from './db/migrate.js';
import { WordPairRepository } from './db/word-pair-repository.js';
import { AgentRoleModelRepository } from './db/agent-role-model-repository.js';
import { ModelAttemptRepository } from './db/model-attempt-repository.js';
import type { FakeAgentScenario } from './agents/fake-agent-policy.js';
import {
  ModelProfileService,
  type ModelProviderContext,
} from './agents/model-profile-service.js';
import { resolveAgentProvider } from './agents/provider-runtime.js';
import type { AgentPolicy } from './agents/agent-policy.js';
import type { ReviewPolicy } from './agents/review-policy.js';
import { FakeReviewPolicy } from './agents/fake-review-policy.js';
import {
  ContextAuditWriter,
  PersistentAgentObservability,
  type AgentObservability,
} from './agents/agent-observability.js';
import type { ProviderCircuitBreakerPort } from './agents/provider-circuit-breaker.js';
import { registerDeveloperRoutes } from './developer/developer-routes.js';
import { DeveloperService } from './developer/developer-service.js';
import { registerGameRoutes } from './games/game-routes.js';
import { registerModelRoutes } from './games/model-routes.js';
import { registerReviewRoutes } from './games/review-routes.js';
import { GameRepository } from './games/game-repository.js';
import { GameService } from './games/game-service.js';
import { GameRecoveryRepository } from './games/game-recovery-repository.js';
import { ReviewService } from './games/review-service.js';

export interface ServerDependencies {
  database: AppDatabase;
  random: RandomSource;
  ids: IdSource;
  clock: Clock;
  agentPolicyFactory?: () => AgentPolicy;
  /** 复盘策略工厂：运行时依 env 注入真实/假策略；缺省时 ReviewService 自带 FakeReviewPolicy。 */
  reviewPolicyFactory?: () => ReviewPolicy;
  modelProvider?: ModelProviderContext;
  roleModelRepository?: AgentRoleModelRepository;
  areRequiredModelsConfigured?: () => boolean;
  /**
   * 是否后台推进 AI 回合：运行时置 true，命令提交后立即返回、AI 回合异步推进，
   * 前端靠 SSE 实时接收，避免开始/操作请求被真实模型串行往返长时间阻塞。
   * 测试默认 false（同步 await），保证断言可确定地读到已推进状态。
   */
  backgroundAdvance?: boolean;
  agentObservability?: AgentObservability;
  developerMode?: boolean;
  contextAudit?: ContextAuditWriter;
  providerCircuitBreaker?: ProviderCircuitBreakerPort;
}

export function buildServer(dependencies?: ServerDependencies) {
  const runtime = dependencies ?? createRuntimeDependencies();
  const server = Fastify({ logger: dependencies ? false : true });

  server.get('/api/health', async () =>
    runtime.database.health.healthy
      ? { status: 'ok' as const, service: 'sheishiwodi-server' as const }
      : {
          status: 'degraded' as const,
          service: 'sheishiwodi-server' as const,
          code: runtime.database.health.code,
        },
  );
  if (!runtime.database.health.healthy) return server;

  server.setErrorHandler((error, _request, reply) => {
    if (error.code === 'SQLITE_BUSY' || error.message.includes('database is locked')) {
      return reply.status(503).send({
        error: {
          code: 'LOCAL_DATA_BUSY',
          message: '本地数据暂时繁忙，请稍后重试',
          details: {},
        },
      });
    }
    return reply.send(error);
  });

  const gameRepository = new GameRepository(runtime.database);
  const gameRecoveryRepository = new GameRecoveryRepository(runtime.database);
  const reviewService = new ReviewService(
    gameRepository,
    runtime.clock,
    runtime.reviewPolicyFactory ?? (() => new FakeReviewPolicy()),
  );
  const gameService = new GameService(
    gameRepository,
    new WordPairRepository(runtime.database),
    {
      ...runtime,
      // 正常终局后异步生成复盘（幂等、单飞、失败仅脱敏落库，绝不阻塞主流程）。
      onGameFinished: (gameId: string) => reviewService.enqueue(gameId),
      onGameActivityChanged: () => reviewService.kick(),
    },
    gameRecoveryRepository,
  );
  registerGameRoutes(server, gameService, {
    developerMode: runtime.developerMode === true,
  });
  registerReviewRoutes(server, reviewService);

  const roleModelRepository =
    runtime.roleModelRepository ?? new AgentRoleModelRepository(runtime.database);
  const modelProvider: ModelProviderContext =
    runtime.modelProvider ?? {
      mode: 'fake',
      configured: false,
      client: null,
      useBuiltInRoleDefaults: true,
      reviewModelConfigured: true,
    };
  const modelProfileService = new ModelProfileService(
    roleModelRepository,
    modelProvider,
    gameService,
    runtime.clock,
  );
  registerModelRoutes(server, modelProfileService);

  if (runtime.developerMode && runtime.contextAudit && runtime.providerCircuitBreaker) {
    registerDeveloperRoutes(
      server,
      new DeveloperService(
        new ModelAttemptRepository(runtime.database),
        runtime.contextAudit,
        gameRecoveryRepository,
        runtime.providerCircuitBreaker,
        reviewService,
      ),
    );
  }

  server.addHook('onReady', async () => {
    const interrupted = new ModelAttemptRepository(runtime.database).interruptUnfinished(
      runtime.clock.now(),
    );
    for (const attempt of interrupted) {
      const snapshot = gameRepository.findSnapshot(attempt.gameId);
      if (snapshot?.status === 'in_progress') {
        gameRecoveryRepository.markAwaiting({
          ...attempt,
          interruptedAt: runtime.clock.now(),
        });
      }
    }
    await gameService.resumeActiveGame();
    // 重启恢复：把遗留在 pending/generating 的复盘重新入队后台生成。
    reviewService.recover();
  });

  server.addHook('onClose', async () => {
    const interrupted = runtime.agentObservability?.interruptActiveAttempts?.() ?? [];
    for (const attempt of interrupted) {
      const snapshot = gameRepository.findSnapshot(attempt.gameId);
      if (snapshot?.status === 'in_progress') {
        gameRecoveryRepository.markAwaiting({
          ...attempt,
          interruptedAt: runtime.clock.now(),
        });
      }
    }
    await reviewService.shutdown();
  });

  return server;
}

export function createRuntimeDependencies(): ServerDependencies {
  const databasePath = resolve(process.env['DATABASE_PATH'] ?? '.local/sheishiwodi.db');
  mkdirSync(dirname(databasePath), { recursive: true });
  const databaseExisted = existsSync(databasePath) && statSync(databasePath).size > 0;
  const database = createDatabase(databasePath, {
    busyTimeoutMs: readPositiveInt(process.env['SQLITE_BUSY_TIMEOUT_MS'], 3_000),
  });
  const clock: Clock = { now: () => new Date().toISOString() };
  if (!database.health.healthy) {
    return {
      database,
      random: { next: () => 0 },
      ids: { nextId: () => randomUUID() },
      clock,
      backgroundAdvance: false,
    };
  }
  migrateDatabase(database.sqlite, { databasePath, createBackup: databaseExisted });
  const sourceUrl = new URL('../../../data/word-pairs.json', import.meta.url);
  const source = JSON.parse(readFileSync(fileURLToPath(sourceUrl), 'utf8')) as unknown;
  new WordPairRepository(database).sync(source);

  const scenario = process.env['FAKE_AGENT_SCENARIO'];
  const fakeScenario: FakeAgentScenario = scenario === 'tie-then-eliminate' ? scenario : 'normal';

  const randomValues = parseFakeRandomSequence(process.env['FAKE_RANDOM_SEQUENCE']);
  let randomCursor = 0;

  const roleModelRepository = new AgentRoleModelRepository(database);
  const contextAudit = new ContextAuditWriter(
    resolve(process.env['AGENT_AUDIT_DIR'] ?? '.local/agent-audit'),
    {
      secretValues: [
        process.env['TOKENDANCE_BASE_URL'] ?? '',
        process.env['TOKENDANCE_API_KEY'] ?? '',
        process.env['OPENAI_COMPATIBLE_BASE_URL'] ?? '',
        process.env['OPENAI_COMPATIBLE_API_KEY'] ?? '',
      ],
      fullRecordMaxBytes: readPositiveInt(
        process.env['AGENT_FULL_AUDIT_MAX_BYTES'],
        20 * 1024 * 1024,
      ),
    },
  );
  const observability = new PersistentAgentObservability(
    new ModelAttemptRepository(database),
    contextAudit,
  );
  const {
    agentPolicyFactory,
    reviewPolicyFactory,
    modelProvider,
    areRequiredModelsConfigured,
    circuitBreaker,
  } = resolveAgentProvider(
    roleModelRepository,
    fakeScenario,
    process.env,
    observability,
  );

  return {
    database,
    random: {
      next: () => randomValues?.[randomCursor++] ?? randomInt(0, 2 ** 24) / 2 ** 24,
    },
    ids: {
      nextId: () => randomUUID(),
    },
    clock,
    agentPolicyFactory,
    reviewPolicyFactory,
    modelProvider,
    roleModelRepository,
    areRequiredModelsConfigured,
    // 运行时后台推进：开始与人类操作立即返回，AI 回合异步推进并经 SSE 实时下发。
    backgroundAdvance: true,
    agentObservability: observability,
    developerMode: process.env['AGENT_DEVELOPER_MODE'] === 'true',
    contextAudit,
    providerCircuitBreaker: circuitBreaker,
  };
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFakeRandomSequence(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const values = value.split(',').map(Number);
  if (values.length === 0 || values.some((entry) => !Number.isFinite(entry) || entry < 0 || entry >= 1)) {
    throw new Error('FAKE_RANDOM_SEQUENCE 必须是 [0, 1) 数值组成的逗号分隔列表');
  }
  return values;
}
