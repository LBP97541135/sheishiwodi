import { describe, expect, it } from 'vitest';

import type { AgentRoleModelRepository } from '../db/agent-role-model-repository.js';
import { ModelProfileService, type ModelProviderContext } from './model-profile-service.js';

const clock = { now: () => '2026-08-18T12:00:00.000Z' };
const lock = { isGameLockedForConfig: () => false };

function repositoryFor(selections: Record<string, string>) {
  return {
    listSelections: () => ({ ...selections }),
    setSelection: (roleId: string, modelId: string) => {
      selections[roleId] = modelId;
    },
  } as unknown as AgentRoleModelRepository;
}

describe('ModelProfileService provider defaults', () => {
  it('通用中转站没有保存值时返回 null，不使用共享层内置 model ID', () => {
    const provider: ModelProviderContext = {
      mode: 'openai-compatible',
      configured: true,
      client: null,
      useBuiltInRoleDefaults: false,
      reviewModelConfigured: false,
    };
    const profiles = new ModelProfileService(repositoryFor({}), provider, lock, clock).listProfiles();

    expect(profiles.reviewModelConfigured).toBe(false);
    expect(profiles.profiles).toHaveLength(3);
    expect(profiles.profiles.every((profile) => profile.selectedModelId === null)).toBe(true);
  });

  it('Tokendance 保持共享层内置 model ID 兼容', () => {
    const provider: ModelProviderContext = {
      mode: 'tokendance',
      configured: true,
      client: null,
      useBuiltInRoleDefaults: true,
      reviewModelConfigured: true,
    };
    const profiles = new ModelProfileService(repositoryFor({}), provider, lock, clock).listProfiles();

    expect(profiles.profiles.map((profile) => profile.selectedModelId)).toEqual([
      'deepseek-v4-flash-0731',
      'seed-2.1-turbo',
      'qwen3.7-plus',
    ]);
  });
});
