import { z } from 'zod';

export const developerAttemptStageSchema = z.object({
  stage: z.enum([
    'request_started',
    'provider_returned',
    'schema_validated',
    'content_validated',
    'action_committed',
  ]),
  occurredAt: z.string().min(1),
});

export const developerAttemptSchema = z.object({
  attemptId: z.string().min(1),
  gameId: z.string().min(1),
  commandId: z.string().min(1),
  actionId: z.string().min(1),
  playerId: z.string().min(1).optional(),
  roleId: z.string().min(1),
  modelId: z.string().min(1),
  actionType: z.string().min(1),
  attemptNumber: z.number().int().positive(),
  attemptKind: z.enum(['initial', 'format_repair', 'content_regeneration', 'system_retry']),
  resultCode: z.string().min(1),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  stages: z.array(developerAttemptStageSchema).optional(),
});

export const developerContextSourceSchema = z.object({
  kind: z.string().min(1),
  visibility: z.enum(['public', 'actor_private', 'terminal_private']),
  itemCount: z.number().int().nonnegative(),
  ownerPlayerId: z.string().min(1).optional(),
});

export const developerContextSummarySchema = z.object({
  attemptId: z.string().min(1),
  gameId: z.string().min(1),
  actionId: z.string().min(1),
  roleId: z.string().min(1),
  actionType: z.string().min(1),
  publicEventCursor: z.number().int().nonnegative(),
  templateVersion: z.string().min(1),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  sources: z.array(developerContextSourceSchema),
  validationStatus: z.enum(['passed', 'failed']),
  validationChecks: z.array(z.string().min(1)),
  createdAt: z.string().min(1),
});

export const developerRecoverySchema = z.object({
  gameId: z.string().min(1),
  actionId: z.string().min(1),
  interruptedAt: z.string().min(1),
});

export const developerOverviewSchema = z.object({
  fullRecordingEnabled: z.boolean(),
  calls: z.array(developerAttemptSchema),
  contexts: z.array(developerContextSummarySchema),
  errorsAndRecovery: z.object({
    failedAttempts: z.array(developerAttemptSchema),
    interruptedGames: z.array(developerRecoverySchema),
    providerCircuit: z.object({
      state: z.enum(['closed', 'open', 'half_open']),
      openUntil: z.number().int().nonnegative().optional(),
    }),
  }),
  review: z.object({
    runningGameId: z.string().min(1).nullable(),
    queuedGameIds: z.array(z.string().min(1)),
    blockedByActiveGame: z.boolean(),
    stopped: z.boolean(),
  }),
});

export const fullRecordingRequestSchema = z.object({ enabled: z.boolean() }).strict();
export const fullRecordingStateSchema = z.object({ enabled: z.boolean() });

export const developerFullRecordSummarySchema = z.object({
  attemptId: z.string().min(1),
  gameId: z.string().min(1),
  actionType: z.string().min(1),
  createdAt: z.string().min(1),
  resultCode: z.string().min(1).optional(),
  hasPrompt: z.boolean(),
  hasResponse: z.boolean(),
});

export const developerFullRecordDetailSchema = developerFullRecordSummarySchema.extend({
  prompt: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })),
  rawResponse: z.string().optional(),
});

export const developerFullRecordListSchema = z.object({
  records: z.array(developerFullRecordSummarySchema),
});
export const developerFullRecordClearResultSchema = z.object({ cleared: z.literal(true) });

export type DeveloperOverview = z.infer<typeof developerOverviewSchema>;
export type DeveloperFullRecordSummary = z.infer<typeof developerFullRecordSummarySchema>;
export type DeveloperFullRecordDetail = z.infer<typeof developerFullRecordDetailSchema>;
