import type { AppDatabase } from './client.js';

export type ModelAttemptKind =
  | 'initial'
  | 'format_repair'
  | 'content_regeneration'
  | 'system_retry';

export interface ModelAttemptRow {
  attemptId: string;
  gameId: string;
  commandId: string;
  actionId: string;
  playerId?: string;
  roleId: string;
  modelId: string;
  actionType: string;
  attemptNumber: number;
  attemptKind: ModelAttemptKind;
  resultCode: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface InterruptedModelAction {
  gameId: string;
  actionId: string;
}

export class ModelAttemptRepository {
  constructor(private readonly database: AppDatabase) {}

  begin(input: Omit<ModelAttemptRow, 'attemptNumber' | 'resultCode' | 'finishedAt' | 'durationMs'>) {
    return this.database.sqlite.transaction(() => {
      const row = this.database.sqlite
        .prepare(
          `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number
           FROM model_attempts WHERE action_id = ?`,
        )
        .get(input.actionId) as { attempt_number: number };
      const attemptNumber = row.attempt_number;
      this.database.sqlite
        .prepare(
          `INSERT INTO model_attempts (
            attempt_id, game_id, command_id, action_id, player_id, role_id, model_id,
            action_type, attempt_number, attempt_kind, result_code, started_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'started', ?)`,
        )
        .run(
          input.attemptId,
          input.gameId,
          input.commandId,
          input.actionId,
          input.playerId ?? null,
          input.roleId,
          input.modelId,
          input.actionType,
          attemptNumber,
          input.attemptKind,
          input.startedAt,
        );
      return attemptNumber;
    })();
  }

  finish(
    attemptId: string,
    input: { resultCode: string; finishedAt: string; durationMs: number },
  ) {
    this.database.sqlite
      .prepare(
        `UPDATE model_attempts
         SET result_code = ?, finished_at = ?, duration_ms = ?
         WHERE attempt_id = ? AND finished_at IS NULL`,
      )
      .run(input.resultCode, input.finishedAt, input.durationMs, attemptId);
  }

  interruptUnfinished(finishedAt: string): InterruptedModelAction[] {
    return this.database.sqlite.transaction(() => {
      const rows = this.database.sqlite
        .prepare(
          `SELECT attempt_id, game_id, action_id, started_at
           FROM model_attempts WHERE finished_at IS NULL
           ORDER BY started_at, attempt_id`,
        )
        .all() as Array<{
        attempt_id: string;
        game_id: string;
        action_id: string;
        started_at: string;
      }>;
      const update = this.database.sqlite.prepare(
        `UPDATE model_attempts
         SET result_code = 'runtime_interrupted', finished_at = ?, duration_ms = ?
         WHERE attempt_id = ? AND finished_at IS NULL`,
      );
      const finishedAtMs = Date.parse(finishedAt);
      for (const row of rows) {
        const startedAtMs = Date.parse(row.started_at);
        update.run(
          finishedAt,
          Number.isFinite(finishedAtMs) && Number.isFinite(startedAtMs)
            ? Math.max(0, finishedAtMs - startedAtMs)
            : 0,
          row.attempt_id,
        );
      }
      return Array.from(
        new Map(rows.map((row) => [`${row.game_id}\0${row.action_id}`, {
          gameId: row.game_id,
          actionId: row.action_id,
        }])).values(),
      );
    })();
  }

  listByAction(actionId: string): ModelAttemptRow[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT attempt_id, game_id, command_id, action_id, player_id, role_id, model_id,
                action_type, attempt_number, attempt_kind, result_code, started_at,
                finished_at, duration_ms
         FROM model_attempts WHERE action_id = ? ORDER BY attempt_number`,
      )
      .all(actionId) as Array<{
      attempt_id: string;
      game_id: string;
      command_id: string;
      action_id: string;
      player_id: string | null;
      role_id: string;
      model_id: string;
      action_type: string;
      attempt_number: number;
      attempt_kind: ModelAttemptKind;
      result_code: string;
      started_at: string;
      finished_at: string | null;
      duration_ms: number | null;
    }>;
    return rows.map((row) => ({
      attemptId: row.attempt_id,
      gameId: row.game_id,
      commandId: row.command_id,
      actionId: row.action_id,
      ...(row.player_id ? { playerId: row.player_id } : {}),
      roleId: row.role_id,
      modelId: row.model_id,
      actionType: row.action_type,
      attemptNumber: row.attempt_number,
      attemptKind: row.attempt_kind,
      resultCode: row.result_code,
      startedAt: row.started_at,
      ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
      ...(row.duration_ms === null ? {} : { durationMs: row.duration_ms }),
    }));
  }
}
