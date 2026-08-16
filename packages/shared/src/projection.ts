import {
  humanGameViewSchema,
  type FactReview,
  type HumanGameView,
  type PublicTimelineItem,
} from './views.js';
import type { GameSnapshot } from './state.js';

export function projectHumanGameView(
  snapshot: GameSnapshot,
  publicTimeline: readonly PublicTimelineItem[] = [],
  factReview?: FactReview,
): HumanGameView {
  const human = snapshot.players.find((player) => player.playerId === snapshot.humanPlayerId);
  if (!human?.silhouette) {
    throw new Error('对局缺少人类玩家');
  }

  const isHumanTurn = snapshot.round?.currentActorId === human.playerId;
  const actionType = snapshot.round?.actionType;
  const isVoteAction = actionType === 'vote' || actionType === 'revote';
  const allowedCommands =
    snapshot.status === 'preparing'
      ? ['StartGame', 'AbandonGame']
      : snapshot.status === 'in_progress' && isHumanTurn && actionType === 'describe'
        ? ['SubmitDescription', 'AbandonGame']
        : snapshot.status === 'in_progress' && isHumanTurn && actionType === 'defend'
          ? ['SubmitDefense', 'AbandonGame']
          : snapshot.status === 'in_progress' && isHumanTurn && isVoteAction
            ? ['SubmitVote', 'AbandonGame']
            : snapshot.status === 'in_progress'
              ? ['AbandonGame']
              : snapshot.status === 'awaiting_spectator'
                ? ['ContinueSpectating', 'AbandonGame']
                : [];

  return humanGameViewSchema.parse({
    gameId: snapshot.gameId,
    status: snapshot.status,
    phase: snapshot.phase,
    revision: snapshot.revision,
    eventCursor: snapshot.streamSeq,
    config: snapshot.config,
    human: {
      playerId: human.playerId,
      displayName: human.displayName,
      silhouette: human.silhouette,
      ownWordCard: human.wordCard,
    },
    players: snapshot.players.map((player) => ({
      playerId: player.playerId,
      seatIndex: player.seatIndex,
      kind: player.kind,
      displayName: player.displayName,
      alive: player.alive,
      ...(player.agentRoleDisplay ? { agentRoleDisplay: player.agentRoleDisplay } : {}),
    })),
    round: snapshot.round
      ? {
          number: snapshot.round.number,
          speakingOrder: snapshot.round.speakingOrder,
          currentActorId: snapshot.round.currentActorId,
          actionType: snapshot.round.actionType,
          tieCandidateIds: snapshot.round.tieCandidateIds,
        }
      : null,
    publicTimeline,
    voteProgress: { completedPlayerIds: snapshot.round?.completedVoterIds ?? [] },
    legalVoteTargetIds:
      isVoteAction && isHumanTurn
        ? actionType === 'revote'
          ? snapshot.round!.tieCandidateIds
          : snapshot.players
              .filter((player) => player.alive && player.playerId !== human.playerId)
              .map((player) => player.playerId)
        : [],
    ...(snapshot.winnerCamp ? { winnerCamp: snapshot.winnerCamp } : {}),
    ...(snapshot.endReason ? { endReason: snapshot.endReason } : {}),
    ...(snapshot.status === 'finished'
      ? {
          reveal: {
            wordPair: {
              civilianWord: snapshot.wordPair.civilianWord,
              undercoverWord: snapshot.wordPair.undercoverWord,
              category: snapshot.wordPair.category,
            },
            players: [...snapshot.players]
              .sort((left, right) => left.seatIndex - right.seatIndex)
              .map((player) => ({
                playerId: player.playerId,
                seatIndex: player.seatIndex,
                camp: player.camp,
                wordCard: player.wordCard,
              })),
          },
          factReview: factReview ?? { agentActions: [] },
        }
      : {}),
    allowedCommands,
    operationalStatus: {
      state:
        snapshot.status === 'preparing' || isHumanTurn
          ? 'waiting_human'
          : snapshot.status === 'in_progress'
            ? 'agent_working'
            : 'idle',
      ...(snapshot.status === 'in_progress' && snapshot.round
        ? { actorId: snapshot.round.currentActorId }
        : {}),
    },
  });
}
