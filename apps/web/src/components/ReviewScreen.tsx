import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  BeliefSnapshot,
  FinaleAgentAction,
  HumanGameView,
  Player,
  PublicTimelineItem,
  RevealPlayer,
  ReviewErrorCode,
  ReviewSummary,
} from '@sheishiwodi/shared';

import { getReview, regenerateReview, reviewExportPath } from '../api';
import { characterKeyFor } from '../character-assets';
import { CharacterPortrait } from './CharacterPortrait';

interface ReviewScreenProps {
  game: HumanGameView;
  onBack: () => void;
}

// 复盘时间线里的一个节点：叙事事件本身，以及（若为 AI 行动）关联的信念/输出。
interface ReviewNode {
  key: string;
  kind: 'round' | 'speech' | 'votes' | 'stamp';
  round: number;
  title: string;
  body?: string;
  bullets?: string[];
  belief?: BeliefSnapshot | undefined;
  outputReason?: string | undefined;
  actorName?: string | undefined;
}

export function ReviewScreen({ game, onBack }: ReviewScreenProps) {
  const players = game.players;
  const reveal = game.reveal;
  const factReview = game.factReview;

  const nameOf = useMemo(() => {
    const map = new Map(players.map((player) => [player.playerId, player.displayName]));
    return (playerId: string | null | undefined) => (playerId && map.get(playerId)) || '未知玩家';
  }, [players]);

  const playerById = useMemo(() => {
    return new Map(players.map((player) => [player.playerId, player] as const));
  }, [players]);

  const revealByPlayer = useMemo(() => {
    const map = new Map<string, RevealPlayer>();
    for (const entry of reveal?.players ?? []) map.set(entry.playerId, entry);
    return map;
  }, [reveal]);

  const nodes = useMemo(
    () => buildReviewNodes(game.publicTimeline, factReview?.agentActions ?? [], nameOf),
    [game.publicTimeline, factReview, nameOf],
  );

  // 非正常终局（无 reveal/factReview）时给出温和的空态，仍允许返回。
  if (!reveal || !factReview) {
    return (
      <section className="storyboard review-screen" aria-labelledby="review-title">
        <ReviewHeader onBack={onBack} />
        <p className="lede">本局没有可复盘的终局事实（可能已放弃或非正常结束）。</p>
      </section>
    );
  }

  const civilianWin = game.winnerCamp === 'civilian';
  const identityRows = [...reveal.players].sort((a, b) => a.seatIndex - b.seatIndex);

  return (
    <section className="storyboard review-screen" aria-labelledby="review-title">
      <ReviewHeader onBack={onBack} exportHref={reviewExportPath(game.gameId)} />

      <div className="review-reveal">
        <span
          className={`finale-stamp ${civilianWin ? 'finale-stamp--civilian' : 'finale-stamp--undercover'}`}
        >
          {civilianWin ? '平民胜利' : '卧底胜利'}
        </span>
        <p className="finale-reason">{finaleReason(game.endReason)}</p>
        <dl className="review-wordpair">
          <div>
            <dt>类别</dt>
            <dd>{reveal.wordPair.category}</dd>
          </div>
          <div>
            <dt>平民词</dt>
            <dd>{reveal.wordPair.civilianWord}</dd>
          </div>
          <div>
            <dt>卧底词</dt>
            <dd>{reveal.wordPair.undercoverWord}</dd>
          </div>
        </dl>
      </div>

      <section className="review-identities" aria-label="真实身份与词牌">
        <h2>真实身份</h2>
        <ol className="review-identity-grid">
          {identityRows.map((entry) => (
            <IdentityCard
              key={entry.playerId}
              entry={entry}
              player={playerById.get(entry.playerId)}
              humanSilhouette={game.human.silhouette}
              nameOf={nameOf}
            />
          ))}
        </ol>
      </section>

      <AiReviewSection gameId={game.gameId} nameOf={nameOf} />

      <section className="review-timeline-section" aria-label="信念时间线">
        <h2>信念时间线</h2>
        <p className="review-hint">
          公开时间线共 {game.publicTimeline.length} 条，AI 私有行动共 {factReview.agentActions.length} 条。
          点击 AI 的发言或投票可展开其当时的心理活动。
        </p>
        <ol className="review-timeline">
          {nodes.map((node) => (
            <ReviewTimelineNode key={node.key} node={node} revealByPlayer={revealByPlayer} nameOf={nameOf} />
          ))}
        </ol>
      </section>
    </section>
  );
}

