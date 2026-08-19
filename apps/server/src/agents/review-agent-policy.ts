import {
  reviewGenerationSchema,
  type PublicTimelineItem,
  type ReviewErrorCode,
  type ReviewGeneration,
} from '@sheishiwodi/shared';

import { reasoningDisableBodyFor } from './model-reasoning.js';
import {
  ContextBoundaryViolationError,
  noOpAgentObservability,
  type AgentObservability,
  type ModelAttemptKind,
} from './agent-observability.js';
import type { ReviewInput, ReviewPolicy } from './review-policy.js';
import {
  CircuitOpenError,
  noOpProviderCircuitBreaker,
  type ProviderCircuitBreakerPort,
} from './provider-circuit-breaker.js';
import { TokendanceError, type ChatMessage, type TokendanceClient } from './tokendance-client.js';

/** 复盘系统级失败（脱敏），不含 Key/URL/上游正文。 */
export class ReviewSystemError extends Error {
  constructor(readonly code: ReviewErrorCode) {
    super(`REVIEW_SYSTEM_${code}`);
    this.name = 'ReviewSystemError';
  }
}

export class ReviewRuntimeInterruptedError extends Error {
  constructor() {
    super('REVIEW_RUNTIME_INTERRUPTED');
    this.name = 'ReviewRuntimeInterruptedError';
  }
}

class ReviewFormatError extends Error {}

export interface TokendanceReviewPolicyOptions {
  client: TokendanceClient;
  modelId: string;
  maxSystemRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 是否按已知模型家族附加关闭推理链参数；通用兼容站默认关闭。 */
  reasoningHints?: boolean;
  /** 按评测模型的精确 model ID 返回专属请求参数。 */
  extraBodyForModel?: (modelId: string) => Record<string, unknown>;
  observability?: AgentObservability;
  circuitBreaker?: ProviderCircuitBreakerPort;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 真实复盘策略：复用 TokendanceClient（Key/URL 只在其内部），独立复盘 model ID 与提示词。
 * 输出走 Zod 严格校验 + 一次格式修复；失败抛脱敏 ReviewSystemError。
 */
export class TokendanceReviewPolicy implements ReviewPolicy {
  readonly modelId: string;
  private readonly client: TokendanceClient;
  private readonly maxSystemRetries: number;
  private readonly retryDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly reasoningHints: boolean;
  private readonly extraBodyForModel: (modelId: string) => Record<string, unknown>;
  private readonly observability: AgentObservability;
  private readonly circuitBreaker: ProviderCircuitBreakerPort;

  constructor(options: TokendanceReviewPolicyOptions) {
    this.client = options.client;
    this.modelId = options.modelId;
    this.maxSystemRetries = options.maxSystemRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 800;
    this.sleep = options.sleep ?? defaultSleep;
    this.reasoningHints = options.reasoningHints ?? true;
    this.extraBodyForModel = options.extraBodyForModel ?? (() => ({}));
    this.observability = options.observability ?? noOpAgentObservability;
    this.circuitBreaker = options.circuitBreaker ?? noOpProviderCircuitBreaker;
  }

