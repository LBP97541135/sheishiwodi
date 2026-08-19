import { rmSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type {
  AgentTurnInput,
  BeliefSnapshot,
  SpeechActionOutput,
  VoteActionOutput,
} from '@sheishiwodi/shared';

import { FakeAgentPolicy } from '../agents/fake-agent-policy.js';
import type { AgentPolicy } from '../agents/agent-policy.js';
import { createDatabase } from '../db/client.js';
import { buildServer, type ServerDependencies } from '../server.js';
import { createTestEnvironment } from '../test-environment.js';
import { GameRepository } from './game-repository.js';

const HUMAN_DESCRIPTION = '用于恢复测试的普通线索';

describe('服务启动恢复与重复调度', () => {
  it('准备阶段重启后保持等待，不调用 Agent', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const firstServer = buildServer(environment.dependencies);
    const created = await createGame(firstServer, 'prepare');
    await firstServer.close();
    environment.dependencies.database.close();

    const counting = new CountingPolicy();
    const reopened = createDatabase(environment.databasePath);
    const secondServer = buildServer({
      ...environment.dependencies,
      database: reopened,
      agentPolicyFactory: () => counting,
    });
    await secondServer.ready();
    const active = await readActive(secondServer);

    expect(active.status).toBe('preparing');
    expect(active.revision).toBe(created.revision);
    expect(counting.actions).toEqual([]);

    await secondServer.close();
    reopened.close();
    rmSync(environment.directory, { recursive: true, force: true });
  });

  it('AI 描述中断后重启自动推进到人类，后续重启不重复动作', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const failing = new FailOnActionPolicy('describe');
    const firstServer = buildServer({
      ...environment.dependencies,
      agentPolicyFactory: () => failing,
    });
    const created = await createGame(firstServer, 'describe-recovery');
    const start = await firstServer.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/start`,
      payload: {
        commandId: 'start-describe-recovery',
        actorId: created.human.playerId,
        expectedRevision: created.revision,
      },
    });
    expect(start.statusCode).toBe(500);

    const interrupted = new GameRepository(environment.dependencies.database).findSnapshot(created.gameId)!;
    expect(interrupted.round?.actionType).toBe('describe');
    expect(interrupted.players.find((player) => player.playerId === interrupted.round?.currentActorId)?.kind).toBe(
      'agent',
    );
    const countsBefore = counts(environment.dependencies, created.gameId);

    await firstServer.close();
    environment.dependencies.database.close();
    const firstRestart = createDatabase(environment.databasePath);
    const recoveredServer = buildServer({
      ...environment.dependencies,
      database: firstRestart,
      agentPolicyFactory: () => new FakeAgentPolicy(),
    });
    await recoveredServer.ready();
    const recovered = await readActive(recoveredServer);
    expect(recovered.round?.currentActorId).toBe(recovered.human.playerId);
    expect(recovered.round?.actionType).toBe('describe');
    const countsRecovered = counts({ ...environment.dependencies, database: firstRestart }, created.gameId);
    expect(countsRecovered.actions).toBeGreaterThan(countsBefore.actions);

    await recoveredServer.close();
    firstRestart.close();
    const secondRestart = createDatabase(environment.databasePath);
    const counting = new CountingPolicy();
    const stableServer = buildServer({
      ...environment.dependencies,
      database: secondRestart,
      agentPolicyFactory: () => counting,
    });
    await stableServer.ready();
    expect(await readActive(stableServer)).toMatchObject({
      round: { currentActorId: recovered.human.playerId, actionType: 'describe' },
    });
    expect(counting.actions).toEqual([]);
    expect(counts({ ...environment.dependencies, database: secondRestart }, created.gameId)).toEqual(
      countsRecovered,
    );

    await stableServer.close();
    secondRestart.close();
    rmSync(environment.directory, { recursive: true, force: true });
  });

  it('AI 投票中断后重启只提交一次稳定 actionId', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const failing = new FailOnActionPolicy('vote');
    const firstServer = buildServer({
      ...environment.dependencies,
      agentPolicyFactory: () => failing,
    });
    const created = await createGame(firstServer, 'vote-recovery');
    const start = await firstServer.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/start`,
      payload: {
        commandId: 'start-vote-recovery',
        actorId: created.human.playerId,
        expectedRevision: created.revision,
      },
    });
    expect(start.statusCode).toBe(200);
    let view = (start.json() as { data: HumanView }).data;
    expect(view.round?.actionType).toBe('describe');

    const described = await firstServer.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/descriptions`,
      payload: {
        commandId: 'human-describe-vote-recovery',
        actorId: created.human.playerId,
        expectedRevision: view.revision,
        text: HUMAN_DESCRIPTION,
      },
    });
    expect(described.statusCode).toBe(200);
    view = (described.json() as { data: HumanView }).data;
    expect(view.round?.actionType).toBe('vote');

    const voted = await firstServer.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/votes`,
      payload: {
        commandId: 'human-vote-recovery',
        actorId: created.human.playerId,
        expectedRevision: view.revision,
        targetPlayerId: view.legalVoteTargetIds[0],
      },
    });
    expect(voted.statusCode).toBe(500);

    const repository = new GameRepository(environment.dependencies.database);
    const interrupted = repository.findSnapshot(created.gameId)!;
    const actorId = interrupted.round!.currentActorId;
    const actionId = `auto/${created.gameId}/${interrupted.revision}/${actorId}/vote`;
    expect(interrupted.round?.actionType).toBe('vote');
    expect(repository.findProcessedCommand(actionId)).toBeNull();

    await firstServer.close();
    environment.dependencies.database.close();
    const reopened = createDatabase(environment.databasePath);
    const recoveredServer = buildServer({
      ...environment.dependencies,
      database: reopened,
      agentPolicyFactory: () => new FakeAgentPolicy(),
    });
    await recoveredServer.ready();

    expect(countById(reopened, 'agent_actions', 'action_id', actionId)).toBe(1);
    expect(countById(reopened, 'processed_commands', 'command_id', actionId)).toBe(1);
    const recoveredCounts = counts({ ...environment.dependencies, database: reopened }, created.gameId);

    await recoveredServer.close();
    reopened.close();
    const restartedAgain = createDatabase(environment.databasePath);
    const stableServer = buildServer({
      ...environment.dependencies,
      database: restartedAgain,
      agentPolicyFactory: () => new FakeAgentPolicy(),
    });
    await stableServer.ready();
    expect(countById(restartedAgain, 'agent_actions', 'action_id', actionId)).toBe(1);
    expect(countById(restartedAgain, 'processed_commands', 'command_id', actionId)).toBe(1);
    expect(counts({ ...environment.dependencies, database: restartedAgain }, created.gameId)).toEqual(
      recoveredCounts,
    );

    await stableServer.close();
    restartedAgain.close();
    rmSync(environment.directory, { recursive: true, force: true });
  });

  it('事件或公开流高水位不一致时拒绝恢复', async () => {
    const environment = createTestEnvironment();
    const server = buildServer(environment.dependencies);
    const created = await createGame(server, 'inconsistent');
    environment.dependencies.database.sqlite
      .prepare('DELETE FROM public_stream_entries WHERE game_id = ? AND stream_seq = ?')
      .run(created.gameId, created.eventCursor);

    expect(() => new GameRepository(environment.dependencies.database).findSnapshot(created.gameId)).toThrow(
      'DATA_INCONSISTENT',
    );

    await server.close();
    environment.cleanup();
  });

  it('真实调用崩溃遗留 started attempt 时重启等待确认，继续后只恢复当前动作', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const created = await leaveStartedAttempt(environment, 'confirm-continue');
    const reopened = createDatabase(environment.databasePath);
    const counting = new CountingPolicy();
    const server = buildServer({
      ...environment.dependencies,
      database: reopened,
      agentPolicyFactory: () => counting,
    });
    await server.ready();

    const interrupted = await readActive(server);
    expect(interrupted.operationalStatus).toEqual({ state: 'interrupted' });
    expect(interrupted.allowedCommands).toEqual(['ResolveInterruptedGame']);
    expect(counting.actions).toEqual([]);
    const continued = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/recovery`,
      payload: { commandId: 'continue-after-crash', resolution: 'continue' },
    });
    expect(continued.statusCode, continued.body).toBe(200);
    expect(counting.actions.length).toBeGreaterThan(0);
    expect((continued.json() as { data: HumanView }).data.operationalStatus.state).not.toBe(
      'interrupted',
    );
    const attempt = reopened.sqlite
      .prepare('SELECT result_code FROM model_attempts WHERE attempt_id = ?')
      .get('attempt-confirm-continue') as { result_code: string };
    expect(attempt.result_code).toBe('runtime_interrupted');

    await server.close();
    reopened.close();
    rmSync(environment.directory, { recursive: true, force: true });
  });

  it('中断后选择开始新局，以独立原因结束旧局并释放活动局门禁', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const created = await leaveStartedAttempt(environment, 'confirm-new');
    const reopened = createDatabase(environment.databasePath);
    const server = buildServer({ ...environment.dependencies, database: reopened });
    await server.ready();

    const declined = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/recovery`,
      payload: { commandId: 'new-after-crash', resolution: 'start_new' },
    });
    expect(declined.statusCode, declined.body).toBe(200);
    expect((declined.json() as { data: HumanView }).data).toMatchObject({
      status: 'abandoned',
      endReason: 'interrupted_not_resumed',
    });
    const next = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        commandId: 'create-after-crash',
        human: { displayName: '恢复测试', silhouette: 'silhouette_a' },
        difficulty: 'easy',
      },
    });
    expect(next.statusCode, next.body).toBe(201);

    await server.close();
    reopened.close();
    rmSync(environment.directory, { recursive: true, force: true });
  });
});

