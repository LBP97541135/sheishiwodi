import type { Clock, IdSource } from './game-setup.js';
import type {
  AbandonGameCommand,
  ContinueSpectatingCommand,
  DisqualifyPlayerForRuleViolationCommand,
  ResolveInterruptedGameCommand,
  SubmitDefenseCommand,
  SubmitDescriptionCommand,
  SubmitVoteCommand,
  TerminateForSystemErrorCommand,
} from './commands.js';
import { gameSnapshotSchema, type GameSnapshot } from './state.js';
import type { GameEvent } from './events.js';
import { validatePublicSpeech } from './content-validation.js';

export interface MachineDependencies {
  ids: IdSource;
  clock: Clock;
}

export interface MachineTransition {
  snapshot: GameSnapshot;
  events: GameEvent[];
}

type EventDefinition = [GameEvent['type'], GameEvent['visibility'], Record<string, unknown>];
type RoundState = NonNullable<GameSnapshot['round']>;

export function continueSpectating(
  snapshot: GameSnapshot,
  command: ContinueSpectatingCommand,
  dependencies: MachineDependencies,
): MachineTransition {
  if (snapshot.revision !== command.expectedRevision) throw new Error('REVISION_CONFLICT');
  if (snapshot.status !== 'awaiting_spectator' || !snapshot.resumeAfterSpectating) {
    throw new Error('INVALID_TRANSITION');
  }
  if (command.actorId !== snapshot.humanPlayerId) throw new Error('ACTOR_NOT_ALLOWED');
  const nextRound = snapshot.resumeAfterSpectating;
  const definitions: EventDefinition[] = [
    ['spectating_started', 'public', { playerId: command.actorId }],
    ['round_started', 'public', { roundNumber: nextRound.number, speakingOrder: nextRound.speakingOrder }],
    ['turn_started', 'public', { actorId: nextRound.currentActorId, actionType: 'describe' }],
  ];
  const result = buildTransition(snapshot, command.commandId, definitions, dependencies, nextRound);
  const resumed = { ...result.snapshot };
  delete resumed.resumeAfterSpectating;
  return {
    ...result,
    snapshot: gameSnapshotSchema.parse({
      ...resumed,
      status: 'in_progress',
      phase: 'speaking',
    }),
  };
}

export function abandonGame(
  snapshot: GameSnapshot,
  command: AbandonGameCommand,
  dependencies: MachineDependencies,
): MachineTransition {
  if (snapshot.revision !== command.expectedRevision) throw new Error('REVISION_CONFLICT');
  if (!['preparing', 'in_progress', 'awaiting_spectator'].includes(snapshot.status)) {
    throw new Error('INVALID_TRANSITION');
  }
  if (command.actorId !== snapshot.humanPlayerId || command.confirmed !== true) {
    throw new Error('ACTOR_NOT_ALLOWED');
  }
  const round = snapshot.round;
  const result = buildTransition(
    snapshot,
    command.commandId,
    [['game_abandoned', 'public', { playerId: command.actorId }]],
    dependencies,
    round,
  );
  const abandoned = { ...result.snapshot };
  delete abandoned.winnerCamp;
  delete abandoned.resumeAfterSpectating;
  return {
    ...result,
    snapshot: gameSnapshotSchema.parse({
      ...abandoned,
      status: 'abandoned',
      phase: 'ended',
      round: null,
      endReason: 'abandoned_by_human',
    }),
  };
}

export function terminateForSystemError(
  snapshot: GameSnapshot,
  command: TerminateForSystemErrorCommand,
  dependencies: MachineDependencies,
): MachineTransition {
  if (snapshot.revision !== command.expectedRevision) throw new Error('REVISION_CONFLICT');
  if (snapshot.status !== 'in_progress') {
    throw new Error('INVALID_TRANSITION');
  }
  const result = buildTransition(
    snapshot,
    command.commandId,
    [
      [
        'game_system_terminated',
        'public',
        { failedActionId: command.failedActionId, errorType: command.errorType },
      ],
    ],
    dependencies,
    null,
  );
  const terminated = { ...result.snapshot };
  delete terminated.winnerCamp;
  delete terminated.resumeAfterSpectating;
  return {
    ...result,
    snapshot: gameSnapshotSchema.parse({
      ...terminated,
      status: 'system_terminated',
      phase: 'ended',
      round: null,
      endReason: 'model_failure_limit',
    }),
  };
}