  async generate(
    input: ReviewInput,
    context: {
      commandId: string;
      actionId: string;
      lifecycle?: { validatedAttemptId?: string };
    } = {
      commandId: `review/${input.gameId}`,
      actionId: `review/${input.gameId}`,
    },
  ): Promise<ReviewGeneration> {
    if (!this.modelId) throw new ReviewSystemError('MODEL_NOT_CONFIGURED');
    try {
      this.circuitBreaker.beforeLogicalCall();
    } catch (error) {
      if (error instanceof CircuitOpenError) throw new ReviewSystemError('PROVIDER_UNAVAILABLE');
      throw error;
    }

    const baseMessages = buildReviewMessages(input);
    const extraBody = {
      ...(this.reasoningHints ? reasoningDisableBodyFor(this.modelId) : {}),
      ...this.extraBodyForModel(this.modelId),
    };
    const agentIds = input.players
      .filter((player) => player.kind === 'agent')
      .map((player) => player.playerId);

    let messages = baseMessages;
    let repairUsed = false;
    let systemAttempts = 0;
    let lastSystemCode: ReviewErrorCode = 'INTERNAL_ERROR';
    let attemptKind: ModelAttemptKind = 'initial';

    for (;;) {
      let content: string;
      let attempt;
      try {
        attempt = this.observability.beginReviewAttempt({
          reviewInput: input,
          commandId: context.commandId,
          actionId: context.actionId,
          modelId: this.modelId,
          messages,
          attemptKind,
        });
      } catch (error) {
        if (error instanceof ContextBoundaryViolationError) {
          throw new ReviewSystemError('INTERNAL_ERROR');
        }
        throw new ReviewSystemError('INTERNAL_ERROR');
      }
      try {
        content = await this.client.chatCompletion({
          modelId: this.modelId,
          messages,
          extraBody,
          ...(attempt.signal ? { signal: attempt.signal } : {}),
        });
        this.observability.markAttemptStage?.(attempt.attemptId, 'provider_returned', {
          rawResponse: content,
        });
        this.circuitBreaker.recordSuccess();
      } catch (error) {
        if (error instanceof TokendanceError && error.kind === 'interrupted') {
          this.observability.finishAttempt(attempt, 'runtime_interrupted');
          throw new ReviewRuntimeInterruptedError();
        }
        const classified = classifyClientError(error);
        this.observability.finishAttempt(attempt, classified.code.toLowerCase());
        lastSystemCode = classified.code;
        if (!classified.retryable) {
          this.circuitBreaker.recordFailure('permanent');
          throw new ReviewSystemError(classified.code);
        }
        systemAttempts += 1;
        if (systemAttempts > this.maxSystemRetries) {
          this.circuitBreaker.recordFailure('transient');
          throw new ReviewSystemError(lastSystemCode);
        }
        await this.sleep(this.retryDelayMs);
        messages = baseMessages;
        repairUsed = false;
        attemptKind = 'system_retry';
        continue;
      }

      try {
        const output = buildReviewOutput(extractJson(content), agentIds);
        this.observability.markAttemptStage?.(attempt.attemptId, 'schema_validated');
        if (context.lifecycle) {
          context.lifecycle.validatedAttemptId = attempt.attemptId;
        } else {
          this.observability.finishAttempt(attempt, 'schema_validated', { rawResponse: content });
        }
        return output;
      } catch (error) {
        if (!(error instanceof ReviewFormatError)) {
          this.observability.finishAttempt(attempt, 'internal_error', { rawResponse: content });
          throw error;
        }
        this.observability.finishAttempt(attempt, 'invalid_format', { rawResponse: content });
        if (!repairUsed) {
          repairUsed = true;
          attemptKind = 'format_repair';
          messages = [
            ...baseMessages,
            { role: 'assistant', content },
            { role: 'user', content: repairInstruction(agentIds) },
          ];
          continue;
        }
        systemAttempts += 1;
        if (systemAttempts > this.maxSystemRetries) throw new ReviewSystemError('FORMAT_INVALID');
        await this.sleep(this.retryDelayMs);
        messages = baseMessages;
        repairUsed = false;
        attemptKind = 'system_retry';
      }
    }
  }
}

function buildReviewMessages(input: ReviewInput): ChatMessage[] {
  const nameOf = (playerId: string) =>
    input.players.find((player) => player.playerId === playerId)?.displayName ?? playerId.slice(0, 8);

  const agents = input.players.filter((player) => player.kind === 'agent');
  const agentIds = agents.map((player) => player.playerId);
  const outputShape =
    `{"perAgent":[{"playerId":"必须取自指定列表","verdict":"结论、核心依据和一条改进",` +
    `"keyMoments":["第N轮｜行为 → 判断或影响"],"rating":1}],` +
    `"overall":"胜负手、关键转折和最大反事实"}`;

  const system =
    `你是“谁是卧底”赛后复盘教练。目标是提炼最有解释力的结论，不复述整局。\n` +
    `评价顺序：①判断是否随公开证据合理更新；②发言、投票是否与当时判断一致；③行动对淘汰和胜负的实际影响。\n` +
    `评价规则：\n` +
    `- 只依据行动当时可见的信息评价，不得因最终胜负倒推表现，不得编造动机或事实。\n` +
    `- 每名 AI 的 verdict 用 60～100 个中文字符：结论先行，给出最强事实依据，最后给一条具体改进。\n` +
    `- keyMoments 只保留最关键的 1～2 条，每条不超过 50 个中文字符，写成“第N轮｜行为 → 判断或影响”。\n` +
    `- overall 用 100～160 个中文字符，只写胜负手、关键转折和一个最值得改变的决策，不逐人重复。\n` +
    `- 禁止复述规则、身份词牌和完整流程；禁止空泛表扬；私有信念只作判断依据，不长段照抄。\n` +
    `评分锚点：5=持续准确且行动决定胜负；4=整体可靠，仅有小失误；3=有得有失；2=多次误判或行动脱节；1=核心判断失据并明显伤害局势。不得只按所属阵营输赢评分。\n` +
    `perAgent 必须且只能覆盖这些 AI 的 playerId：${agentIds.join('、')}，每个恰好一条。` +
    `只输出一个 JSON 对象，不要解释或代码块标记。格式：\n${outputShape}`;

  const identityLines = [...input.reveal.players]
    .sort((a, b) => a.seatIndex - b.seatIndex)
    .map((entry) => {
      const kind = input.players.find((player) => player.playerId === entry.playerId)?.kind;
      const camp = entry.camp === 'undercover' ? '卧底' : '平民';
      const who = kind === 'human' ? '人类' : 'AI';
      return `· ${nameOf(entry.playerId)}（${who}，playerId=${entry.playerId}）：${camp}，词牌「${entry.wordCard}」`;
    })
    .join('\n');

  const beliefLines = input.factReview.agentActions
    .map((action) => {
      const top = [...action.belief.playerUndercoverProbabilities].sort(
        (a, b) => b.probability - a.probability,
      )[0];
      const suspect = top ? `${nameOf(top.playerId)} ${Math.round(top.probability * 100)}%` : '未定';
      const guesses = [...action.belief.opposingWordCandidates]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 2)
        .map((entry) => `「${entry.word}」${Math.round(entry.confidence * 100)}%`)
        .join('，');
      let outputText: string;
      if (action.output['action'] === 'guess') {
        const target = typeof action.output['targetPlayerId'] === 'string' ? nameOf(action.output['targetPlayerId']) : '未知';
        const word = typeof action.output['guessedWord'] === 'string' ? action.output['guessedWord'] : '';
        outputText = `猜测 ${target} 的词为「${word}」`;
      } else if (action.actionType === 'describe' || action.actionType === 'defend') {
        const text = typeof action.output['text'] === 'string' ? action.output['text'] : '';
        outputText = `${action.actionType === 'defend' ? '辩解' : '描述'}「${text}」`;
      } else {
        const target =
          typeof action.output['targetPlayerId'] === 'string'
            ? nameOf(action.output['targetPlayerId'])
            : '未知';
        const reason = typeof action.output['reason'] === 'string' ? action.output['reason'] : '';
        outputText = `投给 ${target}（理由：${reason}）`;
      }
      return (
        `· 第${action.roundNumber}轮 ${nameOf(action.playerId)}：${outputText}；` +
        `最高怀疑=${suspect}${guesses ? `；猜词=${guesses}` : ''}；心理独白=${action.belief.reasoningSummary}`
      );
    })
    .join('\n');

