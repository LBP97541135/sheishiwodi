// 真实复盘模型冒烟（Stage 2 验收）：用一局固定的“终局事实”驱动 TokendanceReviewPolicy 生成 AI 评价，
// 强校验结构（reviewGenerationSchema + perAgent 覆盖全部 AI）并做信息隔离负向扫描（凭据/营地/信念内部字段）。
// 只被 pnpm test:live:review 调用，绝不进入 dev/build/test/test:e2e。
// 脱敏边界：Base URL / API Key / 请求头 / 上游完整响应绝不进入日志；此处只打印 model ID、长度、布尔、耗时(ms)
// 与最终“可展示产物”（verdict/overall——本就是要落库并呈现给前端的脱敏结果）。

import {
  reviewGenerationSchema,
  type FactReview,
  type FinaleReveal,
  type PublicTimelineItem,
} from '@sheishiwodi/shared';

import { TokendanceReviewPolicy } from '../../apps/server/src/agents/review-agent-policy.js';
import type { ReviewInput } from '../../apps/server/src/agents/review-policy.js';
import { TokendanceClient } from '../../apps/server/src/agents/tokendance-client.js';
import { resolveLiveConfig, LiveGateError } from './lib/env.js';
import {
  scan,
  credentialSentinels,
  CAMP_SENTINELS,
  BELIEF_INTERNAL_SENTINELS,
} from './lib/isolation.js';

function fail(message: string): never {
  console.error(`[test:live:review] 失败：${message}`);
  process.exit(1);
}

// —— 固定终局事实（与 ReviewScreen 测试同款：牛奶/豆浆，agent-1 卧底，被票出，平民胜）——
const reveal: FinaleReveal = {
  wordPair: { civilianWord: '牛奶', undercoverWord: '豆浆', category: '饮品' },
  players: [
    { playerId: 'human-1', seatIndex: 0, camp: 'civilian', wordCard: '牛奶' },
    { playerId: 'agent-1', seatIndex: 1, camp: 'undercover', wordCard: '豆浆' },
    { playerId: 'agent-2', seatIndex: 2, camp: 'civilian', wordCard: '牛奶' },
  ],
};

const publicTimeline: PublicTimelineItem[] = [
  {
    eventSeq: 1,
    type: 'round_started',
    occurredAt: '2026-08-17T12:00:00.000Z',
    payload: { roundNumber: 1, speakingOrder: ['human-1', 'agent-1', 'agent-2'] },
  },
  {
    eventSeq: 2,
    type: 'speech_published',
    occurredAt: '2026-08-17T12:00:01.000Z',
    payload: { actorId: 'agent-1', actionType: 'describe', text: '一种常见的白色饮品' },
  },
  {
    eventSeq: 3,
    type: 'speech_published',
    occurredAt: '2026-08-17T12:00:01.500Z',
    payload: { actorId: 'agent-2', actionType: 'describe', text: '早餐常配麦片一起喝' },
  },
  {
    eventSeq: 4,
    type: 'votes_revealed',
    occurredAt: '2026-08-17T12:00:02.000Z',
    payload: {
      votes: [
        { voterId: 'agent-1', targetPlayerId: 'agent-2' },
        { voterId: 'human-1', targetPlayerId: 'agent-1' },
        { voterId: 'agent-2', targetPlayerId: 'agent-1' },
      ],
    },
  },
  {
    eventSeq: 5,
    type: 'player_eliminated',
    occurredAt: '2026-08-17T12:00:03.000Z',
    payload: { playerId: 'agent-1' },
  },
];

const factReview: FactReview = {
  agentActions: [
    {
      actionId: 'act-1',
      playerId: 'agent-1',
      roundNumber: 1,
      actionType: 'describe',
      baseRevision: 2,
      belief: {
        reasoningSummary: '我的词和多数人不一样，先把描述彻底模糊化，避免暴露。',
        playerUndercoverProbabilities: [
          { playerId: 'agent-1', probability: 0.6 },
          { playerId: 'agent-2', probability: 0.3 },
          { playerId: 'human-1', probability: 0.1 },
        ],
        opposingWordCandidates: [{ word: '牛奶', confidence: 0.7, evidence: '大家都提到早餐会喝' }],
      },
      output: { text: '一种常见的白色饮品' },
      completedAt: '2026-08-17T12:00:01.000Z',
    },
    {
      actionId: 'act-2',
      playerId: 'agent-2',
      roundNumber: 1,
      actionType: 'vote',
      baseRevision: 6,
      belief: {
        reasoningSummary: 'agent-1 的描述最含糊，最可疑，优先投他。',
        playerUndercoverProbabilities: [
          { playerId: 'agent-1', probability: 0.7 },
          { playerId: 'agent-2', probability: 0.2 },
          { playerId: 'human-1', probability: 0.1 },
        ],
        opposingWordCandidates: [{ word: '豆浆', confidence: 0.6, evidence: '含糊其辞像在藏词' }],
      },
      output: { targetPlayerId: 'agent-1', reason: '他的描述最模糊，像是在回避真实词。' },
      completedAt: '2026-08-17T12:00:02.000Z',
    },
  ],
};

