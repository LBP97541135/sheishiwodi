import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * 极简 .env 加载器（不引入第三方依赖，避免联网安装）。
 * 从起始目录向上逐级查找 `.env`，把未设置的 KEY 写入 process.env。
 * 已存在的环境变量优先，绝不覆盖；文件缺失时静默返回。
 * 注意：真实 API Key 只应写入被 gitignore 的 `.env`，绝不进入仓库或日志。
 */
export function loadDotEnv(startDir: string = process.cwd()): void {
  const filePath = findEnvFile(startDir);
  if (!filePath) return;

  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function findEnvFile(startDir: string): string | null {
  let current = resolve(startDir);
  for (;;) {
    const candidate = resolve(current, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