  const resolvedGuessLines = (input.factReview.guesses ?? [])
    .map((guess) => `· 第${guess.roundNumber}轮 ${nameOf(guess.actorId)} 猜 ${nameOf(guess.targetPlayerId)} 的词为「${guess.guessedWord}」：${guess.success ? '成功' : '失败'}，${nameOf(guess.eliminatedPlayerId)} 出局`)
    .join('\n');

  const winner = input.winnerCamp === 'draw' ? '双方平局' : input.winnerCamp === 'civilian' ? '平民阵营获胜' : '卧底阵营获胜';
  const user =
    `【词对】类别：${input.reveal.wordPair.category}；平民词：${input.reveal.wordPair.civilianWord}；卧底词：${input.reveal.wordPair.undercoverWord}\n` +
    `【结果】${winner}（结束原因：${input.endReason}）\n` +
    `【真实身份与词牌】\n${identityLines}\n` +
    `【公开时间线】\n${renderTimeline(input.publicTimeline, nameOf)}\n` +
    `【各 AI 每步私有心理活动】\n${beliefLines || '（无）'}\n` +
    `【猜词完整记录】\n${resolvedGuessLines || '（无）'}\n` +
    `请据以上事实，仅返回约定的 JSON。`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function renderTimeline(
  timeline: readonly PublicTimelineItem[],
  nameOf: (playerId: string) => string,
): string {
  const lines: string[] = [];
  for (const item of timeline) {
    const payload = item.payload as Record<string, unknown>;
    switch (item.type) {
      case 'round_started':
        lines.push(`—— 第 ${String(payload['roundNumber'] ?? '')} 轮 ——`);
        break;
      case 'speech_published': {
        const actorId = typeof payload['actorId'] === 'string' ? payload['actorId'] : '';
        const text = typeof payload['text'] === 'string' ? payload['text'] : '';
        const kind = payload['actionType'] === 'defend' ? '辩解' : '描述';
        if (text) lines.push(`${nameOf(actorId)}（${kind}）：${text}`);
        break;
      }
      case 'votes_revealed': {
        const votes = Array.isArray(payload['votes'])
          ? (payload['votes'] as Array<{ voterId: string; targetPlayerId: string }>)
          : [];
        const summary = votes
          .map((vote) => `${nameOf(vote.voterId)}→${nameOf(vote.targetPlayerId)}`)
          .join('，');
        if (summary) lines.push(`揭票：${summary}`);
        break;
      }
      case 'player_eliminated': {
        const pid = typeof payload['playerId'] === 'string' ? payload['playerId'] : '';
        lines.push(`${nameOf(pid)} 被淘汰`);
        break;
      }
      case 'player_rule_violated': {
        const pid = typeof payload['playerId'] === 'string' ? payload['playerId'] : '';
        lines.push(`${nameOf(pid)} 因违规退出`);
        break;
      }
      default:
        break;
    }
  }
  return lines.join('\n');
}

function repairInstruction(agentIds: readonly string[]): string {
  return (
    `上一次回复不是合法 JSON 或不满足要求。请只返回一个 JSON 对象，不要任何解释或代码块标记。` +
    `perAgent 必须且只能覆盖这些 playerId：${agentIds.join(', ')}，每个恰好一条；` +
    `verdict 60～100 个字符；keyMoments 1～2 条且每条不超过 50 个字符；` +
    `rating 必填且为 1～5 的整数；overall 100～160 个字符。`
  );
}

function extractJson(content: string): Record<string, unknown> {
  let text = content.trim();
  text = text.replace(/<(think|reasoning|thought)>[\s\S]*?<\/\1>/gi, '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) text = fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new ReviewFormatError('NO_JSON');
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== 'object') throw new ReviewFormatError('NOT_OBJECT');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ReviewFormatError('INVALID_JSON');
  }
}

