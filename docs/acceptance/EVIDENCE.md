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

2026-08-19 面试交付前最终零付费回归：Node 22 下默认测试 186/186（Shared 50、Server 83、Web 53）、typecheck、ESLint、三 workspace build 和 Playwright E2E 10/10 全部通过。E2E 前端服务改为直接调用仓库内 Vite CLI，降低对嵌套 pnpm 运行状态的耦合；Chromium 额外验证首页、猜词模式提示和首轮对局。393px 移动视口无横向溢出，4 张角色图均完成解码，席位名称保持在卡片边界内，控制台 0 warning/error。本轮使用 fake provider，没有读取真实 Key 或产生模型费用。

2026-08-19 Agent 工程补强后的零付费回归：Node 22 下 Shared 55/55、Server 112/112、Web 67/67，共 234/234；三 workspace typecheck、全仓 ESLint 与生产构建通过。Playwright 使用隔离端口与现有开发服务并行，normal 4/4、spectator 4/4、tie 2/2，共 10/10。仓库新增固定 Node 22.14.0 的 `.node-version` 和假模型 GitHub CI；工作流契约静态检查确认包含 typecheck、lint、test、build、E2E，显式清空真实 Provider 凭据且不含 `test:live*`。本段证明本地门禁与工作流配置，不冒充尚未发生的远端 Actions 运行。

2026-08-20 三个扩展方向完成后的零付费回归：发布素材已压缩并可复现检查；动态阵容支持 4～8 人、0/1 名人类、多卧底、本地角色库与纯 Agent 控制；全阵营猜词支持描述即时结算和投票冻结快照批次结算。Node 22 下 Shared 63/63、Server 117/117、Web 66/66，共 246/246，三 workspace typecheck、全仓 ESLint 和生产构建通过。1440px Chromium 完成猜词模式整局：人类猜错出局后继续观战，AI 推进到卧底胜利并进入事实复盘；进行中公开事件精确为 `actorId + success`，终局前无目标/猜测词，图片 0 破损、无横向溢出、控制台 0 error。共享测试另覆盖人类在投票猜词批次出局后暂停并恢复到已结算阶段。该浏览器验证使用隔离 fake API 和一次性脚本，没有读取真实 Key、联网调用模型或产生费用；猜词模式的真实 Provider 付费整局尚未执行。

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

这项证据证明真实模型可以在相同领域规则和隔离投影下完成一局，但运行模式是纯状态机直驱；后续 Web/HTTP/SSE/SQLite 证据见下一节。

## 5. 一次性全栈真实验收

2026-08-19 使用真实 API Key 在临时 Node 22、独立依赖与 SQLite 中完成一次不进入长期自动化的正式验收。2026-08-18 的执行在准备阶段后阻塞，未形成验收结论；本节列出的非付费门禁、付费对局、复盘与恢复结果均在 2026-08-19 完成。验收先通过 186/186 默认测试、10/10 Playwright E2E、typecheck、lint 和 build，再由可见浏览器完成唯一一局真实模型对局。

| 指标 | 结果 |
| --- | --- |
| 链路 | Web → HTTP/SSE → Server → 3 个真实 Agent → SQLite |
| 终局 | `finished/ended`，创建至终局 440 秒 |
| 真实请求 | 37/40（含 smoke、自动恢复和复盘） |
| 持久化 | 4 名玩家、110 条事件、91 帧公开流、26 条 AI 私有行动 |
| 模型配置 | 三角色显式 model ID；复盘 `deepseek-v4-flash` |
| 真实复盘 | `done`，错误码为空；Web 展示、刷新及 Server 重启恢复通过 |
| 导出 | HTTP 200，Markdown MIME 与下载头正确 |
| 浏览器 | 控制台 0 warning / 0 error |

完整脱敏结果与两张人工复核截图见 [FULLSTACK_LIVE_2026-08-19.md](FULLSTACK_LIVE_2026-08-19.md)。报告明确使用真实凭据，但不保存 Key、Base URL、请求头、完整响应、词牌或私有信念。

2026-08-20 对动态角色、玩家夺舍和最新 Agent Harness 再执行一次唯一付费全栈回归：人类占用 DeepSeek，豆包、千问和千问自建副本完成 3 次描述与 3 次秘密投票，首轮正常终局；真实复盘、刷新恢复、开发者观测和 Markdown 导出通过。8 次模型尝试包含 1 次 `invalid_format:belief_invalid`，非法结果未提交，唯一一次格式修复后成功。付费前发现并修复角色库往返丢失新局草稿的问题。最新零付费门禁为 260/260、三 workspace typecheck、全仓 lint/build 通过。完整脱敏证据见 [FULLSTACK_LIVE_2026-08-20.md](FULLSTACK_LIVE_2026-08-20.md)。

## 6. 复盘 Agent

- 服务端具备独立 `modelId`、独立提示词、异步持久化任务、失败重试和重新生成 API。
- Web 会轮询并展示 `ReviewSummary`，与确定性事实分区；单局复盘可以导出脱敏 Markdown。
- `pnpm test:live:review` 已提供显式真实调用入口，检查结构、AI 覆盖和输出隔离。
- 一次性全栈验收已确认真实复盘生成、持久化、Web 展示、刷新与服务重启恢复、Markdown 导出全部通过；默认假复盘和提示词契约继续提供确定性自动化覆盖。

## 7. 可复现命令

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

## 8. 当前环境边界

当前系统 Node 仍为 24，工作区既有原生依赖仍可能受 Node ABI 影响。为避免修改系统或工作区依赖，本次在经哈希校验的临时 Node `v22.23.2` 与独立依赖中完成全量门禁和真实 SQLite 验收；临时环境在证据收口后删除。仓库日常运行仍推荐按 README 使用 Node 22 LTS 重新安装依赖。

## 9. PR 后格式失败探索与确定性修复

2026-08-19 在独立端口与临时 SQLite 上额外执行了一次真实浏览器探索验收。首页、模型档案、开发者模式、准备阶段、第一轮描述/投票/重投和第二轮描述/投票均可操作，随后 DeepSeek 投票连续格式失败并按预算进入 `system_terminated`，因此该次探索不计为完整验收通过，也不覆盖第 5 节已经独立完成的正式真实验收。

脱敏数据库证据把问题定位为 Provider 返回后的结构校验失败，而不是并行投票覆盖或事务提交失败。TASK-084 随后增加稳定格式原因码和定向修复契约，保持 strict Schema 与重试预算。Node 22 零付费回归为 Shared 55/55、Server 112/112、Web 67/67，三个 workspace typecheck、全仓 ESLint 与差异检查通过；修复后的真实付费整局复测仍需负责人再次明确授权。
