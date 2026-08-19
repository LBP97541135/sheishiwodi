import { defineConfig, devices } from '@playwright/test';

const mode = process.env['E2E_MODE'] ?? 'normal';
if (!['normal', 'spectator', 'tie'].includes(mode)) {
  throw new Error(`未知 E2E_MODE: ${mode}`);
}
const apiPort = readPort(process.env['E2E_API_PORT'], 3001, 'E2E_API_PORT');
const webPort = readPort(process.env['E2E_WEB_PORT'], 9001, 'E2E_WEB_PORT');

const scenario = mode === 'tie' ? 'tie-then-eliminate' : 'normal';
const undercoverRandom = mode === 'normal' ? 0 : 0.76;
const randomSequence = Array.from({ length: 40 }, () => [0, undercoverRandom, 0, 0, 0])
  .flat()
  .join(',');
const runId = process.env['E2E_RUN_ID'] ?? `${process.pid}`;
const databasePath = `apps/server/.local/e2e-${mode}-${runId}.db`;
const tsxCli = 'node_modules/.pnpm/tsx@4.19.2/node_modules/tsx/dist/cli.mjs';
const viteCli = 'apps/web/node_modules/vite/bin/vite.js';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: `${mode}.spec.ts`,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `"${process.execPath}" ${tsxCli} apps/server/src/main.ts --database-path=${databasePath} --fake-agent-scenario=${scenario} --fake-random-sequence=${randomSequence}`,
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      // 强制隔离：E2E 绝不联网、绝不读真实 Key。即便本地 .env 配了 tokendance+Key，
      // 这里预置的环境变量会被 loadDotEnv 视为“已存在”而不覆盖，服务端一律走 FakeAgentPolicy。
      env: {
        AGENT_PROVIDER: 'fake',
        TOKENDANCE_BASE_URL: '',
        TOKENDANCE_API_KEY: '',
        OPENAI_COMPATIBLE_BASE_URL: '',
        OPENAI_COMPATIBLE_API_KEY: '',
        SHEISHIWODI_API_PORT: `${apiPort}`,
      },
    },
    {
      command: `"${process.execPath}" ${viteCli} apps/web --host 127.0.0.1`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        SHEISHIWODI_WEB_PORT: `${webPort}`,
        SHEISHIWODI_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
      },
    },
  ],
  projects: [
    {
      name: `${mode}-desktop`,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: `${mode}-mobile`,
      use: { ...devices['Pixel 5'] },
    },
  ],
});

function readPort(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} 必须是 1 到 65535 之间的整数`);
  }
  return parsed;
}
