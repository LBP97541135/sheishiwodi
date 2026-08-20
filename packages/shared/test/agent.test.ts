import { describe, expect, it } from 'vitest';

import { validateBeliefSnapshot } from '../src/index.js';

const belief = {
  opposingWordCandidates: [{ word: '豆浆', confidence: 0.4, evidence: '饮品线索' }],
  playerUndercoverProbabilities: [
    { playerId: 'p1', probability: 0.2 },
    { playerId: 'p2', probability: 0.3 },
    { playerId: 'p3', probability: 0.5 },
  ],
  reasoningSummary: '根据公开描述分配概率',
};

describe('Agent 信念', () => {
  it('覆盖全部存活玩家并按卧底人数求和', () => {
    expect(validateBeliefSnapshot(belief, ['p1', 'p2', 'p3'], 1)).toEqual(belief);
  });

  it('拒绝缺少玩家或概率总量错误', () => {
    expect(() => validateBeliefSnapshot(belief, ['p1', 'p2', 'p3', 'p4'], 1)).toThrow(
      'BELIEF_PLAYERS_INVALID',
    );
    expect(() => validateBeliefSnapshot(belief, ['p1', 'p2', 'p3'], 2)).toThrow(
      'BELIEF_TOTAL_INVALID',
    );
  });

  it('拒绝用重复 playerId 冒充完整玩家集合', () => {
    const duplicate = {
      ...belief,
      playerUndercoverProbabilities: [
        { playerId: 'p1', probability: 0.2 },
        { playerId: 'p2', probability: 0.3 },
        { playerId: 'p3', probability: 0.4 },
        { playerId: 'p3', probability: 0.1 },
      ],
    };

    expect(() => validateBeliefSnapshot(duplicate, ['p1', 'p2', 'p3'], 1)).toThrow();
  });
});
