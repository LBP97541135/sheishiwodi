# 项目任务台账

本文件是长期任务状态的权威入口。会话内任务工具用于执行协助；两者不一致时，应立即核对并同步本文件，而不是等待切片结束后批量补写。

## 状态总览

- `TASK-000`～`TASK-056`：已完成。
- `TASK-057`：已完成；策略级、纯状态机整局及一次性 Web/HTTP/SSE/SQLite 真实对局与真实复盘验收均已产出脱敏证据。
- `TASK-058`：已完成；规格索引、测试文档和 README 的实现状态已同步。
- `TASK-059`：已完成；统一 Agent 校验、自动恢复与错误处理已实现并通过门禁。
- `TASK-060`：已完成；人类回合操作区可达性与提交前反馈已收口。
- `TASK-061`：已完成；当前代码、规格、任务、素材与验收报告的状态差异已完成文档收口。
- `TASK-062`：已完成；投票阶段所有有资格且尚未完成的玩家同步进入思考视觉状态，已投票者和重投候选保持正确状态。
- `TASK-063`：已完成（历史实现，后由 TASK-065 移除）；曾配置二期历史复盘占位入口。
- `TASK-064`：已完成；新对局配置页并排提供经典模式与猜词模式，猜词模式复用未开放提示弹层。
- `TASK-065`：已完成；顶层历史复盘入口及专属状态已移除，正常终局后的单局复盘入口保留。
- `TASK-066`：已完成；新对局首页收口为“身份配置在标题、玩法入口居中、难度独立下置”的信息层级。
- `TASK-067`：已完成；AI 复盘评价提示词已精炼为证据优先的短评价，并建立统一评分口径。
- `TASK-068`：已完成；README、Multi-Agent harness 说明与可提交的脱敏验收证据已按面试交付标准补强。
- `TASK-069`：已完成；通用 OpenAI 兼容中转站不设默认 model，三角色与评测 model 显式配置、开局门禁和独立联机验收已收口。
- `TASK-070`：已完成；通用中转站可按精确 model ID 为参赛与评测模型配置独立请求参数，不进行跨厂商 auto 猜测。
- `TASK-071`：已完成；模型配置错误码已纳入共享 API Schema，结构化 409 与回归验证通过。
- `TASK-072`：已完成；首页身份配置迁移后的 Playwright 助手已同步，10 项 E2E 全部通过。
- `TASK-073`：已完成；面试交付前最终零付费回归通过，并修复 E2E 前端启动耦合与移动端席位名称溢出。
- `TASK-074`：已完成；服务中断确认恢复与全局单并发复盘调度已实现。
- `TASK-075`：已完成；SQLite 启动门禁、迁移备份、繁忙处理、浏览器 SSE 重连和稳定命令恢复均已实现并验收。
- `TASK-076`：已完成；调用台账、统一链路、上下文门禁、完整调试记录与清理、单 Provider 轻量熔断及可选观测出口均已落地。
- `TASK-077`：已完成；双层门禁的四视图开发者面板、敏感记录确认和普通模式负向门禁已实现。
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
| TASK-045 视觉与媒体收口 | 已完成 | 接入 BGM 与开关；整理五角色五状态素材；完善视觉/无障碍；支持默认纸面与审讯室背景切换 | frontend UX、ASSETS、负责人 2026-08-16 指令 | `experience-settings.tsx` 设置控件（背景音乐开关默认关、纸面/审讯室背景单选）与 `useExperienceSettings` 媒体生命周期；`App` 根 shell 应用 `shell--<theme>` 与 `--scene-background`；`bgm.wav` 规范化为 `assets/audio/game-bgm.wav`（去掉仓库根中文路径导入）；新增 `experience-settings.test.tsx` 8 项组件/hook 测试（默认关、持久化、背景切换、底图、音源非中文路径）；typecheck/lint、默认测试 128 项、build 全绿；桌面与 375×812 实测背景切换与控件布局正常；待发布前压缩 10.5MB WAV（本机无 ffmpeg） |

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
| TASK-054 test:live 与全量验证 | 已完成 | `test:live` 可执行冒烟入口（缺 env 显式失败、绝不静默走假模型、脱敏输出）；`pnpm build/typecheck/lint/test/test:e2e` 全绿并断言 E2E 未实例化真实策略、无出网 | DEC-085、TEST §7 | `tests/live/run.mjs`、`package.json`；单测含策略/路由/组件/负向隔离；本机全量门禁复跑：typecheck/lint、默认测试 128 项、build、test:e2e 10 项全绿；E2E 由 `playwright.config.ts` 服务端 `env` 强制假模型、绝不出网；`test:live` 实测在非 tokendance env 下显式退出码 1、绝不静默走假模型、不发起网络调用；真实付费冒烟由负责人用自填 Key 执行 |
| TASK-055 排查并优化开始/推进卡顿 | 已完成 | 修复"点击开始不自动跳转且很慢"：运行时后台推进 AI 回合（提交即返回、SSE 实时下发），测试同步 await；修复 E2E 泄读本机 `.env` 真实 Key 的隔离漏洞 | DEC-085、SPEC agent-runtime §2.1 | `game-service.ts` `settleAdvance`/`backgroundAdvance`、`server.ts` DI 开关、`playwright.config.ts` 服务端 `env` 强制假模型、`helpers.ts` 挂钟兜底轮询；typecheck/lint/test（120）与 test:e2e（10）全绿；后台推进失败仅脱敏记 `error.name` |
| TASK-056 按模型家族关闭推理链 | 已完成 | 为 deepseek/豆包(seed)/千问(qwen) 三个游戏模型分别按厂商关闭推理链、加速直出，其他模型不受影响；抬高默认超时消除"超时→重试→多次调用"风暴 | DEC-085、SPEC agent-runtime §11 | 新增 `agents/model-reasoning.ts` `reasoningDisableBodyFor`（qwen→`enable_thinking:false`；seed/doubao 与 deepseek→`thinking.type=disabled`；其他→`{}`）；`tokendance-client.ts` 每次调用支持 `extraBody`；`tokendance-agent-policy.ts` 按 modelId 透传；`server.ts` 默认超时 20000→60000；新增 `model-reasoning.test.ts` 与策略层按家族断言；本机真实中转站实测 qwen 48→7s、seed 168→7.4s、deepseek 12→1.5s 且 content 仍合法 JSON；typecheck/lint、默认测试（shared 46/server 55/web 33）、build 全绿 |

