import { describe, expect, it } from 'vitest';

import {
  createGameCommandSchema,
  gameCommandSchema,
  gamePhaseSchema,
  gameStatusSchema,
  submitVoteCommandSchema,
} from '../src/index.js';

describe('领域枚举', () => {
  it('接受规格定义的对局状态和阶段', () => {
    expect(gameStatusSchema.parse('awaiting_spectator')).toBe('awaiting_spectator');
    expect(gamePhaseSchema.parse('tie_defense')).toBe('tie_defense');
  });

  it('拒绝未定义的状态', () => {
    expect(gameStatusSchema.safeParse('paused').success).toBe(false);
  });
});

describe('对局命令', () => {
  it('为缺省人类名称使用玩家', () => {
    const command = createGameCommandSchema.parse({
      type: 'CreateGame',
      commandId: 'command-1',
      human: {
        silhouette: 'silhouette_a',
      },
      difficulty: 'easy',
    });

    expect(command.human.displayName).toBe('玩家');
  });

  it('限制人类名称长度', () => {
    const result = createGameCommandSchema.safeParse({
      type: 'CreateGame',
      commandId: 'command-1',
      human: {
        displayName: '超过十二个字符的人类玩家名称',
        silhouette: 'silhouette_a',
      },
      difficulty: 'hard',
    });

    expect(result.success).toBe(false);
  });

  it('要求投票命令携带修订号与目标', () => {
    expect(
      submitVoteCommandSchema.safeParse({
        type: 'SubmitVote',
        commandId: 'command-2',
        gameId: 'game-1',
        actorId: 'player-1',
        expectedRevision: 4,
        targetPlayerId: 'player-2',
      }).success,
    ).toBe(true);

    expect(
      gameCommandSchema.safeParse({
        type: 'SubmitVote',
        commandId: 'command-2',
        gameId: 'game-1',
        actorId: 'player-1',
        targetPlayerId: 'player-2',
      }).success,
    ).toBe(false);
  });
});
