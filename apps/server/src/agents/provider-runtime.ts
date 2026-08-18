import { agentRoleIds, findAgentRole } from '@sheishiwodi/shared';

import type { AgentPolicy } from './agent-policy.js';
import { FakeAgentPolicy, type FakeAgentScenario } from './fake-agent-policy.js';
import { FakeReviewPolicy } from './fake-review-policy.js';
import type { ModelProviderContext } from './model-profile-service.js';
import type { ReviewPolicy } from './review-policy.js';
import { TokendanceReviewPolicy } from './review-agent-policy.js';
import { TokendanceAgentPolicy } from './tokendance-agent-policy.js';
import { TokendanceClient } from './tokendance-client.js';

export interface RoleModelSelectionSource {
  listSelections(): Record<string, string>;
}

export interface ResolvedAgentProvider {
  agentPolicyFactory: () => AgentPolicy;
  reviewPolicyFactory: () => ReviewPolicy;
  modelProvider: ModelProviderContext;
  /** 开始真实对局前动态检查，允许用户在服务启动后通过模型档案补齐角色 model ID。 */
  areRequiredModelsConfigured: () => boolean;
}

type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Provider 解析只依赖 env 与 model 选择源，不读取数据库实体或游戏状态。
 * `openai-compatible` 复用 Chat Completions 协议，但不继承任何项目内置 model ID。
 */
export function resolveAgentProvider(
  roleModels: RoleModelSelectionSource,
  fakeScenario: FakeAgentScenario,
  env: ProviderEnvironment = process.env,
): ResolvedAgentProvider {
  const provider = (env['AGENT_PROVIDER'] ?? 'fake').trim();
  if (provider === 'tokendance') {
    return resolveTokendance(roleModels, fakeScenario, env);
  }
  if (provider === 'openai-compatible') {
    return resolveOpenAiCompatible(roleModels, fakeScenario, env);
  }
  return fakeProvider(fakeScenario, 'fake', true, true);
}

function resolveTokendance(
  roleModels: RoleModelSelectionSource,
  fakeScenario: FakeAgentScenario,
  env: ProviderEnvironment,
): ResolvedAgentProvider {
  const baseUrl = valueOf(env, 'TOKENDANCE_BASE_URL');
  const apiKey = valueOf(env, 'TOKENDANCE_API_KEY');
  const defaultModel = valueOf(env, 'TOKENDANCE_DEFAULT_MODEL');
  const reviewModel =
    valueOf(env, 'TOKENDANCE_REVIEW_MODEL') || defaultModel || 'deepseek-v4-flash';
  if (!baseUrl || !apiKey) {
    return fakeProvider(fakeScenario, 'tokendance', true, Boolean(reviewModel));
  }

  const client = new TokendanceClient({
    baseUrl,
    apiKey,
    timeoutMs: readPositiveInt(env, 'TOKENDANCE_TIMEOUT_MS', 60_000),
    defaultBody: readJsonObject(env, 'TOKENDANCE_EXTRA_BODY'),
  });
  const buildRoleModelMap = () => {
    const selections = roleModels.listSelections();
    return Object.fromEntries(
      agentRoleIds.flatMap((roleId) => {
        const modelId =
          selections[roleId] ?? findAgentRole(roleId)?.defaultModelId ?? defaultModel;
        return modelId ? [[roleId, modelId]] : [];
      }),
    );
  };

  return realProvider({
    mode: 'tokendance',
    client,
    buildRoleModelMap,
    reviewModel,
    useBuiltInRoleDefaults: true,
    reasoningHints: true,
    maxRetries: readPositiveInt(env, 'TOKENDANCE_MAX_RETRIES', 2),
    retryDelayMs: readPositiveInt(env, 'TOKENDANCE_RETRY_DELAY_MS', 800),
    debug: valueOf(env, 'AGENT_DEBUG_TIMING') === '1',
    areRequiredModelsConfigured: () => true,
  });
}

