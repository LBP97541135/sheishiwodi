import {
  speechActionOutputSchema,
  validateBeliefSnapshot,
  voteActionOutputSchema,
  type AgentTurnInput,
  type BeliefSnapshot,
  type SpeechActionOutput,
  type VoteActionOutput,
} from '@sheishiwodi/shared';

import type { AgentActContext, AgentPolicy } from './agent-policy.js';
import type { ChatMessage, TokendanceClient } from './tokendance-client.js';

/** 模型系统级失败（网络耗尽、始终格式错误、未配置模型）。脱敏，不含 Key/URL。 */
export class AgentSystemError extends Error {
  constructor(
    readonly code: string,
    readonly roleId?: string,
  ) {
    super(`AGENT_SYSTEM_${code}`);
    this.name = 'AgentSystemError';
  }
}

class AgentFormatError extends Error {}

export interface TokendanceAgentPolicyOptions {
  client: TokendanceClient;
  roleModelMap: Readonly<Record<string, string>>;
  maxSystemRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 开启后打印脱敏计时日志（角色/model/耗时/是否修复重试），绝不含 Key/URL/响应正文。 */
  debug?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class TokendanceAgentPolicy implements AgentPolicy {
  private readonly client: TokendanceClient;
  private readonly roleModelMap: Readonly<Record<string, string>>;
  private readonly maxSystemRetries: number;
  private readonly retryDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly debug: boolean;
  private readonly beliefHistory = new Map<string, BeliefSnapshot[]>();

  constructor(options: TokendanceAgentPolicyOptions) {
    this.client = options.client;
    this.roleModelMap = options.roleModelMap;
    this.maxSystemRetries = options.maxSystemRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 2_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.debug = options.debug ?? false;
  }

  priorBeliefs(playerId: string): readonly BeliefSnapshot[] {
    return this.beliefHistory.get(playerId) ?? [];
  }

  async act(
    input: AgentTurnInput,
    context?: AgentActContext,
  ): Promise<SpeechActionOutput | VoteActionOutput> {
    const roleId = context?.agentRoleId ?? '';
    const modelId = this.roleModelMap[roleId];
    if (!modelId) {
      throw new AgentSystemError('MODEL_NOT_CONFIGURED', roleId);
    }

    const baseMessages = buildMessages(input);
    let messages = baseMessages;
    let repairUsed = false;
    let systemAttempts = 0;

    for (;;) {
      let content: string;
      const startedAt = Date.now();
      try {
        content = await this.client.chatCompletion({ modelId, messages });
        this.logTiming(roleId, modelId, input.actionType, startedAt, repairUsed, 'ok');
      } catch {
        this.logTiming(roleId, modelId, input.actionType, startedAt, repairUsed, 'fail');
        systemAttempts += 1;
        if (systemAttempts > this.maxSystemRetries) {
          throw new AgentSystemError('CALL_FAILED', roleId);
        }
        await this.sleep(this.retryDelayMs);
        messages = baseMessages;
        repairUsed = false;
        continue;
      }

      try {
        const output = buildOutput(extractJson(content), input);
        this.record(input.actor.playerId, output.belief);
        return output;
      } catch (error) {
        if (!(error instanceof AgentFormatError)) throw error;
        if (!repairUsed) {
          repairUsed = true;
          messages = [
            ...baseMessages,
            { role: 'assistant', content },
            { role: 'user', content: repairInstruction(input) },
          ];
          continue;
        }
        systemAttempts += 1;
        if (systemAttempts > this.maxSystemRetries) {
          throw new AgentSystemError('FORMAT_INVALID', roleId);
        }
        await this.sleep(this.retryDelayMs);
        messages = baseMessages;
        repairUsed = false;
      }
    }
  }

  private record(playerId: string, belief: BeliefSnapshot) {
    this.beliefHistory.set(playerId, [...(this.beliefHistory.get(playerId) ?? []), belief]);
  }

  /** 仅打印脱敏计时（角色/model/动作/耗时/是否修复往返/结果），绝不含 Key/URL/响应正文。 */
  private logTiming(
    roleId: string,
    modelId: string,
    actionType: string,
    startedAt: number,
    repairUsed: boolean,
    result: 'ok' | 'fail',
  ) {
    if (!this.debug) return;
    const elapsed = Date.now() - startedAt;
    console.info(
      `[agent] role=${roleId} model=${modelId} action=${actionType} repair=${repairUsed} ${result} ${elapsed}ms`,
    );
  }
}

function livingIdsOf(input: AgentTurnInput): string[] {
  return input.players.filter((player) => player.alive).map((player) => player.playerId);
}

function buildMessages(input: AgentTurnInput): ChatMessage[] {
  const living = input.players.filter((player) => player.alive);
  const livingIds = living.map((player) => player.playerId);
  const isSpeech = input.actionType === 'describe' || input.actionType === 'defend';
  const beliefShape =
    `"belief": {` +
    `"opposingWordCandidates": [{"word": "字符串", "confidence": 0到1的小数, "evidence": "字符串"}], ` +
    `"playerUndercoverProbabilities": [${livingIds
      .map((id) => `{"playerId": "${id}", "probability": 概率}`)
      .join(', ')}], ` +
    `"reasoningSummary": "不超过300字的推理摘要"}`;
  const outputShape = isSpeech
    ? `{${beliefShape}, "text": "你的发言，不要直接说出词语本身"}`
    : `{${beliefShape}, "targetPlayerId": "从合法目标中选择的玩家ID", "reason": "投票理由"}`;

  const actionGuide: Record<string, string> = {
    describe: '轮到你用一句话描述你手中的词，不能直接说出该词，也不要暴露自己是不是卧底。',
    defend: '你进入平票辩解环节，用一句话为自己辩解，保持线索一致，不要直接说出词语。',
    vote: '轮到你投票，选出你最怀疑是卧底的一名玩家。',
    revote: '进入候选重投，只能在平票候选人中选择你最怀疑的一名。',
  };

  const system =
    `你正在参与中文桌游“谁是卧底”。每位玩家拿到一个词，多数是平民词，一名是卧底词，两词相近但不同。` +
    `你要在不暴露词语的前提下通过描述和投票找出卧底（若你是卧底则尽量隐藏）。` +
    `你的表达风格：${input.personalityPrompt} ` +
    `${actionGuide[input.actionType] ?? ''} ` +
    `playerUndercoverProbabilities 必须覆盖全部存活玩家，且概率之和约等于卧底人数 ${input.publicConfig.undercoverCount}。` +
    `只输出一个 JSON 对象，不要输出多余文字或代码块标记，格式如下：\n${outputShape}`;

  const historyLines = input.publicEvents
    .map((item) => JSON.stringify(item))
    .slice(-40)
    .join('\n');
  const targetsLine =
    input.actionType === 'vote' || input.actionType === 'revote'
      ? `合法投票目标（只能从中选择）：${input.legalTargets.join(', ')}`
      : '本回合无需选择投票目标。';

  const user =
    `游戏难度：${input.publicConfig.difficulty}，卧底人数：${input.publicConfig.undercoverCount}。\n` +
    `你的词是：「${input.actor.ownWordCard}」（严禁在发言中直接说出这个词）。\n` +
    `你的座位与身份：${input.actor.displayName}（playerId=${input.actor.playerId}）。\n` +
    `当前存活玩家：${living
      .map((player) => `${player.displayName}(playerId=${player.playerId})`)
      .join('、')}。\n` +
    `当前回合：第 ${input.roundNumber} 轮，动作类型：${input.actionType}。\n` +
    `${targetsLine}\n` +
    (historyLines ? `已公开的时间线（JSON，逐行）：\n${historyLines}\n` : '暂无公开发言历史。\n') +
    `请根据以上信息，仅返回约定的 JSON。`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function repairInstruction(input: AgentTurnInput): string {
  const livingIds = livingIdsOf(input);
  return (
    `上一次回复不是合法的 JSON 或不满足要求。请只返回一个 JSON 对象，不要任何解释或代码块标记。` +
    `playerUndercoverProbabilities 必须且只能包含这些 playerId：${livingIds.join(', ')}，概率之和约等于 ${input.publicConfig.undercoverCount}。` +
    (input.actionType === 'vote' || input.actionType === 'revote'
      ? `targetPlayerId 必须是以下之一：${input.legalTargets.join(', ')}。`
      : '')
  );
}

function extractJson(content: string): Record<string, unknown> {
  let text = content.trim();
  // 先剥离推理型模型可能前置/包裹的思维链块，避免把 <think> 里的花括号误当成 JSON，
  // 否则会触发一次凭空的“格式修复”往返，显著拖慢每个 AI 回合。
  text = text.replace(/<(think|reasoning|thought)>[\s\S]*?<\/\1>/gi, '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) text = fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new AgentFormatError('NO_JSON');
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== 'object') throw new AgentFormatError('NOT_OBJECT');
    return parsed as Record<string, unknown>;
  } catch {
    throw new AgentFormatError('INVALID_JSON');
  }
}

function buildOutput(
  parsed: Record<string, unknown>,
  input: AgentTurnInput,
): SpeechActionOutput | VoteActionOutput {
  const livingIds = livingIdsOf(input);
  const belief = coerceBelief(parsed['belief'], livingIds, input.publicConfig.undercoverCount);

  if (input.actionType === 'describe' || input.actionType === 'defend') {
    const raw = typeof parsed['text'] === 'string' ? (parsed['text'] as string).trim() : '';
    const text = raw.length > 0 ? raw : '（本回合我暂时保留更多线索）';
    return speechActionOutputSchema.parse({ belief, text });
  }

  const target = typeof parsed['targetPlayerId'] === 'string' ? (parsed['targetPlayerId'] as string) : '';
  if (!input.legalTargets.includes(target)) {
    throw new AgentFormatError('ILLEGAL_TARGET');
  }
  const rawReason = typeof parsed['reason'] === 'string' ? (parsed['reason'] as string).trim() : '';
  const reason = (rawReason.length > 0 ? rawReason : '根据公开信息作出的判断').slice(0, 200);
  return voteActionOutputSchema.parse({ belief, targetPlayerId: target, reason });
}

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.2);

