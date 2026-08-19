import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { agentTurnInputSchema, type AgentTurnInput } from '@sheishiwodi/shared';

import type {
  ModelAttemptKind,
  ModelAttemptRow,
  ModelAttemptStageCode,
} from '../db/model-attempt-repository.js';
import { verifyAgentContextProvenance } from './agent-context-assembler.js';
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

export class AgentRequestBudgetExceededError extends Error {
  constructor(readonly gameId: string) {
    super('AGENT_REQUEST_BUDGET_EXHAUSTED');
    this.name = 'AgentRequestBudgetExceededError';
  }
}

export interface AttemptHandle {
  attemptId: string;
  startedAtMs: number;
  signal?: AbortSignal;
}

export interface InterruptedAttempt {
  gameId: string;
  actionId: string;
}

export interface ModelAttemptStore {
  begin(
    input: Omit<
      ModelAttemptRow,
      'attemptNumber' | 'resultCode' | 'finishedAt' | 'durationMs' | 'stages'
    >,
  ): number;
  markStage(attemptId: string, stage: ModelAttemptStageCode, occurredAt: string): void;
  finish(
    attemptId: string,
    input: { resultCode: string; finishedAt: string; durationMs: number },
  ): void;
}

export interface ContextSource {
  kind: string;
  visibility: 'public' | 'actor_private' | 'terminal_private';
  itemCount: number;
  ownerPlayerId?: string;
}

export interface ContextManifest {
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
  markAttemptStage?(
    attemptId: string,
    stage: ModelAttemptStageCode,
    options?: { rawResponse?: string },
  ): void;
  finalizeAttempt?(attemptId: string, resultCode: string): void;
  interruptActiveAttempts?(): InterruptedAttempt[];
}

export const noOpAgentObservability: AgentObservability = {
  beginPlayerAttempt: () => ({ attemptId: 'noop', startedAtMs: Date.now() }),
  beginReviewAttempt: () => ({ attemptId: 'noop', startedAtMs: Date.now() }),
  finishAttempt: () => undefined,
  markAttemptStage: () => undefined,
  finalizeAttempt: () => undefined,
};

export interface FullContextRecord {
  version: 1;
  attemptId: string;
  gameId: string;
  actionType: string;
  createdAt: string;
  prompt: ChatMessage[];
  resultCode?: string;
  rawResponse?: string;
}

export interface TelemetrySink {
  emit(event: {
    type: 'attempt_started' | 'attempt_finished';
    attemptId: string;
    gameId: string;
    actionId: string;
    actionType: string;
    occurredAt: string;
    resultCode?: string;
  }): void;
}

export const noOpTelemetrySink: TelemetrySink = { emit: () => undefined };

export class ContextAuditWriter {
  private fullRecordingEnabled = false;
  private readonly fullRecordPaths = new Map<string, string>();

  constructor(
    private readonly rootDirectory: string,
    private readonly options: {
      secretValues?: readonly string[];
      fullRecordMaxAgeMs?: number;
      fullRecordMaxBytes?: number;
      now?: () => Date;
    } = {},
  ) {
    this.cleanupFullRecords();
  }

  write(manifest: ContextManifest, messages?: readonly ChatMessage[]) {
    const gameDirectory = join(this.rootDirectory, hashId(manifest.gameId));
    const target = join(gameDirectory, `${hashId(manifest.attemptId)}.json`);
    const temporary = `${target}.tmp`;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8' });
    renameSync(temporary, target);
    if (this.fullRecordingEnabled && messages) {
      try {
        const record: FullContextRecord = {
          version: 1,
          attemptId: manifest.attemptId,
          gameId: manifest.gameId,
          actionType: manifest.actionType,
          createdAt: manifest.createdAt,
          prompt: sanitizeValue(messages, this.options.secretValues ?? []) as ChatMessage[],
        };
        const fullTarget = this.fullRecordPath(manifest.attemptId);
        writeJsonAtomically(fullTarget, record);
        this.fullRecordPaths.set(manifest.attemptId, fullTarget);
        this.cleanupFullRecords();
      } catch {
        // 完整记录是显式调试附加能力，失败不能影响基础审计或正常对局。
      }
    }
  }

  finishFullRecord(attemptId: string, resultCode: string, rawResponse?: string) {
    const target = this.fullRecordPaths.get(attemptId) ?? this.fullRecordPath(attemptId);
    if (!existsSync(target)) return;
    try {
      const record = JSON.parse(readFileSync(target, 'utf8')) as FullContextRecord;
      const next: FullContextRecord = {
        ...record,
        resultCode,
        ...(rawResponse === undefined
          ? {}
          : { rawResponse: sanitizeText(rawResponse, this.options.secretValues ?? []) }),
      };
      writeJsonAtomically(target, next);
      this.cleanupFullRecords();
    } catch {
      // 不让可选调试记录破坏模型结果提交。
    } finally {
      this.fullRecordPaths.delete(attemptId);
    }
  }

