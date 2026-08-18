// 联机验收环境门禁：支持 Tokendance 与通用 OpenAI 兼容 provider。
// 缺任一必填项抛 LiveGateError，由编排器据此以退出码 1 显式失败，绝不静默改用假模型。
// 本模块只把 Key/URL 读入内存供真实客户端使用，绝不写入日志、报告、数据库或对外投影。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 极简 .env 读取：仅补齐进程未设置的键，不覆盖既有环境变量。对齐 tests/live/run.mjs:9-32。 */
export function loadDotEnv(): void {
  let raw: string;
  try {
    raw = readFileSync(resolve('.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

/** 门禁失败：脱敏消息，编排器捕获后以退出码 1 结束。 */
export class LiveGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveGateError';
  }
}

export interface LiveConfig {
  provider: 'tokendance' | 'openai-compatible';
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  roleModels: Record<string, string>;
  reviewModel: string;
  reasoningHints: boolean;
  timeoutMs: number;
  extraBody: Record<string, unknown>;
  maxRetries: number;
  retryDelayMs: number;
  samples: number;
  fullGame: boolean;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? '').trim();
  if (raw.length === 0) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readJsonObject(name: string): Record<string, unknown> {
  const raw = (process.env[name] ?? '').trim();
  if (raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * 解析并强校验联机配置。缺任一必填项抛 LiveGateError。
 * 通用 provider 没有任何 model 回退：策略验收要求三角色 model，复盘验收要求 review model。
 */
export function resolveLiveConfig(overrides?: {
  fullGame?: boolean;
  scope?: 'policy' | 'review';
}): LiveConfig {
  loadDotEnv();
  const provider = (process.env['AGENT_PROVIDER'] ?? 'fake').trim();
  if (provider !== 'tokendance' && provider !== 'openai-compatible') {
    throw new LiveGateError(
      `AGENT_PROVIDER 需为 "tokendance" 或 "openai-compatible"（当前 "${provider}"）。真实验收绝不静默走假模型。`,
    );
  }
  const prefix = provider === 'tokendance' ? 'TOKENDANCE' : 'OPENAI_COMPATIBLE';
  const baseUrl = (process.env[`${prefix}_BASE_URL`] ?? '').trim();
  const apiKey = (process.env[`${prefix}_API_KEY`] ?? '').trim();
  if (!baseUrl) throw new LiveGateError(`缺少 ${prefix}_BASE_URL。`);
  if (!apiKey) {
    throw new LiveGateError(`缺少 ${prefix}_API_KEY（请在 gitignored 的 .env 中自行填写）。`);
  }

  const roleModels: Record<string, string> =
    provider === 'openai-compatible'
      ? {
          deepseek: (process.env['OPENAI_COMPATIBLE_DEEPSEEK_MODEL'] ?? '').trim(),
          doubao: (process.env['OPENAI_COMPATIBLE_DOUBAO_MODEL'] ?? '').trim(),
          qwen: (process.env['OPENAI_COMPATIBLE_QWEN_MODEL'] ?? '').trim(),
        }
      : {};
  const reviewModel =
    provider === 'openai-compatible'
      ? (process.env['OPENAI_COMPATIBLE_REVIEW_MODEL'] ?? '').trim()
      : (process.env['TOKENDANCE_REVIEW_MODEL'] ?? '').trim() ||
        (process.env['TOKENDANCE_DEFAULT_MODEL'] ?? '').trim() ||
        'deepseek-v4-flash';
  if (provider === 'openai-compatible' && (overrides?.scope ?? 'policy') === 'policy') {
    const missingRoles = Object.entries(roleModels)
      .filter(([, modelId]) => !modelId)
      .map(([roleId]) => roleId);
    if (missingRoles.length > 0) {
      throw new LiveGateError(`通用中转站缺少角色 model：${missingRoles.join('、')}。`);
    }
  }
  if (provider === 'openai-compatible' && overrides?.scope === 'review' && !reviewModel) {
    throw new LiveGateError('缺少 OPENAI_COMPATIBLE_REVIEW_MODEL。');
  }

  const envFull = (process.env['LIVE_FULL_GAME'] ?? '').trim() === '1';
  return {
    provider,
    baseUrl,
    apiKey,
    defaultModel:
      provider === 'tokendance' ? (process.env['TOKENDANCE_DEFAULT_MODEL'] ?? '').trim() : '',
    roleModels,
    reviewModel,
    reasoningHints: provider === 'tokendance',
    timeoutMs: readPositiveInt(`${prefix}_TIMEOUT_MS`, 60_000),
    extraBody: readJsonObject(`${prefix}_EXTRA_BODY`),
    maxRetries: readPositiveInt(`${prefix}_MAX_RETRIES`, 2),
    retryDelayMs: readPositiveInt(`${prefix}_RETRY_DELAY_MS`, 800),
    samples: readPositiveInt('LIVE_SAMPLES', 1),
    fullGame: overrides?.fullGame ?? envFull,
  };
}
