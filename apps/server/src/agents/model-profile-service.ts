import {
  agentRoles,
  findAgentRole,
  type AvailableModelList,
  type Clock,
  type ModelProfile,
  type ModelProfileList,
  type ProviderMode,
} from '@sheishiwodi/shared';

import type { AgentRoleModelRepository } from '../db/agent-role-model-repository.js';
import type { TokendanceClient } from './tokendance-client.js';

export type ModelProfileErrorCode = 'ACTIVE_GAME_LOCKED' | 'ROLE_NOT_FOUND' | 'PROVIDER_UNAVAILABLE';

export class ModelProfileError extends Error {
  constructor(readonly code: ModelProfileErrorCode) {
    super(code);
    this.name = 'ModelProfileError';
  }
}

export interface ModelProviderContext {
  mode: ProviderMode;
  configured: boolean;
  client: TokendanceClient | null;
}

/** 判定当前是否存在锁定配置修改的活动局（进行中 / 待观战确认）。 */
export interface ConfigLockSource {
  isGameLockedForConfig(): boolean;
}

/**
 * 模型档案服务：对外只暴露角色静态信息与已选 model ID，以及 provider 模式/是否配置。
 * 永不返回、记录 Base URL、API Key、请求头或完整模型响应。
 */
export class ModelProfileService {
  constructor(
    private readonly repository: AgentRoleModelRepository,
    private readonly provider: ModelProviderContext,
    private readonly lock: ConfigLockSource,
    private readonly clock: Clock,
  ) {}

  listProfiles(): ModelProfileList {
    const selections = this.repository.listSelections();
    return {
      providerMode: this.provider.mode,
      providerConfigured: this.provider.configured,
      editable: !this.lock.isGameLockedForConfig(),
      profiles: agentRoles.map((role) => ({
        roleId: role.roleId,
        displayName: role.displayName,
        personalityTags: [...role.personalityTags],
        personalityPrompt: role.personalityPrompt,
        // 未显式保存时回退角色默认 model ID，界面不再显示“未配置”。
        selectedModelId: selections[role.roleId] ?? role.defaultModelId ?? null,
      })),
    };
  }

  async listModels(): Promise<AvailableModelList> {
    if (!this.provider.configured || !this.provider.client) {
      return { providerMode: this.provider.mode, models: [] };
    }
    const models = await this.provider.client.listModels();
    return { providerMode: this.provider.mode, models };
  }

  updateSelection(roleId: string, modelId: string): ModelProfile {
    if (this.lock.isGameLockedForConfig()) {
      throw new ModelProfileError('ACTIVE_GAME_LOCKED');
    }
    const role = findAgentRole(roleId);
    if (!role) {
      throw new ModelProfileError('ROLE_NOT_FOUND');
    }
    this.repository.setSelection(roleId, modelId, this.clock.now());
    return {
      roleId: role.roleId,
      displayName: role.displayName,
      personalityTags: [...role.personalityTags],
      personalityPrompt: role.personalityPrompt,
      selectedModelId: modelId,
    };
  }
}