// 复盘生成还需轮询的中间态。
const PENDING_STATES: ReadonlySet<ReviewSummary['status']> = new Set(['pending', 'generating']);
const REVIEW_POLL_MS = 2000;

// 拉取并轮询 AI 复盘：生成中每 2s 拉一次；卸载即停；regenerate 后重启轮询。
function useReview(gameId: string) {
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const next = await getReview(gameId);
        if (cancelled) return;
        setSummary(next);
        setError(null);
        if (PENDING_STATES.has(next.status)) {
          timer = setTimeout(() => void poll(), REVIEW_POLL_MS);
        }
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : '复盘暂不可用');
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [gameId, reloadKey]);

  const regenerate = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const next = await regenerateReview(gameId);
      setSummary(next);
      setError(null);
      setReloadKey((key) => key + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '重新生成失败');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [gameId]);

  return { summary, error, busy, regenerate };
}

const REVIEW_ERROR_TEXT: Record<ReviewErrorCode, string> = {
  MODEL_NOT_CONFIGURED: '未配置复盘模型。',
  CALL_FAILED: '调用复盘模型失败。',
  CALL_TIMEOUT: '复盘模型响应超时。',
  NETWORK_FAILED: '连接复盘模型时网络异常。',
  RATE_LIMITED: '复盘模型触发限流，请稍后重试。',
  PROVIDER_UNAVAILABLE: '复盘模型服务暂不可用。',
  AUTH_FAILED: '复盘模型鉴权失败。',
  MODEL_NOT_FOUND: '找不到指定的复盘模型。',
  REQUEST_REJECTED: '复盘请求被模型拒绝。',
  BAD_RESPONSE: '复盘模型返回内容异常。',
  FORMAT_INVALID: '复盘结果格式不合法。',
  NOT_REVIEWABLE: '本局缺少可复盘的终局事实。',
  INTERNAL_ERROR: '生成复盘时发生内部错误。',
};

// AI 复盘评价区：与上方「事实」区明确分区（DEC-029），只呈现脱敏产物 + model ID。
function AiReviewSection({
  gameId,
  nameOf,
}: {
  gameId: string;
  nameOf: (playerId: string | null | undefined) => string;
}) {
  const { summary, error, busy, regenerate } = useReview(gameId);

  return (
    <section className="review-ai" aria-label="AI 复盘评价">
      <div className="review-ai__head">
        <h2>AI 复盘评价</h2>
        {summary && <span className="review-ai__model">模型：{summary.modelId}</span>}
      </div>
      <p className="review-ai__disclaimer">以下为复盘模型对本局的分析评价，非对局事实，仅供参考。</p>

      {renderAiBody({ summary, error, busy, regenerate, nameOf })}
    </section>
  );
}

