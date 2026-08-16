import { describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';
import { createTestEnvironment } from '../test-environment.js';
import { resolveStreamCursor } from './game-routes.js';

const DESCRIPTION = '用于游标补发测试的线索';

describe('SSE 游标恢复', () => {
  it('查询参数优先于 Last-Event-ID，非法或负数游标回退为零', () => {
    expect(resolveStreamCursor(undefined, '7')).toBe(7);
    expect(resolveStreamCursor('3', '7')).toBe(3);
    expect(resolveStreamCursor(undefined, ['5', '9'])).toBe(5);
    expect(resolveStreamCursor('invalid', '7')).toBe(0);
    expect(resolveStreamCursor('-1', undefined)).toBe(0);
  });

  it('events?after 只补发更大游标且顺序严格递增', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const server = buildServer(environment.dependencies);
    const created = await createStartedGame(server);
    const allResponse = await server.inject({
      method: 'GET',
      url: `/api/games/${created.gameId}/events?after=0`,
    });
    const all = (allResponse.json() as { data: { frames: StreamFrame[]; eventCursor: number } }).data;
    const pivot = all.frames[Math.floor(all.frames.length / 2)]!.streamSeq;
    const afterResponse = await server.inject({
      method: 'GET',
      url: `/api/games/${created.gameId}/events?after=${pivot}`,
    });
    const after = (afterResponse.json() as { data: { frames: StreamFrame[] } }).data.frames;

    expect(after.every((frame) => frame.streamSeq > pivot)).toBe(true);
    expect(after.map((frame) => frame.streamSeq)).toEqual(
      [...after.map((frame) => frame.streamSeq)].sort((a, b) => a - b),
    );
    expect(new Set(after.map((frame) => frame.streamSeq)).size).toBe(after.length);
    const serializedAfter = JSON.stringify(after);
    expect(serializedAfter).not.toContain('reasoningSummary');
    expect(serializedAfter).not.toContain('wordCard');
    expect(serializedAfter).not.toContain('"camp"');
    expect(serializedAfter).not.toContain('targetPlayerId');
    expect(serializedAfter).not.toContain('probability');
    expect(serializedAfter).not.toContain('opposingWord');

    await server.close();
    environment.cleanup();
  });

  it('Last-Event-ID 补发与 events?after 使用相同边界', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const server = buildServer(environment.dependencies);
    const created = await createStartedGame(server);
    const framesResponse = await server.inject({
      method: 'GET',
      url: `/api/games/${created.gameId}/events?after=0`,
    });
    const all = (framesResponse.json() as { data: { frames: StreamFrame[] } }).data.frames;
    const pivot = all[Math.max(0, all.length - 2)]!.streamSeq;
    const expected = all.filter((frame) => frame.streamSeq > pivot);

    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.addresses()[0]!;
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/games/${created.gameId}/stream`, {
      headers: { 'Last-Event-ID': String(pivot) },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const ids = await readEventIds(response, expected.length, controller);
    expect(ids).toEqual(expected.map((frame) => frame.streamSeq));
    expect(new Set(ids).size).toBe(ids.length);

    await server.close();
    environment.cleanup();
  });
});

interface StreamFrame {
  streamSeq: number;
  type: string;
  payload: Record<string, unknown>;
}

async function readEventIds(response: Response, count: number, controller: AbortController) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const ids: number[] = [];
  let buffer = '';
  try {
    while (ids.length < count) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const match = chunk.match(/^id: (\d+)$/m);
        if (match) ids.push(Number(match[1]));
      }
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
  return ids;
}

async function createStartedGame(server: ReturnType<typeof buildServer>) {
  const created = await server.inject({
    method: 'POST',
    url: '/api/games',
    payload: {
      commandId: 'create-stream-test',
      human: { displayName: '游标测试', silhouette: 'silhouette_a' },
      difficulty: 'easy',
    },
  });
  const view = (created.json() as {
    data: { gameId: string; revision: number; human: { playerId: string } };
  }).data;
  const started = await server.inject({
    method: 'POST',
    url: `/api/games/${view.gameId}/start`,
    payload: {
      commandId: 'start-stream-test',
      actorId: view.human.playerId,
      expectedRevision: view.revision,
    },
  });
  const active = (started.json() as {
    data: {
      gameId: string;
      revision: number;
      human: { playerId: string };
      round: { currentActorId: string; actionType: string };
    };
  }).data;
  if (active.round.currentActorId === active.human.playerId && active.round.actionType === 'describe') {
    await server.inject({
      method: 'POST',
      url: `/api/games/${active.gameId}/descriptions`,
      payload: {
        commandId: 'describe-stream-test',
        actorId: active.human.playerId,
        expectedRevision: active.revision,
        text: DESCRIPTION,
      },
    });
  }
  return active;
}
