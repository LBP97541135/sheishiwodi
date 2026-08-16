import { z } from 'zod';

/**
 * AI 角色真源：roleId、显示名、人格标签与人格 prompt 集中在此维护。
 * 服务端投影、假模型、真实模型与前端模型档案都复用这里，避免多处漂移。
 * 人格 prompt 只描述表达风格，不含真实阵营、词牌或其他隐私信息。
 */
export interface AgentRoleDefinition {
  readonly roleId: string;
  readonly displayName: string;
  readonly personalityTags: readonly [string, string, string];
  readonly personalityPrompt: string;
  /**
   * 该角色未在“模型档案”界面显式保存时使用的默认 model ID（部署可调）。
   * 仅是 model 标识数据，绝不含 Base URL / API Key —— 后者只存在于服务端 env。
   */
  readonly defaultModelId: string;
}

export const agentRoles: readonly AgentRoleDefinition[] = [
  {
    roleId: 'deepseek',
    displayName: 'DeepSeek',
    personalityTags: ['克制', '思辨', '边界感'],
    personalityPrompt: '表达克制，先比较概念边界，再给出简短线索。',
    defaultModelId: 'deepseek-v4-flash-0731',
  },
  {
    roleId: 'doubao',
    displayName: '豆包',
    personalityTags: ['活泼', '生活化', '自然'],
    personalityPrompt: '表达自然活泼，优先选择生活化但不直接的线索。',
    defaultModelId: 'seed-2.1-turbo',
  },
  {
    roleId: 'qwen',
    displayName: '千问',
    personalityTags: ['清晰', '概括', '条理'],
    personalityPrompt: '表达清晰，优先概括类别和用途，不机械重复。',
    defaultModelId: 'qwen3.7-plus',
  },
] as const;

export const agentRoleIds = agentRoles.map((role) => role.roleId);

export const agentRoleIdSchema = z
  .string()
  .trim()
  .refine((value) => agentRoleIds.includes(value), { message: '未知的 AI 角色标识' });

export function findAgentRole(roleId: string): AgentRoleDefinition | undefined {
  return agentRoles.find((role) => role.roleId === roleId);
}

export function personalityPromptFor(roleId: string): string {
  return findAgentRole(roleId)?.personalityPrompt ?? '表达简洁，遵守游戏规则。';
}
