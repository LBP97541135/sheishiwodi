import type { FastifyInstance, FastifyReply } from 'fastify';

import { apiErrorResponseSchema, apiSuccessSchema, reviewSummarySchema } from '@sheishiwodi/shared';

import { ReviewMarkdownLeakError } from './review-markdown.js';
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

  // 单局复盘 Markdown 导出（DEC-047）：脱敏文本，作为附件下载。
  server.get<{ Params: { gameId: string } }>(
    '/api/games/:gameId/export.md',
    async (request, reply) => {
      try {
        const markdown = reviewService.exportMarkdown(request.params.gameId);
        const fileName = `review-${request.params.gameId}.md`;
        return reply
          .header('content-type', 'text/markdown; charset=utf-8')
          .header('content-disposition', `attachment; filename="${fileName}"`)
          .send(markdown);
      } catch (error) {
        if (error instanceof ReviewMarkdownLeakError) {
          // 自检拦截：绝不下发疑似含敏感串的内容，只回脱敏错误。
          return reply.status(500).send(
            apiErrorResponseSchema.parse({
              error: { code: 'INTERNAL_ERROR', message: '导出被安全自检拦截', details: {} },
            }),
          );
        }
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
