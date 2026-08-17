import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

const preparingGame = {
  gameId: 'game-1',
  status: 'preparing',
  phase: 'preparing',
  revision: 0,
  eventCursor: 1,
  config: { difficulty: 'easy', undercoverCount: 1 },
  human: {
    playerId: 'human-1',
    displayName: '玩家',
    silhouette: 'silhouette_a',
    ownWordCard: '牛奶',
  },
  players: [
    { playerId: 'human-1', seatIndex: 0, kind: 'human', displayName: '玩家', alive: true },
    {
      playerId: 'agent-1',
      seatIndex: 1,
      kind: 'agent',
      displayName: 'DeepSeek',
      alive: true,
      agentRoleDisplay: 'DeepSeek',
    },
    {
      playerId: 'agent-2',
      seatIndex: 2,
      kind: 'agent',
      displayName: '豆包',
      alive: true,
      agentRoleDisplay: '豆包',
    },
    {
      playerId: 'agent-3',
      seatIndex: 3,
      kind: 'agent',
      displayName: '千问',
      alive: true,
      agentRoleDisplay: '千问',
    },
  ],
  round: null,
  publicTimeline: [],
  voteProgress: { completedPlayerIds: [] },
  legalVoteTargetIds: [],
  allowedCommands: ['StartGame', 'AbandonGame'],
  operationalStatus: { state: 'waiting_human' },
} as const;

const successBody = (data: unknown) => ({
  data,
  meta: { gameId: 'game-1', revision: 0, eventCursor: 1 },
});

