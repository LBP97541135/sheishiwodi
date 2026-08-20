import { createReadStream } from 'node:fs';

import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  apiErrorResponseSchema,
  apiSuccessSchema,
  characterAssetStateSchema,
  characterProfileListSchema,
  characterProfileSchema,
  upsertCharacterProfileSchema,
} from '@sheishiwodi/shared';

import { CharacterProfileError, type CharacterProfileService } from './character-profile-service.js';

export function registerCharacterProfileRoutes(server: FastifyInstance, service: CharacterProfileService) {
  server.get('/api/character-profiles', async () =>
    apiSuccessSchema(characterProfileListSchema).parse({ data: service.list() }),
  );

  server.post('/api/character-profiles', { bodyLimit: 40 * 1024 * 1024 }, async (request, reply) => {
    const parsed = upsertCharacterProfileSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues.map((issue) => issue.path.join('.')));
    try {
      const profile = await service.create(parsed.data);
      return reply.status(201).send(apiSuccessSchema(characterProfileSchema).parse({ data: profile }));
    } catch (error) {
      return profileError(reply, error);
    }
  });

  server.put<{ Params: { profileId: string } }>(
    '/api/character-profiles/:profileId',
    { bodyLimit: 40 * 1024 * 1024 },
    async (request, reply) => {
      const parsed = upsertCharacterProfileSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error.issues.map((issue) => issue.path.join('.')));
      try {
        const profile = await service.update(request.params.profileId, parsed.data);
        return reply.send(apiSuccessSchema(characterProfileSchema).parse({ data: profile }));
      } catch (error) {
        return profileError(reply, error);
      }
    },
  );

  server.post<{ Params: { profileId: string } }>(
    '/api/character-profiles/:profileId/copies',
    async (request, reply) => {
      try {
        const profile = service.copy(request.params.profileId);
        return reply.status(201).send(apiSuccessSchema(characterProfileSchema).parse({ data: profile }));
      } catch (error) {
        return profileError(reply, error);
      }
    },
  );

  server.delete<{ Params: { profileId: string } }>('/api/character-profiles/:profileId', async (request, reply) => {
    try {
      service.delete(request.params.profileId);
      return reply.status(204).send();
    } catch (error) {
      return profileError(reply, error);
    }
  });

  server.get<{ Params: { profileId: string; asset: string } }>(
    '/api/character-assets/:profileId/:asset',
    async (request, reply) => {
      const state = characterAssetStateSchema.safeParse(request.params.asset.replace(/\.webp$/, ''));
      if (!state.success) return profileError(reply, new CharacterProfileError('PROFILE_NOT_FOUND'));
      try {
        return reply.type('image/webp').header('cache-control', 'private, max-age=3600').send(
          createReadStream(service.assetPath(request.params.profileId, state.data)),
        );
      } catch (error) {
        return profileError(reply, error);
      }
    },
  );
}

function validationError(reply: FastifyReply, fields: string[]) {
  return reply.status(400).send(apiErrorResponseSchema.parse({
    error: { code: 'VALIDATION_ERROR', message: '角色档案内容不合法', details: { fields } },
  }));
}

function profileError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof CharacterProfileError)) throw error;
  const status = error.code === 'PROFILE_NOT_FOUND' ? 404 : error.code === 'INVALID_IMAGE' ? 422 : 409;
  const messages = {
    PROFILE_NOT_FOUND: '未找到角色档案或素材',
    PROFILE_LOCKED: '角色正在被活动对局使用，暂时不能修改',
    PROFILE_IMMUTABLE: '内置角色不可修改或删除，可以复制后编辑',
    INVALID_IMAGE: '图片必须是单帧 PNG、JPEG 或 WebP，且尺寸与文件大小符合限制',
  } as const;
  return reply.status(status).send(apiErrorResponseSchema.parse({
    error: { code: error.code, message: messages[error.code], details: {} },
  }));
}
