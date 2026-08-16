import { agentRoles } from './agent-roles.js';
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
  const humanPlayerId = dependencies.ids.nextId('player');
  const players: GamePlayerState[] = [
    {
      playerId: humanPlayerId,
      seatIndex: 0,
      kind: 'human',
      displayName: command.human.displayName,
      alive: true,
      camp: 'civilian',
      wordCard: selectedPair.civilianWord,
      silhouette: command.human.silhouette,
    },
    ...agentRoles.map((role, roleIndex) => ({
      playerId: dependencies.ids.nextId('player'),
      seatIndex: roleIndex + 1,
      kind: 'agent' as const,
      displayName: role.displayName,
      alive: true,
      camp: 'civilian' as const,
      wordCard: selectedPair.civilianWord,
      agentRoleId: role.roleId,
      agentRoleDisplay: role.displayName,
    })),
  ];

  const undercoverIndex = nextIndex(dependencies.random, players.length);
  players.forEach((player, index) => {
    if (index === undercoverIndex) {
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
      undercoverCount: 1,
    },
    humanPlayerId,
    wordPair: {
      wordPairId: selectedPair.id,
      civilianWord: selectedPair.civilianWord,
      undercoverWord: selectedPair.undercoverWord,
      category: selectedPair.category,
      difficulty: selectedPair.difficulty,
    },
    players,
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
    visibility: 'human_private',
    occurredAt: now,
    commandId: command.commandId,
    payload: {
      difficulty: command.difficulty,
      undercoverCount: 1,
      humanPlayerId,
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
  if (command.actorId !== snapshot.humanPlayerId) {
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
