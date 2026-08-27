import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createPreparingGame,
  startPreparingGame,
  type AgentTurnInput,
  type Clock,
  type IdSource,
  type RandomSource,
  type WordPair,
} from '@sheishiwodi/shared';

import type {
  ModelAttemptRow,
  ModelAttemptStageCode,
} from '../db/model-attempt-repository.js';
import {
  ContextAuditWriter,
  PersistentAgentObservability,
  type ModelAttemptStore,
} from './agent-observability.js';
import { AgentContextAssembler } from './agent-context-assembler.js';
import { TokendanceAgentPolicy } from './tokendance-agent-policy.js';
import type { ChatMessage, TokendanceClient } from './tokendance-client.js';

class Ids implements IdSource {
  private value = 0;
  nextId(kind: 'game' | 'player' | 'event') {
    this.value += 1;
    return `${kind}-${this.value}`;
  }
}

class MemoryAttemptStore implements ModelAttemptStore {
  readonly rows: ModelAttemptRow[] = [];

  begin(
    input: Omit<
      ModelAttemptRow,
      'attemptNumber' | 'resultCode' | 'finishedAt' | 'durationMs' | 'stages'
    >,
  ) {
    const attemptNumber = this.rows.filter((row) => row.actionId === input.actionId).length + 1;
    this.rows.push({
      ...input,
      attemptNumber,
      resultCode: 'started',
      stages: [{ stage: 'request_started', occurredAt: input.startedAt }],
    });
    return attemptNumber;
  }

  markStage(attemptId: string, stage: ModelAttemptStageCode, occurredAt: string) {
    const row = this.rows.find((entry) => entry.attemptId === attemptId);
    if (row && !row.stages.some((entry) => entry.stage === stage)) {
      row.stages.push({ stage, occurredAt });
    }
  }

  finish(
    attemptId: string,
    input: { resultCode: string; finishedAt: string; durationMs: number },
  ) {
    const row = this.rows.find((entry) => entry.attemptId === attemptId);
    if (row) Object.assign(row, input);
  }
}

