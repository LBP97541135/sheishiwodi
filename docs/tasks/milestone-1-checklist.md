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

### 验证（TASK-054，进行中）

- [x] shared 状态机新增系统终止用例；服务端 `game-system-terminated.test.ts` 兜底终止用例通过。
- [x] `tokendance-agent-policy.test.ts` 策略级格式修复/重试/脱敏错误通过。
- [x] 单测证明 Agent 输入/REST/SSE/事件不含 Key/URL/Bearer/完整响应。
- [ ] `pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:e2e` 本机全量复跑确认。
- [ ] E2E 断言未实例化真实策略、无出网。
- [ ] `test:live` 冒烟入口在缺 env 时显式失败；负责人自填 Key 后付费联网验收。
- [ ] 完成后向负责人汇报，未提交、未推送。
