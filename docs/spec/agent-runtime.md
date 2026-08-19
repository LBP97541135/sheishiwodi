# Agent 运行时规格

- 状态：假模型、真实模型运行时、调用台账、结构化上下文审计、出网前边界门禁、完整调试记录、开发者面板与轻量熔断已实现
- 适用范围：`FakeAgentPolicy` 与 OpenAI Chat Completions 兼容策略（由 `AGENT_PROVIDER` 切换）

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

- **运行时（`createRuntimeDependencies` 置 `true`）**：`startGame` 与人类操作在持久化本次转移后立即返回当前视图，AI 回合经 `settleAdvance` 异步推进（`void advanceUntilHumanOrStop(...).catch(...)`），前端靠 SSE 实时接收逐帧公开状态。这样开始/操作请求不会被真实模型的串行往返长时间阻塞——界面立即跳入对局并显示"某 AI 正在思考"，而不是卡在"正在开始…"。后台推进遇到未分类程序异常时，不将其伪装为模型失败或自动重试；服务端持久化等待玩家确认的运行中断，并发布不含异常详情的 `runtime_interrupted` 流帧。日志仍只打印 `error.name`，绝不外泄 Key/URL。
- **测试（`createTestEnvironment` 默认 `false`）**：`settleAdvance` 同步 `await advanceUntilHumanOrStop(...)`，保证断言能确定地读到已推进到下一个人类行动者（或终局）的状态。

同一进程内 `advancingGames` 去重保证同一对局的推进循环不会并发重入；后台与同步两条路径共用同一 `runAdvanceLoop`，行为一致，仅返回时机不同。存在 `awaiting_confirmation` 中断记录时，服务启动恢复和 SSE 重连都不得自动推进，必须等待玩家选择继续或开始新局。

E2E 通过 `playwright.config.ts` 的服务端 `webServer.env` 预置 `AGENT_PROVIDER=fake` 与空 `TOKENDANCE_*`，强制走 `FakeAgentPolicy`：`main.ts` 的 `loadDotEnv()` 对"已存在的环境变量"不覆盖，故即便本机 `.env` 配了任一真实 Provider 与 Key，E2E 仍绝不联网、绝不读 Key、绝不消耗付费额度。`helpers.ts` 的轮询循环改用挂钟截止时间兜底，避免把后台推进期间"当前是 AI 行动者"的自旋等待计入固定步数预算而误判超时。

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

## 11. 真实模型接入与配置

真实模型通过 OpenAI Chat Completions 兼容中转站接入。所有参赛角色与复盘 Agent 共用所选 Provider 的基础地址、认证密钥、客户端、超时和错误映射，仅通过 `modelId` 区分。`provider-runtime.ts` 集中解析运行环境，避免 Server 装配层散落厂商分支。参见 DEC-085、DEC-089。

服务端环境变量（只在服务端 env，绝不进入浏览器、数据库、日志、仓库或复盘）：

```text
AGENT_PROVIDER=fake|tokendance|openai-compatible
TOKENDANCE_BASE_URL=https://tokendance.space/gateway/v1
TOKENDANCE_API_KEY=              # 由负责人自填于 gitignored .env，禁止写入仓库
TOKENDANCE_DEFAULT_MODEL=        # 角色缺持久化 modelId 时的回退默认
TOKENDANCE_REVIEW_MODEL=         # 可回退 DEFAULT_MODEL / 兼容常量
TOKENDANCE_TIMEOUT_MS=           # 单次模型请求超时（毫秒），默认 60000
TOKENDANCE_MAX_RETRIES=          # 系统级失败最大重试次数，默认 2
TOKENDANCE_RETRY_DELAY_MS=       # 每次重试前等待毫秒，默认 800
TOKENDANCE_EXTRA_BODY=           # 通用兜底：其他模型的附加请求参数（JSON），会被家族专用关推理参数覆盖

OPENAI_COMPATIBLE_BASE_URL=      # 通用中转站，必填
OPENAI_COMPATIBLE_API_KEY=       # 通用中转站，必填
OPENAI_COMPATIBLE_REVIEW_MODEL=  # 通用模式评测 model，必填且无回退
OPENAI_COMPATIBLE_TIMEOUT_MS=    # 默认 60000
OPENAI_COMPATIBLE_MAX_RETRIES=   # 默认 2
OPENAI_COMPATIBLE_RETRY_DELAY_MS=# 默认 800
OPENAI_COMPATIBLE_EXTRA_BODY=    # 中转站自定义请求参数 JSON
OPENAI_COMPATIBLE_MODEL_EXTRA_BODY= # 精确 model ID → 单次请求参数对象
```

