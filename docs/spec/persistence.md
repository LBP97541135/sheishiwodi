# 持久化规格

- 状态：首个里程碑基线、`agent_role_models` 与 `review_summaries` 已实现；`model_attempts` 尚未实现
- 适用范围：当前 SQLite + Drizzle 物理 Schema、原子提交与恢复

## 1. 目标

持久化层必须同时满足：

1. 已确认的对局事实不可被后续动作覆盖。
2. 当前状态可以快速读取，刷新或服务重启后无需从头重放全部事件。
3. 事件追加、私有动作记录和快照更新保持原子一致。
4. 对局中的公开、本人私有、终局可揭晓和永久敏感数据保持明确边界。

SQLite 文件是本地运行状态，不是词库或需求的 Git 事实源。

## 2. 逻辑数据模型

以下是必须表达的逻辑实体；物理表名、索引和 JSON/列拆分可在 Drizzle Schema 落地时调整。

### 2.1 `games`

保存当前权威快照和不可变配置：

- `gameId`
- `status`、`phase`、`revision`
- `roundNumber`、当前行动者、阶段进度和发言顺序
- `undercoverCount`
- 人类名称、剪影和难度
- 本局词组快照：稳定 ID、平民词、卧底词、分类、难度
- 当前存活/淘汰集合、胜者和终局原因
- 最新 `eventSeq`、最新 `streamSeq`
- 创建、更新、开始和结束时间

快照可以使用经过共享 Schema 校验的 JSON；关键查询字段应单独成列。读取后必须再次通过当前版本 Schema 验证。

### 2.2 `game_players`

每个座位一行：

- `gameId`、`playerId`、稳定 `seatIndex`
- `kind: human | agent`
- 显示名称、剪影或 `agentRoleId`
- 真实 `camp` 与实际 `wordCard`
- 存活状态、淘汰顺序

`camp` 与 `wordCard` 是服务端私有字段。进行中的浏览器投影只可返回当前人类自己的 `wordCard`，不得返回任何玩家的 `camp`。

### 2.3 `game_events`

不可变、只追加的事实日志：

- `eventId`、`gameId`、`eventSeq`
- `type`、`visibility`
- `commandId` 或 `actionId`
- 经过事件类型 Schema 校验的 `payload`
- `occurredAt`

同一对局的 `eventSeq` 从 1 开始严格递增，`(gameId, eventSeq)` 和 `eventId` 必须唯一。已提交事件不得更新或删除；数据清理只能以整个本地数据库的显式维护操作进行。

### 2.4 `processed_commands`

用于命令幂等：

- `commandId`、`gameId`、`actorId`
- 请求语义摘要 `requestHash`
- 提交前后修订号
- 结果事件范围、响应摘要和完成时间

相同 `commandId` 与相同语义重复提交时返回第一次结果；相同 ID 携带不同语义时返回冲突，不得复用。

### 2.5 `agent_actions`

保存 AI 行动的私有审计记录。当前物理列为：

- `actionId`、`gameId`、`playerId`、`roundNumber`、`actionType`
- `baseRevision`
- `beliefJson`
- `outputJson`：描述/辩解文本，或投票目标与理由
- `completedAt`

当前没有独立的公开事件上界、模型标识、校验结果和尝试次数字段；这些信息如在真实模型切片需要，应通过迁移增加，不能假定已经持久化。公开文本只有在状态机提交后才通过 `game_events` 成为事实。

### 2.6 `model_attempts`（尚未实现）

后续真实模型系统错误恢复计划保存以下脱敏元数据：

- `attemptId`、`actionId`、尝试序号
- 结果：成功、结构修复失败、网络、超时、限流、服务端或未知错误
- 开始时间、耗时、脱敏摘要

不得保存密钥、敏感基础地址、完整请求头、被拦截的泄词原文或无必要的完整模型响应。

### 2.7 `public_stream_entries`

保存可向当前人类浏览器发布的安全帧：

- `gameId`、`streamSeq`
- `type`
- 可选关联 `eventSeq` 或 `actionId`
- 已经完成脱敏与可见性投影的 `payload`
- 创建时间

领域事实对应持久化公开帧；“某角色思考中/已完成投票”等非信息性运行状态也可形成安全帧。`streamSeq` 严格递增，用作 SSE `id`，不得直接用包含私有缺口的数据库主键。

### 2.8 `word_pairs`

运行时词库镜像：

- 稳定 `wordPairId`
- 平民词、卧底词、分类、难度、启用状态
- 源数据版本或内容摘要

仓库内 JSON 才是版本化事实源。本表可重建；历史对局只读取 `games` 保存的本局词组快照。

### 2.9 `agent_role_models`

当前已存在角色到模型 ID 的配置表：

- `roleId` 主键。
- `modelId`。
- `updatedAt`。

该表不保存 Base URL 或 API Key（继承 DEC-082/DEC-052）。仅保存可下发的 model ID。假模型流程不依赖该表；真实模型（Tokendance 中转，`AGENT_PROVIDER=tokendance`）接入时使用同一个中转站，仅按角色读取 model ID。存在活动局（`in_progress` / `awaiting_spectator`）时拒绝改写该表（见 DEC-085 与 `api-and-events.md`）。

### 2.10 `review_summaries`