export function declineInterruptedGame(
  snapshot: GameSnapshot,
  command: ResolveInterruptedGameCommand,
  dependencies: MachineDependencies,
): MachineTransition {
  if (snapshot.revision !== command.expectedRevision) throw new Error('REVISION_CONFLICT');
  if (snapshot.status !== 'in_progress' || command.resolution !== 'start_new') {
    throw new Error('INVALID_TRANSITION');
  }
  if (command.actorId !== snapshot.humanPlayerId) throw new Error('ACTOR_NOT_ALLOWED');
  const result = buildTransition(
    snapshot,
    command.commandId,
    [['game_interruption_declined', 'public', { playerId: command.actorId }]],
    dependencies,
    null,
  );
  const abandoned = { ...result.snapshot };
  delete abandoned.winnerCamp;
  delete abandoned.resumeAfterSpectating;
  return {
    ...result,
    snapshot: gameSnapshotSchema.parse({
      ...abandoned,
      status: 'abandoned',
      phase: 'ended',
      round: null,
      endReason: 'interrupted_not_resumed',
    }),
  };
}

export function disqualifyPlayerForRuleViolation(
  snapshot: GameSnapshot,
  command: DisqualifyPlayerForRuleViolationCommand,
  dependencies: MachineDependencies,
): MachineTransition {
  const round = snapshot.round;
  if (snapshot.revision !== command.expectedRevision) throw new Error('REVISION_CONFLICT');
  if (snapshot.status !== 'in_progress' || !round) throw new Error('INVALID_TRANSITION');
  if (round.currentActorId !== command.actorId) throw new Error('ACTOR_NOT_ALLOWED');
  const actor = snapshot.players.find(
    (player) => player.playerId === command.actorId && player.kind === 'agent' && player.alive,
  );
  if (!actor) throw new Error('ACTOR_NOT_ALLOWED');
  if (round.actionType !== 'describe' && round.actionType !== 'defend') {
    throw new Error('INVALID_TRANSITION');
  }

  return eliminateResult(
    snapshot,
    round,
    [
      [
        'player_rule_violated',
        'public',
        { playerId: actor.playerId, rule: command.rule, failedActionId: command.failedActionId },
      ],
    ],
    actor.playerId,
    command.commandId,
    dependencies,
    'player_rule_violation',
  );
}

export function submitDescription(
  snapshot: GameSnapshot,
  command: SubmitDescriptionCommand,
  dependencies: MachineDependencies,
): MachineTransition {
  const round = requireRound(snapshot, command.expectedRevision, 'speaking', 'describe');
  if (round.currentActorId !== command.actorId) throw new Error('ACTOR_NOT_ALLOWED');
  const actor = snapshot.players.find((player) => player.playerId === command.actorId && player.alive);
  if (!actor) throw new Error('ACTOR_NOT_ALLOWED');
  const validation = validatePublicSpeech(command.text, actor.wordCard);
  if (!validation.valid) throw new Error(`CONTENT_REJECTED:${validation.code}`);

  const completedSpeakerIds = [...round.completedSpeakerIds, actor.playerId];
  const livingOrder = round.speakingOrder.filter((playerId) =>
    snapshot.players.some((player) => player.playerId === playerId && player.alive),
  );
  const nextSpeaker = livingOrder.find((playerId) => !completedSpeakerIds.includes(playerId));
  const livingIds = snapshot.players.filter((player) => player.alive).map((player) => player.playerId);
  const nextActionType = nextSpeaker ? 'describe' : 'vote';
  const nextActorId = nextSpeaker ?? livingIds[0]!;
  const definitions: EventDefinition[] = [
    [
      'speech_published',
      'public',
      { actorId: actor.playerId, actionType: 'describe', text: command.text.trim() },
    ],
    ['turn_started', 'public', { actorId: nextActorId, actionType: nextActionType }],
  ];

  const result = buildTransition(snapshot, command.commandId, definitions, dependencies, {
    ...round,
    currentActorId: nextActorId,
    actionType: nextActionType,
    completedSpeakerIds,
    ...(nextActionType === 'vote'
      ? { completedVoterIds: [], votes: [], tieCandidateIds: [] }
      : {}),
  });
  return nextActionType === 'vote'
    ? { ...result, snapshot: withPhase(result.snapshot, 'voting') }
    : result;
}