const response = (body: unknown, ok = true) => ({ ok, json: async () => body });

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('仅保留猜词模式二期入口，复用 deta 版本提示并把焦点返回自身', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ data: { game: null } })));

    render(<App />);

    const modeGroup = await screen.findByRole('group', { name: '选择游戏模式' });
    expect(screen.queryByRole('button', { name: '历史复盘' })).not.toBeInTheDocument();
    expect(within(modeGroup).getByRole('button', { name: '经典模式' })).toBeInTheDocument();
    const trigger = within(modeGroup).getByRole('button', { name: '猜词模式' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '猜词模式暂未开放' })).toBeInTheDocument();
    expect(screen.getByText('当前为deta版本，正式上线后即可畅玩')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByRole('dialog', { name: '猜词模式暂未开放' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('无活动对局时显示创建表单并提交配置', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: { game: null } }))
      .mockResolvedValueOnce(response(successBody(preparingGame)));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('crypto', { randomUUID: () => 'command-create' });

    render(<App />);

    expect(await screen.findByRole('button', { name: '经典模式' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑玩家身份，当前名称为玩家' }));
    const playerDialog = screen.getByRole('dialog', { name: '编辑玩家身份' });
    fireEvent.change(within(playerDialog).getByLabelText('玩家名称'), { target: { value: '小祎' } });
    fireEvent.click(within(playerDialog).getByRole('radio', { name: /女性/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存身份' }));
    fireEvent.click(screen.getByRole('radio', { name: /困难/ }));
    fireEvent.click(screen.getByRole('button', { name: '经典模式' }));

    await screen.findByRole('heading', { name: '记住你的词牌' });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/games',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          commandId: 'command-create',
          human: { displayName: '小祎', silhouette: 'silhouette_b' },
          difficulty: 'hard',
        }),
      }),
    );
  });

  it('恢复准备对局时词牌默认隐藏，翻面不发请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { game: preparingGame } }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    const card = await screen.findByRole('button', { name: '词牌已隐藏，点击显示' });
    expect(screen.queryByText('牛奶')).not.toBeInTheDocument();
    const beforeFlip = fetchMock.mock.calls.length;

    fireEvent.click(card);
    expect(screen.getByText('牛奶')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(beforeFlip);

    fireEvent.click(screen.getByRole('button', { name: '词牌已显示，点击隐藏' }));
    expect(screen.queryByText('牛奶')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(beforeFlip);
  });

  it('恢复视图展示三个 AI 素材且 DOM 无私有字段', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ data: { game: preparingGame } })));

    const { container } = render(<App />);

    expect(await screen.findByAltText('DeepSeek 待机')).toBeInTheDocument();
    expect(screen.getByAltText('豆包 待机')).toBeInTheDocument();
    expect(screen.getByAltText('千问 待机')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('undercoverWord');
    expect(container.innerHTML).not.toContain('"camp"');
  });

  it('开始游戏后进入对局界面并显示当前 AI 行动者', async () => {
    const started = {
      ...preparingGame,
      status: 'in_progress',
      phase: 'speaking',
      revision: 1,
      eventCursor: 4,
      round: {
        number: 1,
        speakingOrder: ['agent-1', 'human-1', 'agent-2', 'agent-3'],
        currentActorId: 'agent-1',
        actionType: 'describe',
        tieCandidateIds: [],
      },
      allowedCommands: ['AbandonGame'],
      operationalStatus: { state: 'agent_working', actorId: 'agent-1' },
    } as const;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: { game: preparingGame } }))
      .mockResolvedValueOnce(response(successBody(started)));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('crypto', { randomUUID: () => 'command-start' });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '我已记住，开始游戏' }));

    expect(await screen.findByRole('heading', { name: '第 1 轮' })).toBeInTheDocument();
    expect(screen.getByText('当前行动者：DeepSeek')).toBeInTheDocument();
    expect(screen.getByLabelText('DeepSeek 正在组织描述…')).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/games/game-1/start',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('活动局为空时恢复最近正常终局，且可开始新对局', async () => {
    const finished = {
      ...preparingGame,
      status: 'finished',
      phase: 'ended',
      revision: 9,
      eventCursor: 22,
      round: null,
      winnerCamp: 'civilian',
      endReason: 'undercover_eliminated',
      reveal: {
        wordPair: { civilianWord: '牛奶', undercoverWord: '豆浆', category: '饮品' },
        players: preparingGame.players.map((player, index) => ({
          playerId: player.playerId,
          seatIndex: player.seatIndex,
          camp: index === 1 ? 'undercover' : 'civilian',
          wordCard: index === 1 ? '豆浆' : '牛奶',
        })),
      },
      factReview: { agentActions: [] },
      allowedCommands: [],
      operationalStatus: { state: 'idle' },
    } as const;
    localStorage.setItem('sheishiwodi:last-game-id', finished.gameId);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: { game: null } }))
      .mockResolvedValueOnce(response(successBody(finished)));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));

    render(<App />);
    expect(await screen.findByText('平民胜利')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复盘' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '历史复盘' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/games/game-1', undefined);
    fireEvent.click(screen.getByRole('button', { name: '开始新对局' }));
    expect(await screen.findByRole('button', { name: '经典模式' })).toBeInTheDocument();
    expect(localStorage.getItem('sheishiwodi:last-game-id')).toBeNull();
  });

  it('SSE 携带当前游标，旧或同游标视图不覆盖，更高游标才更新', async () => {
    const listeners = new Map<string, () => void>();
    const eventSources: Array<{ url: string; closed: boolean }> = [];
    class FakeEventSource {
      closed = false;
      onmessage: (() => void) | null = null;

      constructor(readonly url: string) {
        eventSources.push(this);
      }

      addEventListener(type: string, handler: () => void) {
        listeners.set(type, handler);
      }

      close() {
        this.closed = true;
      }
    }
    const active = {
      ...preparingGame,
      status: 'in_progress',
      phase: 'speaking',
      revision: 3,
      eventCursor: 8,
      round: {
        number: 1,
        speakingOrder: ['human-1', 'agent-1', 'agent-2', 'agent-3'],
        currentActorId: 'human-1',
        actionType: 'describe',
        tieCandidateIds: [],
      },
      allowedCommands: ['SubmitDescription', 'AbandonGame'],
      operationalStatus: { state: 'waiting_human', actorId: 'human-1' },
    } as const;
    const sameCursor = {
      ...active,
      revision: 99,
      round: { ...active.round, number: 99 },
    } as const;
    const newer = {
      ...active,
      revision: 4,
      eventCursor: 9,
      round: { ...active.round, number: 2 },
    } as const;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: { game: active } }))
      .mockResolvedValueOnce(response(successBody(sameCursor)))
      .mockResolvedValueOnce(response(successBody(newer)));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', FakeEventSource);

    render(<App />);
    expect(await screen.findByRole('heading', { name: '第 1 轮' })).toBeInTheDocument();
    expect(eventSources[0]?.url).toBe('/api/games/game-1/stream?after=8');
    expect(listeners.has('game_system_terminated')).toBe(true);
    expect(listeners.has('player_rule_violated')).toBe(true);

    listeners.get('round_started')?.();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('heading', { name: '第 1 轮' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '第 99 轮' })).not.toBeInTheDocument();

    listeners.get('round_started')?.();
    expect(await screen.findByRole('heading', { name: '第 2 轮' })).toBeInTheDocument();
  });
});
