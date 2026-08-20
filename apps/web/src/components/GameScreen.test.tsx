import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  onReview: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GameScreen 描述输入', () => {
  it('空输入时说明提交条件', () => {
    render(<GameScreen game={makeView()} {...screenProps} />);
    expect(screen.getByText('至少输入 2 个字后可提交；最多 40 字，不能直接说出原词')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交描述' })).toBeDisabled();
  });

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

  it('猜词模式在本人发言时经过风险确认提交一次精确猜测', () => {
    const onGuess = vi.fn().mockResolvedValue(undefined);
    render(
      <GameScreen
        game={makeView({
          config: { difficulty: 'easy', undercoverCount: 1, gameMode: 'guess' },
          human: {
            playerId: 'human-1',
            displayName: '玩家',
            silhouette: 'silhouette_a',
            ownWordCard: '牛奶',
            guessUsed: false,
          },
          allowedCommands: ['SubmitDescription', 'SubmitGuess'],
        })}
        {...screenProps}
        onGuess={onGuess}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '发起猜测' }));
    const dialog = screen.getByRole('dialog', { name: '发起猜测' });
    expect(within(dialog).getByText(/身份或词语任一错误/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('目标玩家'), { target: { value: 'agent-2' } });
    fireEvent.change(within(dialog).getByLabelText('目标的精确词语'), { target: { value: '  豆浆  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '核对猜测' }));
    expect(within(dialog).getByText('确认猜测 豆包 的词是“豆浆”？')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认并提交' }));
    expect(onGuess).toHaveBeenCalledWith('agent-2', '豆浆');
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

  it('投票开始时所有存活玩家同步进入思考状态', () => {
    render(<GameScreen game={votingView} {...screenProps} />);

    const seats = within(screen.getByLabelText('本局玩家'));
    expect(seats.getByTestId('portrait-human-male')).toHaveAttribute('data-state', 'thinking');
    expect(seats.getByTestId('portrait-deepseek')).toHaveAttribute('data-state', 'thinking');
    expect(seats.getByTestId('portrait-doubao')).toHaveAttribute('data-state', 'thinking');
    expect(seats.getByTestId('portrait-qwen')).toHaveAttribute('data-state', 'thinking');
    expect(screen.getAllByText('你 · 思考中')).toHaveLength(2);
    expect(screen.getAllByText('思考中')).toHaveLength(3);
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
    expect(screen.getByTestId('portrait-deepseek')).toHaveAttribute('data-state', 'idle');
    expect(screen.getByTestId('portrait-doubao')).toHaveAttribute('data-state', 'thinking');
    expect(screen.getByTestId('portrait-qwen')).toHaveAttribute('data-state', 'thinking');
    expect(container.innerHTML).not.toContain('targetPlayerId');
  });

  it('重投时只有非候选且尚未完成的玩家进入思考状态', () => {
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

    render(<GameScreen game={view} {...screenProps} />);

    const seats = within(screen.getByLabelText('本局玩家'));
    expect(seats.getByTestId('portrait-human-male')).toHaveAttribute('data-state', 'thinking');
    expect(seats.getByTestId('portrait-deepseek')).toHaveAttribute('data-state', 'suspected');
    expect(seats.getByTestId('portrait-doubao')).toHaveAttribute('data-state', 'suspected');
    expect(seats.getByTestId('portrait-qwen')).toHaveAttribute('data-state', 'idle');
  });
});

describe('GameScreen 漫画事件', () => {
  it('AI 行动时在时间线内显示临时思考卡', () => {
    const view = makeView({
      round: {
        number: 1,
        speakingOrder: ['human-1', 'agent-1', 'agent-2', 'agent-3'],
        currentActorId: 'agent-1',
        actionType: 'describe',
        tieCandidateIds: [],
      },
      allowedCommands: [],
    });
    render(<GameScreen game={view} {...screenProps} />);
    expect(screen.getByLabelText('DeepSeek 正在组织描述…')).toBeInTheDocument();
    expect(screen.getByText('正在组织描述…')).toBeInTheDocument();
  });

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

  it('用户查看历史时暂停镜头跟随，并可回到最新内容', () => {
    const view = makeView({
      publicTimeline: [
        {
          eventSeq: 4,
          type: 'speech_published',
          occurredAt: '2026-08-16T12:00:00.000Z',
          payload: { actorId: 'agent-1', actionType: 'describe', text: '一种常见的白色饮品' },
        },
        {
          eventSeq: 5,
          type: 'speech_published',
          occurredAt: '2026-08-16T12:00:01.000Z',
          payload: { actorId: 'agent-2', actionType: 'describe', text: '每天早餐经常会喝到' },
        },
      ],
    });
    render(<GameScreen game={view} {...screenProps} />);
    const timeline = screen.getByRole('list', { name: '对局时间线' });
    const scrollTo = vi.fn();
    Object.defineProperties(timeline, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, value: 0, writable: true },
      scrollTo: { configurable: true, value: scrollTo },
    });

    fireEvent.wheel(timeline, { deltaY: -120 });
    fireEvent.scroll(timeline);
    expect(screen.getByRole('button', { name: '回到当前 ↓' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '回到当前 ↓' }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 600, behavior: 'smooth' });
  });
});

describe('GameScreen 人类操作区', () => {
  it('新的人类回合仅在操作区不在视口内时定位至该区域', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 900,
      height: 200,
      left: 0,
      right: 800,
      top: 700,
      width: 800,
      x: 0,
      y: 700,
      toJSON: () => ({}),
    });

    render(<GameScreen game={makeView()} {...screenProps} />);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
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
    expect(screen.getByText(/卧底已被淘汰/)).toBeInTheDocument();
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

describe('GameScreen Agent 错误结果', () => {
  it('系统自动恢复耗尽后显示安全终止提示并允许开始新局', () => {
    const onNewGame = vi.fn();
    render(
      <GameScreen
        game={makeView({
          status: 'system_terminated',
          phase: 'ended',
          round: null,
          endReason: 'model_failure_limit',
          allowedCommands: [],
          operationalStatus: { state: 'idle' },
        })}
        {...screenProps}
        onNewGame={onNewGame}
      />,
    );

    expect(screen.getByText('模型服务异常，本局已终止')).toBeInTheDocument();
    expect(screen.getByText(/本局不判定阵营胜负/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '开始新对局' }));
    expect(onNewGame).toHaveBeenCalledTimes(1);
  });

  it('规则违规分镜只显示安全结论，不显示词牌或失败原文', () => {
    const { container } = render(
      <GameScreen
        game={makeView({
          publicTimeline: [
            {
              eventSeq: 7,
              type: 'player_rule_violated',
              occurredAt: '2026-08-17T12:00:00.000Z',
              payload: { playerId: 'agent-1', rule: 'word_leak', failedActionId: 'safe-id' },
            },
          ],
        })}
        {...screenProps}
      />,
    );

    expect(screen.getByText('DeepSeek 连续违反发言规则')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('豆浆');
    expect(container.innerHTML).not.toContain('ownWordCard');
  });
});