  setFullRecordingEnabled(enabled: boolean) {
    this.fullRecordingEnabled = enabled;
  }

  isFullRecordingEnabled() {
    return this.fullRecordingEnabled;
  }

  listManifests(gameId?: string): ContextManifest[] {
    if (!existsSync(this.rootDirectory)) return [];
    const manifests: ContextManifest[] = [];
    for (const directory of readdirSync(this.rootDirectory, { withFileTypes: true })) {
      if (!directory.isDirectory() || directory.name === 'full') continue;
      const path = join(this.rootDirectory, directory.name);
      for (const file of readdirSync(path, { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith('.json')) continue;
        try {
          const manifest = JSON.parse(readFileSync(join(path, file.name), 'utf8')) as ContextManifest;
          if (!gameId || manifest.gameId === gameId) manifests.push(manifest);
        } catch {
          // 单个损坏的诊断文件不影响其他只读观测结果。
        }
      }
    }
    return manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listFullRecords(gameId?: string): FullContextRecord[] {
    const directory = join(this.rootDirectory, 'full');
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true })
      .filter((file) => file.isFile() && file.name.endsWith('.json'))
      .flatMap((file) => {
        try {
          const record = JSON.parse(readFileSync(join(directory, file.name), 'utf8')) as FullContextRecord;
          return !gameId || record.gameId === gameId ? [record] : [];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getFullRecord(attemptId: string): FullContextRecord | null {
    const target = this.fullRecordPath(attemptId);
    if (!existsSync(target)) return null;
    try {
      return JSON.parse(readFileSync(target, 'utf8')) as FullContextRecord;
    } catch {
      return null;
    }
  }

  clearFullRecords() {
    rmSync(join(this.rootDirectory, 'full'), { recursive: true, force: true });
    this.fullRecordPaths.clear();
  }

  cleanupFullRecords() {
    const directory = join(this.rootDirectory, 'full');
    if (!existsSync(directory)) return;
    const now = (this.options.now?.() ?? new Date()).getTime();
    const maxAgeMs = this.options.fullRecordMaxAgeMs ?? 7 * 24 * 60 * 60 * 1_000;
    const maxBytes = this.options.fullRecordMaxBytes ?? 20 * 1024 * 1024;
    const files = readdirSync(directory, { withFileTypes: true })
      .filter((file) => file.isFile() && file.name.endsWith('.json'))
      .map((file) => {
        const path = join(directory, file.name);
        const stat = statSync(path);
        return { path, size: stat.size, modifiedAt: stat.mtimeMs };
      })
      .sort((a, b) => a.modifiedAt - b.modifiedAt);
    for (const file of files) {
      if (now - file.modifiedAt > maxAgeMs) unlinkSync(file.path);
    }
    const remaining = files.filter((file) => existsSync(file.path));
    let total = remaining.reduce((sum, file) => sum + file.size, 0);
    for (const file of remaining) {
      if (total <= maxBytes) break;
      unlinkSync(file.path);
      total -= file.size;
    }
  }

  private fullRecordPath(attemptId: string) {
    return join(this.rootDirectory, 'full', `${hashId(attemptId)}.json`);
  }
}

export class PersistentAgentObservability implements AgentObservability {
  private readonly activeAttempts = new Map<
    string,
    {
      handle: AttemptHandle;
      gameId: string;
      actionId: string;
      actionType: string;
      controller: AbortController;
      rawResponse?: string;
    }
  >();

  constructor(
    private readonly attempts: ModelAttemptStore,
    private readonly audit: ContextAuditWriter,
    private readonly options: {
      now?: () => Date;
      nowMs?: () => number;
      nextId?: () => string;
      telemetrySink?: TelemetrySink;
      attemptBudget?: { reserveAttempt(gameId: string, updatedAt: string): boolean };
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
    const controller = new AbortController();
    const handle = {
      attemptId: this.nextId(),
      startedAtMs: this.nowMs(),
      signal: controller.signal,
    };
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

    if (valid && this.options.attemptBudget && !this.options.attemptBudget.reserveAttempt(trace.gameId, now.toISOString())) {
      throw new AgentRequestBudgetExceededError(trace.gameId);
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
        publicEventCursor: trace.provenance.publicEventCursor,
        templateVersion: playerPromptTemplateVersion,
        promptHash: hashPrompt(input.messages),
        sources: playerSources(input.agentInput),
        validation: { status: valid ? 'passed' : 'failed', checks },
        createdAt: now.toISOString(),
      }, input.messages);
    } catch (error) {
      this.finishAttempt(handle, 'audit_write_failed');
      throw error;
    }

    if (!valid) {
      this.finishAttempt(handle, 'context_boundary_violation');
      throw new ContextBoundaryViolationError();
    }
    this.activeAttempts.set(handle.attemptId, {
      handle,
      gameId: trace.gameId,
      actionId: trace.actionId,
      actionType: input.agentInput.actionType,
      controller,
    });
    this.emitTelemetry({
      type: 'attempt_started',
      attemptId: handle.attemptId,
      gameId: trace.gameId,
      actionId: trace.actionId,
      actionType: input.agentInput.actionType,
      occurredAt: now.toISOString(),
    });
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
    const controller = new AbortController();
    const handle = {
      attemptId: this.nextId(),
      startedAtMs: this.nowMs(),
      signal: controller.signal,
    };
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
      }, input.messages);
    } catch (error) {
      this.finishAttempt(handle, 'audit_write_failed');
      throw error;
    }
    this.activeAttempts.set(handle.attemptId, {
      handle,
      gameId: input.reviewInput.gameId,
      actionId: input.actionId,
      actionType: 'review',
      controller,
    });
    this.emitTelemetry({
      type: 'attempt_started',
      attemptId: handle.attemptId,
      gameId: input.reviewInput.gameId,
      actionId: input.actionId,
      actionType: 'review',
      occurredAt: now.toISOString(),
    });
    return handle;
  }

