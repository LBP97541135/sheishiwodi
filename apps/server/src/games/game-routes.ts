import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  abandonGameRequestSchema,
  activeGameDataSchema,
  apiErrorResponseSchema,
  apiSuccessSchema,
  createGameRequestSchema,
  continueSpectatingRequestSchema,
  humanGameViewSchema,
  startGameRequestSchema,
  submitDefenseRequestSchema,
  submitDescriptionRequestSchema,
  submitVoteRequestSchema,
} from '@sheishiwodi/shared';

import { GameServiceError, type GameService } from './game-service.js';

const errorStatus = {
  ACTIVE_GAME_EXISTS: 409,
  ACTOR_NOT_ALLOWED: 403,
  CONTENT_REJECTED: 422,
  GAME_NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  INVALID_TRANSITION: 409,
  REVISION_CONFLICT: 409,
} as const;

const errorMessage = {
  ACTIVE_GAME_EXISTS: '已有未完成对局，请先继续该对局',
  ACTOR_NOT_ALLOWED: '当前玩家不能执行该操作',
  CONTENT_REJECTED: '描述不符合规则，请修改后重试',
  GAME_NOT_FOUND: '未找到该对局',
  IDEMPOTENCY_CONFLICT: '命令编号已被其他请求使用',
  INVALID_TRANSITION: '当前阶段不能执行该操作',
  REVISION_CONFLICT: '对局状态已更新，请刷新后重试',
} as const;

