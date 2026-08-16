import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Clock, IdSource, RandomSource } from '@sheishiwodi/shared';

import { createDatabase } from './db/client.js';
import { migrateDatabase } from './db/migrate.js';
import { WordPairRepository } from './db/word-pair-repository.js';
import type { ServerDependencies } from './server.js';

class TestIds implements IdSource {
  private cursor = 0;

  nextId(kind: 'game' | 'player' | 'event') {
    this.cursor += 1;
    return `${kind}-${this.cursor}`;
  }
}

class TestRandom implements RandomSource {
  private cursor = 0;

  constructor(private readonly values: readonly number[] = [0, 0, 0, 0, 0]) {}

  next() {
    const value = this.values[this.cursor] ?? 0;
    this.cursor += 1;
    return value;
  }
}

const testClock: Clock = {
  now: () => '2026-08-16T12:00:00.000Z',
};

export function createTestEnvironment(randomValues?: readonly number[]) {
  const directory = mkdtempSync(join(tmpdir(), 'sheishiwodi-'));
  const databasePath = join(directory, 'test.db');
  const database = createDatabase(databasePath);
  migrateDatabase(database.sqlite);
  const sourceUrl = new URL('../../../data/word-pairs.json', import.meta.url);
  const source = JSON.parse(readFileSync(fileURLToPath(sourceUrl), 'utf8')) as unknown;
  new WordPairRepository(database).sync(source);

  const dependencies: ServerDependencies = {
    database,
    random: new TestRandom(randomValues),
    ids: new TestIds(),
    clock: testClock,
  };

  return {
    directory,
    databasePath,
    dependencies,
    cleanup: () => {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
