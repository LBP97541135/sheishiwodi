// 单局复盘 Markdown 导出（DEC-047，确定性纯函数）。
// 数据只来自终局事实投影（ReviewInput：reveal + factReview + 公开时间线）与脱敏复盘产物（ReviewSummary）。
// 安全边界：ReviewInput/ReviewSummary 结构上都不含连接凭据（只有 model ID 与终局脱敏数据），
// 故此处不接触 Base URL / API Key / 请求头；落盘/返回前再做一次凭据禁用串纵深自检，命中即中止导出。

import type { ReviewStatus, ReviewSummary } from '@sheishiwodi/shared';

import type { ReviewInput } from '../agents/review-policy.js';

/**
 * 凭据类禁用串（纵深防御）：导出文本理论上不会出现连接凭据，命中任一即中止。
 * 只匹配鉴权头/密钥标记这类不会出现在中文复盘正文里的强特征串，避免误伤词牌/信念。
 */
const FORBIDDEN_MARKERS = ['Authorization', 'Bearer ', 'api_key', 'apiKey', 'x-api-key'] as const;

/** 导出文本命中凭据禁用串时抛出（路由据此返回 500 且不下发内容）。 */
export class ReviewMarkdownLeakError extends Error {
  constructor(readonly marker: string) {
    super('REVIEW_MD_LEAK');
    this.name = 'ReviewMarkdownLeakError';
  }
}

/** 落盘/返回前自检：命中任一凭据禁用串即抛 ReviewMarkdownLeakError。 */
export function assertReviewMarkdownClean(markdown: string): void {
  for (const marker of FORBIDDEN_MARKERS) {
    if (markdown.includes(marker)) throw new ReviewMarkdownLeakError(marker);
  }
}

const WIN_CAMP_TEXT: Record<ReviewInput['winnerCamp'], string> = {
  civilian: '平民阵营',
  undercover: '卧底阵营',
};

const END_REASON_TEXT: Record<string, string> = {
  undercover_eliminated: '卧底被票出，平民阵营获胜',
  undercover_survived_to_two: '卧底存活到只剩两人，卧底阵营获胜',
  player_rule_violation: '有玩家因重复违规退出，系统重新判定胜负',
  abandoned_by_human: '真人放弃对局',
  model_failure_limit: '模型连续失败超限，对局终止',
};

const ACTION_TYPE_TEXT: Record<string, string> = {
  describe: '描述',
  defend: '辩解',
  vote: '投票',
  revote: '重投',
};

const STATUS_TEXT: Record<ReviewStatus, string> = {
  pending: '待生成',
  generating: '生成中',
  done: '已完成',
  failed: '生成失败',
};

const pct = (value: number): string => `${Math.round(value * 100)}%`;

/** Markdown 表格单元转义：竖线与换行会破坏表格结构。 */
const cell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 组装单局复盘 Markdown。summary 为 null / 非 done 时仅标注 AI 评价状态，不臆造内容。
 * 返回前执行 assertReviewMarkdownClean 纵深自检。
 */