  finishAttempt(handle: AttemptHandle, resultCode: string, options?: { rawResponse?: string }) {
    const finishedAt = this.now();
    this.attempts.finish(handle.attemptId, {
      resultCode,
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, this.nowMs() - handle.startedAtMs),
    });
    this.audit.finishFullRecord(handle.attemptId, resultCode, options?.rawResponse);
    const active = this.activeAttempts.get(handle.attemptId);
    if (active) {
      this.emitTelemetry({
        type: 'attempt_finished',
        attemptId: handle.attemptId,
        gameId: active.gameId,
        actionId: active.actionId,
        actionType: active.actionType,
        occurredAt: finishedAt.toISOString(),
        resultCode,
      });
    }
    this.activeAttempts.delete(handle.attemptId);
  }

  markAttemptStage(
    attemptId: string,
    stage: ModelAttemptStageCode,
    options?: { rawResponse?: string },
  ) {
    this.attempts.markStage(attemptId, stage, this.now().toISOString());
    const active = this.activeAttempts.get(attemptId);
    if (active && options?.rawResponse !== undefined) active.rawResponse = options.rawResponse;
  }

  finalizeAttempt(attemptId: string, resultCode: string) {
    const active = this.activeAttempts.get(attemptId);
    if (!active) return;
    this.finishAttempt(
      active.handle,
      resultCode,
      active.rawResponse === undefined ? undefined : { rawResponse: active.rawResponse },
    );
  }

  interruptActiveAttempts(): InterruptedAttempt[] {
    const interrupted: InterruptedAttempt[] = [];
    for (const active of this.activeAttempts.values()) {
      this.finishAttempt(active.handle, 'runtime_interrupted');
      active.controller.abort();
      interrupted.push({ gameId: active.gameId, actionId: active.actionId });
    }
    return interrupted;
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

  private emitTelemetry(event: Parameters<TelemetrySink['emit']>[0]) {
    try {
      (this.options.telemetrySink ?? noOpTelemetrySink).emit(event);
    } catch {
      // 可选外部观测出口不得影响本地事实源与对局。
    }
  }
}

function validatePlayerBoundary(
  input: AgentTurnInput,
  trace: NonNullable<AgentActContext['trace']>,
) {
  agentTurnInputSchema.parse(input);
  if (
    trace.gameId !== input.gameId ||
    trace.provenance.gameId !== input.gameId ||
    trace.provenance.actorPlayerId !== input.actor.playerId ||
    trace.provenance.priorBeliefOwnerId !== input.actor.playerId ||
    trace.provenance.publicEventVisibility !== 'public' ||
    trace.provenance.publicEventCursor !== (input.publicEvents.at(-1)?.eventSeq ?? 0) ||
    !verifyAgentContextProvenance(trace.provenance, input)
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
  const actionId = `untrusted/${input.gameId}/${input.baseRevision}/${input.actor.playerId}/${input.actionType}`;
  return {
    gameId: input.gameId,
    commandId: actionId,
    actionId,
    provenance: {
      gameId: input.gameId,
      actorPlayerId: input.actor.playerId,
      priorBeliefOwnerId: input.actor.playerId,
      publicEventVisibility: 'public',
      publicEventCursor: input.publicEvents.at(-1)?.eventSeq ?? 0,
      inputHash: '',
    },
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

function writeJsonAtomically(target: string, value: unknown) {
  const temporary = `${target}.tmp`;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, target);
}

function sanitizeValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return sanitizeText(value, secrets);
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeValue(entry, secrets)]),
    );
  }
  return value;
}

function sanitizeText(value: string, secrets: readonly string[]) {
  let sanitized = value;
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  return sanitized
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s"')]+/gi, '[REDACTED_URL]')
    .replace(
      /("?(?:authorization|api[-_]?key|x-api-key)"?\s*[:=]\s*)[^\s,}]+/gi,
      '$1[REDACTED]',
    );
}
