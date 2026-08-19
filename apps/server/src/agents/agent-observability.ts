import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { agentTurnInputSchema, type AgentTurnInput } from '@sheishiwodi/shared';

import type {
  ModelAttemptKind,
  ModelAttemptRow,
} from '../db/model-attempt-repository.js';
import type { AgentActContext } from './agent-policy.js';
import type { ReviewInput } from './review-policy.js';
import type { ChatMessage } from './tokendance-client.js';

export type { ModelAttemptKind } from '../db/model-attempt-repository.js';

export const playerPromptTemplateVersion = 'player-agent-v1';
export const reviewPromptTemplateVersion = 'review-agent-v1';

export class ContextBoundaryViolationError extends Error {
  constructor() {
    super('CONTEXT_BOUNDARY_VIOLATION');
    this.name = 'ContextBoundaryViolationError';
  }
}

export interface AttemptHandle {
  attemptId: string;
  startedAtMs: number;
}

export interface ModelAttemptStore {
  begin(
    input: Omit<
      ModelAttemptRow,
      'attemptNumber' | 'resultCode' | 'finishedAt' | 'durationMs'
    >,
  ): number;
  finish(
    attemptId: string,
    input: { resultCode: string; finishedAt: string; durationMs: number },
  ): void;
}

interface ContextSource {
  kind: string;
  visibility: 'public' | 'actor_private' | 'terminal_private';
  itemCount: number;
  ownerPlayerId?: string;
}

interface ContextManifest {
  version: 1;
  attemptId: string;
  attemptNumber: number;
  gameId: string;
  commandId: string;
  actionId: string;
  playerId?: string;
  roleId: string;
  modelId: string;
  actionType: string;
  baseRevision?: number;
  publicEventCursor: number;
  templateVersion: string;
  promptHash: string;
  sources: ContextSource[];
  validation: {
    status: 'passed' | 'failed';
    checks: string[];
  };
  createdAt: string;
}

export interface AgentObservability {
  beginPlayerAttempt(input: {
    agentInput: AgentTurnInput;
    context: AgentActContext;
    modelId: string;
    messages: readonly ChatMessage[];
    attemptKind: ModelAttemptKind;
  }): AttemptHandle;
  beginReviewAttempt(input: {
    reviewInput: ReviewInput;
    commandId: string;
    actionId: string;
    modelId: string;
    messages: readonly ChatMessage[];
    attemptKind: ModelAttemptKind;
  }): AttemptHandle;
  finishAttempt(
    handle: AttemptHandle,
    resultCode: string,
    options?: { rawResponse?: string },
  ): void;
}

export const noOpAgentObservability: AgentObservability = {
  beginPlayerAttempt: () => ({ attemptId: 'noop', startedAtMs: Date.now() }),
  beginReviewAttempt: () => ({ attemptId: 'noop', startedAtMs: Date.now() }),
  finishAttempt: () => undefined,
};

export class ContextAuditWriter {
  constructor(private readonly rootDirectory: string) {}

  write(manifest: ContextManifest) {
    const gameDirectory = join(this.rootDirectory, hashId(manifest.gameId));
    const target = join(gameDirectory, `${hashId(manifest.attemptId)}.json`);
    const temporary = `${target}.tmp`;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8' });
    renameSync(temporary, target);
  }
}

export class PersistentAgentObservability implements AgentObservability {
  constructor(
    private readonly attempts: ModelAttemptStore,
    private readonly audit: ContextAuditWriter,
    private readonly options: {
      now?: () => Date;
      nowMs?: () => number;
      nextId?: () => string;
    } = {},
  ) {}

  beginPlayerAttempt(input: {
    agentInput: AgentTurnInput;
    context: AgentActContext;
    modelId: string;
    messages: readonly ChatMessage[];
    attemptKind: ModelAttemptKind;
  }): AttemptHandle {
    const now = this.now();
    const handle = { attemptId: this.nextId(), startedAtMs: this.nowMs() };
    const trace = input.context.trace ?? fallbackPlayerTrace(input.agentInput);
    const checks: string[] = [];
    let valid = true;
    try {
      validatePlayerBoundary(input.agentInput, trace);
      checks.push(
        'strict_agent_input_schema',
        'trace_matches_game_and_actor',
        'prior_beliefs_owned_by_actor',
        'public_cursor_matches_input',
        'legal_targets_are_public_roster_subset',
      );
    } catch {
      valid = false;
      checks.push('context_boundary_violation');
    }

    const attemptNumber = this.attempts.begin({
      attemptId: handle.attemptId,
      gameId: trace.gameId,
      commandId: trace.commandId,
      actionId: trace.actionId,
      playerId: input.agentInput.actor.playerId,
      roleId: input.context.agentRoleId,
      modelId: input.modelId,
      actionType: input.agentInput.actionType,
      attemptKind: input.attemptKind,
      startedAt: now.toISOString(),
    });

    try {
      this.audit.write({
        version: 1,
        attemptId: handle.attemptId,
        attemptNumber,
        gameId: trace.gameId,
        commandId: trace.commandId,
        actionId: trace.actionId,
        playerId: input.agentInput.actor.playerId,
        roleId: input.context.agentRoleId,
        modelId: input.modelId,
        actionType: input.agentInput.actionType,
        baseRevision: input.agentInput.baseRevision,
        publicEventCursor: trace.publicEventCursor,
        templateVersion: playerPromptTemplateVersion,
        promptHash: hashPrompt(input.messages),
        sources: playerSources(input.agentInput),
        validation: { status: valid ? 'passed' : 'failed', checks },
        createdAt: now.toISOString(),
      });
    } catch (error) {
      this.finishAttempt(handle, 'audit_write_failed');
      throw error;
    }

    if (!valid) {
      this.finishAttempt(handle, 'context_boundary_violation');
      throw new ContextBoundaryViolationError();
    }
    return handle;
  }

