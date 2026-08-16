import { describe, expect, it } from 'vitest';

import { normalizeForWordLeak, validatePublicSpeech } from '../src/index.js';

describe('公开发言校验', () => {
  it('接受 2 到 40 字和最多两句', () => {
    expect(validatePublicSpeech('很甜', '牛奶')).toEqual({ valid: true });
    expect(validatePublicSpeech(`${'好'.repeat(19)}。${'喝'.repeat(20)}`, '牛奶')).toEqual({
      valid: true,
    });
  });

  it('拒绝过短、过长和超过两句', () => {
    expect(validatePublicSpeech('甜', '牛奶').code).toBe('TOO_SHORT');
    expect(validatePublicSpeech('长'.repeat(41), '牛奶').code).toBe('TOO_LONG');
    expect(validatePublicSpeech('一。二。三。', '牛奶').code).toBe('TOO_MANY_SENTENCES');
  });

  it('规范化大小写、空格、标点后拦截完整原词', () => {
    expect(normalizeForWordLeak('Ｍ I-L K')).toBe('milk');
    expect(validatePublicSpeech('它像 M-I L K 一样', 'milk').code).toBe('WORD_LEAK');
    expect(validatePublicSpeech('冰 淇-淋 很凉', '冰淇淋').code).toBe('WORD_LEAK');
  });

  it('不处罚同音和隐喻', () => {
    expect(validatePublicSpeech('喝起来像奶制饮品', '牛奶')).toEqual({ valid: true });
  });
});
