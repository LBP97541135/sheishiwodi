import { describe, expect, it } from 'vitest';

import type {
  AgentObservability,
  AttemptHandle,
  ModelAttemptKind,
} from './agent-observability.js';
import type { ReviewInput } from './review-policy.js';
import { TokendanceReviewPolicy } from './review-agent-policy.js';
import type { ChatMessage, TokendanceClient } from './tokendance-client.js';

class CapturingClient {
  calls: ChatMessage[][] = [];
  extraBodies: Array<Record<string, unknown> | undefined> = [];

  async chatCompletion(params: {
    messages: ChatMessage[];
    extraBody?: Record<string, unknown>;
  }): Promise<string> {
    this.calls.push(params.messages);
    this.extraBodies.push(params.extraBody);
    return JSON.stringify({
      perAgent: ['agent-1', 'agent-2', 'agent-3'].map((playerId) => ({
        playerId,
        verdict: '判断能跟随公开证据更新，投票方向与怀疑保持一致；应进一步压缩描述范围，减少暴露自身词牌特征的风险。'.padEnd(60, '。'),
        keyMoments: ['第1轮｜依据发言调整怀疑 → 投票命中'],
        rating: 4,
      })),
      overall: '平民通过第一轮描述差异快速形成交叉验证，统一投票成为胜负手；关键转折是卧底没有及时修正过度宽泛的表达，若其第二次发言能贴近公共语义，局势仍有机会延后。'.padEnd(100, '。'),
    });
  }
}

class ScriptedReviewClient {
  calls: ChatMessage[][] = [];

  constructor(private readonly replies: string[]) {}

  async chatCompletion(params: { messages: ChatMessage[] }): Promise<string> {
    this.calls.push(params.messages);
    return this.replies[this.calls.length - 1] ?? '';
  }
}

class CapturingObservability implements AgentObservability {
  readonly reviewAttempts: Array<{
    commandId: string;
    actionId: string;
    modelId: string;
    attemptKind: ModelAttemptKind;
  }> = [];
  readonly results: string[] = [];
  readonly stages: string[] = [];

  beginPlayerAttempt(): AttemptHandle {
    throw new Error('Unexpected player attempt');
  }

  beginReviewAttempt(input: {
    commandId: string;
    actionId: string;
    modelId: string;
    attemptKind: ModelAttemptKind;
  }): AttemptHandle {
    this.reviewAttempts.push({
      commandId: input.commandId,
      actionId: input.actionId,
      modelId: input.modelId,
      attemptKind: input.attemptKind,
    });
    return { attemptId: `review-attempt-${this.reviewAttempts.length}`, startedAtMs: 0 };
  }

  finishAttempt(_handle: AttemptHandle, resultCode: string): void {
    this.results.push(resultCode);
  }

  markAttemptStage(_attemptId: string, stage: string): void {
    this.stages.push(stage);
  }
}

const input: ReviewInput = {
  gameId: 'game-review-prompt',
  winnerCamp: 'civilian',
  endReason: 'undercover_eliminated',
  reveal: {
    wordPair: { civilianWord: '牛奶', undercoverWord: '豆浆', category: '饮品' },
    players: [
      { playerId: 'human-1', seatIndex: 0, camp: 'civilian', wordCard: '牛奶' },
      { playerId: 'agent-1', seatIndex: 1, camp: 'undercover', wordCard: '豆浆' },
      { playerId: 'agent-2', seatIndex: 2, camp: 'civilian', wordCard: '牛奶' },
      { playerId: 'agent-3', seatIndex: 3, camp: 'civilian', wordCard: '牛奶' },
    ],
  },
  players: [
    { playerId: 'human-1', displayName: '玩家', kind: 'human' },
    { playerId: 'agent-1', displayName: 'DeepSeek', kind: 'agent' },
    { playerId: 'agent-2', displayName: '豆包', kind: 'agent' },
    { playerId: 'agent-3', displayName: '千问', kind: 'agent' },
  ],
  publicTimeline: [],
  factReview: { agentActions: [] },
};