const input: ReviewInput = {
  gameId: 'live-review-smoke',
  winnerCamp: 'civilian',
  endReason: 'undercover_eliminated',
  reveal,
  players: [
    { playerId: 'human-1', displayName: '玩家', kind: 'human' },
    { playerId: 'agent-1', displayName: 'DeepSeek', kind: 'agent' },
    { playerId: 'agent-2', displayName: '豆包', kind: 'agent' },
  ],
  publicTimeline,
  factReview,
};

async function main(): Promise<void> {
  let config;
  try {
    config = resolveLiveConfig();
  } catch (error) {
    if (error instanceof LiveGateError) fail(error.message);
    throw error;
  }

  const reviewModel =
    (process.env['TOKENDANCE_REVIEW_MODEL'] ?? '').trim() ||
    config.defaultModel ||
    'deepseek-v4-flash';
  console.log(`[test:live:review] 已配置 tokendance，开始真实复盘冒烟。复盘模型 = ${reviewModel}`);

  const client = new TokendanceClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    defaultBody: config.extraBody,
  });
  const policy = new TokendanceReviewPolicy({
    client,
    modelId: reviewModel,
    maxSystemRetries: config.maxRetries,
    retryDelayMs: config.retryDelayMs,
  });

  const startedAt = Date.now();
  let generation;
  try {
    generation = await policy.generate(input);
  } catch (error) {
    // 只报脱敏错误名，不回显含 URL/Key 的底层信息。
    const name = error instanceof Error ? error.message : 'UnknownError';
    fail(`复盘生成异常（${name}）。`);
  }
  const elapsedMs = Date.now() - startedAt;

  // 1) 结构强校验
  const parsed = reviewGenerationSchema.safeParse(generation);
  if (!parsed.success) fail('复盘结果未通过 reviewGenerationSchema 校验。');

  // 2) perAgent 必须恰好覆盖全部 AI
  const agentIds = input.players.filter((p) => p.kind === 'agent').map((p) => p.playerId).sort();
  const covered = [...new Set(parsed.data.perAgent.map((e) => e.playerId))].sort();
  const coversAll =
    covered.length === agentIds.length && agentIds.every((id, i) => id === covered[i]);
  if (!coversAll) fail(`perAgent 未恰好覆盖全部 AI（期望 ${agentIds.length} 个）。`);

  // 3) 信息隔离负向扫描：凭据 / 营地 JSON token / 信念内部字段名 均不得出现在产物里
  const serialized = JSON.stringify(parsed.data);
  const isolation = scan('review.output', serialized, [
    credentialSentinels(config.baseUrl, config.apiKey),
    CAMP_SENTINELS,
    BELIEF_INTERNAL_SENTINELS,
  ]);
  const isolationPass = isolation.every((r) => r.pass);
  for (const r of isolation) {
    console.log(`[test:live:review] 隔离 ${r.channel}/${r.category}：${r.pass ? '通过' : '未通过'}`);
  }
  if (!isolationPass) fail('信息隔离扫描未通过，产物疑似含敏感串，已中止。');

  // 4) 脱敏可展示产物摘要（verdict/overall 本就是要落库并呈现给前端的脱敏结果）
  console.log(
    `[test:live:review] 生成成功：perAgent=${parsed.data.perAgent.length} 条，overall=${parsed.data.overall.length} 字，耗时=${elapsedMs}ms`,
  );
  for (const agent of parsed.data.perAgent) {
    const who = input.players.find((p) => p.playerId === agent.playerId)?.displayName ?? agent.playerId;
    console.log(
      `  · ${who}（rating=${agent.rating ?? '—'}，keyMoments=${agent.keyMoments.length}）：${agent.verdict}`,
    );
  }
  console.log(`[test:live:review] 总体点评：${parsed.data.overall}`);
  console.log('[test:live:review] 通过。真实复盘冒烟完成（未泄露 Base URL / API Key / 请求头 / 完整响应）。');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : 'UnknownError');
});
