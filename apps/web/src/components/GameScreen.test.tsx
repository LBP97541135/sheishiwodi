import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HumanGameView } from '@sheishiwodi/shared';

import { GameScreen } from './GameScreen';

const basePlayers = [
  { playerId: 'human-1', seatIndex: 0, kind: 'human', displayName: '玩家', alive: true },
  { playerId: 'agent-1', seatIndex: 1, kind: 'agent', displayName: 'DeepSeek', alive: true },
  { playerId: 'agent-2', seatIndex: 2, kind: 'agent', displayName: '豆包', alive: true },
  { playerId: 'agent-3', seatIndex: 3, kind: 'agent', displayName: '千问', alive: true },
] as const;

function makeView(overrides: Partial<HumanGameView> = {}): HumanGameView {
  return {
    gameId: 'game-1',
    status: 'in_progress',
    phase: 'speaking',
    revision: 3,
    eventCursor: 6,
    config: { difficulty: 'easy', undercoverCount: 1 },
    human: {
      playerId: 'human-1',
      displayName: '玩家',
      silhouette: 'silhouette_a',
      ownWordCard: '牛奶',
    },
    players: basePlayers.map((player) => ({ ...player })),
    round: {
      number: 1,
      speakingOrder: ['human-1', 'agent-1', 'agent-2', 'agent-3'],
      currentActorId: 'human-1',
      actionType: 'describe',
      tieCandidateIds: [],
    },
    publicTimeline: [],
    voteProgress: { completedPlayerIds: [] },
    legalVoteTargetIds: [],
    allowedCommands: ['SubmitDescription'],
    operationalStatus: { state: 'waiting_human' },
    ...overrides,
  } as HumanGameView;
}

const noop = async () => {};
const screenProps = {
  busy: false,
  error: null,
  onDescribe: noop,
  onDefense: noop,
  onVote: noop,
  onSpectate: noop,
  onAbandon: noop,
  onNewGame: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GameScreen 描述输入', () => {
  it('过短描述禁用提交并给出提示', () => {
    render(<GameScreen game={makeView()} {...screenProps} />);
    const textarea = screen.getByPlaceholderText(/描述你的词/);
    fireEvent.change(textarea, { target: { value: '好' } });
    expect(screen.getByText('至少写 2 个字')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交描述' })).toBeDisabled();
  });

  it('泄露原词时禁用提交', () => {
    render(<GameScreen game={makeView()} {...screenProps} />);
    fireEvent.change(screen.getByPlaceholderText(/描述你的词/), { target: { value: '我爱喝牛奶啊' } });
    expect(screen.getByText('不能直接说出你自己的词')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交描述' })).toBeDisabled();
  });

  it('合法描述提交去除首尾空格的文本', () => {
    const onDescribe = vi.fn().mockResolvedValue(undefined);
    render(
      <GameScreen game={makeView()} {...screenProps} onDescribe={onDescribe} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/描述你的词/), {
      target: { value: '  一种常见的白色饮品  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交描述' }));
    expect(onDescribe).toHaveBeenCalledWith('一种常见的白色饮品');
  });
});

describe('GameScreen 秘密投票', () => {
  const votingView = makeView({
    phase: 'voting',
    round: {
      number: 1,
      speakingOrder: ['human-1', 'agent-1', 'agent-2', 'agent-3'],
      currentActorId: 'human-1',
      actionType: 'vote',
      tieCandidateIds: [],
    },
    legalVoteTargetIds: ['agent-1', 'agent-2', 'agent-3'],
    voteProgress: { completedPlayerIds: [] },
  });

  it('只列出合法目标且需选择后确认', () => {
    const onVote = vi.fn().mockResolvedValue(undefined);
    render(<GameScreen game={votingView} {...screenProps} onVote={onVote} />);
    expect(screen.getByRole('radio', { name: 'DeepSeek' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '玩家' })).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: '确认投票' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: '豆包' }));
    fireEvent.click(screen.getByRole('button', { name: '确认投票' }));
    expect(onVote).toHaveBeenCalledWith('agent-2');
  });

  it('投票进度只显示完成人数，不出现目标', () => {
    const view = makeView({
      phase: 'voting',
      round: {
        number: 1,
        speakingOrder: ['human-1', 'agent-1', 'agent-2', 'agent-3'],
        currentActorId: 'human-1',
        actionType: 'vote',
        tieCandidateIds: [],
      },
      legalVoteTargetIds: ['agent-1', 'agent-2', 'agent-3'],
      voteProgress: { completedPlayerIds: ['agent-1'] },
      publicTimeline: [
        {
          eventSeq: 5,
          type: 'vote_progressed',
          occurredAt: '2026-08-16T12:00:00.000Z',
          payload: { playerId: 'agent-1' },
        },
      ],
    });
    const { container } = render(
      <GameScreen game={view} {...screenProps} />,
    );
    expect(screen.getByText('投票进度 1/4')).toBeInTheDocument();
    expect(screen.getByText('已秘密投票')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('targetPlayerId');
  });
});

