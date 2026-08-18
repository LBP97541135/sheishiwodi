import { describe, expect, it } from 'vitest';

import { resolveAgentProvider, type RoleModelSelectionSource } from './provider-runtime.js';

const source = (selections: Record<string, string>): RoleModelSelectionSource => ({
  listSelections: () => ({ ...selections }),
});

describe('resolveAgentProvider', () => {
  it('通用中转站不继承内置 model，三角色和评测 model 必须全部显式配置', () => {
    const selections: Record<string, string> = {};
    const runtime = resolveAgentProvider(source(selections), 'normal', {
      AGENT_PROVIDER: 'openai-compatible',
      OPENAI_COMPATIBLE_BASE_URL: 'https://gateway.example/v1',
      OPENAI_COMPATIBLE_API_KEY: 'secret',
    });

    expect(runtime.modelProvider).toMatchObject({
      mode: 'openai-compatible',
      configured: true,
      useBuiltInRoleDefaults: false,
      reviewModelConfigured: false,
    });
    expect(runtime.areRequiredModelsConfigured()).toBe(false);

    selections['deepseek'] = 'vendor/model-a';
    selections['doubao'] = 'vendor/model-b';
    selections['qwen'] = 'vendor/model-c';
    // 三个参赛模型已配齐，但评测模型仍未显式配置。
    expect(runtime.areRequiredModelsConfigured()).toBe(false);
  });

  it('通用中转站在三角色和评测 model 都显式配置后才允许开始', () => {
    const selections = {
      deepseek: 'vendor/model-a',
      doubao: 'vendor/model-b',
      qwen: 'vendor/model-c',
    };
    const runtime = resolveAgentProvider(source(selections), 'normal', {
      AGENT_PROVIDER: 'openai-compatible',
      OPENAI_COMPATIBLE_BASE_URL: 'https://gateway.example/v1',
      OPENAI_COMPATIBLE_API_KEY: 'secret',
      OPENAI_COMPATIBLE_REVIEW_MODEL: 'vendor/review-model',
    });

    expect(runtime.modelProvider.reviewModelConfigured).toBe(true);
    expect(runtime.areRequiredModelsConfigured()).toBe(true);
  });

  it('Tokendance 保持现有内置角色与评测模型回退兼容', () => {
    const runtime = resolveAgentProvider(source({}), 'normal', {
      AGENT_PROVIDER: 'tokendance',
      TOKENDANCE_BASE_URL: 'https://tokendance.example/v1',
      TOKENDANCE_API_KEY: 'secret',
    });

    expect(runtime.modelProvider).toMatchObject({
      mode: 'tokendance',
      configured: true,
      useBuiltInRoleDefaults: true,
      reviewModelConfigured: true,
    });
    expect(runtime.areRequiredModelsConfigured()).toBe(true);
  });

  it('通用中转站凭据不完整时保持假模型且不发起半配置调用', () => {
    const runtime = resolveAgentProvider(source({}), 'normal', {
      AGENT_PROVIDER: 'openai-compatible',
      OPENAI_COMPATIBLE_BASE_URL: 'https://gateway.example/v1',
    });

    expect(runtime.modelProvider).toMatchObject({
      mode: 'openai-compatible',
      configured: false,
      client: null,
      useBuiltInRoleDefaults: false,
    });
  });
});
