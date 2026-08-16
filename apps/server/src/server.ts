import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt, randomUUID } from 'node:crypto';

import Fastify from 'fastify';

import { agentRoleIds, type Clock, type IdSource, type RandomSource } from '@sheishiwodi/shared';

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

  const client = new TokendanceClient({ baseUrl, apiKey });
  const buildRoleModelMap = (): Record<string, string> => {
    const selections = roleModelRepository.listSelections();
    const map: Record<string, string> = {};
    for (const roleId of agentRoleIds) {
      const modelId = selections[roleId] ?? (defaultModel.length > 0 ? defaultModel : undefined);
      if (modelId) map[roleId] = modelId;
    }
    return map;
  };

  return {
    agentPolicyFactory: () =>
      new TokendanceAgentPolicy({ client, roleModelMap: buildRoleModelMap() }),
    modelProvider: { mode: 'tokendance', configured: true, client },
  };
}

function parseFakeRandomSequence(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const values = value.split(',').map(Number);
  if (values.length === 0 || values.some((entry) => !Number.isFinite(entry) || entry < 0 || entry >= 1)) {
    throw new Error('FAKE_RANDOM_SEQUENCE 必须是 [0, 1) 数值组成的逗号分隔列表');
  }
  return values;
}
