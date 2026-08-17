import type { FastifyInstance, FastifyReply } from 'fastify';

import { apiErrorResponseSchema, apiSuccessSchema, reviewSummarySchema } from '@sheishiwodi/shared';

import { ReviewServiceError, type ReviewService } from './review-service.js';

const errorStatus = {
  GAME_NOT_FOUND: 404,
  NOT_FINISHED: 409,
} as const;

const errorCode = {
  GAME_NOT_FOUND: 'GAME_NOT_FOUND',
  NOT_FINISHED: 'INVALID_TRANSITION',
} as const;

const errorMessage = {
  GAME_NOT_FOUND: '未找到该对局',
  NOT_FINISHED: '该对局尚未正常结束，暂无复盘',
} as const;

export function registerReviewRoutes(server: FastifyInstance, reviewService: ReviewService) {
  server.get<{ Params: { gameId: string } }>(
    '/api/games/:gameId/review',
    async (request, reply) => {
      try {
        const summary = reviewService.getReview(request.params.gameId);
        return reply.send(apiSuccessSchema(reviewSummarySchema).parse({ data: summary }));
      } catch (error) {
        return sendReviewError(reply, error);
      }
    },
  );

  server.post<{ Params: { gameId: string } }>(
    '/api/games/:gameId/review/regenerate',
    async (request, reply) => {
      try {
        const summary = reviewService.regenerate(request.params.gameId);
        return reply.send(apiSuccessSchema(reviewSummarySchema).parse({ data: summary }));
      } catch (error) {
        return sendReviewError(reply, error);
      }
    },
  );
}

function sendReviewError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof ReviewServiceError)) {
    throw error;
  }
  return reply.status(errorStatus[error.code]).send(
    apiErrorResponseSchema.parse({
      error: { code: errorCode[error.code], message: errorMessage[error.code], details: {} },
    }),
  );
}
