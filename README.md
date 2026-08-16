# 谁是卧底

项目已经进入首个纵向里程碑开发，当前完成“创建对局—准备—查看词牌—开始游戏—描述—秘密投票—统一揭票—平票辩解—候选重投—淘汰或无人淘汰—人类淘汰后观战/放弃—正常终局揭晓与事实复盘”的可持久化、可恢复纵向链路。

## 本地开发

需要 Node.js 20.11+ 与 pnpm 9.15.9。安装依赖后运行：

```bash
pnpm dev
```

浏览器访问 `http://127.0.0.1:9001`，Fastify API 监听 `http://127.0.0.1:3001`。默认开发流程只使用本地词库和 SQLite，不调用真实模型。

常用验证命令：

```bash
pnpm test
```

```bash
pnpm typecheck
```

```bash
pnpm lint
```

```bash
pnpm build
```

```bash
pnpm test:e2e
```

首次运行 E2E 前若本机尚无 Playwright Chromium，执行 `pnpm exec playwright install chromium`。E2E 会自动启动真实 Web/Server，使用可控假模型、确定性随机序列和独立本地 SQLite，不读取密钥或调用付费模型。

## 核心设计

- `packages/shared` 承载领域类型、Zod Schema、纯内容校验和纯状态机；不依赖 React、Fastify、数据库或网络。
- Fastify 是权威裁判，通过 REST 接收命令，通过 SSE 发布安全公开帧；SQLite/Drizzle 同一事务提交快照、不可变事件、私有 Agent 动作、公开流和幂等结果。
- React 只消费 `HumanGameView` 和公开事件，不读取数据库实体或完整领域快照。
- 当前使用可控 `FakeAgentPolicy` 验证 Agent 自动描述、投票、辩解、重投和信念快照；三个 AI 与复盘模型的真实接入将共用 OpenAI 兼容中转站，只通过模型 ID 区分。

## AI 工具与验收

AI 开发助手用于需求拆解、规格维护、代码实现、测试、浏览器验证和素材索引；项目负责人把关产品范围、重大架构、付费真实模型调用、Git 提交/推送和发布。角色与场景素材的来源、状态映射和发布前处理记录见 [`docs/notes/ASSETS.md`](docs/notes/ASSETS.md)。

默认 `pnpm test` 和 `pnpm test:e2e` 都不访问网络、不读取模型密钥、不产生模型费用。真实模型验收预留为 `pnpm test:live`；当前命令会明确失败，待真实接入后才启用，并将生成脱敏 Markdown 报告与关键截图，记录模型标识、结构校验、信息隔离、耗时、重试和复盘结果。

## 信息隔离

正常终局前，真实阵营、其他玩家词牌、AI 信念与理由、未揭晓选票目标均不得进入 REST、SSE、日志、Agent 非授权上下文或 DOM；淘汰观战仍使用普通公开视图。只有 `finished` 视图包含 `reveal` 与 `factReview`；`abandoned` 无 `winnerCamp`、完整揭晓或私有行动复盘。测试使用“字段不存在”的负向断言，而不是只依赖页面隐藏。

恢复与幂等方面，事件、私有 Agent 动作、公开安全帧、快照与命令结果在同一 SQLite 事务提交；服务重启会恢复轮到 AI 的活动局，轮到人类时继续等待；SSE 使用持久化 `streamSeq`、`Last-Event-ID`/`after` 补发与客户端游标去重，刷新或重复恢复不会生成重复动作。

## 当前实现

当前支持新对局配置、固定四人阵容、难度词组抽取、随机卧底与首轮顺序、SQLite 恢复、词牌本地翻面和显式开始游戏。开始后由可控假模型自动推进 AI 描述、辩解、秘密投票与重投，服务端循环执行 AI 直到轮到存活人类、等待淘汰玩家选择或终局；人类在轮到自己时提交描述/辩解或秘密投票。普通投票出现部分平票时，候选依次辩解，非候选随后只在候选集合内重投；重投唯一最高票时淘汰，再次平票或全员最高票时本轮无人淘汰并轮换进入下一轮。正常终局按座位依次揭晓全部阵营与词牌，随后开放确定性事实复盘；普通投票和重投都只公开完成进度，全部合法票完成后才统一揭示目标。

## 已知边界

首个里程碑仍不包含真实模型、异步 AI 总结、历史列表/Markdown 导出、系统异常终止完整流程、重复泄词强退或最终素材优化。首版 30 组词库已经补齐。`pnpm test:live` 仍会明确失败，避免任何默认命令误触真实付费模型。

## 迭代与讨论记录

为了便于分享和复盘，项目把“当前工程契约”和“历史过程”分开维护：

- [`docs/tasks/TASKS.md`](docs/tasks/TASKS.md) 与 [`docs/tasks/milestone-1-checklist.md`](docs/tasks/milestone-1-checklist.md)：当前任务、检查点和证据。
- [`docs/history/PROJECT_LOG.md`](docs/history/PROJECT_LOG.md)：每个开发切片的目标、实现、验证和已知边界。
- [`docs/history/COMMAND_LOG.md`](docs/history/COMMAND_LOG.md) 与 [`docs/notes/DECISIONS.md`](docs/notes/DECISIONS.md)：负责人命令和关键决策。
- [`docs/history/chat/INDEX.md`](docs/history/chat/INDEX.md)：重要会话的脱敏归档索引。
- [`CHANGELOG.md`](CHANGELOG.md)：带版本号的较大变更；日常切片不滥用版本号。

历史文档用于追溯，当前行为始终以 [`docs/acceptance/`](docs/acceptance/README.md) 和 [`docs/spec/`](docs/spec/README.md) 为准。

## 项目文档

- [文档总导航](docs/README.md)
- [任务台账](docs/tasks/TASKS.md)
- [里程碑 Checklist](docs/tasks/milestone-1-checklist.md)
- [工程规格](docs/spec/README.md)
- [验收标准](docs/acceptance/README.md)
- [注意事项](docs/notes/README.md)
- [历史记录](docs/history/README.md)
- [版本变更记录](CHANGELOG.md)
