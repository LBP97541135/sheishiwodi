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
  verdict: z.string().trim().min(1).max(200),
  keyMoments: z.array(z.string().trim().min(1).max(100)).min(1).max(2),
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
export const reviewGenerationCoreSchema = z
  .object({
    perAgent: uniqueGeneratedPerAgentReviewsSchema,
    overall: z.string().trim().min(1).max(400),
  })
  .strict();

export const reviewGuessVerdictSchema = z.enum([
  'reasonable',
  'rash',
  'insufficient_basis',
  'missed_opportunity',
]);

/** 模型只选择服务端给出的 actionId；玩家、轮次和阶段由服务端按证据帧回填。 */
export const reviewModelGuessDecisionSchema = z
  .object({
    actionId: identifierSchema,
    verdict: reviewGuessVerdictSchema,
    assessment: z.string().trim().min(1).max(400),
    outcomeImpact: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

export const reviewModelGuessAnalysisSchema = z
  .object({
    summary: z.string().trim().min(1).max(400),
    keyDecisions: z.array(reviewModelGuessDecisionSchema).max(3),
  })
  .strict();

export const reviewGuessDecisionSchema = z
  .object({
    actionId: identifierSchema,
    actorId: identifierSchema,
    roundNumber: z.number().int().positive(),
    phase: z.enum(['describe', 'vote']),
    kind: z.enum(['attempt', 'missed']),
    verdict: reviewGuessVerdictSchema,
    assessment: z.string().trim().min(1).max(400),
    outcomeImpact: z.string().trim().min(1).max(300).optional(),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.kind === 'attempt' && !decision.outcomeImpact) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcomeImpact'],
        message: '实际猜词必须说明事后影响',
      });
    }
    if (decision.kind === 'missed' && decision.outcomeImpact) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcomeImpact'],
        message: '错失机会不得虚构实际影响',
      });
    }
  });

export const reviewGuessAnalysisSchema = z
  .object({
    summary: z.string().trim().min(1).max(400),
    keyDecisions: z.array(reviewGuessDecisionSchema).max(3),
  })
  .strict()
  .superRefine((analysis, context) => {
    const actionIds = analysis.keyDecisions.map((decision) => decision.actionId);
    if (new Set(actionIds).size !== actionIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['keyDecisions'],
        message: '关键猜词决策不能重复',
      });
    }
    if (analysis.keyDecisions.filter((decision) => decision.kind === 'missed').length > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['keyDecisions'],
        message: '错失机会最多保留一条',
      });
    }
  });

export const reviewGuessAnalysisStatusSchema = z.enum(['done', 'failed']);

export const reviewGenerationSchema = reviewGenerationCoreSchema
  .extend({
    guessAnalysis: reviewGuessAnalysisSchema.optional(),
    guessAnalysisStatus: reviewGuessAnalysisStatusSchema.optional(),
  })
  .strict()
  .superRefine((review, context) => {
    if (review.guessAnalysisStatus === 'done' && !review.guessAnalysis) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['guessAnalysis'],
        message: '猜词分析完成时必须包含分析内容',
      });
    }
    if (review.guessAnalysisStatus === 'failed' && review.guessAnalysis) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['guessAnalysis'],
        message: '猜词分析失败时不得保留无效内容',
      });
    }
  });

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
    guessAnalysis: reviewGuessAnalysisSchema.optional(),
    guessAnalysisStatus: reviewGuessAnalysisStatusSchema.optional(),
  })
  .strict()
  .superRefine((review, context) => {
    if (review.guessAnalysisStatus === 'done' && !review.guessAnalysis) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['guessAnalysis'],
        message: '猜词分析完成时必须包含分析内容',
      });
    }
    if (review.guessAnalysisStatus === 'failed' && review.guessAnalysis) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['guessAnalysis'],
        message: '猜词分析失败时不得保留无效内容',
      });
    }
  });

export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
export type ReviewErrorCode = z.infer<typeof reviewErrorCodeSchema>;
export type ReviewPerAgent = z.infer<typeof reviewPerAgentSchema>;
export type ReviewModelGuessAnalysis = z.infer<typeof reviewModelGuessAnalysisSchema>;
export type ReviewGuessDecision = z.infer<typeof reviewGuessDecisionSchema>;
export type ReviewGuessAnalysis = z.infer<typeof reviewGuessAnalysisSchema>;
export type ReviewGeneration = z.infer<typeof reviewGenerationSchema>;
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;
