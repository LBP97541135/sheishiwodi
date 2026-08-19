# 系统架构规格

- 状态：首个里程碑已实现基线
- 适用范围：当前基础玩法、Fake/Tokendance/通用 OpenAI 兼容 Agent、模型档案，以及异步复盘闭环；跨局历史管理待完成

## 1. 目标

系统必须在本机完成一局可恢复、可审计的 AI“谁是卧底”游戏，并以明确边界隔离浏览器、游戏规则、持久化和模型调用。游戏规则不得依赖 React、Fastify、数据库或具体模型厂商。

## 2. 仓库结构

当前仓库使用以下工作区边界：

```text
apps/
  web/                 React + Vite 前端
  server/              Fastify 服务、编排与后台任务
packages/
  shared/              领域类型、Zod Schema、状态机和纯规则
 data/
  word-pairs.json      版本化词库事实源
 tests/
  e2e/                 浏览器完整流程测试
  live/                真实模型脱敏 smoke（run.mjs，仅 pnpm test:live）
 .env.example           环境变量示例（不含真实值；真实 .env 为 gitignored）
```

当前可以增加必要的配置目录，但必须遵守以下依赖方向：

```text
apps/web ───────> packages/shared
apps/server ────> packages/shared
apps/server ────> SQLite / 模型中转站
packages/shared ─X─> React / Fastify / Drizzle / 网络 / 文件系统
```

- `apps/web` 不得导入服务端实现或直接访问数据库。
- `apps/server` 负责身份分配、私有数据、状态机调用、事务、Agent 编排和公开投影。
- `packages/shared` 只包含可确定性执行的类型、Schema 和纯函数。
- 具体模型名称只存在于角色配置；领域状态机不得分支判断 `DeepSeek`、`豆包` 或 `千问`。

## 3. 服务端分层

`apps/server` 至少保持以下逻辑边界，目录名可在不改变职责的前提下调整：

| 层 | 职责 | 禁止事项 |
| --- | --- | --- |
| HTTP/SSE | 解析请求、认证本地命令上下文、返回公开投影 | 直接修改对局阶段或胜负 |
| Application | 串联状态机、事务、Agent 调用和自动推进 | 绕过状态机生成领域结果 |
| Domain adapter | 调用共享状态机和校验器 | 读取网络或数据库 |
| Persistence | Drizzle 查询、事务、事件与快照持久化 | 决定游戏规则 |
| Agent runtime | 构建隔离上下文、调用模型、校验结果和重试 | 读取未授权私有信息 |
| Projection | 从权威记录生成浏览器或 Agent 可见视图 | 修改事实记录 |

## 4. 权威边界

- 服务端是身份、词牌、阶段、投票、淘汰和胜负的唯一权威。
- 浏览器只提交命令；客户端状态不得直接决定领域转换。
- 每次有效命令必须先由共享 Schema 验证，再由状态机验证当前阶段和行动者资格。
- 状态机输入为当前领域快照与命令，输出为新快照和待提交事件，不执行 I/O。
- 事件追加与快照更新必须在同一个 SQLite 事务中完成。
- SSE 只发布公开投影和非信息性行动状态，不发布模型原始输出或私有记录。

## 5. 主要运行链路

### 5.1 人类命令

```text
浏览器
  -> REST Schema 校验
  -> 加载快照并检查 expectedRevision / commandId
  -> 共享状态机转换
  -> 同一事务追加事件并更新快照
  -> 生成 HumanGameView
  -> 发布允许公开的 SSE 帧
  -> 如轮到 AI，调度自动推进
```

任何步骤失败时，不得只写事件或只写快照。重复的 `commandId` 必须返回第一次已提交的结果，不得再次转换状态。

### 5.2 AI 自动推进

```text
Application 取得当前行动锁
  -> 从权威数据生成该 Agent 的输入白名单
  -> 假模型或真实模型客户端返回结构化动作
  -> Zod、阶段、目标和内容校验
  -> 状态机转换
  -> 事务提交事件与快照
  -> 发布公开投影
  -> 继续下一名 AI，或在轮到存活人类时停止
```

刷新、SSE 重连或重复调度不得生成重复动作。行动锁与幂等键的具体持久化方式见 [`persistence.md`](persistence.md)。

### 5.3 恢复

```text
浏览器启动
  -> 查询未完成对局
  -> 获取 HumanGameView 与最新 revision/eventCursor
  -> 用户选择继续或放弃
  -> SSE 使用 Last-Event-ID 重连
  -> 服务端补发可回放公开事件，并发送当前公开状态
```

