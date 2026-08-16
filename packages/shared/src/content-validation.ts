export type ContentValidationCode = 'TOO_SHORT' | 'TOO_LONG' | 'TOO_MANY_SENTENCES' | 'WORD_LEAK';

export interface ContentValidationResult {
  valid: boolean;
  code?: ContentValidationCode;
}

export function normalizeForWordLeak(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]/gu, '');
}

export function validatePublicSpeech(text: string, ownWordCard: string): ContentValidationResult {
  const trimmed = text.trim();
  const length = Array.from(trimmed).length;
  if (length < 2) return { valid: false, code: 'TOO_SHORT' };
  if (length > 40) return { valid: false, code: 'TOO_LONG' };

  const sentenceCount = trimmed
    .split(/[。！？!?]+/u)
    .map((part) => part.trim())
    .filter(Boolean).length;
  if (sentenceCount > 2) return { valid: false, code: 'TOO_MANY_SENTENCES' };

  const normalizedWord = normalizeForWordLeak(ownWordCard);
  if (normalizedWord && normalizeForWordLeak(trimmed).includes(normalizedWord)) {
    return { valid: false, code: 'WORD_LEAK' };
  }
  return { valid: true };
}
