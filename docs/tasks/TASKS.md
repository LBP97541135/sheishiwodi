# 项目任务台账

本文件是长期任务状态的权威入口。会话内任务工具用于执行协助；两者不一致时，应立即核对并同步本文件，而不是等待切片结束后批量补写。

## 状态总览

- `TASK-000`～`TASK-043`：已完成。
- 首个里程碑 7 个切片全部通过默认测试、E2E、构建、类型、静态检查和文档门禁。

## 验收依据缩写

- **M1**：[首个里程碑合同](../acceptance/milestone-1.md)
- **TEST**：[测试与验收规格](../acceptance/TESTING.md)
- **SPEC**：[工程规格索引](../spec/README.md)
- **LOG**：[开发记录](../history/PROJECT_LOG.md)
- **GOV**：[协作规范](../notes/COLLABORATION.md)

## 项目准备与规格基线

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-000 项目启动基线 | 已完成 | 梳理产品目标、基础规则、架构选型、信息隔离与治理边界；形成当前结构化事实源 | GOV、SPEC | `REQUIREMENTS`、`DECISIONS`、`COLLABORATION` 的历史基线；LOG 中 2026-08-14～16 记录 |
| TASK-001 建立规格目录与索引 | 已完成 | 建立工程规格目录；区分需求、决策、规格与历史记录 | SPEC | `docs/spec/` 及其索引 |
| TASK-002 编写核心架构规格 | 已完成 | 固定 pnpm workspace、React/Vite、Fastify、SQLite/Drizzle 与依赖方向 | SPEC | `spec/architecture.md` |
| TASK-003 编写数据与通信规格 | 已完成 | 定义持久化事务、REST、SSE、安全公开帧与恢复边界 | SPEC | `spec/persistence.md`、`spec/api-and-events.md` |
| TASK-004 编写 Agent 与前端规格 | 已完成 | 定义 Agent 白名单输入、结构输出、漫画交互与隐私边界 | SPEC | `spec/agent-runtime.md`、`spec/frontend-ux.md` |
| TASK-005 编写测试与里程碑规格 | 已完成 | 固定测试分层、负向矩阵、7 个实施切片与完成定义 | M1、TEST | `acceptance/TESTING.md`、`acceptance/milestone-1.md` |
| TASK-006 校验规格一致性 | 已完成 | 检查状态、命令、事件、字段、可见性与文档交叉引用无冲突 | SPEC | 规格审计与 LOG 记录 |
| TASK-007 检查本地与远程仓库 | 已完成 | 确认 Git 状态、分支策略、远程与首次提交状态 | GOV | LOG 中“检查本地与远程仓库”相关记录 |
| TASK-008 建立项目协作配置 | 已完成 | 建立 CLAUDE、Git、版本、记录与负责人门禁 | GOV | `CLAUDE.md`、`notes/COLLABORATION.md` |
| TASK-009 确定首个开发切片 | 已完成 | 选择纵向最小闭环；明确真实模型和后续能力不进入首里程碑 | M1 | `acceptance/milestone-1.md`、相关决策记录 |

## 切片 1：工程基线与共享契约

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-010 初始化 pnpm 工程基线 | 已完成 | 创建 workspace、包脚本、TypeScript、ESLint、Vitest、Playwright 基线 | M1 切片 1 | LOG“完成切片 1”；根命令契约已可用 |
| TASK-011 搭建最小 Web 与 Server | 已完成 | Web 9001、Server 3001；`pnpm dev` 同时启动且不调用真实模型 | M1 切片 1 | 健康接口与桌面/移动浏览器验证 |
| TASK-012 定义共享领域契约 | 已完成 | 建立严格 Zod Schema、领域类型、公开视图和私有字段剥离 | SPEC、TEST | shared 契约与负向测试 |
| TASK-013 测试切片一 | 已完成 | 运行 test/typecheck/lint/build/diff；浏览器验证工程状态页 | M1 切片 1 | 13 项测试及 LOG 证据 |

