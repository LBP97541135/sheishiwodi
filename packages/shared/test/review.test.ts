import { describe, expect, it } from 'vitest';

import { reviewGenerationSchema, reviewSummarySchema } from '../src/index.js';

const duplicateReviews = [
  { playerId: 'agent-1', verdict: '判'.repeat(60), keyMoments: ['第一轮'], rating: 4 },
  { playerId: 'agent-1', verdict: '投'.repeat(60), keyMoments: ['第二轮'], rating: 3 },
];

const validGeneration = {
  perAgent: [
    { playerId: 'agent-1', verdict: '判'.repeat(60), keyMoments: ['第1轮'], rating: 4 },
  ],
  overall: '总'.repeat(100),
};

describe('复盘玩家标识', () => {
  it('生成结果拒绝重复的 perAgent.playerId', () => {
    expect(
      reviewGenerationSchema.safeParse({ perAgent: duplicateReviews, overall: '总'.repeat(100) })
        .success,
    ).toBe(false);
  });

  it('新生成结果严格执行提示词的长度、数量和必填评分', () => {
    expect(reviewGenerationSchema.safeParse(validGeneration).success).toBe(true);
    expect(
      reviewGenerationSchema.safeParse({
        ...validGeneration,
        perAgent: [{ ...validGeneration.perAgent[0]!, verdict: '短'.repeat(59) }],
      }).success,
    ).toBe(false);
    expect(
      reviewGenerationSchema.safeParse({
        ...validGeneration,
        perAgent: [{ ...validGeneration.perAgent[0]!, keyMoments: [] }],
      }).success,
    ).toBe(false);
    expect(
      reviewGenerationSchema.safeParse({
        ...validGeneration,
        perAgent: [{ ...validGeneration.perAgent[0]!, keyMoments: ['长'.repeat(51)] }],
      }).success,
    ).toBe(false);
    const validAgent = validGeneration.perAgent[0]!;
    const withoutRating = {
      playerId: validAgent.playerId,
      verdict: validAgent.verdict,
      keyMoments: validAgent.keyMoments,
    };
    expect(
      reviewGenerationSchema.safeParse({
        ...validGeneration,
        perAgent: [withoutRating],
      }).success,
    ).toBe(false);
    expect(reviewGenerationSchema.safeParse({ ...validGeneration, overall: '短'.repeat(99) }).success)
      .toBe(false);
    expect(reviewGenerationSchema.safeParse({ ...validGeneration, overall: '长'.repeat(161) }).success)
      .toBe(false);
  });

  it('持久化摘要拒绝重复的 perAgent.playerId', () => {
    expect(
      reviewSummarySchema.safeParse({
        gameId: 'game-1',
        status: 'done',
        modelId: 'review-model',
        generatedAt: '2026-08-19T09:00:00.000Z',
        perAgent: duplicateReviews,
        overall: '整体评价',
      }).success,
    ).toBe(false);
  });
});
