import type {
  BeliefSnapshot,
  FactReview,
  FinaleReveal,
  HumanGameView,
  PublicTimelineItem,
  ReviewGeneration,
} from '@sheishiwodi/shared';

export interface GuessDecisionFrame {
  actionId: string;
  actorId: string;
  roundNumber: number;
  phase: 'describe' | 'vote';
  decisionType: 'attempt' | 'hold_candidate';
  publicEventCursor: number | null;
  contextComplete: boolean;
  publicEventsBeforeAction: readonly PublicTimelineItem[];
  beliefAtAction: BeliefSnapshot;
  action: Record<string, unknown>;
  outcome?: {
    success: boolean;
    eliminatedPlayerId: string;
  };
}

/** 复盘生成的输入：全部来自终局事实投影（reveal + factReview + 公开时间线），只读。 */
export interface ReviewInput {
  gameId: string;
  gameMode: 'classic' | 'guess';
  winnerCamp: 'civilian' | 'undercover' | 'draw';
  endReason: string;
  reveal: FinaleReveal;
  /** 参与玩家的公开信息（用于把 playerId 映射到显示名 / 区分人机）。 */
  players: ReadonlyArray<{ playerId: string; displayName: string; kind: 'human' | 'agent' }>;
  publicTimeline: readonly PublicTimelineItem[];
  factReview: FactReview;
}

/**
 * 复盘策略：终局后对各 AI 生成评价。modelId 对外可见（会被持久化与投影），
 * 但连接凭据只在具体实现内部（复用 TokendanceClient）。
 */
export interface ReviewPolicy {
  /** 本策略使用的复盘模型 ID（脱敏可公开）。 */
  readonly modelId: string;
  generate(
    input: ReviewInput,
    context?: {
      commandId: string;
      actionId: string;
      lifecycle?: { validatedAttemptId?: string };
    },
  ): Promise<ReviewGeneration>;
}

/** 从终局视图组装复盘输入；非正常终局（无 reveal/factReview/winnerCamp）返回 null。 */
export function buildReviewInput(view: HumanGameView): ReviewInput | null {
  if (view.status !== 'finished' || !view.reveal || !view.factReview || !view.winnerCamp) {
    return null;
  }
  return {
    gameId: view.gameId,
    gameMode: view.config.gameMode ?? 'classic',
    winnerCamp: view.winnerCamp,
    endReason: view.endReason ?? 'unknown',
    reveal: view.reveal,
    players: view.players.map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      kind: player.kind,
    })),
    publicTimeline: view.publicTimeline,
    factReview: view.factReview,
  };
}

/**
 * 为猜词专项复盘构造行动时证据帧。实际猜词全部保留；未猜行为只保留置信度较高的
 * 少量候选，供模型判断是否真的错失机会。旧记录无游标时不得成为“错失机会”候选。
 */
export function buildGuessDecisionFrames(input: ReviewInput): GuessDecisionFrame[] {
  if (input.gameMode !== 'guess') return [];

  const agentIds = new Set(
    input.players.filter((player) => player.kind === 'agent').map((player) => player.playerId),
  );
  const campByPlayer = new Map(
    input.reveal.players.map((player) => [player.playerId, player.camp] as const),
  );
  const usedGuess = new Set<string>();
  const attempts: GuessDecisionFrame[] = [];
  const holds: Array<{ frame: GuessDecisionFrame; signal: number }> = [];

  const eligibleActions = [...input.factReview.agentActions]
    .filter(
      (action) =>
        agentIds.has(action.playerId) &&
        (action.actionType === 'describe' || action.actionType === 'vote'),
    )
    .sort((left, right) => {
      if (left.roundNumber !== right.roundNumber) return left.roundNumber - right.roundNumber;
      const leftPhase = left.actionType === 'describe' ? 0 : 1;
      const rightPhase = right.actionType === 'describe' ? 0 : 1;
      if (leftPhase !== rightPhase) return leftPhase - rightPhase;
      if (left.baseRevision !== right.baseRevision) return left.baseRevision - right.baseRevision;
      return left.actionId.localeCompare(right.actionId);
    });

  for (const action of eligibleActions) {
    if (usedGuess.has(action.playerId)) continue;
    const cursor = action.publicEventCursor ?? null;
    const isAttempt = action.output['action'] === 'guess';
    const guess = isAttempt
      ? (input.factReview.guesses ?? []).find(
          (entry) =>
            entry.actorId === action.playerId &&
            entry.roundNumber === action.roundNumber &&
            entry.phase === action.actionType &&
            entry.targetPlayerId === action.output['targetPlayerId'] &&
            entry.guessedWord === action.output['guessedWord'],
        )
      : undefined;
    const frame: GuessDecisionFrame = {
      actionId: action.actionId,
      actorId: action.playerId,
      roundNumber: action.roundNumber,
      phase: action.actionType === 'describe' ? 'describe' : 'vote',
      decisionType: isAttempt ? 'attempt' : 'hold_candidate',
      publicEventCursor: cursor,
      contextComplete: cursor !== null,
      publicEventsBeforeAction:
        cursor === null
          ? []
          : input.publicTimeline.filter((event) => event.eventSeq <= cursor),
      beliefAtAction: action.belief,
      action: action.output,
      ...(guess
        ? { outcome: { success: guess.success, eliminatedPlayerId: guess.eliminatedPlayerId } }
        : {}),
    };

    if (isAttempt) {
      attempts.push(frame);
      usedGuess.add(action.playerId);
      continue;
    }
    if (cursor === null) continue;

    const wordConfidence = Math.max(
      0,
      ...action.belief.opposingWordCandidates.map((candidate) => candidate.confidence),
    );
    const ownCamp = campByPlayer.get(action.playerId);
    const opposingCampConfidence = Math.max(
      0,
      ...action.belief.playerUndercoverProbabilities
        .filter((entry) => entry.playerId !== action.playerId)
        .map((entry) => (ownCamp === 'undercover' ? 1 - entry.probability : entry.probability)),
    );
    if (wordConfidence >= 0.55 && opposingCampConfidence >= 0.55) {
      holds.push({ frame, signal: wordConfidence * opposingCampConfidence });
    }
  }

  return [
    ...attempts,
    ...holds
      .sort((left, right) => right.signal - left.signal)
      .slice(0, 5)
      .map((entry) => entry.frame),
  ].sort((left, right) => {
    if (left.roundNumber !== right.roundNumber) return left.roundNumber - right.roundNumber;
    if (left.phase !== right.phase) return left.phase === 'describe' ? -1 : 1;
    return left.actionId.localeCompare(right.actionId);
  });
}