## 切片 2：创建、准备与持久化词牌

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-014 扩充共享创建规则 | 已完成 | 固定四人创建层；动态集合状态；随机词组、卧底席位与首轮顺序 | M1 切片 2 | shared 创建与随机覆盖测试 |
| TASK-015 接入 SQLite 持久化 | 已完成 | 迁移、词库镜像、快照、事件、命令幂等与安全流基础表 | SPEC persistence | SQLite 重开恢复与事务测试 |
| TASK-016 实现创建与开始 API | 已完成 | 创建、活动局查询、单局查询、开始命令；修订冲突与幂等 | M1 切片 2 | Server API 集成测试 |
| TASK-017 实现 Web 准备流程 | 已完成 | 名称、剪影、难度、四座位、词牌本地翻面、刷新恢复和显式开始 | M1 切片 2 | Web 组件与桌面/移动实测 |
| TASK-018 测试切片二 | 已完成 | 全门禁；REST/DOM 字段不存在；准备页刷新与持久恢复 | M1 切片 2、TEST | 31 项测试及 LOG 证据 |

## 切片 3：正常描述与秘密投票闭环

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-019 实现描述投票状态机 | 已完成 | 内容校验；描述顺序；秘密投票；统一揭票；淘汰、胜负与轮换 | M1 切片 3 | shared 状态机测试 |
| TASK-020 实现假模型自动推进 | 已完成 | Agent 白名单输入、合法信念、确定性描述/投票；人类回合暂停 | M1 切片 3、TEST | Agent 输入负向测试与 FakeAgent 流程测试 |
| TASK-021 实现实时 API 与持久化 | 已完成 | descriptions/votes/events/SSE；通用原子提交；私有动作和安全帧 | SPEC persistence、api | Server 集成测试、字段不存在断言 |
| TASK-022 实现漫画对局界面 | 已完成 | 漫画时间线、五状态角色、人类描述/投票、秘密进度、终局印章 | M1 切片 3 | Web 测试与桌面/移动完整对局 |
| TASK-023 测试切片三 | 已完成 | test/typecheck/lint/build/diff；正常完整对局；REST/SSE/DOM 隔离 | M1 切片 3、TEST | 64 项测试及 LOG 证据 |

## 切片 4：平票辩解与候选重投

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-024 实现平票辩解与重投状态机 | 已完成 | 候选顺序辩解；非候选重投；候选目标限制；再次/全员平票无人淘汰 | M1 切片 4 | shared 39 项中的平票分支测试 |
| TASK-025 扩展假模型与 Agent 输入的平票分支 | 已完成 | defend 无目标；revote 只含候选；合法辩解/重投；私有字段不存在 | M1 切片 4、TEST | Agent 4 项测试及负向断言 |
| TASK-026 扩展服务端平票 REST 与自动推进 | 已完成 | defenses API；AI defend/revote；人类候选/非候选暂停；原子持久化 | M1 切片 4 | Server 22 项测试中的平票集成场景 |
| TASK-027 实现 Web 平票辩解与重投界面 | 已完成 | 辩解输入、候选限定重投、重投进度、无人出局分镜与角色状态 | M1 切片 4 | Web 17 项测试；浏览器平票闭环 |
| TASK-028 切片四验证与文档 | 已完成 | 78 项测试、全门禁、桌面/375×812 浏览器与信息隔离；更新 README/LOG | M1 切片 4、TEST | LOG“完成切片 4 平票辩解与候选重投” |

