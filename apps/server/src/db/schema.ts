import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const wordPairs = sqliteTable('word_pairs', {
  wordPairId: text('word_pair_id').primaryKey(),
  civilianWord: text('civilian_word').notNull(),
  undercoverWord: text('undercover_word').notNull(),
  category: text('category').notNull(),
  difficulty: text('difficulty').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  sourceHash: text('source_hash').notNull(),
});

export const games = sqliteTable('games', {
  gameId: text('game_id').primaryKey(),
  status: text('status').notNull(),
  phase: text('phase').notNull(),
  revision: integer('revision').notNull(),
  eventSeq: integer('event_seq').notNull(),
  streamSeq: integer('stream_seq').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const gamePlayers = sqliteTable(
  'game_players',
  {
    gameId: text('game_id').notNull(),
    playerId: text('player_id').notNull(),
    seatIndex: integer('seat_index').notNull(),
    kind: text('kind').notNull(),
    displayName: text('display_name').notNull(),
    camp: text('camp').notNull(),
    wordCard: text('word_card').notNull(),
    alive: integer('alive', { mode: 'boolean' }).notNull(),
    silhouette: text('silhouette'),
    agentRoleId: text('agent_role_id'),
  },
  (table) => [
    uniqueIndex('game_players_identity').on(table.gameId, table.playerId),
    uniqueIndex('game_players_seat').on(table.gameId, table.seatIndex),
  ],
);

export const gameEvents = sqliteTable(
  'game_events',
  {
    eventId: text('event_id').primaryKey(),
    gameId: text('game_id').notNull(),
    eventSeq: integer('event_seq').notNull(),
    type: text('type').notNull(),
    visibility: text('visibility').notNull(),
    commandId: text('command_id'),
    actionId: text('action_id'),
    payloadJson: text('payload_json').notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [uniqueIndex('game_events_sequence').on(table.gameId, table.eventSeq)],
);

export const publicStreamEntries = sqliteTable(
  'public_stream_entries',
  {
    gameId: text('game_id').notNull(),
    streamSeq: integer('stream_seq').notNull(),
    type: text('type').notNull(),
    eventSeq: integer('event_seq'),
    payloadJson: text('payload_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('public_stream_sequence').on(table.gameId, table.streamSeq)],
);

export const processedCommands = sqliteTable('processed_commands', {
  commandId: text('command_id').primaryKey(),
  gameId: text('game_id').notNull(),
  actorId: text('actor_id').notNull(),
  requestHash: text('request_hash').notNull(),
  revisionBefore: integer('revision_before').notNull(),
  revisionAfter: integer('revision_after').notNull(),
  responseJson: text('response_json').notNull(),
  completedAt: text('completed_at').notNull(),
});

export const agentActions = sqliteTable('agent_actions', {
  actionId: text('action_id').primaryKey(),
  gameId: text('game_id').notNull(),
  playerId: text('player_id').notNull(),
  roundNumber: integer('round_number').notNull(),
  actionType: text('action_type').notNull(),
  baseRevision: integer('base_revision').notNull(),
  beliefJson: text('belief_json').notNull(),
  outputJson: text('output_json').notNull(),
  completedAt: text('completed_at').notNull(),
});

export const gameControls = sqliteTable('game_controls', {
  gameId: text('game_id').primaryKey(),
  mode: text('mode').notNull(),
  requestBudget: integer('request_budget'),
  usedRequests: integer('used_requests').notNull(),
  pauseReason: text('pause_reason'),
  updatedAt: text('updated_at').notNull(),
});

export const characterProfiles = sqliteTable('character_profiles', {
  profileId: text('profile_id').primaryKey(),
  displayName: text('display_name').notNull(),
  intro: text('intro').notNull(),
  personalityTagsJson: text('personality_tags_json').notNull(),
  personalityPrompt: text('personality_prompt').notNull(),
  modelBindingsJson: text('model_bindings_json').notNull(),
  assetManifestJson: text('asset_manifest_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const modelAttempts = sqliteTable(
  'model_attempts',
  {
    attemptId: text('attempt_id').primaryKey(),
    gameId: text('game_id').notNull(),
    commandId: text('command_id').notNull(),
    actionId: text('action_id').notNull(),
    playerId: text('player_id'),
    roleId: text('role_id').notNull(),
    modelId: text('model_id').notNull(),
    actionType: text('action_type').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    attemptKind: text('attempt_kind').notNull(),
    resultCode: text('result_code').notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    durationMs: integer('duration_ms'),
  },
  (table) => [
    uniqueIndex('model_attempts_action_number').on(table.actionId, table.attemptNumber),
    index('model_attempts_game_started').on(table.gameId, table.startedAt),
  ],
);

export const modelAttemptStages = sqliteTable(
  'model_attempt_stages',
  {
    attemptId: text('attempt_id')
      .notNull()
      .references(() => modelAttempts.attemptId, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [uniqueIndex('model_attempt_stages_identity').on(table.attemptId, table.stage)],
);

export const gameRuntimeRecovery = sqliteTable('game_runtime_recovery', {
  gameId: text('game_id').primaryKey(),
  actionId: text('action_id').notNull(),
  status: text('status').notNull(),
  interruptedAt: text('interrupted_at').notNull(),
  resolvedAt: text('resolved_at'),
});

// 角色模型配置：仅存 role_id → model_id，绝不保存 Base URL 或 API Key。
export const agentRoleModels = sqliteTable('agent_role_models', {
  roleId: text('role_id').primaryKey(),
  modelId: text('model_id').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 赛后复盘（AI 评价）：每局一行。summary_json 存完整脱敏 ReviewSummary，
// 只含 model ID 与评价文本，绝不含 Base URL / API Key / 模型原始响应。
export const reviewSummaries = sqliteTable('review_summaries', {
  gameId: text('game_id').primaryKey(),
  status: text('status').notNull(),
  modelId: text('model_id').notNull(),
  summaryJson: text('summary_json').notNull(),
  errorCode: text('error_code'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
