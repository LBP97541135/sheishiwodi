import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationUrl = new URL('../../drizzle/0000_initial.sql', import.meta.url);

export function migrateDatabase(sqlite: Database.Database) {
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
}
