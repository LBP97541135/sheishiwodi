import type { AutomationControl } from '@sheishiwodi/shared';

import type { AppDatabase } from '../db/client.js';

export type AutomationMode = 'auto' | 'paused' | 'step';

export class GameControlRepository {
  constructor(private readonly database: AppDatabase) {}

  initialize(gameId: string, requestBudget: number | null, updatedAt: string) {
    this.database.sqlite
      .prepare(
        `INSERT OR IGNORE INTO game_controls
          (game_id, mode, request_budget, used_requests, pause_reason, updated_at)
         VALUES (?, 'auto', ?, 0, NULL, ?)`,
      )
      .run(gameId, requestBudget, updatedAt);
  }

  get(gameId: string): AutomationControl | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT mode, request_budget, used_requests, pause_reason
         FROM game_controls WHERE game_id = ?`,
      )
      .get(gameId) as
      | {
          mode: AutomationMode;
          request_budget: number | null;
          used_requests: number;
          pause_reason: 'user' | 'budget_exhausted' | null;
        }
      | undefined;
    if (!row) return null;
    return {
      mode: row.mode,
      requestBudget: row.request_budget,
      usedRequests: row.used_requests,
      remainingRequests:
        row.request_budget === null ? null : Math.max(0, row.request_budget - row.used_requests),
      pauseReason: row.pause_reason,
    };
  }

  setMode(gameId: string, mode: AutomationMode, updatedAt: string) {
    const pauseReason = mode === 'paused' ? 'user' : null;
    const result = this.database.sqlite
      .prepare(
        `UPDATE game_controls SET mode = ?, pause_reason = ?, updated_at = ? WHERE game_id = ?`,
      )
      .run(mode, pauseReason, updatedAt, gameId);
    return result.changes > 0;
  }

  addBudget(gameId: string, amount: number, updatedAt: string) {
    const result = this.database.sqlite
      .prepare(
        `UPDATE game_controls
         SET request_budget = COALESCE(request_budget, 0) + ?,
             mode = 'paused', pause_reason = 'user', updated_at = ?
         WHERE game_id = ?`,
      )
      .run(amount, updatedAt, gameId);
    return result.changes > 0;
  }

  reserveAttempt(gameId: string, updatedAt: string) {
    return this.database.sqlite.transaction(() => {
      const result = this.database.sqlite
        .prepare(
          `UPDATE game_controls
           SET used_requests = used_requests + 1, updated_at = ?
           WHERE game_id = ?
             AND (request_budget IS NULL OR used_requests < request_budget)`,
        )
        .run(updatedAt, gameId);
      if (result.changes > 0) return true;
      const row = this.database.sqlite
        .prepare('SELECT request_budget FROM game_controls WHERE game_id = ?')
        .get(gameId) as { request_budget: number | null } | undefined;
      if (!row || row.request_budget === null) return true;
      this.database.sqlite
        .prepare(
          `UPDATE game_controls
           SET mode = 'paused', pause_reason = 'budget_exhausted', updated_at = ?
           WHERE game_id = ?`,
        )
        .run(updatedAt, gameId);
      return false;
    })();
  }
}
