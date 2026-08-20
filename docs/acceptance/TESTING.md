# 测试与验收规格

- 状态：首个里程碑、默认零付费门禁和一次性全栈真实模型验收均已完成；后续 `test:live*` 仍只允许负责人显式手动执行
- 适用范围：默认测试（`test`/`test:e2e`）不访问真实模型；仅 `test:live` 显式联网

## 1. 测试原则

- 默认测试必须可重复、无网络、无 API 密钥、无付费调用。
- 游戏规则首先通过共享纯函数测试，不能只依赖端到端测试证明。
- 信息隔离必须使用“字段不存在”的负向断言，而不是只检查 UI 没有显示。
- 测试可以注入确定性随机源、可控时钟、假模型和临时 SQLite；这些能力不得改变正式规则。
- 正式对局没有最大回合数，自动化测试使用独立步骤上限防止测试脚本失控。

## 2. 测试分层

### 2.1 共享领域单元测试

目标：无需数据库和网络验证状态机、Schema 与纯规则。

必须覆盖：

- 4～8 人、0/1 名人类、唯一角色、派生 1/2 名卧底的创建校验与动态玩家集合。
- 固定随机源下的词组、多个卧底席位和首轮发言顺序。
- 准备状态只有 `StartGame` 能进入首轮。
- 描述顺序、回合起始玩家轮换和淘汰玩家跳过。
- 普通投票不能自投、弃票或投给淘汰者。
- 投票唯一最高票淘汰与两种正常胜负。
- 部分平票进入辩解，候选不参与重投，重投目标受限。
- 重投再次平票无人淘汰。
- 全员最高票直接无人淘汰，不产生辩解或重投。
- 人类淘汰后进入观战选择，继续后不再获得行动权。
- 已实现主动放弃无 `winnerCamp`；系统异常终止（`system_terminated`，`endReason=model_failure_limit`）的无胜者边界已实现并有共享状态机与服务端集成测试覆盖。
- 相同命令语义的幂等行为和过期修订号拒绝。
- 猜词每局一次、合法行动阶段、目标约束、精确规范化匹配、成功/失败淘汰和双方同时归零平局。
- 初始投票的猜词批次原子结算、互相猜中、无效选票过滤和无有效票进入下一轮。

### 2.2 内容与 Agent Schema 单元测试

当前已覆盖内容校验和信念 Schema：

- 2、40 字边界，少于 2 字和超过 40 字拒绝。
- 一句、两句允许，超过两句拒绝。
- Unicode、英文大小写、空格和常见标点规范化后原词匹配。
- 同音、拼音、隐喻或语义近似不被确定性函数处罚。
- 描述和辩解共用校验器，但产生不同动作类型。
- 玩家概率覆盖所有存活玩家、包含自己、无重复 ID。
- 概率总和读取 `undercoverCount`；用多卧底测试配置证明未写死为 1。
- 投票目标只接受输入的 `legalTargets`。
- 猜词输出与普通描述/投票形成 strict union；禁用时、辩解和重投不能返回猜词分支。
- Agent 输入只包含自己的 `ownCamp`、词牌、猜词可用状态和公开信息，不包含其他玩家阵营、词牌或同批次选择。

已覆盖：`TokendanceAgentPolicy` 的严格结构校验、一次格式修复、可重试/永久错误分类、有限系统重试（注入 sleep，不真实等待）与脱敏 `AgentSystemError`；服务层覆盖内容重生成、首次泄词秘密拦截、重复泄词强退、过期 revision 结果丢弃，以及提交失败复用同一模型输出（见 `tokendance-agent-policy.test.ts`、`game-agent-recovery.test.ts` 和 `game-system-terminated.test.ts`）。

### 2.3 持久化集成测试

每个用例使用独立临时 SQLite，必须覆盖：

