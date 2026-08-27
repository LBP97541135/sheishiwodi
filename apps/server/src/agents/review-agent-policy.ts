import {
  reviewGenerationCoreSchema,
  reviewGenerationSchema,
  reviewModelGuessAnalysisSchema,
  type PublicTimelineItem,
  type ReviewErrorCode,
  type ReviewGeneration,
  type ReviewGuessAnalysis,
  type ReviewModelGuessAnalysis,
} from '@sheishiwodi/shared';

import { reasoningDisableBodyFor } from './model-reasoning.js';
import {
  ContextBoundaryViolationError,
  noOpAgentObservability,
  type AgentObservability,
  type ModelAttemptKind,
} from './agent-observability.js';
import {
  buildGuessDecisionFrames,
  type GuessDecisionFrame,
  type ReviewInput,
  type ReviewPolicy,
} from './review-policy.js';
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

class ReviewFormatError extends Error {
  constructor(
    message: string,
    readonly scope: 'core' | 'guess' = 'core',
    readonly validCore?: Pick<ReviewGeneration, 'perAgent' | 'overall'>,
  ) {
    super(message);
  }
}

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
        const output = buildReviewOutput(extractJson(content), agentIds, input);
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
        if (
          error.scope === 'guess' &&
          error.validCore &&
          repairUsed
        ) {
          const degraded = reviewGenerationSchema.parse({
            ...error.validCore,
            guessAnalysisStatus: 'failed',
          });
          this.observability.markAttemptStage?.(attempt.attemptId, 'schema_validated');
          if (context.lifecycle) {
            context.lifecycle.validatedAttemptId = attempt.attemptId;
          } else {
            this.observability.finishAttempt(attempt, 'schema_validated', { rawResponse: content });
          }
          return degraded;
        }
        this.observability.finishAttempt(attempt, 'invalid_format', { rawResponse: content });
        if (!repairUsed) {
          repairUsed = true;
          attemptKind = 'format_repair';
          messages = [
            ...baseMessages,
            { role: 'assistant', content },
            { role: 'user', content: repairInstruction(agentIds, input, error.scope) },
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
  const coreOutputShape =
    `{"perAgent":[{"playerId":"必须取自指定列表","verdict":"结论、核心依据和一条改进",` +
    `"keyMoments":["第N轮｜行为 → 判断或影响"],"rating":1}],` +
    `"overall":"胜负手、关键转折和最大反事实"`;
  const outputShape = input.gameMode === 'guess'
    ? `${coreOutputShape},"guessAnalysis":{"summary":"AI整体猜词策略",` +
      `"keyDecisions":[{"actionId":"只能取自证据帧",` +
      `"verdict":"reasonable|rash|insufficient_basis|missed_opportunity",` +
      `"assessment":"只依据行动时证据评价",` +
      `"outcomeImpact":"仅实际猜词填写"}]}}}`
    : `${coreOutputShape}}`;

  const modeRules = input.gameMode === 'guess'
    ? `当前是猜词模式。除通用评价外，必须生成 guessAnalysis。\n` +
      `猜词规则：每名玩家整局最多猜一次；只可在自己的常规描述或首轮投票行动中选择猜词，猜词会替代本次描述或投票；` +
      `目标必须属于对方阵营且词语完全匹配才成功，成功时目标出局，失败时自己出局。\n` +
      `投票阶段的 AI 基于同一冻结快照并行决策、随后原子结算；不得用同批其他人的返回或结算结果评价某个 AI 当时的判断。\n` +
      `guessAnalysis 只评价 AI，不评价人类。keyDecisions 最多 3 条，其中 missed_opportunity 最多 1 条；` +
      `实际猜词优先保留。证据不足时不猜是合理选择，禁止机械惩罚。\n` +
      `决策质量只能依据相应 actionId 证据帧中的行动时公开信息与 beliefAtAction；` +
      `outcome 及终局揭晓只能写入 outcomeImpact，不得反推 assessment。\n`
    : `当前是经典模式，不存在主动猜词机制。只评价描述、辩解、投票、证据更新和阵营贡献；` +
      `输出中禁止出现 guessAnalysis。\n`;

  const system =
    `你是“谁是卧底”赛后复盘教练。目标是提炼最有解释力的结论，不复述整局。\n` +
    `评价顺序：①判断是否随公开证据合理更新；②发言、投票是否与当时判断一致；③行动对淘汰和胜负的实际影响。\n` +
    modeRules +
    `评价规则：\n` +
    `- 只依据行动当时可见的信息评价，不得因最终胜负倒推表现，不得编造动机或事实。\n` +
    `- 每名 AI 的 verdict 以 60～100 个中文字符为目标：结论先行，给出最强事实依据，最后给一条具体改进。\n` +
    `- keyMoments 只保留最关键的 1～2 条，以每条不超过 50 个中文字符为目标，写成“第N轮｜行为 → 判断或影响”。\n` +
    `- overall 以 100～160 个中文字符为目标，只写胜负手、关键转折和一个最值得改变的决策，不逐人重复。\n` +
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

  const guessFrames = input.gameMode === 'guess'
    ? renderGuessDecisionFrames(buildGuessDecisionFrames(input), nameOf)
    : '';

  const winner = input.winnerCamp === 'draw' ? '双方平局' : input.winnerCamp === 'civilian' ? '平民阵营获胜' : '卧底阵营获胜';
  const user =
    `【模式】${input.gameMode === 'guess' ? '猜词模式' : '经典模式'}\n` +
    `【词对】类别：${input.reveal.wordPair.category}；平民词：${input.reveal.wordPair.civilianWord}；卧底词：${input.reveal.wordPair.undercoverWord}\n` +
    `【结果】${winner}（结束原因：${input.endReason}）\n` +
    `【真实身份与词牌】\n${identityLines}\n` +
    `【公开时间线】\n${renderTimeline(input.publicTimeline, nameOf)}\n` +
    `【各 AI 每步私有心理活动】\n${beliefLines || '（无）'}\n` +
    (input.gameMode === 'guess'
      ? `【终局猜词事实，仅用于 outcomeImpact】\n${resolvedGuessLines || '（无）'}\n` +
        `【AI 猜词行动时证据帧】\n${guessFrames || '（没有实际猜词或高置信保留候选）'}\n`
      : '') +
    `请据以上事实，仅返回约定的 JSON。`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function renderGuessDecisionFrames(
  frames: readonly GuessDecisionFrame[],
  nameOf: (playerId: string) => string,
): string {
  return frames
    .map((frame) => {
      const topSuspects = [...frame.beliefAtAction.playerUndercoverProbabilities]
        .sort((left, right) => right.probability - left.probability)
        .slice(0, 2)
        .map((entry) => `${nameOf(entry.playerId)}=${Math.round(entry.probability * 100)}%`)
        .join('，');
      const wordCandidates = [...frame.beliefAtAction.opposingWordCandidates]
        .sort((left, right) => right.confidence - left.confidence)
        .slice(0, 2)
        .map((entry) => `「${entry.word}」${Math.round(entry.confidence * 100)}%（${entry.evidence}）`)
        .join('，');
      const actionText = renderFrameAction(frame, nameOf);
      const visibleTimeline = frame.contextComplete
        ? renderTimeline(frame.publicEventsBeforeAction, nameOf) || '（当时尚无公开发言或投票）'
        : '（旧记录缺少公开事件游标，不得据此判定错失机会）';
      const outcome = frame.outcome
        ? `\n事后结果（禁止反推决策质量）：${frame.outcome.success ? '猜词成功' : '猜词失败'}，${nameOf(frame.outcome.eliminatedPlayerId)} 出局`
        : '';
      return (
        `--- actionId=${frame.actionId}｜${nameOf(frame.actorId)}｜第${frame.roundNumber}轮${frame.phase === 'describe' ? '发言' : '投票'}｜` +
        `${frame.decisionType === 'attempt' ? '实际猜词' : '未猜候选'} ---\n` +
        `当时公开信息（eventSeq<=${frame.publicEventCursor ?? '未知'}）：\n${visibleTimeline}\n` +
        `beliefAtAction：最高卧底怀疑=${topSuspects || '无'}；对方词候选=${wordCandidates || '无'}；` +
        `判断摘要=${frame.beliefAtAction.reasoningSummary}\n行动=${actionText}${outcome}`
      );
    })
    .join('\n');
}

function renderFrameAction(
  frame: GuessDecisionFrame,
  nameOf: (playerId: string) => string,
): string {
  if (frame.decisionType === 'attempt') {
    const target = typeof frame.action['targetPlayerId'] === 'string'
      ? nameOf(frame.action['targetPlayerId'])
      : '未知';
    const word = typeof frame.action['guessedWord'] === 'string' ? frame.action['guessedWord'] : '';
    const reason = typeof frame.action['reason'] === 'string' ? frame.action['reason'] : '';
    return `猜 ${target} 的词为「${word}」${reason ? `，理由=${reason}` : ''}`;
  }
  if (frame.phase === 'describe') {
    return `继续描述「${typeof frame.action['text'] === 'string' ? frame.action['text'] : ''}」`;
  }
  const target = typeof frame.action['targetPlayerId'] === 'string'
    ? nameOf(frame.action['targetPlayerId'])
    : '未知';
  return `继续投票给 ${target}`;
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

function repairInstruction(
  agentIds: readonly string[],
  input: ReviewInput,
  scope: 'core' | 'guess',
): string {
  const frames = buildGuessDecisionFrames(input);
  const frameIds = frames.map((frame) => frame.actionId);
  const guessInstruction = input.gameMode === 'guess'
    ? `guessAnalysis 必须存在，summary 为非空字符串，keyDecisions 最多 3 条；` +
      `actionId 只能取自：${frameIds.join(', ') || '（没有可选 actionId，此时返回空数组）'}；` +
      `missed_opportunity 最多一条且只能用于未猜候选；实际猜词必须填写 outcomeImpact。`
    : `当前为经典模式，禁止输出 guessAnalysis。`;
  return (
    `上一次回复的${scope === 'guess' ? '猜词专项部分' : '基础评价结构'}不满足契约。` +
    `请保留正确内容并只返回一个完整 JSON 对象，不要解释或代码块标记。` +
    `perAgent 必须且只能覆盖这些 playerId：${agentIds.join(', ')}，每个恰好一条；` +
    `verdict、overall 为非空字符串；keyMoments 1～2 条；rating 为 1～5 的整数。` +
    guessInstruction
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
  input: ReviewInput,
): ReviewGeneration {
  const allowedKeys = input.gameMode === 'guess'
    ? new Set(['perAgent', 'overall', 'guessAnalysis'])
    : new Set(['perAgent', 'overall']);
  if (Object.keys(parsed).some((key) => !allowedKeys.has(key))) {
    throw new ReviewFormatError('UNEXPECTED_KEYS');
  }
  const coreResult = reviewGenerationCoreSchema.safeParse({
    perAgent: parsed['perAgent'],
    overall: parsed['overall'],
  });
  if (!coreResult.success) throw new ReviewFormatError('CORE_SCHEMA_INVALID');
  const covered = new Set(coreResult.data.perAgent.map((entry) => entry.playerId));
  if (covered.size !== agentIds.length || agentIds.some((id) => !covered.has(id))) {
    throw new ReviewFormatError('AGENTS_NOT_COVERED');
  }
  if (input.gameMode === 'classic') return reviewGenerationSchema.parse(coreResult.data);

  const guessResult = reviewModelGuessAnalysisSchema.safeParse(parsed['guessAnalysis']);
  if (!guessResult.success) {
    throw new ReviewFormatError('GUESS_SCHEMA_INVALID', 'guess', coreResult.data);
  }
  try {
    const guessAnalysis = hydrateGuessAnalysis(
      guessResult.data,
      buildGuessDecisionFrames(input),
    );
    return reviewGenerationSchema.parse({
      ...coreResult.data,
      guessAnalysis,
      guessAnalysisStatus: 'done',
    });
  } catch (error) {
    if (error instanceof ReviewFormatError) {
      throw new ReviewFormatError(error.message, 'guess', coreResult.data);
    }
    throw error;
  }
}

function hydrateGuessAnalysis(
  modelAnalysis: ReviewModelGuessAnalysis,
  frames: readonly GuessDecisionFrame[],
): ReviewGuessAnalysis {
  const frameById = new Map(frames.map((frame) => [frame.actionId, frame] as const));
  const seen = new Set<string>();
  let missedCount = 0;
  let selectedAttempt = false;

  const keyDecisions = modelAnalysis.keyDecisions.map((decision) => {
    const frame = frameById.get(decision.actionId);
    if (!frame || seen.has(decision.actionId)) {
      throw new ReviewFormatError('GUESS_ACTION_INVALID', 'guess');
    }
    seen.add(decision.actionId);

    const kind: 'attempt' | 'missed' =
      frame.decisionType === 'attempt' ? 'attempt' : 'missed';
    if (kind === 'attempt') {
      selectedAttempt = true;
      if (decision.verdict === 'missed_opportunity' || !decision.outcomeImpact) {
        throw new ReviewFormatError('GUESS_ATTEMPT_INVALID', 'guess');
      }
    } else {
      missedCount += 1;
      if (
        decision.verdict !== 'missed_opportunity' ||
        decision.outcomeImpact !== undefined
      ) {
        throw new ReviewFormatError('MISSED_OPPORTUNITY_INVALID', 'guess');
      }
    }

    return {
      actionId: frame.actionId,
      actorId: frame.actorId,
      roundNumber: frame.roundNumber,
      phase: frame.phase,
      kind,
      verdict: decision.verdict,
      assessment: decision.assessment,
      ...(decision.outcomeImpact ? { outcomeImpact: decision.outcomeImpact } : {}),
    };
  });

  if (missedCount > 1) throw new ReviewFormatError('TOO_MANY_MISSED', 'guess');
  if (frames.some((frame) => frame.decisionType === 'attempt') && !selectedAttempt) {
    throw new ReviewFormatError('ATTEMPT_NOT_REVIEWED', 'guess');
  }
  return { summary: modelAnalysis.summary, keyDecisions };
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
