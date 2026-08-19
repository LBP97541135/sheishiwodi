# API 与事件流规格

- 状态：首个里程碑、模型档案与单局复盘路由已实现；DEC-092～096 的恢复、诊断与 Agent 调试接口待实现
- 适用范围：本机单用户 REST + SSE

## 1. 总则

- API 前缀为 `/api`，请求和响应使用 JSON；SSE 端点除外。
- 所有请求和响应必须通过共享 Zod Schema 定义，前端不得复制手写第二套类型。
- 服务只监听 `127.0.0.1`，但仍必须按不可信边界校验浏览器输入。
- 浏览器永远接收 `HumanGameView` 或专用公开投影，不得接收数据库实体或完整领域快照。
- 改变状态的命令必须带 `commandId` 和 `expectedRevision`；创建对局除外。

## 2. 通用信封

### 2.1 成功响应

```json
{
  "data": {},
  "meta": {
    "gameId": "game-id",
    "revision": 3,
    "eventCursor": 12
  }
}
```

没有对局语义的健康检查可以省略 `meta`。

### 2.2 错误响应

```json
{
  "error": {
    "code": "INVALID_TRANSITION",
    "message": "当前阶段不能执行该操作",
    "details": {}
  }
}
```

| HTTP | `code` | 含义 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 请求结构、文本长度、句数或字段值不合法 |
| 403 | `ACTOR_NOT_ALLOWED` | 行动者不是当前允许的玩家 |
| 404 | `GAME_NOT_FOUND` | 对局不存在 |
| 409 | `ACTIVE_GAME_EXISTS` | 已有未完成对局 |
| 409 | `REVISION_CONFLICT` | `expectedRevision` 已过期 |
| 409 | `INVALID_TRANSITION` | 当前状态或阶段不允许该命令 |
| 409 | `IDEMPOTENCY_CONFLICT` | 相同命令 ID 携带不同请求语义 |
| 422 | `CONTENT_REJECTED` | 原词泄露等内容规则拒绝；不回显违规原文 |
| 503 | `MODEL_ACTION_FAILED` | 预留给后续真实模型重试；当前假模型链路的未分类策略异常返回安全 `INTERNAL_ERROR` |
| 503 | `LOCAL_DATA_UNAVAILABLE` | 数据库繁忙等待耗尽或服务处于受限诊断状态；不返回文件路径或 SQL |
| 500 | `INTERNAL_ERROR` | 未分类服务错误；不得泄露堆栈或敏感配置 |

错误详情只能包含安全的字段名、允许值、修订号、错误类别和重试进度。

## 3. `HumanGameView`

进行中视图至少包含：

```text
gameId
status
phase
revision
eventCursor
config: difficulty, undercoverCount
human: playerId, displayName, silhouette, ownWordCard
players[]: playerId, seatIndex, kind, displayName, alive, agentRoleDisplay
round: number, speakingOrder, currentActorId, actionType
publicTimeline[]
voteProgress: completedPlayerIds（揭晓前不含目标）
allowedCommands[]
operationalStatus: 当前安全状态与重试进度
```

当前 `HumanGameView` 在正常终局、已放弃终局和系统异常终止时返回与状态一致的字段：`finished` 包含 `winnerCamp`、`reveal` 和 `factReview`；`abandoned` 与 `system_terminated` 不包含这些字段。进行中和等待观战状态不得出现完整揭晓。系统异常终止只返回脱敏错误类型，不返回模型响应或配置细节。

## 4. REST 端点

### 4.1 系统与恢复

| 方法与路径 | 用途 | 响应 |
| --- | --- | --- |
| `GET /api/health` | 本地服务存活检查 | 服务状态；后续增加正常/受限诊断标记，不包含路径、SQL 或配置值 |
| `GET /api/games/active` | 查询唯一未完成对局 | `{ game: HumanGameView | null }` |
| `GET /api/games/:gameId` | 获取当前人类视图 | `HumanGameView` |
| `GET /api/games/:gameId/events?after=<streamSeq>` | SSE 失败时补取安全公开帧 | `PublicStreamEntry[]` 与当前游标 |

“未完成”包括 `preparing`、`in_progress` 和 `awaiting_spectator`，不包括三个终局状态。

下一阶段中，`GET /api/games/active` 对“中断后等待玩家确认”的进行中对局返回安全恢复状态与允许命令。继续上一局和开始新局均为带稳定 `commandId`、`expectedRevision` 的显式命令；具体路由与共享 Schema 在 TASK-074 实现时固化。开始新局必须先原子地把旧局记为无胜者“中断后未继续”，不能复用主动放弃或模型失败端点。

### 4.2 创建与开始

`POST /api/games`

