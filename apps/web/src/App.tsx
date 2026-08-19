import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

import type {
  CreateGameRequest,
  HumanGameView,
} from '@sheishiwodi/shared';

import {
  ApiClientError,
  getActiveGame,
  getGame,
} from './api';
import { GameScreen } from './components/GameScreen';
import { ExperienceControls, useExperienceSettings } from './experience-settings';
import { ModelProfiles } from './components/ModelProfiles';
import { NewGameForm } from './components/NewGameForm';
import { PreparingGame } from './components/PreparingGame';
import { ReviewScreen } from './components/ReviewScreen';
import {
  executeTrackedGameCommand,
  readPendingGameCommand,
  settlePendingGameCommand,
  type PendingGameCommand,
} from './game-command-recovery';
import { useGameStream } from './use-game-stream';

type LoadState = 'loading' | 'ready' | 'failed';
type TopView = 'game' | 'model-profiles' | 'review';

const LAST_GAME_KEY = 'sheishiwodi:last-game-id';

export function App() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [game, setGame] = useState<HumanGameView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topView, setTopView] = useState<TopView>('game');
  const [guessModeNoticeOpen, setGuessModeNoticeOpen] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // 首帧一次性捕获待恢复的最近对局 ID（在任何 effect 之前），
  // 以便持久化 effect 的空态分支可以安全地清除 key 而不影响恢复。
  const [restoredLastGameId] = useState<string | null>(() =>
    typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_GAME_KEY) : null,
  );
  const gameRef = useRef<HumanGameView | null>(null);
  const eventCursorRef = useRef(0);
  const guessModeTriggerRef = useRef<HTMLButtonElement | null>(null);
  // 背景音乐在整个应用（含主页、模型档案）持续播放，由顶部开关与浏览器自动播放解锁控制。
  const shouldPlayBgm = true;
  const experience = useExperienceSettings(shouldPlayBgm);
  gameRef.current = game;
  eventCursorRef.current = game?.eventCursor ?? 0;

  useEffect(() => {
    const controller = new AbortController();
    const pendingCommand = readPendingGameCommand();
    const initialGame = pendingCommand
      ? settlePendingGameCommand(pendingCommand)
      : getActiveGame();
    void initialGame
      .then(async (activeGame) => {
        if (controller.signal.aborted) return null;
        if (activeGame) return activeGame;
        if (pendingCommand?.kind === 'recovery' && pendingCommand.request.resolution === 'start_new') {
          return null;
        }
        const lastGameId = restoredLastGameId;
        if (!lastGameId) return null;
        try {
          const lastGame = await getGame(lastGameId);
          return lastGame.status === 'finished' || lastGame.status === 'abandoned' ? lastGame : null;
        } catch {
          localStorage.removeItem(LAST_GAME_KEY);
          return null;
        }
      })
      .then((restoredGame) => {
        if (!controller.signal.aborted) {
          setGame(restoredGame);
          setLoadState('ready');
        }
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(messageFor(loadError));
          setLoadState('failed');
        }
      });

    return () => controller.abort();
  }, [loadAttempt, restoredLastGameId]);

  useEffect(() => {
    if (game?.gameId) localStorage.setItem(LAST_GAME_KEY, game.gameId);
    else localStorage.removeItem(LAST_GAME_KEY);
  }, [game?.gameId]);

  const refresh = useCallback((gameId: string, force = false) => {
    void getGame(gameId)
      .then((view) => {
        const current = gameRef.current;
        // 允许同一事实版本更新运行状态；拒绝同游标但不同 revision 的乱序响应。
        if (
          (force && (!current || view.eventCursor >= current.eventCursor)) ||
          !current ||
          current.gameId !== view.gameId ||
          view.eventCursor > current.eventCursor ||
          (view.eventCursor === current.eventCursor && view.revision === current.revision)
        ) {
          setGame(view);
        }
      })
      .catch(() => {
        /* 断流时静默，等待下一次心跳或用户操作重新拉取 */
      });
  }, []);

  // 对局进行中通过 SSE 感知服务端自动推进，收到安全帧后重新拉取完整安全视图。
  const gameId = game?.gameId;
  const live = game?.status === 'in_progress' || game?.status === 'awaiting_spectator';
  const currentCursor = useCallback(() => eventCursorRef.current, []);
  const stream = useGameStream({
    ...(gameId ? { gameId } : {}),
    enabled: live,
    currentCursor,
    synchronize: refresh,
  });

  const runCommand = useCallback(async (command: PendingGameCommand) => {
    setBusy(true);
    setError(null);
    try {
      setGame(await executeTrackedGameCommand(command));
    } catch (commandError) {
      setError(messageForCommand(commandError));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleCreate = async (input: CreateGameRequest) => {
    await runCommand({ version: 1, kind: 'create', request: input });
  };

  const handleStart = async () => {
    if (!game) return;
    await runCommand({
      version: 1,
      kind: 'start',
      gameId: game.gameId,
      expectedRevision: game.revision,
      request: {
        commandId: crypto.randomUUID(),
        actorId: game.human.playerId,
        expectedRevision: game.revision,
      },
    });
  };

  const handleDescribe = async (text: string) => {
    if (!game) return;
    await runCommand({
      version: 1,
      kind: 'description',
      gameId: game.gameId,
      expectedRevision: game.revision,
      request: {
        commandId: crypto.randomUUID(),
        actorId: game.human.playerId,
        expectedRevision: game.revision,
        text,
      },
    });
  };

  const handleDefense = async (text: string) => {
    if (!game) return;
    await runCommand({
      version: 1,
      kind: 'defense',
      gameId: game.gameId,
      expectedRevision: game.revision,
      request: {
        commandId: crypto.randomUUID(),
        actorId: game.human.playerId,
        expectedRevision: game.revision,
        text,
      },
    });
  };

  const handleVote = async (targetPlayerId: string) => {
    if (!game) return;
    await runCommand({
      version: 1,
      kind: 'vote',
      gameId: game.gameId,
      expectedRevision: game.revision,
      request: {
        commandId: crypto.randomUUID(),
        actorId: game.human.playerId,
        expectedRevision: game.revision,
        targetPlayerId,
      },
    });
  };

  const handleSpectate = async () => {
    if (!game) return;
    await runCommand({
      version: 1,
      kind: 'spectate',
      gameId: game.gameId,
      expectedRevision: game.revision,
      request: {
        commandId: crypto.randomUUID(),
        actorId: game.human.playerId,
        expectedRevision: game.revision,
      },
    });
  };

  const handleAbandon = async () => {
    if (!game) return;
    await runCommand({
      version: 1,
      kind: 'abandon',
      gameId: game.gameId,
      expectedRevision: game.revision,
      request: {
        commandId: crypto.randomUUID(),
        actorId: game.human.playerId,
        expectedRevision: game.revision,
        confirmed: true,
      },
    });
  };

  const handleInterruptedGame = async (resolution: 'continue' | 'start_new') => {
    if (!game) return;
    await runCommand({
      version: 1,
      kind: 'recovery',
      gameId: game.gameId,
      expectedRevision: game.revision,
      request: { commandId: crypto.randomUUID(), resolution },
    });
  };

  const handleNewGame = () => {
    localStorage.removeItem(LAST_GAME_KEY);
    setError(null);
    setGame(null);
    setTopView('game');
  };

  const closeGuessModeNotice = useCallback(() => {
    setGuessModeNoticeOpen(false);
    guessModeTriggerRef.current?.focus();
  }, []);

  const isFinished = game?.status === 'finished';
  // 复盘页依赖终局事实；一旦离开终局（新局/放弃）自动退回对局页，避免空态残留。
  useEffect(() => {
    if (topView === 'review' && !isFinished) setTopView('game');
  }, [topView, isFinished]);

  if (loadState === 'loading') {
    return <StatusPage title="正在恢复对局…" description="正在读取本机保存的安全公开状态。" />;
  }

  if (loadState === 'failed') {
    return (
      <StatusPage
        title="本地服务未连接"
        description={error ?? '请确认本地服务已经启动。'}
        actionLabel="重新连接"
        onAction={() => {
          setError(null);
          setLoadState('loading');
          setLoadAttempt((value) => value + 1);
        }}
      />
    );
  }

  return (
    <main
      className={`shell shell--${experience.backgroundTheme}`}
      style={
        experience.backgroundImage
          ? ({ '--scene-background': experience.backgroundImage } as CSSProperties)
          : undefined
      }
    >
      <div className="app-chrome">
        <nav className="top-nav" aria-label="主导航">
          <button
            type="button"
            className={topView === 'game' ? 'top-nav__link is-active' : 'top-nav__link'}
            aria-current={topView === 'game' ? 'page' : undefined}
            onClick={() => setTopView('game')}
          >
            对局
          </button>
          <button
            type="button"
            className={topView === 'model-profiles' ? 'top-nav__link is-active' : 'top-nav__link'}
            aria-current={topView === 'model-profiles' ? 'page' : undefined}
            onClick={() => setTopView('model-profiles')}
          >
            模型档案
          </button>
          {isFinished && (
            <button
              type="button"
              className={topView === 'review' ? 'top-nav__link is-active' : 'top-nav__link'}
              aria-current={topView === 'review' ? 'page' : undefined}
              onClick={() => setTopView('review')}
            >
              复盘
            </button>
          )}
        </nav>
        <ExperienceControls
          audioEnabled={experience.audioEnabled}
          audioNotice={experience.audioNotice}
          backgroundTheme={experience.backgroundTheme}
          onToggleAudio={experience.toggleAudio}
          onBackgroundChange={experience.changeBackground}
        />
      </div>
      {stream.showRecovery && <ConnectionNotice onRetry={stream.retryNow} />}
      <GuessModeNotice open={guessModeNoticeOpen} onClose={closeGuessModeNotice} />
      {game?.operationalStatus.state === 'interrupted' && (
        <InterruptedGameDialog busy={busy} onResolve={handleInterruptedGame} />
      )}
      {topView === 'model-profiles' ? (
        <ModelProfiles onBack={() => setTopView('game')} />
      ) : topView === 'review' && game && isFinished ? (
        <ReviewScreen game={game} onBack={() => setTopView('game')} />
      ) : (
        <section className="storyboard">
          {renderStage()}
          {game?.status !== 'in_progress' && game?.status !== 'finished' && error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
    </main>
  );

  function renderStage() {
    if (!game) {
      return (
        <NewGameForm
          busy={busy}
          onCreate={handleCreate}
          onOpenGuessMode={(trigger) => {
            guessModeTriggerRef.current = trigger;
            setGuessModeNoticeOpen(true);
          }}
        />
      );
    }
    if (game.status === 'preparing') {
      return <PreparingGame game={game} busy={busy} onStart={handleStart} onAbandon={handleAbandon} />;
    }
    return (
      <GameScreen
        game={game}
        busy={busy}
        error={error}
        onDescribe={handleDescribe}
        onDefense={handleDefense}
        onVote={handleVote}
        onSpectate={handleSpectate}
        onAbandon={handleAbandon}
        onNewGame={handleNewGame}
        onReview={() => setTopView('review')}
      />
    );
  }
}

function GuessModeNotice({ open, onClose }: { open: boolean; onClose(): void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        event.preventDefault();
        closeButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="coming-soon-backdrop"
      data-testid="coming-soon-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="coming-soon-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="coming-soon-title"
        aria-describedby="coming-soon-description"
      >
        <p className="eyebrow">二期功能</p>
        <h2 id="coming-soon-title">猜词模式暂未开放</h2>
        <p id="coming-soon-description">当前为deta版本，正式上线后即可畅玩</p>
        <button ref={closeButtonRef} type="button" className="primary-action" onClick={onClose}>
          知道了
        </button>
      </section>
    </div>
  );
}

function StatusPage({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?(): void;
}) {
  return (
    <main className="shell">
      <section className="storyboard" aria-labelledby="status-title">
        <p className="eyebrow">本地对局</p>
        <h1 id="status-title">{title}</h1>
        <p className="lede">{description}</p>
        {actionLabel && onAction && (
          <button type="button" className="primary-action" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </section>
    </main>
  );
}

function messageFor(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  return '无法连接本地服务，请确认 pnpm dev 正在运行';
}

function messageForCommand(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  return '连接中断，操作结果待确认；恢复连接后会自动校准';
}

function ConnectionNotice({ onRetry }: { onRetry(): void }) {
  return (
    <div className="connection-notice" role="status">
      <span>连接中断，正在恢复</span>
      <button type="button" onClick={onRetry}>立即重试</button>
    </div>
  );
}

function InterruptedGameDialog({
  busy,
  onResolve,
}: {
  busy: boolean;
  onResolve(resolution: 'continue' | 'start_new'): Promise<void>;
}) {
  const continueRef = useRef<HTMLButtonElement>(null);
  const newGameRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    continueRef.current?.focus();
  }, []);

  return (
    <div className="coming-soon-backdrop">
      <section
        className="coming-soon-dialog recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-title"
        aria-describedby="recovery-description"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          if (event.shiftKey && document.activeElement === continueRef.current) {
            event.preventDefault();
            newGameRef.current?.focus();
          } else if (!event.shiftKey && document.activeElement === newGameRef.current) {
            event.preventDefault();
            continueRef.current?.focus();
          }
        }}
      >
        <p className="eyebrow">对局恢复</p>
        <h2 id="recovery-title">上一局在模型行动时中断</h2>
        <p id="recovery-description">请选择继续当前回合，或结束旧局后重新开始。</p>
        <div className="action-row">
          <button
            type="button"
            ref={continueRef}
            className="primary-action"
            disabled={busy}
            onClick={() => void onResolve('continue')}
          >
            {busy ? '正在恢复…' : '继续上一局'}
          </button>
          <button
            type="button"
            ref={newGameRef}
            className="secondary-action"
            disabled={busy}
            onClick={() => void onResolve('start_new')}
          >
            开始新对局
          </button>
        </div>
      </section>
    </div>
  );
}
