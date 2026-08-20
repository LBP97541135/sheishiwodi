import { describe, expect, it } from 'vitest';

import type { ReviewSummary } from '@sheishiwodi/shared';

import type { ReviewInput } from '../agents/review-policy.js';
import {
  ReviewMarkdownLeakError,
  assertReviewMarkdownClean,
  buildReviewMarkdown,
} from './review-markdown.js';

function makeInput(): ReviewInput {
  return {
    gameId: 'game-md-1',
    gameMode: 'classic',
    winnerCamp: 'civilian',
    endReason: 'undercover_eliminated',
    reveal: {
      wordPair: { civilianWord: '牛奶', undercoverWord: '豆浆', category: '饮品' },
      players: [
        { playerId: 'human-1', seatIndex: 0, camp: 'civilian', wordCard: '牛奶' },
        { playerId: 'agent-1', seatIndex: 1, camp: 'undercover', wordCard: '豆浆' },
        { playerId: 'agent-2', seatIndex: 2, camp: 'civilian', wordCard: '牛奶' },
      ],
    },
    players: [
      { playerId: 'human-1', displayName: '玩家', kind: 'human' },
      { playerId: 'agent-1', displayName: 'DeepSeek', kind: 'agent' },
      { playerId: 'agent-2', displayName: '豆包', kind: 'agent' },
    ],
    publicTimeline: [
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
        eventSeq: 4,
        type: 'player_eliminated',
        occurredAt: '2026-08-17T12:00:03.000Z',
        payload: { playerId: 'agent-1' },
      },
    ],
    factReview: {
      agentActions: [
        {
          actionId: 'act-1',
          playerId: 'agent-1',
          roundNumber: 1,
          actionType: 'describe',
          baseRevision: 2,
          belief: {
            reasoningSummary: '先把描述彻底模糊化，避免暴露',
            playerUndercoverProbabilities: [
              { playerId: 'agent-1', probability: 0.6 },
              { playerId: 'agent-2', probability: 0.3 },
              { playerId: 'human-1', probability: 0.1 },
            ],
            opposingWordCandidates: [
              { word: '牛奶', confidence: 0.7, evidence: '大家都提到早餐会喝' },
            ],
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
            reasoningSummary: 'DeepSeek 最含糊，优先投他',
            playerUndercoverProbabilities: [
              { playerId: 'agent-1', probability: 0.7 },
              { playerId: 'agent-2', probability: 0.2 },
              { playerId: 'human-1', probability: 0.1 },
            ],
            opposingWordCandidates: [],
          },
          output: { targetPlayerId: 'agent-1', reason: '他的描述最模糊，像在回避真实词' },
          completedAt: '2026-08-17T12:00:02.000Z',
        },
      ],
    },
  };
}

function doneSummary(): ReviewSummary {
  return {
    gameId: 'game-md-1',
    status: 'done',
    modelId: 'deepseek-v4-flash',
    generatedAt: '2026-08-17T12:05:00.000Z',
    perAgent: [
      {
        playerId: 'agent-1',
        verdict: 'DeepSeek 作为卧底描述过于笼统，早早暴露。',
        keyMoments: ['第 1 轮用「白色饮品」自曝'],
        rating: 2,
      },
    ],
    overall: '平民凭借豆包的稳健描述锁定卧底，关键转折在第 1 轮统一揭票。',
  };
}

