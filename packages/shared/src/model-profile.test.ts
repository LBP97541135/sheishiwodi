import { describe, expect, it } from 'vitest';

import { modelProfileListSchema, providerModeSchema } from './model-profile.js';

describe('model profile contracts', () => {
  it('接受通用 OpenAI 兼容 provider', () => {
    expect(providerModeSchema.parse('openai-compatible')).toBe('openai-compatible');
  });

  it('模型档案必须明确公开评测 model 是否已配置', () => {
    const result = modelProfileListSchema.safeParse({
      providerMode: 'openai-compatible',
      providerConfigured: true,
      editable: true,
      profiles: [],
    });

    expect(result.success).toBe(false);
  });
});
