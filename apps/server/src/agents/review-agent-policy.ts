import {
  reviewGenerationSchema,
  type PublicTimelineItem,
  type ReviewErrorCode,
  type ReviewGeneration,
} from '@sheishiwodi/shared';

import { reasoningDisableBodyFor } from './model-reasoning.js';
import type { ReviewInput, ReviewPolicy } from './review-policy.js';
import { TokendanceError, type ChatMessage, type TokendanceClient } from './tokendance-client.js';

/** 复盘系统级失败（脱敏），不含 Key/URL/上游正文。 */
export class ReviewSystemError extends Error {
  constructor(readonly code: ReviewErrorCode) {
    super(`REVIEW_SYSTEM_${code}`);
    this.name = 'ReviewSystemError';
  }
}

class ReviewFormatError extends Error {}

export interface TokendanceReviewPolicyOptions {
  client: TokendanceClient;
  modelId: string;
  maxSystemRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
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

  constructor(options: TokendanceReviewPolicyOptions) {
    this.client = options.client;
    this.modelId = options.modelId;
    this.maxSystemRetries = options.maxSystemRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 800;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async generate(input: ReviewInput): Promise<ReviewGeneration> {
    if (!this.modelId) throw new ReviewSystemError('MODEL_NOT_CONFIGURED');

    const baseMessages = buildReviewMessages(input);
    const extraBody = reasoningDisableBodyFor(this.modelId);
    const agentIds = input.players
      .filter((player) => player.kind === 'agent')
      .map((player) => player.playerId);

    let messages = baseMessages;
    let repairUsed = false;
    let systemAttempts = 0;
    let lastSystemCode: ReviewErrorCode = 'INTERNAL_ERROR';

    for (;;) {
      let content: string;
      try {
        content = await this.client.chatCompletion({ modelId: this.modelId, messages, extraBody });
      } catch (error) {
        const classified = classifyClientError(error);
        lastSystemCode = classified.code;
        if (!classified.retryable) throw new ReviewSystemError(classified.code);
        systemAttempts += 1;
        if (systemAttempts > this.maxSystemRetries) throw new ReviewSystemError(lastSystemCode);
        await this.sleep(this.retryDelayMs);
        messages = baseMessages;
        repairUsed = false;
        continue;
      }

      try {
        return buildReviewOutput(extractJson(content), agentIds);
      } catch (error) {
        if (!(error instanceof ReviewFormatError)) throw error;
        if (!repairUsed) {
          repairUsed = true;
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
    `{"perAgent": [` +
    agentIds
      .map(
        (id) =>
          `{"playerId": "${id}", "verdict": "对该AI的简评(600字内)", "keyMoments": ["关键节点1", "关键节点2"], "rating": 1到5的整数}`,
      )
      .join(', ') +
    `], "overall": "全局点评：关键转折与胜负手(2000字内)"}`;

  const system =
    `你是资深中文桌游“谁是卧底”赛后复盘教练。现在给你一局已结束对局的完整真相：` +
    `每位玩家的真实身份与词牌、全部公开发言与投票、以及每个 AI 每一步的私有心理活动（信念）。` +
    `请客观复盘：评估每个 AI 的判断质量、发言策略、投票是否合理、信念是否与事实吻合，指出其高光与失误；` +
    `再给出一段全局点评，说明本局的关键转折与决定胜负的节点。` +
    `rating 为 1~5 的整数（5 为发挥最佳）。语言精炼、就事论事，不要复述规则。` +
    `perAgent 必须且只能覆盖这些 AI 的 playerId：${agentIds.join('、')}，每个恰好一条。` +
    `只输出一个 JSON 对象，不要输出多余文字或代码块标记，格式如下：\n${outputShape}`;

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
      if (action.actionType === 'describe' || action.actionType === 'defend') {
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

  const winner = input.winnerCamp === 'civilian' ? '平民阵营获胜' : '卧底阵营获胜';
  const user =
    `【词对】类别：${input.reveal.wordPair.category}；平民词：${input.reveal.wordPair.civilianWord}；卧底词：${input.reveal.wordPair.undercoverWord}\n` +
    `【结果】${winner}（结束原因：${input.endReason}）\n` +
    `【真实身份与词牌】\n${identityLines}\n` +
    `【公开时间线】\n${renderTimeline(input.publicTimeline, nameOf)}\n` +
    `【各 AI 每步私有心理活动】\n${beliefLines || '（无）'}\n` +
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
    `perAgent 必须且只能覆盖这些 playerId：${agentIds.join(', ')}，每个恰好一条；rating 为 1~5 的整数。`
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
