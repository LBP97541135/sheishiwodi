import { describe, expect, it } from 'vitest';

import { reviewGenerationSchema, reviewSummarySchema } from '../src/index.js';

const duplicateReviews = [
  { playerId: 'agent-1', verdict: '判断谨慎', keyMoments: ['第一轮'], rating: 4 },
  { playerId: 'agent-1', verdict: '投票果断', keyMoments: ['第二轮'], rating: 3 },
];

describe('复盘玩家标识', () => {
  it('生成结果拒绝重复的 perAgent.playerId', () => {
    expect(
      reviewGenerationSchema.safeParse({ perAgent: duplicateReviews, overall: '整体评价' }).success,
    ).toBe(false);
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
