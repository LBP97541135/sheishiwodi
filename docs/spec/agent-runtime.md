# Agent 运行时规格

- 状态：假模型运行时已实现；真实模型（Tokendance 中转）与错误兜底已实现
- 适用范围：`FakeAgentPolicy` 与统一中转 `TokendanceAgentPolicy`（由 `AGENT_PROVIDER` 切换）

## 1. 目标

每名 AI 玩家必须像独立参与者一样，只基于自己的词牌、公开配置和当时已公开的事件作出判断。Agent 运行时负责信息投影、结构化调用、结果校验、错误恢复和私有快照，不负责决定阶段、合法行动者或胜负。

## 2. 组件边界

```text
GameService.advanceUntilHumanOrStop（已实现）
  -> buildAgentTurnInput（已实现）
  -> AgentPolicy（FakeAgentPolicy 或 TokendanceAgentPolicy）
  -> shared 输出/信念 Schema 校验（已实现）
  -> Domain Command（已实现）

真实模型链路（已实现）：
  -> TokendanceAgentPolicy（OpenAI 兼容中转）
  -> strict 输出校验 + 一次格式修复 + 内容重生成 + 有限系统重试（可注入 sleep）
  -> AgentSystemError -> GameService 兜底 terminateForSystemError -> system_terminated
```

| 组件 | 当前状态与职责 |
| --- | --- |
| `buildAgentTurnInput` | 已实现；从权威状态生成某一 Agent 的最小输入白名单 |
| `AgentPolicy` | 已实现接口；根据输入返回结构化信念和行动提案 |
| `FakeAgentPolicy` | 已实现；支持 `normal` 与 `tie-then-eliminate` 两个显式场景，不访问网络 |
| `TokendanceAgentPolicy` | 已实现；通过统一 OpenAI 兼容客户端按角色 `modelId` 调用；执行 strict 结构校验、一次格式修复与按可重试性分类的系统重试 |
| shared 输出校验 | 已实现；执行 strict Schema、概率、目标和内容校验，并由服务层处理内容重生成与重复泄词恢复 |
| `GameService` | 已实现假/真模型自动推进、停止条件、持久化、恢复，以及 `AgentSystemError` 兜底为 `system_terminated` |

策略实现不得直接读取数据库。编排层先生成不可变 `AgentTurnInput`，策略只能读取该对象。

## 2.1 推进模式：后台推进与测试同步

`GameService` 通过依赖注入的 `backgroundAdvance` 布尔开关决定人类命令提交后如何驱动后续 AI 回合：

- **运行时（`createRuntimeDependencies` 置 `true`）**：`startGame` 与人类操作在持久化本次转移后立即返回当前视图，AI 回合经 `settleAdvance` 异步推进（`void advanceUntilHumanOrStop(...).catch(...)`），前端靠 SSE 实时接收逐帧公开状态。这样开始/操作请求不会被真实模型的串行往返长时间阻塞——界面立即跳入对局并显示"某 AI 正在思考"，而不是卡在"正在开始…"。后台推进失败只脱敏记日志（仅打印 `error.name`），绝不外泄 Key/URL。
- **测试（`createTestEnvironment` 默认 `false`）**：`settleAdvance` 同步 `await advanceUntilHumanOrStop(...)`，保证断言能确定地读到已推进到下一个人类行动者（或终局）的状态。

同一进程内 `advancingGames` 去重保证同一对局的推进循环不会并发重入；后台与同步两条路径共用同一 `runAdvanceLoop`，行为一致，仅返回时机不同。

E2E 通过 `playwright.config.ts` 的服务端 `webServer.env` 预置 `AGENT_PROVIDER=fake` 与空 `TOKENDANCE_*`，强制走 `FakeAgentPolicy`：`main.ts` 的 `loadDotEnv()` 对"已存在的环境变量"不覆盖，故即便本机 `.env` 配了 `tokendance`+真实 Key，E2E 仍绝不联网、绝不读 Key、绝不消耗付费额度。`helpers.ts` 的轮询循环改用挂钟截止时间兜底，避免把后台推进期间"当前是 AI 行动者"的自旋等待计入固定步数预算而误判超时。

## 3. 角色配置

角色配置包含：