## 真实模型分层验收（DEC-085 续）

负责人 2026-08-17 指令：在既有 `test:live` 冒烟之上补充**真实模型分层验收**与**脱敏 Markdown 报告**。`TASK-054` 已完成冒烟入口与默认门禁，本轮为覆盖 `TESTING §7` 后延的完整验收。范围包括策略级与可选整局；复盘模型不在本任务的真实调用矩阵内。当前异步复盘已有服务端任务、持久化与 API 基础设施，但 Web 尚未消费 `ReviewSummary`，应作为独立产品闭环继续跟踪。

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-057 分层真实模型验收与脱敏报告 | 已完成 | 在既有分层验证上补充一次性全栈真实验收：隔离 Node 22 先跑零出网门禁，再由可见浏览器通过 Web/HTTP/SSE/SQLite 完成一局真实参赛模型对局与真实复盘；只保留脱敏报告、两张截图和结构化摘要，不建设长期真实 E2E 脚本 | DEC-085、DEC-091、TEST §7、REQUIREMENTS 189–193 | 2026-08-19 临时 Node 22 门禁 186/186 默认测试、10/10 E2E、typecheck/lint/build 全绿；唯一一局 440 秒到 `finished/ended`，37/40 次真实请求。SQLite 为 110 事件、91 公开帧、26 AI 私有行动；真实复盘 `done`，Web 展示、刷新、Server 重启恢复和 Markdown 导出通过。2026-08-18 阻塞尝试不计入结果；证据见 `FULLSTACK_LIVE_2026-08-19.md` |

## 文档状态一致性

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-058 同步当前项目状态文档 | 已完成 | 修正 README、规格索引、测试文档中真实模型、系统终止、模型档案与媒体能力的过期描述；同步任务总览和 TASK-054 checklist；保持 TASK-057 未验证项为进行中 | GOV、TASK-054～057 | README、`spec/README.md`、`TESTING.md`、任务台账与 checklist 已同步；过期短语检索和 `git diff --check` 通过；完成记录见 PROJECT_LOG |
| TASK-061 收口当前文档一致性 | 已完成 | 依据当前工作区代码复核真实模型验收、异步复盘、媒体接入、运行时素材路径与发布边界；只更新文档，不改变产品行为 | GOV、SPEC、TASK-057～060 | README、CLAUDE、spec、ASSETS、TASKS、checklist 与 PROJECT_LOG 已同步；明确异步总结后端已具备基础但 Web 未接通，TASK-057 仍保留未完成边界；过期素材链接清理并通过 `git diff --check` |