- 事件追加和快照更新同事务成功。
- 在事件写入、私有动作写入、公开流写入或快照更新处注入错误，整次事务回滚。
- `eventSeq`、`streamSeq` 和 `revision` 单调递增。
- 重复 `commandId` 不产生重复事件；同 ID 不同语义冲突。
- 两个执行者争抢相同修订号时只有一个提交成功。
- AI 调用期间人类放弃，旧 `baseRevision` 结果无法提交。
- 数据库重开后准备、轮到人类、轮到 AI、等待观战选择和终局状态均正确恢复。
- 词库 JSON 无效时阻止同步；历史对局继续读取词组快照。

### 2.4 API 与 SSE 集成测试

使用 Fastify 注入或真实本地端口配合临时数据库，必须覆盖：

- 所有 REST 请求/响应经过共享 Schema。
- 当前行动者、阶段、目标和修订号错误返回正确安全错误码。
- `HumanGameView` 在准备、进行中、等待观战、观战继续后的进行中、正常终局和放弃终局拥有正确字段集合。
- SSE 帧严格按 `streamSeq` 排序，可用 `Last-Event-ID` 补发并去重。
- 投票完成进度帧不包含目标；最后一票后才出现一次 `votes_revealed`。
- `guess_resolved` 进行中投影严格只含 `actorId` 与 `success`；目标和猜测词只在正常终局 `factReview` 出现。
- SSE 发送失败后事实仍可通过补取恢复。
- 被拒绝描述、格式修复输出和失败模型尝试不进入公开事件接口。
- 系统异常终止响应不包含阵营胜者、模型响应或配置细节；放弃响应同样不包含完整揭晓。
- 默认路径零出网守卫：stub `globalThis.fetch` 抛错后，默认 `FakeAgentPolicy` 完整对局仍跑通到终局且 fetch 零调用，证明默认命令绝不实例化真实策略、绝不联网（`no-live-in-default.test.ts`）。

### 2.5 Web 组件与交互测试

必须覆盖：

- 标题“谁”可打开玩家身份弹层；名称与形象保存时一起生效，取消不落盘，并覆盖自动聚焦、焦点约束、Esc/遮罩关闭和关闭后焦点返回。
- “经典模式”和“猜词模式”都进入阵容配置并发送正确 `gameMode`；可切换人类参与/纯 Agent、4～8 人和唯一角色阵容。
- 存在活动局时直接恢复当前对局，并阻止创建第二局。
- 词牌默认隐藏、可翻面再隐藏、刷新后恢复隐藏且不发送翻牌命令。
- 只有 `allowedCommands` 允许时显示对应输入。
- 人类输入即时校验不替代服务端错误处理。
- AI 投票过程只显示状态，统一揭晓后才显示目标。
- 猜词操作包含风险说明、目标与词语校验和二次确认；猜错出局后可继续普通观战，终局前 DOM 不出现猜测目标或词语。
- 用户向上回看后停止自动滚动，“回到当前”恢复跟随。
- 淘汰观战不出现上帝视角或玩家行动控件。
- 二次确认后才发送放弃命令。
- 减少动态效果模式不依赖翻转或平滑滚动完成流程。
- 键盘可操作词牌、选择项、投票目标、确认弹窗和主要导航。

### 2.6 Playwright 端到端测试

使用真实 Web、Fastify、临时 SQLite 和 `FakeAgentPolicy`，至少包含：

1. 正常完整对局并形成平民或卧底胜利。
2. 出现一次平票，候选依次辩解，非候选重投后淘汰。
3. 进行中刷新，恢复相同词牌、事件、阶段和当前行动者，无重复事件。
4. 人类存活时放弃，二次确认后显示无胜者的不完整记录。
5. 人类被淘汰后继续观战，确认无法看到私有信息且 AI 自动推进到终局。
6. 人类被淘汰后选择放弃，保留不完整事实且不产生胜者。
7. SSE 主动断开再连接，补齐分镜且不重复。

浏览器验收同时在桌面和移动视口运行关键路径。首个里程碑需要保存代表性截图用于人工核对布局，但截图不得包含敏感配置。

### 2.7 稳定性与 Agent 可观测性（已完成）

TASK-074～077 实现时至少补充：

