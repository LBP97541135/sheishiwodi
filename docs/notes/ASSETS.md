# 角色素材索引

- 状态：角色素材、审讯室背景与背景音乐均已按发布规格压缩并接入
- 运行时素材目录：`apps/web/src/assets/`（仓库根重复原始目录已删除）
- 检查日期：2026-08-19
- 当前数量：30 张角色 WebP（25 张动作图、5 张头像）、1 张场景 WebP、1 个 MP3
- 覆盖范围：DeepSeek、豆包、千问、男性人类、女性人类各 5 种状态；1 张横版审讯室背景；1 首背景音乐

## 1. 使用结论

当前素材已经完整覆盖三个 AI 角色与男、女人类形象的待机、思考、发言、被怀疑和被淘汰状态。三组 AI 角色保持统一的女性拟人漫画方向；人类素材使用匿名深色剪影，不建立具体面部画像，并通过姿势和场景符号表达状态。各角色在同一组内的人物识别特征基本稳定，五种状态具有可辨识的表情、动作或道具差异。构图比例接近一致，能够直接放入统一的角色容器，并通过 `object-fit: contain` 保持完整人物。

当前代码在 `apps/web/src/assets/characters/` 保存 25 张 512×640 动作 WebP 和 5 张 256×256 头像 WebP，并通过 `character-assets.ts` 统一导出状态与头像映射；准备页与对局页继续使用五状态素材，加载失败时回退为文字占位头像。审讯室背景位于 `apps/web/src/assets/scenes/interrogation-room.webp`，背景音乐位于 `apps/web/src/assets/audio/game-bgm.mp3`。`useExperienceSettings` 继续负责背景选择、音乐默认关闭、循环、音量 0.24、自动播放解锁与卸载安全。

`scripts/optimize-assets.py` 是角色和场景的可复现转换与检查入口：动作图输出 512×640、头像输出 256×256、质量 84、透明源保留 Alpha。原 25 张角色 PNG、场景 PNG 和 10.5 MB WAV 已在解码、可见裁切、Web 测试与生产构建通过后从当前树移除，历史仍可从 Git 恢复。角色与场景运行时图片约 1.11 MiB；60 秒 MP3 为 44.1 kHz 立体声、128 kbps，约 0.92 MiB。

转换依赖固定在 `scripts/requirements-assets.txt`。从 Git 历史恢复原始目录或准备同结构的外部原始素材后，使用 `python scripts/optimize-assets.py --source-root <原始素材目录> --ffmpeg <ffmpeg路径>` 重新生成全部运行时资产；日常只需执行 `python scripts/optimize-assets.py --check` 验证格式、尺寸和可解码性。ffmpeg 只用于离线加工，不是应用运行依赖。

素材接入不得改变已确认的信息层级、漫画分镜尺寸或状态机行为；图片和音频只负责表现。

公开发布前仍需由项目负责人补齐生成来源、提示词、日期和许可记录，并确认画面右下角现有生成工具水印的处理方式。未确认前不移除水印，也不声称素材授权已经核验完成。

## 2. 状态语义

| 素材状态 | 使用场景 | 建议前端状态键 |
| --- | --- | --- |
| 待机 | 准备阶段、非当前行动、模型档案默认形象 | `idle` |
| 思考 | 模型正在生成描述、辩解或投票 | `thinking` |
| 发言 | 合法描述或辩解通过服务端校验后公开 | `speaking` |
| 被怀疑 | 成为最高票平票候选、进入辩解，或分镜中需要突出质疑 | `suspected` |
| 被淘汰 | 玩家已经淘汰后的公开状态 | `eliminated` |

投票中的非信息性状态默认复用 `thinking`；投票完成但尚未统一揭晓时恢复 `idle`，避免提前通过表情暗示投票目标。

## 3. 文件索引

### 3.1 DeepSeek

