import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  developerOverviewSchema,
  fullRecordingStateSchema,
} from '@sheishiwodi/shared';

import { ContextAuditWriter } from '../agents/agent-observability.js';
import { ProviderCircuitBreaker } from '../agents/provider-circuit-breaker.js';
import { buildServer } from '../server.js';
import { createTestEnvironment } from '../test-environment.js';

describe('developer mode gate', () => {
  it('默认不注册诊断路由，活动对局响应也不暴露入口能力', async () => {
    const environment = createTestEnvironment();
    const server = buildServer(environment.dependencies);

    const overview = await server.inject({ method: 'GET', url: '/api/developer/overview' });
    const active = await server.inject({ method: 'GET', url: '/api/games/active' });

    expect(overview.statusCode).toBe(404);
    expect(JSON.stringify(active.json())).not.toContain('developerMode');

    await server.close();
    environment.cleanup();
  });

  it('开启后提供只读总览、能力标记和进程级完整记录开关', async () => {
    const environment = createTestEnvironment();
    const audit = new ContextAuditWriter(join(environment.directory, 'agent-audit'));
    const server = buildServer({
      ...environment.dependencies,
      developerMode: true,
      contextAudit: audit,
      providerCircuitBreaker: new ProviderCircuitBreaker(),
    });

    const active = await server.inject({ method: 'GET', url: '/api/games/active' });
    expect(active.json()).toMatchObject({ data: { developerModeAvailable: true } });

    const overview = await server.inject({ method: 'GET', url: '/api/developer/overview' });
    expect(overview.statusCode).toBe(200);
    expect(developerOverviewSchema.parse(overview.json().data)).toMatchObject({
      fullRecordingEnabled: false,
      calls: [],
      contexts: [],
      errorsAndRecovery: {
        failedAttempts: [],
        interruptedGames: [],
        providerCircuit: { state: 'closed' },
      },
    });

    const enabled = await server.inject({
      method: 'PUT',
      url: '/api/developer/full-recording',
      payload: { enabled: true },
    });
    expect(enabled.statusCode).toBe(200);
    expect(fullRecordingStateSchema.parse(enabled.json().data)).toEqual({ enabled: true });
    expect(audit.isFullRecordingEnabled()).toBe(true);

    await server.close();
    environment.cleanup();
  });
});
