import { z } from 'zod';

import { agentRoleIdSchema } from './agent-roles.js';

/**
 * 模型档案：前端“角色/模型档案”界面展示与选择所用的公开契约。
 * 只允许下发 model ID 与角色静态展示信息；
 * Base URL、API Key、请求头与完整模型响应绝不进入此投影。
 */

export const providerModeSchema = z.enum(['fake', 'tokendance']);

export const modelProfileSchema = z
  .object({
    roleId: agentRoleIdSchema,
    displayName: z.string().trim().min(1).max(32),
    personalityTags: z.array(z.string().trim().min(1).max(16)).length(3),
    personalityPrompt: z.string().trim().min(1).max(300),
    selectedModelId: z.string().trim().min(1).max(128).nullable(),
  })
  .strict();

export const modelProfileListSchema = z
  .object({
    providerMode: providerModeSchema,
    providerConfigured: z.boolean(),
    editable: z.boolean(),
    profiles: z.array(modelProfileSchema),
  })
  .strict();

export const availableModelListSchema = z
  .object({
    providerMode: providerModeSchema,
    models: z.array(z.string().trim().min(1).max(128)),
  })
  .strict();

export const updateModelSelectionSchema = z
  .object({
    modelId: z.string().trim().min(1).max(128),
  })
  .strict();

export type ProviderMode = z.infer<typeof providerModeSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type ModelProfileList = z.infer<typeof modelProfileListSchema>;
export type AvailableModelList = z.infer<typeof availableModelListSchema>;
export type UpdateModelSelection = z.infer<typeof updateModelSelectionSchema>;
