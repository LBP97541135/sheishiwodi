# 游戏领域规格

- 状态：首个里程碑已实现基线；预留终局类型待后续启用
- 适用范围：首版基础玩法

## 1. 领域术语

| 术语 | 定义 |
| --- | --- |
| 玩家 `Player` | 一个人类或 AI 座位；通过稳定 `playerId` 标识 |
| 词牌 `WordCard` | 玩家唯一知道的本局词语，不等同于真实阵营 |
| 阵营 `Camp` | `civilian` 或 `undercover`，对局中由服务端保密 |
| 公开事件 | 所有仍在对局中的参与者允许获知的事实 |
| 私有信念 `BeliefSnapshot` | 单个 AI 在行动时对阵营和异阵营词的判断 |
| 回合 `Round` | 一轮描述、投票以及可能发生的平票分支 |
| 行动 `Action` | 一名玩家在当前阶段提交的一次描述、辩解或投票 |
| 修订号 `revision` | 每次成功领域提交后递增，用于并发与恢复 |
| 事件序号 `eventSeq` | 对局内不可重复、严格递增的事实顺序 |

“身份”容易同时指阵营和模型角色，代码与接口中必须分别使用 `camp` 与 `agentRole`。

## 2. 首版对局配置

首版创建入口固定接收：

- 一名人类玩家和三名 AI 玩家。
- 一名卧底、三名平民。
- 难度 `easy | hard`。
- 人类显示名称：缺省为“玩家”，填写时 1 至 12 个字符。
- 人类剪影：两个允许值之一。
- 三个固定显示角色：DeepSeek、豆包、千问。

核心领域集合、顺序、概率总量和胜负函数不得依赖数组长度为 4。固定人数只由创建对局 Schema 约束，规则函数读取 `players` 与 `undercoverCount`。

## 3. 状态模型

### 3.1 对局状态 `GameStatus`

```text
preparing          已分配词牌，等待人类确认开始
in_progress        正常进行
awaiting_spectator 人类刚被淘汰，等待选择观战或放弃
finished           正常阵营胜负终局
abandoned          人类主动放弃终局
system_terminated  模型系统错误达到上限后的异常终局
```

### 3.2 活动阶段 `GamePhase`

```text
preparing
speaking
voting
tie_defense
revoting
ended
```

`GameStatus` 描述对局生命周期，`GamePhase` 描述当前规则节点。三个终局状态和 `finished` 的阶段均为 `ended`；`awaiting_spectator` 保留淘汰动作结束时的阶段恢复信息，但不接受描述或投票。

### 3.3 终局原因 `EndReason`

```text
undercover_eliminated
undercover_survived_to_two
player_rule_violation
abandoned_by_human
model_failure_limit
```

`system_terminated`、`model_failure_limit`、`TerminateForSystemError` 和 `game_system_terminated` 目前只在共享 Schema/枚举中预留，尚无状态机转换、服务接口或 Web 展示。`player_rule_violation` 也只保留类型兼容，重复泄词强退尚未实现。

## 4. 命令

所有会改变状态的命令必须包含 `commandId`、`gameId`、`actorId` 和 `expectedRevision`。创建命令使用独立 `commandId`，无 `expectedRevision`。

| 命令 | 允许状态/阶段 | 主要字段 |
| --- | --- | --- |
| `CreateGame` | 无活动对局或旧局已终结 | 人类配置、难度、随机源引用 |
| `StartGame` | `preparing` | 人类玩家 ID |
| `SubmitDescription` | `in_progress/speaking` | 文本 |
| `SubmitDefense` | `in_progress/tie_defense` | 文本 |
| `SubmitVote` | `in_progress/voting|revoting` | 目标玩家 ID |
| `ContinueSpectating` | `awaiting_spectator` | 人类玩家 ID |
| `AbandonGame` | `preparing|in_progress|awaiting_spectator` | 人类玩家 ID |
| `TerminateForSystemError` | `in_progress` | 预留命令；当前未实现状态机处理 |

AI 和人类提交相同的领域命令；来源差异只影响命令生成方式，不影响规则校验。

## 5. 事件

事件是已经确认的事实，必须不可变。事件信封至少包含 `eventId`、`gameId`、`eventSeq`、`type`、`visibility`、`occurredAt`、`commandId/actionId` 和经过 Schema 校验的 `payload`。

### 5.1 可见性

```text
public          对局进行中可进入公共投影和 Agent 公共上下文
human_private   仅浏览器中的人类本人可见
post_game       终局后才可进入复盘投影
internal        只供服务端恢复、审计或错误处理
```

### 5.2 核心事件类型