## 切片 5：事务、幂等与恢复

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-029 强化事务幂等与恢复 | 已完成 | 统一事务提交；高水位一致性；行动锁；启动恢复；SSE 补发；客户端去重；汇总 030～032 | M1 切片 5 | 030～032 全部完成；全仓 91 项、typecheck/lint/build/diff 与浏览器刷新重连通过 |
| TASK-030 验证事务故障回滚 | 已完成 | 分别在事件、私有动作、公开帧、快照、processed command 写入失败时证明整体回滚 | M1 123、SPEC persistence 122–137 | `game-repository.test.ts` 5 项触发器故障注入全部通过；逐表/快照未变化且失败后安全重试 |
| TASK-031 验证重启与重复调度恢复 | 已完成 | 启动时 AI 回合继续；人类回合等待；重复恢复/调度无重复事件或 action | M1 124–126、SPEC persistence 139–148 | `game-recovery.test.ts` 4 项通过：准备等待、AI 描述/投票恢复、稳定 actionId 唯一、二次重启零重复、高水位损坏拒绝；观战节点留待切片 6 |
| TASK-032 验证 SSE 游标补发与客户端去重 | 已完成 | `Last-Event-ID`/`after` 边界；无效游标回退；客户端携带当前 cursor；旧/同 cursor 不倒退 | M1 118、SPEC api 172–213 | Server `game-stream.test.ts` 3 项与 Web `App.test.tsx` 5 项通过；真实流式 SSE 读到预期帧后主动断开；修复可变 cursor |

## 文档治理任务

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-033 重整文档目录与索引 | 已完成 | 建立 tasks/notes/acceptance/history；移动现有文档；建立统一入口 | 负责人 2026-08-16 指令 | `docs/README.md` 与四类目录索引 |
| TASK-034 固化任务零到三十二 | 已完成 | 台账登记 TASK-000～032；同步状态、切片、检查点、验收和证据 | 负责人 2026-08-16 指令 | 本文件与 `milestone-1-checklist.md` |
| TASK-035 验证文档迁移完整性 | 已完成 | 检查目录树、旧路径、任务编号、本地链接与 diff；记录迁移结果 | GOV | 旧路径搜索为零；27 个 Markdown 本地链接通过；TASK-000～032 连续；`git diff --check` 通过 |

## 切片 6：放弃、淘汰观战与终局展示

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-036 实现放弃领域与接口 | 已完成 | `preparing/in_progress/awaiting_spectator` 放弃；原子持久化；幂等；无 `winnerCamp` | M1 切片 6 | shared 放弃状态机 2 项、Server 放弃 API 3 项通过；准备/进行中验证完成，awaiting_spectator 由 TASK-037 集成覆盖 |
| TASK-037 实现淘汰观战流程 | 已完成 | 人类非终局淘汰进入等待选择；继续观战后 AI 自动推进；视图不升级权限 | M1 切片 6、TEST | shared 观战状态机与 Server 观战/放弃集成测试通过；等待状态只开放两个命令，观战视图字段不存在 |
| TASK-038 实现终局揭晓与事实入口 | 已完成 | 正常终局按座位揭晓阵营/词牌；确定性事实入口；刷新不重复 | M1 切片 6 | shared 43 项、Server 流程 17 项和全仓 typecheck 通过；`finished` 才返回按座位 `reveal` 与持久化 `factReview`，终局提交唯一 `terminal_reveal_ready`；刷新事实相同，进行中/观战/放弃字段不存在 |
| TASK-039 实现 Web 放弃观战终局 | 已完成 | 二次确认放弃、淘汰选择、观战状态、终局分阶段揭晓与减少动态效果 | M1 切片 6、frontend UX | Web API/状态操作已接通；准备与进行中二次确认、`awaiting_spectator` 选择、观战提示、放弃终局、新对局入口、座位顺序自动揭晓、事实复盘开关、终局刷新恢复和 reduced-motion 已实现；Web 21 项测试与真实桌面/375×812 验证通过 |
| TASK-040 切片六验证与文档 | 已完成 | 全仓门禁；桌面/移动放弃/观战/终局；信息隔离；README/LOG | M1 切片 6、TEST | 全仓 103 项、typecheck/lint/build/diff 通过；桌面与 375×812 实测完成；reduced-motion、终局恢复与全阶段字段不存在测试通过；README、checklist、LOG 已更新 |