/**
 * 把模型给出的（可能不精确的）信念规整为满足领域不变量的合法信念：
 * 覆盖全部存活玩家、概率之和等于卧底人数、字段长度合规。
 */
function coerceBelief(
  raw: unknown,
  livingIds: readonly string[],
  undercoverCount: number,
): BeliefSnapshot {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const provided = new Map<string, number>();
  const rawProbs = Array.isArray(source['playerUndercoverProbabilities'])
    ? (source['playerUndercoverProbabilities'] as unknown[])
    : [];
  for (const entry of rawProbs) {
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const playerId = record['playerId'];
      if (typeof playerId === 'string' && livingIds.includes(playerId)) {
        const probability = Number(record['probability']);
        provided.set(playerId, Number.isFinite(probability) && probability > 0 ? probability : 0);
      }
    }
  }

  const sum = livingIds.reduce((total, id) => total + (provided.get(id) ?? 0), 0);
  const probabilities = livingIds.map((id) => {
    const base = provided.get(id) ?? 0;
    const probability = sum > 0 ? (base * undercoverCount) / sum : undercoverCount / livingIds.length;
    return { playerId: id, probability };
  });
  // 吸收缩放后的舍入残差，保证之和精确等于卧底人数。
  const total = probabilities.reduce((acc, entry) => acc + entry.probability, 0);
  const drift = undercoverCount - total;
  if (probabilities.length > 0) {
    let maxIndex = 0;
    for (let index = 1; index < probabilities.length; index += 1) {
      if (probabilities[index]!.probability > probabilities[maxIndex]!.probability) maxIndex = index;
    }
    probabilities[maxIndex]!.probability = Math.max(0, probabilities[maxIndex]!.probability + drift);
  }

  const rawCandidates = Array.isArray(source['opposingWordCandidates'])
    ? (source['opposingWordCandidates'] as unknown[])
    : [];
  const candidates = rawCandidates
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      word: String(entry['word'] ?? '').trim().slice(0, 40),
      confidence: clamp01(Number(entry['confidence'])),
      evidence:
        (typeof entry['evidence'] === 'string' && entry['evidence'].trim()
          ? entry['evidence']
          : '模型未提供依据'
        )
          .trim()
          .slice(0, 200),
    }))
    .filter((entry) => entry.word.length > 0)
    .slice(0, 6);
  if (candidates.length === 0) {
    candidates.push({ word: '未知词', confidence: 0.2, evidence: '模型未提供候选词' });
  }

  const reasoningSummary = (
    typeof source['reasoningSummary'] === 'string' && source['reasoningSummary'].trim()
      ? source['reasoningSummary']
      : '模型未提供推理摘要'
  )
    .trim()
    .slice(0, 300);

  return validateBeliefSnapshot(
    { opposingWordCandidates: candidates, playerUndercoverProbabilities: probabilities, reasoningSummary },
    livingIds,
    undercoverCount,
  );
}