export function buildReviewMarkdown(params: {
  input: ReviewInput;
  summary: ReviewSummary | null;
}): string {
  const { input, summary } = params;
  const { reveal, factReview, players, publicTimeline } = input;

  const nameOf = (playerId: string | null | undefined): string => {
    if (!playerId) return '未知玩家';
    return players.find((player) => player.playerId === playerId)?.displayName ?? playerId;
  };

  const roundCount = publicTimeline.filter((item) => item.type === 'round_started').length;
  const lines: string[] = [];

  // —— 标题与脱敏声明 ——
  lines.push(`# 对局复盘 · ${reveal.wordPair.category}`, '');
  lines.push(
    '> 本文件由「谁是卧底」赛后复盘导出，仅含终局事实与 AI 脱敏评价，',
    '> 不含 Base URL / API Key / 请求头 / 模型原始响应等任何连接凭据。',
    '',
  );

  // —— 1. 对局信息 ——
  lines.push('## 对局信息', '');
  lines.push('| 项 | 值 |', '| --- | --- |');
  lines.push(`| 对局 ID | ${cell(input.gameId)} |`);
  lines.push(`| 胜方 | ${WIN_CAMP_TEXT[input.winnerCamp]} |`);
  lines.push(`| 结束原因 | ${END_REASON_TEXT[input.endReason] ?? input.endReason} |`);
  lines.push(`| 词类别 | ${cell(reveal.wordPair.category)} |`);
  lines.push(`| 平民词 | ${cell(reveal.wordPair.civilianWord)} |`);
  lines.push(`| 卧底词 | ${cell(reveal.wordPair.undercoverWord)} |`);
  lines.push(`| 完成轮数 | ${roundCount} |`);
  lines.push(`| 参与人数 | ${players.length} |`);
  lines.push('');

  // —— 2. 阵容 ——
  lines.push('## 阵容', '');
  for (const player of players) {
    lines.push(`- **${cell(player.displayName)}**（${player.kind === 'human' ? '真人' : 'AI'}）`);
  }
  lines.push(`- 复盘模型：${summary ? summary.modelId : '—'}`);
  lines.push('');

  // —— 3. 真实身份与词牌 ——
  lines.push('## 真实身份与词牌', '');
  lines.push('| 座位 | 玩家 | 阵营 | 词牌 |', '| --- | --- | --- | --- |');
  for (const entry of [...reveal.players].sort((a, b) => a.seatIndex - b.seatIndex)) {
    const camp = entry.camp === 'undercover' ? '卧底' : '平民';
    lines.push(
      `| ${entry.seatIndex + 1} | ${cell(nameOf(entry.playerId))} | ${camp} | ${cell(entry.wordCard)} |`,
    );
  }
  lines.push('');

  // —— 4. 公开时间线 ——
  lines.push('## 公开时间线', '');
  let sawRound = false;
  for (const item of publicTimeline) {
    const payload = item.payload as Record<string, unknown>;
    switch (item.type) {
      case 'round_started': {
        const round = Number(payload.roundNumber ?? 0);
        lines.push('', `### 第 ${round} 轮`, '');
        sawRound = true;
        break;
      }
      case 'speech_published': {
        const kind = payload.actionType === 'defend' ? '辩解' : '描述';
        lines.push(`- **${cell(nameOf(asString(payload.actorId)))}** ${kind}：${cell(asString(payload.text))}`);
        break;
      }
      case 'votes_revealed': {
        const votes = Array.isArray(payload.votes)
          ? (payload.votes as Array<{ voterId: string; targetPlayerId: string }>)
          : [];
        const rendered = votes
          .map((vote) => `${nameOf(vote.voterId)}→${nameOf(vote.targetPlayerId)}`)
          .join('；');
        lines.push(`- 揭票：${cell(rendered)}`);
        break;
      }
      case 'revote_started': {
        const ids = Array.isArray(payload.candidateIds) ? (payload.candidateIds as string[]) : [];
        lines.push(`- 重投：仅在 ${cell(ids.map(nameOf).join('、'))} 中`);
        break;
      }
      case 'tie_declared': {
        const ids = Array.isArray(payload.candidateIds) ? (payload.candidateIds as string[]) : [];
        lines.push(`- 平票：${cell(ids.map(nameOf).join('、'))}`);
        break;
      }
      case 'player_eliminated': {
        lines.push(`- 出局：${cell(nameOf(asString(payload.playerId)))} 被淘汰`);
        break;
      }
      case 'round_ended_without_elimination': {
        const reason = payload.reason === 'all_max' ? '全员最高票，本轮直接结束' : '重投仍然平票';
        lines.push(`- 无人出局：${reason}`);
        break;
      }
      default:
        break;
    }
  }
  if (!sawRound) lines.push('（无公开时间线）');
  lines.push('');

  // —— 5. AI 心理活动（信念） ——
  lines.push('## AI 心理活动（信念）', '');
  if (factReview.agentActions.length === 0) {
    lines.push('（本局无 AI 私有行动记录）', '');
  }
  for (const action of factReview.agentActions) {
    const who = nameOf(action.playerId);
    const actionText = ACTION_TYPE_TEXT[action.actionType] ?? action.actionType;
    lines.push(`### 第 ${action.roundNumber} 轮 · ${who} · ${actionText}`, '');
    lines.push(`- 心理独白：${cell(action.belief.reasoningSummary)}`);

    const probs = [...action.belief.playerUndercoverProbabilities]
      .sort((a, b) => b.probability - a.probability)
      .map((entry) => `${nameOf(entry.playerId)} ${pct(entry.probability)}`)
      .join('；');
    lines.push(`- 怀疑分布：${cell(probs)}`);

    if (action.belief.opposingWordCandidates.length > 0) {
      const cands = [...action.belief.opposingWordCandidates]
        .sort((a, b) => b.confidence - a.confidence)
        .map((entry) => `${entry.word}（${pct(entry.confidence)}，依据：${entry.evidence}）`)
        .join('；');
      lines.push(`- 对方词猜测：${cell(cands)}`);
    }

    // 实际输出：描述/辩解看文本，投票看目标 + 理由。
    if (action.actionType === 'vote' || action.actionType === 'revote') {
      const target = nameOf(asString(action.output.targetPlayerId));
      const reason = asString(action.output.reason);
      lines.push(`- 实际投票：投给 ${cell(target)}${reason ? `，理由：${cell(reason)}` : ''}`);
    } else {
      const text = asString(action.output.text);
      if (text) lines.push(`- 实际发言：${cell(text)}`);
    }
    lines.push('');
  }

  // —— 6. AI 复盘评价 ——
  lines.push('## AI 复盘评价', '');
  if (!summary || summary.status !== 'done') {
    const status = summary ? STATUS_TEXT[summary.status] : '尚未生成';
    lines.push(`> AI 复盘评价当前状态：${status}。可在复盘页触发生成后重新导出。`, '');
  } else {
    lines.push(`> 由复盘模型 \`${summary.modelId}\` 生成，非对局事实，仅供参考。`, '');
    lines.push('### 总体点评', '', summary.overall, '');
    if (summary.perAgent.length > 0) {
      lines.push('### 各 AI 评价', '');
      for (const agent of summary.perAgent) {
        const stars =
          typeof agent.rating === 'number'
            ? ` ${'★'.repeat(agent.rating)}${'☆'.repeat(5 - agent.rating)}`
            : '';
        lines.push(`#### ${nameOf(agent.playerId)}${stars}`, '', agent.verdict, '');
        if (agent.keyMoments.length > 0) {
          lines.push('关键节点：');
          for (const moment of agent.keyMoments) lines.push(`- ${moment}`);
          lines.push('');
        }
      }
    }
  }

  const markdown = `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
  assertReviewMarkdownClean(markdown);
  return markdown;
}
