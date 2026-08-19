import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HumanGameView } from '@sheishiwodi/shared';

import {
  executeTrackedGameCommand,
  readPendingGameCommand,
} from './game-command-recovery';

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('pending game command recovery', () => {
  it('响应丢失但权威 revision 已前进时不重复提交', async () => {
    const authority = activeGame(2);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(response(successBody(authority)));
    vi.stubGlobal('fetch', fetchMock);
    const command = startCommand();

    await expect(executeTrackedGameCommand(command)).resolves.toEqual(authority);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/games/game-1/start');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/games/game-1');
    expect(readPendingGameCommand()).toBeNull();
  });

  it('权威 revision 未前进时以完全相同的 commandId 和负载重试', async () => {
    const before = preparingGame();
    const after = activeGame(1);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(response(successBody(before)))
      .mockResolvedValueOnce(response(successBody(after)));
    vi.stubGlobal('fetch', fetchMock);
    const command = startCommand();

    await expect(executeTrackedGameCommand(command)).resolves.toEqual(after);

    const postCalls = fetchMock.mock.calls.filter((call) => call[0] === '/api/games/game-1/start');
    expect(postCalls).toHaveLength(2);
    expect(postCalls[0]?.[1]).toEqual(postCalls[1]?.[1]);
    expect(JSON.parse(String((postCalls[1]?.[1] as RequestInit).body))).toMatchObject({
      commandId: 'stable-command',
      expectedRevision: 0,
    });
    expect(readPendingGameCommand()).toBeNull();
  });

  it('无法解析的旧记录会被清除而不是重放', () => {
    sessionStorage.setItem('sheishiwodi:pending-game-command', '{"version":0}');
    expect(readPendingGameCommand()).toBeNull();
    expect(sessionStorage.getItem('sheishiwodi:pending-game-command')).toBeNull();
  });

  it('命令响应和权威查询都不可用时保留原命令供下次恢复', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('command network failure'))
      .mockRejectedValueOnce(new TypeError('authority network failure'));
    vi.stubGlobal('fetch', fetchMock);
    const command = startCommand();

    await expect(executeTrackedGameCommand(command)).rejects.toThrow('authority network failure');

    expect(readPendingGameCommand()).toEqual(command);
  });

  it('待恢复的旧对局不存在时清除命令并回退到当前活动局', async () => {
    const authority = activeGame(4);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(
        response({ error: { code: 'GAME_NOT_FOUND', message: '对局不存在', details: {} } }, 404),
      )
      .mockResolvedValueOnce(response({ data: { game: authority } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeTrackedGameCommand(startCommand())).resolves.toEqual(authority);

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/games/game-1/start',
      '/api/games/game-1',
      '/api/games/active',
    ]);
    expect(readPendingGameCommand()).toBeNull();
  });

  it('修订冲突只刷新权威状态，不生成新的 commandId', async () => {
    const authority = activeGame(3);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ error: { code: 'REVISION_CONFLICT', message: '状态已更新', details: {} } }, 409),
      )
      .mockResolvedValueOnce(response(successBody(authority)));
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeTrackedGameCommand(startCommand())).resolves.toEqual(authority);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/games/game-1/start',
      '/api/games/game-1',
    ]);
    expect(readPendingGameCommand()).toBeNull();
  });
});

function startCommand() {
  return {
    version: 1,
    kind: 'start',
    gameId: 'game-1',
    expectedRevision: 0,
    request: {
      commandId: 'stable-command',
      actorId: 'human-1',
      expectedRevision: 0,
    },
  } as const;
}

function preparingGame(): HumanGameView {
  return {
    gameId: 'game-1',
    status: 'preparing',
    phase: 'preparing',
    revision: 0,
    eventCursor: 1,
    config: { difficulty: 'easy', undercoverCount: 1 },
    human: {
      playerId: 'human-1',
      displayName: '玩家',
      silhouette: 'silhouette_a',
      ownWordCard: '牛奶',
    },
    players: [
      { playerId: 'human-1', seatIndex: 0, kind: 'human', displayName: '玩家', alive: true },
      { playerId: 'agent-1', seatIndex: 1, kind: 'agent', displayName: 'DeepSeek', alive: true },
    ],
    round: null,
    publicTimeline: [],
    voteProgress: { completedPlayerIds: [] },
    legalVoteTargetIds: [],
    allowedCommands: ['StartGame', 'AbandonGame'],
    operationalStatus: { state: 'waiting_human' },
  };
}

function activeGame(revision: number): HumanGameView {
  return {
    ...preparingGame(),
    status: 'in_progress',
    phase: 'speaking',
    revision,
    eventCursor: 2,
    round: {
      number: 1,
      speakingOrder: ['human-1', 'agent-1'],
      currentActorId: 'human-1',
      actionType: 'describe',
      tieCandidateIds: [],
    },
    allowedCommands: ['SubmitDescription', 'AbandonGame'],
    operationalStatus: { state: 'waiting_human', actorId: 'human-1' },
  };
}

function successBody(game: HumanGameView) {
  return { data: game, meta: { gameId: game.gameId, revision: game.revision, eventCursor: game.eventCursor } };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
