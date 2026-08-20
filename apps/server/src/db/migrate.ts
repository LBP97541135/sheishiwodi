import type Database from 'better-sqlite3';
import { copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationUrl = new URL('../../drizzle/0000_initial.sql', import.meta.url);
export const latestDatabaseVersion = 5;

export function migrateDatabase(
  sqlite: Database.Database,
  options: { databasePath?: string; createBackup?: boolean } = {},
) {
  const currentVersion = sqlite.pragma('user_version', { simple: true }) as number;
  if (currentVersion >= latestDatabaseVersion) return;
  if (options.createBackup && options.databasePath) {
    sqlite.pragma('wal_checkpoint(FULL)');
    copyFileSync(
      options.databasePath,
      `${options.databasePath}.pre-v${latestDatabaseVersion}.bak`,
    );
  }
  const migration = readFileSync(fileURLToPath(migrationUrl), 'utf8');
  sqlite.exec(migration);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_actions (
      action_id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(game_id),
      player_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      base_revision INTEGER NOT NULL,
      public_event_cursor INTEGER,
      belief_json TEXT NOT NULL,
      output_json TEXT NOT NULL,
      completed_at TEXT NOT NULL
    );
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_role_models (
      role_id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS review_summaries (
      game_id TEXT PRIMARY KEY REFERENCES games(game_id),
      status TEXT NOT NULL,
      model_id TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const agentActionColumns = sqlite.pragma('table_info(agent_actions)') as Array<{ name: string }>;
  if (!agentActionColumns.some((column) => column.name === 'public_event_cursor')) {
    sqlite.exec('ALTER TABLE agent_actions ADD COLUMN public_event_cursor INTEGER;');
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS model_attempts (
      attempt_id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
      command_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      player_id TEXT,
      role_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      attempt_number INTEGER NOT NULL,
      attempt_kind TEXT NOT NULL,
      result_code TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      UNIQUE (action_id, attempt_number)
    );
    CREATE INDEX IF NOT EXISTS model_attempts_game_started
      ON model_attempts (game_id, started_at);
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS model_attempt_stages (
      attempt_id TEXT NOT NULL REFERENCES model_attempts(attempt_id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      PRIMARY KEY (attempt_id, stage)
    );
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS game_runtime_recovery (
      game_id TEXT PRIMARY KEY REFERENCES games(game_id) ON DELETE CASCADE,
      action_id TEXT NOT NULL,
      status TEXT NOT NULL,
      interrupted_at TEXT NOT NULL,
      resolved_at TEXT
    );
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS game_controls (
      game_id TEXT PRIMARY KEY REFERENCES games(game_id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'auto',
      request_budget INTEGER,
      used_requests INTEGER NOT NULL DEFAULT 0,
      pause_reason TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS character_profiles (
      profile_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      intro TEXT NOT NULL,
      personality_tags_json TEXT NOT NULL,
      personality_prompt TEXT NOT NULL,
      model_bindings_json TEXT NOT NULL,
      asset_manifest_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  sqlite.pragma(`user_version = ${latestDatabaseVersion}`);
}
