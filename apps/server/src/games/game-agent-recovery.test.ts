import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  AgentTurnInput,
  BeliefSnapshot,
  SpeechActionOutput,
  VoteActionOutput,
} from '@sheishiwodi/shared';

import type { AgentActContext, AgentPolicy } from '../agents/agent-policy.js';
import {
  ContextAuditWriter,
  PersistentAgentObservability,
  type AgentObservability,
  type AttemptHandle,
} from '../agents/agent-observability.js';
import { FakeAgentPolicy } from '../agents/fake-agent-policy.js';
import { ModelAttemptRepository } from '../db/model-attempt-repository.js';
import { buildServer } from '../server.js';
import { createTestEnvironment } from '../test-environment.js';

type RecoveryMode = 'word-once' | 'word-twice' | 'format-once' | 'format-twice';

class ContentRecoveryPolicy implements AgentPolicy {
  readonly contexts: Array<AgentActContext | undefined> = [];
  leakedWord = '';
  private readonly fallback = new FakeAgentPolicy();
  private targetPlayerId: string | undefined;
  private targetCalls = 0;

  constructor(private readonly mode: RecoveryMode) {}

  async act(
    input: AgentTurnInput,
    context?: AgentActContext,
  ): Promise<SpeechActionOutput | VoteActionOutput> {
    this.contexts.push(context);
    const output = await this.fallback.act(input);
    if (input.actionType !== 'describe' && input.actionType !== 'defend') return output;
    this.targetPlayerId ??= input.actor.playerId;
    if (input.actor.playerId !== this.targetPlayerId) return output;

    this.targetCalls += 1;
    if (this.mode.startsWith('word')) {
      this.leakedWord = input.actor.ownWordCard;
      const shouldFail = this.mode === 'word-twice' ? this.targetCalls <= 2 : this.targetCalls === 1;
      return shouldFail ? { ...output, text: input.actor.ownWordCard } : output;
    }

    const shouldFail = this.mode === 'format-twice' ? this.targetCalls <= 2 : this.targetCalls === 1;
    return shouldFail ? { ...output, text: '短' } : output;
  }

  priorBeliefs(playerId: string): readonly BeliefSnapshot[] {
    return this.fallback.priorBeliefs(playerId);
  }
}

class DeferredPolicy implements AgentPolicy {
  readonly started: Promise<void>;
  private readonly releasePromise: Promise<void>;
  private resolveStarted!: () => void;
  private resolveRelease!: () => void;
  private readonly fallback = new FakeAgentPolicy();

  constructor(private readonly observability?: AgentObservability) {
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
    this.releasePromise = new Promise((resolve) => {
      this.resolveRelease = resolve;
    });
  }

  async act(
    input: AgentTurnInput,
    context?: AgentActContext,
  ): Promise<SpeechActionOutput | VoteActionOutput> {
    const attempt = this.beginAttempt(input, context);
    const output = await this.fallback.act(input);
    this.resolveStarted();
    await this.releasePromise;
    if (attempt) {
      this.observability?.markAttemptStage?.(attempt.attemptId, 'provider_returned');
      this.observability?.markAttemptStage?.(attempt.attemptId, 'schema_validated');
      if (context?.lifecycle) context.lifecycle.validatedAttemptId = attempt.attemptId;
    }
    return output;
  }

  release() {
    this.resolveRelease();
  }

  priorBeliefs(playerId: string): readonly BeliefSnapshot[] {
    return this.fallback.priorBeliefs(playerId);
  }

  private beginAttempt(input: AgentTurnInput, context?: AgentActContext): AttemptHandle | undefined {
    if (!this.observability || !context) return undefined;
    return this.observability.beginPlayerAttempt({
      agentInput: input,
      context,
      modelId: 'lifecycle-test-model',
      messages: [{ role: 'user', content: 'lifecycle test' }],
      attemptKind: 'initial',
    });
  }
}

class LifecyclePolicy implements AgentPolicy {
  private readonly fallback = new FakeAgentPolicy();
  private rejectedFirstSpeech = false;

  constructor(
    private readonly observability: AgentObservability,
    private readonly rejectFirstSpeech: boolean,
  ) {}

  async act(
    input: AgentTurnInput,
    context?: AgentActContext,
  ): Promise<SpeechActionOutput | VoteActionOutput> {
    if (!context) throw new Error('MISSING_CONTEXT');
    const attempt = this.observability.beginPlayerAttempt({
      agentInput: input,
      context,
      modelId: 'lifecycle-test-model',
      messages: [{ role: 'user', content: 'lifecycle test' }],
      attemptKind: context.contentRetry ? 'content_regeneration' : 'initial',
    });
    const output = await this.fallback.act(input);
    this.observability.markAttemptStage?.(attempt.attemptId, 'provider_returned', {
      rawResponse: JSON.stringify(output),
    });
    this.observability.markAttemptStage?.(attempt.attemptId, 'schema_validated');
    if (context.lifecycle) context.lifecycle.validatedAttemptId = attempt.attemptId;

    if (
      this.rejectFirstSpeech &&
      !this.rejectedFirstSpeech &&
      (input.actionType === 'describe' || input.actionType === 'defend')
    ) {
      this.rejectedFirstSpeech = true;
      return { ...output, text: '短' } as SpeechActionOutput;
    }
    return output;
  }

