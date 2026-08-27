import { describe, expect, it } from 'vitest';

import { gameEventSchema, humanGameViewSchema } from '../src/index.js';

const publicPlayer = {
  playerId: 'human',
  seatIndex: 0,
  kind: 'human',
  displayName: '玩家',
  alive: true,
};

describe('HumanGameView', () => {
  it('接受不包含真实阵营与其他词牌的准备视图', () => {
    const view = humanGameViewSchema.parse({
      gameId: 'game-1',
      status: 'preparing',
      phase: 'preparing',
      revision: 0,
      eventCursor: 1,
      controllerId: 'player-human',
      config: {
        difficulty: 'easy',
        undercoverCount: 1,
      },
      human: {
        playerId: 'human',
        displayName: '玩家',
        silhouette: 'silhouette_a',
        ownWordCard: '牛奶',
      },
      players: [publicPlayer],
      round: null,
      publicTimeline: [],
      voteProgress: {
        completedPlayerIds: [],
      },
      legalVoteTargetIds: [],
      allowedCommands: ['StartGame', 'AbandonGame'],
      operationalStatus: {
        state: 'waiting_human',
      },
    });

    expect(view.human?.ownWordCard).toBe('牛奶');
    expect('camp' in view.players[0]!).toBe(false);
    expect('wordCard' in view.players[0]!).toBe(false);
  });

  it('拒绝公开玩家对象中的未知私有字段', () => {
    const result = humanGameViewSchema.safeParse({
      gameId: 'game-1',
      status: 'preparing',
      phase: 'preparing',
      revision: 0,
      eventCursor: 1,
      config: { difficulty: 'easy', undercoverCount: 1 },
      human: {
        playerId: 'human',
        displayName: '玩家',
        silhouette: 'silhouette_a',
        ownWordCard: '牛奶',
      },
      players: [{ ...publicPlayer, camp: 'undercover', wordCard: '豆浆' }],
      round: null,
      publicTimeline: [],
      voteProgress: { completedPlayerIds: [] },
      legalVoteTargetIds: [],
      allowedCommands: [],
      operationalStatus: { state: 'idle' },
    });

    expect(result.success).toBe(false);
  });

  it('拒绝正常终局前的揭晓字段以及缺少揭晓的正常终局', () => {
    const base = {
      gameId: 'game-1',
      status: 'in_progress',
      phase: 'speaking',
      revision: 1,
      eventCursor: 2,
      config: { difficulty: 'easy', undercoverCount: 1 },
      human: {
        playerId: 'human',
        displayName: '玩家',
        silhouette: 'silhouette_a',
        ownWordCard: '牛奶',
      },
      players: [publicPlayer],
      round: null,
      publicTimeline: [],
      voteProgress: { completedPlayerIds: [] },
      legalVoteTargetIds: [],
      allowedCommands: [],
      operationalStatus: { state: 'idle' },
    };
    const reveal = {
      wordPair: { civilianWord: '牛奶', undercoverWord: '豆浆', category: '饮品' },
      players: [{ playerId: 'human', seatIndex: 0, camp: 'civilian', wordCard: '牛奶' }],
    };

    const factReview = { agentActions: [] };

    expect(humanGameViewSchema.safeParse({ ...base, reveal, factReview }).success).toBe(false);
    expect(
      humanGameViewSchema.safeParse({
        ...base,
        status: 'abandoned',
        phase: 'ended',
        endReason: 'abandoned_by_human',
        reveal,
      }).success,
    ).toBe(false);
    expect(
      humanGameViewSchema.safeParse({
        ...base,
        status: 'finished',
        phase: 'ended',
        winnerCamp: 'civilian',
        endReason: 'undercover_eliminated',
      }).success,
    ).toBe(false);
  });
});

describe('GameEvent', () => {
  it('要求对局内事件序号为正整数', () => {
    const event = {
      eventId: 'event-1',
      gameId: 'game-1',
      eventSeq: 1,
      type: 'game_started',
      visibility: 'public',
      occurredAt: '2026-08-16T12:00:00.000Z',
      commandId: 'command-1',
      payload: {},
    };

    expect(gameEventSchema.safeParse(event).success).toBe(true);
    expect(gameEventSchema.safeParse({ ...event, eventSeq: 0 }).success).toBe(false);
  });
});
