# 持久化规格

- 状态：首个里程碑基线、`agent_role_models`、`review_summaries` 与 `model_attempts` 已实现；可靠性迁移待继续
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

`agent_actions` 仍只表示最终被状态机接受的语义动作，不混入请求尝试细节。公开文本只有在状态机提交后才通过 `game_events` 成为事实；模型标识、结果分类和尝试次数由下述 `model_attempts` 单独记录。

### 2.6 `model_attempts`（DEC-095，已实现基础版本）

当前持久化每次真实模型请求的脱敏元数据：

- `attemptId`、`gameId`、`commandId`、`actionId`、`playerId/roleId`
- `modelId`、动作类型和尝试序号
- 开始时间、结束时间、耗时
- 复用 DEC-086 的结果/错误分类
- 尝试类型：初次调用、结构修复、内容重生成或系统重试
- 调用结束状态；处理中为 `started`

不得保存完整 Prompt、词牌、私有信念正文、模型原始响应、密钥、敏感基础地址、完整请求头或被拦截的泄词原文。

上下文清单和显式调试模式下的完整追踪不进入本表：它们写入 Git 忽略的独立本地审计目录，并通过 `attemptId` 关联。普通模式只保存来源、可见级别、公开游标、模板版本、Prompt 哈希和边界校验结果；完整 Prompt/响应默认关闭。

`model_attempts` 已通过外键随对局级联删除。结构化上下文清单当前写入 `AGENT_AUDIT_DIR`（默认 `.local/agent-audit`）并按散列后的 game/attempt 路径保存；其按局清理，以及完整 Prompt/响应调试文件的 7 天/容量限制和主动清除，仍待后续阶段实现。

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

该表不保存 Base URL 或 API Key（继承 DEC-082/DEC-052），仅保存可下发的角色 model ID。假模型流程不依赖该表；Tokendance 可在记录缺失时使用兼容默认值，`openai-compatible` 必须存在三个角色的显式记录且不得回退内置 ID。评测 model 不进入本表，只存在服务端 env；存在活动局（`in_progress` / `awaiting_spectator`）时拒绝改写角色配置（见 DEC-085、DEC-089 与 `api-and-events.md`）。

### 2.10 `review_summaries`

当前已存在按 `gameId` 唯一的异步复盘摘要表，保存 `status`、非敏感 `modelId`、结构化 `summaryJson`、可选脱敏 `errorCode` 与创建/更新时间。正常终局后服务端可入队生成，重启时恢复 `pending/generating` 记录；失败不得改变游戏事实。Web 在单局复盘页轮询并展示该摘要，允许失败后重新生成；AI 评价始终与 `HumanGameView.factReview` 的确定性事实分区展示，不能覆盖事实。

### 2.11 `game_runtime_recovery`

当前已实现每局一条运行中断恢复记录：保存 `gameId`、被中断的 `actionId`、`awaiting_confirmation/resolved` 状态、中断时间与解决时间。该表不复制 Prompt、响应或游戏私有内容，并随对局级联删除。服务启动时把遗留 `started` attempt 标为 `runtime_interrupted`；若所属对局仍在进行，则写入等待确认记录并停止自动推进。

### 2.12 后续实体

`model_attempts`、结构化上下文审计、运行中断恢复、全局复盘调度和轻量 Provider 熔断已经落地。完整记录、清理器、可选 `TelemetrySink` 与开发者面板继续在 TASK-076/077 后续阶段完成。

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

当前调度规则（DEC-092/093，已实现）：

- 正在执行的模型调用因进程停止而中断时，持久化“中断后等待玩家确认”的运行状态；它不计入常规模型重试次数。
- 继续旧局时只重新执行中断动作；开始新局时旧局以无胜者的独立原因终止。
- 后台复盘全局并发为 1；存在 `preparing`、`in_progress` 或 `awaiting_spectator` 对局时不启动新复盘。
- 已发出的复盘允许完成；待处理任务持久化，空闲后优先当前刚结束对局，再处理更早任务。

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
- 迁移开始前生成一次可恢复备份；不创建每局备份或每日轮转备份。
- SQLite 繁忙使用可配置的有限等待，默认约 3 秒；只重试事务，不得重新调用模型。
- 检测到数据库完整性异常时保留数据库和 WAL 原文件，停止业务读写并进入仅健康检查可用的本机诊断模式；不得自动猜测修复。

## 8. 来源

- 需求：[`../acceptance/REQUIREMENTS.md`](../acceptance/REQUIREMENTS.md) 第 89–98、106–123、167–192 条。
- 决策：DEC-022 至 DEC-024、DEC-028 至 DEC-032、DEC-047、DEC-049、DEC-052 至 DEC-054、DEC-071 至 DEC-074、DEC-077、DEC-079 至 DEC-082、DEC-092 至 DEC-096。