| 状态 | 当前文件 | 原始尺寸 | 可用性 |
| --- | --- | --- | --- |
| 待机 | `apps/web/src/assets/characters/deepseek/idle.webp` | 512 × 640 | 已接入 |
| 思考 | `apps/web/src/assets/characters/deepseek/thinking.webp` | 512 × 640 | 已接入；画布已统一 |
| 发言 | `apps/web/src/assets/characters/deepseek/speaking.webp` | 512 × 640 | 已接入 |
| 被怀疑 | `apps/web/src/assets/characters/deepseek/suspected.webp` | 512 × 640 | 已接入 |
| 被淘汰 | `apps/web/src/assets/characters/deepseek/eliminated.webp` | 512 × 640 | 已接入 |

### 3.2 豆包

| 状态 | 当前文件 | 原始尺寸 | 可用性 |
| --- | --- | --- | --- |
| 待机 | `apps/web/src/assets/characters/doubao/idle.webp` | 512 × 640 | 已接入 |
| 思考 | `apps/web/src/assets/characters/doubao/thinking.webp` | 512 × 640 | 已接入 |
| 发言 | `apps/web/src/assets/characters/doubao/speaking.webp` | 512 × 640 | 已接入 |
| 被怀疑 | `apps/web/src/assets/characters/doubao/suspected.webp` | 512 × 640 | 已接入 |
| 被淘汰 | `apps/web/src/assets/characters/doubao/eliminated.webp` | 512 × 640 | 已接入 |

### 3.3 千问

| 状态 | 当前文件 | 原始尺寸 | 可用性 |
| --- | --- | --- | --- |
| 待机 | `apps/web/src/assets/characters/qwen/idle.webp` | 512 × 640 | 已接入 |
| 思考 | `apps/web/src/assets/characters/qwen/thinking.webp` | 512 × 640 | 已用规范化名称接入 |
| 发言 | `apps/web/src/assets/characters/qwen/speaking.webp` | 512 × 640 | 已接入 |
| 被怀疑 | `apps/web/src/assets/characters/qwen/suspected.webp` | 512 × 640 | 已接入 |
| 被淘汰 | `apps/web/src/assets/characters/qwen/eliminated.webp` | 512 × 640 | 已接入 |

### 3.4 男性人类剪影

| 状态 | 当前文件 | 原始尺寸 | 可用性 |
| --- | --- | --- | --- |
| 待机 | `apps/web/src/assets/characters/human-male/idle.webp` | 512 × 640 | 已接入 |
| 思考 | `apps/web/src/assets/characters/human-male/thinking.webp` | 512 × 640 | 已接入 |
| 发言 | `apps/web/src/assets/characters/human-male/speaking.webp` | 512 × 640 | 已接入 |
| 被怀疑 | `apps/web/src/assets/characters/human-male/suspected.webp` | 512 × 640 | 已接入 |
| 被淘汰 | `apps/web/src/assets/characters/human-male/eliminated.webp` | 512 × 640 | 已接入 |

### 3.5 女性人类剪影

| 状态 | 当前文件 | 原始尺寸 | 可用性 |
| --- | --- | --- | --- |
| 待机 | `apps/web/src/assets/characters/human-female/idle.webp` | 512 × 640 | 已接入 |
| 思考 | `apps/web/src/assets/characters/human-female/thinking.webp` | 512 × 640 | 已接入 |
| 发言 | `apps/web/src/assets/characters/human-female/speaking.webp` | 512 × 640 | 已接入 |
| 被怀疑 | `apps/web/src/assets/characters/human-female/suspected.webp` | 512 × 640 | 已接入 |
| 被淘汰 | `apps/web/src/assets/characters/human-female/eliminated.webp` | 512 × 640 | 已接入 |

### 3.6 对局背景

| 用途 | 当前文件 | 原始尺寸 | 可用性 |
| --- | --- | --- | --- |
| 对局漫画主背景 | `apps/web/src/assets/scenes/interrogation-room.webp` | 1410 × 838，约 16:9 | 已接入纸面/审讯室切换 |