function resolveOpenAiCompatible(
  roleModels: RoleModelSelectionSource,
  fakeScenario: FakeAgentScenario,
  env: ProviderEnvironment,
): ResolvedAgentProvider {
  const baseUrl = valueOf(env, 'OPENAI_COMPATIBLE_BASE_URL');
  const apiKey = valueOf(env, 'OPENAI_COMPATIBLE_API_KEY');
  const reviewModel = valueOf(env, 'OPENAI_COMPATIBLE_REVIEW_MODEL');
  if (!baseUrl || !apiKey) {
    return fakeProvider(fakeScenario, 'openai-compatible', false, Boolean(reviewModel));
  }

  const client = new TokendanceClient({
    baseUrl,
    apiKey,
    timeoutMs: readPositiveInt(env, 'OPENAI_COMPATIBLE_TIMEOUT_MS', 60_000),
    defaultBody: readJsonObject(env, 'OPENAI_COMPATIBLE_EXTRA_BODY'),
  });
  const buildRoleModelMap = () => ({ ...roleModels.listSelections() });
  const areRequiredModelsConfigured = () => {
    const selections = roleModels.listSelections();
    const rolesReady = agentRoleIds.every((roleId) => Boolean(selections[roleId]?.trim()));
    return rolesReady && reviewModel.length > 0;
  };

  return realProvider({
    mode: 'openai-compatible',
    client,
    buildRoleModelMap,
    reviewModel,
    useBuiltInRoleDefaults: false,
    reasoningHints: false,
    maxRetries: readPositiveInt(env, 'OPENAI_COMPATIBLE_MAX_RETRIES', 2),
    retryDelayMs: readPositiveInt(env, 'OPENAI_COMPATIBLE_RETRY_DELAY_MS', 800),
    debug: valueOf(env, 'AGENT_DEBUG_TIMING') === '1',
    areRequiredModelsConfigured,
  });
}

function realProvider(options: {
  mode: 'tokendance' | 'openai-compatible';
  client: TokendanceClient;
  buildRoleModelMap: () => Record<string, string>;
  reviewModel: string;
  useBuiltInRoleDefaults: boolean;
  reasoningHints: boolean;
  maxRetries: number;
  retryDelayMs: number;
  debug: boolean;
  areRequiredModelsConfigured: () => boolean;
}): ResolvedAgentProvider {
  return {
    agentPolicyFactory: () =>
      new TokendanceAgentPolicy({
        client: options.client,
        roleModelMap: options.buildRoleModelMap(),
        maxSystemRetries: options.maxRetries,
        retryDelayMs: options.retryDelayMs,
        debug: options.debug,
        reasoningHints: options.reasoningHints,
      }),
    reviewPolicyFactory: () =>
      new TokendanceReviewPolicy({
        client: options.client,
        modelId: options.reviewModel,
        maxSystemRetries: options.maxRetries,
        retryDelayMs: options.retryDelayMs,
        reasoningHints: options.reasoningHints,
      }),
    modelProvider: {
      mode: options.mode,
      configured: true,
      client: options.client,
      useBuiltInRoleDefaults: options.useBuiltInRoleDefaults,
      reviewModelConfigured: options.reviewModel.length > 0,
    },
    areRequiredModelsConfigured: options.areRequiredModelsConfigured,
  };
}

function fakeProvider(
  fakeScenario: FakeAgentScenario,
  mode: 'fake' | 'tokendance' | 'openai-compatible',
  useBuiltInRoleDefaults: boolean,
  reviewModelConfigured: boolean,
): ResolvedAgentProvider {
  return {
    agentPolicyFactory: () => new FakeAgentPolicy(fakeScenario),
    reviewPolicyFactory: () => new FakeReviewPolicy(),
    modelProvider: {
      mode,
      configured: false,
      client: null,
      useBuiltInRoleDefaults,
      reviewModelConfigured,
    },
    areRequiredModelsConfigured: () => true,
  };
}

function valueOf(env: ProviderEnvironment, name: string): string {
  return (env[name] ?? '').trim();
}

function readPositiveInt(env: ProviderEnvironment, name: string, fallback: number): number {
  const raw = valueOf(env, name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readJsonObject(
  env: ProviderEnvironment,
  name: string,
): Record<string, unknown> {
  const raw = valueOf(env, name);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
