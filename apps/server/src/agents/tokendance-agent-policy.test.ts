import { describe, expect, it } from 'vitest';

import {
  createPreparingGame,
  startPreparingGame,
  validateBeliefSnapshot,
  type AgentTurnInput,
  type Clock,
  type IdSource,
  type RandomSource,
  type WordPair,
} from '@sheishiwodi/shared';

import { projectAgentTurnInput } from './agent-input-projector.js';
import { AgentSystemError, TokendanceAgentPolicy } from './tokendance-agent-policy.js';
import type { ChatMessage, TokendanceClient } from './tokendance-client.js';

class Ids implements IdSource {
  private value = 0;
  nextId(kind: 'game' | 'player' | 'event') {
    this.value += 1;
    return `${kind}-${this.value}`;
  }
}

const clock: Clock = { now: () => '2026-08-16T12:00:00.000Z' };
const random: RandomSource = { next: () => 0 };
const pair: WordPair = {
  id: 'pair',
  civilianWord: '牛奶',
  undercoverWord: '豆浆',
  category: '饮品',
  difficulty: 'easy',
  enabled: true,
};

function describeInput(): { input: AgentTurnInput; roleId: string } {
  const ids = new Ids();
  const created = createPreparingGame(
    {
      type: 'CreateGame',
      commandId: 'create',
      human: { displayName: '玩家', silhouette: 'silhouette_a' },
      difficulty: 'easy',
    },
    [pair],
    { ids, clock, random },
  );
  const started = startPreparingGame(
    created.snapshot,
    {
      type: 'StartGame',
      commandId: 'start',
      gameId: created.snapshot.gameId,
      actorId: created.snapshot.humanPlayerId,
      expectedRevision: 0,
    },
    { ids, clock },
  );
  const agent = started.snapshot.players.find((player) => player.kind === 'agent')!;
  const snapshot = {
    ...started.snapshot,
    round: { ...started.snapshot.round!, currentActorId: agent.playerId },
  };
  const input = projectAgentTurnInput(snapshot, agent.playerId, [], []);
  return { input, roleId: agent.agentRoleId ?? agent.playerId };
}

/** 可编排逐次响应的假客户端，记录收到的 messages 以便断言重试。 */
class ScriptedClient {
  calls: ChatMessage[][] = [];
  constructor(private readonly replies: Array<string | Error>) {}
  async listModels(): Promise<string[]> {
    return [];
  }
  async chatCompletion(params: { modelId: string; messages: ChatMessage[] }): Promise<string> {
    this.calls.push(params.messages);
    const reply = this.replies[this.calls.length - 1];
    if (reply === undefined) throw new Error('脚本用尽');
    if (reply instanceof Error) throw reply;
    return reply;
  }
}

const asClient = (client: ScriptedClient) => client as unknown as TokendanceClient;
const noWait = async () => {};

function speechReply(livingIds: string[], text: string): string {
  const probabilities = livingIds.map((id, index) => ({
    playerId: id,
    probability: index === 0 ? 1 : 0,
  }));
  return JSON.stringify({
    belief: {
      opposingWordCandidates: [{ word: '豆浆', confidence: 0.6, evidence: '偏甜的饮品' }],
      playerUndercoverProbabilities: probabilities,
      reasoningSummary: '暂无强证据',
    },
    text,
  });
}

describe('TokendanceAgentPolicy', () => {
  it('未配置该角色模型时抛系统错误', async () => {
    const { input } = describeInput();
    const policy = new TokendanceAgentPolicy({
      client: asClient(new ScriptedClient([])),
      roleModelMap: {},
      sleep: noWait,
    });
    await expect(policy.act(input, { agentRoleId: 'deepseek' })).rejects.toBeInstanceOf(
      AgentSystemError,
    );
  });

  it('正常返回合法描述并规整信念（概率之和等于卧底人数）', async () => {
    const { input, roleId } = describeInput();
    const livingIds = input.players.filter((player) => player.alive).map((player) => player.playerId);
    const client = new ScriptedClient([speechReply(livingIds, '一种早餐常见的白色饮品')]);
    const policy = new TokendanceAgentPolicy({
      client: asClient(client),
      roleModelMap: { [roleId]: 'model-x' },
      sleep: noWait,
    });

    const output = await policy.act(input, { agentRoleId: roleId });

    expect(output).toHaveProperty('text', '一种早餐常见的白色饮品');
    // 复核信念满足领域不变量（不抛错即合法）。
    expect(() =>
      validateBeliefSnapshot(output.belief, livingIds, input.publicConfig.undercoverCount),
    ).not.toThrow();
    expect(policy.priorBeliefs(input.actor.playerId)).toHaveLength(1);
  });

  it('首个非法响应触发一次格式修复重试后成功', async () => {
    const { input, roleId } = describeInput();
    const livingIds = input.players.filter((player) => player.alive).map((player) => player.playerId);
    const client = new ScriptedClient([
      '这不是 JSON',
      speechReply(livingIds, '修复后的合法发言'),
    ]);
    const policy = new TokendanceAgentPolicy({
      client: asClient(client),
      roleModelMap: { [roleId]: 'model-x' },
      sleep: noWait,
    });

    const output = await policy.act(input, { agentRoleId: roleId });
    expect(output).toHaveProperty('text', '修复后的合法发言');
    expect(client.calls).toHaveLength(2);
    // 第二次调用带上了修复指令。
    expect(JSON.stringify(client.calls[1])).toContain('只返回一个 JSON');
  });

  it('系统级调用持续失败时耗尽重试并抛系统错误', async () => {
    const { input, roleId } = describeInput();
    const failure = new Error('boom');
    const client = new ScriptedClient([failure, failure, failure, failure, failure]);
    const policy = new TokendanceAgentPolicy({
      client: asClient(client),
      roleModelMap: { [roleId]: 'model-x' },
      maxSystemRetries: 3,
      sleep: noWait,
    });

    await expect(policy.act(input, { agentRoleId: roleId })).rejects.toBeInstanceOf(AgentSystemError);
    // 初次 + 3 次系统重试 = 4 次调用。
    expect(client.calls).toHaveLength(4);
  });
});
