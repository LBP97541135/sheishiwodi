import { describe, expect, it } from 'vitest';

import {
  createPreparingGame,
  projectHumanGameView,
  startPreparingGame,
  type Clock,
  type IdSource,
  type RandomSource,
  type WordPair,
  type AgentRoleDefinition,
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

    expect(view.human?.ownWordCard).toBe('牛奶');
    expect(serialized).not.toContain('豆浆');
    expect(serialized).not.toContain('"camp"');
    expect(serialized).not.toContain('civilianWord');
    expect(serialized).not.toContain('undercoverWord');
    expect(view).not.toHaveProperty('reveal');
  });

  it('支持 4 名纯 Agent 对局且观察者视图不包含人类玩家或私有词语', () => {
    const roles = Object.fromEntries(
      ['agent-a', 'agent-b', 'agent-c', 'agent-d'].map((roleId) => [
        roleId,
        {
          roleId,
          displayName: roleId,
          personalityTags: ['谨慎', '简洁', '观察'] as const,
          defaultModelId: 'fake-model',
          personalityPrompt: '保持谨慎，只基于公开信息判断。',
        } satisfies AgentRoleDefinition,
      ]),
    );
    const { snapshot } = createPreparingGame(
      {
        ...createCommand,
        participationMode: 'observer',
        agentRoleIds: Object.keys(roles),
        requestBudget: 60,
      },
      pairs,
      {
        random: new SequenceRandom([0, 0, 0, 0, 0]),
        ids: new SequenceIds(),
        clock,
        resolveAgentRole: (roleId) => roles[roleId],
      },
    );

    expect(snapshot.players).toHaveLength(4);
    expect(snapshot.players.every((player) => player.kind === 'agent')).toBe(true);
    expect(snapshot.config).toMatchObject({ participationMode: 'observer', undercoverCount: 1, requestBudget: 60 });
    const view = projectHumanGameView(snapshot);
    expect(view.human).toBeNull();
    expect(JSON.stringify(view)).not.toContain('牛奶');
    expect(JSON.stringify(view)).not.toContain('豆浆');
  });

  it('6 至 8 人局固定生成两名互不知情的卧底', () => {
    const roleIds = Array.from({ length: 5 }, (_, index) => `agent-${index + 1}`);
    const { snapshot } = createPreparingGame(
      { ...createCommand, agentRoleIds: roleIds },
      pairs,
      {
        random: new SequenceRandom([0, 0, 0.35, 0, 0, 0, 0, 0]),
        ids: new SequenceIds(),
        clock,
        resolveAgentRole: (roleId) => ({
          roleId,
          displayName: roleId,
          personalityTags: ['谨慎', '简洁', '观察'] as const,
          defaultModelId: 'fake-model',
          personalityPrompt: '保持谨慎，只基于公开信息判断。',
        }),
      },
    );

    expect(snapshot.players).toHaveLength(6);
    expect(snapshot.config.undercoverCount).toBe(2);
    expect(snapshot.players.filter((player) => player.camp === 'undercover')).toHaveLength(2);
    for (const player of snapshot.players) {
      const ownPrivateProjection = {
        playerId: player.playerId,
        wordCard: player.wordCard,
      };
      expect(ownPrivateProjection).not.toHaveProperty('teammateIds');
    }
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
