import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

// 角色模型配置：仅存 role_id → model_id，绝不保存 Base URL 或 API Key。
export const agentRoleModels = sqliteTable('agent_role_models', {
  roleId: text('role_id').primaryKey(),
  modelId: text('model_id').notNull(),
  updatedAt: text('updated_at').notNull(),
});