- [x] 模型调用中断不消耗常规重试预算；继续旧局只恢复中断动作，开始新局产生独立无胜者原因。
- [x] 活动局阻止新复盘启动、在途复盘允许完成、全局复盘并发为 1，重启后恢复持久化队列顺序。
- [x] SQLite 繁忙只等待事务且模型调用次数不增加；完整性异常进入仅健康检查可用的受限诊断模式；迁移前备份可恢复。
- [x] SSE 中断提示、持续重连、立即重试和权威视图校准；人类命令响应丢失后复用原 `commandId`，刷新或重试不产生重复领域事件。
- [x] `model_attempts` 完整关联 `gameId/commandId/actionId/attemptId`，格式修复、内容重生成和系统重试均可追踪，且表中不存在 Prompt、响应、Key 或 Base URL 字段。
- [x] 严格 `AgentTurnInput`、上下文所有者/公开游标/合法目标门禁在出网前执行；额外私有字段哨兵会被阻止且记录 `context_boundary_violation`。
- 完整 Prompt/响应审计默认关闭；显式调试模式的文件位于 Git 忽略目录且不含 Key、Base URL 和请求头。
- 保留策略覆盖：结构化清单随对局保留并随对局删除；完整调试文件在 7 天或容量上限触发时按最旧优先清理，主动清除和启动清理均不得误删 `model_attempts` 或结构化清单。
- [x] 轻量熔断对永久配置错误立即生效，对连续瞬时错误冷却并仅放行一次探测；正常成功调用不受影响。
- 服务端开发者门禁关闭时不注册诊断路由，前端不显示开关，直接请求、DOM、Network 和浏览器开发者工具均无法取得诊断数据。
- 门禁开启后，前端开发者开关只影响当前标签页面板显示；基础脱敏审计仍持续记录。完整上下文记录默认关闭、重启自动复位，开启前和逐条展开前均需确认。
- 开启完整记录后面板可以读取对应 Prompt/原始响应，但任何响应和 DOM 均不得出现 Key、Base URL 或请求头；面板所有操作保持只读，清除完整调试文件除外。

### 2.8 系统审计补强（已完成）

TASK-078～083 每项单独验证并提交，至少覆盖：

- [x] 只有权威上下文组装器签发且与输入哈希一致的来源证明可以通过出网门禁；手写证明、篡改公开事件或替换私有信念均不得调用模型客户端。
- [x] 信念概率列表和复盘逐 Agent 评价中的重复 `playerId` 被 Schema 或确定性校验拒绝，合法完整集合保持兼容。
- [x] 复盘 Prompt 与 Schema 对结论、关键片段、总体评价和评分字段的约束一致，并有边界值测试。
- [x] 后台未分类异常产生持久化中断状态，刷新/重启后显示继续或开始新局；该异常不产生 `game_system_terminated`，也不增加模型重试次数。
- [x] 调用记录能区分 Provider 返回、结构校验、内容校验和动作提交；内容拒绝、过期丢弃和提交失败不计为最终成功。
- [x] GitHub CI 使用 `.node-version` 固定的 Node 22.14.0 和 pnpm 9.15.9，只运行默认假模型门禁；工作流显式清空真实 Provider 凭据，不执行任何 `test:live*`。

负责人已接受零宽字符绕过直接词面匹配的残余风险，本节不增加对应测试要求。

### 2.9 模型格式失败诊断与修复

- [x] 非 JSON、JSON 根节点非对象、strict Schema 失败、非法投票目标、信念总和及玩家集合错误分别产生稳定的脱敏原因码。
- [x] Schema 原因最多包含第一条失败的字段路径与 issue code，不包含字段值、模型原文、词牌、Prompt 或私有信念正文。
- [x] 格式修复提示包含实际失败位置，以及唯一顶层字段、信念字段、长度、玩家 ID、概率和合法目标的完整约束。
- [x] 第一次格式错误后仍只执行一次格式修复；连续失败沿用既有系统重试预算，不增加无限调用或静默放宽 Schema。
- [x] Provider 返回的调试日志明确为 `provider_returned`，结构通过与最终提交仍由 `schema_validated`、`action_committed` 独立证明。

