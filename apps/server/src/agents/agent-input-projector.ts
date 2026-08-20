import {
  agentTurnInputSchema,
  personalityPromptFor,
  type AgentTurnInput,
  type BeliefSnapshot,
  type GameSnapshot,
  type PublicTimelineItem,
} from '@sheishiwodi/shared';

export function projectAgentTurnInput(
  snapshot: GameSnapshot,
  actorId: string,
  publicEvents: readonly PublicTimelineItem[],
  priorOwnBeliefs: readonly BeliefSnapshot[],
): AgentTurnInput {
  const actor = snapshot.players.find(
    (player) => player.playerId === actorId && player.kind === 'agent' && player.alive,
  );
  if (!actor?.agentRoleId || !snapshot.round) throw new Error('AGENT_NOT_AVAILABLE');
  const guessAvailable =
    snapshot.config.gameMode === 'guess' &&
    !actor.guessUsed &&
    (snapshot.round.actionType === 'describe' || snapshot.round.actionType === 'vote');
  const legalTargets =
    snapshot.round.actionType === 'vote' || guessAvailable
      ? snapshot.players
          .filter((player) => player.alive && player.playerId !== actor.playerId)
          .map((player) => player.playerId)
      : snapshot.round.actionType === 'revote'
        ? [...snapshot.round.tieCandidateIds]
        : [];

  return agentTurnInputSchema.parse({
    gameId: snapshot.gameId,
    baseRevision: snapshot.revision,
    actor: {
      playerId: actor.playerId,
      displayName: actor.displayName,
      ownWordCard: actor.wordCard,
      ownCamp: actor.camp,
    },
    publicConfig: snapshot.config,
    players: snapshot.players.map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      alive: player.alive,
      seatIndex: player.seatIndex,
    })),
    roundNumber: snapshot.round.number,
    actionType: snapshot.round.actionType,
    legalTargets,
    guessAvailable,
    tieCandidates: snapshot.round.tieCandidateIds,
    publicEvents,
    priorOwnBeliefs,
    personalityPrompt: actor.agentPersonalityPrompt ?? personalityPromptFor(actor.agentRoleId),
  });
}
