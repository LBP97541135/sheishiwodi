import { agentRoles, findAgentRole, type AgentRoleDefinition } from './agent-roles.js';
import type { CreateGameCommand, StartGameCommand } from './commands.js';
import type { GameEvent } from './events.js';
import { gameSnapshotSchema, type GamePlayerState, type GameSnapshot } from './state.js';
import type { WordPair } from './word-pairs.js';

export interface RandomSource {
  next(): number;
}

export interface IdSource {
  nextId(kind: 'game' | 'player' | 'event'): string;
}

export interface Clock {
  now(): string;
}

export interface GameSetupDependencies {
  random: RandomSource;
  ids: IdSource;
  clock: Clock;
  resolveAgentRole?: (roleId: string) => AgentRoleDefinition | undefined;
}

export interface GameTransition {
  snapshot: GameSnapshot;
  events: GameEvent[];
}

const nextIndex = (random: RandomSource, length: number) => {
  const value = random.next();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('随机源必须返回 [0, 1) 区间内的有限数值');
  }
  return Math.floor(value * length);
};

const shuffle = <T>(values: readonly T[], random: RandomSource) => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = nextIndex(random, index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
};

export function createPreparingGame(
  command: CreateGameCommand,
  availableWordPairs: readonly WordPair[],
  dependencies: GameSetupDependencies,
): GameTransition {
  const candidates = availableWordPairs.filter(
    (pair) => pair.enabled && pair.difficulty === command.difficulty,
  );
  if (candidates.length === 0) {
    throw new Error('所选难度没有可用词组');
  }

  const selectedPair = candidates[nextIndex(dependencies.random, candidates.length)]!;
  const gameId = dependencies.ids.nextId('game');
  const participationMode = command.participationMode ?? 'human';
  const selectedRoleIds = command.agentRoleIds ?? agentRoles.map((role) => role.roleId);
  const resolveRole = dependencies.resolveAgentRole ?? findAgentRole;
  const selectedRoles = selectedRoleIds.map((roleId) => {
    const role = resolveRole(roleId);
    if (!role) throw new Error('UNKNOWN_AGENT_ROLE');
    return role;
  });
  if (new Set(selectedRoleIds).size !== selectedRoleIds.length) throw new Error('DUPLICATE_AGENT_ROLE');
  const totalPlayers = selectedRoles.length + (participationMode === 'human' ? 1 : 0);
  if (totalPlayers < 4 || totalPlayers > 8) throw new Error('INVALID_PLAYER_COUNT');
  const humanPlayerId = dependencies.ids.nextId('player');
  const controllerId = humanPlayerId;
  const human = participationMode === 'human' ? command.human : undefined;
  const players: GamePlayerState[] = [
    ...(human
      ? [{
          playerId: humanPlayerId,
          seatIndex: 0,
          kind: 'human' as const,
          displayName: human.displayName,
          alive: true,
          camp: 'civilian' as const,
          wordCard: selectedPair.civilianWord,
          silhouette: human.silhouette,
          characterAssetKey: human.silhouette === 'silhouette_b' ? 'human-female' : 'human-male',
          guessUsed: false,
        }]
      : []),
    ...selectedRoles.map((role, roleIndex) => ({
      playerId: dependencies.ids.nextId('player'),
      seatIndex: roleIndex + (human ? 1 : 0),
      kind: 'agent' as const,
      displayName: role.displayName,
      alive: true,
      camp: 'civilian' as const,
      wordCard: selectedPair.civilianWord,
      agentRoleId: role.roleId,
      agentRoleDisplay: role.displayName,
      agentPersonalityPrompt: role.personalityPrompt,
      agentModelId: role.defaultModelId,
      characterAssetKey: role.roleId,
      guessUsed: false,
    })),
  ];

  const undercoverCount = players.length >= 6 ? 2 : 1;
  const undercoverIndexes = new Set<number>();
  while (undercoverIndexes.size < undercoverCount) {
    let index = nextIndex(dependencies.random, players.length);
    while (undercoverIndexes.has(index)) index = (index + 1) % players.length;
    undercoverIndexes.add(index);
  }
  players.forEach((player) => {
    if (undercoverIndexes.has(player.seatIndex)) {
      player.camp = 'undercover';
      player.wordCard = selectedPair.undercoverWord;
    }
  });

  const firstSpeakingOrder = shuffle(
    players.map((player) => player.playerId),
    dependencies.random,
  );
  const now = dependencies.clock.now();
  const snapshot = gameSnapshotSchema.parse({
    schemaVersion: 1,
    gameId,
    status: 'preparing',
    phase: 'preparing',
    revision: 0,
    eventSeq: 1,
    streamSeq: 1,
    config: {
      difficulty: command.difficulty,
      gameMode: command.gameMode ?? 'classic',
      undercoverCount,
      participationMode,
      ...(command.requestBudget ? { requestBudget: command.requestBudget } : {}),
    },
    humanPlayerId,
    controllerId,
    wordPair: {
      wordPairId: selectedPair.id,
      civilianWord: selectedPair.civilianWord,
      undercoverWord: selectedPair.undercoverWord,
      category: selectedPair.category,
      difficulty: selectedPair.difficulty,
    },
    players,
    guessHistory: [],
    firstSpeakingOrder,
    round: null,
    createdAt: now,
    updatedAt: now,
  });

  const event: GameEvent = {
    eventId: dependencies.ids.nextId('event'),
    gameId,
    eventSeq: 1,
    type: 'game_created',
    visibility: participationMode === 'human' ? 'human_private' : 'internal',
    occurredAt: now,
    commandId: command.commandId,
    payload: {
      difficulty: command.difficulty,
      undercoverCount,
      humanPlayerId,
      controllerId,
    },
  };

  return { snapshot, events: [event] };
}

