import { useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Circle, Crosshair, Flag, MessageCircle, Pause, Play, StepForward, TriangleAlert, X } from 'lucide-react';

import {
  validatePublicSpeech,
  type ContentValidationCode,
  type HumanGameView,
  type Player,
} from '@sheishiwodi/shared';

import { characterAvatarFor, characterImageFor, characterKeyFor, characterStateLabel, type CharacterState } from '../character-assets';
import { CharacterPortrait } from './CharacterPortrait';
import { ComicTimeline, type TimelineProps } from './ComicTimeline';

interface GameScreenProps {
  game: HumanGameView;
  busy: boolean;
  error: string | null;
  onDescribe(text: string): Promise<void>;
  onDefense(text: string): Promise<void>;
  onVote(targetPlayerId: string): Promise<void>;
  onGuess?(targetPlayerId: string, guessedWord: string): Promise<void>;
  onSpectate(): Promise<void>;
  onAbandon(): Promise<void>;
  onAutomation?(mode: 'auto' | 'paused' | 'step'): Promise<void>;
  onAddBudget?(amount: number): Promise<void>;
  onNewGame(): void;
  onReview(): void;
}

const validationMessage: Record<ContentValidationCode, string> = {
  TOO_SHORT: '至少写 2 个字',
  TOO_LONG: '最多 40 个字',
  TOO_MANY_SENTENCES: '最多两句话',
  WORD_LEAK: '不能直接说出你自己的词',
};

