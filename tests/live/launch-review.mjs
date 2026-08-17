// 纯 Node 启动器：用与 launch.mjs 完全相同的方式解析并启动 tsx，运行 TS 复盘冒烟 tests/live/review-live.ts。
// 只被 pnpm test:live:review 调用，绝不进入 dev/build/test/test:e2e。零新依赖。

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const candidates = [
  'node_modules/.pnpm/tsx@4.19.2/node_modules/tsx/dist/cli.mjs',
  'node_modules/tsx/dist/cli.mjs',
];
const tsxCli = candidates.map((relative) => resolve(relative)).find((absolute) => existsSync(absolute));

if (!tsxCli) {
  console.error(
    '[test:live:review] 未找到 tsx CLI（node_modules/.pnpm/tsx@4.19.2/...）。请先 `pnpm install`。',
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [tsxCli, resolve('tests/live/review-live.ts')], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
