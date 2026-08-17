# 首个里程碑执行 Checklist

本清单是[任务台账](TASKS.md)的可勾选执行视图；验收标准来自[首个里程碑合同](../acceptance/milestone-1.md)和[测试规格](../acceptance/TESTING.md)。只有存在实际证据时才勾选。

## 项目准备与切片 1–4

- [x] TASK-000～009：产品、规则、架构、规格和治理基线完成。
- [x] TASK-010～013：切片 1 工程基线与共享契约完成。
- [x] TASK-014～018：切片 2 创建、准备与持久化词牌完成。
- [x] TASK-019～023：切片 3 正常描述与秘密投票闭环完成。
- [x] TASK-024～028：切片 4 平票辩解与候选重投完成。
- [x] 切片 4 自动化 78 项通过，typecheck/lint/build/diff 通过。
- [x] 切片 4 桌面与 375×812 移动端平票闭环实测通过。
- [x] 普通投票和重投的未揭晓目标在 REST/SSE/DOM 中字段不存在。

## 切片 5：TASK-029 事务、幂等与恢复

### 已完成核心实现

- [x] `saveStarted` 收敛到通用 `commitTransition`。
- [x] `findSnapshot` 校验事件与公开流高水位，不一致时拒绝恢复。
- [x] `GameService` 增加单局进程内自动推进锁。
- [x] Server `onReady` 尝试恢复活动中的 AI 回合。
- [x] SSE 连接前触发幂等恢复。
- [x] SSE 支持读取 `Last-Event-ID`，`after` 查询参数优先。
- [x] Web SSE URL 携带当前 `eventCursor`。
- [x] Web 只接受游标严格前进的安全视图。
- [x] 上述改动通过既有 server 22 项、web 17 项回归测试。

### TASK-030 事务故障回滚

- [x] 开始 TASK-030，并将台账状态更新为进行中。
- [x] 事件写入失败：事件、私有动作、公开帧、快照、processed command 均不变化。
- [x] 私有动作写入失败：整次转换回滚。
- [x] 公开帧写入失败：私有动作和事件也回滚。
- [x] 快照条件更新失败：之前写入全部回滚。
- [x] processed command 写入失败：快照、事件、动作和帧全部回滚。
- [x] 失败后原命令/自动动作可基于未变化修订号安全重试。

### TASK-031 重启与重复调度恢复

- [x] 开始 TASK-031，并将台账状态更新为进行中。
- [x] 准备阶段重启后仍等待 `StartGame`。
- [x] AI 描述回合重启后自动执行到人类回合。
- [x] AI 投票回合重启后继续且稳定 `actionId` 只提交一次。
- [x] AI 辩解/重投恢复复用相同四动作编排、行动锁与稳定 actionId；分支行为由切片 4 集成测试覆盖。
- [x] 人类回合重启后保持等待，不自动伪造人类动作。
- [x] 多次调用恢复入口/二次重启不增加重复 `game_events`、`agent_actions` 或 `processed_commands`。
- [x] 高水位不一致时拒绝恢复并报告数据一致性错误。
- [x] `awaiting_spectator` 节点恢复：切片 6 已实现状态、继续/放弃命令及刷新恢复，并由集成与 E2E 覆盖。

### TASK-032 SSE 补发与客户端去重

- [x] 开始 TASK-032，并将台账状态更新为进行中。
- [x] `GET events?after=N` 只返回 `streamSeq > N`，顺序严格递增。
- [x] SSE `Last-Event-ID: N` 补发同样的后续帧。
- [x] 查询参数 `after` 与 Header 同时存在时查询参数优先，且有纯函数测试。
- [x] 无效、负数游标安全回退，不返回私有原始事件。
- [x] 补发结束后游标递增，实时高水位无遗漏、无重复。
- [x] Web EventSource 连接携带当前 cursor。
- [x] 收到旧或同 cursor 通知时不倒退/重复覆盖视图。
- [x] 浏览器刷新与重连后公开时间线保持 19 个分镜、无重复，控制台/网络/Server 均无错误。

### TASK-029 汇总门禁

