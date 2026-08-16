import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  agentRoleIdSchema,
  apiErrorResponseSchema,
  apiSuccessSchema,
  availableModelListSchema,
  modelProfileListSchema,
  modelProfileSchema,
  updateModelSelectionSchema,
} from '@sheishiwodi/shared';

import { ModelProfileError, type ModelProfileService } from '../agents/model-profile-service.js';

const errorStatus = {
  ACTIVE_GAME_LOCKED: 409,
  ROLE_NOT_FOUND: 404,
  PROVIDER_UNAVAILABLE: 503,
} as const;

const errorMessage = {
  ACTIVE_GAME_LOCKED: '对局进行中，暂不能修改模型配置',
  ROLE_NOT_FOUND: '未找到该 AI 角色',
  PROVIDER_UNAVAILABLE: '真实模型服务不可用',
} as const;

export function registerModelRoutes(server: FastifyInstance, service: ModelProfileService) {
  server.get('/api/model-profiles', async (_request, reply) => {
    return reply.send(apiSuccessSchema(modelProfileListSchema).parse({ data: service.listProfiles() }));
  });

  server.get('/api/models', async (_request, reply) => {
    try {
      const models = await service.listModels();
      return reply.send(apiSuccessSchema(availableModelListSchema).parse({ data: models }));
    } catch {
      // 目录拉取失败时不泄露任何上游细节，仅返回脱敏错误。
      return sendModelError(reply, new ModelProfileError('PROVIDER_UNAVAILABLE'));
    }
  });

  server.put<{ Params: { roleId: string } }>('/api/model-profiles/:roleId', async (request, reply) => {
    const roleParsed = agentRoleIdSchema.safeParse(request.params.roleId);
    if (!roleParsed.success) {
      return sendModelError(reply, new ModelProfileError('ROLE_NOT_FOUND'));
    }
    const bodyParsed = updateModelSelectionSchema.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.status(400).send(
        apiErrorResponseSchema.parse({
          error: {
            code: 'VALIDATION_ERROR',
            message: '模型选择不合法',
            details: { fields: bodyParsed.error.issues.map((issue) => issue.path.join('.')) },
          },
        }),
      );
    }

    try {
      const profile = service.updateSelection(roleParsed.data, bodyParsed.data.modelId);
      return reply.send(apiSuccessSchema(modelProfileSchema).parse({ data: profile }));
    } catch (error) {
      return sendModelError(reply, error);
    }
  });
}

function sendModelError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof ModelProfileError)) {
    throw error;
  }
  return reply.status(errorStatus[error.code]).send(
    apiErrorResponseSchema.parse({
      error: { code: error.code, message: errorMessage[error.code], details: {} },
    }),
  );
}
