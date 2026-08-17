// 脱敏 Markdown 验收报告生成。只写入计数 / 长度 / 布尔 / 错误码 / 耗时(ms) / 重试数 / model ID / role / action，
// 绝不写入 Base URL、API Key、请求头、完整模型响应、词牌明文、信念原文或违规原文。
// 落盘前做纵深防御自检：渲染文本若命中任一禁用串则中止不写并抛错（编排器据此非零退出）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface PolicyRecord {
  role: string;
  model: string;
  action: string;
  schemaPass: boolean;
  beliefPass: boolean;
  targetLegal: boolean | null;
  elapsedMs: number | null;
  retries: number | null;
  repairUsed: boolean | null;
  /** 行动者自己的词牌是否出现在公开发言文本中（WARN：内容闸在服务端，此处仅记录）。 */
  ownWordWarn: boolean;
}

export interface IsolationRecord {
  channel: string;
  category: string;
  pass: boolean;
}

export interface ErrorRecord {
  role: string;
  action: string;
  /** 脱敏错误码，形如 AGENT_SYSTEM_* / TOKENDANCE_*，绝不含 Key/URL/响应正文。 */
  code: string;
}

export interface FullGameRecord {
  /** server=经 HTTP+SQLite 整栈；pure=直驱 shared 纯状态机（本机原生依赖不可用时的等价路径）。 */
  mode: 'server' | 'pure';
  status: string;
  winnerCamp: string | null;
  endReason: string | null;
  rounds: number;
  frames: number;
  agentCalls: number;
  humanActions: number;
  contentRejections: number;
  /** 公开时间线出现任一词牌明文（模型自发提及）——记为 WARN，不作硬失败。 */
  wordMentionWarn: boolean;
  totalMs: number;
  /** credentials/camp/beliefInternals 三类硬隔离是否全过。 */
  isolationPass: boolean;
}

export interface ReportMeta {
  generatedAt: string;
  provider: string;
  roleModels: Record<string, string>;
  nodeVersion: string;
}

export interface ReportData {
  meta: ReportMeta;
  policy: PolicyRecord[];
  isolation: IsolationRecord[];
  errors: ErrorRecord[];
  fullGame: FullGameRecord | null;
}

/** 报告落盘前命中敏感串，中止不写。 */
export class ReportLeakError extends Error {
  constructor(readonly category: string) {
    super(`REPORT_LEAK_${category}`);
    this.name = 'ReportLeakError';
  }
}

const cell = (value: string | number | boolean | null): string => {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? '✅' : '❌';
  return String(value);
};

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)));
  return sorted[index] ?? null;
}