```text
commandId
human.displayName?      缺省为“玩家”
human.silhouette        允许值之一
difficulty              easy | hard
```

模型阵容、玩家数量和卧底人数不由首版浏览器提交。服务端创建固定阵容，随机分配卧底和词组，返回 `preparing` 视图。若存在未完成对局，返回 `ACTIVE_GAME_EXISTS`。

`POST /api/games/:gameId/start`

```text
commandId
actorId
expectedRevision
```

仅当前人类可在 `preparing` 调用。成功后进入第 1 回合；词牌在浏览器中的翻面状态不提交服务端。

### 4.3 公开发言

`POST /api/games/:gameId/descriptions`

```text
commandId
actorId
expectedRevision
text
```

只允许 `speaking` 阶段的当前行动者。服务端执行长度、句数和原词确定性校验；失败不产生公开事件。

`POST /api/games/:gameId/defenses`

字段同描述，只允许 `tie_defense` 阶段的当前候选。描述与辩解共用内容校验器，但命令和事件类型保持分离。

### 4.4 投票

`POST /api/games/:gameId/votes`

```text
commandId
actorId
expectedRevision
targetPlayerId
```

- `voting`：投票者为所有存活玩家，目标为另一名存活玩家。
- `revoting`：投票者为非平票候选的存活玩家，目标必须是平票候选。
- 成功响应和随后的 SSE 在全部投票完成前均不得包含 `targetPlayerId` 的公开投影。
- 最后一票提交后，服务端通过独立 `votes_revealed` 帧一次性公开本阶段所有投票关系。

### 4.5 观战与退出

`POST /api/games/:gameId/spectate`

```text
commandId
actorId
expectedRevision
```

仅被淘汰人类可在 `awaiting_spectator` 调用。成功后恢复 AI 自动推进；视图继续使用普通公开信息边界。

`POST /api/games/:gameId/abandon`

```text
commandId
actorId
expectedRevision
confirmed: true
```

浏览器必须先完成二次确认。服务端仍要求显式 `confirmed: true`，成功后对局进入 `abandoned`，不返回阵营胜者。

### 4.6 模型档案（DEC-085）

| 端点 | 用途 | 返回体 |
| --- | --- | --- |
| `GET /api/model-profiles` | 读取三角色档案与当前所选 model ID | `{ providerMode, providerConfigured, reviewModelConfigured, editable, profiles[] }` |
| `GET /api/models` | 服务端代理中转站可选 model 目录 | `{ providerMode, models[] }`；`fake` 或未配置时 `models` 为空 |
| `PUT /api/model-profiles/:roleId` | 写入角色所选 model ID | 更新后的档案列表 |

- `profiles[]` 每项含 `roleId`、`displayName`、`personalityTags[3]`、`personalityPrompt`、`selectedModelId`（可空）。
- 响应绝不包含 Base URL、API Key、请求头或完整模型响应；只暴露 model ID（继承 DEC-082/DEC-052）。
- `providerMode` 为 `fake`、`tokendance` 或 `openai-compatible`；`providerConfigured` 表示 Base URL 与 API Key 是否均已在服务端 env 就绪，`reviewModelConfigured` 只公开评测 model 是否已配置的布尔值。
- 通用模式的 `selectedModelId` 不回退共享默认值；中转站没有 `/models` 时 `GET /api/models` 可以失败或返回空目录，前端仍允许手填 model ID。
- `editable=false` 表示存在锁定修改的活动局；前端还会结合 `providerConfigured`，在假模型或真实 Provider 未配置时禁用输入。
- 存在活动局（`in_progress` / `awaiting_spectator`）时 `PUT` 返回 409 拒绝改配置；未知 `roleId` 返回 404。
- `POST /api/games/:gameId/start` 在通用模式三角色或评测 model 未配齐时返回 409 `MODEL_CONFIGURATION_REQUIRED`；消息不包含 Base URL、Key 或具体环境变量值。

### 4.7 本地 Agent 诊断（规划）

只有服务端 `AGENT_DEVELOPER_MODE=true` 时才注册专用诊断路由并向前端返回安全的“诊断能力可用”布尔值；默认和普通模式不注册路由、不返回记录，直接构造 URL 也不能读取诊断数据。

脱敏诊断投影供 Agent 面板查询调用链、上下文清单结果、模型尝试、熔断和复盘队列状态。面板内可切换当前服务会话的完整上下文记录；该状态只保存在服务端内存，重启自动关闭。完整 Prompt/响应只能按单条记录、再次确认后读取，并继续过滤 Base URL、Key、请求头和本地文件路径。所有诊断接口均不得推进游戏、修改队列、删除长期审计或重新发起模型调用；清除完整调试文件使用独立确认操作。



`GET /api/games/:gameId/stream`

