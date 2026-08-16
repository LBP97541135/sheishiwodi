import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  validatePublicSpeech,
  type ContentValidationCode,
  type HumanGameView,
  type Player,
  type PublicTimelineItem,
} from '@sheishiwodi/shared';

import { characterKeyFor, type CharacterState } from '../character-assets';
import { CharacterPortrait } from './CharacterPortrait';

interface GameScreenProps {
  game: HumanGameView;
  busy: boolean;
  error: string | null;
  onDescribe(text: string): Promise<void>;
  onDefense(text: string): Promise<void>;
  onVote(targetPlayerId: string): Promise<void>;
  onSpectate(): Promise<void>;
  onAbandon(): Promise<void>;
  onNewGame(): void;
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
  onSpectate,
  onAbandon,
  onNewGame,
}: GameScreenProps) {
  const nameOf = useMemo(() => {
    const map = new Map(game.players.map((player) => [player.playerId, player.displayName]));
    return (playerId: string | null | undefined) =>
      (playerId && map.get(playerId)) || '未知玩家';
  }, [game.players]);

  const round = game.round;
  const humanId = game.human.playerId;
  const humanPlayer = game.players.find((player) => player.playerId === humanId);
  const humanAlive = humanPlayer?.alive ?? true;
  const isFinished = game.status === 'finished';
  const isHumanTurn =
    game.status === 'in_progress' && round?.currentActorId === humanId && humanAlive;
  const isSpeechAction = round?.actionType === 'describe' || round?.actionType === 'defend';
  const isVoteAction = round?.actionType === 'vote' || round?.actionType === 'revote';
  const currentActorName = nameOf(round?.currentActorId);

  return (
    <section className="game-screen" aria-labelledby="game-title">
      <header className="game-header">
        <p className="eyebrow">
          {game.config.difficulty === 'easy' ? '简单' : '困难'} · {game.config.undercoverCount} 名卧底
        </p>
        <h1 id="game-title">{isFinished ? '对局结束' : `第 ${round?.number ?? 1} 轮`}</h1>
        <p className="game-status-line" role="status">
          {statusLine(game, isHumanTurn, currentActorName)}
        </p>
      </header>

      <div className="seats seats--game" aria-label="本局玩家">
        {game.players.map((player) => (
          <article className="seat" key={player.playerId} data-alive={player.alive}>
            <CharacterPortrait
              characterKey={characterKeyFor(player, game.human.silhouette)}
              label={player.displayName}
              state={portraitState(player, game)}
            />
            <strong>{player.displayName}</strong>
            <span>{seatCaption(player, game)}</span>
          </article>
        ))}
      </div>

      <ComicTimeline timeline={game.publicTimeline} nameOf={nameOf} />

      {game.status === 'in_progress' && isVoteAction && (
        <VoteProgress game={game} nameOf={nameOf} />
      )}

      <div className="action-area">
        {isFinished ? (
          <Finale game={game} nameOf={nameOf} />
        ) : game.status === 'abandoned' ? (
          <AbandonedNotice />
        ) : game.status === 'awaiting_spectator' ? (
          <SpectatorChoice busy={busy} onSpectate={onSpectate} onAbandon={onAbandon} />
        ) : !humanAlive ? (
          <SpectatorNotice currentActorName={currentActorName} />
        ) : isHumanTurn && isSpeechAction ? (
          <SpeechInput
            mode={round?.actionType === 'defend' ? 'defend' : 'describe'}
            ownWordCard={game.human.ownWordCard}
            busy={busy}
            onSubmit={round?.actionType === 'defend' ? onDefense : onDescribe}
          />
        ) : isHumanTurn && isVoteAction ? (
          <VotePanel
            mode={round?.actionType === 'revote' ? 'revote' : 'vote'}
            targets={game.legalVoteTargetIds}
            nameOf={nameOf}
            busy={busy}
            onSubmit={onVote}
          />
        ) : (
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
        {(game.status === 'finished' || game.status === 'abandoned') && (
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
  if (game.status === 'awaiting_spectator') {
    return '你已出局，请选择继续观战或放弃本局';
  }
  if (game.status === 'finished') {
    return game.winnerCamp === 'civilian' ? '平民阵营获胜' : '卧底阵营获胜';
  }
  if (game.phase === 'tie_defense') {
    return isHumanTurn ? '轮到你为自己辩解' : `${currentActorName} 正在辩解`;
  }
  if (game.phase === 'revoting') {
    return isHumanTurn ? '轮到你秘密重投' : `${currentActorName} 正在重投`;
  }
  const humanPlayer = game.players.find((player) => player.playerId === game.human.playerId);
  if (!(humanPlayer?.alive ?? true)) {
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
  if (round?.tieCandidateIds.includes(player.playerId)) return 'suspected';
  if (game.status === 'in_progress' && round?.currentActorId === player.playerId) {
    if (round.actionType === 'vote' || round.actionType === 'revote') return 'thinking';
    return 'speaking';
  }
  return 'idle';
}

function seatCaption(player: Player, game: HumanGameView) {
  if (!player.alive) return '已出局';
  if (player.playerId === game.human.playerId) return '你';
  if (game.voteProgress.completedPlayerIds.includes(player.playerId)) return '已投票';
  if (game.status === 'in_progress' && game.round?.currentActorId === player.playerId) {
    if (game.round.actionType === 'revote') return '重投中';
    if (game.round.actionType === 'vote') return '投票中';
    if (game.round.actionType === 'defend') return '辩解中';
    return '发言中';
  }
  return player.kind === 'human' ? '玩家' : 'AI';
}

interface TimelineProps {
  timeline: PublicTimelineItem[];
  nameOf(playerId: string | null | undefined): string;
}

function ComicTimeline({ timeline, nameOf }: TimelineProps) {
  const scrollRef = useRef<HTMLOListElement>(null);
  const [follow, setFollow] = useState(true);
  const panels = timeline.filter((item) => renderableTypes.has(item.type));

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !follow || typeof node.scrollTo !== 'function') return;
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollTo({ top: node.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [panels.length, follow]);

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    setFollow(nearBottom);
  };

  const backToCurrent = () => {
    setFollow(true);
    const node = scrollRef.current;
    if (node && typeof node.scrollTo === 'function') {
      node.scrollTo({ top: node.scrollHeight });
    }
  };

  return (
    <div className="comic-wrap">
      <ol className="comic-timeline" ref={scrollRef} onScroll={handleScroll} aria-live="polite">
        {panels.length === 0 && <li className="comic-empty">对局即将开始…</li>}
        {panels.map((item) => (
          <TimelinePanel key={item.eventSeq} item={item} nameOf={nameOf} />
        ))}
      </ol>
      {!follow && (
        <button type="button" className="back-to-current" onClick={backToCurrent}>
          回到当前 ↓
        </button>
      )}
    </div>
  );
}

const renderableTypes = new Set([
  'round_started',
  'speech_published',
  'vote_progressed',
  'votes_revealed',
  'tie_declared',
  'revote_started',
  'player_eliminated',
  'round_ended_without_elimination',
]);

function TimelinePanel({ item, nameOf }: { item: PublicTimelineItem; nameOf: TimelineProps['nameOf'] }) {
  const payload = item.payload as Record<string, unknown>;
  switch (item.type) {
    case 'round_started':
      return (
        <li className="comic-divider" data-type="round">
          <span>第 {String(payload.roundNumber ?? '')} 轮</span>
        </li>
      );
    case 'speech_published':
      return (
        <li className="comic-panel comic-panel--speech">
          <span className="comic-speaker">{nameOf(payload.actorId as string)}</span>
          <p className="comic-bubble">{String(payload.text ?? '')}</p>
        </li>
      );
    case 'vote_progressed':
      return (
        <li className="comic-panel comic-panel--progress">
          <span className="comic-speaker">{nameOf(payload.playerId as string)}</span>
          <p className="comic-secret">已秘密投票</p>
        </li>
      );
    case 'votes_revealed': {
      const votes = Array.isArray(payload.votes)
        ? (payload.votes as Array<{ voterId: string; targetPlayerId: string }>)
        : [];
      return (
        <li className="comic-panel comic-panel--reveal">
          <span className="comic-speaker">统一揭票</span>
          <ul className="reveal-list">
            {votes.map((vote, index) => (
              <li key={index}>
                {nameOf(vote.voterId)} → {nameOf(vote.targetPlayerId)}
              </li>
            ))}
          </ul>
        </li>
      );
    }
    case 'tie_declared': {
      const ids = Array.isArray(payload.candidateIds) ? (payload.candidateIds as string[]) : [];
      return (
        <li className="comic-panel comic-panel--tie">
          <span className="comic-stamp comic-stamp--tie">平票</span>
          <p>{ids.map(nameOf).join('、')}</p>
        </li>
      );
    }
    case 'revote_started': {
      const candidateIds = Array.isArray(payload.candidateIds) ? (payload.candidateIds as string[]) : [];
      return (
        <li className="comic-panel comic-panel--tie">
          <span className="comic-stamp comic-stamp--revote">重投</span>
          <p>非候选玩家将只在 {candidateIds.map(nameOf).join('、')} 中秘密重投</p>
        </li>
      );
    }
    case 'round_ended_without_elimination':
      return (
        <li className="comic-panel comic-panel--tie">
          <span className="comic-stamp comic-stamp--no-out">无人出局</span>
          <p>{payload.reason === 'all_max' ? '全员最高票，本轮直接结束' : '重投仍然平票'}</p>
        </li>
      );
    case 'player_eliminated':
      return (
        <li className="comic-panel comic-panel--eliminated">
          <span className="comic-stamp comic-stamp--out">出局</span>
          <p>{nameOf(payload.playerId as string)} 被淘汰</p>
        </li>
      );
    default:
      return null;
  }
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
}: {
  mode: 'describe' | 'defend';
  ownWordCard: string;
  busy: boolean;
  onSubmit(text: string): Promise<void>;
}) {
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const length = Array.from(trimmed).length;
  const result = trimmed.length > 0 ? validatePublicSpeech(text, ownWordCard) : null;
  const invalidReason = result && !result.valid ? validationMessage[result.code!] : null;
  const canSubmit = !busy && result?.valid === true;

  const submit = () => {
    if (!canSubmit) return;
    void onSubmit(trimmed).then(() => setText(''));
  };

  const actionLabel = mode === 'defend' ? '辩解' : '描述';

  return (
    <div className={`human-action human-action--${mode}`}>
      <label className="field">
        <span>轮到你{actionLabel}（不能直接说出你的词）</span>
        <textarea
          className="describe-input"
          value={text}
          maxLength={80}
          rows={2}
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
        {invalidReason && (
          <span className="form-error form-error--inline" role="alert">
            {invalidReason}
          </span>
        )}
      </div>
      <button className="primary-action" type="button" disabled={!canSubmit} onClick={submit}>
        {busy ? '提交中…' : `提交${actionLabel}`}
      </button>
    </div>
  );
}

function VotePanel({
  mode,
  targets,
  nameOf,
  busy,
  onSubmit,
}: {
  mode: 'vote' | 'revote';
  targets: string[];
  nameOf: TimelineProps['nameOf'];
  busy: boolean;
  onSubmit(targetPlayerId: string): Promise<void>;
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
    </div>
  );
}

function Finale({
  game,
  nameOf,
}: {
  game: HumanGameView;
  nameOf: TimelineProps['nameOf'];
}) {
  const civilianWin = game.winnerCamp === 'civilian';
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
        className={`finale-stamp ${civilianWin ? 'finale-stamp--civilian' : 'finale-stamp--undercover'}`}
      >
        {civilianWin ? '平民胜利' : '卧底胜利'}
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
        <button type="button" className="secondary-action" onClick={() => setReviewOpen((open) => !open)}>
          {reviewOpen ? '收起事实复盘' : '查看事实复盘'}
        </button>
      )}
      {reviewOpen && game.factReview && (
        <section className="fact-review" aria-label="确定性事实复盘">
          <h2>确定性事实复盘</h2>
          <p>完整公开时间线共 {game.publicTimeline.length} 条，AI 私有行动共 {game.factReview.agentActions.length} 条。</p>
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
  if (endReason === 'undercover_eliminated') return '卧底被票出，平民阵营获胜。';
  if (endReason === 'undercover_survived_to_two') return '卧底存活到只剩两人，卧底阵营获胜。';
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