export function submitDefense(
  snapshot: GameSnapshot,
  command: SubmitDefenseCommand,
  dependencies: MachineDependencies,
): MachineTransition {
  const round = requireRound(snapshot, command.expectedRevision, 'tie_defense', 'defend');
  if (round.currentActorId !== command.actorId) throw new Error('ACTOR_NOT_ALLOWED');
  const actor = snapshot.players.find((player) => player.playerId === command.actorId && player.alive);
  if (!actor || !round.tieCandidateIds.includes(actor.playerId)) throw new Error('ACTOR_NOT_ALLOWED');
  const validation = validatePublicSpeech(command.text, actor.wordCard);
  if (!validation.valid) throw new Error(`CONTENT_REJECTED:${validation.code}`);

  const completedDefenderIds = [...round.completedSpeakerIds, actor.playerId];
  const nextDefender = round.tieCandidateIds.find(
    (playerId) =>
      !completedDefenderIds.includes(playerId) &&
      snapshot.players.some((player) => player.playerId === playerId && player.alive),
  );
  const definitions: EventDefinition[] = [
    ['speech_published', 'public', { actorId: actor.playerId, actionType: 'defend', text: command.text.trim() }],
  ];

  if (nextDefender) {
    definitions.push(['turn_started', 'public', { actorId: nextDefender, actionType: 'defend' }]);
    return buildTransition(snapshot, command.commandId, definitions, dependencies, {
      ...round,
      currentActorId: nextDefender,
      completedSpeakerIds: completedDefenderIds,
    });
  }

  const voters = snapshot.players.filter(
    (player) => player.alive && !round.tieCandidateIds.includes(player.playerId),
  );
  const firstVoter = voters[0]!;
  definitions.push([
    'revote_started',
    'public',
    { participantIds: voters.map((player) => player.playerId), candidateIds: round.tieCandidateIds },
  ]);
  definitions.push(['turn_started', 'public', { actorId: firstVoter.playerId, actionType: 'revote' }]);
  const result = buildTransition(snapshot, command.commandId, definitions, dependencies, {
    ...round,
    actionType: 'revote',
    currentActorId: firstVoter.playerId,
    completedSpeakerIds: completedDefenderIds,
    completedVoterIds: [],
    votes: [],
  });
  return { ...result, snapshot: withPhase(result.snapshot, 'revoting') };
}