```text
agentRoleId
displayName
personalityTags[3]
personalityPrompt
modelId（服务端权威；可在"模型档案"界面选择并持久化，仅下发 model ID，见 DEC-085）
```

首版固定 DeepSeek、豆包、千问三个显示角色。三者共享完全相同的规则、输入字段、输出 Schema、校验和调用参数基线，只增加简短轻人格提示。人格提示不得：

- 改变可见信息或规则。
- 要求额外私有字段。
- 允许自投、弃票或泄露词牌。
- 声称未经验证的厂商或模型能力。

浏览器身份卡可展示完整人格提示；系统控制提示不得在身份卡显示。

## 4. `AgentTurnInput` 白名单

每次行动输入只能包含：

```text
gameId 的临时调用引用
actor: playerId, displayName, ownWordCard
publicConfig: undercoverCount, difficulty
players: playerId, displayName, alive, seatIndex
roundNumber
actionType: describe | vote | defend | revote
legalTargets[]（描述/辩解时为空）
tieCandidates[]（仅相关阶段）
publicEvents[]（只到本次 baseRevision 的公开上界）
priorOwnBeliefs[]（仅该 Agent 自己的历史快照，按代码策略裁剪）
personalityPrompt
outputContract
```

`publicEvents` 可以包含合法描述、辩解、已经统一揭晓的历史投票关系、淘汰名单和公开阶段变化。

严禁进入输入：

- 任意玩家的真实阵营，包括 Agent 自己。
- 其他玩家的词牌或完整词库映射。
- 其他 Agent 的信念、候选词、投票理由和原始输出。
- 本阶段尚未统一揭晓的选票目标。
- 被拦截的违规文本、失败格式修复原文或服务端内部错误详情。
- 密钥、敏感中转地址、请求头、数据库实体或后台复盘上下文。

投影器必须通过负向测试证明这些字段不存在，不能只靠提示词告知模型“不要使用”。

## 5. 私有信念 Schema

```text
BeliefSnapshot
  opposingWordCandidates[]
    word: 非空短文本
    confidence: 0..1
    evidence: 简短依据
  playerUndercoverProbabilities[]
    playerId
    probability: 0..undercoverCount
  reasoningSummary: 简短、可复盘的判断依据
```

约束：

- `playerUndercoverProbabilities` 覆盖所有存活玩家并包含当前 Agent。
- 概率总和必须在允许数值误差内等于 `undercoverCount`，不得写死为 1。
- 每个 `playerId` 只出现一次，不能包含已淘汰或未知玩家。
- 异阵营词允许多个候选；置信度不要求总和为 1。
- `reasoningSummary` 是面向复盘的简要依据，不要求保存模型隐式思维链。
- 信念与对应动作一起冻结，后续更新不得覆盖历史记录。

## 6. 行动输出 Schema

### 6.1 描述与辩解

```text
SpeechActionOutput
  belief: BeliefSnapshot
  text: string
```

描述使用 `actionType=describe`，辩解使用 `actionType=defend`。两者文本共用确定性内容校验，但提示任务和领域事件保持不同。

### 6.2 投票与重投

```text
VoteActionOutput
  belief: BeliefSnapshot
  targetPlayerId: string
  reason: string
```

- 普通投票目标必须属于 `legalTargets`。
- 重投目标必须属于 `tieCandidates` 和 `legalTargets`。
- `reason` 和 `belief` 在统一揭晓前及整个进行中对局保持私有。

模型响应必须只提供约定 JSON。原生 JSON Schema 响应模式可以作为单模型优化，但统一中转接入不能依赖其存在。

## 7. 提示分层

运行时按以下顺序构造请求：

1. **系统控制模板**：规则、信息边界、行动任务、输出 Schema、自检要求。
2. **人格提示**：单个角色的简短表达倾向。
3. **本次私有输入**：自己的词牌和自身历史信念。
4. **本次公开输入**：公开配置、玩家列表和截至当前的公开事件。

开发规格只固定每层职责、变量和禁区。完整模板文本由代码单一维护并接受测试，避免文档和运行模板形成两个事实源。

系统控制模板必须要求模型在返回前检查：

- 文本未出现自己的词牌原词。
- 输出是合法 JSON 且字段完整。
- 投票目标在允许集合中。
- 没有把私有信念写入公开文本。

提示自检不能替代服务端校验。

