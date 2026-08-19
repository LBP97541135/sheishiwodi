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
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