## 3. 信息隔离负向矩阵

测试必须在原始响应、SSE JSON、Agent 输入、日志捕获和页面 DOM 五个层面检查禁止字段。

| 场景 | 必须断言不存在 |
| --- | --- |
| 创建后准备阶段 | 所有真实阵营、AI 词牌、完整词组映射 |
| Agent 描述输入 | 真实阵营、其他词牌、其他 Agent 信念、未来事件 |
| 普通投票输入 | 本轮其他未揭晓选票、其他投票理由 |
| 投票进度 SSE | `targetPlayerId`、理由、概率、候选词 |
| 淘汰分镜 | 被淘汰者阵营和词牌 |
| 人类淘汰观战 | 全部真实阵营、其他词牌和 AI 私有信念 |
| 被拦截泄词 | 原始文本不在事件、SSE、日志、复盘和后续 Agent 输入 |
| 错误与重试 | 密钥、基础地址、请求头和完整模型响应 |
| 正常终局前 | `reveal` 和 `winnerCamp` 不得提前出现 |

测试夹具应使用明显的哨兵字符串作为私有值，并搜索所有输出通道，避免因字段改名漏检。

## 4. 当前假模型场景与测试构造

当前代码中的 `FakeAgentScenario` 只有两个显式值：

| 场景 | 当前用途 |
| --- | --- |
| `normal` | 按座位生成确定性描述/辩解，普通投票或重投选择首个合法目标 |
| `tie-then-eliminate` | E2E 构造一次部分平票、候选辩解和重投淘汰 |

其他边界通过状态机命令、服务端测试策略和确定性随机序列构造，而不是独立 `FakeAgentScenario`：

| 测试构造 | 当前覆盖 |
| --- | --- |
| 手工提交投票目标 | 再次平票、全员最高票、两种胜负、观战选择 |
| `FailOnActionPolicy` | AI 描述/投票中断后的服务重启恢复 |
| `CountingPolicy` | 二次重启或重复恢复不再次调用 Agent |
| SQLite 触发器故障注入 | 事件、私有动作、公开帧、快照和幂等结果的整事务回滚 |

格式修复、有限系统重试、`model_failure_limit` 与 `system_terminated` 已实现，并由 `tokendance-agent-policy.test.ts`（策略级重试与脱敏错误）和 `game-system-terminated.test.ts`（服务端兜底终止）覆盖。真实付费联网仅在 `pnpm test:live` 触发。

所有假模型输出包含合法信念快照，以便在不访问真实模型时验证私有存储和终局事实数据。

## 5. 当前自动化测试清单

### 5.1 Vitest

2026-08-17 本轮等价全量门禁共 156 项：shared 47、server 64、web 45。由于工作区 Windows junction 损坏，命令在独立 hoisted 验证副本中以同版本 Node 22、依赖与源码执行；原工作区未读取真实模型配置、未联网。

