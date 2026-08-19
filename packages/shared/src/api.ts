import { z } from 'zod';

export const apiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'ACTOR_NOT_ALLOWED',
  'GAME_NOT_FOUND',
  'ACTIVE_GAME_EXISTS',
  'REVISION_CONFLICT',
  'INVALID_TRANSITION',
  'IDEMPOTENCY_CONFLICT',
  'CONTENT_REJECTED',
  'MODEL_CONFIGURATION_REQUIRED',
  'MODEL_ACTION_FAILED',
  'INTERNAL_ERROR',
]);

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().trim().min(1),
    details: z.record(z.unknown()).default({}),
  }),
});

export const apiMetaSchema = z.object({
  gameId: z.string().trim().min(1),
  revision: z.number().int().nonnegative(),
  eventCursor: z.number().int().nonnegative(),
});

export function apiSuccessSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema,
    meta: apiMetaSchema.optional(),
  });
}

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
