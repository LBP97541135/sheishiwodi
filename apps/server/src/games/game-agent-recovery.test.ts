import { describe, expect, it } from 'vitest';

import type {
  AgentTurnInput,
  BeliefSnapshot,
  SpeechActionOutput,
  VoteActionOutput,
} from '@sheishiwodi/shared';

import type { AgentActContext, AgentPolicy } from '../agents/agent-policy.js';
import { FakeAgentPolicy } from '../agents/fake-agent-policy.js';
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

  constructor() {
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
    this.releasePromise = new Promise((resolve) => {
      this.resolveRelease = resolve;
    });
  }

  async act(input: AgentTurnInput): Promise<SpeechActionOutput | VoteActionOutput> {
    const output = await this.fallback.act(input);
    this.resolveStarted();
    await this.releasePromise;
    return output;
  }

  release() {
    this.resolveRelease();
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

interface HumanView {
  gameId: string;
  status: string;
  revision: number;
  human: { playerId: string };
  players: Array<{ playerId: string; alive: boolean }>;
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

describe('Agent 公开内容自动恢复', () => {
  it('首次原词泄露秘密重生成，失败原文不进入公开事件', async () => {
    const policy = new ContentRecoveryPolicy('word-once');
    const { environment, server, view } = await startWith(policy);
    const frames = (
      await server.inject({ method: 'GET', url: `/api/games/${view.gameId}/events?after=0` })
    ).json() as { data: { frames: unknown[] } };

    expect(policy.contexts.some((context) => context?.contentRetry === 'word_leak')).toBe(true);
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
  it('模型调用期间玩家放弃时丢弃旧 revision 结果，不提交私有动作', async () => {
    const policy = new DeferredPolicy();
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
