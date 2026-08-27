import { useLayoutEffect, useRef, useState } from 'react';

import type { PublicTimelineItem } from '@sheishiwodi/shared';

export interface TimelineProps {
  timeline: PublicTimelineItem[];
  nameOf(playerId: string | null | undefined): string;
  pendingAction?:
    | {
        actorId: string;
        actionType: 'describe' | 'vote' | 'defend' | 'revote';
      }
    | undefined;
}

export function ComicTimeline({ timeline, nameOf, pendingAction }: TimelineProps) {
  const scrollRef = useRef<HTMLOListElement>(null);
  const automaticScrollRef = useRef(false);
  const [follow, setFollow] = useState(true);
  const panels = timeline.filter((item) => renderableTypes.has(item.type));

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !follow || typeof node.scrollTo !== 'function') return;
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 平滑镜头移动本身也会触发 scroll；这段时间不把它误判为用户在查看历史。
    automaticScrollRef.current = true;
    node.scrollTo({ top: node.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
    const timer = window.setTimeout(
      () => {
        automaticScrollRef.current = false;
      },
      reduce ? 0 : 450,
    );
    return () => window.clearTimeout(timer);
  }, [panels.length, follow]);

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node || automaticScrollRef.current) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    setFollow(nearBottom);
  };

  const interruptFollowing = () => {
    automaticScrollRef.current = false;
  };

  const backToCurrent = () => {
    setFollow(true);
    const node = scrollRef.current;
    if (node && typeof node.scrollTo === 'function') {
      automaticScrollRef.current = true;
      node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
    }
  };

  return (
    <div className="comic-wrap">
      <ol
        className="comic-timeline"
        ref={scrollRef}
        onScroll={handleScroll}
        onWheel={interruptFollowing}
        onTouchStart={interruptFollowing}
        onPointerDown={interruptFollowing}
        onKeyDown={interruptFollowing}
        aria-label="对局时间线"
        aria-live="polite"
        tabIndex={0}
      >
        {panels.length === 0 && <li className="comic-empty">对局即将开始…</li>}
        {panels.map((item) => (
          <TimelinePanel key={item.eventSeq} item={item} nameOf={nameOf} />
        ))}
        {pendingAction && <ThinkingPanel action={pendingAction} nameOf={nameOf} />}
      </ol>
      {!follow && (
        <button type="button" className="back-to-current" onClick={backToCurrent}>
          回到当前 ↓
        </button>
      )}
    </div>
  );
}

export function ThinkingPanel({
  action,
  nameOf,
}: {
  action: NonNullable<TimelineProps['pendingAction']>;
  nameOf: TimelineProps['nameOf'];
}) {
  const message =
    action.actionType === 'defend'
      ? '正在组织辩解…'
      : action.actionType === 'revote'
        ? '正在秘密重投…'
        : action.actionType === 'vote'
          ? '正在秘密投票…'
          : '正在组织描述…';
  return (
    <li className="comic-panel comic-panel--thinking" aria-label={`${nameOf(action.actorId)} ${message}`}>
      <span className="comic-speaker">{nameOf(action.actorId)}</span>
      <p className="comic-thinking">
        <span className="thinking-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {message}
      </p>
    </li>
  );
}

export const renderableTypes = new Set([
  'round_started',
  'speech_published',
  'vote_progressed',
  'guess_resolved',
  'votes_revealed',
  'tie_declared',
  'revote_started',
  'player_eliminated',
  'player_rule_violated',
  'round_ended_without_elimination',
]);

export function TimelinePanel({
  item,
  nameOf,
}: {
  item: PublicTimelineItem;
  nameOf: TimelineProps['nameOf'];
}) {
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
    case 'guess_resolved':
      return (
        <li className="comic-panel comic-panel--guess">
          <span className="comic-speaker">{nameOf(payload.actorId as string)}</span>
          <p className="comic-secret">发起猜测，结果：{payload.success === true ? '成功' : '失败'}</p>
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
          <p>{payload.reason === 'all_max' ? '全员最高票，本轮直接结束' : payload.reason === 'guess_batch_no_valid_votes' ? '猜词结算后没有有效选票' : '重投仍然平票'}</p>
        </li>
      );
    case 'player_eliminated':
      return (
        <li className="comic-panel comic-panel--eliminated">
          <span className="comic-stamp comic-stamp--out">出局</span>
          <p>{nameOf(payload.playerId as string)} 被淘汰</p>
        </li>
      );
    case 'player_rule_violated':
      return (
        <li className="comic-panel comic-panel--eliminated">
          <span className="comic-stamp comic-stamp--out">违规</span>
          <p>{nameOf(payload.playerId as string)} 连续违反发言规则</p>
        </li>
      );
    default:
      return null;
  }
}