## Agent 校验与自动恢复

负责人 2026-08-17 指令：先登记任务，再开发，最后补齐测试与完成记录。Agent 行动应尽可能自动恢复；自动恢复耗尽后才以脱敏错误提醒玩家。沿用已确认规则：结构错误先修复，发言格式错误重新生成，首次泄词秘密拦截并重生成、再次泄词强制退出并立即判断胜负；系统调用耗尽后进入 `system_terminated`，本轮不新增未确认的可恢复暂停状态。

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-059 统一 Agent 校验、恢复与错误处理 | 已完成 | ①建立 transport/http/empty-response/structure/schema/belief/illegal-action/content/word-leak/stale-result/persistence/internal 分类；②严格解析结构输出，仅允许安全规范化；③网络、限流、服务异常按可重试性处理，配置错误不盲目重试；④AI 内容不合法时自动重生成，重复泄词按规则强退；⑤模型调用期间 revision 变化时丢弃旧结果，提交失败不重复付费调用；⑥所有错误与公开帧脱敏；⑦补 shared/server/Web/E2E 所需测试 | REQUIREMENTS 57～71、129～146；SPEC agent-runtime §8～9；TEST §2～3 | shared 47、server 64、web 45 共 156 条单测通过；typecheck/lint/build 通过；E2E 10/10 与可见浏览器交互通过；默认假模型零出网；完成记录见 PROJECT_LOG |

