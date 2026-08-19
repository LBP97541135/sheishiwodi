import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';
import { createTestEnvironment } from '../test-environment.js';

const environments: Array<ReturnType<typeof createTestEnvironment>> = [];

afterEach(() => {
  while (environments.length) environments.pop()!.cleanup();
});

describe('角色库 API', () => {
  it('保留人类剪影和三位内置 Agent，并允许创建、读取和删除自建草稿', async () => {
    const environment = createTestEnvironment();
    environments.push(environment);
    const server = buildServer({
      ...environment.dependencies,
      characterAssetRoot: environment.directory,
    });

    const initial = await server.inject({ method: 'GET', url: '/api/character-profiles' });
    expect(initial.statusCode).toBe(200);
    const initialData = (initial.json() as { data: { profiles: Array<{ profileId: string; allowedParticipantKinds: string[] }> } }).data;
    expect(initialData.profiles.map((profile) => profile.profileId)).toEqual([
      'human-male', 'human-female', 'deepseek', 'doubao', 'qwen',
    ]);
    expect(initialData.profiles[0]?.allowedParticipantKinds).toEqual(['human']);

    const created = await server.inject({
      method: 'POST',
      url: '/api/character-profiles',
      payload: {
        displayName: '冷面侦探',
        intro: '自建测试角色',
        personalityTags: ['谨慎'],
        personalityPrompt: '只依据公开信息进行简洁推理。',
        selectedModelId: null,
      },
    });
    expect(created.statusCode).toBe(201);
    const profile = (created.json() as { data: { profileId: string; complete: boolean; source: string } }).data;
    expect(profile).toMatchObject({ complete: false, source: 'custom' });

    const refreshed = await server.inject({ method: 'GET', url: '/api/character-profiles' });
    expect(JSON.stringify(refreshed.json())).toContain(profile.profileId);

    const immutable = await server.inject({ method: 'DELETE', url: '/api/character-profiles/deepseek' });
    expect(immutable.statusCode).toBe(409);
    expect(immutable.json()).toMatchObject({ error: { code: 'PROFILE_IMMUTABLE' } });

    const removed = await server.inject({ method: 'DELETE', url: `/api/character-profiles/${profile.profileId}` });
    expect(removed.statusCode).toBe(204);
    await server.close();
  });

  it('在落盘前拒绝伪造图片数据', async () => {
    const environment = createTestEnvironment();
    environments.push(environment);
    const server = buildServer({
      ...environment.dependencies,
      characterAssetRoot: environment.directory,
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/character-profiles',
      payload: {
        displayName: '非法图片',
        intro: '',
        personalityTags: ['测试'],
        personalityPrompt: '测试人格。',
        selectedModelId: null,
        assets: { avatar: 'data:image/png;base64,bm90LWFuLWltYWdl' },
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'INVALID_IMAGE' } });
    await server.close();
  });
});
