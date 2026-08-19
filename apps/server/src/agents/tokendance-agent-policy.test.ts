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
import { ProviderCircuitBreaker } from './provider-circuit-breaker.js';
import { AgentSystemError, TokendanceAgentPolicy } from './tokendance-agent-policy.js';
import { TokendanceError, type ChatMessage, type TokendanceClient } from './tokendance-client.js';

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

/** 可编排逐次响应的假客户端，记录收到的 messages 与 extraBody 以便断言重试与关推理参数。 */
class ScriptedClient {
  calls: ChatMessage[][] = [];
  extraBodies: Array<Record<string, unknown> | undefined> = [];
  constructor(private readonly replies: Array<string | Error>) {}
  async listModels(): Promise<string[]> {
    return [];
  }
  async chatCompletion(params: {
    modelId: string;
    messages: ChatMessage[];
    extraBody?: Record<string, unknown>;
  }): Promise<string> {
    this.calls.push(params.messages);
    this.extraBodies.push(params.extraBody);
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

function voteReply(livingIds: string[], targetPlayerId: string, reason = '该玩家的描述与多数方向不一致'): string {
  const probabilities = livingIds.map((id, index) => ({
    playerId: id,
    probability: index === 0 ? 1 : 0,
  }));
  return JSON.stringify({
    belief: {
      opposingWordCandidates: [{ word: '豆浆', confidence: 0.6, evidence: '偏甜的饮品' }],
      playerUndercoverProbabilities: probabilities,
      reasoningSummary: '结合本轮公开发言更新怀疑',
    },
    targetPlayerId,
    reason,
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

  it('按模型家族下发关闭推理参数：千问用 enable_thinking，豆包/ds 用 thinking.disabled', async () => {
    const cases: Array<{ modelId: string; expected: Record<string, unknown> }> = [
      { modelId: 'qwen3.7-plus', expected: { enable_thinking: false } },
      { modelId: 'seed-2.1-turbo', expected: { thinking: { type: 'disabled' } } },
      { modelId: 'deepseek-v4-flash-0731', expected: { thinking: { type: 'disabled' } } },
      { modelId: 'gpt-4o-mini', expected: {} },
    ];
    for (const { modelId, expected } of cases) {
      const { input, roleId } = describeInput();
      const livingIds = input.players
        .filter((player) => player.alive)
        .map((player) => player.playerId);
      const client = new ScriptedClient([speechReply(livingIds, '一句合法描述')]);
      const policy = new TokendanceAgentPolicy({
        client: asClient(client),
        roleModelMap: { [roleId]: modelId },
        sleep: noWait,
      });
      await policy.act(input, { agentRoleId: roleId });
      expect(client.extraBodies[0]).toEqual(expected);
    }
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
    const failure = new TokendanceError('network');
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

  it('猜词模式只接受合法目标的严格猜词动作，并明确一次性风险与自身阵营', async () => {
    const base = describeInput();
    const targetPlayerId = base.input.players.find((player) => player.playerId !== base.input.actor.playerId)!.playerId;
    const input: AgentTurnInput = {
      ...base.input,
      publicConfig: { ...base.input.publicConfig, gameMode: 'guess' },
      guessAvailable: true,
      legalTargets: [targetPlayerId],
    };
    const livingIds = input.players.filter((player) => player.alive).map((player) => player.playerId);
    const probabilities = livingIds.map((playerId, index) => ({ playerId, probability: index === 0 ? 1 : 0 }));
    const client = new ScriptedClient([JSON.stringify({
      belief: {
        opposingWordCandidates: [{ word: '豆浆', confidence: 0.8, evidence: '公开描述方向' }],
        playerUndercoverProbabilities: probabilities,
        reasoningSummary: '基于公开内容进行高风险猜测',
      },
      action: 'guess', targetPlayerId, guessedWord: ' 豆浆 ', reason: '目标线索与己方阵营不一致',
    })]);
    const policy = new TokendanceAgentPolicy({
      client: asClient(client), roleModelMap: { [base.roleId]: 'model-x' }, sleep: noWait,
    });

    const output = await policy.act(input, { agentRoleId: base.roleId });
    expect(output).toMatchObject({ action: 'guess', targetPlayerId, guessedWord: '豆浆' });
    const prompt = client.calls[0]!.map((message) => message.content).join('\n');
    expect(prompt).toContain('每局仅一次');
    expect(prompt).toContain('同一冻结快照');
    expect(prompt).toContain(`你的阵营：${input.actor.ownCamp === 'undercover' ? '卧底' : '平民'}`);
  });

  it('认证与模型不存在属于永久错误，不执行无意义重试', async () => {
    for (const status of [401, 403, 404]) {
      const { input, roleId } = describeInput();
      const client = new ScriptedClient([new TokendanceError('http', status)]);
      const policy = new TokendanceAgentPolicy({
        client: asClient(client),
        roleModelMap: { [roleId]: 'model-x' },
        maxSystemRetries: 3,
        sleep: noWait,
      });

      await expect(policy.act(input, { agentRoleId: roleId })).rejects.toMatchObject({
        code: status === 404 ? 'MODEL_NOT_FOUND' : 'AUTH_FAILED',
      });
      expect(client.calls).toHaveLength(1);
    }
  });

  it('永久错误打开断路器后，下一次逻辑调用在出网前失败', async () => {
    const { input, roleId } = describeInput();
    const client = new ScriptedClient([new TokendanceError('http', 401)]);
    const circuitBreaker = new ProviderCircuitBreaker();
    const policy = new TokendanceAgentPolicy({
      client: asClient(client),
      roleModelMap: { [roleId]: 'model-x' },
      circuitBreaker,
      sleep: noWait,
    });

    await expect(policy.act(input, { agentRoleId: roleId })).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
    await expect(policy.act(input, { agentRoleId: roleId })).rejects.toMatchObject({
      code: 'CIRCUIT_OPEN',
    });
    expect(client.calls).toHaveLength(1);
  });

  it('通用兼容 provider 只按精确 model ID 注入专属参数', async () => {
    const { input, roleId } = describeInput();
    const livingIds = input.players.filter((player) => player.alive).map((player) => player.playerId);
    const client = new ScriptedClient([speechReply(livingIds, '一句合法描述')]);
    const policy = new TokendanceAgentPolicy({
      client: asClient(client),
      roleModelMap: { [roleId]: 'qwen-compatible-alias' },
      sleep: noWait,
      reasoningHints: false,
      extraBodyForModel: (modelId) =>
        modelId === 'qwen-compatible-alias'
          ? { enable_thinking: false, temperature: 0 }
          : { unexpected: true },
    });

    await policy.act(input, { agentRoleId: roleId });
    expect(client.extraBodies[0]).toEqual({ enable_thinking: false, temperature: 0 });
  });

  it('超时、限流、服务异常和空响应按预算重试并保留最终分类', async () => {
    const cases = [
      { error: new TokendanceError('timeout'), code: 'CALL_TIMEOUT' },
      { error: new TokendanceError('http', 429), code: 'RATE_LIMITED' },
      { error: new TokendanceError('http', 503), code: 'PROVIDER_UNAVAILABLE' },
      { error: new TokendanceError('bad_response'), code: 'BAD_RESPONSE' },
    ] as const;
    for (const { error, code } of cases) {
      const { input, roleId } = describeInput();
      const client = new ScriptedClient([error, error]);
      const policy = new TokendanceAgentPolicy({
        client: asClient(client),
        roleModelMap: { [roleId]: 'model-x' },
        maxSystemRetries: 1,
        sleep: noWait,
      });

      await expect(policy.act(input, { agentRoleId: roleId })).rejects.toMatchObject({ code });
      expect(client.calls).toHaveLength(2);
    }
  });

  it('字段缺失不能由默认发言或伪造信念掩盖，必须触发格式修复', async () => {
    const { input, roleId } = describeInput();
    const livingIds = input.players.filter((player) => player.alive).map((player) => player.playerId);
    const client = new ScriptedClient([
      JSON.stringify({ text: '' }),
      speechReply(livingIds, '修复字段后的合法发言'),
    ]);
    const policy = new TokendanceAgentPolicy({
      client: asClient(client),
      roleModelMap: { [roleId]: 'model-x' },
      sleep: noWait,
    });

    const output = await policy.act(input, { agentRoleId: roleId });
    expect(output).toHaveProperty('text', '修复字段后的合法发言');
    expect(client.calls).toHaveLength(2);
    expect(JSON.stringify(client.calls[1])).toContain('只返回一个 JSON');
  });

  it('Schema 失败把脱敏字段原因与完整投票约束带入格式修复', async () => {
    const { input: describe, roleId } = describeInput();
    const livingIds = describe.players.filter((player) => player.alive).map((player) => player.playerId);
    const legalTargets = livingIds.filter((playerId) => playerId !== describe.actor.playerId);
    const input: AgentTurnInput = {
      ...describe,
      actionType: 'vote',
      legalTargets,
    };
    const client = new ScriptedClient([
      voteReply(livingIds, legalTargets[0]!, '理'.repeat(201)),
      voteReply(livingIds, legalTargets[0]!),
    ]);
    const policy = new TokendanceAgentPolicy({
      client: asClient(client),
      roleModelMap: { [roleId]: 'model-x' },
      sleep: noWait,
    });

    await expect(policy.act(input, { agentRoleId: roleId })).resolves.toHaveProperty(
      'targetPlayerId',
      legalTargets[0],
    );
    const repair = client.calls[1]?.at(-1)?.content ?? '';
    expect(repair).toContain('SCHEMA_INVALID:reason:too_big');
    expect(repair).toContain('顶层必须且只能包含 belief、targetPlayerId、reason');
    expect(repair).toContain('reason 是 1 至 200 字符');
    expect(repair).toContain('这些 playerId 必须各出现一次且不能重复');
    expect(repair).not.toContain('理'.repeat(201));
  });

  it('概率超过 1 进入 Schema 格式修复而不是被静默接受', async () => {
    const { input, roleId } = describeInput();
    const livingIds = input.players.filter((player) => player.alive).map((player) => player.playerId);
    const invalid = JSON.parse(speechReply(livingIds, '一句合法描述')) as {
      belief: { playerUndercoverProbabilities: Array<{ probability: number }> };
    };
    invalid.belief.playerUndercoverProbabilities[0]!.probability = 1.1;
    const client = new ScriptedClient([
      JSON.stringify(invalid),
      speechReply(livingIds, '修复后的合法描述'),
    ]);
    const policy = new TokendanceAgentPolicy({
      client: asClient(client),
      roleModelMap: { [roleId]: 'model-x' },
      sleep: noWait,
    });

    await expect(policy.act(input, { agentRoleId: roleId })).resolves.toHaveProperty(
      'text',
      '修复后的合法描述',
    );
    expect(client.calls[1]?.at(-1)?.content).toContain(
      'belief.playerUndercoverProbabilities.item.probability:too_big',
    );
  });
});