当前已存在按 `gameId` 唯一的异步复盘摘要表，保存 `status`、非敏感 `modelId`、结构化 `summaryJson`、可选脱敏 `errorCode` 与创建/更新时间。正常终局后服务端可入队生成，重启时恢复 `pending/generating` 记录；失败不得改变游戏事实。当前 Web 尚未消费该摘要，用户可见的复盘仍以 `HumanGameView.factReview` 为准。

### 2.11 后续实体

`model_attempts` 与更完整的跨任务调度在对应里程碑再落地。本阶段的 `gameId`、角色模型映射、事件、私有动作和复盘摘要已经为后续读取提供基础。

## 3. 原子提交协议

每个有效领域命令必须按以下顺序处理：

1. 在进入事务前完成外部模型调用；记录其 `baseRevision` 和稳定 `actionId`。
2. 开启 SQLite 事务并读取当前 `games.revision`。
3. 若 `commandId` 已处理，按幂等规则返回原结果。
4. 若 `expectedRevision/baseRevision` 已过期，终止提交；AI 编排层重新评估当前状态，不复用旧动作。
5. 调用纯状态机，得到新快照与事件列表。
6. 按连续序号追加 `game_events`；写入相关 `agent_actions` 私有记录。
7. 从允许公开的事实生成 `public_stream_entries`。
8. 以旧修订号为条件更新 `games` 快照、`revision` 和序号上界。
9. 写入 `processed_commands` 并提交事务。
10. 事务成功后才通知 SSE 订阅者；通知失败不回滚事实，客户端可按游标补取。

任一步骤失败必须回滚整次提交。不得出现事件已写入但快照未更新、选票已公开但私有记录未冻结、或 SSE 已发送但事实未提交的状态。

## 4. 自动行动与并发

- 每个待执行 AI 动作使用稳定 `actionId`，由 `gameId + revision + actorId + actionType` 的确定性语义生成或唯一映射。
- 同一对局同时最多有一个自动推进执行者获得行动权。
- 服务重启后可以根据快照中的当前行动者与 `agent_actions` 状态恢复未完成动作。
- 同一个 `actionId` 的成功结果最多提交一次。
- 模型调用期间人类放弃导致修订号变化时，旧模型结果必须丢弃，不得覆盖终局。
- 数据库忙或乐观并发冲突属于可重试基础设施错误，不得转换为玩家行为。

首个里程碑可以采用进程内单队列配合数据库唯一约束；数据库约束必须作为防重复的最终防线。

## 5. 词库同步

仓库的版本化 JSON 每项至少包含：

```text
id
civilianWord
undercoverWord
category
difficulty: easy | hard
enabled
```

同步前必须通过共享 Zod Schema 和集合级校验：

- ID 唯一且稳定。
- 词语非空，规范化后同组两词不得相同。
- 难度与启用状态合法。
- 首版交付时共 30 组，简单和困难各 15 组。

首个里程碑可以使用经过人工审核的子集，但测试数据不得假装满足最终 30 组验收。创建对局时只从所选难度的启用词组中独立随机抽取，并把完整必要快照写入 `games`。

## 6. 数据可见性

| 数据 | 进行中浏览器 | 当前 Agent | 终局复盘 | 持久化 |
| --- | --- | --- | --- | --- |
| 公开描述/辩解 | 是 | 是 | 是 | 是 |
| 已统一揭晓投票关系 | 是 | 是，后续行动可见 | 是 | 是 |
| 未揭晓选票目标 | 否 | 否 | 是 | 是，私有 |
| 人类自己的词牌 | 仅本人 | 否 | 是 | 是，私有 |
| 某 AI 自己的词牌 | 否 | 仅该 AI | 是 | 是，私有 |
| 真实阵营 | 否 | 否 | 是 | 是，私有 |
| AI 信念/投票理由 | 否 | 仅该 AI 当前历史可按策略读取 | 是 | 是，私有 |
| 被拦截泄词原文 | 否 | 否 | 否 | 否 |
| 密钥/敏感地址 | 否 | 当前假模型不使用；后续真实客户端内部连接使用且不进入上下文 | 否 | 否 |

## 7. 恢复与迁移

- 服务启动时必须应用版本化数据库迁移，不使用运行时临时 `ALTER` 作为正式方案。
- 快照 Schema 必须带版本，迁移后可由当前共享 Schema 读取。
- 若事件与快照序号不一致，服务必须拒绝自动推进并报告本地数据一致性错误，不猜测修复。
- 浏览器恢复读取当前 `HumanGameView`，而不是直接返回数据库行或完整事件负载。
- 准备状态恢复后继续等待 `StartGame`；正常终局、放弃和系统异常终止不可恢复为进行中。
- 开发与测试使用独立 SQLite 文件；自动化测试默认使用临时数据库并在用例结束后清理自身产物。

## 8. 来源

- 需求：[`../acceptance/REQUIREMENTS.md`](../acceptance/REQUIREMENTS.md) 第 89–98、106–123、167–192 条。
- 决策：DEC-022 至 DEC-024、DEC-028 至 DEC-032、DEC-047、DEC-049、DEC-052 至 DEC-054、DEC-071 至 DEC-074、DEC-077、DEC-079 至 DEC-082。
