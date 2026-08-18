// 真实模型验收冒烟：仅在显式配置真实 provider + Key 时运行。
// 硬边界：缺 env 一律显式失败退出，绝不静默改用假模型；
// 输出脱敏——不打印 Base URL、API Key、请求头或完整模型响应。
// 该脚本只被 `pnpm test:live` 调用，绝不进入 dev/build/test/test:e2e。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 极简 .env 读取：仅补齐进程未设置的键，不覆盖既有环境变量。 */
function loadDotEnv() {
  let raw;
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

function fail(message) {
  console.error(`[test:live] 失败：${message}`);
  process.exit(1);
}

loadDotEnv();

const provider = (process.env.AGENT_PROVIDER ?? 'fake').trim();
if (provider !== 'tokendance' && provider !== 'openai-compatible') {
  fail(`AGENT_PROVIDER 需为 "tokendance" 或 "openai-compatible"（当前 "${provider}"）。真实验收绝不静默走假模型。`);
}

function readJsonObject(name) {
  const raw = (process.env[name] ?? '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
const prefix = provider === 'tokendance' ? 'TOKENDANCE' : 'OPENAI_COMPATIBLE';
const baseUrl = (process.env[`${prefix}_BASE_URL`] ?? '').trim();
const apiKey = (process.env[`${prefix}_API_KEY`] ?? '').trim();
const smokeModel = (
  process.env[`${prefix}_SMOKE_MODEL`] ??
  (provider === 'tokendance' ? process.env.TOKENDANCE_DEFAULT_MODEL : '') ??
  ''
).trim();
const defaultBody = readJsonObject(`${prefix}_EXTRA_BODY`);
const modelExtraBodies =
  provider === 'openai-compatible'
    ? readJsonObject('OPENAI_COMPATIBLE_MODEL_EXTRA_BODY')
    : {};
const modelExtraBody =
  Object.prototype.hasOwnProperty.call(modelExtraBodies, smokeModel) &&
  modelExtraBodies[smokeModel] &&
  typeof modelExtraBodies[smokeModel] === 'object' &&
  !Array.isArray(modelExtraBodies[smokeModel])
    ? modelExtraBodies[smokeModel]
    : {};

if (!baseUrl) fail(`缺少 ${prefix}_BASE_URL。`);
if (!apiKey) fail(`缺少 ${prefix}_API_KEY（请在 gitignored 的 .env 中自行填写）。`);
if (provider === 'openai-compatible' && !smokeModel) {
  fail('缺少 OPENAI_COMPATIBLE_SMOKE_MODEL；通用中转站不设置默认 model。');
}

const authHeaders = {
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
};

async function withTimeout(run, ms, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (error?.name === 'AbortError') fail(`${label} 超时（${ms}ms）。`);
    // 只上报错误类别，不回显含 URL/Key 的底层信息。
    fail(`${label} 网络调用异常（${error?.name ?? 'Error'}）。`);
  } finally {
    clearTimeout(timer);
  }
}

console.log(`[test:live] 已配置 ${provider} provider，开始真实冒烟（输出已脱敏）。`);

// Tokendance 保持原有目录验收；通用中转站允许没有 /models，直接使用显式 smoke model。
const models = provider === 'tokendance'
  ? await withTimeout(
      async (signal) => {
        const response = await fetch(`${baseUrl}/models`, { headers: authHeaders, signal });
        if (!response.ok) fail(`GET /models 返回状态 ${response.status}。`);
        const body = await response.json();
        return Array.isArray(body?.data) ? body.data.map((item) => item?.id).filter(Boolean) : [];
      },
      20_000,
      'GET /models',
    )
  : [];
if (provider === 'tokendance') {
  if (models.length === 0) fail('/models 目录为空，无法选择 model。');
  console.log(`[test:live] 模型目录可用：${models.length} 个 model。`);
} else {
  console.log('[test:live] 通用 provider 使用显式 smoke model，不要求 /models。');
}

const chatModel = smokeModel || models[0];
console.log(`[test:live] 冒烟使用 model：${chatModel}`);

// 2. 最小 chat completion
const content = await withTimeout(
  async (signal) => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        ...defaultBody,
        ...modelExtraBody,
        model: chatModel,
        messages: [{ role: 'user', content: '只回复两个字：收到' }],
      }),
      signal,
    });
    if (!response.ok) fail(`POST /chat/completions 返回状态 ${response.status}。`);
    const body = await response.json();
    return body?.choices?.[0]?.message?.content ?? '';
  },
  30_000,
  'POST /chat/completions',
);
if (typeof content !== 'string' || content.trim().length === 0) {
  fail('chat completion 未返回文本内容。');
}
console.log(`[test:live] chat 冒烟成功：返回 ${content.trim().length} 字符。`);
console.log('[test:live] 通过。真实模型接入冒烟完成（未泄露 Base URL / API Key / 请求头 / 完整响应）。');
