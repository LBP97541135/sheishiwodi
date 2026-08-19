# 核心命令记录

本文件只记录项目负责人发布的核心命令。发布时间以消息实际时间为准；当前无法读取的历史消息时间会如实标注。

| 编号 | 发布时间（北京时间） | 核心命令 | 状态 | 落实位置 |
| --- | --- | --- | --- | --- |
| CMD-001 | 2026-08-14（具体时间不可用） | 开展全栈开发；允许多轮版本迭代；关键分支须由项目负责人把关；保留聊天和开发记录，供后续复盘分析。 | 已纳入规范 | `docs/notes/COLLABORATION.md` |
| CMD-002 | 2026-08-14（具体时间不可用） | 记录核心命令及时间；只为较大变更分配版本号；项目文档和代码注释尽可能使用中文。 | 已落实 | `docs/notes/COLLABORATION.md`、本文件 |
| CMD-003 | 2026-08-14 19:49:19 +08:00（登记时间） | 从零开发 AI 版“谁是卧底”：至少一名人类和三名 AI，真实模型负责描述与投票，严格隔离每名 AI 的私有信息，具备完整流程、复盘、本地运行、错误处理和验证证据；先进行框架选型分析。 | 需求与架构已确认，待开发 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-004 | 2026-08-14 19:59:24 +08:00（登记时间） | AI 玩家需要持续猜测自己的阵营、卧底词、平民词及猜测理由，并将其用于赛后复盘；界面采用轻量 2D 手绘风格；继续探讨流程控制之外的 Multi-Agent 方法。 | 已部分修正，见 CMD-005 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-005 | 2026-08-14 20:09:47 +08:00（登记时间） | AI 不分别猜测平民词和卧底词，只猜测自己的阵营，并维护多个“敌对阵营身份词”候选及其依据。 | 已修正方案 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-006 | 2026-08-14 20:15:46 +08:00（登记时间） | 所有玩家只知道自己的词牌和哪些玩家已经淘汰；不知道自己的阵营，也不知道淘汰者的阵营与词牌。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-007 | 2026-08-14 20:17:48 +08:00（登记时间） | 基础玩法先采用经典人数胜负条件；完成并验收后再开发猜词玩法，且卧底和平民都可以猜测敌对阵营词。 | 已确认开发顺序 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-008 | 2026-08-14 20:19:12 +08:00（登记时间） | 发言顺序采用首轮随机、后续轮换起始玩家的方式，淘汰玩家自动跳过。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-009 | 2026-08-14 20:20:59 +08:00（登记时间） | 采用独立秘密投票，全部完成后统一公开；投票时记录每名 AI 当时的信念分布和投票理由。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-010 | 2026-08-14 20:23:20 +08:00（登记时间） | 最高票平票时，由平票候选简短辩解后重新秘密投票；再次平票则本轮无人淘汰。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-011 | 2026-08-14 20:26:13 +08:00（登记时间） | 描述采用 2 至 40 个字符、最多两句的适度限制；模型说出自己的词牌原词时，提示词自检和服务端校验均须拦截，并要求模型重新组织发言。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-012 | 2026-08-14 20:29:53 +08:00（登记时间） | AI 或人类玩家首次说出词牌原词时允许重新发言一次；再次违规则报告该玩家违反游戏规则，强制退出对局并立即进行胜负判定。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-013 | 2026-08-14 20:31:18 +08:00（登记时间） | 只有直接泄露自己的词牌原词属于游戏违规；长度和句数问题归类为格式错误，模型接口异常归类为系统错误；相同公开文本不做服务端重复拦截。 | 已由 CMD-077 修正 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-014 | 2026-08-14 20:32:51 +08:00（登记时间） | AI 采用行动节点更新信念：在发言、投票、平票辩解或重新投票前更新私有信念，并尽量与该次行动合并为一次模型调用。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-015 | 2026-08-14 20:36:11 +08:00（登记时间） | 首版固定为一名人类和三名 AI，但核心规则与数据结构必须为后续扩展玩家人数预留能力。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-016 | 2026-08-14 20:42:27 +08:00（登记时间） | 将不同厂商或不同模型人格化为 Agent 身份；为模型角色预设简短性格和基础提示词，并支持通过中转接口配置不同模型。 | 已确认方向 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-017 | 2026-08-14 20:45:50 +08:00（登记时间） | 对局内直接使用真实模型简称作为玩家名，不显示额外模型标签；对局外提供模型身份卡，每张卡包含三个性格标签和该模型的提示词。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-018 | 2026-08-14 21:12:26 +08:00（登记时间） | 模型身份卡只展示人格提示词；游戏规则、信息隔离、结构化输出和校验等系统提示词在代码与开发文档中单独维护。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-019 | 2026-08-14 21:16:19 +08:00（登记时间） | 首版固定三个模型身份：DeepSeek、豆包、千问；二期支持选择角色数量，并由玩家为每个 AI 座位选择模型。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-020 | 2026-08-14 21:17:52 +08:00（登记时间） | 三个模型角色采用轻人格：共享相同游戏规则、推理任务和输出结构，只使用简短提示词赋予轻微表达倾向。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-021 | 2026-08-14 21:28:43 +08:00（登记时间） | 首版使用项目内置、经过人工筛选的词语对，不使用模型动态生成或人类玩家自定义词语。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-022 | 2026-08-14 21:31:24 +08:00（登记时间） | 词语对固定区分平民词和卧底词，不随机交换；词库提供简单、困难两种难度，简单词更容易描述，困难词更难描述。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-023 | 2026-08-14 21:33:56 +08:00（登记时间） | 开局前由人类玩家选择简单或困难难度，服务端只从对应难度的启用词语对中随机抽取。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-024 | 2026-08-14 21:36:45 +08:00（登记时间） | 第一轮全员描述完成后立即进行秘密投票，不设置免投票观察轮。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-025 | 2026-08-14 21:37:58 +08:00（登记时间） | 正式对局不设置最大回合数，未满足胜负条件时继续进行，不因回合数判定平局或强制随机淘汰。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-026 | 2026-08-14 21:40:24 +08:00（登记时间） | 人类玩家可以主动放弃对局；放弃不判定阵营胜负，保留截至退出时的不完整复盘。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-027 | 2026-08-14 21:41:42 +08:00（登记时间） | 对局自动保存；重新进入时如存在未完成对局，由玩家选择继续，或放弃旧对局并开始新对局。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-028 | 2026-08-14 21:45:22 +08:00（登记时间） | 赛后复盘采用确定性事实时间线加独立复盘 Agent 总结；AI 总结不能覆盖或修改原始事实记录。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-029 | 2026-08-14 22:00:08 +08:00（登记时间） | 复盘 Agent 使用独立模型 ID、上下文和提示词，但与参赛 Agent 共用统一中转站连接；允许后续单独替换模型 ID。 | 已由 CMD-087 修正连接范围 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-030 | 2026-08-14 22:01:42 +08:00（登记时间） | 终局后自动异步生成 AI 复盘，复盘任务不得阻塞或妨碍玩家开始新对局。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-031 | 2026-08-14 22:05:03 +08:00（登记时间） | 模型调用采用实时对局优先调度；已发出的复盘请求完成，未开始的复盘任务让位于对局调用，后台最多同时执行一个复盘任务。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-032 | 2026-08-14 22:06:01 +08:00（登记时间） | 首版统一通过 OpenAI 兼容中转接口调用 DeepSeek、豆包和千问，以不同模型 ID 区分，不实现厂商原生接口。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-033 | 2026-08-14 23:00:06 +08:00（登记时间） | 模型通过提示词返回 JSON，服务端使用 Zod 校验；首次结构错误时执行一次格式修复，再次失败按系统错误处理，不处罚 Agent。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-034 | 2026-08-14 23:05:24 +08:00（登记时间） | Agent 采用词语优先的联合推理：先猜测多个异阵营词候选，再根据发言与候选词的接近程度推导玩家身份概率并投票；概率总量由本局卧底人数决定。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-035 | 2026-08-14 23:07:11 +08:00（登记时间） | 卧底人数属于公开对局配置，所有玩家均可获知；具体玩家阵营仍保密。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-036 | 2026-08-14 23:10:03 +08:00（登记时间） | 存活玩家投票时不能投给自己，也不能弃票，必须选择另一名存活玩家。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-037 | 2026-08-14 23:11:38 +08:00（登记时间） | 投票结束后公开每名玩家的投票目标；投票理由、身份概率和词语候选在对局中保持私有，只在赛后复盘展示。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-038 | 2026-08-14 23:15:23 +08:00（登记时间） | AI 生成期间展示角色化思考动画和非信息性状态；模型输出通过全部服务端校验后一次性公开，不流式展示原始内容或私有信念。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-039 | 2026-08-14 23:18:19 +08:00（登记时间） | 人类玩家的词牌默认显示牌背，点击翻开查看，再次点击隐藏；翻牌行为不作为公开事件。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-040 | 2026-08-14 23:21:33 +08:00（登记时间） | 对局主界面采用纯 2D 手绘动态漫画分镜，描述、辩解、投票和淘汰形成连续分镜，并由复盘复用该时间线。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-041 | 2026-08-14 23:23:02 +08:00（登记时间） | 漫画分镜采用连续纵向信息流，新行动追加在下方并自动跟随；玩家回看历史时不强制滚动，提供回到当前操作。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-042 | 2026-08-14 23:24:13 +08:00（登记时间） | 三个模型角色采用半身手绘人物素材，每个模型首版至少提供默认、思考、发言、被怀疑或淘汰四种状态。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-043 | 2026-08-14 23:25:36 +08:00（登记时间） | 人类玩家开局时从两个性别剪影中二选一；状态通过姿势、描边、气泡和印章表现。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-044 | 2026-08-14 23:26:54 +08:00（登记时间） | 人类玩家显示名称可以填写，未填写时默认使用“玩家”，长度限制为 1 至 12 个字符。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-045 | 2026-08-14 23:29:23 +08:00（登记时间） | 应用不设置宣传首页，默认进入新对局配置；主要视图为新对局、模型档案、历史复盘。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-046 | 2026-08-14 23:31:09 +08:00（登记时间） | 历史复盘支持导出单个 Markdown 文件，不提供 JSON 压缩包导出。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-047 | 2026-08-15 00:17:36 +08:00（登记时间） | 全栈框架采用 React + Vite 前端、Fastify 服务端、SQLite + Drizzle 数据层和共享 TypeScript/Zod 包。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-048 | 2026-08-15 00:18:55 +08:00（登记时间） | 对局持久化同时使用不可变事件日志和当前状态快照，事件作为复盘事实来源，快照用于快速运行与恢复。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-049 | 2026-08-15 00:19:58 +08:00（登记时间） | 游戏流程采用共享包中的自定义强类型状态机，以纯函数返回新状态和待持久化事件，其他模块不得绕过状态机修改阶段。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-050 | 2026-08-15 00:21:05 +08:00（登记时间） | 前端使用 REST 提交玩家命令，服务端使用 SSE 推送思考状态和已确认事件；断线后通过事件编号与状态快照恢复。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-051 | 2026-08-15 00:22:11 +08:00（登记时间） | 首版服务仅监听本机地址，不提供登录、账户或局域网访问，模型密钥只保存在服务端环境变量。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-052 | 2026-08-15 00:24:14 +08:00（登记时间） | 测试采用分层方案：默认使用假模型进行可重复自动化测试，另提供显式真实模型验收命令调用三个参赛模型和复盘模型。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-053 | 2026-08-15 00:25:27 +08:00（登记时间） | 真实模型验收生成脱敏 Markdown 报告和关键截图，并作为仓库验收证据保存。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-054 | 2026-08-16 11:19:18 +08:00（登记时间） | 角色素材先完成漫画分镜线框与规范，再生成一个模型角色样稿；样稿经项目负责人确认后才批量生成其余素材。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-055 | 2026-08-16 11:20:22 +08:00（登记时间） | 视觉样稿采用略有手绘抖动的墨线、克制的平涂色块和轻微纸张纹理，不使用复杂厚涂光影。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-056 | 2026-08-16 11:25:57 +08:00（登记时间） | 模型角色优先直接使用 DeepSeek、豆包、千问在网络上的主流 AI 女性形象原图；具体素材须逐一确定来源和再分发权限后才能写入仓库。 | 已被 CMD-057 替代 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-057 | 2026-08-16 11:28:10 +08:00（登记时间） | 由项目负责人使用统一提示词模板生成 DeepSeek、豆包、千问的项目专用女性拟人角色图，不再直接使用网上原图。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-058 | 2026-08-16（具体时间不可用） | 先完整查看项目已有内容并梳理协作规则；开展全栈、多版本迭代开发；关键节点由项目负责人把关；保留聊天和开发记录；遇到问题时一次确认一个点并提供多个选项讨论。 | 已落实 | `docs/notes/COLLABORATION.md`、`docs/notes/DECISIONS.md` |
| CMD-059 | 2026-08-16（具体时间不可用） | 聊天与开发过程采用双层留档：完整脱敏聊天稿与结构化项目记录并行保存。 | 已确认 | `docs/notes/COLLABORATION.md`、`docs/history/chat/INDEX.md`、`docs/notes/DECISIONS.md` |
| CMD-060 | 2026-08-16（具体时间不可用） | Git 采用 `master` 单分支直接开发，关键提交、推送与发布仍由项目负责人审批。 | 已确认 | `docs/notes/COLLABORATION.md`、`docs/notes/DECISIONS.md` |
| CMD-061 | 2026-08-16（具体时间不可用） | 更新并统一现有规则文档，但本轮不执行 Git 提交。 | 已落实，未提交 | `docs/notes/COLLABORATION.md`、`docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md`、`docs/history/PROJECT_LOG.md` |
| CMD-062 | 2026-08-16（具体时间不可用） | 首个可验收开发里程碑采用纵向最小闭环：搭建全栈工程骨架并使用假模型跑通一局，真实模型、完整漫画视觉和异步 AI 复盘后续接入。 | 已确认 | `docs/notes/DECISIONS.md` |
| CMD-063 | 2026-08-16（具体时间不可用） | 首个纵向闭环覆盖正常对局、一次平票辩解与重投、事件持久化和刷新恢复；重复泄词强退与异步 AI 复盘延后。 | 已由 CMD-071 修正主动放弃范围 | `docs/notes/DECISIONS.md` |
| CMD-064 | 2026-08-16（具体时间不可用） | 后续决策问答需要提供更充分的信息，说明背景、范围、收益、代价、风险和后续影响，方便理解各选择。 | 已落实 | `docs/notes/COLLABORATION.md`、`docs/notes/DECISIONS.md` |
| CMD-065 | 2026-08-16（具体时间不可用） | 首个里程碑前端采用风格化线框：完成响应式布局、漫画分镜结构、词牌翻转和状态反馈，使用统一占位角色，最终素材和精细视觉后续接入。 | 已确认 | `docs/notes/DECISIONS.md` |
| CMD-066 | 2026-08-16（具体时间不可用） | 最高票平票候选重新发言，其他未进入平票的存活玩家针对候选重新秘密投票；平票候选不参与重投。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-067 | 2026-08-16（具体时间不可用） | 如果所有存活玩家都是最高票平票候选，没有其他玩家可参与重投，则本轮直接无人淘汰并进入下一轮。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-068 | 2026-08-16（具体时间不可用） | 首版卧底席位在一名人类和三名 AI 中等概率随机分配，所有玩家仍只知道自己的词牌；测试可使用固定随机种子复现分配。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-069 | 2026-08-16（具体时间不可用） | 原词泄露采用规范化精确匹配：统一 Unicode 和英文大小写并移除空格与常见标点；同音、拼音、隐喻和语义近似不触发确定性处罚。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-070 | 2026-08-16（具体时间不可用） | 人类玩家被淘汰后选择继续观战至正常终局，或二次确认后放弃本局并退出；被淘汰后不再参与任何对局行动。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-071 | 2026-08-16（具体时间不可用） | 更正首个里程碑范围：人类存活时可以随时选择退出游戏；被淘汰后选择退出或继续观战。完整主动放弃能力纳入首个里程碑，不安排到后续。 | 已确认并修正 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-072 | 2026-08-16（具体时间不可用） | 对局采用 AI 自动推进：轮到 AI 时服务端连续编排，轮到存活人类时暂停等待输入；人类淘汰并选择观战后，AI 自动进行到终局。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-073 | 2026-08-16（具体时间不可用） | 模型系统错误从首次重试开始向玩家显示提示，并对当前行动自动重试三次；仍失败则将对局标记为“系统异常终止”，不判胜负、不记为玩家放弃。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-074 | 2026-08-16（具体时间不可用） | 三次模型自动重试之间采用固定 2 秒等待；自动化测试通过可注入时钟跳过真实等待。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-075 | 2026-08-16（具体时间不可用） | “系统异常终止”属于不可恢复终局，原对局不能从失败行动继续；历史页保留错误摘要与不完整复盘，玩家可开始新对局。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-076 | 2026-08-16（具体时间不可用） | 平票辩解与普通描述共用 2 至 40 字、最多两句和原词泄露校验；动作与事件类型仍保持区分。 | 已由 CMD-077 补充 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-077 | 2026-08-16（具体时间不可用） | 修正重复规则：服务端不拦截玩家之间、轮次之间或描述与辩解之间的相同公开文本；避免机械复读只写入 AI 提示词，不触发格式错误或处罚。 | 已确认并修正 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-078 | 2026-08-16（具体时间不可用） | 后续决策讨论应参考完整评审式说明，提供更充分的背景与方案取舍，并优先让项目负责人用自然语言表达、组合或修改方案，不频繁使用预设选择题。 | 已落实 | `docs/notes/COLLABORATION.md`、`docs/notes/DECISIONS.md` |
| CMD-079 | 2026-08-16（具体时间不可用） | 投票采用方案 C：规则上独立秘密投票，前端逐个展示具体角色正在投票或已完成投票，全部完成后统一揭晓目标。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-080 | 2026-08-16（具体时间不可用） | 首版词库采用方案 A：共 30 组，简单与困难各 15 组；每组人工筛选后启用。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-081 | 2026-08-16（具体时间不可用） | 词语对抽取采用方案 A：每局从所选难度的全部已启用词组中独立随机抽取，不参考历史记录，允许短期或连续重复。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-082 | 2026-08-16（具体时间不可用） | 开局采用方案 A：创建对局后先进入准备状态，人类查看词牌并点击“我已记住，开始游戏”后才进入第一轮；翻牌仍是本地行为。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-083 | 2026-08-16（具体时间不可用） | 淘汰观战采用方案 A：人类被淘汰并继续观战后仍只查看公开信息，所有身份、词牌和 AI 私有推理统一在正常终局后揭晓。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-084 | 2026-08-16（具体时间不可用） | 终局采用方案 A：按结果公布、身份与词牌揭晓、确定性事实复盘、异步 AI 总结的顺序分阶段展示；AI 总结不阻塞事实或新对局。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-085 | 2026-08-16（具体时间不可用） | 身份揭晓采用方案 A：终局后按座位顺序自动逐张翻牌，无需玩家点击；动画仅负责呈现，不改变已持久化的终局事实。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-086 | 2026-08-16（具体时间不可用） | 词库存储采用方案 B：仓库内独立 JSON 作为版本化内容事实源，经 Zod 校验后导入或同步到 SQLite；历史对局保存词组快照。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-087 | 2026-08-16（具体时间不可用） | 所有模型角色和复盘 Agent 通过同一个 OpenAI 兼容中转站配置，共用地址、密钥和客户端，每个角色只更换模型 ID。 | 已确认 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md` |
| CMD-088 | 2026-08-16（具体时间不可用） | 后续玩法继续保留，但先完成基础玩法开发；评估当前是否可以进入开发环节。 | 已评估，可进入开发 | `docs/acceptance/REQUIREMENTS.md`、`docs/notes/DECISIONS.md`、`docs/history/PROJECT_LOG.md` |
| CMD-089 | 2026-08-16（具体时间不可用） | 检查新建素材包；若有缺口则说明，若可直接使用则将素材索引写入项目文档。 | 已完成 | `docs/notes/ASSETS.md`、`docs/spec/frontend-ux.md`、`docs/acceptance/milestone-1.md` |
| CMD-090 | 2026-08-17（具体时间不可用） | Agent 错误尽可能自动解决；覆盖发言超时、关键词泄露、结构化发言错误和数据返回失败，只有自动恢复不了时才报错并提醒玩家；严格遵守先写 TASK、再开发、最后补测试与完成记录的流程。 | 已完成 | `docs/tasks/TASKS.md` TASK-059、`docs/notes/DECISIONS.md` DEC-086、`docs/spec/agent-runtime.md`、`docs/history/PROJECT_LOG.md` |
| CMD-091 | 2026-08-17（具体时间不可用） | 投票并行进行时，让所有模型和人类玩家同时进入思考环节，不再只显示 DeepSeek 进入思考。 | 已完成 | `docs/tasks/TASKS.md` TASK-062、`docs/notes/DECISIONS.md` DEC-087、`docs/spec/frontend-ux.md` §4.5、`apps/web/src/components/GameScreen.tsx` |
| CMD-092 | 2026-08-17（具体时间不可用） | 配置二期复盘入口；点击后弹出“当前为deta版本，正式上线后即可畅玩”。 | 已完成 | `docs/tasks/TASKS.md` TASK-063、`docs/spec/frontend-ux.md` §3、`apps/web/src/App.tsx` |
| CMD-093 | 2026-08-17（具体时间不可用） | 将“猜词模式”入口放在新对局配置页的开始操作旁，并将原开始操作改名为“经典模式”；猜词模式点击后显示同一 deta 提示。 | 已完成 | `docs/tasks/TASKS.md` TASK-064、`docs/spec/frontend-ux.md` §4.1、`apps/web/src/components/NewGameForm.tsx` |
| CMD-094 | 2026-08-17（具体时间不可用） | 当前同时存在“复盘”和“历史复盘”两块，移除“历史复盘”，保留正常终局后的“复盘”。 | 已完成 | `docs/tasks/TASKS.md` TASK-065、`docs/spec/frontend-ux.md` §3、`apps/web/src/App.tsx` |
| CMD-095 | 2026-08-17（具体时间不可用） | 优化新对局首页：经典模式放大居中、猜词模式缩小置于下方；标题“谁”作为玩家身份入口，名称和人物形象统一放入弹层，难度独立下置。 | 已完成 | `docs/tasks/TASKS.md` TASK-066、`docs/notes/DECISIONS.md` DEC-088、`apps/web/src/components/NewGameForm.tsx` |
| CMD-096 | 2026-08-17（具体时间不可用） | 更新项目文档，并将本轮改动提交、推送到 `master` 分支。 | 已完成 | `README.md`、`docs/`、Git `master` |
| CMD-097 | 2026-08-17（具体时间不可用） | 优化评价 LLM 的提示词，使评价更加精炼并突出重点。 | 已完成 | `docs/tasks/TASKS.md` TASK-067、`docs/spec/agent-runtime.md`、`apps/server/src/agents/review-agent-policy.ts` |
| CMD-098 | 2026-08-17（具体时间不可用） | 按最终 GitHub 交付要求补充 README、测试或验证证据，并突出产品完整性、Multi-Agent、信息边界、系统稳健性和 Agent 代码验证。 | 已完成 | `README.md`、`docs/acceptance/EVIDENCE.md`、`docs/tasks/TASKS.md` TASK-068 |
| CMD-099 | 2026-08-17（具体时间不可用） | 将复盘评价提示词优化与最终面试交付文档提交并推送到 `master`。 | 已完成 | Git `master`、TASK-067、TASK-068 |
| CMD-100 | 2026-08-18（具体时间不可用） | 优化真实模型接入以方便使用其他中转站；通用中转站不设置默认 model，三个参赛模型和评测模型都必须手动配置。 | 已完成 | TASK-069、DEC-089、`provider-runtime.ts`、`.env.example`、README |
| CMD-101 | 2026-08-18（具体时间不可用） | 不采用不可靠的模型家族 auto；为通用中转站补充按精确 model ID 配置请求参数的能力，并完善 `.env.example` 注释。 | 已完成 | TASK-070、DEC-090、`OPENAI_COMPATIBLE_MODEL_EXTRA_BODY`、`.env.example` |
| CMD-102 | 2026-08-18 20:24:14 +08:00 | 先进行非付费验证，再使用真实 API Key 执行一次性全栈付费验收；采用临时 Node 22 隔离环境，由助手控制浏览器完成一局，不建设长期真实模型自动化脚本，并保留脱敏报告、两张截图和结构化摘要。 | 2026-08-19 已完成；2026-08-18 执行阻塞，未形成验收结论 | TASK-057、DEC-091、`docs/acceptance/FULLSTACK_LIVE_2026-08-19.md` |
| CMD-103 | 2026-08-19（具体时间不可用） | 继续执行测试，尽可能在次日验收前完成项目回归与收口。 | 已完成 | TASK-073、`docs/acceptance/EVIDENCE.md`、`docs/history/PROJECT_LOG.md` |
| CMD-104 | 2026-08-19 13:01:55 +08:00 | 按一次一个决策点讨论下一阶段稳定性与 Agent Harness 可观测性；确认服务中断恢复、复盘调度、SQLite/浏览器轻量恢复、模型尝试持久化、独立上下文审计、统一链路、轻量熔断、本地只读调试面板及第三方平台仅作可选出口，并先按 notes 规范同步文档。 | 决策与规格已记录，开发待开始 | DEC-092～096、TASK-074～077、`docs/acceptance/REQUIREMENTS.md`、`docs/spec/` |
| CMD-105 | 2026-08-19 13:41:41 +08:00 | Agent 观测采用双层开发者模式：服务端默认关闭的总门禁决定诊断能力是否存在；开启后前端显示当前标签页开关和额外面板。面板内可显式开启仅当前服务会话的完整上下文记录，并在逐条确认后查看 Prompt/原始响应；普通模式不得通过浏览器开发者工具取得诊断数据。 | 已确认并同步规划 | DEC-095、TASK-077、Agent/API/前端/测试规格 |
| CMD-106 | 2026-08-19 13:45:22 +08:00 | 下一阶段按依赖顺序实施：先建立 Agent 链路、调用台账、上下文审计和出网前门禁，再实现服务端中断/调度/数据库可靠性，随后补浏览器连接与命令恢复，最后接入双层门禁的开发者观测面板。 | 已确认并同步规划 | DEC-096、TASK-074～077 |
| CMD-107 | 2026-08-19（具体时间不可用） | 进入四阶段开发；Agent 可观测性基础、服务端可靠性、浏览器恢复和开发者面板每完成一个大点分别提交一次 Git commit。 | 执行中；第一阶段已提交，第二阶段已完成 | TASK-074～077、`docs/history/PROJECT_LOG.md` |