## 切片 7：完整自动化、验收与文档收口

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-041 建立切片七端到端测试 | 已完成 | 完善 Playwright 临时 SQLite 与可控假模型 E2E；覆盖正常、平票、放弃、观战、恢复和终局代表性流程 | M1 切片 7、TEST | `pnpm test:e2e` 10 项通过：normal 4、spectator 4、tie 2；桌面与 Pixel 5 覆盖正常终局/刷新、二次确认放弃、观战继续/放弃、平票辩解重投淘汰；每次独立 SQLite 与确定性随机/假模型；typecheck/lint/diff 通过 |
| TASK-042 验证全通道信息隔离 | 已完成 | Agent 输入、REST、SSE、日志和 DOM 负向矩阵；补齐里程碑证据 | M1 完成定义、TEST | 默认测试 104 项通过；Agent 普通投票补充未揭票目标/理由/概率不存在；REST 原始响应与 E2E DOM 覆盖准备/进行中/观战/放弃；SSE 进度逐帧与补发帧无目标/理由/概率/候选/词牌/阵营；Fastify 默认日志只记录请求元数据且浏览器/服务日志实测无私有字段；异常重试属后续切片外能力 |
| TASK-043 收口里程碑文档与验收 | 已完成 | 全部门禁、桌面/移动代表性验收、README/checklist/LOG 收口 | M1 切片 7 | 默认测试 104 项、E2E 10 项、build/typecheck/lint/diff 全通过；README、TESTING、checklist、PROJECT_LOG 已收口；七切片全部完成，未提交或推送 |

## 里程碑之外

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-044 扩充首版完整词库 | 已完成 | 将版本化词库从里程碑 4 组子集扩充为 30 组；简单/困难各 15 组；人工审核固定阵营、公平性、描述空间与泄词风险 | REQUIREMENTS 词库、DEC-075/076、SPEC persistence | `data/word-pairs.json` 30 组；`word-pairs.test.ts` 增加事实源数量/难度/启用/唯一性断言；文件级结构核对通过，完整命令门禁待本机执行环境恢复后补跑 |
| TASK-045 视觉与媒体收口 | 进行中 | 接入 BGM 与开关；整理五角色五状态素材；完善视觉/无障碍；支持默认纸面与审讯室背景切换 | frontend UX、ASSETS、负责人 2026-08-16 指令 | 待产出 Web 设置控件、媒体生命周期、背景主题、组件测试、桌面/移动验证与 LOG |

## 真实模型接入（DEC-085）

