# 交付验收证据

本页汇总适合随 GitHub 仓库提交的验证证据。它只记录命令、模型标识、计数、耗时、布尔结果和已知边界，不包含 Base URL、API Key、请求头、词牌哨兵、信念原文或完整模型响应。

## 1. 评价重点与证据定位

| 评价重点 | 可检查的实现 | 主要证据 |
| --- | --- | --- |
| 产品完整性 | 创建、准备、描述、秘密投票、统一揭票、平票辩解、重投、淘汰、观战、终局、复盘和 Markdown 导出 | `tests/e2e/`、`ReviewScreen.test.tsx`、`review-markdown.test.ts` |
| Multi-Agent 设计 | 独立 Agent 输入投影、策略接口、投票并行预取、顺序提交、独立复盘 Agent | `agent-input-projector.ts`、`game-service.ts`、`review-agent-policy.ts` |
| 信息边界 | Agent/REST/SSE/DOM 五通道字段不存在断言，终局前无阵营、他人词牌、私有信念或未揭票目标 | `agent-runtime.test.ts`、`game-stream.test.ts`、`views.test.ts`、E2E |
| 系统稳健性 | strict Schema、格式修复、内容重生成、重试分类、revision 防旧写、事务回滚、恢复、幂等、开局前配置门禁 | `tokendance-agent-policy.test.ts`、`provider-runtime.test.ts`、`game-agent-recovery.test.ts`、`game-repository.test.ts`、`game-recovery.test.ts` |
| Agent 代码理解与验证 | TASK → 规格 → 实现 → 单元/集成/E2E/浏览器 → 完成记录；默认假模型与付费真实模型验收分离 | `docs/tasks/`、`docs/spec/`、`PROJECT_LOG.md`、`tests/live/` |

以上路径均相对于仓库根目录；详细测试矩阵见 [TESTING.md](TESTING.md)。

## 2. 默认自动化与浏览器验收

2026-08-17 的完整门禁记录：

| 验证层 | 结果 | 覆盖重点 |
| --- | --- | --- |
| Shared + Server + Web Vitest | 156/156 通过 | 状态机、输入投影、结构校验、错误恢复、信息隔离、API 和前端交互 |
| Playwright E2E | 10/10 通过 | Desktop Chrome + Pixel 5；正常终局、刷新恢复、放弃、淘汰观战、平票辩解与重投 |
| TypeScript / ESLint / Build | 通过 | 三个 workspace 类型、静态检查和生产构建 |
| 可见浏览器 | 通过 | 创建对局至首轮人类描述；页面非空、无 Vite 错误遮罩、控制台无 warning/error |

这些门禁强制 `AGENT_PROVIDER=fake`，使用临时 SQLite 和确定性随机序列；不读取真实 Key、不联网、不产生模型费用。原始完成记录见 [PROJECT_LOG.md](../history/PROJECT_LOG.md) 中“统一 Agent 校验与自动恢复”。

2026-08-17 首页调整后的 Web 回归为 52/52，并通过生产构建、1280×720 可见浏览器交互与控制台检查。2026-08-17 复盘提示词调整后的纯测试为 7/7，并通过 Server typecheck/build、全仓 lint 和差异检查。

2026-08-18 通用中转站定向验证覆盖 Shared 契约、Provider 解析、模型档案服务、开局门禁、厂商推理参数关闭和 Web 手填交互：纯 Server 18/18、Shared 2/2、Web 5/5 通过，三 workspace typecheck、Server/Web build、live 脚本独立 TS 检查和全仓 lint 通过。SQLite 开局路由门禁测试已加入 `server.test.ts`；本机 Node 24 与现有 Node 22 `better-sqlite3` ABI 不匹配时不把该项冒充为本地通过。

