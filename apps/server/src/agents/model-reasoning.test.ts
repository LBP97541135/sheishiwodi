import { describe, expect, it } from 'vitest';

import { reasoningDisableBodyFor } from './model-reasoning.js';

describe('reasoningDisableBodyFor', () => {
  it('千问家族用 enable_thinking:false', () => {
    expect(reasoningDisableBodyFor('qwen3.7-plus')).toEqual({ enable_thinking: false });
    expect(reasoningDisableBodyFor('Qwen-Max')).toEqual({ enable_thinking: false });
  });

  it('豆包/火山方舟(seed 与 doubao)用 thinking.type=disabled', () => {
    expect(reasoningDisableBodyFor('seed-2.1-turbo')).toEqual({ thinking: { type: 'disabled' } });
    expect(reasoningDisableBodyFor('doubao-pro-32k')).toEqual({ thinking: { type: 'disabled' } });
  });

  it('DeepSeek 用 thinking.type=disabled（enable_thinking 会被忽略）', () => {
    expect(reasoningDisableBodyFor('deepseek-v4-flash-0731')).toEqual({
      thinking: { type: 'disabled' },
    });
  });

  it('大小写与首尾空白不影响匹配', () => {
    expect(reasoningDisableBodyFor('  DeepSeek-Chat ')).toEqual({ thinking: { type: 'disabled' } });
  });

  it('其他模型不附加任何参数（行为不变）', () => {
    expect(reasoningDisableBodyFor('gpt-4o-mini')).toEqual({});
    expect(reasoningDisableBodyFor('claude-3-5-sonnet')).toEqual({});
    expect(reasoningDisableBodyFor('')).toEqual({});
  });
});
