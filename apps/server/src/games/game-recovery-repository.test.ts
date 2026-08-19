import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createDatabase } from '../db/client.js';
import { migrateDatabase } from '../db/migrate.js';
import { GameRecoveryRepository } from './game-recovery-repository.js';

describe('GameRecoveryRepository', () => {
  it('持久化等待确认并以单次原子决议关闭门禁', () => {
    const directory = mkdtempSync(join(tmpdir(), 'game-runtime-recovery-'));
    const database = createDatabase(join(directory, 'test.db'));
    try {
      migrateDatabase(database.sqlite);
      database.sqlite
        .prepare(
          `INSERT INTO games (
            game_id, status, phase, revision, event_seq, stream_seq,
            snapshot_json, schema_version, created_at, updated_at
          ) VALUES (?, 'in_progress', 'speaking', 0, 0, 0, '{}', 1, ?, ?)`,
        )
        .run('game-1', '2026-08-19T05:00:00.000Z', '2026-08-19T05:00:00.000Z');
      const repository = new GameRecoveryRepository(database);

      repository.markAwaiting({
        gameId: 'game-1',
        actionId: 'action-1',
        interruptedAt: '2026-08-19T05:00:01.000Z',
      });
      expect(repository.getAwaiting('game-1')).toEqual({
        gameId: 'game-1',
        actionId: 'action-1',
        interruptedAt: '2026-08-19T05:00:01.000Z',
      });
      expect(repository.resolve('game-1', 'continue', '2026-08-19T05:00:02.000Z')).toBe(true);
      expect(repository.resolve('game-1', 'continue', '2026-08-19T05:00:03.000Z')).toBe(false);
      expect(repository.getAwaiting('game-1')).toBeNull();
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