处于准备阶段的对局恢复后不得自动开始。轮到 AI 的进行中对局可以恢复自动推进；轮到人类时必须继续等待输入。

服务端现已区分普通刷新与服务进程中断。若进程在模型调用期间停止，对局保持进行中并持久化“中断后等待玩家确认”的运行状态；重新进入时由玩家决定继续被中断动作或开始新局。中断恢复调用不消耗常规模型错误重试预算。后台复盘中断则自动回到待处理队列，不弹出玩家确认。浏览器中的确认界面与 SSE/命令恢复状态将在 TASK-075 第三阶段接入。

## 6. 本地运行与配置

- 包管理和工作区工具固定为 pnpm workspace。
- Fastify 默认只监听 `127.0.0.1`。
- 首版不提供账户、登录、局域网访问或多用户并发控制。
- 浏览器可访问的配置只能包含非敏感显示信息（含可选的 model ID，DEC-085）。
- 中转站基础地址、认证密钥只能由服务端环境变量读取，绝不下发浏览器或落库。角色/复盘 model ID 由服务端权威持有，其中参赛角色 model ID 可通过模型档案界面选择并持久化到 `agent_role_models`。
- Provider 由 `AGENT_PROVIDER=fake|tokendance|openai-compatible` 切换（默认 `fake`）；所选真实 Provider 的 Base URL 与 API Key 均非空时才实例化真实策略，否则一律假模型。Tokendance 保持内置 model 回退兼容；通用模式不设默认 model，三角色 model 由模型档案显式保存，评测 model 由服务端 env 显式配置，缺任一项时开局前拒绝。真实变量清单见 `agent-runtime.md` 第 11 节。
- 仓库提供不含真实值的根 `.env.example`；真实 `.env`（gitignored）由负责人自填，真实配置不得进入 Git、SQLite、日志、SSE、复盘或截图。
- 下一阶段增加默认关闭的 `AGENT_DEVELOPER_MODE` 服务端门禁；它只控制诊断路由和前端能力入口，不改变 Provider、模型配置或基础脱敏审计。完整上下文记录开关只存于服务端当前进程，不写入 env、数据库或浏览器持久化，服务重启后自动关闭。

## 7. 根脚本契约

工程初始化后根 `package.json` 至少提供：

| 命令 | 契约 |
| --- | --- |
| `pnpm dev` | 同时启动 Web 与 Server，不隐式调用真实模型 |
| `pnpm build` | 构建全部工作区 |
| `pnpm typecheck` | 检查全部 TypeScript 项目 |
| `pnpm lint` | 执行静态检查 |
| `pnpm test` | 运行不依赖密钥、网络和付费模型的默认测试 |
| `pnpm test:e2e` | 使用假模型和临时 SQLite 跑浏览器完整流程 |
| `pnpm test:live` | 显式执行真实模型验收（`node tests/live/run.mjs`）；env 不齐时明确失败，绝不静默走假模型，且不得被其他脚本隐式调用 |

可以增加 `format`、数据库迁移或单包脚本。精确依赖版本在工程初始化时锁定，不在本规格中预设。

## 8. 运行质量约束

- 所有跨边界输入必须经过 Zod 或等价的共享 Schema 校验。
- 日志必须使用错误类别、对局 ID、动作 ID、耗时和重试次数等脱敏字段。
- 任何日志、异常和测试快照均不得包含密钥、敏感基础地址、完整请求头或被拦截的泄词原文。
- 正式规则不设置最大回合数；自动化测试必须有独立的步骤保护。
- 真实模型失败和后台复盘失败不得破坏已提交的游戏事实。
- 模型调用使用 `gameId -> commandId -> actionId -> attemptId` 统一关联；结构化日志、持久化尝试和本地调试面板复用同一链路。
- Agent 上下文在模型调用前执行可见性门禁；调试追踪默认只保存脱敏清单，完整 Prompt/响应只能由显式本地调试模式开启。
- Provider 熔断、观测 sink 和调试面板属于可替换基础设施，不得进入纯状态机或改变正常游戏规则。
- 数据库异常时允许服务以本机受限诊断模式启动，但不得继续游戏、模型、复盘、导出或写入。

## 9. 来源

- 需求：[`../acceptance/REQUIREMENTS.md`](../acceptance/REQUIREMENTS.md)“已确认游戏规则”。
- 决策：DEC-048、DEC-049、DEC-050、DEC-051、DEC-052、DEC-071、DEC-081、DEC-082、DEC-092 至 DEC-096。
