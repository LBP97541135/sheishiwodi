import type { AppDatabase } from '../db/client.js';

export interface GameRuntimeRecovery {
  gameId: string;
  actionId: string;
  interruptedAt: string;
}

export class GameRecoveryRepository {
  constructor(private readonly database: AppDatabase) {}

  markAwaiting(input: GameRuntimeRecovery) {
    this.database.sqlite
      .prepare(
        `INSERT INTO game_runtime_recovery (
          game_id, action_id, status, interrupted_at, resolved_at
        ) VALUES (?, ?, 'awaiting_confirmation', ?, NULL)
        ON CONFLICT(game_id) DO UPDATE SET
          action_id = excluded.action_id,
          status = 'awaiting_confirmation',
          interrupted_at = excluded.interrupted_at,
          resolved_at = NULL`,
      )
      .run(input.gameId, input.actionId, input.interruptedAt);
  }

  getAwaiting(gameId: string): GameRuntimeRecovery | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT game_id, action_id, interrupted_at
         FROM game_runtime_recovery
         WHERE game_id = ? AND status = 'awaiting_confirmation'`,
      )
      .get(gameId) as
      | { game_id: string; action_id: string; interrupted_at: string }
      | undefined;
    return row
      ? { gameId: row.game_id, actionId: row.action_id, interruptedAt: row.interrupted_at }
      : null;
  }

  listAwaiting(): GameRuntimeRecovery[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT game_id, action_id, interrupted_at
         FROM game_runtime_recovery
         WHERE status = 'awaiting_confirmation'
         ORDER BY interrupted_at DESC`,
      )
      .all() as Array<{ game_id: string; action_id: string; interrupted_at: string }>;
    return rows.map((row) => ({
      gameId: row.game_id,
      actionId: row.action_id,
      interruptedAt: row.interrupted_at,
    }));
  }

  resolve(gameId: string, resolution: 'continue' | 'start_new', resolvedAt: string): boolean {
    const result = this.database.sqlite
      .prepare(
        `UPDATE game_runtime_recovery
         SET status = ?, resolved_at = ?
         WHERE game_id = ? AND status = 'awaiting_confirmation'`,
      )
      .run(resolution === 'continue' ? 'resuming' : 'declined', resolvedAt, gameId);
    return result.changes === 1;
  }
}