describe('buildReviewMarkdown', () => {
  it('包含对局信息、身份、时间线、信念与 AI 评价各区块', () => {
    const md = buildReviewMarkdown({ input: makeInput(), summary: doneSummary() });

    // 对局信息
    expect(md).toContain('# 对局复盘 · 饮品');
    expect(md).toContain('| 胜方 | 平民阵营 |');
    expect(md).toContain('| 游戏模式 | 经典模式 |');
    expect(md).toContain('| 卧底已被淘汰，平民阵营获胜 |');
    expect(md).toContain('| 平民词 | 牛奶 |');
    expect(md).toContain('| 卧底词 | 豆浆 |');

    // 真实身份（卧底 + 词牌）
    expect(md).toContain('| 2 | DeepSeek | 卧底 | 豆浆 |');

    // 公开时间线
    expect(md).toContain('### 第 1 轮');
    expect(md).toContain('**DeepSeek** 描述：一种常见的白色饮品');
    expect(md).toContain('出局：DeepSeek 被淘汰');

    // 信念（心理独白 / 怀疑分布 / 猜词 / 投票理由）
    expect(md).toContain('心理独白：先把描述彻底模糊化，避免暴露');
    expect(md).toContain('怀疑分布：DeepSeek 60%；豆包 30%；玩家 10%');
    expect(md).toContain('对方词猜测：牛奶（70%，依据：大家都提到早餐会喝）');
    expect(md).toContain('实际投票：投给 DeepSeek，理由：他的描述最模糊，像在回避真实词');

    // AI 评价
    expect(md).toContain('## AI 复盘评价');
    expect(md).toContain('deepseek-v4-flash');
    expect(md).toContain('平民凭借豆包的稳健描述锁定卧底');
    expect(md).toContain('#### DeepSeek ★★☆☆☆');
    expect(md).toContain('DeepSeek 作为卧底描述过于笼统');
    expect(md).toContain('- 第 1 轮用「白色饮品」自曝');
  });

  it('AI 评价未生成时仅标注状态，不臆造内容', () => {
    const md = buildReviewMarkdown({ input: makeInput(), summary: null });
    expect(md).toContain('## AI 复盘评价');
    expect(md).toContain('尚未生成');
    expect(md).not.toContain('总体点评');
  });

  it('AI 评价生成中时标注中文状态', () => {
    const summary: ReviewSummary = {
      gameId: 'game-md-1',
      status: 'generating',
      modelId: 'deepseek-v4-flash',
      perAgent: [],
      overall: '',
    };
    const md = buildReviewMarkdown({ input: makeInput(), summary });
    expect(md).toContain('当前状态：生成中');
  });

  it('猜词模式导出精简的 AI 猜词决策区块', () => {
    const summary: ReviewSummary = {
      ...doneSummary(),
      guessAnalysisStatus: 'done',
      guessAnalysis: {
        summary: 'AI 在具体词语置信度较高时使用猜词，整体时机合理。',
        keyDecisions: [
          {
            actionId: 'guess-action-1',
            actorId: 'agent-1',
            roundNumber: 1,
            phase: 'describe',
            kind: 'attempt',
            verdict: 'reasonable',
            assessment: '行动时的公开信息和词语候选能够相互支持。',
            outcomeImpact: '猜词成功后目标立即出局。',
          },
        ],
      },
    };
    const md = buildReviewMarkdown({
      input: { ...makeInput(), gameMode: 'guess' },
      summary,
    });
    expect(md).toContain('| 游戏模式 | 猜词模式 |');
    expect(md).toContain('### AI 猜词决策');
    expect(md).toContain('DeepSeek · 第 1 轮发言 · 合理');
    expect(md).toContain('实际影响：猜词成功后目标立即出局');
  });

  it('输出末尾以单个换行结尾且不含连续空行', () => {
    const md = buildReviewMarkdown({ input: makeInput(), summary: doneSummary() });
    expect(md.endsWith('\n')).toBe(true);
    expect(md).not.toMatch(/\n{3,}/);
  });
});

describe('assertReviewMarkdownClean', () => {
  it('普通复盘文本通过自检', () => {
    const md = buildReviewMarkdown({ input: makeInput(), summary: doneSummary() });
    expect(() => assertReviewMarkdownClean(md)).not.toThrow();
  });

  it('命中凭据禁用串时抛 ReviewMarkdownLeakError', () => {
    expect(() => assertReviewMarkdownClean('正常\nAuthorization: Bearer secret\n')).toThrow(
      ReviewMarkdownLeakError,
    );
  });
});
