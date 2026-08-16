import { describe, expect, it } from 'vitest';

import { buildServer } from './server.js';
import { createTestEnvironment } from './test-environment.js';

describe('GET /api/health', () => {
  it('返回不包含配置值的健康状态', async () => {
    const environment = createTestEnvironment();
    const server = buildServer(environment.dependencies);
    const response = await server.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'sheishiwodi-server' });

    await server.close();
    environment.cleanup();
  });
});

describe('对局准备 API', () => {
  it('创建、恢复并开始同一对局且不泄露私有字段', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const server = buildServer(environment.dependencies);

    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        commandId: 'create-1',
        human: { displayName: '小祎', silhouette: 'silhouette_a' },
        difficulty: 'easy',
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const createBody = createResponse.json() as {
      data: {
        gameId: string;
        revision: number;
        human: { playerId: string; ownWordCard: string };
      };
    };
    const serialized = JSON.stringify(createBody);
    expect(serialized).not.toContain('"camp"');
    expect(serialized).not.toContain('undercoverWord');
    expect(serialized).not.toContain('civilianWord');
    expect(serialized).not.toContain('豆浆');

    const activeResponse = await server.inject({ method: 'GET', url: '/api/games/active' });
    expect(activeResponse.statusCode).toBe(200);
    expect(activeResponse.json()).toMatchObject({
      data: { game: { gameId: createBody.data.gameId, status: 'preparing' } },
    });

    const startResponse = await server.inject({
      method: 'POST',
      url: `/api/games/${createBody.data.gameId}/start`,
      payload: {
        commandId: 'start-1',
        actorId: createBody.data.human.playerId,
        expectedRevision: createBody.data.revision,
      },
    });
    expect(startResponse.statusCode).toBe(200);
    // 开始后服务端自动推进 AI 描述，停在人类的描述回合。
    const startBody = startResponse.json() as {
      data: {
        status: string;
        phase: string;
        revision: number;
        round: { number: number; currentActorId: string; actionType: string };
      };
    };
    expect(startBody.data.status).toBe('in_progress');
    expect(startBody.data.phase).toBe('speaking');
    expect(startBody.data.round.number).toBe(1);
    expect(startBody.data.round.currentActorId).toBe(createBody.data.human.playerId);
    expect(startBody.data.round.actionType).toBe('describe');
    expect(startBody.data.revision).toBeGreaterThanOrEqual(1);

    await server.close();
    environment.cleanup();
  });

  it('重复创建命令幂等，不同语义冲突，并阻止第二个活动局', async () => {
    const environment = createTestEnvironment();
    const server = buildServer(environment.dependencies);
    const payload = {
      commandId: 'create-1',
      human: { displayName: '玩家', silhouette: 'silhouette_a' },
      difficulty: 'easy',
    };

    const first = await server.inject({ method: 'POST', url: '/api/games', payload });
    const repeated = await server.inject({ method: 'POST', url: '/api/games', payload });
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json()).toEqual(first.json());

    const conflict = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: { ...payload, difficulty: 'hard' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });

    const second = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: { ...payload, commandId: 'create-2' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: 'ACTIVE_GAME_EXISTS' } });

    await server.close();
    environment.cleanup();
  });

  it('数据库重开后恢复相同词牌和分配', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const firstServer = buildServer(environment.dependencies);
    const created = await firstServer.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        commandId: 'create-1',
        human: { displayName: '玩家', silhouette: 'silhouette_b' },
        difficulty: 'easy',
      },
    });
    const createdView = (created.json() as { data: unknown }).data;
    await firstServer.close();
    environment.dependencies.database.close();

    const { createDatabase } = await import('./db/client.js');
    const reopened = createDatabase(environment.databasePath);
    const secondServer = buildServer({ ...environment.dependencies, database: reopened });
    const active = await secondServer.inject({ method: 'GET', url: '/api/games/active' });
    expect((active.json() as { data: { game: unknown } }).data.game).toEqual(createdView);

    await secondServer.close();
    reopened.close();
    const { rmSync } = await import('node:fs');
    rmSync(environment.directory, { recursive: true, force: true });
  });

  it('创建事务任一步失败时不留下对局或事件', async () => {
    const environment = createTestEnvironment();
    const server = buildServer({
      ...environment.dependencies,
      ids: { nextId: () => 'duplicate-id' },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        commandId: 'create-rollback',
        human: { displayName: '玩家', silhouette: 'silhouette_a' },
        difficulty: 'easy',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(
      environment.dependencies.database.sqlite.prepare('SELECT COUNT(*) AS count FROM games').get(),
    ).toEqual({ count: 0 });
    expect(
      environment.dependencies.database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM game_events')
        .get(),
    ).toEqual({ count: 0 });
    expect(
      environment.dependencies.database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM processed_commands')
        .get(),
    ).toEqual({ count: 0 });

    await server.close();
    environment.cleanup();
  });

  it('过期修订号不能开始游戏', async () => {
    const environment = createTestEnvironment();
    const server = buildServer(environment.dependencies);
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        commandId: 'create-1',
        human: { displayName: '玩家', silhouette: 'silhouette_a' },
        difficulty: 'easy',
      },
    });
    const view = (createResponse.json() as {
      data: { gameId: string; human: { playerId: string } };
    }).data;

    const response = await server.inject({
      method: 'POST',
      url: `/api/games/${view.gameId}/start`,
      payload: { commandId: 'start-1', actorId: view.human.playerId, expectedRevision: 9 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'REVISION_CONFLICT' } });

    await server.close();
    environment.cleanup();
  });
});