interface HumanView {
  gameId: string;
  status: string;
  revision: number;
  eventCursor: number;
  human: { playerId: string };
  round: { currentActorId: string; actionType: string } | null;
  legalVoteTargetIds: string[];
  allowedCommands: string[];
  operationalStatus: { state: string };
  endReason?: string;
}

async function leaveStartedAttempt(
  environment: ReturnType<typeof createTestEnvironment>,
  suffix: string,
) {
  const server = buildServer({
    ...environment.dependencies,
    agentPolicyFactory: () => new FailOnActionPolicy('describe'),
  });
  const created = await createGame(server, suffix);
  const started = await server.inject({
    method: 'POST',
    url: `/api/games/${created.gameId}/start`,
    payload: {
      commandId: `start-${suffix}`,
      actorId: created.human.playerId,
      expectedRevision: created.revision,
    },
  });
  expect(started.statusCode).toBe(500);
  const snapshot = new GameRepository(environment.dependencies.database).findSnapshot(created.gameId)!;
  const actorId = snapshot.round!.currentActorId;
  const actionId = `auto/${created.gameId}/${snapshot.revision}/${actorId}/describe`;
  environment.dependencies.database.sqlite
    .prepare(
      `INSERT INTO model_attempts (
        attempt_id, game_id, command_id, action_id, player_id, role_id, model_id,
        action_type, attempt_number, attempt_kind, result_code, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'describe', 1, 'initial', 'started', ?)`,
    )
    .run(
      `attempt-${suffix}`,
      created.gameId,
      `start-${suffix}`,
      actionId,
      actorId,
      actorId,
      'model-test',
      '2026-08-16T12:00:00.000Z',
    );
  await server.close();
  environment.dependencies.database.close();
  return created;
}