- Provider 开关默认 `fake`；`dev`、`test`、`test:e2e` 恒为假模型，绝不联网、不读 Key。仅 `pnpm test:live` 显式触发真实调用。
- 可下发到浏览器并持久化的只有 model ID；Base URL、API Key、请求头、完整模型响应绝不下发或落库（继承 DEC-082/DEC-052）。
- 角色 `modelId` 持久化于 server-only 表 `agent_role_models`；存在活动局（`in_progress` / `awaiting_spectator`）时拒绝改配置。
- Tokendance 保持共享角色默认 ID、`TOKENDANCE_DEFAULT_MODEL` 与复盘默认的向后兼容。
- `openai-compatible` 不读取任何内置或统一默认 model：三角色必须在模型档案手填或从 `/models` 建议中选择，复盘必须设置 `OPENAI_COMPATIBLE_REVIEW_MODEL`。三角色或复盘任一未配齐时，`StartGame` 返回 `MODEL_CONFIGURATION_REQUIRED`，不发起模型调用。
- 通用模式不自动注入按模型名推断的厂商推理参数。`OPENAI_COMPATIBLE_EXTRA_BODY` 提供全局基础参数；`OPENAI_COMPATIBLE_MODEL_EXTRA_BODY` 以精确 model ID 为键，为三个参赛模型和评测模型分别提供单次请求参数。model 专属对象覆盖全局同名顶层字段；未命中时为空。最终 `model/messages` 在两层 env 合并后由客户端强制写入，不能被配置替换。
- 错误兜底：一次格式修复（DEC-034）→ 有限系统重试 → `system_terminated`（DEC-072），见第 9 节。
- **关闭推理链（加速直出）**：`agents/model-reasoning.ts` 的 `reasoningDisableBodyFor(modelId)` 按模型家族计算关推理参数，`TokendanceAgentPolicy` 每次调用作为 `extraBody` 透传，优先级高于 `TOKENDANCE_EXTRA_BODY`。经真实中转站实测（2026-08-17）：`qwen*`→`{enable_thinking:false}`（约 48s→7s）；`seed*`/`doubao*`→`{thinking:{type:'disabled'}}`（约 168s→7.4s）；`deepseek*`→`{thinking:{type:'disabled'}}`（约 12s→1.5s，注意 deepseek 会忽略 `enable_thinking`）。其他模型不附加任何参数、行为不变。这些参数只是模型请求体字段，绝不含 Base URL / API Key / 请求头。默认超时从 20000 提高到 60000，避免推理延迟触发“超时→重试→多次调用”风暴。

复盘 Agent 使用独立 `modelId`、提示模板和完整终局上下文，但复用所选 Provider 的连接。它只能在终局事实持久化后运行，其输出与确定性事实分开保存和展示。

复盘评价必须结论先行，并按“判断更新、行动一致性、实际影响”的优先级分析。评价只能使用行动当时可见的信息，不能根据最终胜负倒推表现；单个 AI 的简评控制在 60～100 个中文字符，包含最强事实依据和一条具体改进，关键节点最多 2 条；总体点评控制在 100～160 个中文字符，只提炼胜负手、关键转折和最大反事实。1～5 分使用统一行为锚点，不按所属阵营最终输赢直接评分。禁止复述规则、身份词牌或完整流程，禁止空泛表扬、编造事实和长段照抄私有信念。

## 12. 调用观测、上下文审计与熔断

本节对应 DEC-095/096，调用台账、上下文门禁、完整调试记录与清理、本地面板、轻量熔断和可选 `TelemetrySink` 接口均已实现。现有三个模型的超时配置和第 9 节恢复语义不变。

### 12.1 调用链与持久化元数据

当前已实现。

每次模型调用必须归入以下稳定链路：

```text
gameId -> commandId -> actionId -> attemptId
```

- `commandId` 表示触发本轮推进的人类命令或系统调度命令。
- `actionId` 表示某名 Agent 在指定修订号上的语义动作；并行投票每名 Agent 独立。
- `attemptId` 表示一次实际模型请求，格式修复、内容重生成和系统重试均产生新的尝试记录。
- `model_attempts` 只保存角色、model ID、动作类型、尝试序号、开始/结束时间、耗时、最终结果分类和恢复类型等脱敏元数据；关联的 `model_attempt_stages` 保存阶段及发生时间。

### 12.2 上下文清单与调用前门禁

当前已实现基础版本：每次真实参赛 Agent 与复盘模型请求先登记独立 attempt，再写入结构化清单；清单写入失败或边界校验失败均不会发出模型请求。

Harness 组装 `AgentTurnInput` 时同时产生结构化上下文清单，至少描述每段输入的来源、可见级别、公开事件游标、Prompt 模板版本和内容哈希。调用前必须执行确定性边界检查：

- 只允许目标 Agent 自己的词牌和私有历史。
- 只允许截至当前公开游标的描述、已揭晓投票与淘汰信息。
- 禁止其他玩家词牌、其他 Agent 私有信念、当前未揭晓选票、真实阵营和未来事件。
- 校验失败时以 `context_boundary_violation` 阻止请求，不进入模型，也不产生公开游戏事件。

结构化清单写入独立的本地审计文件，不混入普通日志或业务数据库。完整 Prompt 与原始响应默认关闭；显式调试模式开启后仍须过滤 API Key、Base URL、请求头，并写入 Git 忽略目录。