## 8. 确定性内容校验

描述与辩解依次执行：

1. 输入为字符串。
2. 字符数为 2 至 40。
3. 最多两句。
4. 原词泄露检查。

原词检查对文本与词牌执行同一规范化：

- Unicode 规范化。
- 英文字母大小写统一。
- 移除空格与预定义的常见中英文标点。
- 规范化描述连续包含完整规范化词牌时判定泄露。

同音字、拼音、隐喻、拆字、编辑距离和语义相似度不触发确定性处罚。被拒绝的原文不得公开、写入其他 Agent 上下文、日志或复盘。

首个里程碑已实现校验器及“拒绝后不发布”的契约；连续两次泄词时公开安全违规结论、强退违规玩家并立即判断胜负。

## 9. 结构修复、内容重生成与系统重试（已实现）

`TokendanceAgentPolicy` 实现以下契约（`FakeAgentPolicy` 不涉及网络，不走此路径）：

```text
初始模型调用
  -> 若 JSON/Schema/信念/目标错误：一次仅修复结构的请求
  -> 若长度/句数错误：秘密作废并重新生成一次
  -> 若首次原词泄露：秘密作废并重新生成一次
  -> 若第二次原词泄露：规则违规强退并立即判断胜负
  -> 结构修复仍失败，或网络/超时/限流/服务端/空响应错误：进入系统重试
  -> 最多自动重试 3 次，每次前等待 2 秒
  -> 仍失败：提交 TerminateForSystemError
```

- 连同初始动作执行，同一行动最多四次有效尝试；每个重试周期仍可包含一次格式修复。
- 自动恢复期间 SSE/视图只显示非信息性的工作或重试状态；耗尽后才公开脱敏错误摘要，不显示失败响应或违规内容。
- 等待通过可注入 `sleep` 实现，测试不真实等待。
- 所有尝试复用同一个稳定 `actionId`；失败尝试不得生成公开领域行动。
- 若 `baseRevision` 在调用期间变化，结果作废并依据新状态重新判断，不能提交旧动作。
- 三次重试后进入不可恢复 `system_terminated`，不判阵营胜负。`TokendanceAgentPolicy.act` 抛出脱敏 `AgentSystemError`（如 `MODEL_NOT_CONFIGURED`、`CALL_FAILED`、`FORMAT_INVALID`），`GameService.runAdvanceLoop` 捕获后提交 `TerminateForSystemError`，状态机进入 `system_terminated`、`endReason=model_failure_limit`；异常不外泄为 500。

错误分类与重试性：

| 分类 | 是否自动重试 | 最终安全错误 |
| --- | --- | --- |
| timeout / network | 是 | `CALL_TIMEOUT` / `NETWORK_FAILED` |
| HTTP 429 | 是，尊重统一等待预算 | `RATE_LIMITED` |
| HTTP 5xx | 是 | `PROVIDER_UNAVAILABLE` |
| empty/bad response | 是 | `BAD_RESPONSE` |
| HTTP 401/403 | 否 | `AUTH_FAILED` |
| HTTP 404 / model missing | 否 | `MODEL_NOT_FOUND` |
| JSON/Schema/belief/target | 一次格式修复，随后进入系统重试 | `FORMAT_INVALID` |
| content length/sentence | 一次内容重生成 | `CONTENT_INVALID` |
| word leak | 首次重生成，第二次规则强退 | 不属于系统错误 |
| stale revision | 丢弃，不计模型错误 | 无公开错误 |
| persistence failure | 只重试提交 | `INTERNAL_ERROR`（耗尽后） |

## 10. 假模型契约

当前 `FakeAgentPolicy` 实际支持：

- 与真实策略共用 `AgentTurnInput` 和结构化输出类型。
- `normal`：按座位产生确定性描述/辩解，投给首个合法目标。
- `tie-then-eliminate`：首轮构造部分平票，并在重投选择首个平票候选。
- 保存收到的输入和每个 Agent 的信念历史，供隔离测试与终局事实复盘。
- 不读取环境密钥、不访问网络。

`tie-again`、`all-tied`、`human-eliminated` 目前由共享/服务端测试通过确定性投票或随机序列覆盖，不是 `FakeAgentScenario` 的独立枚举。格式修复、瞬时错误、失败上限和系统异常终止已由真实策略测试与服务端集成测试覆盖。

