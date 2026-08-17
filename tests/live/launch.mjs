// 纯 Node 启动器：从仓库根用与 playwright.config.ts:15,30 完全相同的方式解析并启动 tsx，
// 运行 TS 编排器 tests/live/agent-live.ts，透传 policy/full 令牌与退出码。零新依赖。
// 只被 pnpm test:live* 调用，绝不进入 dev/build/test/test:e2e。

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 与 playwright.config.ts 同款硬编码 pnpm 路径优先；再退回根部 hoist 的 tsx 入口。
const candidates = [
  'node_modules/.pnpm/tsx@4.19.2/node_modules/tsx/dist/cli.mjs',
  'node_modules/tsx/dist/cli.mjs',
];
const tsxCli = candidates.map((relative) => resolve(relative)).find((absolute) => existsSync(absolute));

if (!tsxCli) {
  console.error(
    '[test:live] 未找到 tsx CLI（node_modules/.pnpm/tsx@4.19.2/...）。请先 `pnpm install`。',
  );
  process.exit(1);
}

const tokens = process.argv.slice(2); // 允许 policy / full
const result = spawnSync(
  process.execPath,
  [tsxCli, resolve('tests/live/agent-live.ts'), ...tokens],
  { stdio: 'inherit', env: process.env },
);

process.exit(result.status ?? 1);
