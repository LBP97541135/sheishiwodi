import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HumanGameView, ReviewSummary } from '@sheishiwodi/shared';

import { getReview, regenerateReview } from '../api';
import { ReviewScreen } from './ReviewScreen';

vi.mock('../api', () => ({
  getReview: vi.fn(),
  regenerateReview: vi.fn(),
  reviewExportPath: (gameId: string) => `/api/games/${gameId}/export.md`,
}));

const getReviewMock = vi.mocked(getReview);
const regenerateReviewMock = vi.mocked(regenerateReview);

function doneSummary(): ReviewSummary {
  return {
    gameId: 'game-review-1',
    status: 'done',
    modelId: 'ds-v4flash',
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

beforeEach(() => {
  // 默认给一个 done，避免既有用例触发轮询定时器；针对性用例再各自覆盖。
  getReviewMock.mockResolvedValue(doneSummary());
  regenerateReviewMock.mockReset();
});

const describeBelief = {
  reasoningSummary: '我感觉自己的词和多数人不太一样，先把描述彻底模糊化',
  playerUndercoverProbabilities: [
    { playerId: 'agent-1', probability: 0.6 },
    { playerId: 'agent-2', probability: 0.3 },
    { playerId: 'human-1', probability: 0.1 },
  ],
  opposingWordCandidates: [{ word: '牛奶', confidence: 0.7, evidence: '大家都提到早餐会喝' }],
};

const voteBelief = {
  reasoningSummary: '豆包描述最含糊，优先投他',
  playerUndercoverProbabilities: [
    { playerId: 'agent-1', probability: 0.2 },
    { playerId: 'agent-2', probability: 0.7 },
    { playerId: 'human-1', probability: 0.1 },
  ],
  opposingWordCandidates: [],
};

function makeFinishedView(): HumanGameView {
  return {
    gameId: 'game-review-1',
    status: 'finished',
    phase: 'ended',
    revision: 12,
    eventCursor: 30,
    config: { difficulty: 'easy', undercoverCount: 1 },
    human: {
      playerId: 'human-1',
      displayName: '玩家',
      silhouette: 'silhouette_a',
      ownWordCard: '牛奶',
    },
    players: [
      { playerId: 'human-1', seatIndex: 0, kind: 'human', displayName: '玩家', alive: true },
      { playerId: 'agent-1', seatIndex: 1, kind: 'agent', displayName: 'DeepSeek', alive: false },
      { playerId: 'agent-2', seatIndex: 2, kind: 'agent', displayName: '豆包', alive: true },
    ],
    round: null,
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
    voteProgress: { completedPlayerIds: [] },
    legalVoteTargetIds: [],
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
    factReview: {
      agentActions: [
        {
          actionId: 'act-1',
          playerId: 'agent-1',
          roundNumber: 1,
          actionType: 'describe',
          baseRevision: 2,
          belief: describeBelief,
          output: { text: '一种常见的白色饮品' },
          completedAt: '2026-08-17T12:00:01.000Z',
        },
        {
          actionId: 'act-2',
          playerId: 'agent-1',
          roundNumber: 1,
          actionType: 'vote',
          baseRevision: 6,
          belief: voteBelief,
          output: { targetPlayerId: 'agent-2', reason: '他的描述最模糊' },
          completedAt: '2026-08-17T12:00:02.000Z',
        },
      ],
    },
    allowedCommands: [],
    operationalStatus: { state: 'idle' },
  } as HumanGameView;
}

function makeGuessFinishedView(): HumanGameView {
  const view = makeFinishedView();
  return {
    ...view,
    config: { ...view.config, gameMode: 'guess' },
    factReview: {
      ...view.factReview!,
      guesses: [
        {
          actorId: 'agent-1',
          targetPlayerId: 'agent-2',
          guessedWord: '牛奶',
          roundNumber: 1,
          phase: 'describe',
          success: true,
          eliminatedPlayerId: 'agent-2',
        },
      ],
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ReviewScreen', () => {
  it('揭晓词对与胜负', () => {
    render(<ReviewScreen game={makeFinishedView()} onBack={vi.fn()} />);
    expect(screen.getByText('平民胜利')).toBeInTheDocument();
    expect(screen.getByText(/卧底已被淘汰/)).toBeInTheDocument();
    expect(screen.getByText('经典模式')).toBeInTheDocument();
    expect(screen.getByText('饮品')).toBeInTheDocument();
    // 平民词与卧底词分别揭晓
    const wordpair = screen.getByText('卧底词').closest('div')!;
    expect(within(wordpair).getByText('豆浆')).toBeInTheDocument();
  });

  it('身份区标注卧底及其词牌', () => {
    render(<ReviewScreen game={makeFinishedView()} onBack={vi.fn()} />);
    const identities = screen.getByRole('region', { name: '真实身份与词牌' });
    const card = within(identities).getByText('DeepSeek').closest('.review-identity-card')!;
    expect(within(card as HTMLElement).getByText('卧底')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('豆浆')).toBeInTheDocument();
  });

  it('展开 AI 发言显示当时的心理独白、怀疑分布与猜词', () => {
    render(<ReviewScreen game={makeFinishedView()} onBack={vi.fn()} />);
    expect(screen.getByText('一种常见的白色饮品')).toBeInTheDocument();
    const toggles = screen.getAllByRole('button', { name: '展开心理活动' });
    fireEvent.click(toggles[0]!);
    expect(screen.getByText(describeBelief.reasoningSummary)).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('大家都提到早餐会喝')).toBeInTheDocument();
  });

  it('展开投票节点显示投票理由', () => {
    render(<ReviewScreen game={makeFinishedView()} onBack={vi.fn()} />);
    // 投票信念节点标题包含目标
    const voteNode = screen.getByText('投给 豆包').closest('.review-node')!;
    fireEvent.click(within(voteNode as HTMLElement).getByRole('button', { name: '展开心理活动' }));
    expect(screen.getByText(/他的描述最模糊/)).toBeInTheDocument();
  });

  it('人类玩家发言无可展开心理活动', () => {
    render(<ReviewScreen game={makeFinishedView()} onBack={vi.fn()} />);
    // 时间线里只有 agent-1 一次描述带信念，human 未描述；揭票里 human 无信念节点
    expect(screen.queryByText('投给 DeepSeek')).not.toBeInTheDocument();
  });

  it('提供导出 Markdown 的下载链接', () => {
    render(<ReviewScreen game={makeFinishedView()} onBack={vi.fn()} />);
    const link = screen.getByRole('link', { name: '导出 Markdown' });
    expect(link).toHaveAttribute('href', '/api/games/game-review-1/export.md');
    expect(link).toHaveAttribute('download');
  });

  it('返回按钮触发 onBack', () => {
    const onBack = vi.fn();
    render(<ReviewScreen game={makeFinishedView()} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: '返回对局' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('AI 复盘完成后与事实区分区展示评价、评分与总体点评', async () => {
    render(<ReviewScreen game={makeFinishedView()} onBack={vi.fn()} />);
    const region = await screen.findByRole('region', { name: 'AI 复盘评价' });
    expect(getReviewMock).toHaveBeenCalledWith('game-review-1');
    expect(within(region).getByText(/模型：ds-v4flash/)).toBeInTheDocument();
    expect(within(region).getByText(/平民凭借豆包的稳健描述锁定卧底/)).toBeInTheDocument();
    expect(within(region).getByText(/描述过于笼统/)).toBeInTheDocument();
    expect(within(region).getByText(/第 1 轮用「白色饮品」自曝/)).toBeInTheDocument();
    // 评价区与事实身份区是相互独立的 region。
    expect(region).not.toBe(screen.getByRole('region', { name: '真实身份与词牌' }));
  });

  it('猜词模式精简展示折叠事实与最多三个 AI 关键决策', async () => {
    getReviewMock.mockResolvedValue({
      ...doneSummary(),
      guessAnalysisStatus: 'done',
      guessAnalysis: {
        summary: 'AI 在目标与词语置信度较高时使用猜词，整体时机合理。',
        keyDecisions: [
          {
            actionId: 'guess-action-1',
            actorId: 'agent-1',
            roundNumber: 1,
            phase: 'describe',
            kind: 'attempt',
            verdict: 'reasonable',
            assessment: '行动时已有足够公开证据支持目标和词语判断。',
            outcomeImpact: '猜词成功后目标立即出局。',
          },
        ],
      },
    });

    render(<ReviewScreen game={makeGuessFinishedView()} onBack={vi.fn()} />);

    expect(screen.getByText('猜词模式')).toBeInTheDocument();
    expect(screen.getByText('猜词记录（1）')).toBeInTheDocument();
    const region = await screen.findByRole('region', { name: 'AI 复盘评价' });
    expect(within(region).getByText('AI 猜词决策')).toBeInTheDocument();
    expect(within(region).getByText('合理')).toBeInTheDocument();
    expect(within(region).getByText(/行动时已有足够公开证据/)).toBeInTheDocument();
    expect(within(region).getByText(/实际影响：猜词成功后目标立即出局/)).toBeInTheDocument();
  });

  it('猜词专项失败时保留基础复盘并显示局部降级提示', async () => {
    getReviewMock.mockResolvedValue({
      ...doneSummary(),
      guessAnalysisStatus: 'failed',
    });
    render(<ReviewScreen game={makeGuessFinishedView()} onBack={vi.fn()} />);
    const region = await screen.findByRole('region', { name: 'AI 复盘评价' });
    expect(within(region).getByText(/猜词专项分析暂未生成/)).toBeInTheDocument();
    expect(within(region).getByText(/平民凭借豆包的稳健描述锁定卧底/)).toBeInTheDocument();
  });

  it('AI 复盘生成中显示占位文案', async () => {
    getReviewMock.mockResolvedValue({
      gameId: 'game-review-1',
      status: 'generating',
      modelId: 'ds-v4flash',
      perAgent: [],
      overall: '',
    });
    render(<ReviewScreen game={makeFinishedView()} onBack={vi.fn()} />);
    expect(await screen.findByText(/AI 正在复盘本局/)).toBeInTheDocument();
  });

  it('AI 复盘失败显示脱敏原因并可重新生成', async () => {
    getReviewMock.mockResolvedValue({
      gameId: 'game-review-1',
      status: 'failed',
      modelId: 'ds-v4flash',
      errorCode: 'CALL_TIMEOUT',
      perAgent: [],
      overall: '',
    });
    regenerateReviewMock.mockResolvedValue({
      gameId: 'game-review-1',
      status: 'pending',
      modelId: 'ds-v4flash',
      perAgent: [],
      overall: '',
    });
    render(<ReviewScreen game={makeFinishedView()} onBack={vi.fn()} />);
    expect(await screen.findByText(/复盘模型响应超时/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    expect(regenerateReviewMock).toHaveBeenCalledWith('game-review-1');
  });
});
