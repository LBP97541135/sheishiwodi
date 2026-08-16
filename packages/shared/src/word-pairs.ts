import { z } from 'zod';

import { difficultySchema } from './enums.js';

const normalizedComparableWord = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]/gu, '');

const wordPairBaseSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    civilianWord: z.string().trim().min(1).max(40),
    undercoverWord: z.string().trim().min(1).max(40),
    category: z.string().trim().min(1).max(40),
    difficulty: difficultySchema,
    enabled: z.boolean(),
  })
  .strict();

export const wordPairSchema = wordPairBaseSchema.superRefine((pair, context) => {
  if (normalizedComparableWord(pair.civilianWord) === normalizedComparableWord(pair.undercoverWord)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '同组平民词和卧底词不能相同',
      path: ['undercoverWord'],
    });
  }
});

export const wordPairCollectionSchema = z
  .array(wordPairSchema)
  .min(1)
  .superRefine((pairs, context) => {
    const seenIds = new Set<string>();

    pairs.forEach((pair, index) => {
      if (seenIds.has(pair.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: '词组 ID 必须唯一',
          path: [index, 'id'],
        });
      }
      seenIds.add(pair.id);
    });

    for (const difficulty of difficultySchema.options) {
      if (!pairs.some((pair) => pair.enabled && pair.difficulty === difficulty)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${difficulty} 难度至少需要一组启用词组`,
        });
      }
    }
  });

export const wordPairSnapshotSchema = wordPairBaseSchema
  .omit({ enabled: true })
  .extend({ wordPairId: z.string().trim().min(1).max(128) })
  .omit({ id: true })
  .strict();

export type WordPair = z.infer<typeof wordPairSchema>;
export type WordPairSnapshot = z.infer<typeof wordPairSnapshotSchema>;