请求可携带标准 `Last-Event-ID`；首次连接从当前安全快照开始。响应头至少满足：

```text
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

每帧格式：

```text
id: <streamSeq>
event: <type>
data: <PublicStreamPayload JSON>
```

### 5.1 允许的帧

| `event` | 内容边界 |
| --- | --- |
| `state_synced` | 当前 `HumanGameView` 与游标 |
| `agent_activity` | 预留给后续更细运行状态；当前主要通过 `HumanGameView.operationalStatus` 表示 AI 工作中 |
| `domain_event` | 领域事件类型直接作为 SSE `event` 名称持久化和发送；不存在统一字面量 `domain_event` 帧 |
| `vote_progressed` | 完成投票的角色，不含目标 |
| `votes_revealed` | 全部完成后的一次性投票关系 |
| `terminal_reveal_ready` | 终局事实已持久化，可以开始前端揭晓 |
| `stream_error` | 保留事件类型；当前自动重试期间不发布技术错误，恢复耗尽后以 `game_system_terminated` 通知 |
| `heartbeat` | 无业务数据的连接保活 |

### 5.2 重连算法

1. 服务端读取 `Last-Event-ID`，补发之后的 `public_stream_entries`。
2. 补发与实时订阅必须以同一高水位衔接，不得遗漏或乱序。
3. 随后发送或确认当前 `state_synced`；客户端以更高 `revision/streamSeq` 为准。
4. 客户端按 `streamSeq` 去重，收到旧帧不得倒退状态。
5. 若客户端游标无效，服务端返回完整安全视图并从当前高水位继续；不得返回私有原始事件补洞。

`heartbeat` 可以不持久化；它不得推进业务游标。运行状态在重连后以 `HumanGameView.operationalStatus` 恢复。

客户端对一次待确认人类命令必须复用原 `commandId`：网络响应丢失后先读取 `HumanGameView`/命令结果判断是否已经提交，只有确认未提交时才重发相同语义。`REVISION_CONFLICT` 触发权威视图刷新，不得归类为模型失败。

## 6. 公开投影规则

### 6.1 对局进行中

允许：配置中的难度和卧底人数、玩家显示信息、存活状态、当前阶段、公开描述/辩解、已统一揭晓的历史投票、淘汰名单和非信息性 AI 状态。

禁止：

- 任何玩家的真实阵营。
- 除当前人类本人外的词牌。
- 当前阶段尚未统一揭晓的投票目标。
- 投票理由、身份概率、异阵营词候选和其他 Agent 私有信念。
- 模型原始输出、格式修复内容和被拦截的描述。

### 6.2 人类淘汰后

继续使用同一公开投影，不增加上帝视角。`allowedCommands` 只包含 `ContinueSpectating` 或 `AbandonGame`；选择观战后人类不再获得描述、辩解或投票命令。

### 6.3 终局

- `finished`：可以返回正常胜者、全部阵营和词牌、确定性事实与私有信念历史。
- `abandoned`：返回放弃状态和截至放弃时的不完整事实；不返回阵营胜者。私有揭晓范围以历史复盘实现阶段的产品规则为准，首个里程碑不伪造完整 AI 总结。
- `system_terminated`：真实模型连续失败达上限后的无胜者终局（DEC-072）。已实现：`GameService` 捕获 `AgentSystemError` 后提交 `TerminateForSystemError`，视图 `status=system_terminated`、`phase=ended`、`endReason=model_failure_limit`，`allowedCommands` 为空，不返回胜者与揭晓；公开事件 `game_system_terminated` 仅含脱敏 `failedActionId`、`errorType`。历史列表的错误摘要与不完整复盘展示留待历史里程碑。

前端逐张翻牌只是对已返回终局事实的呈现，不调用任何改变领域状态的端点。

## 7. 复盘与后续端点边界

当前服务端已提供 `GET /api/games/:gameId/review` 与 `POST /api/games/:gameId/review/regenerate`，只对正常终局返回经过 `reviewSummarySchema` 校验的异步总结状态或触发重新生成；响应仅含 model ID、状态、结构化评价和脱敏错误码。Web 已在单局复盘页轮询该状态并支持失败后重新生成。`GET /api/games/:gameId/export.md` 导出当前单局的脱敏 Markdown；跨局历史列表与跨对局复盘管理仍属后续里程碑，不得返回虚构数据。

## 8. 来源

- 需求：[`../acceptance/REQUIREMENTS.md`](../acceptance/REQUIREMENTS.md) 第 102–125、139–145、163–192 条。
- 决策：DEC-027 至 DEC-032、DEC-037 至 DEC-040、DEC-045 至 DEC-052、DEC-063、DEC-069 至 DEC-080、DEC-092 至 DEC-096。
