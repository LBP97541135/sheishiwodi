import { describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';
import { createTestEnvironment } from '../test-environment.js';

describe('模型档案 API', () => {
  it('默认假模型下返回三位角色档案，且不含 Base URL / API Key', async () => {
    const environment = createTestEnvironment();
    const server = buildServer(environment.dependencies);

    const response = await server.inject({ method: 'GET', url: '/api/model-profiles' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: {
        providerMode: string;
        providerConfigured: boolean;
        editable: boolean;
        profiles: { roleId: string; selectedModelId: string | null }[];
      };
    };

    expect(body.data.providerMode).toBe('fake');
    expect(body.data.providerConfigured).toBe(false);
    expect(body.data.editable).toBe(true);
    expect(body.data.profiles.map((profile) => profile.roleId)).toEqual([
      'deepseek',
      'doubao',
      'qwen',
    ]);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('tokendance.space');
    expect(serialized).not.toContain('gateway/v1');
    expect(serialized.toLowerCase()).not.toContain('authorization');
    expect(serialized.toLowerCase()).not.toContain('api_key');
    expect(serialized.toLowerCase()).not.toContain('apikey');
    expect(serialized).not.toContain('Bearer');

    await server.close();
    environment.cleanup();
  });

  it('假模型下 /api/models 返回空目录', async () => {
    const environment = createTestEnvironment();
    const server = buildServer(environment.dependencies);

    const response = await server.inject({ method: 'GET', url: '/api/models' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { providerMode: 'fake', models: [] } });

    await server.close();
    environment.cleanup();
  });

  it('PUT 持久化所选 model 并在后续读取中体现', async () => {
    const environment = createTestEnvironment();
    const server = buildServer(environment.dependencies);

    const putResponse = await server.inject({
      method: 'PUT',
      url: '/api/model-profiles/doubao',
      payload: { modelId: 'gpt-demo' },
    });
    expect(putResponse.statusCode).toBe(200);
    expect(putResponse.json()).toMatchObject({
      data: { roleId: 'doubao', selectedModelId: 'gpt-demo' },
    });

    const listResponse = await server.inject({ method: 'GET', url: '/api/model-profiles' });
    const listed = (listResponse.json() as {
      data: { profiles: { roleId: string; selectedModelId: string | null }[] };
    }).data.profiles.find((profile) => profile.roleId === 'doubao');
    expect(listed?.selectedModelId).toBe('gpt-demo');

    await server.close();
    environment.cleanup();
  });

  it('未知角色返回 404', async () => {
    const environment = createTestEnvironment();
    const server = buildServer(environment.dependencies);

    const response = await server.inject({
      method: 'PUT',
      url: '/api/model-profiles/unknown-role',
      payload: { modelId: 'gpt-demo' },
    });
    expect(response.statusCode).toBe(404);

    await server.close();
    environment.cleanup();
  });
});
