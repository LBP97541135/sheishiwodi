# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目状态

这是一个 AI 版“谁是卧底”本地全栈项目。产品规则、架构和首个里程碑规格已经确认，首个里程碑七个切片（使用可控假模型的可持久化、可恢复基础玩法）已全部验收。里程碑之外已完成 Tokendance 真实策略、模型档案、统一 Agent 校验与自动恢复、角色/场景素材、背景切换和 BGM；TASK-057 已产出策略级与纯状态机整局真实模型脱敏报告，但 HTTP/SQLite 整局验收和最终任务收口仍未完成。开发以 `docs/spec/` 为工程契约，以 `docs/tasks/TASKS.md` 和 `docs/tasks/milestone-1-checklist.md` 跟踪实时任务；不要从聊天归档或被替代的旧决策推断当前行为。

首个里程碑的纵向最小闭环见 `docs/acceptance/milestone-1.md`。真实模型现已接入但受 provider 开关约束：`AGENT_PROVIDER` 默认 `fake`，仅当为 `tokendance` 且 Base URL、API Key 均在服务端 env 就绪时才走真实策略；默认 `dev/test/test:e2e` 永不联网、不读 Key。模型档案界面可选择并持久化各角色 model ID（仅 model ID 可下发/落库；Base URL、API Key、请求头、完整模型响应绝不进入浏览器、数据库、日志、仓库或复盘）。重复泄词强退与脱敏系统终止已经实现。异步 AI 总结已有服务端任务、持久化和 API 基础设施，但当前复盘页尚未请求或展示该总结，不能视为用户可用闭环；历史列表与 Markdown 导出也仍未实现。三个 AI 角色、两个人类剪影、审讯室背景与 BGM 已按 `docs/notes/ASSETS.md` 接入，发布前仍需压缩和补齐来源记录。

## 常用命令

工程初始化后，根工作区必须保持以下命令契约：

```bash
pnpm dev
```

同时启动 React Web 与 Fastify Server，不调用真实模型。

```bash
pnpm build
```

构建全部工作区。

```bash
pnpm typecheck
```

检查全部 TypeScript 项目。

```bash
pnpm lint
```

执行静态检查。

```bash
pnpm test
```

运行不依赖网络、密钥或付费模型的默认测试。

```bash
pnpm test:e2e
```

使用假模型和临时 SQLite 运行 Playwright 完整流程。

```bash
pnpm test:live
```

显式运行真实模型验收；不得被开发、构建、默认测试或 E2E 隐式调用。

单测使用 Vitest 时，从根目录按文件运行：

```bash
pnpm --filter @sheishiwodi/shared test -- src/path/to/file.test.ts
```

按测试名称运行：

```bash
pnpm --filter @sheishiwodi/shared test -- -t "测试名称"
```

在 `package.json` 尚未创建或相应脚本尚未落地前，不要声称这些命令已经可用；先按 `docs/spec/architecture.md` 的脚本契约初始化。

## 架构边界

计划中的 pnpm workspace 分为：

- `apps/web`：React + Vite 前端，只消费共享类型和服务端公开 API。
- `apps/server`：Fastify 服务，负责权威状态、编排、SQLite/Drizzle、Agent 调用和公开投影。
- `packages/shared`：领域类型、Zod Schema、纯状态机和纯校验器；不得依赖 React、Fastify、Drizzle、网络或文件系统。
- `data/word-pairs.json`：版本化词库事实源；SQLite 只是运行时镜像，历史对局保存词组快照。
- `tests/e2e`：使用真实 Web/Server、临时 SQLite 和可控假模型的浏览器流程测试。

依赖方向必须保持 `apps/web -> packages/shared`、`apps/server -> packages/shared`。Web 不得导入服务端实现或访问数据库；API、模型编排和持久化层不得绕过共享状态机直接改变阶段、淘汰或胜负。

服务端处理命令时，状态机输出的新快照、不可变事件、私有动作记录和安全公开帧在同一 SQLite 事务中提交。浏览器通过 REST 提交命令，通过 SSE 接收安全公开帧；进行中视图始终使用 `HumanGameView`，不得返回数据库实体或完整领域快照。

## 领域与信息隔离

状态、命令、事件和字段名称以 `docs/spec/game-domain.md` 为唯一工程命名来源。首版创建层固定一名人类、三名 AI、一名卧底，但核心集合、顺序、概率和胜负函数不得硬编码四人。

服务端是身份、词牌、阶段、投票和胜负的唯一权威。对局进行中：

- 每个 Agent 只获得自己的词牌、公开配置、公开事件和自己的历史信念。
- 真实阵营、其他词牌、其他 Agent 信念和未统一揭晓的选票不得进入 Agent 输入、REST、SSE、日志或 DOM。
- 单票可以私有持久化；所有投票完成前只公开完成进度，随后由独立 `votes_revealed` 事件统一公开目标。
- 淘汰只公开玩家被淘汰，不公开阵营和词牌；人类淘汰后观战仍使用普通公开视图。
- AI 信念、候选词和投票理由只在终局复盘公开。

信息隔离必须通过字段不存在的负向测试证明，不能只依赖提示词或页面隐藏。

## 规格与记录

推荐阅读顺序：

1. `docs/README.md`
2. `docs/tasks/TASKS.md` 与 `docs/tasks/milestone-1-checklist.md`
3. `docs/acceptance/milestone-1.md`
4. `docs/spec/architecture.md`
5. `docs/spec/game-domain.md`
6. `docs/spec/persistence.md` 与 `docs/spec/api-and-events.md`
7. `docs/spec/agent-runtime.md`
8. `docs/spec/frontend-ux.md`
9. `docs/acceptance/TESTING.md`

文档职责：

- `docs/tasks/`：实时任务、状态、检查点和证据。
- `docs/acceptance/`：当前产品行为、里程碑合同和验收标准。
- `docs/spec/`：当前工程契约。
- `docs/notes/`：协作、决策和素材注意事项。
- `docs/history/PROJECT_LOG.md`：已完成工作与验证结果。
- `CHANGELOG.md`：带版本号的较大变更。
- `docs/history/chat/`、`docs/history/COMMAND_LOG.md`：讨论语境和负责人命令，不作为实现规格。

新任务先写入 `docs/tasks/TASKS.md` 与 checklist；任务开始和检查点完成时实时更新。产品行为变化先取得负责人确认并更新需求；重大架构变化先新增或替代决策。实现完成后更新 `docs/history/PROJECT_LOG.md`，不要把完成流水写入规格。

## 协作与 Git

项目文档、界面文案和必要代码注释优先使用中文；代码标识符和协议固定字段使用英文。

仓库保留 `master` 单分支开发。没有负责人明确指示，不执行 Git 提交、推送、正式发布、付费真实模型调用、破坏性数据操作或重大架构调整。准备提交前先汇报本轮目标、文件变化、验证结果、已知问题和建议提交说明。