export function renderMarkdown(data: ReportData): string {
  const { meta, policy, isolation, errors, fullGame } = data;
  const lines: string[] = [];

  lines.push('# 真实模型分层验收报告（TASK-057）', '');
  lines.push('> 本报告已脱敏：只含 role / action / model ID / 结构校验 / 隔离类别 / 耗时(ms) / 重试数 / 布尔。');
  lines.push('> 绝不含 Base URL、API Key、请求头、完整模型响应、词牌明文或信念原文。', '');

  lines.push('## 1. 元信息', '');
  lines.push('| 项 | 值 |', '| --- | --- |');
  lines.push(`| 生成时间 | ${meta.generatedAt} |`);
  lines.push(`| provider | ${meta.provider} |`);
  lines.push(`| Node 版本 | ${meta.nodeVersion} |`);
  for (const [role, model] of Object.entries(meta.roleModels)) {
    lines.push(`| 角色 ${role} 使用 model | ${model} |`);
  }
  lines.push('');

  lines.push('## 2. 结构化输出校验', '');
  lines.push(
    '| role | action | schemaPass | beliefPass | targetLegal | elapsedMs | retries | repairUsed | ownWordWarn |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const record of policy) {
    lines.push(
      `| ${record.role} | ${record.action} | ${cell(record.schemaPass)} | ${cell(record.beliefPass)} | ` +
        `${cell(record.targetLegal)} | ${cell(record.elapsedMs)} | ${cell(record.retries)} | ` +
        `${cell(record.repairUsed)} | ${cell(record.ownWordWarn)} |`,
    );
  }
  lines.push('');

  lines.push('## 3. 信息隔离（负向矩阵）', '');
  lines.push('| channel | category | pass |', '| --- | --- | --- |');
  for (const record of isolation) {
    lines.push(`| ${record.channel} | ${record.category} | ${cell(record.pass)} |`);
  }
  lines.push('');

  lines.push('## 4. 完整对局（可选）', '');
  if (fullGame) {
    const modeNote =
      fullGame.mode === 'pure'
        ? '直驱 `@sheishiwodi/shared` 纯状态机 + 真实多模型策略（与服务端同一套 reducer 与内容校验）；'
        + '本机 `better-sqlite3` 原生编译不可用，故未经 HTTP/SQLite 持久层，但博弈逻辑与信息隔离完全等价。'
        : '经服务端 HTTP + SQLite 整栈驱动（`buildServer` + `createTestEnvironment`）。';
    lines.push(`> 运行模式：${modeNote}`, '');
    lines.push('| 指标 | 值 |', '| --- | --- |');
    lines.push(`| 运行模式 | ${fullGame.mode} |`);
    lines.push(`| 终局状态 | ${fullGame.status} |`);
    lines.push(`| 胜方阵营 | ${fullGame.winnerCamp ?? '—'} |`);
    lines.push(`| 终局原因 | ${fullGame.endReason ?? '—'} |`);
    lines.push(`| 完成轮数 | ${fullGame.rounds} |`);
    lines.push(`| 公开帧数 | ${fullGame.frames} |`);
    lines.push(`| AI 真实调用数 | ${fullGame.agentCalls} |`);
    lines.push(`| 模拟真人行动数 | ${fullGame.humanActions} |`);
    lines.push(`| 内容被拒次数 | ${fullGame.contentRejections} |`);
    lines.push(`| 词牌提及 WARN | ${cell(fullGame.wordMentionWarn)} |`);
    lines.push(`| 总耗时 (ms) | ${fullGame.totalMs} |`);
    lines.push(`| 硬隔离全过 | ${cell(fullGame.isolationPass)} |`);
  } else {
    lines.push('未启用（设置 `LIVE_FULL_GAME=1` 或运行 `pnpm test:live:full` 以驱动真实整局）。');
  }
  lines.push('');

  const elapsedValues = policy
    .map((record) => record.elapsedMs)
    .filter((value): value is number => value !== null);
  const warnCount = policy.filter((record) => record.ownWordWarn).length;
  const isolationFail = isolation.filter((record) => !record.pass).length;

  lines.push('## 5. 摘要', '');
  lines.push('| 指标 | 值 |', '| --- | --- |');
  lines.push(`| 策略级真实调用数 | ${policy.length} |`);
  lines.push(`| 系统级失败数 | ${errors.length} |`);
  lines.push(`| 隔离未通过项 | ${isolationFail} |`);
  lines.push(`| 公开文本 WARN 数 | ${warnCount} |`);
  lines.push(`| 耗时 p50 (ms) | ${percentile(elapsedValues, 0.5) ?? '—'} |`);
  lines.push(`| 耗时 max (ms) | ${elapsedValues.length > 0 ? Math.max(...elapsedValues) : '—'} |`);
  lines.push('');

  if (errors.length > 0) {
    lines.push('## 6. 系统级失败（脱敏错误码）', '');
    lines.push('| role | action | code |', '| --- | --- | --- |');
    for (const record of errors) {
      lines.push(`| ${record.role} | ${record.action} | ${record.code} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 渲染 + 落盘前自检 + 写入。forbidden 为禁用明文集合（baseUrl/apiKey/Bearer/词牌）。
 * 命中即抛 ReportLeakError 且不写文件。返回写入的绝对路径。
 */
export function writeReport(
  reportsDir: string,
  fileName: string,
  data: ReportData,
  forbidden: readonly string[],
): string {
  const markdown = renderMarkdown(data);
  for (const needle of forbidden) {
    if (needle.length > 0 && markdown.includes(needle)) {
      throw new ReportLeakError('SENSITIVE_STRING_PRESENT');
    }
  }
  mkdirSync(reportsDir, { recursive: true });
  const target = resolve(reportsDir, fileName);
  writeFileSync(target, `${markdown}\n`, 'utf8');
  return target;
}

/** 生成 live-YYYYMMDD-HHmmss 时间戳（本地时区）。 */
export function timestampStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}