async function createGame(server: ReturnType<typeof buildServer>, suffix: string) {
  const response = await server.inject({
    method: 'POST',
    url: '/api/games',
    payload: {
      commandId: `create-${suffix}`,
      human: { displayName: '恢复测试', silhouette: 'silhouette_a' },
      difficulty: 'easy',
    },
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { data: HumanView }).data;
}

async function readActive(server: ReturnType<typeof buildServer>) {
  const response = await server.inject({ method: 'GET', url: '/api/games/active' });
  return (response.json() as { data: { game: HumanView } }).data.game;
}

class FailOnActionPolicy implements AgentPolicy {
  private readonly fallback = new FakeAgentPolicy();

  constructor(private readonly failedAction: AgentTurnInput['actionType']) {}

  async act(input: AgentTurnInput): Promise<SpeechActionOutput | VoteActionOutput> {
    if (input.actionType === this.failedAction) throw new Error(`INTERRUPTED_${this.failedAction}`);
    return this.fallback.act(input);
  }

  priorBeliefs(playerId: string): readonly BeliefSnapshot[] {
    return this.fallback.priorBeliefs(playerId);
  }
}

class CountingPolicy implements AgentPolicy {
  readonly actions: AgentTurnInput['actionType'][] = [];
  private readonly fallback = new FakeAgentPolicy();

  async act(input: AgentTurnInput): Promise<SpeechActionOutput | VoteActionOutput> {
    this.actions.push(input.actionType);
    return this.fallback.act(input);
  }

  priorBeliefs(playerId: string): readonly BeliefSnapshot[] {
    return this.fallback.priorBeliefs(playerId);
  }
}

function counts(dependencies: ServerDependencies, gameId: string) {
  const count = (table: string) =>
    (
      dependencies.database.sqlite
        .prepare(`SELECT COUNT(*) AS value FROM ${table} WHERE game_id = ?`)
        .get(gameId) as { value: number }
    ).value;
  return {
    events: count('game_events'),
    actions: count('agent_actions'),
    frames: count('public_stream_entries'),
    commands: count('processed_commands'),
  };
}

function countById(
  database: ReturnType<typeof createDatabase>,
  table: string,
  column: string,
  value: string,
) {
  return (
    database.sqlite.prepare(`SELECT COUNT(*) AS value FROM ${table} WHERE ${column} = ?`).get(value) as {
      value: number;
    }
  ).value;
}