- [x] TASK-030、031、032 均完成。
- [x] `pnpm test` 通过。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm lint` 通过。
- [x] `pnpm build` 通过。
- [x] `git diff --check` 通过。
- [x] 桌面恢复/SSE 行为实测通过；恢复逻辑不改变布局，移动布局沿用切片 4 已验收结果。
- [x] 信息隔离负向矩阵仍通过。
- [x] README 与开发记录更新，TASK-029 标记完成。

## 切片 6：放弃、淘汰观战与终局展示

- [x] 人类存活时二次确认放弃。
- [x] 人类被淘汰后进入 `awaiting_spectator`，选择观战或放弃。
- [x] 观战后剩余 AI 自动推进，视图不升级为上帝视角。
- [x] 正常终局按座序揭晓身份与词牌，并提供事实复盘入口。
- [x] 放弃终局保留不完整事实且不存在 `winnerCamp`。
- [x] 桌面、移动和减少动态效果模式验收。

## 切片 7：完整自动化、验收与文档收口

- [x] 完成领域、内容、数据库、API/SSE、组件与 Playwright 测试。
- [x] `pnpm test:e2e` 使用假模型和独立 SQLite 完成黄金路径与边界场景。
- [x] 桌面与移动完成正常、平票、恢复、放弃、观战、终局代表性验收。
- [x] 全通道信息隔离负向矩阵通过。
- [x] README、任务台账、验收清单与开发记录反映实际状态。
- [x] 7 个切片全部完成；已准备向负责人汇报目标、文件、验证、已知问题和建议提交说明，未执行提交或推送。

## 文档治理

- [x] TASK-033：四类目录和统一文档入口建立。
- [x] TASK-034：TASK-000～032 已写入持久化台账。
- [x] TASK-035：所有链接、旧路径、编号连续性和 diff 验证完成。

## 真实模型接入（DEC-085，里程碑一之外）

### 实现（TASK-046～053）

- [x] 共享层角色真源 `agent-roles.ts` 与 `model-profile.ts` schema。
- [x] `AgentPolicy.act` 异步化，服务端推进链全部 `await`。
- [x] `tokendance-client.ts` 超时与脱敏错误分类。
- [x] `tokendance-agent-policy.ts` 一次格式修复 + 有限系统重试（注入 Clock）+ 脱敏 `AgentSystemError`。
- [x] `GameService` 捕获系统错误后终止为 `system_terminated`/`model_failure_limit`（DEC-072）。
- [x] server-only `agent_role_models` 表，不进入 `HumanGameView`。
- [x] provider 开关按 `AGENT_PROVIDER`+Key 决定 Fake/Tokendance，默认 fake；根 `.env.example` Key 留空。
- [x] 模型档案 REST：profiles/models/`PUT`（活动局 409、未知角色 404），响应不含 URL/Key/请求头。
- [x] 前端模型档案界面展示 model 下拉，禁展 URL/Key，fake 或活动局禁用选择。
- [x] 文档与决策先行：DEC-085 及 REQUIREMENTS/frontend-ux/agent-runtime/architecture/persistence/api-and-events/TESTING/CLAUDE 已同步。

### 验证（TASK-054，已完成）

- [x] shared 状态机新增系统终止用例；服务端 `game-system-terminated.test.ts` 兜底终止用例通过。
- [x] `tokendance-agent-policy.test.ts` 策略级格式修复/重试/脱敏错误通过。
- [x] 单测证明 Agent 输入/REST/SSE/事件不含 Key/URL/Bearer/完整响应。
- [x] `pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:e2e` 本机全量复跑确认。
- [x] E2E 通过 `playwright.config.ts` 强制 `AGENT_PROVIDER=fake` 且不读取本机真实配置；更严格的零出网守卫继续由 TASK-057 覆盖。
- [x] `test:live` 冒烟入口在缺 env 时显式失败且不静默回退；付费分层验收转入 TASK-057。
- [x] 已向负责人汇报 TASK-054 结果，未提交、未推送。

## 真实模型分层验收（TASK-057）

- [x] `test:live` 链已建立：`run.mjs` 冒烟（缺 env 显式失败）→ `build shared` → tsx 编排器（`agent-live.ts`）。
- [x] 策略级 3 模型 × describe/vote 共 6 次真实 `.act()` 已通过输出 Schema 与信念校验。
- [x] Agent 输入、策略公开文本、整局公开帧与报告文本的隔离检查已通过；错误路径继续由默认测试覆盖。
- [ ] `test:live:full` 已用真实策略和纯 shared 状态机驱动到 `finished`；仍待可用 `better-sqlite3` 环境验证 HTTP/SQLite 完整链。
- [x] 已生成两份 `docs/acceptance/reports/live-<时间>.md`，包含结构、隔离、耗时和重试的脱敏结果。
- [x] **默认守卫**：`no-live-in-default.test.ts` 覆盖默认假模型零出网路径。
- [x] 既有默认门禁证明 `pnpm test`/`test:e2e` 不触发联网或读取 Key；最终收口时仍需在当前依赖环境复跑。
- [x] 负责人已执行付费策略级与纯状态机整局验收，并留存两份脱敏报告。

## 文档状态一致性（TASK-058）

- [x] README 反映真实模型策略、显式 live 命令和当前能力边界。
- [x] 任务总览同步至 TASK-057/058。
- [x] TASK-054 checklist 与任务台账的“已完成”状态一致。
- [x] TASK-057 继续保持进行中，未将存在文件等同于验收完成。
- [x] `spec/README.md` 不再把已实现的真实模型、系统终止、模型档案和媒体能力写为未实现。
- [x] `TESTING.md` 的测试数量、当前边界和错误恢复状态与实际门禁一致。
- [x] 全部当前状态文档完成过期短语检索与 `git diff --check`。

## Agent 校验与自动恢复（TASK-059）

- [x] 任务先于代码登记，状态设为进行中。
- [x] 需求与 Agent 运行时规格明确错误分类、重试预算、内容重生成和重复泄词规则。
- [x] Tokendance 客户端保留脱敏错误 kind/status，策略层映射可重试性与安全错误码。
- [x] 结构化输出使用 strict Schema；字段缺失、类型错误、非法目标和非法信念触发一次格式修复，不用默认动作掩盖。
- [x] 超时、网络、429、5xx、空响应按预算自动重试；401/403、模型未配置等永久错误不盲目重试。
- [x] AI 描述/辩解长度、句数错误自动重生成；失败内容不公开、不落私有动作、不进入后续上下文。
- [x] 同一发言机会首次泄词秘密重生成，第二次公开违规、强制退出并立即判断胜负。
- [x] 模型调用期间 revision 变化时丢弃旧结果；持久化失败复用已验证输出，不再次调用模型。
- [x] 错误事件、SSE、日志、REST 和 DOM 不含 Key、URL、请求头、完整响应或违规原文。
- [x] shared/server/Web 分层测试与必要 E2E 补齐。
- [x] `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm test:e2e`、`git diff --check` 全部通过（工作区 junction 损坏时在同版本 hoisted 隔离副本执行等价命令）。
- [x] 完成后实时收口 TASKS/checklist，并在 PROJECT_LOG 写实际变更、验证和边界。

## 对局操作体验（TASK-060）

- [x] 已先登记任务并设为进行中。
- [x] 人类回合到来且操作区不在视口内时，操作区进入可视范围，不抢占用户的历史回看。
- [x] 描述/辩解输入明确展示最小字数、长度或格式限制原因。
- [x] 组件测试已补；桌面、移动浏览器验收由负责人确认通过。
- [x] 任务台账、checklist 与 PROJECT_LOG 已更新。

## 当前文档一致性收口（TASK-061）

- [x] 依据当前代码复核 README、CLAUDE、工程规格、任务台账和素材说明。
- [x] 明确异步 AI 总结已有服务端任务、持久化与 API，但 Web 尚未消费，未误报为完整产品能力。
- [x] TASK-057 同步已有策略级/纯状态机整局报告与剩余 HTTP/SQLite 验收边界。
- [x] 删除 `ASSETS.md` 中指向已移除根目录素材的失效链接，统一到运行时素材路径。
- [x] 修正背景、BGM 的“尚未接入”旧描述及 BGM 默认状态。
- [x] `git diff --check` 与过期状态检索通过；本任务只改文档，不需要重复运行应用测试。

## 投票阶段同步思考状态（TASK-062）

- [x] 任务先于代码登记，状态设为进行中。
- [x] 普通投票阶段所有存活且未完成玩家的头像同步使用 `thinking`。
- [x] 已完成投票的玩家恢复待机状态并显示“已投票”。
- [x] 重投阶段仅非平票候选进入思考，候选继续显示被怀疑状态。
- [x] 组件测试覆盖初始投票、部分完成和重投资格。
- [x] 定向 Vitest 23/23、Web typecheck、可见浏览器投票交互与 `git diff --check` 通过；文档和 PROJECT_LOG 已收口。

## 二期历史复盘入口（TASK-063）

- [x] 任务先于代码登记，状态设为进行中。
- [x] 顶层导航常驻“历史复盘”入口，不伪装成已实现的历史列表。
- [x] 点击入口显示指定 deta 版本提示。
- [x] 支持“知道了”、遮罩和 Esc 关闭，关闭后焦点返回入口。
- [x] App 定向测试 7/7、Web typecheck、桌面浏览器交互和控制台检查、`git diff --check` 通过；移动端由响应式尺寸约束与组件测试覆盖，文档和 PROJECT_LOG 已收口。

## 二期猜词模式入口（TASK-064）

- [x] 任务先于代码登记，状态设为进行中。
- [x] 新对局配置页并排显示“经典模式”和“猜词模式”；经典模式沿用现有创建流程。
- [x] 与“历史复盘”共享同一个 deta 版本提示弹层和关闭行为。
- [x] 两个入口关闭弹层后，焦点分别返回各自触发按钮。
- [x] App 测试 8/8、Web typecheck、桌面浏览器交互和控制台检查、`git diff --check` 通过；窄屏由 420px 响应式按钮布局覆盖，文档和 PROJECT_LOG 已收口。

## 移除历史复盘入口（TASK-065）

- [x] 任务先于代码登记，状态设为进行中。
- [x] 顶层导航移除“历史复盘”，正常终局后的“复盘”保持不变。
- [x] 清理历史复盘专属弹层状态和测试，猜词模式提示保持可用。
- [x] App 测试 7/7、Web typecheck、浏览器交互和控制台检查、`git diff --check` 通过，文档和 PROJECT_LOG 已收口。
