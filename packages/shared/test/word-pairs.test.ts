import { describe, expect, it } from 'vitest';

import { wordPairCollectionSchema } from '../src/index.js';

const validPairs = [
  {
    id: 'easy-1',
    civilianWord: '牛奶',
    undercoverWord: '豆浆',
    category: '饮品',
    difficulty: 'easy',
    enabled: true,
  },
  {
    id: 'hard-1',
    civilianWord: '月亮',
    undercoverWord: '太阳',
    category: '自然',
    difficulty: 'hard',
    enabled: true,
  },
] as const;

describe('词库集合', () => {
  it('接受每个难度均有启用词组的子集', () => {
    expect(wordPairCollectionSchema.parse(validPairs)).toHaveLength(2);
  });

  it('拒绝重复 ID', () => {
    expect(
      wordPairCollectionSchema.safeParse([
        ...validPairs,
        { ...validPairs[1], id: 'easy-1' },
      ]).success,
    ).toBe(false);
  });

  it('拒绝规范化后相同的同组词语', () => {
    expect(
      wordPairCollectionSchema.safeParse([
        validPairs[0],
        {
          ...validPairs[1],
          civilianWord: 'A-B',
          undercoverWord: 'a b',
        },
      ]).success,
    ).toBe(false);
  });

  it('拒绝缺少启用困难词的集合', () => {
    expect(wordPairCollectionSchema.safeParse([validPairs[0]]).success).toBe(false);
  });
});
