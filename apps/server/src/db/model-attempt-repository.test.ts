import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createDatabase } from './client.js';
import { migrateDatabase } from './migrate.js';
import { ModelAttemptRepository } from './model-attempt-repository.js';

describe('ModelAttemptRepository', () => {
  it('按 action 连续编号、完成尝试并随对局级联删除', () => {
    const directory = mkdtempSync(join(tmpdir(), 'model-attempts-'));
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
      const repository = new ModelAttemptRepository(database);
      const common = {
        gameId: 'game-1',
        commandId: 'start-1',
        actionId: 'action-1',
        playerId: 'agent-1',
        roleId: 'deepseek',
        modelId: 'model-x',
        actionType: 'describe',
        startedAt: '2026-08-19T05:00:00.000Z',
      } as const;

      expect(repository.begin({ ...common, attemptId: 'attempt-1', attemptKind: 'initial' })).toBe(1);
      expect(
        repository.begin({ ...common, attemptId: 'attempt-2', attemptKind: 'format_repair' }),
      ).toBe(2);
      repository.finish('attempt-1', {
        resultCode: 'invalid_format',
        finishedAt: '2026-08-19T05:00:00.100Z',
        durationMs: 100,
      });
      repository.finish('attempt-2', {
        resultCode: 'success',
        finishedAt: '2026-08-19T05:00:00.250Z',
        durationMs: 150,
      });

      expect(repository.listByAction('action-1')).toMatchObject([
        { attemptNumber: 1, attemptKind: 'initial', resultCode: 'invalid_format', durationMs: 100 },
        { attemptNumber: 2, attemptKind: 'format_repair', resultCode: 'success', durationMs: 150 },
      ]);

      expect(
        repository.begin({
          ...common,
          attemptId: 'attempt-3',
          actionId: 'action-interrupted',
          attemptKind: 'initial',
        }),
      ).toBe(1);
      expect(
        repository.interruptUnfinished('2026-08-19T05:00:01.000Z'),
      ).toEqual([{ gameId: 'game-1', actionId: 'action-interrupted' }]);
      expect(repository.listByAction('action-interrupted')).toMatchObject([
        {
          resultCode: 'runtime_interrupted',
          finishedAt: '2026-08-19T05:00:01.000Z',
          durationMs: 1000,
        },
      ]);
      const columns = database.sqlite.prepare('PRAGMA table_info(model_attempts)').all() as Array<{
        name: string;
      }>;
      expect(columns.map((column) => column.name)).not.toEqual(
        expect.arrayContaining(['prompt', 'response', 'api_key', 'base_url']),
      );

      database.sqlite.prepare('DELETE FROM games WHERE game_id = ?').run('game-1');
      expect(repository.listByAction('action-1')).toEqual([]);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