| 层 | 文件 | 主要覆盖 |
| --- | --- | --- |
| Shared | `commands.test.ts`、`api.test.ts` | 枚举、命令 Schema、默认名称、长度、修订号和 API 信封 |
| Shared | `word-pairs.test.ts`、`content-validation.test.ts` | 词库集合、难度可用、规范化同词拒绝、描述/辩解字数句数与泄词校验 |
| Shared | `agent.test.ts` | 信念覆盖存活玩家、概率总和与 ID 约束 |
| Shared | `game-setup.test.ts`、`views.test.ts` | 动态创建/开始、多个卧底座位、观察者公开投影和终局字段边界 |
| Shared | `game-machine.test.ts`、`guess-mode.test.ts` | 描述、秘密投票、淘汰胜负、平票、观战，以及猜词即时/批次结算与信息边界 |
| Server | `server.test.ts` | 健康、创建/读取/开始 API、幂等、活动局限制、数据库重开、回滚和修订冲突 |
| Server | `game-flow.test.ts` | 完整服务端玩法、AI 自动推进、秘密揭票、两种胜负、平票、观战和放弃 |
| Server | `game-repository.test.ts` | 五个写入位置的故障注入、整事务回滚和安全重试 |
| Server | `game-recovery.test.ts` | 准备等待、AI 描述/投票重启恢复、稳定 actionId 和高水位损坏拒绝 |
| Server | `game-agent-recovery.test.ts` | 内容重生成、首次/重复泄词、过期结果丢弃、提交重试不重复调用模型 |
| Server | `tokendance-agent-policy.test.ts` | strict 结构修复、瞬时/永久错误分类、重试耗尽与安全错误码 |
| Server | `review-agent-policy.test.ts` | 复盘评价短输出预算、证据优先、反结果论、统一评分锚点与 JSON 输出契约 |
| Server | `provider-runtime.test.ts`、`model-profile-service.test.ts`、`tokendance-client.test.ts` | 通用 Provider 无默认 model、三角色/评测配置门禁、精确 model 参数映射与请求体优先级、Tokendance 回退兼容 |
| Server | `no-live-in-default.test.ts` | 默认假模型完整对局零 fetch 调用、零真实模型实例化 |
| Server | `agent-runtime.test.ts` | Agent 输入白名单、投票/重投目标边界和 `FakeAgentPolicy` 合法输出 |
| Server | `game-stream.test.ts` | SSE/补取游标、`Last-Event-ID`、严格递增、去重和公开帧私有字段缺失 |
| Web | `App.test.tsx` | 玩家身份弹层、两种模式进入动态阵容配置、创建与恢复、本地翻牌、素材、最近终局、SSE 游标和中断确认 |
| Web | `game-command-recovery.test.ts`、`use-game-stream.test.tsx` | 响应丢失后的权威判定、稳定 ID 重试、双重断网保留、旧对局回退、修订冲突，以及 SSE 延迟提示/自动重连/立即重试/权威同步 |
| Web | `GameScreen.test.tsx`、`ReviewScreen.test.tsx` | 描述、投票、辩解、重投、违规/异常分镜、观战/放弃、终局揭晓、复盘和 DOM 隔离 |

### 5.2 Playwright

`pnpm test:e2e` 当前运行 3 个模式、5 条流程，并分别在 Desktop Chrome 与 Pixel 5 执行，共 10 项：

- `normal.spec.ts`：完整正常对局、进行中刷新、终局恢复；进行中二次确认放弃。
- `spectator.spec.ts`：人类淘汰后继续普通观战至终局；淘汰后放弃且无胜者。
- `tie.spec.ts`：一次部分平票、候选辩解、非候选重投并淘汰。

Playwright 每个模式使用独立临时 SQLite、确定性随机序列和真实本地 Web/Fastify，不访问真实模型。

2026-08-17 本轮 10/10 通过；另以内置浏览器完成 `创建对局 -> 确认词牌 -> 开始游戏 -> 进入第 1 轮人类描述` 可见交互检查，页面标题、非空内容、无框架错误遮罩、控制台零 warning/error 均通过。

2026-08-17 首页信息层级收口回归：Web 源码测试 52/52、生产构建和 `git diff --check` 通过；在 1280×720 可见浏览器中验证身份弹层保存/取消、焦点返回、经典/猜词模式层级和难度下置，控制台无 warning/error，页面无 Vite 错误遮罩。

2026-08-19 最终零付费回归：默认测试 186/186、三 workspace typecheck、全仓 lint/build 与 Playwright 10/10 通过。E2E 的 Web 服务直接调用仓库 Vite CLI，避免嵌套包管理器在启动前重验依赖；normal 流程新增角色名必须位于席位卡片边界内的断言。另以 1440px 与 393px Chromium 截图检查首页、猜词模式提示和首轮对局；移动端 `scrollWidth === innerWidth === 393`、4 张角色图加载完成、控制台无 warning/error。全程强制 fake provider，不调用真实 API。