| 事件 | 可见性 | 说明 |
| --- | --- | --- |
| `game_created` | `human_private` | 保存本局配置和人类词牌投影 |
| `game_started` | `public` | 人类确认开始 |
| `round_started` | `public` | 包含轮次和发言顺序 |
| `turn_started` | `public` | 当前行动者与行动类型 |
| `speech_published` | `public` | 已校验的描述或辩解 |
| `vote_cast` | `post_game` | 单票目标；统一揭晓前不得公开 |
| `vote_progressed` | `public` | 只说明某玩家完成投票，不含目标 |
| `votes_revealed` | `public` | 全部完成后一次性公开投票关系 |
| `tie_declared` | `public` | 平票候选集合 |
| `revote_started` | `public` | 重投参与者与合法候选 |
| `player_eliminated` | `public` | 只公开淘汰者，不公开阵营和词牌 |
| `round_ended_without_elimination` | `public` | 再次平票或全员最高票 |
| `spectating_started` | `public` | 人类选择继续观战 |
| `belief_snapshotted` | `post_game` | AI 行动时的私有信念和理由 |
| `game_finished` | `post_game` | 正常终局事实、胜者和完整揭晓数据 |
| `game_abandoned` | `public` | 放弃终局，无阵营胜者 |
| `game_system_terminated` | `public` | 预留事件；当前未实现 |

`game_finished` 的完整负载不得直接作为进行中 SSE 事件发送；终局公开投影按 [`frontend-ux.md`](frontend-ux.md) 的揭晓阶段展示。

## 6. 状态转换

| 当前节点 | 条件/命令 | 下一个节点 |
| --- | --- | --- |
| `preparing` | `StartGame` | `in_progress/speaking`，创建第 1 回合和随机发言顺序 |
| `speaking` | 当前玩家合法描述 | 下一名存活玩家继续 `speaking` |
| `speaking` | 本轮全部描述完成 | `voting` |
| `voting` | 一名玩家投票 | 保持 `voting`，只公开完成进度 |
| `voting` | 全部选票完成且唯一最高票 | 淘汰并立即判断胜负 |
| `voting` | 部分玩家并列最高票 | `tie_defense` |
| `voting` | 所有存活玩家并列最高票 | 无人淘汰，下一轮 `speaking` |
| `tie_defense` | 候选依次完成辩解 | `revoting` |
| `revoting` | 唯一最高票 | 淘汰并立即判断胜负 |
| `revoting` | 再次平票 | 无人淘汰，下一轮 `speaking` |
| 淘汰后 | 卧底已淘汰 | `finished/ended`，平民胜利 |
| 淘汰后 | 只剩两人且卧底存活 | `finished/ended`，卧底胜利 |
| 淘汰后 | 人类被淘汰且尚未终局 | `awaiting_spectator` |
| `awaiting_spectator` | `ContinueSpectating` | 恢复自动推进 |
| 非终局 | `AbandonGame` | `abandoned/ended` |
| `in_progress` | `TerminateForSystemError` | 规划：`system_terminated/ended`；当前转换未实现 |

## 7. 规则不变量

### 7.1 信息与身份

- 每名玩家在终局前只知道自己的词牌，不知道自己的真实阵营。
- 淘汰时只公开玩家 ID/名称和淘汰事实。
- 投票目标在全部合法投票提交前互不可见。
- AI 私有信念、候选词和投票理由只在终局复盘公开。

### 7.2 发言

- 描述和辩解均为 2 至 40 个字符、最多两句。
- 不得包含自己词牌的规范化原词；规范化规则见 [`agent-runtime.md`](agent-runtime.md)。
- 不执行跨玩家、跨轮次或描述与辩解之间的重复文本拦截。
- 首次泄词内容不产生 `speech_published`；重复泄词强退不属于首个里程碑实现范围。

### 7.3 投票

- 普通投票者为所有存活玩家；目标必须是另一名存活玩家，不能自投或弃票。
- 重投者为未进入平票候选集合的存活玩家；目标必须属于平票候选集合。
- 平票候选不参与重投。
- 若所有存活玩家都是最高票候选，不进行辩解和零人重投。

### 7.4 顺序与随机

- 首轮发言顺序随机确定。
- 后续轮次沿座位相对顺序轮换起始玩家，跳过已淘汰者。
- 卧底席位在所有座位中等概率抽取。
- 正式运行使用安全随机源；测试可以注入确定性随机源。
- 正式对局无最大回合数；测试步数保护不进入领域状态。

### 7.5 概率

每个 AI 的玩家卧底概率必须覆盖全部存活玩家并包含自己，且总和等于公开配置 `undercoverCount`。首版总和为 1；规则实现不得写死为 1。

### 7.6 幂等与一致性

- 相同 `commandId` 最多产生一次领域提交。
- `expectedRevision` 与当前修订号不一致时不得转换状态。
- 一个事件序号只对应一个不可变事件。
- 事件集合与提交后的快照必须描述同一个状态转换。
- 动画完成、浏览器刷新和 SSE 重连不得触发领域命令。

## 8. 首个里程碑边界

首个里程碑必须实现：准备、正常描述、秘密投票、平票辩解、重投、淘汰、正常终局、持久化恢复、主动放弃、人类淘汰后观战。

首个里程碑不实现：真实模型、异步 AI 复盘、重复泄词强退、猜词玩法、可选人数、多卧底和阵容选择。未实现分支不得以无效按钮或假数据伪装完成。

## 9. 来源

- 需求：[`../acceptance/REQUIREMENTS.md`](../acceptance/REQUIREMENTS.md)“核心验收要求”“已确认游戏规则”。
- 决策：DEC-007 至 DEC-016、DEC-025 至 DEC-028、DEC-035 至 DEC-038、DEC-049 至 DEC-050、DEC-063、DEC-065 至 DEC-080。
