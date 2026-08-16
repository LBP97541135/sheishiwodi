import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt, randomUUID } from 'node:crypto';

import Fastify from 'fastify';

import type { Clock, IdSource, RandomSource } from '@sheishiwodi/shared';

import { createDatabase, type AppDatabase } from './db/client.js';
import { migrateDatabase } from './db/migrate.js';
import { WordPairRepository } from './db/word-pair-repository.js';
import { FakeAgentPolicy, type FakeAgentScenario } from './agents/fake-agent-policy.js';
import type { AgentPolicy } from './agents/agent-policy.js';
import { registerGameRoutes } from './games/game-routes.js';
import { GameRepository } from './games/game-repository.js';
import { GameService } from './games/game-service.js';

export interface ServerDependencies {
  database: AppDatabase;
  random: RandomSource;
  ids: IdSource;
  clock: Clock;
  agentPolicyFactory?: () => AgentPolicy;
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
  server.addHook('onReady', async () => {
    gameService.resumeActiveGame();
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

  return {
    database,
    random: {
      next: () => randomValues?.[randomCursor++] ?? randomInt(0, 2 ** 24) / 2 ** 24,
    },
    ids: {
      nextId: () => randomUUID(),
    },
    clock: {
      now: () => new Date().toISOString(),
    },
    agentPolicyFactory: () => new FakeAgentPolicy(fakeScenario),
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