export function submitVote(
  snapshot: GameSnapshot,
  command: SubmitVoteCommand,
  dependencies: MachineDependencies,
): MachineTransition {
  const isRevote = snapshot.phase === 'revoting';
  const round = isRevote
    ? requireRound(snapshot, command.expectedRevision, 'revoting', 'revote')
    : requireRound(snapshot, command.expectedRevision, 'voting', 'vote');
  if (round.currentActorId !== command.actorId) throw new Error('ACTOR_NOT_ALLOWED');

  const livingPlayers = snapshot.players.filter((player) => player.alive);
  const eligibleVoters = isRevote
    ? livingPlayers.filter((player) => !round.tieCandidateIds.includes(player.playerId))
    : livingPlayers;
  const actor = eligibleVoters.find((player) => player.playerId === command.actorId);
  if (!actor) throw new Error('ACTOR_NOT_ALLOWED');
  if (isRevote) {
    if (!round.tieCandidateIds.includes(command.targetPlayerId)) throw new Error('ACTOR_NOT_ALLOWED');
  } else {
    if (command.targetPlayerId === actor.playerId) throw new Error('ACTOR_NOT_ALLOWED');
    if (!livingPlayers.some((player) => player.playerId === command.targetPlayerId)) {
      throw new Error('ACTOR_NOT_ALLOWED');
    }
  }
  if (round.completedVoterIds.includes(actor.playerId)) throw new Error('INVALID_TRANSITION');

  const completedVoterIds = [...round.completedVoterIds, actor.playerId];
  const votes = [...round.votes, { voterId: actor.playerId, targetPlayerId: command.targetPlayerId }];
  const nextVoter = eligibleVoters.find((player) => !completedVoterIds.includes(player.playerId));
  const nextActionType = isRevote ? 'revote' : 'vote';
  const definitions: EventDefinition[] = [
    ['vote_cast', 'post_game', { voterId: actor.playerId, targetPlayerId: command.targetPlayerId }],
    ['vote_progressed', 'public', { playerId: actor.playerId }],
  ];

  if (nextVoter) {
    definitions.push(['turn_started', 'public', { actorId: nextVoter.playerId, actionType: nextActionType }]);
    return buildTransition(snapshot, command.commandId, definitions, dependencies, {
      ...round,
      currentActorId: nextVoter.playerId,
      completedVoterIds,
      votes,
    });
  }

  definitions.push([
    'votes_revealed',
    'public',
    { votes: votes.map((vote) => ({ voterId: vote.voterId, targetPlayerId: vote.targetPlayerId })) },
  ]);
  const counts = new Map<string, number>();
  votes.forEach((vote) => counts.set(vote.targetPlayerId, (counts.get(vote.targetPlayerId) ?? 0) + 1));
  const maxVotes = Math.max(...counts.values());
  const candidates = [...counts.entries()]
    .filter(([, count]) => count === maxVotes)
    .map(([playerId]) => playerId);
  const resolved = { ...round, completedVoterIds, votes } satisfies RoundState;

  if (candidates.length === 1) {
    return eliminateResult(snapshot, resolved, definitions, candidates[0]!, command.commandId, dependencies);
  }
  if (isRevote) {
    return advanceWithoutElimination(snapshot, resolved, definitions, 'revote_tie', command.commandId, dependencies);
  }
  if (candidates.length === livingPlayers.length) {
    return advanceWithoutElimination(snapshot, resolved, definitions, 'all_max', command.commandId, dependencies);
  }
  definitions.push(['tie_declared', 'public', { candidateIds: candidates }]);
  const result = buildTransition(snapshot, command.commandId, definitions, dependencies, {
    ...resolved,
    actionType: 'defend',
    currentActorId: candidates[0]!,
    completedSpeakerIds: [],
    tieCandidateIds: candidates,
  });
  return { ...result, snapshot: withPhase(result.snapshot, 'tie_defense') };
}

function eliminateResult(
  snapshot: GameSnapshot,
  round: RoundState,
  definitions: EventDefinition[],
  eliminatedId: string,
  commandId: string,
  dependencies: MachineDependencies,
  terminalReasonOverride?: 'player_rule_violation',
): MachineTransition {
  definitions.push(['player_eliminated', 'public', { playerId: eliminatedId }]);
  const players = snapshot.players.map((player) =>
    player.playerId === eliminatedId ? { ...player, alive: false } : player,
  );
  const eliminated = players.find((player) => player.playerId === eliminatedId)!;
  const living = players.filter((player) => player.alive);
  let terminal: Pick<GameSnapshot, 'status' | 'phase'> &
    Partial<Pick<GameSnapshot, 'winnerCamp' | 'endReason'>> = {
    status: 'in_progress',
    phase: 'speaking',
  };
  if (eliminated.camp === 'undercover') {
    terminal = {
      status: 'finished',
      phase: 'ended',
      winnerCamp: 'civilian',
      endReason: terminalReasonOverride ?? 'undercover_eliminated',
    };
  } else if (living.length === 2 && living.some((player) => player.camp === 'undercover')) {
    terminal = {
      status: 'finished',
      phase: 'ended',
      winnerCamp: 'undercover',
      endReason: terminalReasonOverride ?? 'undercover_survived_to_two',
    };
  }

  if (terminal.status === 'finished') {
    definitions.push([
      'game_finished',
      'post_game',
      { winnerCamp: terminal.winnerCamp, endReason: terminal.endReason },
    ]);
    definitions.push(['terminal_reveal_ready', 'public', {}]);
    const result = buildTransition(snapshot, commandId, definitions, dependencies, round);
    return {
      ...result,
      snapshot: gameSnapshotSchema.parse({ ...result.snapshot, ...terminal, players, round: null }),
    };
  }

  const nextRound = createNextRound(round, players);
  if (eliminatedId === snapshot.humanPlayerId) {
    const result = buildTransition(snapshot, commandId, definitions, dependencies, null);
    return {
      ...result,
      snapshot: gameSnapshotSchema.parse({
        ...result.snapshot,
        status: 'awaiting_spectator',
        phase: 'ended',
        players,
        round: null,
        resumeAfterSpectating: nextRound,
      }),
    };
  }

  return nextRoundResult(snapshot, round, definitions, players, commandId, dependencies);
}