默认开发、单元、集成和端到端测试只使用假模型。

## 11. 真实模型接入与配置（Tokendance 中转）

真实模型通过统一 OpenAI 兼容中转站接入，所有参赛角色与复盘 Agent 共用同一基础地址、认证密钥、客户端、超时和错误映射，仅通过角色 `modelId` 区分。参见 DEC-085。

服务端环境变量（只在服务端 env，绝不进入浏览器、数据库、日志、仓库或复盘）：

```text
AGENT_PROVIDER=fake|tokendance   # 默认 fake；仅当为 tokendance 且 Base URL、API Key 均非空时才实例化真实策略
TOKENDANCE_BASE_URL=https://tokendance.space/gateway/v1
TOKENDANCE_API_KEY=              # 由负责人自填于 gitignored .env，禁止写入仓库
TOKENDANCE_DEFAULT_MODEL=        # 角色缺持久化 modelId 时的回退默认
TOKENDANCE_TIMEOUT_MS=           # 单次模型请求超时（毫秒），默认 60000
TOKENDANCE_MAX_RETRIES=          # 系统级失败最大重试次数，默认 2
TOKENDANCE_RETRY_DELAY_MS=       # 每次重试前等待毫秒，默认 800
TOKENDANCE_EXTRA_BODY=           # 通用兜底：其他模型的附加请求参数（JSON），会被家族专用关推理参数覆盖
```

- Provider 开关默认 `fake`；`dev`、`test`、`test:e2e` 恒为假模型，绝不联网、不读 Key。仅 `pnpm test:live` 显式触发真实调用。
- 可下发到浏览器并持久化的只有 model ID；Base URL、API Key、请求头、完整模型响应绝不下发或落库（继承 DEC-082/DEC-052）。
- 角色 `modelId` 持久化于 server-only 表 `agent_role_models`；存在活动局（`in_progress` / `awaiting_spectator`）时拒绝改配置。
- 错误兜底：一次格式修复（DEC-034）→ 有限系统重试 → `system_terminated`（DEC-072），见第 9 节。
- **关闭推理链（加速直出）**：`agents/model-reasoning.ts` 的 `reasoningDisableBodyFor(modelId)` 按模型家族计算关推理参数，`TokendanceAgentPolicy` 每次调用作为 `extraBody` 透传，优先级高于 `TOKENDANCE_EXTRA_BODY`。经真实中转站实测（2026-08-17）：`qwen*`→`{enable_thinking:false}`（约 48s→7s）；`seed*`/`doubao*`→`{thinking:{type:'disabled'}}`（约 168s→7.4s）；`deepseek*`→`{thinking:{type:'disabled'}}`（约 12s→1.5s，注意 deepseek 会忽略 `enable_thinking`）。其他模型不附加任何参数、行为不变。这些参数只是模型请求体字段，绝不含 Base URL / API Key / 请求头。默认超时从 20000 提高到 60000，避免推理延迟触发“超时→重试→多次调用”风暴。

复盘 Agent 使用独立 `modelId`、提示模板和完整终局上下文，但复用同一连接。它只能在终局事实持久化后运行，其输出与确定性事实分开保存和展示。本规格暂不固定异步队列表结构。

复盘评价必须结论先行，并按“判断更新、行动一致性、实际影响”的优先级分析。评价只能使用行动当时可见的信息，不能根据最终胜负倒推表现；单个 AI 的简评控制在 60～100 个中文字符，包含最强事实依据和一条具体改进，关键节点最多 2 条；总体点评控制在 100～160 个中文字符，只提炼胜负手、关键转折和最大反事实。1～5 分使用统一行为锚点，不按所属阵营最终输赢直接评分。禁止复述规则、身份词牌或完整流程，禁止空泛表扬、编造事实和长段照抄私有信念。

## 12. 来源

- 需求：[`../acceptance/REQUIREMENTS.md`](../acceptance/REQUIREMENTS.md) 第 20–29、51–85、109–145、187–192 条。
- 决策：DEC-004、DEC-005、DEC-010 至 DEC-015、DEC-017 至 DEC-021、DEC-029 至 DEC-039、DEC-052 至 DEC-054、DEC-068、DEC-072 至 DEC-074、DEC-082。