2026-08-19 浏览器恢复阶段回归：Web 恢复专项 17/17、Web 源码测试 63/63、typecheck 与既有 Playwright 10/10 通过。另以一次性故障注入在 1440×1000 和 375×812 Chromium 验证 SSE 断线约 3 秒后保留当前画面并显示恢复横幅、立即重试可用、中断对局双选项无溢出且默认聚焦“继续上一局”；除刻意制造的 SSE `ERR_CONNECTION_REFUSED` 外无控制台错误。全程使用 fake/拦截视图，不读取真实 API Key、不产生模型费用，一次性脚本未保留为长期测试。

2026-08-19 开发者面板阶段回归：Server 定向测试覆盖总门禁关闭时诊断路由 404 且活动视图无能力字段、开启时只读总览/能力位/会话记录开关，以及完整 Prompt/响应对 Key、Bearer 与 URL 的脱敏和容量清理；Web App 12/12 覆盖普通模式 DOM/Network 无入口、四类只读页签、敏感开关确认取消与确认开启。Shared 51、Server 项目源码 104、Web 项目源码 67 项通过（后两者各含隔离依赖中的 2 条 Shared 副本），三端类型检查、全仓 lint 和生产构建通过；1440×1000 与 375×812 Chromium 无横向溢出、控制台零错误。全程使用 fake/内存数据，不读取真实 API Key、不调用模型或产生费用。

2026-08-20 扩展玩法最终回归：Node 22 下 Shared 63/63、Server 117/117、Web 66/66，共 246/246；三 workspace typecheck、全仓 ESLint 与 Shared/Server/Web 生产构建通过。1440px Chromium 使用隔离 fake API 完成“猜词模式配置 -> 人类描述阶段猜错出局 -> 继续观战 -> Agent 自动完成对局 -> 查看事实复盘”；进行中 `guess_resolved.payload` 只有 `actorId/success`，响应正文不含猜测词，正常终局才显示完整目标和猜测词，页面无横向溢出、破图、控制台错误或非预期请求失败。浏览器验收发现并修复“描述阶段猜词出局后继续观战错误重启描述轮”的阶段恢复问题；提交前审阅又补齐“人类在投票猜词批次出局后必须先确认观战”的边界，两条路径均有共享回归测试。全程不读取真实 API Key、不调用外部模型、不产生费用；本期未把该一次性浏览器脚本纳入长期 E2E。

2026-08-20 模式化复盘回归：在干净 Node 22 / pnpm 9 Docker 环境完成三 workspace typecheck、全仓 lint 和 Shared/Server/Web 生产构建；Shared 65、Server 120、Web 68，共 253/253 项测试通过。新增断言覆盖经典模式禁止猜词区块、行动证据帧只读取游标以内事件、猜词事实字段由服务端按 actionId 回填、并行冻结语义提示、专项连续格式失败后的局部降级、生成/持久化专项状态一致性、数据库 v5 游标迁移、精简 Web 展示和 Markdown 导出。另以隔离 fake 服务和临时数据库从首页完成两局猜词模式浏览器验收：无 AI 猜测时仍显示专项结论；玩家猜测失败时事实记录默认折叠、点击可展开；终局显示“卧底已被淘汰”；目标页面无控制台 error/warn。全部使用 fake/scripted client，不读取真实 API Key、不访问外部模型、不产生费用；Web 测试仍有 jsdom 不实现音频 `pause` 的既有 stderr，退出码为 0。移动端按当前规划暂不作为本轮验收范围。

## 6. 首个里程碑验收清单

### 功能

- [x] 固定一名人类和三名 AI，可以从准备阶段完成正常对局。
- [x] 人类和 AI 均可能通过固定测试种子成为卧底。
- [x] 首轮随机顺序、后续轮换、秘密投票和胜负规则符合状态机规格。
- [x] 平票辩解、非候选重投和再次平票行为正确。
- [x] 主动放弃、人类淘汰后观战或放弃均可完成。

### 数据与恢复

- [x] 所有已确认动作形成不可变事件，快照与事件同事务。
- [x] 准备阶段和进行中刷新后正确恢复，无重复动作。
- [x] SSE 断线补发安全且不重复。
- [x] 已实现终局与放弃的胜者字段边界正确；异常终止属于后续范围。

