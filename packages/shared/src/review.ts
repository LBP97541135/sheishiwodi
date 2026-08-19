import { z } from 'zod';

const identifierSchema = z.string().trim().min(1).max(128);

/** 复盘生成状态：等待入队 → 生成中 → 完成 / 失败。 */
export const reviewStatusSchema = z.enum(['pending', 'generating', 'done', 'failed']);

/**
 * 复盘失败码（脱敏）：绝不含 Base URL / API Key / 上游响应正文，只给可判读的分类。
 * 与 server 端 AgentSystemErrorCode 精神一致，但收敛为复盘场景需要的子集。
 */
export const reviewErrorCodeSchema = z.enum([
  'MODEL_NOT_CONFIGURED',
  'CALL_FAILED',
  'CALL_TIMEOUT',
  'NETWORK_FAILED',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'AUTH_FAILED',
  'MODEL_NOT_FOUND',
  'REQUEST_REJECTED',
  'BAD_RESPONSE',
  'FORMAT_INVALID',
  'NOT_REVIEWABLE',
  'INTERNAL_ERROR',
]);

/** 针对单个 AI 玩家的评价：简评 + 关键节点 + 可选评分（1~5）。 */
export const reviewPerAgentSchema = z
  .object({
    playerId: identifierSchema,
    verdict: z.string().trim().min(1).max(600),
    keyMoments: z.array(z.string().trim().min(1).max(300)).max(12),
    rating: z.number().int().min(1).max(5).optional(),
  })
  .strict();

const uniquePerAgentReviewsSchema = z.array(reviewPerAgentSchema).superRefine((reviews, context) => {
  const playerIds = reviews.map((review) => review.playerId);
  if (new Set(playerIds).size !== playerIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'perAgent.playerId 必须唯一',
    });
  }
});

const generatedPerAgentSchema = reviewPerAgentSchema.extend({
  verdict: z.string().trim().min(60).max(100),
  keyMoments: z.array(z.string().trim().min(1).max(50)).min(1).max(2),
  rating: z.number().int().min(1).max(5),
});

const uniqueGeneratedPerAgentReviewsSchema = z
  .array(generatedPerAgentSchema)
  .superRefine((reviews, context) => {
    const playerIds = reviews.map((review) => review.playerId);
    if (new Set(playerIds).size !== playerIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'perAgent.playerId 必须唯一',
      });
    }
  });

/**
 * 复盘模型必须产出的原始评价内容（每个 AI 一段简评 + 全局点评）。
 * 独立于持久化壳，便于对模型输出做严格 Zod 校验 + 一次格式修复。
 */
export const reviewGenerationSchema = z
  .object({
    perAgent: uniqueGeneratedPerAgentReviewsSchema,
    overall: z.string().trim().min(100).max(160),
  })
  .strict();

/**
 * 复盘摘要（持久化 / API 投影壳）：无论生成中/失败都返回，前端据 status 决定渲染。
 * 只包含 model ID 与脱敏字段，绝不含连接凭据或模型原始响应。
 */
export const reviewSummarySchema = z
  .object({
    gameId: identifierSchema,
    status: reviewStatusSchema,
    modelId: z.string().trim().min(1).max(128),
    generatedAt: z.string().datetime().optional(),
    errorCode: reviewErrorCodeSchema.optional(),
    perAgent: uniquePerAgentReviewsSchema,
    overall: z.string().max(2000),
  })
  .strict();

export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
export type ReviewErrorCode = z.infer<typeof reviewErrorCodeSchema>;
export type ReviewPerAgent = z.infer<typeof reviewPerAgentSchema>;
export type ReviewGeneration = z.infer<typeof reviewGenerationSchema>;
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;