function buildReviewOutput(
  parsed: Record<string, unknown>,
  agentIds: readonly string[],
): ReviewGeneration {
  const result = reviewGenerationSchema.safeParse(parsed);
  if (!result.success) throw new ReviewFormatError('SCHEMA_INVALID');
  const covered = new Set(result.data.perAgent.map((entry) => entry.playerId));
  if (covered.size !== agentIds.length || agentIds.some((id) => !covered.has(id))) {
    throw new ReviewFormatError('AGENTS_NOT_COVERED');
  }
  return result.data;
}

function classifyClientError(error: unknown): { code: ReviewErrorCode; retryable: boolean } {
  if (!(error instanceof TokendanceError)) {
    return { code: 'INTERNAL_ERROR', retryable: false };
  }
  if (error.kind === 'timeout') return { code: 'CALL_TIMEOUT', retryable: true };
  if (error.kind === 'network') return { code: 'NETWORK_FAILED', retryable: true };
  if (error.kind === 'bad_response') return { code: 'BAD_RESPONSE', retryable: true };
  if (error.status === 401 || error.status === 403) return { code: 'AUTH_FAILED', retryable: false };
  if (error.status === 404) return { code: 'MODEL_NOT_FOUND', retryable: false };
  if (error.status === 429) return { code: 'RATE_LIMITED', retryable: true };
  if (error.status !== undefined && error.status >= 500) {
    return { code: 'PROVIDER_UNAVAILABLE', retryable: true };
  }
  return { code: 'REQUEST_REJECTED', retryable: false };
}