  priorBeliefs(playerId: string): readonly BeliefSnapshot[] {
    return this.fallback.priorBeliefs(playerId);
  }
}

class CountingPolicy implements AgentPolicy {
  readonly callsByPlayer = new Map<string, number>();
  firstPlayerId: string | undefined;
  private readonly fallback = new FakeAgentPolicy();

  async act(input: AgentTurnInput): Promise<SpeechActionOutput | VoteActionOutput> {
    this.firstPlayerId ??= input.actor.playerId;
    this.callsByPlayer.set(input.actor.playerId, (this.callsByPlayer.get(input.actor.playerId) ?? 0) + 1);
    return this.fallback.act(input);
  }

  priorBeliefs(playerId: string): readonly BeliefSnapshot[] {
    return this.fallback.priorBeliefs(playerId);
  }
}

class UnknownFailureOncePolicy implements AgentPolicy {
  calls = 0;
  private readonly fallback = new FakeAgentPolicy();

  async act(input: AgentTurnInput): Promise<SpeechActionOutput | VoteActionOutput> {
    this.calls += 1;
    if (this.calls === 1) throw new Error('PRIVATE_PROVIDER_DETAIL');
    return this.fallback.act(input);
  }

  priorBeliefs(playerId: string): readonly BeliefSnapshot[] {
    return this.fallback.priorBeliefs(playerId);
  }
}

interface HumanView {
  gameId: string;
  status: string;
  revision: number;
  human: { playerId: string };
  players: Array<{ playerId: string; alive: boolean }>;
  allowedCommands?: string[];
  operationalStatus?: { state: string };
  endReason?: string;
}

async function startWith(policy: AgentPolicy) {
  const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
  const server = buildServer({
    ...environment.dependencies,
    agentPolicyFactory: () => policy,
  });
  const createdResponse = await server.inject({
    method: 'POST',
    url: '/api/games',
    payload: {
      commandId: `create-${crypto.randomUUID()}`,
      human: { displayName: '玩家', silhouette: 'silhouette_a' },
      difficulty: 'easy',
    },
  });
  const created = (createdResponse.json() as { data: HumanView }).data;
  const startedResponse = await server.inject({
    method: 'POST',
    url: `/api/games/${created.gameId}/start`,
    payload: {
      commandId: `start-${crypto.randomUUID()}`,
      actorId: created.human.playerId,
      expectedRevision: created.revision,
    },
  });
  expect(startedResponse.statusCode).toBe(200);
  return {
    environment,
    server,
    view: (startedResponse.json() as { data: HumanView }).data,
  };
}

function createLifecycleObservability(environment: ReturnType<typeof createTestEnvironment>) {
  const attempts = new ModelAttemptRepository(environment.dependencies.database);
  const observability = new PersistentAgentObservability(
    attempts,
    new ContextAuditWriter(join(environment.directory, 'agent-audit')),
  );
  return { attempts, observability };
}

