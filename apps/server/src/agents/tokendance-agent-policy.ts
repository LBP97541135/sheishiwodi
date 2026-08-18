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
import { reasoningDisableBodyFor } from './model-reasoning.js';
import { TokendanceError, type ChatMessage, type TokendanceClient } from './tokendance-client.js';

/** 模型系统级失败（网络耗尽、始终格式错误、未配置模型）。脱敏，不含 Key/URL。 */
export type AgentSystemErrorCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'CALL_FAILED'
  | 'CALL_TIMEOUT'
  | 'NETWORK_FAILED'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'AUTH_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'REQUEST_REJECTED'
  | 'BAD_RESPONSE'
  | 'FORMAT_INVALID'
  | 'CONTENT_INVALID'
  | 'INTERNAL_ERROR';

export class AgentSystemError extends Error {
  constructor(
    readonly code: AgentSystemErrorCode,
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
  /** 是否按已知模型家族附加关闭推理链参数；通用兼容站默认关闭以减少未知字段。 */
  reasoningHints?: boolean;
  /** 按本次精确 model ID 返回专属请求参数；未配置时必须返回空对象。 */
  extraBodyForModel?: (modelId: string) => Record<string, unknown>;
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
  private readonly reasoningHints: boolean;
  private readonly extraBodyForModel: (modelId: string) => Record<string, unknown>;
  private readonly beliefHistory = new Map<string, BeliefSnapshot[]>();

  constructor(options: TokendanceAgentPolicyOptions) {
    this.client = options.client;
    this.roleModelMap = options.roleModelMap;
    this.maxSystemRetries = options.maxSystemRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 2_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.debug = options.debug ?? false;
    this.reasoningHints = options.reasoningHints ?? true;
    this.extraBodyForModel = options.extraBodyForModel ?? (() => ({}));
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

    const baseMessages = buildMessages(input, context?.contentRetry);
    // 精确 model 配置优先于可选的已知家族提示；通用 provider 默认不启用家族猜测。
    const extraBody = {
      ...(this.reasoningHints ? reasoningDisableBodyFor(modelId) : {}),
      ...this.extraBodyForModel(modelId),
    };
    let messages = baseMessages;
    let repairUsed = false;
    let systemAttempts = 0;
    let lastSystemCode: AgentSystemErrorCode = 'INTERNAL_ERROR';

    for (;;) {
      let content: string;
      const startedAt = Date.now();
      try {
        content = await this.client.chatCompletion({ modelId, messages, extraBody });
        this.logTiming(roleId, modelId, input.actionType, startedAt, repairUsed, 'ok');
      } catch (error) {
        this.logTiming(roleId, modelId, input.actionType, startedAt, repairUsed, 'fail');
        const classified = classifyClientError(error);
        lastSystemCode = classified.code;
        if (!classified.retryable) {
          throw new AgentSystemError(classified.code, roleId);
        }
        systemAttempts += 1;
        if (systemAttempts > this.maxSystemRetries) {
          throw new AgentSystemError(lastSystemCode, roleId);
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

function buildMessages(
  input: AgentTurnInput,
  contentRetry?: AgentActContext['contentRetry'],
): ChatMessage[] {
  const living = input.players.filter((player) => player.alive);
  const livingIds = living.map((player) => player.playerId);
  const isSpeech = input.actionType === 'describe' || input.actionType === 'defend';
  const beliefShape =
    `"belief": {` +
    `"opposingWordCandidates": [{"word": "字符串", "confidence": 0到1的小数, "evidence": "字符串"}], ` +
    `"playerUndercoverProbabilities": [${livingIds
      .map((id) => `{"playerId": "${id}", "probability": 概率}`)
      .join(', ')}], ` +
    `"reasoningSummary": "约50字内的推理摘要"}`;
  const outputShape = isSpeech
    ? `{${beliefShape}, "text": "你的发言，不要直接说出词语本身"}`
    : `{${beliefShape}, "targetPlayerId": "从合法目标中选择的玩家ID", "reason": "投票理由"}`;

  const actionGuide: Record<string, string> = {
    describe:
      '轮到你用一句话描述你手中的词：不能直接说出该词。' +
      '核心原则：描述要尽可能模糊，越模糊越好——只给宽泛、朦胧、可进可退的线索，绝不透露只属于你这个词的专属细节，宁可说得空泛也不要说得精确。' +
      '你可以说谎：描述不必忠于你手上的词，为了隐藏身份、误导对手，你完全可以给出与真实词不符的线索。' +
      '先借助你正在维护的信念评估自己是不是少数派（卧底）：' +
      '若你判断自己大概率是平民，就给出贴合方向、又足够模糊的线索，不要急于把异类逼出来而暴露自己的词；' +
      '若你判断自己很可能是卧底（即你的词和多数人描述的方向明显不一样），就大胆说谎、打掩护——把描述往多数人的方向靠、彻底模糊化，甚至编造一个符合多数词的线索，只要能混过去（但仍不能直接说出任何词）。' +
      '早发言且信息少时更要宽泛保守，后发言时顺着已显现的多数方向补一个模糊但能自证的细节。',
    defend:
      '你进入平票辩解环节，用一句话为自己辩解：与你此前给过的线索保持一致（不要临时改口），' +
      '并可反指一名你认为更可疑的玩家，不要直接说出词语。',
    vote:
      '轮到你投票：不要只按概率高低机械投票。请结合本轮最新发言做一次当场分析——' +
      '指出谁的描述与多数人方向存在具体矛盾、谁在回避或含糊，' +
      '把你 belief 的概率当作参考而非唯一依据，最终在合法目标中选出理由最充分的一名，并在 reason 里写清这个当场判断的依据。',
    revote:
      '进入候选重投，只能在平票候选人中选择：同样要基于候选人发言的具体矛盾做当场分析并给出理由，概率仅作参考。',
  };

  const system =
    `你正在参与中文桌游“谁是卧底”。每位玩家拿到一个词，多数人是相同的平民词，少数人（共 ${input.publicConfig.undercoverCount} 名）是与之相近但不同的卧底词。` +
    `你要在不直接说出词语的前提下，通过描述和投票找出卧底。` +
    `重要：系统不会告诉你自己拿的是多数词还是卧底词——你要通过比对大家的线索来推断自己的处境。` +
    `描述时的总原则是尽量模糊、越模糊越好，并且允许说谎：你的发言不必忠于手上的词，可以为了隐藏身份而给出不实的线索。` +
    `如果你发现自己的词与多数人描述的方向明显不一致，那你很可能就是少数派（卧底）：此时应大胆说谎、贴合多数人的方向、把描述彻底模糊化，避免暴露只属于你这个词的专属细节，而不是硬顶或抢戏；` +
    `如果你的词与多数人一致，也要保持模糊、点到为止，给出能暴露异类方向的线索即可，别精确到把词直接送给对手。` +
    `你要持续维护一套自己的信念（对每个人是否卧底的概率、对手词猜测、推理），每回合在上一版信念的基础上结合最新发言更新它，而不是每次从零重来。` +
    `保持博弈感：观察发言顺序与前后矛盾，不要机械复述别人的话；投票时也不要只看概率或随大流，要结合当场发言给出有理有据的分析。` +
    `你的表达风格：${input.personalityPrompt} ` +
    `${actionGuide[input.actionType] ?? ''} ` +
    `playerUndercoverProbabilities 必须覆盖全部存活玩家，且概率之和约等于卧底人数 ${input.publicConfig.undercoverCount}。` +
    `只输出一个 JSON 对象，不要输出多余文字或代码块标记，格式如下：\n${outputShape}`;

  const recap = renderRecap(input);
  const priorBelief = renderBeliefHistory(input);
  const positionLine = isSpeech ? speakingPosition(input) : '';
  const targetsLine =
    input.actionType === 'vote' || input.actionType === 'revote'
      ? `合法投票目标（只能从中选择）：${input.legalTargets
          .map((id) => `${displayNameOf(input, id)}(playerId=${id})`)
          .join('、')}`
      : '本回合无需选择投票目标。';

  const user =
    `游戏难度：${input.publicConfig.difficulty}，卧底人数：${input.publicConfig.undercoverCount}。\n` +
    `你的词是：「${input.actor.ownWordCard}」（严禁在发言中直接说出这个词）。\n` +
    `你的座位与身份：${input.actor.displayName}（playerId=${input.actor.playerId}）。\n` +
    `当前存活玩家：${living
      .map((player) => `${player.displayName}(playerId=${player.playerId})`)
      .join('、')}。\n` +
    `当前回合：第 ${input.roundNumber} 轮，动作类型：${input.actionType}。\n` +
    (positionLine ? `${positionLine}\n` : '') +
    `${targetsLine}\n` +
    (recap ? `本局发言回顾（按时间先后）：\n${recap}\n` : '暂无公开发言历史，你处于最早发言的位置。\n') +
    (priorBelief ? `${priorBelief}\n` : '') +
    (contentRetry === 'word_leak'
      ? '你上一次发言触发了原词泄露校验，请完全换一种不包含词牌原词的表达；不要复述上次内容。\n'
      : contentRetry === 'format'
        ? '你上一次发言不符合长度或句数限制，请重新组织为 2 至 40 个字符且最多两句；不要复述上次内容。\n'
        : '') +
    `请根据以上信息，仅返回约定的 JSON。`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** playerId → 显示名（找不到则回退截断后的 id），仅用于公开信息渲染。 */
function displayNameOf(input: AgentTurnInput, playerId: string): string {
  const player = input.players.find((entry) => entry.playerId === playerId);
  return player?.displayName ?? playerId.slice(0, 8);
}

/**
 * 把公开时间线渲染成可读回顾（仅公开可见字段：发言文本、出局、票型）。
 * 绝不引入他人词牌或阵营。取最近 40 条，保持顺序。
 */
function renderRecap(input: AgentTurnInput): string {
  const lines: string[] = [];
  for (const item of input.publicEvents.slice(-40)) {
    const payload = item.payload as Record<string, unknown>;
    if (item.type === 'speech_published') {
      const actorId = typeof payload['actorId'] === 'string' ? (payload['actorId'] as string) : '';
      const text = typeof payload['text'] === 'string' ? (payload['text'] as string) : '';
      const kind = payload['actionType'] === 'defend' ? '辩解' : '描述';
      if (text) lines.push(`· ${displayNameOf(input, actorId)}（${kind}）：${text}`);
    } else if (item.type === 'player_eliminated') {
      const pid = typeof payload['playerId'] === 'string' ? (payload['playerId'] as string) : '';
      lines.push(`—— ${displayNameOf(input, pid)} 被投票出局 ——`);
    } else if (item.type === 'votes_revealed' && Array.isArray(payload['votes'])) {
      const tally = new Map<string, number>();
      for (const vote of payload['votes'] as unknown[]) {
        if (vote && typeof vote === 'object') {
          const target = (vote as Record<string, unknown>)['targetPlayerId'];
          if (typeof target === 'string') tally.set(target, (tally.get(target) ?? 0) + 1);
        }
      }
      const summary = [...tally.entries()]
        .map(([id, count]) => `${displayNameOf(input, id)} ${count}票`)
        .join('，');
      if (summary) lines.push(`（票型：${summary}）`);
    }
  }
  return lines.join('\n');
}

/** describe/defend 时告知发言顺序位次与已发言者，帮助模型按位置调整策略。 */
function speakingPosition(input: AgentTurnInput): string {
  const spokenThisRound = input.publicEvents.filter(
    (item) => item.type === 'speech_published' && item.payload['actionType'] === 'describe',
  );
  const priorSpeakers = spokenThisRound
    .map((item) => (typeof item.payload['actorId'] === 'string' ? (item.payload['actorId'] as string) : ''))
    .filter((id) => id && id !== input.actor.playerId)
    .map((id) => displayNameOf(input, id));
  const aliveCount = input.players.filter((player) => player.alive).length;
  const position = priorSpeakers.length + 1;
  if (input.actionType !== 'describe') {
    return '你正在为自己辩解，保持线索前后一致。';
  }
  if (priorSpeakers.length === 0) {
    return `你是本轮第 1/${aliveCount} 位发言，信息最少，宜给出宽泛、可进可退的线索，别过早暴露专属细节。`;
  }
  return `你是本轮第 ${position}/${aliveCount} 位发言；前面已发言：${priorSpeakers.join('、')}。请结合他们的方向再决定你的措辞。`;
}

/**
 * 注入模型自己的完整信念历史（持续维护）：先给跨轮怀疑轨迹，再给最新一版的完整信念
 * （全体存活玩家概率 + 对手词候选 + 推理要点），供模型在其上增量更新而非从零重来。
 * 为空则返回空串（首回合首行动）。仅涉及模型自身私有信念，不含他人词牌或阵营。
 */
function renderBeliefHistory(input: AgentTurnInput): string {
  const history = input.priorOwnBeliefs;
  const latest = history.at(-1);
  if (!latest) return '';

  const parts: string[] = ['【你自己的信念（请在此基础上更新，勿从零重来，也勿机械照抄）】'];

  if (history.length > 1) {
    const trajectory = history
      .map((snapshot, index) => {
        const top = [...snapshot.playerUndercoverProbabilities].sort(
          (a, b) => b.probability - a.probability,
        )[0];
        const who = top ? displayNameOf(input, top.playerId) : '未定';
        return `第${index + 1}次→${who}`;
      })
      .join('；');
    parts.push(`· 怀疑轨迹：${trajectory}`);
  }

  const probs = [...latest.playerUndercoverProbabilities]
    .sort((a, b) => b.probability - a.probability)
    .map((entry) => `${displayNameOf(input, entry.playerId)} ${Math.round(entry.probability * 100)}%`)
    .join('，');
  parts.push(`· 最新卧底概率：${probs}`);

  const words = [...latest.opposingWordCandidates]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map((entry) => `「${entry.word}」(${Math.round(entry.confidence * 100)}%)`)
    .join('，');
  if (words) parts.push(`· 对手词猜测：${words}`);

  if (latest.reasoningSummary) parts.push(`· 上轮推理：${latest.reasoningSummary}`);

  return parts.join('\n');
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

  if (input.actionType === 'describe' || input.actionType === 'defend') {
    const result = speechActionOutputSchema.safeParse(parsed);
    if (!result.success) throw new AgentFormatError('SCHEMA_INVALID');
    return {
      ...result.data,
      belief: normalizeBeliefTotal(
        result.data.belief,
        livingIds,
        input.publicConfig.undercoverCount,
      ),
      text: result.data.text.trim(),
    };
  }

  const result = voteActionOutputSchema.safeParse(parsed);
  if (!result.success) throw new AgentFormatError('SCHEMA_INVALID');
  if (!input.legalTargets.includes(result.data.targetPlayerId)) {
    throw new AgentFormatError('ILLEGAL_TARGET');
  }
  return {
    ...result.data,
    belief: normalizeBeliefTotal(
      result.data.belief,
      livingIds,
      input.publicConfig.undercoverCount,
    ),
  };
}

/**
 * 只吸收模型浮点输出的极小加总残差。字段缺失、类型错误、玩家集合错误或明显概率错误
 * 必须触发格式修复，不能由服务端伪造默认信念掩盖。
 */
function normalizeBeliefTotal(
  belief: BeliefSnapshot,
  livingIds: readonly string[],
  undercoverCount: number,
): BeliefSnapshot {
  const total = belief.playerUndercoverProbabilities.reduce(
    (sum, entry) => sum + entry.probability,
    0,
  );
  const drift = undercoverCount - total;
  if (Math.abs(drift) > 0.001) throw new AgentFormatError('BELIEF_TOTAL_INVALID');
  const probabilities = belief.playerUndercoverProbabilities.map((entry) => ({ ...entry }));
  if (probabilities.length > 0 && drift !== 0) {
    const maxIndex = probabilities.reduce(
      (best, entry, index) =>
        entry.probability > probabilities[best]!.probability ? index : best,
      0,
    );
    probabilities[maxIndex]!.probability += drift;
  }
  try {
    return validateBeliefSnapshot(
      { ...belief, playerUndercoverProbabilities: probabilities },
      livingIds,
      undercoverCount,
    );
  } catch {
    throw new AgentFormatError('BELIEF_INVALID');
  }
}

function classifyClientError(error: unknown): {
  code: AgentSystemErrorCode;
  retryable: boolean;
} {
  if (!(error instanceof TokendanceError)) {
    return { code: 'INTERNAL_ERROR', retryable: false };
  }
  if (error.kind === 'timeout') return { code: 'CALL_TIMEOUT', retryable: true };
  if (error.kind === 'network') return { code: 'NETWORK_FAILED', retryable: true };
  if (error.kind === 'bad_response') return { code: 'BAD_RESPONSE', retryable: true };
  if (error.status === 401 || error.status === 403) {
    return { code: 'AUTH_FAILED', retryable: false };
  }
  if (error.status === 404) return { code: 'MODEL_NOT_FOUND', retryable: false };
  if (error.status === 429) return { code: 'RATE_LIMITED', retryable: true };
  if (error.status !== undefined && error.status >= 500) {
    return { code: 'PROVIDER_UNAVAILABLE', retryable: true };
  }
  return { code: 'REQUEST_REJECTED', retryable: false };
}