describe('GameScreen 漫画事件', () => {
  it('统一揭票展示投票者与目标关系', () => {
    const view = makeView({
      publicTimeline: [
        {
          eventSeq: 7,
          type: 'votes_revealed',
          occurredAt: '2026-08-16T12:00:00.000Z',
          payload: {
            votes: [
              { voterId: 'human-1', targetPlayerId: 'agent-1' },
              { voterId: 'agent-1', targetPlayerId: 'human-1' },
            ],
          },
        },
      ],
    });
    render(<GameScreen game={view} {...screenProps} />);
    expect(screen.getByText('玩家 → DeepSeek')).toBeInTheDocument();
    expect(screen.getByText('DeepSeek → 玩家')).toBeInTheDocument();
  });

  it('淘汰事件显示出局印章', () => {
    const view = makeView({
      publicTimeline: [
        {
          eventSeq: 8,
          type: 'player_eliminated',
          occurredAt: '2026-08-16T12:00:00.000Z',
          payload: { playerId: 'agent-2' },
        },
      ],
    });
    render(<GameScreen game={view} {...screenProps} />);
    expect(screen.getByText('豆包 被淘汰')).toBeInTheDocument();
  });
});

describe('GameScreen 终局与观战', () => {
  it('平民胜利依次揭晓身份并在完成后开放事实复盘', async () => {
    const timeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((handler: TimerHandler) => {
        if (typeof handler === 'function') handler();
        return 1;
      }) as typeof setTimeout);
    const view = makeView({
      status: 'finished',
      phase: 'ended',
      round: null,
      winnerCamp: 'civilian',
      endReason: 'undercover_eliminated',
      reveal: {
        wordPair: { civilianWord: '牛奶', undercoverWord: '豆浆', category: '饮品' },
        players: [
          { playerId: 'human-1', seatIndex: 0, camp: 'civilian', wordCard: '牛奶' },
          { playerId: 'agent-1', seatIndex: 1, camp: 'undercover', wordCard: '豆浆' },
          { playerId: 'agent-2', seatIndex: 2, camp: 'civilian', wordCard: '牛奶' },
          { playerId: 'agent-3', seatIndex: 3, camp: 'civilian', wordCard: '牛奶' },
        ],
      },
      factReview: { agentActions: [] },
    });
    render(<GameScreen game={view} {...screenProps} />);
    expect(screen.getByText('平民胜利')).toBeInTheDocument();
    expect(screen.getByText(/卧底被票出/)).toBeInTheDocument();
    expect(timeoutSpy).toHaveBeenCalledTimes(4);
    expect(screen.getByText('豆浆')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看事实复盘' }));
    expect(screen.getByRole('heading', { name: '确定性事实复盘' })).toBeInTheDocument();
  });

  it('减少动态效果时直接展示全部身份', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const view = makeView({
      status: 'finished',
      phase: 'ended',
      round: null,
      winnerCamp: 'undercover',
      endReason: 'undercover_survived_to_two',
      reveal: {
        wordPair: { civilianWord: '牛奶', undercoverWord: '豆浆', category: '饮品' },
        players: [
          { playerId: 'human-1', seatIndex: 0, camp: 'civilian', wordCard: '牛奶' },
          { playerId: 'agent-1', seatIndex: 1, camp: 'undercover', wordCard: '豆浆' },
        ],
      },
      factReview: { agentActions: [] },
    });
    render(<GameScreen game={view} {...screenProps} />);
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(screen.getByText('豆浆')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看事实复盘' })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('等待观战显示继续与二次确认放弃', () => {
    const onSpectate = vi.fn().mockResolvedValue(undefined);
    const onAbandon = vi.fn().mockResolvedValue(undefined);
    const view = makeView({
      status: 'awaiting_spectator',
      phase: 'ended',
      round: null,
      players: basePlayers.map((player) =>
        player.playerId === 'human-1' ? { ...player, alive: false } : { ...player },
      ),
      allowedCommands: ['ContinueSpectating', 'AbandonGame'],
    });
    render(
      <GameScreen
        game={view}
        {...screenProps}
        onSpectate={onSpectate}
        onAbandon={onAbandon}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '继续观战' }));
    expect(onSpectate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '放弃本局' }));
    expect(screen.getByText('确认放弃本局？')).toBeInTheDocument();
    expect(onAbandon).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByText('确认放弃本局？')).not.toBeInTheDocument();
  });

  it('人类出局后进入观战提示且无操作控件', () => {
    const view = makeView({
      players: basePlayers.map((player) =>
        player.playerId === 'human-1' ? { ...player, alive: false } : { ...player },
      ),
      round: {
        number: 2,
        speakingOrder: ['agent-1', 'agent-2', 'agent-3'],
        currentActorId: 'agent-1',
        actionType: 'describe',
        tieCandidateIds: [],
      },
    });
    render(<GameScreen game={view} {...screenProps} />);
    expect(screen.getByText('你已出局，继续观战')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交描述' })).not.toBeInTheDocument();
  });

  it('平票候选轮到人类时显示辩解输入并提交辩解', () => {
    const onDefense = vi.fn().mockResolvedValue(undefined);
    const view = makeView({
      phase: 'tie_defense',
      round: {
        number: 1,
        speakingOrder: ['human-1', 'agent-1', 'agent-2', 'agent-3'],
        currentActorId: 'human-1',
        actionType: 'defend',
        tieCandidateIds: ['human-1', 'agent-1'],
      },
      allowedCommands: ['SubmitDefense', 'AbandonGame'],
    });
    render(
      <GameScreen game={view} {...screenProps} onDefense={onDefense} />,
    );
    expect(screen.getByText('轮到你为自己辩解')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/回应大家的怀疑/), {
      target: { value: '我的线索一直保持一致' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交辩解' }));
    expect(onDefense).toHaveBeenCalledWith('我的线索一直保持一致');
  });

  it('非候选人类重投时只显示平票候选', () => {
    const onVote = vi.fn().mockResolvedValue(undefined);
    const view = makeView({
      phase: 'revoting',
      round: {
        number: 1,
        speakingOrder: ['human-1', 'agent-1', 'agent-2', 'agent-3'],
        currentActorId: 'human-1',
        actionType: 'revote',
        tieCandidateIds: ['agent-1', 'agent-2'],
      },
      legalVoteTargetIds: ['agent-1', 'agent-2'],
      voteProgress: { completedPlayerIds: ['agent-3'] },
    });
    render(
      <GameScreen game={view} {...screenProps} onVote={onVote} />,
    );
    expect(screen.getByText('重投进度 1/2')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'DeepSeek' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '豆包' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '千问' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '豆包' }));
    fireEvent.click(screen.getByRole('button', { name: '确认重投' }));
    expect(onVote).toHaveBeenCalledWith('agent-2');
  });

  it('重投再次平票显示本轮无人出局分镜', () => {
    const view = makeView({
      publicTimeline: [
        {
          eventSeq: 12,
          type: 'round_ended_without_elimination',
          occurredAt: '2026-08-16T12:00:00.000Z',
          payload: { reason: 'revote_tie' },
        },
      ],
    });
    render(
      <GameScreen game={view} {...screenProps} />,
    );
    expect(screen.getByText('无人出局')).toBeInTheDocument();
    expect(screen.getByText('重投仍然平票')).toBeInTheDocument();
  });
});

describe('GameScreen 信息隔离', () => {
  it('渲染的 DOM 不包含阵营或私有词字段', () => {
    const view = makeView({
      publicTimeline: [
        {
          eventSeq: 5,
          type: 'speech_published',
          occurredAt: '2026-08-16T12:00:00.000Z',
          payload: { actorId: 'agent-1', actionType: 'describe', text: '一种液体' },
        },
      ],
    });
    const { container } = render(
      <GameScreen game={view} {...screenProps} />,
    );
    const html = container.innerHTML;
    expect(html).not.toContain('camp');
    expect(html).not.toContain('undercover');
    expect(html).not.toContain('civilian');
    expect(html).not.toContain('豆浆');
  });
});