describe('Agent 公开内容自动恢复', () => {
  it('首次原词泄露秘密重生成，失败原文不进入公开事件', async () => {
    const policy = new ContentRecoveryPolicy('word-once');
    const { environment, server, view } = await startWith(policy);
    const frames = (
      await server.inject({ method: 'GET', url: `/api/games/${view.gameId}/events?after=0` })
    ).json() as { data: { frames: unknown[] } };

    expect(policy.contexts.some((context) => context?.contentRetry === 'word_leak')).toBe(true);
    expect(
      policy.contexts.every(
        (context) =>
          context?.trace?.gameId === view.gameId &&
          context.trace.commandId.startsWith('start-') &&
          context.trace.actionId.startsWith(`auto/${view.gameId}/`) &&
          context.trace.provenance.priorBeliefOwnerId.length > 0,
      ),
    ).toBe(true);
    expect(JSON.stringify(frames.data)).not.toContain(policy.leakedWord);
    expect(JSON.stringify(frames.data)).not.toContain('player_rule_violated');

    await server.close();
    environment.cleanup();
  });

  it('同一行动第二次泄露时公开规则违规并强制退出，不保存违规原文', async () => {
    const policy = new ContentRecoveryPolicy('word-twice');
    const { environment, server, view } = await startWith(policy);
    const frames = (
      await server.inject({ method: 'GET', url: `/api/games/${view.gameId}/events?after=0` })
    ).json() as {
      data: { frames: Array<{ type: string; payload: Record<string, unknown> }> };
    };
    const violation = frames.data.frames.find((frame) => frame.type === 'player_rule_violated');

    expect(violation).toBeDefined();
    expect(violation?.payload).not.toHaveProperty('text');
    expect(JSON.stringify(frames.data)).not.toContain(policy.leakedWord);
    const refreshed = (
      await server.inject({ method: 'GET', url: `/api/games/${view.gameId}` })
    ).json() as { data: HumanView };
    expect(refreshed.data.players.some((player) => !player.alive)).toBe(true);

    await server.close();
    environment.cleanup();
  });

  it('长度或句数错误自动重生成一次，第二次仍失败才异常终止', async () => {
    const recoveredPolicy = new ContentRecoveryPolicy('format-once');
    const recovered = await startWith(recoveredPolicy);
    expect(recovered.view.status).not.toBe('system_terminated');
    expect(recoveredPolicy.contexts.some((context) => context?.contentRetry === 'format')).toBe(true);
    await recovered.server.close();
    recovered.environment.cleanup();

    const failedPolicy = new ContentRecoveryPolicy('format-twice');
    const failed = await startWith(failedPolicy);
    expect(failed.view.status).toBe('system_terminated');
    expect(failed.view.endReason).toBe('model_failure_limit');
    await failed.server.close();
    failed.environment.cleanup();
  });
});