负责人 2026-08-16 指令：接入 Tokendance（OpenAI 兼容中转站）真实模型，服务端 env 配 Base URL + API Key（Key 由负责人自填），并在模型档案界面为三个 AI 身份选择并持久化 model ID。硬边界：Key/URL 只在服务端 env，绝不进入浏览器、数据库、日志、仓库或复盘；默认 `dev/test/test:e2e` 永不联网。

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-046 共享层角色真源与 model schema | 已完成 | 固化 `agent-roles.ts` 角色真源（roleId/displayName/personalityTags[3]/personalityPrompt）；新增 `model-profile.ts` 的 profile/list/update Zod schema 并从 `index.ts` 导出 | DEC-085、SPEC frontend §5 | `packages/shared/src/agent-roles.ts`、`model-profile.ts`；shared 单测通过 |
| TASK-047 AgentPolicy 异步化 | 已完成 | `AgentPolicy.act` 改 `Promise` 签名；`FakeAgentPolicy` 与服务端推进链全部 `await`；行为不变 | SPEC architecture、agent-runtime | `agent-policy.ts`、`fake-agent-policy.ts`、`game-service.ts` await 链；既有回归全绿 |
| TASK-048 Tokendance 客户端、真实策略与错误兜底 | 已完成 | `tokendance-client.ts`（fetch+AbortController 超时、脱敏错误分类）；`tokendance-agent-policy.ts`（分层 prompt、复用输出 schema、一次格式修复 + 有限系统重试可注入 Clock、耗尽抛脱敏 `AgentSystemError`）；`GameService` 捕获后经 `TerminateForSystemError` 终止为 `system_terminated`/`model_failure_limit`（DEC-072） | DEC-085、DEC-072、DEC-034 | `tokendance-client.ts`、`tokendance-agent-policy.ts`+`.test.ts`、`game-machine.ts` `terminateForSystemError`、`game-system-terminated.test.ts`；shared/server 单测通过，事件不含 Key/URL/Bearer |
| TASK-049 数据库角色模型配置表 | 已完成 | 新增 server-only `agent_role_models(role_id PK, model_id, updated_at)`；`agent-role-model-repository.ts` 读写并回退默认；确认不进入任何 `HumanGameView` 投影 | SPEC persistence §2.9 | `db/schema.ts`、`migrate.ts`、`agent-role-model-repository.ts` |
| TASK-050 DI 与 env 配置加载 | 已完成 | `.env` 加载（缺文件不报错）；`AGENT_PROVIDER`/`TOKENDANCE_BASE_URL`/`TOKENDANCE_API_KEY` 读取；provider 开关按 Key 决定 Fake/Tokendance，默认 fake；根 `.env.example`（Key 留空） | DEC-085、SPEC architecture §6 | `apps/server/src/config/`、`main.ts`、`server.ts`、`.env.example` |
| TASK-051 模型档案 REST 路由 | 已完成 | `GET /api/model-profiles`、`GET /api/models`（服务端代理，仅回 id）、`PUT /api/model-profiles/:roleId`（活动局 409、未知角色 404）；响应不含 URL/Key/请求头 | SPEC api §4.6 | `model-routes.ts`+`.test.ts`、`model-profile-service.ts` |
| TASK-052 前端模型档案界面 | 已完成 | `App.tsx` 增 `topView` 导航；`ModelProfiles.tsx` 三卡展示头像/标签/人格 prompt/model 下拉，禁展 URL/Key，fake 或活动局禁用选择 | SPEC frontend §3/§5 | `App.tsx`、`api.ts`、`ModelProfiles.tsx`+`.test.tsx` |
| TASK-053 文档与决策先行 | 已完成 | 落 DEC-085；同步 REQUIREMENTS、frontend-ux、agent-runtime、architecture、persistence、api-and-events、TESTING、CLAUDE 状态；登记本轮台账与检查点 | DEC-085、GOV | DECISIONS DEC-085；上述规格与验收文档已更新；本节与 checklist 已登记 |
| TASK-054 test:live 与全量验证 | 进行中 | `test:live` 可执行冒烟入口（缺 env 显式失败、绝不静默走假模型、脱敏输出）；`pnpm build/typecheck/lint/test/test:e2e` 全绿并断言 E2E 未实例化真实策略、无出网 | DEC-085、TEST §7 | `tests/live/run.mjs`、`package.json`；单测新增策略/路由/组件/负向隔离；全量门禁待本机执行环境复跑确认 |
| TASK-055 排查并优化开始/推进卡顿 | 已完成 | 修复"点击开始不自动跳转且很慢"：运行时后台推进 AI 回合（提交即返回、SSE 实时下发），测试同步 await；修复 E2E 泄读本机 `.env` 真实 Key 的隔离漏洞 | DEC-085、SPEC agent-runtime §2.1 | `game-service.ts` `settleAdvance`/`backgroundAdvance`、`server.ts` DI 开关、`playwright.config.ts` 服务端 `env` 强制假模型、`helpers.ts` 挂钟兜底轮询；typecheck/lint/test（120）与 test:e2e（10）全绿；后台推进失败仅脱敏记 `error.name` |
