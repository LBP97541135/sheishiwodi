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

当前支持新对局配置、固定四人阵容、难度词组抽取、随机卧底与首轮顺序、SQLite 恢复、词牌本地翻面和显式开始游戏。开始后由可控假模型（`FakeAgentPolicy`，不联网、不读密钥）自动推进 AI 描述、辩解、秘密投票与重投，服务端循环执行 AI 直到轮到存活人类、等待淘汰玩家选择或终局；人类在轮到自己时提交描述/辩解（共用 2–40 字、最多两句、禁止直接泄露原词的校验）或秘密投票。普通投票出现部分平票时，候选依次辩解，非候选随后只在候选集合内重投；重投唯一最高票时淘汰，再次平票或全员最高票时本轮无人淘汰并轮换进入下一轮。人类被淘汰后可继续仅查看公开信息或放弃本局；准备和进行中放弃均需二次确认，不产生阵营胜负。正常终局按座位依次揭晓全部阵营与词牌，随后开放由公开事件和已持久化 Agent 行动组成的确定性事实复盘；刷新可恢复同一终局，不重复生成事实，减少动态效果模式会直接完成揭晓。所有普通投票和重投单票都只公开完成进度，全部合法票完成后才由单个 `votes_revealed` 事件统一揭示目标；漫画分镜、真人与 AI 五状态素材、SSE 安全帧同步均已接入。

信息隔离：正常终局前真实阵营、其他玩家词牌、AI 信念与理由、未揭晓选票目标均不进入 REST、SSE、日志或 DOM；淘汰观战仍使用普通公开视图。只有 `finished` 视图包含 `reveal` 与 `factReview`，`abandoned` 无 `winnerCamp`、完整揭晓或私有行动复盘；已由负向（字段不存在）测试与浏览器实测证明。

恢复与幂等：事件、私有 Agent 动作、公开安全帧、快照与命令结果在同一 SQLite 事务提交；服务重启会恢复轮到 AI 的活动局，轮到人类时继续等待；SSE 使用持久化 `streamSeq`、`Last-Event-ID`/`after` 补发与客户端游标去重，刷新或重复恢复不会生成重复动作。

## 已知边界

首个里程碑不包含真实模型、异步 AI 总结、历史列表/Markdown 导出、系统异常终止完整流程、重复泄词强退、完整 30 组词库或最终素材优化。`pnpm test:live` 仍会明确失败，避免任何默认命令误触真实付费模型。

## 项目文档

- [文档总导航](docs/README.md)
- [任务台账](docs/tasks/TASKS.md)
- [里程碑 Checklist](docs/tasks/milestone-1-checklist.md)
- [工程规格](docs/spec/README.md)
- [验收标准](docs/acceptance/README.md)
- [注意事项](docs/notes/README.md)
- [历史记录](docs/history/README.md)
- [版本变更记录](CHANGELOG.md)
