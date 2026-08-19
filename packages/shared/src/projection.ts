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
  const human = snapshot.config.participationMode === 'observer'
    ? undefined
    : snapshot.players.find((player) => player.playerId === snapshot.humanPlayerId);
  if (snapshot.config.participationMode !== 'observer' && !human?.silhouette) {
    throw new Error('对局缺少人类玩家');
  }
  const controllerId = snapshot.controllerId ?? snapshot.humanPlayerId;
  if (!controllerId) throw new Error('对局缺少控制者');

  const isHumanTurn = Boolean(human && snapshot.round?.currentActorId === human.playerId);
  const actionType = snapshot.round?.actionType;
  const isVoteAction = actionType === 'vote' || actionType === 'revote';
  const canHumanGuess =
    snapshot.config.gameMode === 'guess' &&
    Boolean(human?.alive) &&
    !human?.guessUsed &&
    (actionType === 'describe' || actionType === 'vote');
  const allowedCommands =
    snapshot.status === 'preparing'
      ? ['StartGame', 'AbandonGame']
      : snapshot.status === 'in_progress' && isHumanTurn && actionType === 'describe'
        ? ['SubmitDescription', ...(canHumanGuess ? ['SubmitGuess'] : []), 'AbandonGame']
        : snapshot.status === 'in_progress' && isHumanTurn && actionType === 'defend'
          ? ['SubmitDefense', 'AbandonGame']
          : snapshot.status === 'in_progress' && isHumanTurn && isVoteAction
            ? ['SubmitVote', ...(canHumanGuess && actionType === 'vote' ? ['SubmitGuess'] : []), 'AbandonGame']
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
    controllerId,
    human: human
      ? {
          playerId: human.playerId,
          displayName: human.displayName,
          silhouette: human.silhouette!,
          ownWordCard: human.wordCard,
          guessUsed: human.guessUsed ?? false,
        }
      : null,
    players: snapshot.players.map((player) => ({
      playerId: player.playerId,
      seatIndex: player.seatIndex,
      kind: player.kind,
      displayName: player.displayName,
      alive: player.alive,
      ...(player.agentRoleId ? { agentRoleId: player.agentRoleId } : {}),
      ...(player.agentRoleDisplay ? { agentRoleDisplay: player.agentRoleDisplay } : {}),
      ...(player.characterAssetKey ? { characterAssetKey: player.characterAssetKey } : {}),
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
      isVoteAction && isHumanTurn && human
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
          factReview: {
            agentActions: factReview?.agentActions ?? [],
            guesses: snapshot.guessHistory ?? factReview?.guesses ?? [],
          },
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
