# dsh-tavern 公开案例预览：工作交接

更新时间：2026-08-19（Asia/Shanghai）

## 目标

把 Vercel 公开页从“空壳 UI”升级为可浏览的初始化公开案例：复用真实 DSH Tavern UI，预置 README 截图涉及的主要功能状态；不要求真实模型游玩，也不需要刻意展示“没有模型配置，无法回复”。

公开地址：<https://dsh-tavern-preview.vercel.app/>

## 仓库状态

- 当前分支：`agent/github-pages-showcase`
- 最近已推送提交：`f8f4c27 feat: add public Vercel UI preview`
- 上述提交对应线上版本仍是旧的“空壳预览”；本轮公开案例升级尚未提交、尚未部署。
- `output/` 是用户文件，保持未跟踪，禁止纳入提交。
- `tavern-plugin/prompts/card-editor.md` 与 `tests/prompt-catalog.test.mjs` 是用户在本轮期间自行产生的改动，不属于公开预览工作；后续提交时应单独确认或排除，避免误收。

## 本轮已经完成的代码

### 1. 初始化公开案例数据

新增 [`preview/public-demo.mjs`](../preview/public-demo.mjs)，生成确定性的公开案例：

- 人物卡：阿芙拉（直接复用 `demo/cards/avra-complete.json`）。
- 剧本：`demo/scripts/the-missing-silver-bell-caravan.md`，按六幕生成 6 个剧本块。
- 素材：阿芙拉人物素材、黑麦镇世界素材。
- 四类预置会话：
  - 剧本故事 · 失踪的银铃商队；
  - 自由故事 · 金麦穗酒馆；
  - 设定对话 · 阿芙拉；
  - 素材抽取 · 阿芙拉。
- 功能状态：自由故事 5 个候选、剧本故事 1 个候选、3 条 Guide、人物姿势、剧本游标/召回/后续预览、世界书 6 条、素材抽取草稿和玩家身份。

### 2. 真实 DSH 会话快照

修改 [`preview/server.mjs`](../preview/server.mjs)：

- 每个实例启动时写入相同的 Tavern 数据、Workspace 存储和 4 个 DSH 会话日志。
- 会话使用 DSH 原生 `.jsonl.zstd` 格式；关键点是“header 单独一个 Zstd frame，events 另一个 frame”，否则 DSH 会报 `first frame is not exactly one header line`。
- 采用确定性的 workspace/session ID，目标是解决 Vercel 多实例间随机 Workspace 不一致的问题。

### 3. 公开页直接进入真实案例

- [`server.mjs`](../server.mjs) 已移除 `?fixture=empty` 重定向，恢复真实 DSH API/UI。
- [`preview-plugin/lib/index.js`](../preview-plugin/lib/index.js) 在首次访问且本地没有公开案例会话时，将 `dsh.sessions.current` 初始化为 `session-public-script`，因此页面默认打开剧本案例；后续用户切换会话后刷新仍保留其选择。
- Workspace 展示名改为“dsh-tavern 公开案例”。

### 4. UI 与预览行为

- 移除了人物卡选择器里刻意显示的“没有模型配置，无法回复”。
- Tavern 会话列表现在可以优先使用 chat 自带的公开案例标题，避免尚未打开的会话显示成 `workspace`。
- 预览模式下点击“生成/重新生成候选项”会返回当前会话已经初始化的候选，不再用提示语替代候选内容。
- README 在线预览说明已改为“初始化公开案例，可浏览主要功能”。

### 5. 测试

新增 [`tests/preview-public-demo.test.mjs`](../tests/preview-public-demo.test.mjs)，检查：

- 四类会话完整；
- 默认剧本会话；
- 5/1 候选结构；
- Guide、姿势、6 幕剧本、6 条世界书、2 份素材和抽取玩家身份。

该测试文件刚加入，尚未运行完整测试套件。

## 已完成的本地浏览器验证

在本地真实浏览器中验证过：

1. 清空 localStorage 后访问根地址，会自动打开“剧本故事 · 失踪的银铃商队”。
2. 正文、玩家输入、阿芙拉回复正确显示。
3. 右侧显示：剧本游标 2/6、已召回 1 块、当前与后续剧本块、3 条 Guide、人物姿势。
4. 点击“生成候选项”后显示单个剧本候选；展开后可以看到“填入输入框”。
5. 切到卡片模式会自动打开“设定对话 · 阿芙拉”，展示分析、两方案、确认修改三轮对话；右侧显示人物卡字段和已绑定 6 块剧本。
6. 打开“素材抽取 · 阿芙拉”，可看到两份素材、玩家身份、完整抽取草稿和对话。

## 下次继续时需要完成

1. 运行 `node --test tests/*.test.mjs`，确认新测试及用户的并行提示词改动是否都通过。
2. 本地补验：
   - 自由故事会话及 5 个候选；
   - “重新生成候选项”意见输入框；
   - “重新生成正文”意见输入框；
   - 卡片高级字段中的世界书；
   - 卡片模式“从素材新建”的素材选择列表；
   - 四种历史会话标题首次加载时均正确。
3. 考虑公开案例是否要显式只读：目前删除 Guide、回退、发送消息等操作仍可能改动某个 Vercel 实例的临时状态。最小方案是仅在公开预览模式禁用会改变案例的按钮，但不要放醒目的无模型警告。
4. 部署到 Vercel 后，用全新浏览器上下文验证根地址和以上功能。重点验证多次刷新、不同请求命中不同实例时，确定性 Workspace/Session 仍能稳定读取。
5. 线上验证通过后再提交：只纳入公开预览相关文件；不要误收 `output/`，也不要未经确认纳入用户修改的提示词文件。
6. 推送 `agent/github-pages-showcase`；是否合并 `main` 由用户另行决定。

## 建议使用的 skills

- `playwright`：逐项验证真实 UI、候选面板、卡片模式和素材抽取。
- `vercel:deployments-cicd`：重新部署并检查构建/运行日志。
- `vercel:verification`：完成线上全流程验证。
- `diagnosing-bugs`：若仍出现 Vercel 多实例状态错配、SSE/会话加载问题，按证据链排查。

## 注意事项

- Vercel Functions 不支持原生 WebSocket 升级；现有 preview plugin 已通过 SSE bridge 兼容 DSH 事件流，不要轻易删掉。
- Vercel `/tmp` 按实例隔离，不能依赖运行中创建的随机 Workspace/Session；公开案例必须保持确定性初始化。
- 当前实现的核心价值是“真实 UI + 初始化数据”，不要退回单独维护的静态演示页或 README 图片画廊。