当前背景由 `sceneAssets` 导出并通过 `.shell--interrogation` 与 `--scene-background` 渲染；移动端使用同一图片的固定焦点裁切，桌面与 375×812 已完成实测。

### 3.7 背景音乐

| 用途 | 当前文件 | 格式 | 可用性 |
| --- | --- | --- | --- |
| 对局背景音乐 | `apps/web/src/assets/audio/game-bgm.mp3` | MP3，60 秒、44.1 kHz、立体声、128 kbps，约 0.92 MiB | 已接入；来源授权仍待负责人补充 |

背景音乐已由 `useExperienceSettings` 接入，默认关闭，只在允许的对局阶段播放，并提供本地开关。MP3 已通过完整解码检查；主观响度、循环接缝和授权来源仍需负责人最终听验与补充。

## 4. 接入命名

仓库当前只保留 `apps/web/src/assets/` 下的运行时副本；根目录重复素材已删除。角色目录如下：

| 角色 | 建议目录 |
| --- | --- |
| DeepSeek | `apps/web/src/assets/characters/deepseek/` |
| 豆包 | `apps/web/src/assets/characters/doubao/` |
| 千问 | `apps/web/src/assets/characters/qwen/` |
| 男性人类 | `apps/web/src/assets/characters/human-male/` |
| 女性人类 | `apps/web/src/assets/characters/human-female/` |

每个角色目录统一使用 `avatar.webp`、`idle.webp`、`thinking.webp`、`speaking.webp`、`suspected.webp`、`eliminated.webp`，由 `apps/web/src/character-assets.ts` 集中维护 URL 映射。组件不通过拼接显示名称推导文件路径。

## 5. 尚需补充或核验

### 5.1 发布前必须补充

- 在本文件的来源记录中补充生成工具、生成日期、主要提示词和必要后期处理。
- 由项目负责人确认并补充现有角色、背景和 BGM 的生成或下载来源、授权范围与对外使用说明。
- 由项目负责人决定现有角色动作图右下角生成工具水印是否保留；未得到来源与授权依据前不做去水印处理。
- 最终发布前人工听验 BGM 响度与循环接缝；程序已确认 MP3 可完整解码、时长与声道参数正确。

### 5.2 剩余素材的制作方式

剩余内容不建议全部交给 AI 生图。按可控性、清晰度、响应式适配、授权成本和是否需要程序状态变化，采用以下分工。

#### 适合继续使用 AI 生图

| 素材 | 建议 | 原因 | 优先级 |
| --- | --- | --- | --- |
| 漫画场景背景底图 | 已完成 1 张无人物、无 UI 的横版审讯室背景；仅当移动端固定焦点裁切验证不合格时再生成同风格竖版 | 当前图已满足桌面原型，避免无必要地继续生成重复背景 | 已满足原型 |
| 少量装饰性场景物件 | 可生成独立透明 PNG，例如台灯、椅子、文件夹、便签墙、侦探线索板 | 需要风格统一但不需要像素级几何准确；可以在多个分镜中复用 | 可选 |
| 纸张肌理原图 | 可生成 1–2 张无文字、低对比、可平铺的灰蓝或米灰纸张纹理 | 作为低透明度背景层使用，AI 只提供有机纹理；接入前必须处理接缝和压缩 | 可选 |

AI 生图不适合生成包含文字的词牌、按钮、图标、票数、角色名字或状态标签。文字和精确符号容易失真，也无法响应状态变化和无障碍要求。

#### 适合使用许可清晰的现成资源