  beginReviewAttempt(input: {
    reviewInput: ReviewInput;
    commandId: string;
    actionId: string;
    modelId: string;
    messages: readonly ChatMessage[];
    attemptKind: ModelAttemptKind;
  }): AttemptHandle {
    const now = this.now();
    const handle = { attemptId: this.nextId(), startedAtMs: this.nowMs() };
    if (!input.reviewInput.gameId || input.reviewInput.reveal.players.length === 0) {
      throw new ContextBoundaryViolationError();
    }
    const attemptNumber = this.attempts.begin({
      attemptId: handle.attemptId,
      gameId: input.reviewInput.gameId,
      commandId: input.commandId,
      actionId: input.actionId,
      roleId: 'review',
      modelId: input.modelId,
      actionType: 'review',
      attemptKind: input.attemptKind,
      startedAt: now.toISOString(),
    });
    const publicEventCursor = input.reviewInput.publicTimeline.at(-1)?.eventSeq ?? 0;
    try {
      this.audit.write({
        version: 1,
        attemptId: handle.attemptId,
        attemptNumber,
        gameId: input.reviewInput.gameId,
        commandId: input.commandId,
        actionId: input.actionId,
        roleId: 'review',
        modelId: input.modelId,
        actionType: 'review',
        publicEventCursor,
        templateVersion: reviewPromptTemplateVersion,
        promptHash: hashPrompt(input.messages),
        sources: [
          { kind: 'terminal_reveal', visibility: 'terminal_private', itemCount: 1 },
          {
            kind: 'public_events',
            visibility: 'public',
            itemCount: input.reviewInput.publicTimeline.length,
          },
          {
            kind: 'private_agent_actions',
            visibility: 'terminal_private',
            itemCount: input.reviewInput.factReview.agentActions.length,
          },
        ],
        validation: {
          status: 'passed',
          checks: ['finished_game_input', 'terminal_review_scope'],
        },
        createdAt: now.toISOString(),
      });
    } catch (error) {
      this.finishAttempt(handle, 'audit_write_failed');
      throw error;
    }
    return handle;
  }

  finishAttempt(handle: AttemptHandle, resultCode: string) {
    const finishedAt = this.now();
    this.attempts.finish(handle.attemptId, {
      resultCode,
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, this.nowMs() - handle.startedAtMs),
    });
  }

  private now() {
    return this.options.now?.() ?? new Date();
  }

  private nowMs() {
    return this.options.nowMs?.() ?? Date.now();
  }

  private nextId() {
    return this.options.nextId?.() ?? randomUUID();
  }
}

function validatePlayerBoundary(
  input: AgentTurnInput,
  trace: NonNullable<AgentActContext['trace']>,
) {
  agentTurnInputSchema.parse(input);
  if (
    trace.gameId !== input.gameId ||
    trace.priorBeliefOwnerId !== input.actor.playerId ||
    trace.publicEventCursor !== (input.publicEvents.at(-1)?.eventSeq ?? 0)
  ) {
    throw new ContextBoundaryViolationError();
  }
  const actor = input.players.find((player) => player.playerId === input.actor.playerId);
  if (!actor || actor.displayName !== input.actor.displayName) {
    throw new ContextBoundaryViolationError();
  }
  const livingIds = new Set(input.players.filter((player) => player.alive).map((player) => player.playerId));
  if (
    input.legalTargets.some(
      (playerId) => playerId === input.actor.playerId || !livingIds.has(playerId),
    )
  ) {
    throw new ContextBoundaryViolationError();
  }
}

function fallbackPlayerTrace(input: AgentTurnInput): NonNullable<AgentActContext['trace']> {
  const actionId = `unscoped/${input.gameId}/${input.baseRevision}/${input.actor.playerId}/${input.actionType}`;
  return {
    gameId: input.gameId,
    commandId: actionId,
    actionId,
    priorBeliefOwnerId: input.actor.playerId,
    publicEventCursor: input.publicEvents.at(-1)?.eventSeq ?? 0,
  };
}

function playerSources(input: AgentTurnInput): ContextSource[] {
  return [
    { kind: 'public_config', visibility: 'public', itemCount: 1 },
    { kind: 'public_roster', visibility: 'public', itemCount: input.players.length },
    {
      kind: 'actor_word_card',
      visibility: 'actor_private',
      itemCount: 1,
      ownerPlayerId: input.actor.playerId,
    },
    { kind: 'public_events', visibility: 'public', itemCount: input.publicEvents.length },
    {
      kind: 'prior_own_beliefs',
      visibility: 'actor_private',
      itemCount: input.priorOwnBeliefs.length,
      ownerPlayerId: input.actor.playerId,
    },
    { kind: 'action_constraints', visibility: 'public', itemCount: 1 },
  ];
}

function hashPrompt(messages: readonly ChatMessage[]) {
  return createHash('sha256').update(JSON.stringify(messages)).digest('hex');
}

function hashId(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
