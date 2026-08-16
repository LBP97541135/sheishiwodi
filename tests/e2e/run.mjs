import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const mode = process.argv[2];
if (!['normal', 'spectator', 'tie'].includes(mode)) {
  console.error('用法：node tests/e2e/run.mjs <normal|spectator|tie>');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [resolve('node_modules/@playwright/test/cli.js'), 'test'],
  {
    env: { ...process.env, E2E_MODE: mode, E2E_RUN_ID: `${process.pid}` },
    stdio: 'inherit',
  },
);

process.exit(result.status ?? 1);