2026-08-18 精确 model 请求参数映射补充验证：Server 17/17 通过，覆盖非法映射过滤、参赛/评测 model 精确匹配、全局与 model 专属参数优先级，以及 env 不能覆盖最终 `model/messages`；Server typecheck/build、live 脚本严格 TS 与语法检查、全仓 lint 和差异检查通过。未调用真实模型，因此只证明 harness 合并契约，不声称任意中转站都支持示例中的关闭思考字段。

## 3. 真实模型策略级验收

2026-08-17T04:30:32Z 使用 Tokendance OpenAI 兼容中转执行 3 个角色 × 2 种动作，共 6 次真实调用：

| 角色 | model ID | describe | vote | Schema / 信念 | 投票目标合法 | 重试 / 格式修复 |
| --- | --- | ---: | ---: | --- | --- | --- |
| DeepSeek | `deepseek-v4-flash-0731` | 2184 ms | 1262 ms | 通过 | 通过 | 0 / 0 |
| 豆包 | `seed-2.1-turbo` | 5846 ms | 6140 ms | 通过 | 通过 | 0 / 0 |
| 千问 | `qwen3.7-plus` | 7409 ms | 7161 ms | 通过 | 通过 | 0 / 0 |

摘要：6 次调用全部通过 strict 输出 Schema 与信念约束；3 次投票目标全部属于各自 `legalTargets`；系统级失败 0；隔离未通过项 0；公开文本警告 0；耗时 p50 为 5846 ms，最大 7409 ms。

信息隔离扫描覆盖 Agent 输入和公开输出中的 credentials、camp、belief internals 与其他词牌哨兵，全部通过。报告生成器在落盘前再次扫描 Base URL、API Key、`Bearer` 和词牌哨兵，命中任一项就拒绝写入。

## 4. 真实模型整局证据

同次验收使用与服务端相同的 `@sheishiwodi/shared` 状态机、内容校验和 3 个真实模型策略驱动一局：

| 指标 | 结果 |
| --- | --- |
| 终局状态 | `finished` |
| 终局原因 | `undercover_eliminated` |
| 完成轮数 | 1 |
| 公开帧 | 21 |
| AI 真实调用 | 6 |
| 模拟人类行动 | 2 |
| 内容拒绝 | 0 |
| 词牌提及警告 | 0 |
| 硬隔离 | 全部通过 |
| 总耗时 | 30918 ms |

这项证据证明真实模型可以在相同领域规则和隔离投影下完成一局，但运行模式是纯状态机直驱，不包含 HTTP 与 SQLite。HTTP + SQLite 的真实付费整局仍未完成，不能把本项表述成全栈真实模型 E2E。

## 5. 复盘 Agent

- 服务端具备独立 `modelId`、独立提示词、异步持久化任务、失败重试和重新生成 API。
- Web 会轮询并展示 `ReviewSummary`，与确定性事实分区；单局复盘可以导出脱敏 Markdown。
- `pnpm test:live:review` 已提供显式真实调用入口，检查结构、AI 覆盖和输出隔离。
- 当前仓库没有一份已确认可公开的真实复盘模型运行结果，因此这里不声称该付费调用已经通过；默认假复盘和提示词契约有自动化覆盖。

## 6. 可复现命令

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
```

真实模型命令必须由验收者在本地 `.env` 配置后显式运行：

```bash
pnpm test:live:smoke
pnpm test:live:policy
pnpm test:live:review
pnpm test:live:full
```

缺少配置时必须明确失败，不能静默回退假模型。生成的逐次报告默认被 `.gitignore` 排除，避免未经人工复核的运行产物误带敏感数据；本页是从已通过自检的报告中人工复核后提炼的可提交证据。

## 7. 当前环境边界

当前工作区 shell 为 Node 24，而已安装的 `better-sqlite3` 原生模块由 Node 22 ABI 构建，因此最近一次完整 Server SQLite 回归在模块加载阶段失败。与数据库无关的复盘测试、Server typecheck/build、全仓 lint 和差异检查均通过。推荐使用 README 指定的 Node 22 LTS 重新安装依赖后执行完整门禁。