function renderAiBody({
  summary,
  error,
  busy,
  regenerate,
  nameOf,
}: {
  summary: ReviewSummary | null;
  error: string | null;
  busy: boolean;
  regenerate: () => void;
  nameOf: (playerId: string | null | undefined) => string;
}) {
  if (!summary) {
    if (error) {
      return (
        <div className="review-ai__state review-ai__state--failed">
          <p>复盘暂不可用。</p>
          <button type="button" className="secondary-action" disabled={busy} onClick={() => regenerate()}>
            {busy ? '重新生成中…' : '重新生成'}
          </button>
        </div>
      );
    }
    return <p className="review-ai__state">正在载入复盘…</p>;
  }

  if (summary.status === 'pending' || summary.status === 'generating') {
    return (
      <p className="review-ai__state review-ai__state--generating" aria-live="polite">
        <span className="review-ai__spinner" aria-hidden="true" />
        AI 正在复盘本局，请稍候…
      </p>
    );
  }

  if (summary.status === 'failed') {
    return (
      <div className="review-ai__state review-ai__state--failed">
        <p>{summary.errorCode ? REVIEW_ERROR_TEXT[summary.errorCode] : '复盘生成失败。'}</p>
        <button type="button" className="secondary-action" disabled={busy} onClick={() => regenerate()}>
          {busy ? '重新生成中…' : '重新生成'}
        </button>
      </div>
    );
  }

  return (
    <div className="review-ai__result">
      <div className="review-ai__overall">
        <h3>总体点评</h3>
        <p>{summary.overall}</p>
      </div>
      {summary.perAgent.length > 0 && (
        <ul className="review-ai__agents">
          {summary.perAgent.map((agent) => (
            <li key={agent.playerId} className="review-ai-agent">
              <div className="review-ai-agent__head">
                <strong>{nameOf(agent.playerId)}</strong>
                {typeof agent.rating === 'number' && (
                  <span className="review-ai-agent__rating" aria-label={`评分 ${agent.rating} 分`}>
                    {'★'.repeat(agent.rating)}
                    {'☆'.repeat(5 - agent.rating)}
                  </span>
                )}
              </div>
              <p className="review-ai-agent__verdict">{agent.verdict}</p>
              {agent.keyMoments.length > 0 && (
                <ul className="review-ai-agent__moments">
                  {agent.keyMoments.map((moment, index) => (
                    <li key={index}>{moment}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="review-ai__refresh">
        <button type="button" className="secondary-action" disabled={busy} onClick={() => regenerate()}>
          {busy ? '重新生成中…' : '重新生成'}
        </button>
      </div>
    </div>
  );
}

function ReviewHeader({ onBack, exportHref }: { onBack: () => void; exportHref?: string }) {
  return (
    <header className="review-header">
      <div>
        <p className="eyebrow">赛后复盘</p>
        <h1 id="review-title">对局复盘</h1>
      </div>
      <div className="review-header__actions">
        {exportHref && (
          <a className="secondary-action review-export" href={exportHref} download>
            导出 Markdown
          </a>
        )}
        <button type="button" className="secondary-action" onClick={onBack}>
          返回对局
        </button>
      </div>
    </header>
  );
}

function IdentityCard({
  entry,
  player,
  humanSilhouette,
  nameOf,
}: {
  entry: RevealPlayer;
  player: Player | undefined;
  humanSilhouette: HumanGameView['human']['silhouette'];
  nameOf: (playerId: string | null | undefined) => string;
}) {
  const isUndercover = entry.camp === 'undercover';
  const characterKey = player
    ? characterKeyFor(player, humanSilhouette)
    : characterKeyFor({ kind: 'agent', displayName: nameOf(entry.playerId) }, humanSilhouette);
  return (
    <li className="review-identity-card" data-camp={entry.camp}>
      <CharacterPortrait characterKey={characterKey} label={nameOf(entry.playerId)} state="idle" />
      <strong>{nameOf(entry.playerId)}</strong>
      <span className={`review-camp-badge ${isUndercover ? 'is-undercover' : 'is-civilian'}`}>
        {isUndercover ? '卧底' : '平民'}
      </span>
      <b className="review-wordcard">{entry.wordCard}</b>
    </li>
  );
}

function ReviewTimelineNode({
  node,
  revealByPlayer,
  nameOf,
}: {
  node: ReviewNode;
  revealByPlayer: Map<string, RevealPlayer>;
  nameOf: (playerId: string | null | undefined) => string;
}) {
  const [open, setOpen] = useState(false);

  if (node.kind === 'round') {
    return (
      <li className="review-divider">
        <span>{node.title}</span>
      </li>
    );
  }

  if (node.kind === 'stamp') {
    return (
      <li className="review-node review-node--stamp">
        <span className="review-node__title">{node.title}</span>
        {node.body && <p>{node.body}</p>}
      </li>
    );
  }

  const expandable = Boolean(node.belief);

  return (
    <li className={`review-node review-node--${node.kind}`}>
      <div className="review-node__head">
        {node.actorName && <span className="review-node__actor">{node.actorName}</span>}
        <span className="review-node__title">{node.title}</span>
      </div>
      {node.body && <p className="review-node__body">{node.body}</p>}
      {node.bullets && (
        <ul className="review-node__bullets">
          {node.bullets.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
      {expandable && (
        <button
          type="button"
          className="review-belief-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '收起心理活动' : '展开心理活动'}
        </button>
      )}
      {expandable && open && node.belief && (
        <BeliefDetails
          belief={node.belief}
          outputReason={node.outputReason}
          revealByPlayer={revealByPlayer}
          nameOf={nameOf}
        />
      )}
    </li>
  );
}

function BeliefDetails({
  belief,
  outputReason,
  revealByPlayer,
  nameOf,
}: {
  belief: BeliefSnapshot;
  outputReason?: string | undefined;
  revealByPlayer: Map<string, RevealPlayer>;
  nameOf: (playerId: string | null | undefined) => string;
}) {
  const probabilities = [...belief.playerUndercoverProbabilities].sort(
    (a, b) => b.probability - a.probability,
  );
  const candidates = [...belief.opposingWordCandidates].sort((a, b) => b.confidence - a.confidence);
  return (
    <div className="review-belief">
      <p className="review-belief__summary">{belief.reasoningSummary}</p>

      {outputReason && (
        <p className="review-belief__reason">
          <span>投票理由：</span>
          {outputReason}
        </p>
      )}

      <div className="review-belief__group">
        <h4>怀疑分布</h4>
        <ul className="review-prob-list">
          {probabilities.map((entry) => {
            const percent = Math.round(entry.probability * 100);
            const undercover = revealByPlayer.get(entry.playerId)?.camp === 'undercover';
            return (
              <li key={entry.playerId} className="review-prob" data-actual-undercover={undercover}>
                <span className="review-prob__name">{nameOf(entry.playerId)}</span>
                <span className="review-prob__bar" aria-hidden="true">
                  <span className="review-prob__fill" style={{ width: `${percent}%` }} />
                </span>
                <span className="review-prob__value">{percent}%</span>
              </li>
            );
          })}
        </ul>
      </div>

      {candidates.length > 0 && (
        <div className="review-belief__group">
          <h4>对方词猜测</h4>
          <ul className="review-candidate-list">
            {candidates.map((entry, index) => (
              <li key={index} className="review-candidate">
                <b>{entry.word}</b>
                <span className="review-candidate__confidence">
                  {Math.round(entry.confidence * 100)}%
                </span>
                <span className="review-candidate__evidence">{entry.evidence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// 走一遍公开时间线，跟踪当前轮次与是否处于重投，把每个 AI 发言/投票节点关联到对应的信念快照。
function buildReviewNodes(
  timeline: PublicTimelineItem[],
  agentActions: FinaleAgentAction[],
  nameOf: (playerId: string | null | undefined) => string,
): ReviewNode[] {
  const nodes: ReviewNode[] = [];
  const consumed = new Set<string>();
  let round = 0;
  let inRevote = false;

  const takeAction = (playerId: string, actionTypes: string[]): FinaleAgentAction | undefined => {
    const match = agentActions.find(
      (action) =>
        action.playerId === playerId &&
        action.roundNumber === round &&
        actionTypes.includes(action.actionType) &&
        !consumed.has(action.actionId),
    );
    if (match) consumed.add(match.actionId);
    return match;
  };

  const outputReasonOf = (action: FinaleAgentAction): string | undefined => {
    const reason = action.output?.reason;
    return typeof reason === 'string' ? reason : undefined;
  };

  for (const item of timeline) {
    const payload = item.payload as Record<string, unknown>;
    switch (item.type) {
      case 'round_started': {
        round = Number(payload.roundNumber ?? round + 1);
        inRevote = false;
        nodes.push({ key: `r-${item.eventSeq}`, kind: 'round', round, title: `第 ${round} 轮` });
        break;
      }
      case 'speech_published': {
        const actorId = payload.actorId as string;
        const actionType = payload.actionType === 'defend' ? 'defend' : 'describe';
        const action = takeAction(actorId, [actionType]);
        nodes.push({
          key: `s-${item.eventSeq}`,
          kind: 'speech',
          round,
          actorName: nameOf(actorId),
          title: actionType === 'defend' ? '辩解' : '描述',
          body: String(payload.text ?? ''),
          belief: action?.belief,
        });
        break;
      }
      case 'votes_revealed': {
        const votes = Array.isArray(payload.votes)
          ? (payload.votes as Array<{ voterId: string; targetPlayerId: string }>)
          : [];
        nodes.push({
          key: `v-${item.eventSeq}`,
          kind: 'votes',
          round,
          title: inRevote ? '重投揭晓' : '统一揭票',
          bullets: votes.map((vote) => `${nameOf(vote.voterId)} → ${nameOf(vote.targetPlayerId)}`),
        });
        // 每个投票者（AI）的信念各自作为可展开节点，紧随揭票。
        for (const vote of votes) {
          const action = takeAction(vote.voterId, inRevote ? ['revote', 'vote'] : ['vote']);
          if (!action) continue;
          nodes.push({
            key: `vb-${item.eventSeq}-${vote.voterId}`,
            kind: 'votes',
            round,
            actorName: nameOf(vote.voterId),
            title: `投给 ${nameOf(vote.targetPlayerId)}`,
            belief: action.belief,
            outputReason: outputReasonOf(action),
          });
        }
        break;
      }
      case 'revote_started': {
        inRevote = true;
        const candidateIds = Array.isArray(payload.candidateIds)
          ? (payload.candidateIds as string[])
          : [];
        nodes.push({
          key: `rv-${item.eventSeq}`,
          kind: 'stamp',
          round,
          title: '重投',
          body: `仅在 ${candidateIds.map(nameOf).join('、')} 中重投`,
        });
        break;
      }
      case 'tie_declared': {
        const ids = Array.isArray(payload.candidateIds) ? (payload.candidateIds as string[]) : [];
        nodes.push({
          key: `t-${item.eventSeq}`,
          kind: 'stamp',
          round,
          title: '平票',
          body: ids.map(nameOf).join('、'),
        });
        break;
      }
      case 'player_eliminated': {
        nodes.push({
          key: `e-${item.eventSeq}`,
          kind: 'stamp',
          round,
          title: '出局',
          body: `${nameOf(payload.playerId as string)} 被淘汰`,
        });
        break;
      }
      case 'round_ended_without_elimination': {
        nodes.push({
          key: `n-${item.eventSeq}`,
          kind: 'stamp',
          round,
          title: '无人出局',
          body: payload.reason === 'all_max' ? '全员最高票，本轮直接结束' : '重投仍然平票',
        });
        break;
      }
      default:
        break;
    }
  }

  return nodes;
}

function finaleReason(endReason: HumanGameView['endReason']) {
  if (endReason === 'undercover_eliminated') return '卧底被票出，平民阵营获胜。';
  if (endReason === 'undercover_survived_to_two') return '卧底存活到只剩两人，卧底阵营获胜。';
  if (endReason === 'player_rule_violation') return '有玩家因重复违反发言规则退出，系统已重新判定胜负。';
  return '对局已结束。';
}
