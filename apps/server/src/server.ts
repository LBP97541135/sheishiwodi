import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt, randomUUID } from 'node:crypto';

import Fastify from 'fastify';

import {
  agentRoleIds,
  findAgentRole,
  type Clock,
  type IdSource,
  type RandomSource,
} from '@sheishiwodi/shared';

import { createDatabase, type AppDatabase } from './db/client.js';
import { migrateDatabase } from './db/migrate.js';
import { WordPairRepository } from './db/word-pair-repository.js';
import { AgentRoleModelRepository } from './db/agent-role-model-repository.js';
import { FakeAgentPolicy, type FakeAgentScenario } from './agents/fake-agent-policy.js';
import { TokendanceClient } from './agents/tokendance-client.js';
import { TokendanceAgentPolicy } from './agents/tokendance-agent-policy.js';
import {
  ModelProfileService,
  type ModelProviderContext,
} from './agents/model-profile-service.js';
import type { AgentPolicy } from './agents/agent-policy.js';
import { registerGameRoutes } from './games/game-routes.js';
import { registerModelRoutes } from './games/model-routes.js';
import { GameRepository } from './games/game-repository.js';
import { GameService } from './games/game-service.js';

export interface ServerDependencies {
  database: AppDatabase;
  random: RandomSource;
  ids: IdSource;
  clock: Clock;
  agentPolicyFactory?: () => AgentPolicy;
  modelProvider?: ModelProviderContext;
  roleModelRepository?: AgentRoleModelRepository;
  /**
   * 是否后台推进 AI 回合：运行时置 true，命令提交后立即返回、AI 回合异步推进，
   * 前端靠 SSE 实时接收，避免开始/操作请求被真实模型串行往返长时间阻塞。
   * 测试默认 false（同步 await），保证断言可确定地读到已推进状态。
   */
  backgroundAdvance?: boolean;
}

export function buildServer(dependencies?: ServerDependencies) {
  const runtime = dependencies ?? createRuntimeDependencies();
  const server = Fastify({ logger: dependencies ? false : true });

  server.get('/api/health', async () => ({
    status: 'ok' as const,
    service: 'sheishiwodi-server' as const,
  }));

  const gameService = new GameService(
    new GameRepository(runtime.database),
    new WordPairRepository(runtime.database),
    runtime,
  );
  registerGameRoutes(server, gameService);

  const roleModelRepository =
    runtime.roleModelRepository ?? new AgentRoleModelRepository(runtime.database);
  const modelProvider: ModelProviderContext =
    runtime.modelProvider ?? { mode: 'fake', configured: false, client: null };
  const modelProfileService = new ModelProfileService(
    roleModelRepository,
    modelProvider,
    gameService,
    runtime.clock,
  );
  registerModelRoutes(server, modelProfileService);

  server.addHook('onReady', async () => {
    await gameService.resumeActiveGame();
  });

  return server;
}

export function createRuntimeDependencies(): ServerDependencies {
  const databasePath = resolve(process.env['DATABASE_PATH'] ?? '.local/sheishiwodi.db');
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = createDatabase(databasePath);
  migrateDatabase(database.sqlite);
  const sourceUrl = new URL('../../../data/word-pairs.json', import.meta.url);
  const source = JSON.parse(readFileSync(fileURLToPath(sourceUrl), 'utf8')) as unknown;
  new WordPairRepository(database).sync(source);

  const scenario = process.env['FAKE_AGENT_SCENARIO'];
  const fakeScenario: FakeAgentScenario = scenario === 'tie-then-eliminate' ? scenario : 'normal';

  const randomValues = parseFakeRandomSequence(process.env['FAKE_RANDOM_SEQUENCE']);
  let randomCursor = 0;

  const clock: Clock = { now: () => new Date().toISOString() };
  const roleModelRepository = new AgentRoleModelRepository(database);
  const { agentPolicyFactory, modelProvider } = resolveAgentProvider(
    roleModelRepository,
    fakeScenario,
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
    modelProvider,
    roleModelRepository,
    // 运行时后台推进：开始与人类操作立即返回，AI 回合异步推进并经 SSE 实时下发。
    backgroundAdvance: true,
  };
}

/**
 * 按 env 决定 Agent 提供方：仅当 AGENT_PROVIDER=tokendance 且 Base URL 与 API Key 均非空时
 * 才实例化真实策略；其余一律 FakeAgentPolicy。Key/URL 只在此处进入内存，绝不外泄。
 */
function resolveAgentProvider(
  roleModelRepository: AgentRoleModelRepository,
  fakeScenario: FakeAgentScenario,
): { agentPolicyFactory: () => AgentPolicy; modelProvider: ModelProviderContext } {
  const provider = (process.env['AGENT_PROVIDER'] ?? 'fake').trim();
  const baseUrl = (process.env['TOKENDANCE_BASE_URL'] ?? '').trim();
  const apiKey = (process.env['TOKENDANCE_API_KEY'] ?? '').trim();
  const defaultModel = (process.env['TOKENDANCE_DEFAULT_MODEL'] ?? '').trim();
  const useTokendance = provider === 'tokendance' && baseUrl.length > 0 && apiKey.length > 0;

  if (!useTokendance) {
    return {
      agentPolicyFactory: () => new FakeAgentPolicy(fakeScenario),
      modelProvider: {
        mode: provider === 'tokendance' ? 'tokendance' : 'fake',
        configured: false,
        client: null,
      },
    };
  }

  const client = new TokendanceClient({
    baseUrl,
    apiKey,
    timeoutMs: readPositiveInt('TOKENDANCE_TIMEOUT_MS', 60_000),
    defaultBody: readJsonObject('TOKENDANCE_EXTRA_BODY'),
  });
  const buildRoleModelMap = (): Record<string, string> => {
    const selections = roleModelRepository.listSelections();
    const map: Record<string, string> = {};
    for (const roleId of agentRoleIds) {
      const modelId =
        selections[roleId] ??
        findAgentRole(roleId)?.defaultModelId ??
        (defaultModel.length > 0 ? defaultModel : undefined);
      if (modelId) map[roleId] = modelId;
    }
    return map;
  };

  const debugTiming = (process.env['AGENT_DEBUG_TIMING'] ?? '').trim() === '1';

  return {
    agentPolicyFactory: () =>
      new TokendanceAgentPolicy({
        client,
        roleModelMap: buildRoleModelMap(),
        maxSystemRetries: readPositiveInt('TOKENDANCE_MAX_RETRIES', 2),
        retryDelayMs: readPositiveInt('TOKENDANCE_RETRY_DELAY_MS', 800),
        debug: debugTiming,
      }),
    modelProvider: { mode: 'tokendance', configured: true, client },
  };
}

/** 读取正整数 env，非法或缺省时回退到给定默认值。仅用于超时/重试等运行时调参。 */
function readPositiveInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? '').trim();
  if (raw.length === 0) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * 读取一个 JSON 对象 env（如关闭推理链的附加请求参数）。非法或缺省时返回空对象。
 * 仅解析为模型请求参数透传，绝不含 Key/URL —— 后者始终独立走专用 env。
 */
function readJsonObject(name: string): Record<string, unknown> {
  const raw = (process.env[name] ?? '').trim();
  if (raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseFakeRandomSequence(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const values = value.split(',').map(Number);
  if (values.length === 0 || values.some((entry) => !Number.isFinite(entry) || entry < 0 || entry >= 1)) {
    throw new Error('FAKE_RANDOM_SEQUENCE 必须是 [0, 1) 数值组成的逗号分隔列表');
  }
  return values;
}