## 对局操作体验

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-060 优化人类回合操作可达性 | 已完成 | ①当人类描述、辩解或投票回合首次到来且操作区在视口外时，平滑定位至操作区；不干扰用户手动回看时间线。②描述/辩解输入在禁用提交时显示最小字数、长度、泄词或格式原因。③补组件测试、桌面/移动浏览器验证和完成记录 | SPEC frontend §4.3～4.5、§6；TEST §2.5 | `GameScreen` 已实现操作区一次性定位与提交条件提示，补充组件测试；`git diff --check` 通过。当前环境无法运行 Vitest/服务端，但负责人已确认验证通过；完成记录见 `PROJECT_LOG` 2026-08-17 条目 |
| TASK-062 投票阶段同步思考状态 | 已完成 | 普通投票时所有存活且未完成玩家显示思考状态；重投时仅非平票候选参与；已投玩家恢复待机并显示已投票，不改变秘密目标、并行预取或顺序提交规则 | SPEC frontend §4.5、DEC-087 | `GameScreen` 已按投票资格与完成进度派生座位状态；初始投票、部分完成、重投组件测试通过，定向 Vitest 23/23、Web typecheck、可见浏览器完整投票交互与 `git diff --check` 通过；完成记录见 `PROJECT_LOG` 2026-08-17 条目 |
| TASK-063 配置二期历史复盘入口 | 已完成 | 顶层导航常驻“历史复盘”入口；点击后显示“当前为deta版本，正式上线后即可畅玩”，支持按钮、遮罩和 Esc 关闭，不进入未实现页面 | SPEC frontend §3 | `App` 已加入常驻入口与焦点受控的可访问弹层；App 定向测试 7/7、Web typecheck、桌面浏览器交互和控制台检查、`git diff --check` 通过；完成记录见 `PROJECT_LOG` 2026-08-17 条目 |
| TASK-064 配置二期猜词模式入口 | 已完成 | 新对局配置页并排提供“经典模式”和“猜词模式”；经典模式沿用现有创建流程，猜词模式复用 deta 版本提示且不进入未实现玩法；两个二期入口共享弹层状态和无障碍行为 | REQUIREMENTS 后续玩法、SPEC frontend §4.1 | `NewGameForm` 已加入响应式模式按钮组；App 测试 8/8、Web typecheck、桌面浏览器交互和控制台检查、`git diff --check` 通过；完成记录见 `PROJECT_LOG` 2026-08-17 条目 |
| TASK-065 移除历史复盘入口 | 已完成 | 顶层导航不再展示“历史复盘”，避免与正常终局后的“复盘”形成重复入口；清理专属状态、测试和现行规格，不影响单局复盘 | SPEC frontend §3 | `App` 已移除入口及历史复盘弹层分支；App 测试 7/7、Web typecheck、浏览器交互和控制台检查、`git diff --check` 通过；完成记录见 `PROJECT_LOG` 2026-08-17 条目 |
| TASK-066 收口新对局首页信息层级 | 已完成 | 标题“谁”作为玩家身份入口并在弹层中原子编辑名称与形象；中央突出经典模式、弱化猜词模式，难度独立下置；补齐键盘和焦点行为 | SPEC frontend §4.1、TEST §2.5 | `NewGameForm` 与 `App.test.tsx` 已覆盖身份保存/取消、模式入口和创建参数；Web 源码测试 52/52、生产构建、1280×720 可见浏览器交互、控制台检查和 `git diff --check` 通过；完成记录见 `PROJECT_LOG` 2026-08-17 条目 |
| TASK-067 精炼 AI 复盘评价提示词 | 已完成 | 评价结论先行，以当时可见证据判断推理、发言与投票；每名 AI 只保留核心依据、关键节点和一条具体改进；总体点评只提炼胜负手、关键转折与最大反事实；建立 1～5 分统一锚点，避免按最终输赢倒推表现 | REQUIREMENTS 110～115、SPEC agent-runtime、TEST | `review-agent-policy.ts` 已压缩输出预算并加入证据、反结果论和评分锚点；新增提示词契约测试。复盘相关纯测试 7/7、Server typecheck/build、全仓 lint 与 `git diff --check` 通过；完整 Server SQLite 回归受本机 Node 24 / better-sqlite3 Node 22 ABI 不匹配阻塞 |
| TASK-068 补强 GitHub 面试交付说明 | 已完成 | README 提供从克隆到运行、真实模型显式启用、核心架构、Multi-Agent harness、信息隔离、AI 辅助开发治理、验收路径与已知问题；生成可提交的脱敏真实模型证据索引；修正文档对 AI 复盘闭环的过期描述 | 负责人本轮交付要求、REQUIREMENTS 交付内容与评价重点 | README 已重构；新增 `docs/acceptance/EVIDENCE.md` 和复盘模型 env 示例；验收/规格/CLAUDE 当前状态已同步。本地链接、敏感值模式、过期描述、Git 跟踪和 `git diff --check` 均通过 |
| TASK-069 接入通用 OpenAI 兼容中转站 | 已完成 | 新增 `openai-compatible` provider 与通用服务端 env；Tokendance 旧配置保持兼容；通用模式不使用内置/默认 model ID，三个角色必须在模型档案手填或选择，复盘评价模型必须由 env 显式配置；未配齐时禁止开始游戏并返回清晰提示 | DEC-089、REQUIREMENTS 模型接入、SPEC architecture/agent-runtime/frontend/API | `provider-runtime` 集中解析双真实 Provider；模型档案支持手填和 `/models` 建议；开局门禁、通用 live smoke/policy/review 配置已实现。定向 Server 18/18、Web 5/5、Shared 2/2，三 workspace typecheck、Server/Web build、live TS 检查与 lint 通过；SQLite 路由回归受本机 Node ABI 不匹配阻塞，完成记录见 PROJECT_LOG |
| TASK-070 通用中转站按 model 配置请求参数 | 已完成 | 新增 `OPENAI_COMPATIBLE_MODEL_EXTRA_BODY` JSON 映射；键为精确 model ID，值为该模型单次 Chat Completions 附加参数；参赛与评测策略共用；未命中时不注入；保留全局 EXTRA_BODY | DEC-090、REQUIREMENTS 模型接入、SPEC agent-runtime | 运行时与 live smoke/policy/review/full 已共用精确映射；model 专属参数覆盖全局同名顶层字段，model/messages 最后强制写入。Server 定向测试 17/17、typecheck/build、live TS/语法检查、全仓 lint 与差异检查通过；完成记录见 PROJECT_LOG |
| TASK-071 修复模型配置门禁错误响应 | 已完成 | 将 `MODEL_CONFIGURATION_REQUIRED` 纳入共享 API 错误码 Schema，确保通用中转站模型未配齐时返回结构化 409，而不是 Fastify 通用 Conflict；补共享 Schema 与既有路由回归 | TASK-057 非付费门禁、TASK-069、SPEC API | `apiErrorCodeSchema` 已补齐错误码与共享回归；Server 路由恢复结构化 409。全仓默认测试 186/186、typecheck、lint、build 通过 |
| TASK-072 同步首页改版后的 E2E 助手 | 已完成 | 将创建对局助手由已移除的首页姓名输入框改为“谁”身份弹窗的可访问操作路径，并同步新对局返回断言；不改变产品交互 | TASK-057 非付费门禁、TASK-066、TEST E2E | 助手通过身份弹窗填写“玩家名称”并保存；normal 4、spectator 4、tie 2，共 10/10 项桌面/移动 E2E 通过 |
| TASK-073 面试交付前最终回归 | 已完成 | 在 Node 22 下复跑默认测试、类型、lint、构建和三模式桌面/移动 E2E；以 Chromium 截图检查首页、占位入口、对局态、图片、移动端宽度和控制台；修复测试 harness 对嵌套 pnpm 的依赖与窄屏席位名称换行 | TEST、GitHub 面试交付要求 | 默认测试 186/186、typecheck/lint/build、E2E 10/10 通过；Playwright 改为直接调用仓库 Vite CLI；Pixel 5 等效 393px 视口宽度 393/393、图片 4/4 完整、席位名称边界断言通过、控制台 0 warning/error |

