import type {
  FactReview,
  FinaleReveal,
  HumanGameView,
  PublicTimelineItem,
  ReviewGeneration,
} from '@sheishiwodi/shared';

/** 复盘生成的输入：全部来自终局事实投影（reveal + factReview + 公开时间线），只读。 */
export interface ReviewInput {
  gameId: string;
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
