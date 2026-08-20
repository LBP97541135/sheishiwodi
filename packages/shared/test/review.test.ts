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

  it('新生成结果严格执行结构规则，但不因轻微文案长度偏差整份失败', () => {
    expect(reviewGenerationSchema.safeParse(validGeneration).success).toBe(true);
    expect(
      reviewGenerationSchema.safeParse({
        ...validGeneration,
        perAgent: [{ ...validGeneration.perAgent[0]!, verdict: '短'.repeat(59) }],
      }).success,
    ).toBe(true);
    expect(
      reviewGenerationSchema.safeParse({
        ...validGeneration,
        perAgent: [{ ...validGeneration.perAgent[0]!, keyMoments: [] }],
      }).success,
    ).toBe(false);
    expect(
      reviewGenerationSchema.safeParse({
        ...validGeneration,
        perAgent: [{ ...validGeneration.perAgent[0]!, keyMoments: ['长'.repeat(101)] }],
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
      .toBe(true);
    expect(reviewGenerationSchema.safeParse({ ...validGeneration, overall: '长'.repeat(401) }).success)
      .toBe(false);
  });

  it('猜词专项最多三个关键节点、最多一个错失机会，并区分局部失败状态', () => {
    const attempt = {
      actionId: 'action-1',
      actorId: 'agent-1',
      roundNumber: 1,
      phase: 'describe' as const,
      kind: 'attempt' as const,
      verdict: 'reasonable' as const,
      assessment: '当时证据充分',
      outcomeImpact: '目标出局',
    };
    expect(
      reviewGenerationSchema.safeParse({
        ...validGeneration,
        guessAnalysisStatus: 'done',
        guessAnalysis: { summary: '策略合理', keyDecisions: [attempt] },
      }).success,
    ).toBe(true);
    expect(
      reviewGenerationSchema.safeParse({
        ...validGeneration,
        guessAnalysisStatus: 'done',
      }).success,
    ).toBe(false);
    expect(
      reviewGenerationSchema.safeParse({
        ...validGeneration,
        guessAnalysisStatus: 'failed',
        guessAnalysis: { summary: '不应保留', keyDecisions: [attempt] },
      }).success,
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

  it('持久化摘要拒绝与猜词专项状态矛盾的内容', () => {
    expect(
      reviewSummarySchema.safeParse({
        gameId: 'game-1',
        status: 'done',
        modelId: 'review-model',
        generatedAt: '2026-08-19T09:00:00.000Z',
        perAgent: validGeneration.perAgent,
        overall: '整体评价',
        guessAnalysisStatus: 'failed',
        guessAnalysis: {
          summary: '不应保留',
          keyDecisions: [],
        },
      }).success,
    ).toBe(false);
  });
});
