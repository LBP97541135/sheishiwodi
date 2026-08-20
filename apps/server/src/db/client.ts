import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.js';

export function createDatabase(
  path: string,
  options: { busyTimeoutMs?: number } = {},
) {
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 3_000}`);
  let healthy = false;
  try {
    healthy = sqlite.pragma('quick_check', { simple: true }) === 'ok';
  } catch {
    // 损坏数据库可能直接抛错；保留连接仅用于健康检查与显式关闭。
    healthy = false;
  }
  if (healthy) sqlite.pragma('journal_mode = WAL');

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    health: healthy
      ? ({ healthy: true as const })
      : ({ healthy: false as const, code: 'DATABASE_INTEGRITY_FAILED' as const }),
    close: () => sqlite.close(),
  };
}

export type AppDatabase = ReturnType<typeof createDatabase>;