## 下一阶段：稳定性与 Agent Harness 可观测性

负责人 2026-08-19 指令：保持本地单人应用的合理工程规模，先补齐运行中断、轻量数据/连接恢复，再增强 Agent 调用台账、上下文边界证明、统一链路、轻量熔断和本地只读调试面板。核心语义由项目自己定义，第三方平台仅保留可选适配接口；不改变已通过真实验收的三个模型现有超时、并行和重试流程。

实施不机械依照任务编号：先完成 TASK-076 的链路、调用台账、上下文清单、脱敏与调用前门禁基础；再推进 TASK-074、TASK-075 的服务端可靠性和浏览器恢复；最后完成 TASK-077 开发者面板。TASK-076 的熔断与清理可在服务端可靠性阶段一并收口。

| 任务 | 状态 | 目标与检查点 | 验收依据 | 完成证据 / 待产出 |
| --- | --- | --- | --- | --- |
| TASK-074 服务中断恢复与复盘调度 | 已完成 | 持久化模型调用中断状态；玩家确认继续旧局或开始新局；中断恢复不消耗常规重试；正常停机立即标记并取消本地等待；复盘中断自动回队；活动局阻止新复盘、在途复盘允许完成、全局复盘并发 1、空闲后按已确认优先级调度 | DEC-092/093、REQUIREMENTS 稳定性规划、SPEC architecture/persistence | `game_runtime_recovery`、`runtime_interrupted` attempt、恢复 Schema/API/状态机、关停 Abort、复盘全局队列；中断重启/继续/新局与调度测试通过 |
| TASK-075 SQLite 与浏览器轻量恢复 | 已完成 | 数据完整性异常进入仅健康检查的本机诊断模式；迁移前备份；SQLite busy 默认约 3 秒且只重试事务；SSE 中断提示/持续重连/立即重试；`sessionStorage` 保存待确认命令并复用稳定 `commandId` | DEC-094、SPEC persistence/API/frontend、TEST §2.7 | `quick_check` 健康门禁、仅健康路由、迁移前备份、可配置 busy timeout 与脱敏 503；SSE 3 秒提示、指数重连、立即重试与权威同步；八类命令发送前保存、响应不确定时权威判定及同 ID 重试。Web 恢复专项 17 项、源码测试 63 项、既有 E2E 10/10 与桌面/移动故障注入可见验收通过 |
| TASK-076 Agent 调用台账、上下文审计与轻量熔断 | 已完成 | 实现 `model_attempts`；贯通 `gameId -> commandId -> actionId -> attemptId`；生成独立上下文清单并在出网前阻止越权；脱敏记录随对局保留，完整 Prompt/响应仅显式调试、Git 忽略且按 7 天/容量上限清理；实现单 Provider 轻量熔断与可选 `TelemetrySink`，正常模型流程不变 | DEC-095/096、SPEC agent-runtime §12、persistence §2.6、TEST §2.7 | Schema/迁移、真实参赛与复盘 attempt、统一链路、结构化清单、出网前门禁、完整记录脱敏/启动清理/主动清除、共享熔断和 `TelemetrySink` 接口均已实现；定向测试与类型检查通过 |
| TASK-077 双层门禁的 Agent 开发者面板与验收 | 已完成 | 服务端 env 默认关闭且决定是否注册诊断能力；开启后前端提供当前标签页开发者开关和四类只读观测视图；完整上下文记录使用二次敏感开关、仅当前服务会话生效并逐条确认展开；普通模式 DOM/Network/开发者工具无诊断数据，不触发模型重放 | DEC-095/096、SPEC frontend/API、TEST §2.7 | `AGENT_DEVELOPER_MODE` 路由门禁、安全能力位、四视图面板、会话开关、逐条确认和清除入口已完成；Server 门禁/脱敏测试、Web DOM/Network 负向与交互测试通过 |