class ScriptedClient {
  calls: ChatMessage[][] = [];
  constructor(private readonly replies: string[]) {}
  async chatCompletion(params: { messages: ChatMessage[] }) {
    this.calls.push(params.messages);
    return this.replies[this.calls.length - 1] ?? '';
  }
}

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Agent observability', () => {
  it('每次真实请求记录链路与脱敏上下文清单，格式修复使用新的 attemptId', async () => {
    const { input, provenance, roleId } = describeInput();
    const store = new MemoryAttemptStore();
    const directory = temporaryDirectory();
    let id = 0;
    const observer = new PersistentAgentObservability(
      store,
      new ContextAuditWriter(directory),
      {
        now: () => new Date('2026-08-19T05:00:00.000Z'),
        nowMs: () => id * 10,
        nextId: () => `attempt-${++id}`,
      },
    );
    const livingIds = input.players.filter((player) => player.alive).map((player) => player.playerId);
    const client = new ScriptedClient(['not-json', speechReply(livingIds)]);
    const actionId = `auto/${input.gameId}/${input.baseRevision}/${input.actor.playerId}/describe`;
    const policy = new TokendanceAgentPolicy({
      client: client as unknown as TokendanceClient,
      roleModelMap: { [roleId]: 'model-x' },
      observability: observer,
      sleep: async () => undefined,
    });

    await policy.act(input, {
      agentRoleId: roleId,
      trace: {
        gameId: input.gameId,
        commandId: 'start-command',
        actionId,
        provenance,
      },
    });

    expect(store.rows).toMatchObject([
      {
        attemptId: 'attempt-1',
        commandId: 'start-command',
        actionId,
        attemptNumber: 1,
        attemptKind: 'initial',
        resultCode: 'invalid_format:no_json',
      },
      {
        attemptId: 'attempt-2',
        commandId: 'start-command',
        actionId,
        attemptNumber: 2,
        attemptKind: 'format_repair',
        resultCode: 'schema_validated',
      },
    ]);
    const manifests = readManifests(directory);
    expect(manifests).toHaveLength(2);
    expect(manifests[0]).toMatchObject({
      commandId: 'start-command',
      actionId,
      templateVersion: 'player-agent-v1',
      validation: { status: 'passed' },
    });
    expect(manifests[0]?.promptHash).toMatch(/^[a-f0-9]{64}$/);
    const persistedText = manifests.map((entry) => JSON.stringify(entry)).join('\n');
    expect(persistedText).not.toContain(input.actor.ownWordCard);
    expect(persistedText).not.toContain('只返回一个 JSON');
  });

  it('严格输入出现额外私有字段时在客户端调用前阻断并记录失败', async () => {
    const { input, provenance, roleId } = describeInput();
    const unsafeInput = {
      ...input,
      players: input.players.map((player, index) =>
        index === 1 ? { ...player, wordCard: '其他玩家词牌哨兵' } : player,
      ),
    } as unknown as AgentTurnInput;
    const store = new MemoryAttemptStore();
    const directory = temporaryDirectory();
    const observer = new PersistentAgentObservability(
      store,
      new ContextAuditWriter(directory),
      { nextId: () => 'blocked-attempt' },
    );
    const client = new ScriptedClient([]);
    const policy = new TokendanceAgentPolicy({
      client: client as unknown as TokendanceClient,
      roleModelMap: { [roleId]: 'model-x' },
      observability: observer,
      sleep: async () => undefined,
    });

    await expect(
      policy.act(unsafeInput, {
        agentRoleId: roleId,
        trace: {
          gameId: input.gameId,
          commandId: 'root',
          actionId: 'action',
          provenance,
        },
      }),
    ).rejects.toMatchObject({ code: 'CONTEXT_BOUNDARY_VIOLATION' });
    expect(client.calls).toHaveLength(0);
    expect(store.rows).toMatchObject([{ resultCode: 'context_boundary_violation' }]);
    expect(readManifests(directory)[0]).toMatchObject({ validation: { status: 'failed' } });
  });

  it('伪造公开事件来源声明时在客户端调用前阻断', async () => {
    const { input, roleId } = describeInput();
    const forgedInput = {
      ...input,
      publicEvents: [
        {
          eventSeq: 1,
          type: 'speech_published',
          occurredAt: '2026-08-19T05:00:00.000Z',
          payload: { text: '其他玩家私有词牌哨兵' },
        },
      ],
    } as AgentTurnInput;
    const store = new MemoryAttemptStore();
    const observer = new PersistentAgentObservability(
      store,
      new ContextAuditWriter(temporaryDirectory()),
      { nextId: () => 'forged-source-attempt' },
    );
    const client = new ScriptedClient([]);
    const policy = new TokendanceAgentPolicy({
      client: client as unknown as TokendanceClient,
      roleModelMap: { [roleId]: 'model-x' },
      observability: observer,
      sleep: async () => undefined,
    });

    await expect(
      policy.act(forgedInput, {
        agentRoleId: roleId,
        trace: {
          gameId: input.gameId,
          commandId: 'root',
          actionId: 'forged-source-action',
          provenance: {
            gameId: input.gameId,
            actorPlayerId: input.actor.playerId,
            priorBeliefOwnerId: input.actor.playerId,
            publicEventVisibility: 'public',
            publicEventCursor: 1,
            inputHash: 'forged',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'CONTEXT_BOUNDARY_VIOLATION' });
    expect(client.calls).toHaveLength(0);
    expect(store.rows).toMatchObject([{ resultCode: 'context_boundary_violation' }]);
  });

  it('缺少组装器来源证明时仍记录失败且不调用客户端', async () => {
    const { input, roleId } = describeInput();
    const store = new MemoryAttemptStore();
    const observer = new PersistentAgentObservability(
      store,
      new ContextAuditWriter(temporaryDirectory()),
      { nextId: () => 'missing-proof-attempt' },
    );
    const client = new ScriptedClient([]);
    const policy = new TokendanceAgentPolicy({
      client: client as unknown as TokendanceClient,
      roleModelMap: { [roleId]: 'model-x' },
      observability: observer,
      sleep: async () => undefined,
    });

    await expect(policy.act(input, { agentRoleId: roleId })).rejects.toMatchObject({
      code: 'CONTEXT_BOUNDARY_VIOLATION',
    });
    expect(client.calls).toHaveLength(0);
    expect(store.rows).toMatchObject([{ resultCode: 'context_boundary_violation' }]);
  });

  it('关停时中止活动请求并把 attempt 标记为 runtime_interrupted', () => {
    const { input, provenance, roleId } = describeInput();
    const store = new MemoryAttemptStore();
    const observer = new PersistentAgentObservability(
      store,
      new ContextAuditWriter(temporaryDirectory()),
      {
        now: () => new Date('2026-08-19T05:00:00.000Z'),
        nowMs: () => 25,
        nextId: () => 'active-attempt',
      },
    );
    const actionId = `auto/${input.gameId}/${input.baseRevision}/${input.actor.playerId}/describe`;
    const handle = observer.beginPlayerAttempt({
      agentInput: input,
      context: {
        agentRoleId: roleId,
        trace: {
          gameId: input.gameId,
          commandId: 'start-command',
          actionId,
          provenance,
        },
      },
      modelId: 'model-x',
      messages: [{ role: 'user', content: 'test' }],
      attemptKind: 'initial',
    });

    expect(handle.signal?.aborted).toBe(false);
    expect(observer.interruptActiveAttempts()).toEqual([{ gameId: input.gameId, actionId }]);
    expect(handle.signal?.aborted).toBe(true);
    expect(store.rows).toMatchObject([
      { attemptId: 'active-attempt', resultCode: 'runtime_interrupted', durationMs: 0 },
    ]);
    expect(observer.interruptActiveAttempts()).toEqual([]);
  });

  it('完整上下文必须显式开启，并在保存提示词与响应前清除凭据和地址', () => {
    const { input, provenance, roleId } = describeInput();
    const store = new MemoryAttemptStore();
    const directory = temporaryDirectory();
    const secret = 'secret-key-value';
    const audit = new ContextAuditWriter(directory, { secretValues: [secret] });
    const observer = new PersistentAgentObservability(store, audit, {
      now: () => new Date('2026-08-19T05:00:00.000Z'),
      nextId: () => 'full-record-attempt',
    });
    const attemptInput = {
      agentInput: input,
      context: {
        agentRoleId: roleId,
        trace: {
          gameId: input.gameId,
          commandId: 'start-command',
          actionId: 'full-record-action',
          provenance,
        },
      },
      modelId: 'model-x',
      messages: [{
        role: 'user' as const,
        content: `Authorization: Bearer token-123 ${secret} https://provider.example/v1/chat`,
      }],
      attemptKind: 'initial' as const,
    };

    const disabledHandle = observer.beginPlayerAttempt(attemptInput);
    observer.finishAttempt(disabledHandle, 'success', { rawResponse: secret });
    expect(audit.listFullRecords()).toEqual([]);

    audit.setFullRecordingEnabled(true);
    const handle = observer.beginPlayerAttempt(attemptInput);
    observer.finishAttempt(handle, 'success', {
      rawResponse: `api_key=${secret} https://provider.example/result`,
    });

    const record = audit.getFullRecord(handle.attemptId);
    expect(record).toMatchObject({ resultCode: 'success' });
    const persisted = JSON.stringify(record);
    expect(persisted).not.toContain(secret);
    expect(persisted).not.toContain('provider.example');
    expect(persisted).not.toContain('token-123');
    expect(persisted).toContain('[REDACTED]');
    expect(persisted).toContain('[REDACTED_URL]');

    audit.clearFullRecords();
    expect(audit.listFullRecords()).toEqual([]);
    expect(new ContextAuditWriter(directory).isFullRecordingEnabled()).toBe(false);

    const capacityAudit = new ContextAuditWriter(directory, { fullRecordMaxBytes: 1_000 });
    capacityAudit.setFullRecordingEnabled(true);
    const capacityObserver = new PersistentAgentObservability(store, capacityAudit, {
      nextId: () => 'capacity-attempt',
    });
    const capacityHandle = capacityObserver.beginPlayerAttempt(attemptInput);
    capacityObserver.finishAttempt(capacityHandle, 'success', {
      rawResponse: 'x'.repeat(2_000),
    });
    expect(capacityAudit.listFullRecords()).toEqual([]);
  });
});

function describeInput() {
  const clock: Clock = { now: () => '2026-08-19T05:00:00.000Z' };
  const random: RandomSource = { next: () => 0 };
  const pair: WordPair = {
    id: 'pair',
    civilianWord: '牛奶',
    undercoverWord: '豆浆',
    category: '饮品',
    difficulty: 'easy',
    enabled: true,
  };
  const ids = new Ids();
  const created = createPreparingGame(
    {
      type: 'CreateGame',
      commandId: 'create',
      human: { displayName: '玩家', silhouette: 'silhouette_a' },
      difficulty: 'easy',
    },
    [pair],
    { ids, clock, random },
  );
  const started = startPreparingGame(
    created.snapshot,
    {
      type: 'StartGame',
      commandId: 'start',
      gameId: created.snapshot.gameId,
      actorId: created.snapshot.humanPlayerId,
      expectedRevision: 0,
    },
    { ids, clock },
  );
  const agent = started.snapshot.players.find((player) => player.kind === 'agent')!;
  const snapshot = {
    ...started.snapshot,
    round: { ...started.snapshot.round!, currentActorId: agent.playerId },
  };
  const assembled = new AgentContextAssembler({
    listAgentBeliefs: () => [],
    listPublicTimeline: () => [],
  }).assemble(snapshot, agent.playerId);
  return {
    ...assembled,
    roleId: agent.agentRoleId ?? agent.playerId,
  };
}

function speechReply(livingIds: string[]) {
  return JSON.stringify({
    belief: {
      opposingWordCandidates: [{ word: '豆浆', confidence: 0.6, evidence: '饮品线索' }],
      playerUndercoverProbabilities: livingIds.map((playerId, index) => ({
        playerId,
        probability: index === 0 ? 1 : 0,
      })),
      reasoningSummary: '暂无强证据',
    },
    text: '早餐常见的白色饮品',
  });
}

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'agent-audit-'));
  directories.push(directory);
  return directory;
}

function readManifests(directory: string): Array<Record<string, unknown>> {
  const gameDirectory = join(directory, readdirSync(directory)[0]!);
  return readdirSync(gameDirectory)
    .sort()
    .map((file) => JSON.parse(readFileSync(join(gameDirectory, file), 'utf8')) as Record<string, unknown>);
}
