import {
  abandonGameRequestSchema,
  continueSpectatingRequestSchema,
  createGameRequestSchema,
  resolveInterruptedGameRequestSchema,
  startGameRequestSchema,
  submitDefenseRequestSchema,
  submitDescriptionRequestSchema,
  submitVoteRequestSchema,
  type AbandonGameRequest,
  type ContinueSpectatingRequest,
  type CreateGameRequest,
  type HumanGameView,
  type ResolveInterruptedGameRequest,
  type StartGameRequest,
  type SubmitDefenseRequest,
  type SubmitDescriptionRequest,
  type SubmitVoteRequest,
} from '@sheishiwodi/shared';

import {
  ApiClientError,
  abandonGame,
  continueSpectating,
  createGame,
  getActiveGame,
  getGame,
  resolveInterruptedGame,
  startGame,
  submitDefense,
  submitDescription,
  submitVote,
} from './api';

const STORAGE_KEY = 'sheishiwodi:pending-game-command';

type GameScopedPending<TKind extends string, TRequest> = {
  version: 1;
  kind: TKind;
  gameId: string;
  expectedRevision: number;
  request: TRequest;
};

export type PendingGameCommand =
  | { version: 1; kind: 'create'; request: CreateGameRequest }
  | GameScopedPending<'start', StartGameRequest>
  | GameScopedPending<'description', SubmitDescriptionRequest>
  | GameScopedPending<'defense', SubmitDefenseRequest>
  | GameScopedPending<'vote', SubmitVoteRequest>
  | GameScopedPending<'spectate', ContinueSpectatingRequest>
  | GameScopedPending<'abandon', AbandonGameRequest>
  | GameScopedPending<'recovery', ResolveInterruptedGameRequest>;

export function readPendingGameCommand(): PendingGameCommand | null {
  if (typeof sessionStorage === 'undefined') return null;
  const value = sessionStorage.getItem(STORAGE_KEY);
  if (!value) return null;
  try {
    return parsePendingCommand(JSON.parse(value));
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function savePendingGameCommand(command: PendingGameCommand) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(command));
}

export function clearPendingGameCommand() {
  sessionStorage.removeItem(STORAGE_KEY);
}

export async function executeTrackedGameCommand(
  command: PendingGameCommand,
): Promise<HumanGameView | null> {
  savePendingGameCommand(command);
  try {
    const view = await execute(command);
    clearPendingGameCommand();
    return normalizeResult(command, view);
  } catch (error) {
    if (error instanceof ApiClientError) {
      clearPendingGameCommand();
      if (error.code === 'REVISION_CONFLICT' && command.kind !== 'create') {
        return getGame(command.gameId);
      }
      throw error;
    }
    return settlePendingGameCommand(command);
  }
}

export async function settlePendingGameCommand(
  command: PendingGameCommand,
): Promise<HumanGameView | null> {
  let authority: HumanGameView | null;
  try {
    authority = command.kind === 'create' ? await getActiveGame() : await getGame(command.gameId);
  } catch (error) {
    if (
      error instanceof ApiClientError &&
      error.code === 'GAME_NOT_FOUND' &&
      command.kind !== 'create'
    ) {
      clearPendingGameCommand();
      return getActiveGame();
    }
    throw error;
  }
  if (authority && commandApplied(command, authority)) {
    clearPendingGameCommand();
    return normalizeResult(command, authority);
  }

  try {
    const view = await execute(command);
    clearPendingGameCommand();
    return normalizeResult(command, view);
  } catch (error) {
    if (error instanceof ApiClientError) {
      clearPendingGameCommand();
      if (error.code === 'REVISION_CONFLICT' && authority) return authority;
    }
    throw error;
  }
}

function commandApplied(command: PendingGameCommand, authority: HumanGameView) {
  if (command.kind === 'create') return true;
  if (authority.gameId !== command.gameId) return false;
  if (command.kind === 'recovery') {
    return command.request.resolution === 'start_new'
      ? authority.status === 'abandoned' && authority.endReason === 'interrupted_not_resumed'
      : authority.operationalStatus.state !== 'interrupted';
  }
  return authority.revision > command.expectedRevision;
}

function normalizeResult(command: PendingGameCommand, view: HumanGameView) {
  return command.kind === 'recovery' && command.request.resolution === 'start_new'
    ? null
    : view;
}

function execute(command: PendingGameCommand): Promise<HumanGameView> {
  switch (command.kind) {
    case 'create':
      return createGame(command.request);
    case 'start':
      return startGame(command.gameId, command.request);
    case 'description':
      return submitDescription(command.gameId, command.request);
    case 'defense':
      return submitDefense(command.gameId, command.request);
    case 'vote':
      return submitVote(command.gameId, command.request);
    case 'spectate':
      return continueSpectating(command.gameId, command.request);
    case 'abandon':
      return abandonGame(command.gameId, command.request);
    case 'recovery':
      return resolveInterruptedGame(command.gameId, command.request);
  }
}

function parsePendingCommand(value: unknown): PendingGameCommand {
  if (!value || typeof value !== 'object') throw new Error('INVALID_PENDING_COMMAND');
  const candidate = value as Record<string, unknown>;
  if (candidate['version'] !== 1 || typeof candidate['kind'] !== 'string') {
    throw new Error('INVALID_PENDING_COMMAND');
  }
  if (candidate['kind'] === 'create') {
    return { version: 1, kind: 'create', request: createGameRequestSchema.parse(candidate['request']) };
  }
  if (
    typeof candidate['gameId'] !== 'string' ||
    candidate['gameId'].trim().length === 0 ||
    !Number.isInteger(candidate['expectedRevision']) ||
    (candidate['expectedRevision'] as number) < 0
  ) {
    throw new Error('INVALID_PENDING_COMMAND');
  }
  const base = {
    version: 1 as const,
    gameId: candidate['gameId'],
    expectedRevision: candidate['expectedRevision'] as number,
  };
  switch (candidate['kind']) {
    case 'start':
      return scopedWithMatchingRevision(
        base,
        'start',
        startGameRequestSchema.parse(candidate['request']),
      );
    case 'description':
      return scopedWithMatchingRevision(
        base,
        'description',
        submitDescriptionRequestSchema.parse(candidate['request']),
      );
    case 'defense':
      return scopedWithMatchingRevision(
        base,
        'defense',
        submitDefenseRequestSchema.parse(candidate['request']),
      );
    case 'vote':
      return scopedWithMatchingRevision(
        base,
        'vote',
        submitVoteRequestSchema.parse(candidate['request']),
      );
    case 'spectate':
      return scopedWithMatchingRevision(
        base,
        'spectate',
        continueSpectatingRequestSchema.parse(candidate['request']),
      );
    case 'abandon':
      return scopedWithMatchingRevision(
        base,
        'abandon',
        abandonGameRequestSchema.parse(candidate['request']),
      );
    case 'recovery':
      return {
        ...base,
        kind: 'recovery',
        request: resolveInterruptedGameRequestSchema.parse(candidate['request']),
      };
    default:
      throw new Error('INVALID_PENDING_COMMAND');
  }
}

function scopedWithMatchingRevision<
  TKind extends Exclude<PendingGameCommand['kind'], 'create' | 'recovery'>,
  TRequest extends { expectedRevision: number },
>(
  base: { version: 1; gameId: string; expectedRevision: number },
  kind: TKind,
  request: TRequest,
) {
  if (request.expectedRevision !== base.expectedRevision) {
    throw new Error('INVALID_PENDING_COMMAND');
  }
  return { ...base, kind, request } as Extract<PendingGameCommand, { kind: TKind }>;
}
