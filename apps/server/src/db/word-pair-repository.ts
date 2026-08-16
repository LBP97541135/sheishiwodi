import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { wordPairCollectionSchema, type Difficulty, type WordPair } from '@sheishiwodi/shared';

import type { AppDatabase } from './client.js';
import { wordPairs } from './schema.js';

export class WordPairRepository {
  constructor(private readonly database: AppDatabase) {}

  sync(source: unknown) {
    const pairs = wordPairCollectionSchema.parse(source);
    const syncAll = this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare('UPDATE word_pairs SET enabled = 0').run();
      for (const pair of pairs) {
        const sourceHash = createHash('sha256').update(JSON.stringify(pair)).digest('hex');
        this.database.db
          .insert(wordPairs)
          .values({
            wordPairId: pair.id,
            civilianWord: pair.civilianWord,
            undercoverWord: pair.undercoverWord,
            category: pair.category,
            difficulty: pair.difficulty,
            enabled: pair.enabled,
            sourceHash,
          })
          .onConflictDoUpdate({
            target: wordPairs.wordPairId,
            set: {
              civilianWord: pair.civilianWord,
              undercoverWord: pair.undercoverWord,
              category: pair.category,
              difficulty: pair.difficulty,
              enabled: pair.enabled,
              sourceHash,
            },
          })
          .run();
      }
    });
    syncAll();
  }

  listEnabled(difficulty: Difficulty): WordPair[] {
    return this.database.db
      .select()
      .from(wordPairs)
      .where(eq(wordPairs.difficulty, difficulty))
      .all()
      .filter((pair) => pair.enabled)
      .map((pair) => ({
        id: pair.wordPairId,
        civilianWord: pair.civilianWord,
        undercoverWord: pair.undercoverWord,
        category: pair.category,
        difficulty: difficulty,
        enabled: true,
      }));
  }
}
