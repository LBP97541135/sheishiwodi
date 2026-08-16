import { defineConfig, devices } from '@playwright/test';

const mode = process.env['E2E_MODE'] ?? 'normal';
if (!['normal', 'spectator', 'tie'].includes(mode)) {
  throw new Error(`未知 E2E_MODE: ${mode}`);
}

const scenario = mode === 'tie' ? 'tie-then-eliminate' : 'normal';
const undercoverRandom = mode === 'normal' ? 0 : 0.76;
const randomSequence = Array.from({ length: 40 }, () => [0, undercoverRandom, 0, 0, 0])
  .flat()
  .join(',');
const runId = process.env['E2E_RUN_ID'] ?? `${process.pid}`;
const databasePath = `apps/server/.local/e2e-${mode}-${runId}.db`;
const tsxCli = 'node_modules/.pnpm/tsx@4.19.2/node_modules/tsx/dist/cli.mjs';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: `${mode}.spec.ts`,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:9001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `"${process.execPath}" ${tsxCli} apps/server/src/main.ts --database-path=${databasePath} --fake-agent-scenario=${scenario} --fake-random-sequence=${randomSequence}`,
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'corepack pnpm --filter @sheishiwodi/web dev --host 127.0.0.1',
      url: 'http://127.0.0.1:9001',
      reuseExistingServer: false,
      timeout: 60_000,
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