### 信息安全

- [x] 进行中浏览器、SSE 和 Agent 上下文通过完整负向矩阵。
- [x] 当前假模型链路不读取密钥或敏感地址；被拦截原文不进入持久化或日志。
- [x] 投票只在全部完成后统一揭晓。
- [x] 淘汰观战仍只有公开信息。

### 体验

- [x] 桌面与移动端可完整游玩。
- [x] 词牌、分镜自动跟随、回到当前、二次确认和终局揭晓可操作。
- [x] 键盘与减少动态效果模式可完成主流程。
- [x] AI 思考不显示私有推理，稳定占位避免明显跳动；错误重试属于后续范围。

### 工程质量

- [x] `pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `pnpm test:e2e` 通过。
- [x] 默认命令未调用真实模型。
- [x] README 包含本地启动、测试、信息隔离和已知问题。

## 7. 真实模型验收（分层）

`pnpm test:live` 分层执行，缺 env 一律显式失败退出码 1（绝不静默走假模型），全程脱敏——只记计数/字符长度/错误 kind/耗时/重试/布尔/model ID/role/action，绝不打印 URL/Key/请求头/`Bearer`/完整响应/词牌/信念原文/违规原文。运行架构为混合方案：连通冒烟保持纯 Node，策略级与整局验收由 tsx 编排器（复用 `playwright.config.ts` 同款 tsx 启动，零新依赖）导入真实服务端模块执行。

### 7.1 连通冒烟（`test:live:smoke` / `tests/live/run.mjs`）

从根 `.env` 载入所选真实 Provider 的 Base URL、API Key 与 smoke model，缺项明确失败。Tokendance 保持 `GET /models` + 最小 `POST /chat/completions`；`openai-compatible` 要求显式 `OPENAI_COMPATIBLE_SMOKE_MODEL` 并直接验证 Chat Completions，不强制中转站实现 `/models`。仅打印 model 数量、model ID 与回复字符数。

### 7.2 策略级实测（`test:live` 默认 / `test:live:policy`，约 6 次调用）

用 shared 纯函数造快照 + `projectAgentTurnInput` 白名单投影（无 DB/服务端/网络成本），对 DeepSeek/豆包/千问三角色各做一次真实 `TokendanceAgentPolicy.act` 的 describe 与 vote：

Tokendance 沿用项目角色默认 ID；通用 Provider 必须显式配置 `OPENAI_COMPATIBLE_DEEPSEEK_MODEL`、`OPENAI_COMPATIBLE_DOUBAO_MODEL`、`OPENAI_COMPATIBLE_QWEN_MODEL`。这些只服务独立付费验收，不会成为应用运行时默认值。复盘验收同样要求显式 `OPENAI_COMPATIBLE_REVIEW_MODEL`。

- 结构校验：`speechActionOutputSchema`/`voteActionOutputSchema`（strict）解析成功；`beliefSnapshotSchema` + `validateBeliefSnapshot`（覆盖全部存活玩家、概率和≈卧底人数）；vote 的 `targetPlayerId` 必属输入 `legalTargets`。
- 五通道信息隔离负向断言：agent 输入 / 策略公开文本 / 抛出错误消息 / （整局时）公开帧 / 报告文本，均以哨兵集合（动态词牌 + 固定字段 + baseUrl/apiKey/`Bearer`）搜索禁止字段。公开文本命中自己词牌记 WARN（服务端 content validator 为硬闸），配置泄漏记硬失败。
- 耗时/重试从策略 `debug` 已脱敏时序行采集，零新增泄漏面。

### 7.3 可选整局（`test:live:full` / `LIVE_FULL_GAME=1`）

以真实策略 + `backgroundAdvance:false` + 独立临时 SQLite 驱动完整对局到终局，断言到达 `finished` 或 `system_terminated`（真实模型系统失败经 `AgentSystemError`→`system_terminated`/`model_failure_limit` 亦通过），并对公开事件流做全负向矩阵隔离断言、确认信念私存（`agent_actions` > 0）。调用多、成本高，故显式门控。

### 7.4 报告与边界

成功后生成脱敏 Markdown 报告 `docs/acceptance/reports/live-<时间>.md`，记录时间、模型标识、结构校验、信息隔离断言、耗时、重试次数（及整局终局状态）。报告落盘前自检渲染串，命中 baseUrl/apiKey/`Bearer`/任一词牌哨兵即中止不写并非零退出。报告不得包含密钥、敏感中转地址、请求头、违规原文或无必要的完整响应。

复盘模型已具备独立真实调用入口 `pnpm test:live:review`：使用终局事实夹具调用 `TokendanceReviewPolicy`，校验 `reviewGenerationSchema`、全部 AI 的 `playerId` 覆盖和输出敏感哨兵。Web 已轮询并展示 `ReviewSummary`，支持失败后重新生成；评价与确定性事实分区。2026-08-19 一次性全栈验收已额外确认真实复盘生成、持久化、Web 展示、浏览器刷新、Server 重启恢复与 Markdown 导出。

`test:live` 及其子命令不得进入默认 CI、普通开发启动、`pnpm test` 或 `pnpm test:e2e`。默认路径由 `apps/server/src/agents/no-live-in-default.test.ts` 断言零出网、绝不实例化真实策略。负责人自填真实 Key 于 gitignored `.env` 后方可执行付费联网验收。

### 7.5 一次性全栈真实验收

为关闭 TASK-057，允许在负责人明确授权后执行一次不进入长期自动化的全栈真实验收。验收先在完全临时的 Node 22、独立依赖和 SQLite 中通过默认零出网门禁，再从可见浏览器经 Web、HTTP、SSE、服务端编排、真实参赛 Agent 和 SQLite 完成一局正常终局，并验证真实复盘 Agent 的异步持久化、Web 展示、刷新恢复和 Markdown 导出。

本次只使用一个已配置 Tokendance 中转站；真实 API Key 仅从 gitignored `.env` 注入临时服务端进程，报告只注明使用真实凭据，不保存 Key、Base URL、请求头、完整响应、词牌或私有信念。三个参赛 model ID 通过模型档案显式保存，复盘 model ID 由临时进程显式设置。单次授权最多启动一局，设置 20 分钟和 40 次真实请求停止线；失败如实记录且不自动重开。正式仓库只保留人工复核后的脱敏报告、进行中与终局截图、结构化验证摘要，不保留临时驱动器、数据库或隔离运行环境。

2026-08-18 的执行在准备后阻塞，未形成验收结论。2026-08-19 重新完成全部验证：默认测试 186/186、E2E 10/10、typecheck/lint/build 通过；唯一一局在 440 秒到达 `finished/ended`，总计 37 次真实生成请求。真实复盘为 `done`，刷新与 Server 重启恢复、Markdown 导出和浏览器控制台检查均通过。脱敏证据见 [FULLSTACK_LIVE_2026-08-19.md](FULLSTACK_LIVE_2026-08-19.md)。

### 7.6 发布素材回归

2026-08-19：`scripts/optimize-assets.py --check` 解码并核验 25 张 512×640 动作 WebP、5 张 256×256 头像和场景 WebP，ffmpeg 完整解码 60 秒 MP3；Web 源码测试 65/65、Node 22 typecheck 与生产构建通过。应用内浏览器因插件可信路径配置无法初始化，按规范回退仓库 Playwright；1280×720 打开身份弹层后两张人类素材均为 512×640 且完成解码，Performance 资源只出现 WebP/MP3、无 PNG/WAV，控制台与页面错误均为 0。素材来源授权和现有水印处理仍待负责人确认。

## 8. 来源

- 需求：[`REQUIREMENTS.md`](REQUIREMENTS.md) 第 27–29、73–80、106–145、167–192 条。
- 决策：DEC-012 至 DEC-016、DEC-028 至 DEC-039、DEC-049 至 DEC-054、DEC-063、DEC-065 至 DEC-082、DEC-092 至 DEC-096。