function advanceWithoutElimination(
  snapshot: GameSnapshot,
  round: RoundState,
  definitions: EventDefinition[],
  reason: 'all_max' | 'revote_tie',
  commandId: string,
  dependencies: MachineDependencies,
): MachineTransition {
  definitions.push(['round_ended_without_elimination', 'public', { reason }]);
  return nextRoundResult(snapshot, round, definitions, snapshot.players, commandId, dependencies);
}

function nextRoundResult(
  snapshot: GameSnapshot,
  round: RoundState,
  definitions: EventDefinition[],
  players: GameSnapshot['players'],
  commandId: string,
  dependencies: MachineDependencies,
): MachineTransition {
  const nextRound = createNextRound(round, players);
  definitions.push(['round_started', 'public', { roundNumber: nextRound.number, speakingOrder: nextRound.speakingOrder }]);
  definitions.push(['turn_started', 'public', { actorId: nextRound.currentActorId, actionType: 'describe' }]);
  const result = buildTransition(snapshot, commandId, definitions, dependencies, nextRound);
  return {
    ...result,
    snapshot: gameSnapshotSchema.parse({ ...result.snapshot, players, phase: 'speaking' }),
  };
}

function createNextRound(round: RoundState, players: GameSnapshot['players']): RoundState {
  const nextOrder = rotateLivingOrder(round.speakingOrder, players);
  return {
    number: round.number + 1,
    speakingOrder: nextOrder,
    currentActorId: nextOrder[0]!,
    actionType: 'describe',
    completedSpeakerIds: [],
    completedVoterIds: [],
    votes: [],
    tieCandidateIds: [],
  };
}

function requireRound(
  snapshot: GameSnapshot,
  expectedRevision: number,
  phase: GameSnapshot['phase'],
  actionType: RoundState['actionType'],
) {
  if (snapshot.revision !== expectedRevision) throw new Error('REVISION_CONFLICT');
  if (snapshot.status !== 'in_progress' || snapshot.phase !== phase) throw new Error('INVALID_TRANSITION');
  if (!snapshot.round || snapshot.round.actionType !== actionType) throw new Error('INVALID_TRANSITION');
  return snapshot.round;
}

function withPhase(snapshot: GameSnapshot, phase: GameSnapshot['phase']): GameSnapshot {
  return gameSnapshotSchema.parse({ ...snapshot, phase });
}

function buildTransition(
  snapshot: GameSnapshot,
  commandId: string,
  definitions: EventDefinition[],
  dependencies: MachineDependencies,
  round: GameSnapshot['round'],
): MachineTransition {
  const now = dependencies.clock.now();
  const events = definitions.map(([type, visibility, payload], index): GameEvent => ({
    eventId: dependencies.ids.nextId('event'),
    gameId: snapshot.gameId,
    eventSeq: snapshot.eventSeq + index + 1,
    type,
    visibility,
    occurredAt: now,
    commandId,
    payload,
  }));
  const publicCount = events.filter((event) => event.visibility === 'public').length;
  return {
    snapshot: gameSnapshotSchema.parse({
      ...snapshot,
      revision: snapshot.revision + 1,
      eventSeq: snapshot.eventSeq + events.length,
      streamSeq: snapshot.streamSeq + publicCount,
      round,
      updatedAt: now,
    }),
    events,
  };
}

function rotateLivingOrder(order: readonly string[], players: GameSnapshot['players']) {
  const living = order.filter((playerId) =>
    players.some((player) => player.playerId === playerId && player.alive),
  );
  return living.length > 1 ? [...living.slice(1), living[0]!] : living;
}
