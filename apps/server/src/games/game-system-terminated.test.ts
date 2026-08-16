import { describe, expect, it } from 'vitest';

import type {
  AgentTurnInput,
  BeliefSnapshot,
  SpeechActionOutput,
  VoteActionOutput,
} from '@sheishiwodi/shared';

import { FakeAgentPolicy } from '../agents/fake-agent-policy.js';
import type { AgentPolicy } from '../agents/agent-policy.js';
import { AgentSystemError } from '../agents/tokendance-agent-policy.js';
import { buildServer } from '../server.js';
import { createTestEnvironment } from '../test-environment.js';

interface HumanView {
  gameId: string;
  status: string;
  phase: string;
  revision: number;
  human: { playerId: string };
  winnerCamp?: string;
  endReason?: string;
  reveal?: unknown;
  factReview?: unknown;
  allowedCommands: string[];
  operationalStatus: { state: string };
}

/** 首个 AI 动作即抛出系统级错误（模拟真实策略耗尽重试后的失败）。 */
class SystemErrorPolicy implements AgentPolicy {
  private readonly fallback = new FakeAgentPolicy();

  async act(input: AgentTurnInput): Promise<SpeechActionOutput | VoteActionOutput> {
    void input;
    throw new AgentSystemError('CALL_FAILED', 'deepseek');
  }

  priorBeliefs(playerId: string): readonly BeliefSnapshot[] {
    return this.fallback.priorBeliefs(playerId);
  }
}

const createGame = async (server: ReturnType<typeof buildServer>) => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/games',
    payload: {
      commandId: 'create-terminate',
      human: { displayName: '小祎', silhouette: 'silhouette_a' },
      difficulty: 'easy',
    },
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { data: HumanView }).data;
};

describe('模型系统错误兜底终止（DEC-072）', () => {
  it('AI 动作抛出系统错误时对局进入 system_terminated 而非崩溃', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const server = buildServer({
      ...environment.dependencies,
      agentPolicyFactory: () => new SystemErrorPolicy(),
    });
    const created = await createGame(server);

    const start = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/start`,
      payload: {
        commandId: 'start-terminate',
        actorId: created.human.playerId,
        expectedRevision: created.revision,
      },
    });
    // 兜底成功：不再抛未捕获异常导致 500。
    expect(start.statusCode).toBe(200);
    const view = (start.json() as { data: HumanView }).data;

    expect(view.status).toBe('system_terminated');
    expect(view.phase).toBe('ended');
    expect(view.endReason).toBe('model_failure_limit');
    // 非正常终局：不揭晓阵营、词牌、胜方、复盘。
    expect(view.winnerCamp).toBeUndefined();
    expect(view.reveal).toBeUndefined();
    expect(view.factReview).toBeUndefined();
    expect(view.allowedCommands).toEqual([]);
    expect(view.operationalStatus.state).toBe('idle');

    // 公开事件流包含系统终止事件，但脱敏（无 Key/URL/headers）。
    const events = (
      await server.inject({ method: 'GET', url: `/api/games/${created.gameId}/events?after=0` })
    ).json() as { data: { frames: Array<{ type: string; payload: Record<string, unknown> }> } };
    const terminated = events.data.frames.find((frame) => frame.type === 'game_system_terminated');
    expect(terminated).toBeDefined();
    expect(terminated?.payload.errorType).toBe('CALL_FAILED');
    const serialized = JSON.stringify(events.data);
    expect(serialized).not.toContain('tokendance.space');
    expect(serialized).not.toContain('gateway/v1');
    expect(serialized.toLowerCase()).not.toContain('authorization');
    expect(serialized).not.toContain('Bearer');

    await server.close();
    environment.cleanup();
  });
});