describe('TokendanceReviewPolicy prompt', () => {
  it('要求评价结论先行、证据聚焦，并使用统一评分锚点', async () => {
    const client = new CapturingClient();
    const policy = new TokendanceReviewPolicy({
      client: client as unknown as TokendanceClient,
      modelId: 'review-model',
    });

    const result = await policy.generate(input);
    const system = client.calls[0]?.find((message) => message.role === 'system')?.content ?? '';

    expect(result.perAgent).toHaveLength(3);
    expect(system).toContain('结论先行');
    expect(system).toContain('60～100 个中文字符');
    expect(system).toContain('最关键的 1～2 条');
    expect(system).toContain('100～160 个中文字符');
    expect(system).toContain('每条不超过 50 个中文字符');
    expect(system).toContain('不得因最终胜负倒推表现');
    expect(system).toContain('不得只按所属阵营输赢评分');
    expect(system).toContain('5=持续准确且行动决定胜负');
    expect(system).not.toContain('600字内');
    expect(system).not.toContain('2000字内');
  });

  it('通用兼容 provider 按评测 model ID 注入独立参数', async () => {
    const client = new CapturingClient();
    const policy = new TokendanceReviewPolicy({
      client: client as unknown as TokendanceClient,
      modelId: 'qwen-compatible-review',
      reasoningHints: false,
      extraBodyForModel: (modelId) =>
        modelId === 'qwen-compatible-review' ? { enable_thinking: false } : {},
    });

    await policy.generate(input);
    expect(client.extraBodies[0]).toEqual({ enable_thinking: false });
  });

  it('重复 perAgent.playerId 触发格式修复而不是冒充完整覆盖', async () => {
    const duplicate = JSON.stringify({
      perAgent: [
        { playerId: 'agent-1', verdict: '重'.repeat(60), keyMoments: ['第一轮'], rating: 3 },
        { playerId: 'agent-2', verdict: '常'.repeat(60), keyMoments: ['第一轮'], rating: 3 },
        { playerId: 'agent-3', verdict: '正'.repeat(60), keyMoments: ['第一轮'], rating: 3 },
        { playerId: 'agent-3', verdict: '复'.repeat(60), keyMoments: ['第二轮'], rating: 3 },
      ],
      overall: '总'.repeat(100),
    });
    const valid = await new CapturingClient().chatCompletion({ messages: [] });
    const client = new ScriptedReviewClient([duplicate, valid]);
    const observability = new CapturingObservability();
    const policy = new TokendanceReviewPolicy({
      client: client as unknown as TokendanceClient,
      modelId: 'review-model',
      observability,
    });

    const result = await policy.generate(input);

    expect(client.calls).toHaveLength(2);
    expect(result.perAgent).toHaveLength(3);
    expect(observability.results).toEqual(['invalid_format', 'schema_validated']);
    expect(observability.stages).toEqual([
      'provider_returned',
      'provider_returned',
      'schema_validated',
    ]);
  });

  it('将复盘调用关联到命令、动作和独立 attempt', async () => {
    const client = new CapturingClient();
    const observability = new CapturingObservability();
    const policy = new TokendanceReviewPolicy({
      client: client as unknown as TokendanceClient,
      modelId: 'review-model',
      observability,
    });

    await policy.generate(input, {
      commandId: 'review/game-review-prompt',
      actionId: 'review/game-review-prompt',
    });

    expect(observability.reviewAttempts).toEqual([
      {
        commandId: 'review/game-review-prompt',
        actionId: 'review/game-review-prompt',
        modelId: 'review-model',
        attemptKind: 'initial',
      },
    ]);
    expect(observability.results).toEqual(['schema_validated']);
    expect(observability.stages).toEqual(['provider_returned', 'schema_validated']);
  });
});