describe('Agent 结果并发与持久化恢复', () => {
  it('只在内容校验和动作提交完成后记录最终成功', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const { attempts, observability } = createLifecycleObservability(environment);
    const policy = new LifecyclePolicy(observability, true);
    const server = buildServer({
      ...environment.dependencies,
      agentPolicyFactory: () => policy,
      agentObservability: observability,
    });
    const createdResponse = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        commandId: 'create-attempt-lifecycle',
        human: { displayName: '玩家', silhouette: 'silhouette_a' },
        difficulty: 'easy',
      },
    });
    const created = (createdResponse.json() as { data: HumanView }).data;
    await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/start`,
      payload: {
        commandId: 'start-attempt-lifecycle',
        actorId: created.human.playerId,
        expectedRevision: created.revision,
      },
    });

    const rows = attempts.listRecent(created.gameId);
    const rejected = rows.find((row) => row.resultCode === 'content_rejected');
    const committed = rows.find((row) => row.resultCode === 'action_committed');
    expect(rejected?.stages.map((stage) => stage.stage)).toEqual([
      'request_started',
      'provider_returned',
      'schema_validated',
    ]);
    expect(committed?.stages.map((stage) => stage.stage)).toEqual([
      'request_started',
      'provider_returned',
      'schema_validated',
      'content_validated',
      'action_committed',
    ]);
    expect(rows.some((row) => row.resultCode === 'success')).toBe(false);

    await server.close();
    environment.cleanup();
  });

  it('后台未分类异常持久化为玩家确认中断，不终止对局或自动重试', async () => {
    const policy = new UnknownFailureOncePolicy();
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const server = buildServer({
      ...environment.dependencies,
      agentPolicyFactory: () => policy,
      backgroundAdvance: true,
    });
    const createdResponse = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        commandId: 'create-unknown-background-failure',
        human: { displayName: '玩家', silhouette: 'silhouette_a' },
        difficulty: 'easy',
      },
    });
    const created = (createdResponse.json() as { data: HumanView }).data;
    const started = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/start`,
      payload: {
        commandId: 'start-unknown-background-failure',
        actorId: created.human.playerId,
        expectedRevision: created.revision,
      },
    });
    expect(started.statusCode).toBe(200);

    let recovered: HumanView | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await server.inject({
        method: 'GET',
        url: `/api/games/${created.gameId}`,
      });
      recovered = (response.json() as { data: HumanView }).data;
      if (recovered.operationalStatus?.state === 'interrupted') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(recovered?.status).toBe('in_progress');
    expect(recovered?.operationalStatus?.state).toBe('interrupted');
    expect(recovered?.allowedCommands).toEqual(['ResolveInterruptedGame']);
    expect(policy.calls).toBe(1);
    const frames = (
      await server.inject({ method: 'GET', url: `/api/games/${created.gameId}/events?after=0` })
    ).json() as {
      data: { frames: Array<{ type: string; payload: Record<string, unknown> }> };
    };
    expect(frames.data.frames.some((frame) => frame.type === 'runtime_interrupted')).toBe(true);
    expect(frames.data.frames.some((frame) => frame.type === 'game_system_terminated')).toBe(false);
    expect(JSON.stringify(frames.data.frames)).not.toContain('PRIVATE_PROVIDER_DETAIL');

    await server.close();
    environment.cleanup();
  });

  it('模型调用期间玩家放弃时丢弃旧 revision 结果，不提交私有动作', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const { attempts, observability } = createLifecycleObservability(environment);
    const policy = new DeferredPolicy(observability);
    const server = buildServer({
      ...environment.dependencies,
      agentPolicyFactory: () => policy,
      backgroundAdvance: true,
      agentObservability: observability,
    });
    const createdResponse = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        commandId: 'create-stale-agent',
        human: { displayName: '玩家', silhouette: 'silhouette_a' },
        difficulty: 'easy',
      },
    });
    const created = (createdResponse.json() as { data: HumanView }).data;
    await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/start`,
      payload: {
        commandId: 'start-stale-agent',
        actorId: created.human.playerId,
        expectedRevision: created.revision,
      },
    });
    await policy.started;
    const active = (
      await server.inject({ method: 'GET', url: `/api/games/${created.gameId}` })
    ).json() as { data: HumanView };
    const abandoned = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/abandon`,
      payload: {
        commandId: 'abandon-during-agent',
        actorId: created.human.playerId,
        expectedRevision: active.data.revision,
        confirmed: true,
      },
    });
    expect((abandoned.json() as { data: HumanView }).data.status).toBe('abandoned');

    policy.release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const actionCount = environment.dependencies.database.sqlite
      .prepare('SELECT COUNT(*) AS value FROM agent_actions WHERE game_id = ?')
      .get(created.gameId) as { value: number };
    expect(actionCount.value).toBe(0);
    expect(attempts.listRecent(created.gameId)).toMatchObject([
      {
        resultCode: 'stale_discarded',
        stages: [
          { stage: 'request_started' },
          { stage: 'provider_returned' },
          { stage: 'schema_validated' },
        ],
      },
    ]);

    await server.close();
    environment.cleanup();
  });

  it('动作事务连续失败时记录 commit_failed，而不是最终成功', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const { attempts, observability } = createLifecycleObservability(environment);
    const policy = new LifecyclePolicy(observability, false);
    environment.dependencies.database.sqlite.exec(`
      CREATE TRIGGER fail_all_agent_actions
      BEFORE INSERT ON agent_actions
      BEGIN
        SELECT RAISE(FAIL, 'COMMIT_FAILURE');
      END;
    `);
    const server = buildServer({
      ...environment.dependencies,
      agentPolicyFactory: () => policy,
      agentObservability: observability,
    });
    const createdResponse = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        commandId: 'create-attempt-commit-failure',
        human: { displayName: '玩家', silhouette: 'silhouette_a' },
        difficulty: 'easy',
      },
    });
    const created = (createdResponse.json() as { data: HumanView }).data;
    const started = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/start`,
      payload: {
        commandId: 'start-attempt-commit-failure',
        actorId: created.human.playerId,
        expectedRevision: created.revision,
      },
    });

    expect((started.json() as { data: HumanView }).data.status).toBe('system_terminated');
    expect(attempts.listRecent(created.gameId)[0]).toMatchObject({
      resultCode: 'commit_failed',
      stages: [
        { stage: 'request_started' },
        { stage: 'provider_returned' },
        { stage: 'schema_validated' },
        { stage: 'content_validated' },
      ],
    });

    await server.close();
    environment.cleanup();
  });

  it('事务首次瞬时失败时复用已验证输出重试提交，不再次调用模型', async () => {
    const policy = new CountingPolicy();
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    let shouldFail = true;
    environment.dependencies.database.sqlite.function('fail_once', () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('TRANSIENT_COMMIT_FAILURE');
      }
      return 1;
    });
    environment.dependencies.database.sqlite.exec(`
      CREATE TRIGGER fail_first_agent_action
      BEFORE INSERT ON agent_actions
      BEGIN
        SELECT fail_once();
      END;
    `);
    const server = buildServer({
      ...environment.dependencies,
      agentPolicyFactory: () => policy,
    });
    const createdResponse = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        commandId: 'create-commit-retry',
        human: { displayName: '玩家', silhouette: 'silhouette_a' },
        difficulty: 'easy',
      },
    });
    const created = (createdResponse.json() as { data: HumanView }).data;
    const started = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/start`,
      payload: {
        commandId: 'start-commit-retry',
        actorId: created.human.playerId,
        expectedRevision: created.revision,
      },
    });

    expect(started.statusCode).toBe(200);
    expect(shouldFail).toBe(false);
    expect(policy.firstPlayerId).toBeDefined();
    expect(policy.callsByPlayer.get(policy.firstPlayerId!)).toBe(1);

    await server.close();
    environment.cleanup();
  });
});