export function GameScreen({
  game,
  busy,
  error,
  onDescribe,
  onDefense,
  onVote,
  onGuess = async () => undefined,
  onSpectate,
  onAbandon,
  onAutomation = async () => undefined,
  onAddBudget = async () => undefined,
  onNewGame,
  onReview,
}: GameScreenProps) {
  const nameOf = useMemo(() => {
    const map = new Map(game.players.map((player) => [player.playerId, player.displayName]));
    return (playerId: string | null | undefined) =>
      (playerId && map.get(playerId)) || '未知玩家';
  }, [game.players]);

  const round = game.round;
  const humanId = game.human?.playerId;
  const humanPlayer = humanId ? game.players.find((player) => player.playerId === humanId) : undefined;
  const humanAlive = humanPlayer?.alive ?? false;
  const isFinished = game.status === 'finished';
  const isHumanTurn =
    game.status === 'in_progress' && round?.currentActorId === humanId && humanAlive;
  const isSpeechAction = round?.actionType === 'describe' || round?.actionType === 'defend';
  const isVoteAction = round?.actionType === 'vote' || round?.actionType === 'revote';
  const guessAvailable =
    game.config.gameMode === 'guess' &&
    game.allowedCommands.includes('SubmitGuess') &&
    game.human?.guessUsed !== true;
  const guessTargets = game.players
    .filter((player) => player.alive && player.playerId !== humanId)
    .map((player) => player.playerId);
  const actionAreaRef = useRef<HTMLDivElement>(null);
  const previousHumanActionRef = useRef<string | null>(null);
  const currentActorName = nameOf(round?.currentActorId);
  const focusedPlayer = game.players.find((player) => player.playerId === round?.currentActorId)
    ?? game.players.find((player) => player.alive)
    ?? game.players[0];
  const pendingTimelineAction =
    game.status === 'in_progress' &&
    round &&
    round.currentActorId &&
    round.actionType &&
    game.players.find((player) => player.playerId === round.currentActorId)?.kind === 'agent'
      ? { actorId: round.currentActorId, actionType: round.actionType }
      : undefined;
  const humanActionKey =
    isHumanTurn && (isSpeechAction || isVoteAction) && round?.actionType
      ? `${game.gameId}:${game.revision}:${round.actionType}`
      : null;

  useEffect(() => {
    const isNewHumanAction = humanActionKey !== null && previousHumanActionRef.current !== humanActionKey;
    previousHumanActionRef.current = humanActionKey;
    if (!isNewHumanAction) return;

    const actionArea = actionAreaRef.current;
    if (!actionArea) return;
    const bounds = actionArea.getBoundingClientRect();
    if (bounds.top >= 0 && bounds.bottom <= window.innerHeight) return;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    actionArea.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [humanActionKey]);

  return (
    <section className="game-screen" aria-labelledby="game-title">
      <header className="game-header">
        <h1 id="game-title">{isFinished ? '对局结束' : `第 ${round?.number ?? 1} 轮`}</h1>
        <div className="game-header__meta">
          <p className="eyebrow">
            {game.config.difficulty === 'easy' ? '简单' : '困难'} · {game.config.undercoverCount} 名卧底
          </p>
          <p className="game-status-line" role="status">
            {statusLine(game, isHumanTurn, currentActorName)}
          </p>
        </div>
      </header>

      {focusedPlayer && (
        <div className="focus-stage" aria-live="polite">
          <CharacterPortrait
            characterKey={characterKeyFor(focusedPlayer, game.human?.silhouette ?? 'silhouette_a')}
            src={characterImageFor(focusedPlayer, portraitState(focusedPlayer, game), game.human?.silhouette ?? 'silhouette_a')}
            label={focusedPlayer.displayName}
            state={portraitState(focusedPlayer, game)}
          />
          <div><span className="focus-stage__status">{seatCaption(focusedPlayer, game)}</span><strong>{focusedPlayer.displayName}</strong></div>
        </div>
      )}

      <div className={`seats seats--game seats--compact ${game.players.length >= 6 ? 'seats--large-roster' : ''}`} aria-label="本局玩家">
        {game.players.map((player) => {
          const state = portraitState(player, game);
          return <article className="seat" key={player.playerId} data-player-id={player.playerId} data-alive={player.alive}>
            <div className="seat__avatar-wrap">
              <CharacterPortrait
                characterKey={characterKeyFor(player, game.human?.silhouette ?? 'silhouette_a')}
                src={characterAvatarFor(player, game.human?.silhouette ?? 'silhouette_a')}
                label={player.displayName}
                state={state}
              />
              <span className="seat__state-icon" data-state={state} title={characterStateLabel[state]} aria-label={`状态：${characterStateLabel[state]}`}>
                <SeatStateIcon state={state} />
              </span>
            </div>
            <strong title={player.displayName}>{player.displayName}</strong>
            <span>{seatCaption(player, game)}</span>
          </article>;
        })}
      </div>

      <ComicTimeline
        timeline={game.publicTimeline}
        nameOf={nameOf}
        pendingAction={pendingTimelineAction}
      />

      {game.status === 'in_progress' && isVoteAction && (
        <VoteProgress game={game} nameOf={nameOf} />
      )}

      <div className="action-area" ref={actionAreaRef}>
        {isFinished ? (
          <Finale game={game} nameOf={nameOf} onReview={onReview} />
        ) : game.status === 'abandoned' ? (
          <AbandonedNotice />
        ) : game.status === 'system_terminated' ? (
          <SystemTerminatedNotice />
        ) : game.status === 'awaiting_spectator' ? (
          <SpectatorChoice busy={busy} onSpectate={onSpectate} onAbandon={onAbandon} />
        ) : !game.human ? (
          <AutomationPanel game={game} busy={busy} currentActorName={currentActorName} onAutomation={onAutomation} onAddBudget={onAddBudget} />
        ) : !humanAlive ? (
          <SpectatorNotice currentActorName={currentActorName} />
        ) : isHumanTurn && isSpeechAction ? (
          <SpeechInput
            mode={round?.actionType === 'defend' ? 'defend' : 'describe'}
            ownWordCard={game.human.ownWordCard}
            busy={busy}
            onSubmit={round?.actionType === 'defend' ? onDefense : onDescribe}
            {...(guessAvailable && round?.actionType === 'describe'
              ? { guessTargets, nameOf, onGuess }
              : {})}
          />
        ) : isHumanTurn && isVoteAction ? (
          <VotePanel
            mode={round?.actionType === 'revote' ? 'revote' : 'vote'}
            targets={game.legalVoteTargetIds}
            nameOf={nameOf}
            busy={busy}
            onSubmit={onVote}
            {...(guessAvailable && round?.actionType === 'vote'
              ? { guessTargets, onGuess }
              : {})}
          />
        ) : pendingTimelineAction ? null : (
          <WaitingNotice currentActorName={currentActorName} actionType={round?.actionType} />
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {game.status === 'in_progress' && (
          <AbandonControl busy={busy} onAbandon={onAbandon} />
        )}
        {(game.status === 'finished' ||
          game.status === 'abandoned' ||
          game.status === 'system_terminated') && (
          <button className="primary-action" type="button" onClick={onNewGame}>
            开始新对局
          </button>
        )}
      </div>
    </section>
  );
}

function statusLine(game: HumanGameView, isHumanTurn: boolean, currentActorName: string) {
  if (game.status === 'abandoned') {
    return '本局已放弃，不产生阵营胜负';
  }
  if (game.status === 'system_terminated') {
    return '模型服务自动恢复失败，本局已安全终止';
  }
  if (game.status === 'awaiting_spectator') {
    return '你已出局，请选择继续观战或放弃本局';
  }
  if (game.status === 'finished') {
    if (game.winnerCamp === 'draw') return '双方同时出局，本局平局';
    return game.winnerCamp === 'civilian' ? '平民阵营获胜' : '卧底阵营获胜';
  }
  if (game.phase === 'tie_defense') {
    return isHumanTurn ? '轮到你为自己辩解' : `${currentActorName} 正在辩解`;
  }
  if (game.phase === 'revoting') {
    return isHumanTurn ? '轮到你秘密重投' : `${currentActorName} 正在重投`;
  }
  if (!game.human) return `自动观战 · 当前行动者：${currentActorName}`;
  const humanPlayer = game.players.find((player) => player.playerId === game.human?.playerId);
  if (!(humanPlayer?.alive ?? false)) {
    return `你已出局，观战中 · 当前行动者：${currentActorName}`;
  }
  if (isHumanTurn) {
    if (game.round?.actionType === 'revote') return '轮到你秘密重投';
    if (game.round?.actionType === 'vote') return '轮到你秘密投票';
    if (game.round?.actionType === 'defend') return '轮到你为自己辩解';
    return '轮到你描述';
  }
  return `当前行动者：${currentActorName}`;
}

function portraitState(player: Player, game: HumanGameView): CharacterState {
  if (!player.alive) return 'eliminated';
  const round = game.round;
  if (game.status === 'in_progress' && isVotingAction(round?.actionType)) {
    if (isEligibleVoter(player, game)) {
      return game.voteProgress.completedPlayerIds.includes(player.playerId) ? 'idle' : 'thinking';
    }
    if (round?.tieCandidateIds.includes(player.playerId)) return 'suspected';
  }
  if (round?.tieCandidateIds.includes(player.playerId)) return 'suspected';
  if (game.status === 'in_progress' && round?.currentActorId === player.playerId) {
    return 'speaking';
  }
  return 'idle';
}

function SeatStateIcon({ state }: { state: CharacterState }) {
  if (state === 'thinking') return <Brain aria-hidden="true" />;
  if (state === 'speaking') return <MessageCircle aria-hidden="true" />;
  if (state === 'suspected') return <TriangleAlert aria-hidden="true" />;
  if (state === 'eliminated') return <X aria-hidden="true" />;
  return <Circle aria-hidden="true" />;
}

function AutomationPanel({ game, busy, currentActorName, onAutomation, onAddBudget }: {
  game: HumanGameView;
  busy: boolean;
  currentActorName: string;
  onAutomation(mode: 'auto' | 'paused' | 'step'): Promise<void>;
  onAddBudget(amount: number): Promise<void>;
}) {
  const control = game.automationControl;
  const paused = control?.mode === 'paused';
  return (
    <section className="automation-panel" aria-label="Agent 对局控制">
      <div className="automation-panel__status">
        <span className={`status-icon ${paused ? 'is-paused' : ''}`}>{paused ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</span>
        <div><strong>{paused ? '已暂停' : '自动进行中'}</strong><span>当前：{currentActorName}</span></div>
      </div>
      {control?.requestBudget !== null && control?.requestBudget !== undefined && (
        <div className="automation-budget">
          <span>请求 {control.usedRequests}/{control.requestBudget}</span>
          {control.pauseReason === 'budget_exhausted' && <span className="automation-budget__warning"><TriangleAlert aria-hidden="true" />预算已用完</span>}
        </div>
      )}
      <div className="automation-panel__actions">
        {paused ? (
          <button className="icon-command" type="button" title="继续自动运行" aria-label="继续自动运行" disabled={busy} onClick={() => void onAutomation('auto')}><Play aria-hidden="true" /></button>
        ) : (
          <button className="icon-command" type="button" title="暂停" aria-label="暂停" disabled={busy} onClick={() => void onAutomation('paused')}><Pause aria-hidden="true" /></button>
        )}
        {game.config.gameMode === 'guess' && game.human?.guessUsed && game.status === 'in_progress' && (
          <p className="guess-used"><Crosshair aria-hidden="true" />本局猜词机会已使用</p>
        )}
        <button className="icon-command" type="button" title="单步执行" aria-label="单步执行" disabled={busy} onClick={() => void onAutomation('step')}><StepForward aria-hidden="true" /></button>
        {control?.pauseReason === 'budget_exhausted' && <button className="secondary-action" type="button" disabled={busy} onClick={() => void onAddBudget(20)}>追加 20 次</button>}
      </div>
      <p className="automation-panel__hint"><Flag aria-hidden="true" />暂停会在当前逻辑行动完成后生效</p>
    </section>
  );
}

function seatCaption(player: Player, game: HumanGameView) {
  if (!player.alive) return '已出局';
  if (game.status === 'in_progress' && isVotingAction(game.round?.actionType)) {
    if (isEligibleVoter(player, game)) {
      const done = game.voteProgress.completedPlayerIds.includes(player.playerId);
      if (player.playerId === game.human?.playerId) return done ? '你 · 已投票' : '你 · 思考中';
      return done ? '已投票' : '思考中';
    }
    if (game.round?.tieCandidateIds.includes(player.playerId)) return '等待重投';
  }
  if (player.playerId === game.human?.playerId) return '你';
  if (game.voteProgress.completedPlayerIds.includes(player.playerId)) return '已投票';
  if (game.status === 'in_progress' && game.round?.currentActorId === player.playerId) {
    if (game.round.actionType === 'defend') return '辩解中';
    return '发言中';
  }
  return player.kind === 'human' ? '玩家' : 'AI';
}

function isVotingAction(actionType: string | null | undefined) {
  return actionType === 'vote' || actionType === 'revote';
}

function isEligibleVoter(player: Player, game: HumanGameView) {
  if (!player.alive || !isVotingAction(game.round?.actionType)) return false;
  return game.round?.actionType !== 'revote' || !game.round.tieCandidateIds.includes(player.playerId);
}

function VoteProgress({
  game,
  nameOf,
}: {
  game: HumanGameView;
  nameOf: TimelineProps['nameOf'];
}) {
  if (game.phase !== 'voting' && game.phase !== 'revoting') return null;
  const living = game.players.filter((player) => player.alive);
  const eligible =
    game.phase === 'revoting'
      ? living.filter((player) => !game.round?.tieCandidateIds.includes(player.playerId))
      : living;
  const done = game.voteProgress.completedPlayerIds;
  const label = game.phase === 'revoting' ? '重投进度' : '投票进度';
  return (
    <div className="vote-progress" aria-label={label}>
      <span className="vote-progress__count">
        {label} {done.length}/{eligible.length}
      </span>
      <span className="vote-progress__hint">目标在所有人投票完成后统一揭晓</span>
      {done.length > 0 && (
        <span className="vote-progress__done">已完成：{done.map(nameOf).join('、')}</span>
      )}
    </div>
  );
}

function SpeechInput({
  mode,
  ownWordCard,
  busy,
  onSubmit,
  guessTargets,
  nameOf,
  onGuess,
}: {
  mode: 'describe' | 'defend';
  ownWordCard: string;
  busy: boolean;
  onSubmit(text: string): Promise<void>;
  guessTargets?: string[];
  nameOf?: TimelineProps['nameOf'];
  onGuess?(targetPlayerId: string, guessedWord: string): Promise<void>;
}) {
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const length = Array.from(trimmed).length;
  const result = trimmed.length > 0 ? validatePublicSpeech(text, ownWordCard) : null;
  const invalidReason = result && !result.valid ? validationMessage[result.code!] : null;
  const canSubmit = !busy && result?.valid === true;
  const helperText = invalidReason ?? '至少输入 2 个字后可提交；最多 40 字，不能直接说出原词';

  const submit = () => {
    if (!canSubmit) return;
    void onSubmit(trimmed).then(() => setText(''));
  };

  const actionLabel = mode === 'defend' ? '辩解' : '描述';

  return (
    <div className={`human-action human-action--${mode}`}>
      <label className="field">
        <span>轮到你{actionLabel}</span>
        <textarea
          className="describe-input"
          value={text}
          maxLength={80}
          rows={2}
          aria-describedby="speech-input-help"
          placeholder={
            mode === 'defend'
              ? '回应大家的怀疑，保持线索一致且不要泄露原词'
              : '用一两句话描述你的词，别泄露原词'
          }
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="human-action__meta">
        <span className={length > 40 ? 'char-count char-count--over' : 'char-count'}>
          {length}/40
        </span>
        <span
          className={invalidReason ? 'form-error form-error--inline' : 'human-action__hint'}
          id="speech-input-help"
          role="status"
        >
          {helperText}
        </span>
      </div>
      <button className="primary-action" type="button" disabled={!canSubmit} onClick={submit}>
        {busy ? '提交中…' : `提交${actionLabel}`}
      </button>
      {guessTargets && nameOf && onGuess && (
        <GuessLauncher targets={guessTargets} nameOf={nameOf} busy={busy} onSubmit={onGuess} />
      )}
    </div>
  );
}

function VotePanel({
  mode,
  targets,
  nameOf,
  busy,
  onSubmit,
  guessTargets,
  onGuess,
}: {
  mode: 'vote' | 'revote';
  targets: string[];
  nameOf: TimelineProps['nameOf'];
  busy: boolean;
  onSubmit(targetPlayerId: string): Promise<void>;
  guessTargets?: string[];
  onGuess?(targetPlayerId: string, guessedWord: string): Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="human-action human-action--vote">
      <p className="human-action__title">
        {mode === 'revote'
          ? '轮到你秘密重投，只能从平票候选中选择'
          : '轮到你秘密投票，只有你知道你的选择'}
      </p>
      <div className="vote-grid" role="radiogroup" aria-label="投票目标">
        {targets.map((targetId) => (
          <button
            type="button"
            key={targetId}
            role="radio"
            aria-checked={selected === targetId}
            className={`vote-option ${selected === targetId ? 'vote-option--selected' : ''}`}
            onClick={() => setSelected(targetId)}
            disabled={busy}
          >
            {nameOf(targetId)}
          </button>
        ))}
      </div>
      <button
        className="primary-action"
        type="button"
        disabled={busy || !selected}
        onClick={() => selected && void onSubmit(selected)}
      >
        {busy ? '提交中…' : mode === 'revote' ? '确认重投' : '确认投票'}
      </button>
      {guessTargets && onGuess && (
        <GuessLauncher targets={guessTargets} nameOf={nameOf} busy={busy} onSubmit={onGuess} />
      )}
    </div>
  );
}

function GuessLauncher({
  targets,
  nameOf,
  busy,
  onSubmit,
}: {
  targets: string[];
  nameOf: TimelineProps['nameOf'];
  busy: boolean;
  onSubmit(targetPlayerId: string, guessedWord: string): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [targetPlayerId, setTargetPlayerId] = useState('');
  const [guessedWord, setGuessedWord] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const valid = targetPlayerId.length > 0 && guessedWord.trim().length > 0;
  const close = () => {
    setOpen(false);
    setConfirmed(false);
  };

  if (!open) {
    return (
      <button className="guess-action" type="button" disabled={busy} onClick={() => setOpen(true)}>
        <Crosshair aria-hidden="true" />发起猜测
      </button>
    );
  }

  return (
    <section className="guess-panel" role="dialog" aria-label="发起猜测">
      <header><strong><Crosshair aria-hidden="true" />猜身份与词语</strong><button className="icon-action" type="button" aria-label="取消猜测" title="取消" onClick={close}><X aria-hidden="true" /></button></header>
      <label><span>目标玩家</span><select value={targetPlayerId} onChange={(event) => { setTargetPlayerId(event.target.value); setConfirmed(false); }}><option value="">选择目标</option>{targets.map((target) => <option key={target} value={target}>{nameOf(target)}</option>)}</select></label>
      <label><span>目标的精确词语</span><input value={guessedWord} maxLength={40} onChange={(event) => { setGuessedWord(event.target.value); setConfirmed(false); }} /></label>
      <p className="guess-panel__risk"><TriangleAlert aria-hidden="true" />猜中会淘汰目标；身份或词语任一错误，你将立即出局。本局只能猜一次。</p>
      {!confirmed ? (
        <button className="secondary-action" type="button" disabled={!valid || busy} onClick={() => setConfirmed(true)}>核对猜测</button>
      ) : (
        <div className="guess-panel__confirm"><p>确认猜测 {nameOf(targetPlayerId)} 的词是“{guessedWord.trim()}”？</p><div className="action-row"><button className="danger-action" type="button" disabled={busy} onClick={() => void onSubmit(targetPlayerId, guessedWord.trim())}>{busy ? '提交中…' : '确认并提交'}</button><button className="secondary-action" type="button" disabled={busy} onClick={() => setConfirmed(false)}>返回修改</button></div></div>
      )}
    </section>
  );
}

function Finale({
  game,
  nameOf,
  onReview,
}: {
  game: HumanGameView;
  nameOf: TimelineProps['nameOf'];
  onReview(): void;
}) {
  const civilianWin = game.winnerCamp === 'civilian';
  const draw = game.winnerCamp === 'draw';
  const revealPlayers = game.reveal?.players ?? [];
  const [revealedCount, setRevealedCount] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    setReviewOpen(false);
    if (revealPlayers.length === 0) {
      setRevealedCount(0);
      return;
    }
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setRevealedCount(revealPlayers.length);
      return;
    }
    setRevealedCount(0);
    const timers = revealPlayers.map((_, index) =>
      window.setTimeout(() => setRevealedCount(index + 1), 350 * (index + 1)),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [game.gameId, revealPlayers.length]);

  const allRevealed = revealPlayers.length > 0 && revealedCount === revealPlayers.length;
  return (
    <div className="finale">
      <span
        className={`finale-stamp ${draw ? 'finale-stamp--draw' : civilianWin ? 'finale-stamp--civilian' : 'finale-stamp--undercover'}`}
      >
        {draw ? '本局平局' : civilianWin ? '平民胜利' : '卧底胜利'}
      </span>
      <p className="finale-reason">{finaleReason(game.endReason)}</p>
      <ol className="finale-cards" aria-label="终局身份揭晓" aria-live="polite">
        {revealPlayers.map((player, index) => {
          const revealed = index < revealedCount;
          return (
            <li className="finale-card" data-revealed={revealed} key={player.playerId}>
              <strong>{nameOf(player.playerId)}</strong>
              {revealed ? (
                <>
                  <span>{player.camp === 'undercover' ? '卧底' : '平民'}</span>
                  <b>{player.wordCard}</b>
                </>
              ) : (
                <span>身份揭晓中…</span>
              )}
            </li>
          );
        })}
      </ol>
      {allRevealed && (
        <div className="finale-actions">
          <button type="button" className="primary-action" onClick={onReview}>
            查看完整复盘
          </button>
          <button type="button" className="secondary-action" onClick={() => setReviewOpen((open) => !open)}>
            {reviewOpen ? '收起事实复盘' : '查看事实复盘'}
          </button>
        </div>
      )}
      {reviewOpen && game.factReview && (
        <section className="fact-review" aria-label="确定性事实复盘">
          <h2>确定性事实复盘</h2>
          <p>完整公开时间线共 {game.publicTimeline.length} 条，AI 私有行动共 {game.factReview.agentActions.length} 条。</p>
          {(game.factReview.guesses?.length ?? 0) > 0 && (
            <ol className="guess-review-list">
              {game.factReview.guesses?.map((guess, index) => (
                <li key={`${guess.actorId}-${guess.roundNumber}-${index}`}>
                  第 {guess.roundNumber} 轮 · {nameOf(guess.actorId)} 猜测 {nameOf(guess.targetPlayerId)} 的词为“{guess.guessedWord}” · {guess.success ? '成功' : '失败'}
                </li>
              ))}
            </ol>
          )}
          <ol>
            {game.factReview.agentActions.map((action) => (
              <li key={action.actionId}>
                第 {action.roundNumber} 轮 · {nameOf(action.playerId)} · {actionLabel(action.actionType)}
                {'reason' in action.output && typeof action.output.reason === 'string'
                  ? `：${action.output.reason}`
                  : ''}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function actionLabel(actionType: string) {
  if (actionType === 'describe') return '描述';
  if (actionType === 'defend') return '辩解';
  if (actionType === 'revote') return '重投';
  return '投票';
}

function finaleReason(endReason: HumanGameView['endReason']) {
  if (endReason === 'undercover_eliminated') return '卧底已被淘汰，平民阵营获胜。';
  if (endReason === 'undercover_survived_to_two') return '卧底存活到只剩两人，卧底阵营获胜。';
  if (endReason === 'player_rule_violation') return '有玩家因重复违反发言规则退出，系统已重新判定胜负。';
  if (endReason === 'all_players_eliminated') return '批次猜词同时结算后无人存活，本局平局。';
  return '对局已结束。';
}

function AbandonedNotice() {
  return (
    <div className="notice notice--abandoned">
      <strong>本局已放弃</strong>
      <p>本局不会产生阵营胜负，已保留截至放弃时的不完整记录。</p>
    </div>
  );
}

function SystemTerminatedNotice() {
  return (
    <div className="notice notice--system-terminated" role="alert">
      <strong>模型服务异常，本局已终止</strong>
      <p>系统已完成自动修复与重试，但仍未获得可提交的合法行动。本局不判定阵营胜负。</p>
    </div>
  );
}

function SpectatorChoice({
  busy,
  onSpectate,
  onAbandon,
}: {
  busy: boolean;
  onSpectate(): Promise<void>;
  onAbandon(): Promise<void>;
}) {
  return (
    <div className="notice notice--spectator-choice">
      <strong>你已出局</strong>
      <p>你可以继续查看普通公开信息，也可以放弃本局。</p>
      <div className="action-row">
        <button className="primary-action" type="button" disabled={busy} onClick={() => void onSpectate()}>
          {busy ? '处理中…' : '继续观战'}
        </button>
        <AbandonControl busy={busy} onAbandon={onAbandon} />
      </div>
    </div>
  );
}

function AbandonControl({ busy, onAbandon }: { busy: boolean; onAbandon(): Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button className="danger-link" type="button" disabled={busy} onClick={() => setConfirming(true)}>
        放弃本局
      </button>
    );
  }
  return (
    <div className="abandon-confirm" role="alertdialog" aria-labelledby="abandon-title">
      <strong id="abandon-title">确认放弃本局？</strong>
      <p>本局不会产生阵营胜负，将保留不完整记录。</p>
      <div className="action-row">
        <button className="danger-action" type="button" disabled={busy} onClick={() => void onAbandon()}>
          {busy ? '放弃中…' : '放弃本局'}
        </button>
        <button className="secondary-action" type="button" disabled={busy} onClick={() => setConfirming(false)}>
          取消
        </button>
      </div>
    </div>
  );
}

function SpectatorNotice({ currentActorName }: { currentActorName: string }) {
  return (
    <div className="notice notice--spectator">
      <strong>你已出局，继续观战</strong>
      <p>当前行动者：{currentActorName}。你仍可看到公开进展，但不再参与描述与投票。</p>
    </div>
  );
}

function WaitingNotice({
  currentActorName,
  actionType,
}: {
  currentActorName: string;
  actionType: 'describe' | 'vote' | 'defend' | 'revote' | null | undefined;
}) {
  const action =
    actionType === 'defend'
      ? '正在辩解'
      : actionType === 'revote'
        ? '正在秘密重投'
        : actionType === 'vote'
          ? '正在秘密投票'
          : '正在思考';
  return (
    <div className="notice notice--waiting" aria-live="polite">
      <span className="thinking-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <p>{currentActorName} {action}…</p>
    </div>
  );
}