export function registerGameRoutes(server: FastifyInstance, gameService: GameService) {
  server.post('/api/games', async (request, reply) => {
    const parsed = createGameRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(
        apiErrorResponseSchema.parse({
          error: {
            code: 'VALIDATION_ERROR',
            message: '新对局配置不合法',
            details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
          },
        }),
      );
    }

    try {
      const view = gameService.createGame({ type: 'CreateGame', ...parsed.data });
      return reply.status(201).send(
        apiSuccessSchema(humanGameViewSchema).parse({
          data: view,
          meta: {
            gameId: view.gameId,
            revision: view.revision,
            eventCursor: view.eventCursor,
          },
        }),
      );
    } catch (error) {
      return sendGameError(reply, error);
    }
  });

  server.get('/api/games/active', async (_request, reply) => {
    const game = gameService.getActiveGame();
    return reply.send(
      apiSuccessSchema(activeGameDataSchema).parse({ data: { game } }),
    );
  });

  server.get<{ Params: { gameId: string } }>('/api/games/:gameId', async (request, reply) => {
    try {
      const view = gameService.getGame(request.params.gameId);
      return reply.send(
        apiSuccessSchema(humanGameViewSchema).parse({
          data: view,
          meta: {
            gameId: view.gameId,
            revision: view.revision,
            eventCursor: view.eventCursor,
          },
        }),
      );
    } catch (error) {
      return sendGameError(reply, error);
    }
  });

  server.post<{ Params: { gameId: string } }>(
    '/api/games/:gameId/start',
    async (request, reply) => {
      const parsed = startGameRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          apiErrorResponseSchema.parse({
            error: {
              code: 'VALIDATION_ERROR',
              message: '开始游戏命令不合法',
              details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
            },
          }),
        );
      }

      try {
        const view = gameService.startGame({
          type: 'StartGame',
          gameId: request.params.gameId,
          ...parsed.data,
        });
        return reply.send(
          apiSuccessSchema(humanGameViewSchema).parse({
            data: view,
            meta: {
              gameId: view.gameId,
              revision: view.revision,
              eventCursor: view.eventCursor,
            },
          }),
        );
      } catch (error) {
        return sendGameError(reply, error);
      }
    },
  );

  server.post<{ Params: { gameId: string } }>(
    '/api/games/:gameId/descriptions',
    async (request, reply) => {
      const parsed = submitDescriptionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          apiErrorResponseSchema.parse({
            error: {
              code: 'VALIDATION_ERROR',
              message: '描述命令不合法',
              details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
            },
          }),
        );
      }

      try {
        const view = gameService.submitDescription({
          type: 'SubmitDescription',
          gameId: request.params.gameId,
          ...parsed.data,
        });
        return reply.send(
          apiSuccessSchema(humanGameViewSchema).parse({
            data: view,
            meta: { gameId: view.gameId, revision: view.revision, eventCursor: view.eventCursor },
          }),
        );
      } catch (error) {
        return sendGameError(reply, error);
      }
    },
  );

  server.post<{ Params: { gameId: string } }>(
    '/api/games/:gameId/defenses',
    async (request, reply) => {
      const parsed = submitDefenseRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          apiErrorResponseSchema.parse({
            error: {
              code: 'VALIDATION_ERROR',
              message: '辩解命令不合法',
              details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
            },
          }),
        );
      }

      try {
        const view = gameService.submitDefense({
          type: 'SubmitDefense',
          gameId: request.params.gameId,
          ...parsed.data,
        });
        return reply.send(
          apiSuccessSchema(humanGameViewSchema).parse({
            data: view,
            meta: { gameId: view.gameId, revision: view.revision, eventCursor: view.eventCursor },
          }),
        );
      } catch (error) {
        return sendGameError(reply, error);
      }
    },
  );

  server.post<{ Params: { gameId: string } }>(
    '/api/games/:gameId/votes',
    async (request, reply) => {
      const parsed = submitVoteRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          apiErrorResponseSchema.parse({
            error: {
              code: 'VALIDATION_ERROR',
              message: '投票命令不合法',
              details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
            },
          }),
        );
      }

      try {
        const view = gameService.submitVote({
          type: 'SubmitVote',
          gameId: request.params.gameId,
          ...parsed.data,
        });
        return reply.send(
          apiSuccessSchema(humanGameViewSchema).parse({
            data: view,
            meta: { gameId: view.gameId, revision: view.revision, eventCursor: view.eventCursor },
          }),
        );
      } catch (error) {
        return sendGameError(reply, error);
      }
    },
  );

  server.post<{ Params: { gameId: string } }>(
    '/api/games/:gameId/spectate',
    async (request, reply) => {
      const parsed = continueSpectatingRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          apiErrorResponseSchema.parse({
            error: {
              code: 'VALIDATION_ERROR',
              message: '观战命令不合法',
              details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
            },
          }),
        );
      }

      try {
        const view = gameService.continueSpectating({
          type: 'ContinueSpectating',
          gameId: request.params.gameId,
          ...parsed.data,
        });
        return reply.send(
          apiSuccessSchema(humanGameViewSchema).parse({
            data: view,
            meta: { gameId: view.gameId, revision: view.revision, eventCursor: view.eventCursor },
          }),
        );
      } catch (error) {
        return sendGameError(reply, error);
      }
    },
  );

  server.post<{ Params: { gameId: string } }>(
    '/api/games/:gameId/abandon',
    async (request, reply) => {
      const parsed = abandonGameRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          apiErrorResponseSchema.parse({
            error: {
              code: 'VALIDATION_ERROR',
              message: '放弃命令不合法',
              details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
            },
          }),
        );
      }

      try {
        const view = gameService.abandonGame({
          type: 'AbandonGame',
          gameId: request.params.gameId,
          ...parsed.data,
        });
        return reply.send(
          apiSuccessSchema(humanGameViewSchema).parse({
            data: view,
            meta: { gameId: view.gameId, revision: view.revision, eventCursor: view.eventCursor },
          }),
        );
      } catch (error) {
        return sendGameError(reply, error);
      }
    },
  );

  server.get<{ Params: { gameId: string }; Querystring: { after?: string } }>(
    '/api/games/:gameId/events',
    async (request, reply) => {
      const after = Number.parseInt(request.query.after ?? '0', 10);
      try {
        const result = gameService.getEvents(request.params.gameId, Number.isFinite(after) ? after : 0);
        return reply.send({ data: result });
      } catch (error) {
        return sendGameError(reply, error);
      }
    },
  );

  server.get<{ Params: { gameId: string }; Querystring: { after?: string } }>(
    '/api/games/:gameId/stream',
    async (request, reply) => {
      let cursor = resolveStreamCursor(request.query.after, request.headers['last-event-id']);

      gameService.resumeGame(request.params.gameId);

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });

      const flush = () => {
        let result: ReturnType<GameService['getEvents']>;
        try {
          result = gameService.getEvents(request.params.gameId, cursor);
        } catch {
          return;
        }
        for (const frame of result.frames) {
          cursor = frame.streamSeq;
          reply.raw.write(`event: ${frame.type}\n`);
          reply.raw.write(`id: ${frame.streamSeq}\n`);
          reply.raw.write(`data: ${JSON.stringify(frame)}\n\n`);
        }
      };

      flush();
      const interval = setInterval(flush, 500);
      const heartbeat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15_000);
      const stop = () => {
        clearInterval(interval);
        clearInterval(heartbeat);
      };
      request.raw.on('close', stop);
      reply.raw.on('close', stop);
    },
  );
}

export function resolveStreamCursor(
  queryAfter: string | undefined,
  lastEventId: string | string[] | undefined,
) {
  const headerCursor = Array.isArray(lastEventId) ? lastEventId[0] : lastEventId;
  const rawCursor = queryAfter ?? headerCursor;
  const parsed = Number.parseInt(rawCursor ?? '0', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function sendGameError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof GameServiceError)) {
    throw error;
  }

  return reply.status(errorStatus[error.code]).send(
    apiErrorResponseSchema.parse({
      error: {
        code: error.code,
        message: errorMessage[error.code],
        details: {},
      },
    }),
  );
}