| 素材 | 建议来源 | 原因 | 使用边界 |
| --- | --- | --- | --- |
| 通用功能图标 | Lucide、Heroicons 等可核验开源许可的 SVG 图标集 | 返回、关闭、历史、设置、下载、刷新、音量等图标已有成熟语义和无障碍实践，不值得生图 | 统一描边粗细，记录包版本与许可证，不直接下载来历不明图片 |
| 中文字体 | 合法开源字体，例如思源黑体/思源宋体、霞鹜文楷等，最终选择需兼顾 Web 体积 | 字体工程、字符覆盖和授权应依赖成熟资源，AI 无法生成字体文件 | 记录字体名称、版本、许可证和子集化方式；避免把系统字体误打包 |
| 音效（如果后续需要） | CC0、CC BY 或项目购买的短音效库 | 翻牌、盖章、揭晓等声音需要稳定采样和明确授权，AI 图像工具不适用 | 首个里程碑可不做；引入时保存来源和许可，提供静音控制 |

“找现成素材”只用于标准化基础资源，不建议寻找现成角色、词牌成品、投票章或整套游戏 UI。那些素材容易造成画风割裂和授权风险。

#### 适合由开发直接编写

| 素材 | 实现方式 | 原因 | 优先级 |
| --- | --- | --- | --- |
| 词牌正反面 | HTML/CSS + 少量自有 SVG 纹样 | 词语属于动态私有数据，必须是真实文本并支持翻转、隐藏、键盘和屏幕阅读器；不能做成生图 | 首个里程碑必须 |
| 投票标记、票箱和统一揭晓 | CSS/SVG 组件 | 需要按玩家、完成进度和揭晓状态动态变化，并严格隐藏未公开目标 | 首个里程碑必须 |
| 淘汰印章、违规章、系统异常章 | 自有 SVG 路径或 CSS 文字章 | 文案和状态必须准确、可缩放、可本地化；现成图片和 AI 文字都不可靠 | 首个里程碑按需 |
| 对话气泡、分镜框、思考泡、连接线 | CSS/SVG | 需要随文本长度和响应式布局变化，必须保持稳定尺寸和无障碍语义 | 首个里程碑必须 |
| “正在投票/已完成”等状态点与进度 | HTML/CSS | 属于实时状态，不是装饰图；必须与 SSE 数据一致 | 首个里程碑必须 |
| 词牌翻转、草稿线、揭晓和淘汰轻动画 | CSS 动画/Web Animations | 需要遵守 `prefers-reduced-motion`，并与实际状态同步 | 首个里程碑基础版 |
| 按钮、输入框、标签、导航、空状态和错误提示 | React + HTML/CSS | 属于交互系统，必须有焦点态、禁用态、错误态和响应式行为 | 首个里程碑必须 |
| 简单纸张噪点与阴影 | CSS 渐变、内联 SVG filter 或轻量纹理 | 如果只需微弱纸感，代码生成比再加载大图更轻、更容易调色 | 首选；不足时再用 AI 纹理 |

### 5.3 推荐执行顺序

1. 当前 25 张角色动作图和 5 张头像已按统一规格接入；后续新增角色复用 `scripts/optimize-assets.py` 或等价上传处理链。
2. 词牌、投票、印章、气泡、分镜和所有通用 UI 由开发直接编写，不等待额外图片。
3. 通用功能图标和字体在工程初始化时从许可清晰的开源资源中选定并登记。
4. 审讯室背景与 BGM 已接入；后续只需完成 Web 音频压缩、图片规范化和来源/授权记录。其余装饰物与纸张纹理均为可选。

## 6. 素材来源记录

以下字段需要项目负责人补充；未填写前不影响本地开发，但不应在公开发布时声称来源记录完整。

| 项目 | 当前记录 |
| --- | --- |
| 生成工具 | 待补充 |
| 生成日期 | 待补充 |
| 统一基础提示词 | 待补充 |
| 各状态派生方式 | 待补充 |
| 后期处理工具与步骤 | Pillow：动作图 512×640、头像 256×256、WebP quality 84；ffmpeg/libmp3lame：128 kbps MP3。视觉内容未做生成式修改，现有水印保留 |
| 对外使用与公开仓库说明 | 项目专用生成素材；发布前复核生成工具条款 |
