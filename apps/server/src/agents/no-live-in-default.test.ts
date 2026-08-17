import { describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';
import { createTestEnvironment } from '../test-environment.js';

// 免费默认守卫：证明默认 pnpm test 路径零出网、绝不构造真实策略。
// stub globalThis.fetch 抛错后，默认 FakeAgentPolicy 的完整对局仍应跑到终局，且 fetch 调用数为 0。

interface GameView {
  gameId: string;
  status: string;
  revision: number;
  round: { currentActorId: string | null; actionType: string | null } | null;
  legalVoteTargetIds: string[];
  human: { playerId: string };
}

const dataOf = (response: { json: () => unknown }): GameView =>
  (response.json() as { data: GameView }).data;

const createGame = async (server: FastifyInstance): Promise<GameView> => {
  const created = await server.inject({
    method: 'POST',
    url: '/api/games',
    payload: {
      commandId: 'guard-create-1',
      human: { displayName: '小祎', silhouette: 'silhouette_a' },
      difficulty: 'easy',
    },
  });
  const view = dataOf(created);
  await server.inject({
    method: 'POST',
    url: `/api/games/${view.gameId}/start`,
    payload: { commandId: 'guard-start-1', actorId: view.human.playerId, expectedRevision: view.revision },
  });
  return view;
};

const getView = async (server: FastifyInstance, gameId: string): Promise<GameView> =>
  dataOf(await server.inject({ method: 'GET', url: `/api/games/${gameId}` }));

const driveHumanToEnd = async (
  server: FastifyInstance,
  gameId: string,
  humanId: string,
): Promise<GameView> => {
  for (let step = 0; step < 80; step += 1) {
    const view = await getView(server, gameId);
    if (view.status === 'awaiting_spectator') {
      await server.inject({
        method: 'POST',
        url: `/api/games/${gameId}/spectate`,
        payload: { commandId: `guard-spectate-${step}`, actorId: humanId, expectedRevision: view.revision },
      });
      continue;
    }
    if (view.status !== 'in_progress') return view;
    if (view.round?.currentActorId !== humanId) return view;
    if (view.round.actionType === 'describe') {
      await server.inject({
        method: 'POST',
        url: `/api/games/${gameId}/descriptions`,
        payload: {
          commandId: `guard-describe-${step}`,
          actorId: humanId,
          expectedRevision: view.revision,
          text: '这是一个很普通的东西',
        },
      });
    } else if (view.round.actionType === 'vote') {
      await server.inject({
        method: 'POST',
        url: `/api/games/${gameId}/votes`,
        payload: {
          commandId: `guard-vote-${step}`,
          actorId: humanId,
          expectedRevision: view.revision,
          targetPlayerId: view.legalVoteTargetIds[0],
        },
      });
    }
  }
  throw new Error('默认对局未在限定步数内结束');
};

describe('默认路径零出网守卫', () => {
  it('stub fetch 抛错后，默认假模型整局仍跑到终局且从不触网', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async (...args: unknown[]): Promise<Response> => {
      fetchCalls += 1;
      void args;
      throw new Error('NETWORK_FORBIDDEN_IN_DEFAULT_TESTS');
    }) as typeof fetch;

    const environment = createTestEnvironment();
    const server = buildServer(environment.dependencies);
    try {
      const created = await createGame(server);
      const finalView = await driveHumanToEnd(server, created.gameId, created.human.playerId);

      expect(finalView.status).toBe('finished');
      expect(fetchCalls).toBe(0);
    } finally {
      await server.close();
      environment.cleanup();
      globalThis.fetch = originalFetch;
    }
  });
});
