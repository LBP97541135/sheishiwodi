import { describe, expect, it } from 'vitest';

import {
  createPreparingGame,
  projectHumanGameView,
  startPreparingGame,
  type Clock,
  type IdSource,
  type RandomSource,
  type WordPair,
} from '../src/index.js';

class SequenceRandom implements RandomSource {
  private cursor = 0;

  constructor(private readonly values: readonly number[]) {}

  next() {
    const value = this.values[this.cursor];
    if (value === undefined) {
      throw new Error('测试随机序列不足');
    }
    this.cursor += 1;
    return value;
  }
}

class SequenceIds implements IdSource {
  private cursor = 0;

  nextId(kind: 'game' | 'player' | 'event') {
    this.cursor += 1;
    return `${kind}-${this.cursor}`;
  }
}

const clock: Clock = {
  now: () => '2026-08-16T12:00:00.000Z',
};

const pairs: WordPair[] = [
  {
    id: 'easy-1',
    civilianWord: '牛奶',
    undercoverWord: '豆浆',
    category: '饮品',
    difficulty: 'easy',
    enabled: true,
  },
];

const createCommand = {
  type: 'CreateGame' as const,
  commandId: 'command-create',
  human: { displayName: '玩家', silhouette: 'silhouette_a' as const },
  difficulty: 'easy' as const,
};

describe('创建准备对局', () => {
  it.each([
    [0.0, 0],
    [0.26, 1],
    [0.51, 2],
    [0.76, 3],
  ])('固定随机值 %s 让座位 %s 成为卧底', (undercoverRandom, expectedSeat) => {
    const result = createPreparingGame(createCommand, pairs, {
      random: new SequenceRandom([0, undercoverRandom, 0, 0, 0]),
      ids: new SequenceIds(),
      clock,
    });

    expect(result.snapshot.players).toHaveLength(4);
    expect(result.snapshot.players.filter((player) => player.camp === 'undercover')).toHaveLength(1);
    expect(result.snapshot.players[expectedSeat]?.camp).toBe('undercover');
    expect(result.snapshot.firstSpeakingOrder).toHaveLength(4);
    expect(result.events.map((event) => event.type)).toEqual(['game_created']);
  });

  it('公开投影只包含人类自己的词牌', () => {
    const { snapshot } = createPreparingGame(createCommand, pairs, {
      random: new SequenceRandom([0, 0.76, 0, 0, 0]),
      ids: new SequenceIds(),
      clock,
    });

    const view = projectHumanGameView(snapshot);
    const serialized = JSON.stringify(view);

    expect(view.human.ownWordCard).toBe('牛奶');
    expect(serialized).not.toContain('豆浆');
    expect(serialized).not.toContain('"camp"');
    expect(serialized).not.toContain('civilianWord');
    expect(serialized).not.toContain('undercoverWord');
    expect(view).not.toHaveProperty('reveal');
  });
});

describe('开始准备对局', () => {
  it('进入第一轮并生成三个公开事件', () => {
    const ids = new SequenceIds();
    const created = createPreparingGame(createCommand, pairs, {
      random: new SequenceRandom([0, 0, 0, 0, 0]),
      ids,
      clock,
    });

    const started = startPreparingGame(
      created.snapshot,
      {
        type: 'StartGame',
        commandId: 'command-start',
        gameId: created.snapshot.gameId,
        actorId: created.snapshot.humanPlayerId,
        expectedRevision: 0,
      },
      { ids, clock },
    );

    expect(started.snapshot.status).toBe('in_progress');
    expect(started.snapshot.phase).toBe('speaking');
    expect(started.snapshot.revision).toBe(1);
    expect(started.snapshot.round?.number).toBe(1);
    expect(started.events.map((event) => event.type)).toEqual([
      'game_started',
      'round_started',
      'turn_started',
    ]);
  });

  it('拒绝非人类行动者和过期修订号', () => {
    const ids = new SequenceIds();
    const created = createPreparingGame(createCommand, pairs, {
      random: new SequenceRandom([0, 0, 0, 0, 0]),
      ids,
      clock,
    });
    const agent = created.snapshot.players.find((player) => player.kind === 'agent')!;

    expect(() =>
      startPreparingGame(
        created.snapshot,
        {
          type: 'StartGame',
          commandId: 'wrong-actor',
          gameId: created.snapshot.gameId,
          actorId: agent.playerId,
          expectedRevision: 0,
        },
        { ids, clock },
      ),
    ).toThrow('ACTOR_NOT_ALLOWED');

    expect(() =>
      startPreparingGame(
        created.snapshot,
        {
          type: 'StartGame',
          commandId: 'wrong-revision',
          gameId: created.snapshot.gameId,
          actorId: created.snapshot.humanPlayerId,
          expectedRevision: 2,
        },
        { ids, clock },
      ),
    ).toThrow('REVISION_CONFLICT');
  });
});
