# 开发规格索引

- 状态：当前工程契约
- 适用范围：当前已实现的首个里程碑基线，以及文中明确标注为“后续/未实现”的首版契约

## 1. 目录用途

`docs/spec/` 回答“系统必须如何工作”，用于直接指导编码和联调；不保存需求讨论、任务进度、完成流水或聊天原文。

| 位置 | 职责 |
| --- | --- |
| [`../acceptance/REQUIREMENTS.md`](../acceptance/REQUIREMENTS.md) | 当前产品行为、范围和产品验收要求 |
| [`../acceptance/milestone-1.md`](../acceptance/milestone-1.md) | 首个里程碑切片合同与完成定义 |
| [`../acceptance/TESTING.md`](../acceptance/TESTING.md) | 测试分层、负向矩阵与验收场景 |
| [`../tasks/TASKS.md`](../tasks/TASKS.md) | 当前任务状态、拆分检查点和证据 |
| `docs/spec/` | 数据结构、模块边界、流程和接口契约 |
| [`../notes/DECISIONS.md`](../notes/DECISIONS.md) | 决策理由、替代关系和演进历史 |
| [`../history/PROJECT_LOG.md`](../history/PROJECT_LOG.md) | 已完成工作、验证结果和已知问题 |
| [`../history/COMMAND_LOG.md`](../history/COMMAND_LOG.md)、[`../history/chat/`](../history/chat/) | 负责人命令和脱敏讨论语境 |

若规格与较新的有效需求冲突，应先更新规格或取得负责人确认，不得通过代码静默改变产品行为。

## 2. 工程规格清单

| 文档 | 唯一职责 |
| --- | --- |
| [`architecture.md`](architecture.md) | 工程目录、模块边界、依赖方向和运行链路 |
| [`game-domain.md`](game-domain.md) | 领域术语、状态机、命令、事件和游戏不变量 |
| [`persistence.md`](persistence.md) | 逻辑数据模型、事务、数据可见性和恢复契约 |
| [`api-and-events.md`](api-and-events.md) | REST、SSE、错误响应和公开投影契约 |
| [`agent-runtime.md`](agent-runtime.md) | Agent 上下文隔离、模型输出、校验和重试契约 |
| [`frontend-ux.md`](frontend-ux.md) | 页面状态、漫画交互、响应式和防泄漏要求 |
| [`../notes/ASSETS.md`](../notes/ASSETS.md) | 素材路径、状态映射、接入命名与发布前处理要求 |

## 3. 当前实现边界

首个里程碑七个切片已经完成：基础玩法、平票、事务/恢复/SSE、放弃、观战、正常终局、事实复盘入口和 E2E 已落地；首版 30 组词库、Tokendance 真实模型、模型档案、严格 Agent 校验、错误分类、格式修复、内容重生成、重复泄词强退、系统重试、`system_terminated`、角色/场景素材、背景切换与音乐播放器也已实现。异步 AI 总结的服务端任务、持久化和 API 已有实现基础，但 Web 尚未消费 `ReviewSummary`，因此当前可用复盘仍限于确定性事实与历史信念；历史列表和 Markdown 导出未实现。各规格中的后续契约必须明确标注，不能读作当前用户能力。

## 4. 推荐阅读顺序

1. [`../tasks/TASKS.md`](../tasks/TASKS.md)：确认当前任务。
2. [`../acceptance/milestone-1.md`](../acceptance/milestone-1.md)：确认当前切片范围和验收。
3. [`architecture.md`](architecture.md)：确定代码位置和依赖方向。
4. [`game-domain.md`](game-domain.md)：实现共享类型与纯状态机。
5. [`persistence.md`](persistence.md) 与 [`api-and-events.md`](api-and-events.md)：实现事务、命令入口和事件推送。
6. [`agent-runtime.md`](agent-runtime.md)：实现 Agent 隔离与调用边界。
7. [`frontend-ux.md`](frontend-ux.md)：实现界面与交互。
8. [`../acceptance/TESTING.md`](../acceptance/TESTING.md)：逐层验证。

## 5. 规范性约定

- **必须**：实现和验收不可违反的约束。
- **应**：没有明确反例时应遵守；偏离时须在开发记录中说明。
- **可以**：不改变行为契约的实现选择。
- 状态、命令、事件和字段名称以 [`game-domain.md`](game-domain.md) 为准。
- 项目文档和界面文案优先中文，代码标识符和协议固定字段使用英文。
- 信息隔离必须通过字段不存在的负向测试证明。

## 6. 变更规则

- 产品行为变化：先更新需求并取得确认，再修改规格。
- 重大架构变化：先新增或替代决策，再修改规格。
- 新任务和检查点：实时更新 [`../tasks/`](../tasks/README.md)。
- 实现完成后更新 [`../history/PROJECT_LOG.md`](../history/PROJECT_LOG.md)，不要在规格中写完成流水。
- 密钥、敏感地址、运行时私有数据和完整模型原始响应不得写入文档。
