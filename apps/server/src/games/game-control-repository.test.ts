import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';
import { createTestEnvironment } from '../test-environment.js';
import { GameControlRepository } from './game-control-repository.js';

const environments: Array<ReturnType<typeof createTestEnvironment>> = [];

afterEach(() => {
  while (environments.length) environments.pop()!.cleanup();
});

describe('GameControlRepository', () => {
  it('持久化暂停、单步和原子请求预算，耗尽后自动暂停', async () => {
    const environment = createTestEnvironment();
    environments.push(environment);
    const server = buildServer(environment.dependencies);
    const response = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        commandId: 'create-control-test',
        human: { displayName: '玩家', silhouette: 'silhouette_a' },
        difficulty: 'easy',
      },
    });
    const gameId = (response.json() as { data: { gameId: string } }).data.gameId;
    const controls = new GameControlRepository(environment.dependencies.database);
    const now = '2026-08-19T12:00:00.000Z';

    expect(controls.get(gameId)).toMatchObject({ mode: 'auto', requestBudget: null, usedRequests: 0 });
    expect(controls.setMode(gameId, 'step', now)).toBe(true);
    expect(controls.get(gameId)?.mode).toBe('step');
    expect(controls.addBudget(gameId, 2, now)).toBe(true);
    expect(controls.get(gameId)).toMatchObject({ mode: 'paused', requestBudget: 2, remainingRequests: 2 });
    expect(controls.reserveAttempt(gameId, now)).toBe(true);
    expect(controls.reserveAttempt(gameId, now)).toBe(true);
    expect(controls.reserveAttempt(gameId, now)).toBe(false);
    expect(controls.get(gameId)).toMatchObject({
      mode: 'paused',
      usedRequests: 2,
      remainingRequests: 0,
      pauseReason: 'budget_exhausted',
    });

    await server.close();
  });
});
