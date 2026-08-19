import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createDatabase } from './client.js';
import { latestDatabaseVersion, migrateDatabase } from './migrate.js';

describe('database startup reliability', () => {
  it('应用 busy timeout，并在旧库迁移前生成单份可恢复备份', () => {
    const directory = mkdtempSync(join(tmpdir(), 'database-migration-'));
    const databasePath = join(directory, 'test.db');
    try {
      const original = createDatabase(databasePath, { busyTimeoutMs: 1234 });
      expect(original.sqlite.pragma('busy_timeout', { simple: true })).toBe(1234);
      original.sqlite.exec('CREATE TABLE legacy_marker (value TEXT NOT NULL)');
      original.sqlite.prepare('INSERT INTO legacy_marker (value) VALUES (?)').run('before');
      original.sqlite.pragma('user_version = 1');
      original.close();

      const reopened = createDatabase(databasePath);
      migrateDatabase(reopened.sqlite, { databasePath, createBackup: true });
      expect(existsSync(`${databasePath}.pre-v${latestDatabaseVersion}.bak`)).toBe(true);
      expect(reopened.sqlite.pragma('user_version', { simple: true })).toBe(
        latestDatabaseVersion,
      );
      expect(
        reopened.sqlite.prepare('SELECT value FROM legacy_marker').get(),
      ).toEqual({ value: 'before' });
      expect(
        reopened.sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get('model_attempt_stages'),
      ).toEqual({ name: 'model_attempt_stages' });
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('从 v2 增量增加 attempt 阶段表并保留已有调用记录', () => {
    const directory = mkdtempSync(join(tmpdir(), 'database-stage-migration-'));
    const databasePath = join(directory, 'test.db');
    try {
      const original = createDatabase(databasePath);
      migrateDatabase(original.sqlite);
      original.sqlite.exec(`
        DROP TABLE model_attempt_stages;
        INSERT INTO games (
          game_id, status, phase, revision, event_seq, stream_seq,
          snapshot_json, schema_version, created_at, updated_at
        ) VALUES (
          'legacy-game', 'in_progress', 'speaking', 0, 0, 0, '{}', 1,
          '2026-08-19T05:00:00.000Z', '2026-08-19T05:00:00.000Z'
        );
        INSERT INTO model_attempts (
          attempt_id, game_id, command_id, action_id, role_id, model_id,
          action_type, attempt_number, attempt_kind, result_code, started_at
        ) VALUES (
          'legacy-attempt', 'legacy-game', 'legacy-command', 'legacy-action',
          'deepseek', 'legacy-model', 'describe', 1, 'initial', 'success',
          '2026-08-19T05:00:00.000Z'
        );
      `);
      original.sqlite.pragma('user_version = 2');
      original.close();

      const reopened = createDatabase(databasePath);
      migrateDatabase(reopened.sqlite);
      expect(
        reopened.sqlite.prepare('SELECT result_code FROM model_attempts').get(),
      ).toEqual({ result_code: 'success' });
      expect(
        reopened.sqlite.prepare('SELECT COUNT(*) AS value FROM model_attempt_stages').get(),
      ).toEqual({ value: 0 });
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