export function startPreparingGame(
  snapshot: GameSnapshot,
  command: StartGameCommand,
  dependencies: Pick<GameSetupDependencies, 'ids' | 'clock'>,
): GameTransition {
  if (snapshot.status !== 'preparing' || snapshot.phase !== 'preparing') {
    throw new Error('INVALID_TRANSITION');
  }
  if (command.actorId !== (snapshot.controllerId ?? snapshot.humanPlayerId)) {
    throw new Error('ACTOR_NOT_ALLOWED');
  }
  if (command.expectedRevision !== snapshot.revision) {
    throw new Error('REVISION_CONFLICT');
  }

  const now = dependencies.clock.now();
  const currentActorId = snapshot.firstSpeakingOrder[0]!;
  const nextSnapshot = gameSnapshotSchema.parse({
    ...snapshot,
    status: 'in_progress',
    phase: 'speaking',
    revision: snapshot.revision + 1,
    eventSeq: snapshot.eventSeq + 3,
    streamSeq: snapshot.streamSeq + 3,
    round: {
      number: 1,
      speakingOrder: snapshot.firstSpeakingOrder,
      currentActorId,
      actionType: 'describe',
      completedSpeakerIds: [],
      completedVoterIds: [],
      votes: [],
      guesses: [],
      tieCandidateIds: [],
    },
    updatedAt: now,
    startedAt: now,
  });

  const definitions = [
    ['game_started', {}],
    ['round_started', { roundNumber: 1, speakingOrder: snapshot.firstSpeakingOrder }],
    ['turn_started', { actorId: currentActorId, actionType: 'describe' }],
  ] as const;
  const events = definitions.map(([type, payload], index): GameEvent => ({
    eventId: dependencies.ids.nextId('event'),
    gameId: snapshot.gameId,
    eventSeq: snapshot.eventSeq + index + 1,
    type,
    visibility: 'public',
    occurredAt: now,
    commandId: command.commandId,
    payload,
  }));

  return { snapshot: nextSnapshot, events };
}