`model_attempts` 已通过数据库外键随对局级联删除。完整 Prompt/响应调试文件执行“最多 7 天 + 可配置本地容量上限”，服务启动时清理，并可从面板主动清除；清理器不删除长期元数据和结构化清单。

### 12.3 本地调试面板

当前已实现。

`AGENT_DEVELOPER_MODE=true` 是服务端权威总门禁，默认关闭。关闭时不装配诊断路由、不返回诊断能力标记或数据，前端也不渲染入口；开启后，前端设置区才显示只保存在当前标签页的开发者模式开关。

前端开关打开后显示只读面板，按“调用链、上下文、错误与恢复、复盘调度”组织 Agent、动作、上下文类型、边界校验、耗时、重试、格式修复、内容重生成、阶段链、最终结果分类、熔断状态和后台复盘状态。基础 `model_attempts`、`model_attempt_stages` 与结构化上下文清单始终记录，不受面板显示开关影响。

面板内的“记录完整上下文”是第二个敏感开关：默认关闭、开启前确认、只保存在服务端进程内并在重启后自动复位。开启后新产生的完整 Prompt/原始响应可在面板逐条查看，但每条必须再次确认才展开；查询仍须过滤 Key、Base URL、请求头，完整记录继续执行 7 天和容量清理。面板不可推进游戏、修改审计数据或重放付费请求。

### 12.4 轻量 Provider 熔断

当前已实现。参赛 Agent 与复盘评价共享同一个单进程、单 Provider 熔断器；断路器在整次逻辑动作开始前检查，不切断该动作内部已经获准的既有有限重试。

- 认证失败、权限错误、模型不存在等确定性配置错误立即打开熔断，阻止新的无意义调用。
- 网络、429 和 5xx 先沿用第 9 节的有限重试；短时间连续失败达到配置阈值后进入短暂冷却。
- 冷却结束只允许一个探测请求；成功关闭熔断，失败继续冷却。
- 已经发出的请求不因熔断强制取消；熔断错误使用脱敏分类返回，当前状态通过开发者面板的“错误与恢复”视图投影。
- 熔断器为单进程、单 Provider 的轻量组件；首版本不建设分布式协调。

项目定义的调用语义可通过可选 `TelemetrySink` 输出 attempt 开始/结束的脱敏事件；默认使用空实现。当前事实源仍为本地 SQLite 与审计文件；第三方平台只能作为未来适配器，不能成为运行依赖或绕过上下文脱敏边界。

### 12.5 上下文来源证明与尝试阶段（已实现）

- 当前已实现：参赛 Agent 输入只能由服务端唯一 `AgentContextAssembler` 产生。组装器直接从权威仓库按 `gameId + actorPlayerId` 读取该 Agent 自有信念，并从 `visibility=public` 查询构造公开时间线。
- 当前已实现：组装器签发与具体输入内容绑定的来源证明，记录 game、actor、信念所有者、公开可见性、公开游标和输入哈希。出网门禁同时验证进程内签发身份和 SHA-256，调用者手写同形对象不能通过。
- 当前已实现：Prompt 构造前替换公开事件、私有信念、actor 或 game 会使证明失效，并在客户端调用前记录 `context_boundary_violation`。
- 当前已实现：模型尝试生命周期依次记录 `request_started`、`provider_returned`、`schema_validated`、`content_validated` 与 `action_committed`；Provider 返回不等于领域动作成功。只有最终动作或复盘摘要持久化后，`resultCode` 才能写为 `action_committed`。
- 启动恢复会先用 `agent_actions` 或状态为 `done` 的 `review_summaries` 对账：若业务结果已提交但观测终态尚未来得及写入，则补记 `action_committed`，不把它误报为运行时中断。
- 当前已实现：内容拒绝、领域拒绝、过期丢弃和事务失败分别保留 `content_rejected`、`domain_rejected`、`stale_discarded`、`commit_failed` 终态。并行投票每名 Agent 独立关联 attempt；同批未消费结果在其他调用导致流程停止时统一标为过期。结构已通过但尚未提交的 attempt 保持活动态，因此进程中断仍能被既有恢复机制捕获。
- 当前已实现：信念与复盘中按玩家输出的集合显式检查 `playerId` 唯一性和完整覆盖。
- 当前已实现：复盘新生成契约与提示词统一为每名 AI 的 verdict 60～100 个字符、keyMoments 1～2 条且单条最多 50 个字符、rating 必填为 1～5 整数、overall 100～160 个字符。持久化摘要继续兼容既有较短内容以及 pending/failed 空内容。
- 零宽字符词面归一化不属于本轮范围，保留为已知残余风险。

## 13. 来源

- 需求：[`../acceptance/REQUIREMENTS.md`](../acceptance/REQUIREMENTS.md) 第 20–29、51–85、109–145、187–192 条。
- 决策：DEC-004、DEC-005、DEC-010 至 DEC-015、DEC-017 至 DEC-021、DEC-029 至 DEC-039、DEC-052 至 DEC-054、DEC-068、DEC-072 至 DEC-074、DEC-082、DEC-086、DEC-092、DEC-093、DEC-095、DEC-096、DEC-097。
