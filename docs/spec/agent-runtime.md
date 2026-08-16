# Agent 运行时规格

- 状态：开发基线
- 适用范围：首个里程碑使用可控假模型；接口兼容后续真实模型

## 1. 目标

每名 AI 玩家必须像独立参与者一样，只基于自己的词牌、公开配置和当时已公开的事件作出判断。Agent 运行时负责信息投影、结构化调用、结果校验、错误恢复和私有快照，不负责决定阶段、合法行动者或胜负。

## 2. 组件边界

```text
Game Orchestrator
  -> AgentInputProjector
  -> AgentPolicy（FakeAgentPolicy | ModelAgentPolicy）
  -> AgentOutputValidator
  -> Domain Command
```

| 组件 | 职责 |
| --- | --- |
| `AgentInputProjector` | 从权威状态生成某一 Agent 的最小输入白名单 |
| `AgentPolicy` | 根据输入返回结构化信念和行动提案 |
| `FakeAgentPolicy` | 按测试脚本确定性返回，不访问网络 |
| `ModelAgentPolicy` | 通过统一 OpenAI 兼容客户端调用指定模型 ID |
| `AgentOutputValidator` | 执行 Zod、概率、目标、内容和阶段校验 |
| `Game Orchestrator` | 决定何时调用、重试、提交命令或异常终止 |

策略实现不得直接读取数据库。编排层先生成不可变 `AgentTurnInput`，策略只能读取该对象。

## 3. 角色配置

角色配置包含：

```text
agentRoleId
displayName
personalityTags[3]
personalityPrompt
modelId（仅服务端配置）
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

首个里程碑必须实现校验器及“拒绝后不发布”的契约；连续两次泄词强退在后续里程碑实现。

## 9. 结构修复与系统重试

每个真实模型动作的流程：

```text
初始模型调用
  -> 若 JSON/Schema 错误：一次仅修复格式的请求
  -> 修复仍失败，或网络/超时/限流/服务端错误：进入系统重试
  -> 最多自动重试 3 次，每次前等待 2 秒
  -> 仍失败：提交 TerminateForSystemError
```

- 连同初始动作执行，同一行动最多四次有效尝试；每个重试周期仍可包含一次格式修复。
- 从第一次系统重试开始，SSE 显示脱敏错误类别、当前次数和总次数。
- 等待通过可注入 `Clock` 实现，测试不真实等待。
- 所有尝试复用同一个稳定 `actionId`；失败尝试不得生成公开领域行动。
- 若 `baseRevision` 在调用期间变化，结果作废并依据新状态重新判断，不能提交旧动作。
- 三次重试后进入不可恢复 `system_terminated`，不判阵营胜负。

## 10. 假模型契约

`FakeAgentPolicy` 必须：

- 实现与真实模型策略相同的输入和输出类型。
- 根据 `gameId/round/actionType/actorId` 或测试注入脚本确定性选择输出。
- 支持脚本化正常描述、投票、平票、再次平票、格式错误、泄词、网络错误和重试后成功。
- 记录收到的 `AgentTurnInput` 供信息隔离断言。
- 不读取环境密钥、不访问网络、不通过随机返回掩盖测试意图。

默认开发、单元、集成和端到端测试只使用假模型。

## 11. 真实模型与复盘 Agent

后续真实模型接入共用一个 OpenAI 兼容基础地址、认证密钥、客户端、超时和错误映射，仅通过角色 `modelId` 区分。`pnpm test:live` 必须显式触发，不能被 `dev`、`build`、`test` 或 `test:e2e` 调用。

复盘 Agent 使用独立 `modelId`、提示模板和完整终局上下文，但复用同一连接。它只能在终局事实持久化后运行，其输出与确定性事实分开保存和展示。本规格暂不固定异步队列表结构。

## 12. 来源

- 需求：[`../acceptance/REQUIREMENTS.md`](../acceptance/REQUIREMENTS.md) 第 20–29、51–85、109–145、187–192 条。
- 决策：DEC-004、DEC-005、DEC-010 至 DEC-015、DEC-017 至 DEC-021、DEC-029 至 DEC-039、DEC-052 至 DEC-054、DEC-068、DEC-072 至 DEC-074、DEC-082。
