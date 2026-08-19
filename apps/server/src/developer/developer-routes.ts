import type { FastifyInstance } from 'fastify';

import {
  apiErrorResponseSchema,
  apiSuccessSchema,
  developerFullRecordClearResultSchema,
  developerFullRecordDetailSchema,
  developerFullRecordListSchema,
  developerOverviewSchema,
  fullRecordingRequestSchema,
  fullRecordingStateSchema,
} from '@sheishiwodi/shared';

import type { DeveloperService } from './developer-service.js';

export function registerDeveloperRoutes(server: FastifyInstance, service: DeveloperService) {
  server.get<{ Querystring: { gameId?: string } }>('/api/developer/overview', async (request) =>
    apiSuccessSchema(developerOverviewSchema).parse({
      data: service.overview(cleanGameId(request.query.gameId)),
    }),
  );

  server.put('/api/developer/full-recording', async (request, reply) => {
    const parsed = fullRecordingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(
        apiErrorResponseSchema.parse({
          error: {
            code: 'VALIDATION_ERROR',
            message: '完整上下文记录设置不合法',
            details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
          },
        }),
      );
    }
    return reply.send(
      apiSuccessSchema(fullRecordingStateSchema).parse({
        data: service.setFullRecording(parsed.data.enabled),
      }),
    );
  });

  server.get<{ Querystring: { gameId?: string } }>('/api/developer/full-records', async (request) =>
    apiSuccessSchema(developerFullRecordListSchema).parse({
      data: { records: service.listFullRecords(cleanGameId(request.query.gameId)) },
    }),
  );

  server.get<{ Params: { attemptId: string } }>(
    '/api/developer/full-records/:attemptId',
    async (request, reply) => {
      const record = service.getFullRecord(request.params.attemptId);
      if (!record) {
        return reply.status(404).send(
          apiErrorResponseSchema.parse({
            error: { code: 'GAME_NOT_FOUND', message: '未找到完整调试记录', details: {} },
          }),
        );
      }
      return reply.send(apiSuccessSchema(developerFullRecordDetailSchema).parse({ data: record }));
    },
  );

  server.delete('/api/developer/full-records', async (_request, reply) =>
    reply.send(
      apiSuccessSchema(developerFullRecordClearResultSchema).parse({
        data: service.clearFullRecords(),
      }),
    ),
  );
}

function cleanGameId(value: string | undefined) {
  const gameId = value?.trim();
  return gameId ? gameId : undefined;
}
