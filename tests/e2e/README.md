# 游玩验收 E2E

## 超长存档结算计时

`TAVERN_E2E_TIMEOUT_MS=120000 node tests/e2e/gameplay.mjs --settlement-performance`
在隔离 Profile 中生成匹配的 Chat 与原生 Session，使用真实官方 MVU、浏览器和日志存储，只有模型输出固定。
默认 1000 轮、20 个合成字段加金币、连续 5 次重新结算；可用 `TAVERN_PERF_ROUNDS`、`TAVERN_PERF_FIELDS`、`TAVERN_PERF_RUNS` 调整。
设置 `TAVERN_PERF_APPEND=1` 改为实际继续游玩、追加新一轮；此模式与重新结算分别统计。阶段事件同时记录执行上下文是否为增量及包含的消息数量。
合成字段从人物卡初始变量正常进入 MVU，每次独立读档验证所有字段和结算回执。

`settlement-performance.json` 区分浏览器 MVU 事件完成、服务端 runtime 返回、结算日志 append 完成、commit 返回和状态栏显示。
跨进程时间使用同机 epoch 时钟；`persistenceKind` 区分新格式 Head 发布与旧格式日志 append。新格式在原子 Head 发布并完成同步后记录，旧日志 append 表示操作系统可读写入，不代表 fsync。
计时关闭 Playwright tracing，避免长历史快照采集干扰。探针只通过隔离子进程的 ESM loader 注入；生产代码不变。
超大变量快照可能使冷加载或 UI 超时，失败不能作为成功耗时样本。

自动执行：启动酒馆 → 选择角色卡 → 新开一局 → 发消息玩一轮 → 检查正文、金币和人物姿势 → 刷新页面 → 确认同一局的数据仍然保留 → 生成 4+1 候选项并选择行动 → 再玩一轮 → 重新生成正文 → 编辑正文并刷新 → 回退并刷新 → 撤销回退 → Guide 添加/删除 → 重新结算变量 → 导出纯对话 → 切换本局预设并继续游玩。

## 改卡真实消耗

`TAVERN_E2E_CARD_EDIT_SOURCE=/本地/人物卡.json TAVERN_E2E_TIMEOUT_MS=120000 node tests/e2e/gameplay.mjs --real-card-edit`
复制指定人物卡到隔离 Profile，用 `~/.dsh-tavern` 已配置的真实模型在卡片工作台完成一次改卡任务，把步数、每步及合计 token（未缓存输入、缓存命中、输出）写入 `card-edit-usage.json`。可用 `TAVERN_E2E_CARD_EDIT_TASK`、`TAVERN_E2E_CARD_EDIT_MODEL`、`TAVERN_E2E_CARD_EDIT_EFFORT` 调整。会产生真实模型费用；步数随模型波动，对比时多跑几次。

## 坏档自愈（#196）

`TAVERN_E2E_HOME=$PWD/output/e2e-broken-home TAVERN_E2E_RESTORE_DATA=tests/fixtures/saves/issue-196-broken.tar.gz TAVERN_E2E_BROKEN_HEAL=send-now|send|regen node tests/e2e/gameplay.mjs --broken-save`
用当前版本打开一份真实坏档快照：存档漏记了一轮，模型上下文里却有。验收打开即补记、立刻发送不卡住且顺序正确、重新生成与回退正常，最后存档与模型上下文一致。约 75 秒。

快照由有缺陷的 v2.6 插件真实玩出：`TAVERN_E2E_HOME=<同一目录> TAVERN_E2E_KEEP=1 TAVERN_E2E_BROKEN_STOP=1 TAVERN_E2E_PLUGIN_SOURCE=<v2.6 检出>/tavern-plugin node tests/e2e/gameplay.mjs --broken-save`，再把该目录的 `profile-data` 打包。会话路径包含家目录，快照在本仓库的 `output/e2e-broken-home` 生成，恢复时必须用同一路径；换机器或仓库位置需按上面的命令重新生成快照。

## 存档优先：模型上下文自愈

`TAVERN_E2E_TIMEOUT_MS=60000 node tests/e2e/gameplay.mjs --native-repair`
玩两轮后停服，只改存档里最后一轮正文（模型上下文仍是旧的，模拟编辑没同步到模型）。验收：重新打开即按存档修复；下一轮模型实际收到的请求包含存档里的正文、不含旧正文；随后回退、重新生成、编辑正文、继续游玩都无报错，最后存档与模型上下文一致。模型请求记录在 `context-requests.jsonl`。约 150 秒。设计见 `docs/design/native-session-repair.md`。

## 故障后存档仍可用

`TAVERN_E2E_TIMEOUT_MS=60000 node tests/e2e/gameplay.mjs --failure-resilience`
依次制造：正文因长度上限截断、服务商拦截（一个字没写）、写到一半被掐断、手动停止、生成中服务崩溃重启、重新生成被拦截、回退只写进存档而模型上下文没跟上（停服把原生会话还原到回退前）、模型拒答。每种故障之后都继续发一轮、回退这一轮、重新生成最后一轮、再继续，要求：无报错；下一轮模型请求不带故障残留（被拦截/中断的输入、被回退的那一轮）；存档与模型上下文一致。约 3 分钟。

## 运行

安装项目依赖并准备 Chromium：

```sh
pnpm install
pnpm exec playwright install chromium
pnpm build:client
pnpm test:e2e
```

需要已安装酒馆的 DSH runtime，默认使用 `~/.dsh-tavern/runtime`。可用 `TAVERN_E2E_RUNTIME=/其他/runtime` 指定。当前在 macOS、DSH `0.1.5-rc.2`、Playwright Chromium 上验收；这不是 Android APK 测试。

每次创建临时 Profile、会话和角色卡，使用随机本地端口，不读取现有游玩数据或复制模型密钥。结束时关闭本次启动的浏览器和服务，删除临时数据。默认不加入常规 `pnpm test`，按需执行。

## 验证范围

实际运行 DSH、酒馆插件、浏览器、人物卡状态栏、官方 MVU 本地运行时与存储。只替换模型输出：固定回复领取奖励，通过真实 `mvu_submit_update` 和 `posture_submit` 工具完成结算。测试不会直接把金币写成预期值，也不会模拟酒馆 HTTP 接口。

界面必须显示金币 10 和正确姿势；独立读取落盘数据核对金币、结算回执、消息数与会话身份。刷新后重复这些检查，不能重复生成消息。状态栏故意每 200 毫秒更新 DOM，覆盖“页面一直变化导致变量同步迟迟不启动”的缺陷。

候选生成不能修改现有正文或金币；第二轮金币更新为 20；重生成把最新正文替换为雨夜版本并结算至 30，不能新增故事轮次；手工编辑保留变量和结算回执；回退恢复第一轮及金币 10，刷新后仍一致。

新增游玩按钮验收集中在 `play-controls.mjs`，共享前面的两轮游玩场景：

- 撤销回退：恢复手工编辑后的正文、金币 30，刷新后仍保留。
- Guide：添加后立即显示、刷新保留，删除后立即消失且刷新不再出现；不修改剧情或变量。
- 重新结算变量：填写修正意见，将金币改为 40，正文与轮次数不变，刷新后保留。
- 导出纯对话：实际下载 TXT，核对当前正文，排除被替换的旧正文、状态栏标记与内部工具内容。

`preset-switch.mjs` 覆盖“本局设置”中的外部预设：内置 → A → B → 内置。每次切换都核对历史消息、变量及会话身份不变，再发送一轮消息，通过真实工具更新金币至 50/60/70；刷新后核对正文、金币及预设选择保留。模型适配器记录实际收到的预设标记，断言新预设进入正文请求、旧预设不再残留，避免只验证下拉框外观。标记不会写入模型回复。

这覆盖 #92 提到的切换风险中的酒馆“本局预设”路径；报告未明确是否指宿主预设，不将此测试当成 Windows Desktop 宿主 Profile 切换验证。每次整套测试都会冷启动真实 DSH 并创建游戏，可拦住 #92/#93 所述插件初始化异常；未覆盖发行压缩包安装。

不覆盖真实模型的生成质量、远程 API 可用性、所有人物卡、压缩或 Android。先保留这一条核心验收路径，有具体风险再增加场景。

## 正文展示专项

运行 `pnpm test:e2e:display`，在真实 DSH 和 Chromium 中验证 HTML 美化、裸 HTML、EJS 属性和脚本执行；实际点击“生成候选项”后比较 iframe 高度、内容与落盘变量，再刷新复查。

最后停止临时服务，通过 Chat Journal 写入可复现的旧解析器损坏展示快照，再启动服务。页面必须恢复脚本执行，同时保留损坏快照原件、历史正文和变量。只有这个故障输入由测试构造，展示修复仍走生产读取和浏览器渲染路径。截图以 `display-` 开头；此专项不替代默认的重生成、编辑、回退和预设切换验收。

## 后台代理生命周期专项

运行 `node tests/e2e/gameplay.mjs --background-lifecycle`。使用固定模型延迟返回，连续两次点击停止后台，确认迟到输出不能修改金币，重试必须更换后台会话。随后在不刷新页面的情况下完成重试，核对指导意见保留、官方 MVU 状态栏与存档金币均为 40、子代理弹窗只有一项且标题计数为 1；重启整个临时服务后再次检查。

`background-attempts.jsonl`、`background-late.jsonl` 记录模型等待及迟到输出尝试，`background-*.png` 和对应文本保留界面证据。该专项验证取消、连续重试与重启；自动超时另由 `background-agent-idle-native.test.mjs` 覆盖，不将其称为浏览器超时验收。

## 正文强调色专项

运行 `node tests/e2e/gameplay.mjs --text-colors`。真实开局并挂载官方 MVU 状态栏后，检查对白与斜体高亮没有被人物卡资源清理误删，再切换宿主强调色变量为暖陶土和蓝色，核对高亮计算颜色、普通文字原色及存档不变。此专项不调用模型，截图以 `text-colors-` 开头。

## 产物和失败检查

每次结果保存到 `output/e2e-gameplay/run-*`：

- `report.json`：每一步耗时、失败步骤、刷新前后结果。
- `before-reload.png` / `after-reload.png`、`second-turn.png`、`regenerated.png`、`edited-after-reload.png`、`after-rollback.png`：各阶段页面截图。
- `failure.png` / `failure.txt`：失败现场。
- `saved-state.json`：测试会话的实际落盘证据。
- `conversation.txt`：实际点击导出按钮下载的纯对话文件。
- `undo-after-reload.png`、`guide-added.png`、`resettled-after-reload.png`：新增按钮验收截图。
- `preset-*.png` / `preset-*-reloaded.png`：切换及刷新后的截图；`preset-requests.jsonl`：模型边界实际观察到的预设标记（不保存完整请求）。
- `trace.zip`：浏览器操作和网络记录，可用 `pnpm exec playwright show-trace <路径>` 查看。
- `server.log`：本次服务日志，启动令牌已脱敏。Trace 仍包含本次临时服务的网络信息。

负向对照：让固定模型提交 9，但业务断言仍然要求 10。这条命令**应以非零退出码失败**：

```sh
TAVERN_E2E_WRONG_GOLD=1 TAVERN_E2E_TIMEOUT_MS=10000 pnpm test:e2e
```

其他可选变量：`TAVERN_E2E_OUTPUT` 指定产物父目录；`TAVERN_E2E_TIMEOUT_MS` 指定界面单步超时（默认 30 秒）；`TAVERN_E2E_KEEP=1` 保留本次临时数据用于诊断。启动单独限时 60 秒。

断言失败时先检查界面、日志与存档，不能因为实现输出不同就改成新的预期值。这里的验收约定始终是：领取 10 枚金币、显示正确状态、刷新后不丢失。

## MVU 增量写入与跨页面同步

`node tests/e2e/gameplay.mjs --mvu-incremental` 在真实 DSH、Remote 与状态栏 iframe 中调用 Helper API，分别更新历史楼、末楼、chat 和 script 变量，独立读档核对正文与回执未变。第二页面冷加载后检查直接写入及正式 MVU 重新结算的实时同步，最后重启服务、继续写入并刷新验证。

为一次运行收集完整证据，跨页面超时会先截图、记录磁盘/主页面/第二页面值，再刷新确认恢复并继续其他场景；所有已记录问题最终统一使测试失败，不会将刷新恢复当作实时同步通过。`report.json` 的 `staleViewers`、`variableScopes` 和 `variableIssues` 保存证据。该用例发现的两项问题已修复并通过复测，原始失败与修复证据见 [2026-09-27 验收报告](../../docs/verification/mvu-performance-e2e-20260927.md)。

## 压缩专项

运行 `pnpm test:e2e:compaction`，执行 32K 窗口下的五组前后台压缩验收。场景、模型边界与未覆盖范围见 [压缩专项 E2E](COMPACTION.md)。

## better-sidebar 升级验收

`node tests/e2e/gameplay.mjs --sidebar` 在完整游玩验收后，继续检查原生侧栏重复打开不增加标签、完整卡片调试入口预填 `/debug-card` 和游玩引用、从卡片工作台返回原游戏并刷新。可用 `TAVERN_E2E_SIDEBAR=/绝对路径/已解包插件` 在隔离环境验证待升级版本，不修改正在使用的 Profile。输出增加 `sidebar-card-debug.png` 与 `sidebar-return-to-play.png`；模型仍为固定测试模型。

## 人物卡原存档更新

`node tests/e2e/gameplay.mjs --card-update`：真实浏览器在已玩一轮的存档中，修改状态栏、EJS、世界书和变量定义，再通过“应用变化”继续游玩。检查初始值不覆盖进度、EJS 预览副作用隔离、坏模板不改存档、改名缺少迁移时拒绝、声明迁移的改名/转换/删除、前后台模型实际收到新世界书，以及回退和刷新后仍能使用新版状态栏。产物包括 `card-update-*.png`、`saved-state.json`、`preset-requests.jsonl` 和 `trace.zip`。模型输出固定，存储、模板、MVU、界面和结算执行真实链路。

## 失败回合恢复专项

`node tests/e2e/gameplay.mjs --surface-recovery`：在真实 DSH 中新开一局，从首次模型请求开始注入“只有思考、没有正文”，覆盖历史系统槽位更新。恢复操作使用 430×932 触摸浏览器窗口（服务重启后的历史导航在 1440×1000 宽屏完成，再切回窄屏），点击清除未完成回复并继续、原样重试、重启服务、重新生成失败再成功、回退并撤销，以及失败后不手动清理而直接继续。独立读取落盘 Chat 与 Session，核对未提交失败正文、原始输入重放、消息面无思考残留、历史和后续正文保留。

只在模型边界读取 `recovery-control.json` 控制故障，不模拟酒馆接口或直接修改存档；`recovery-requests.jsonl` 记录故障实际到达模型边界。输出还包含 `recovery-*.png` 和公共的 `report.json` / `trace.zip`。这是 Chromium 触摸与窄屏验证，不等同于手机真机远程访问。

## 原生新存档验收

`node tests/e2e/gameplay.mjs --native-format` 在普通完整游玩流程上增加磁盘格式断言和服务重启恢复：必须直接写入 `conversation-state-v2` 的 `head.json` / `blocks`，不能出现旧 snapshots/journals 或兼容迁移标记。页面变量还必须与独立原生读取器读出的当前世界一致。

`node tests/e2e/gameplay.mjs --native-format --mvu-incremental` 进一步验证 Helper 历史楼、末楼、chat/script 变量、第二页面实时同步、MVU 重算及重启后继续写入。两者都只创建合成新局，不测试迁移。

`node tests/e2e/gameplay.mjs --upgrade-save` 验证 DSH 0.2.1 统一升级：在独立测试环境准备旧版会话日志与 journal 剧情存储，重启后通过“升级存档”入口完成转换，核对旧文件与历史版本，再继续游玩、编辑、回退/撤销、切换预设和重启恢复。该选项替代旧 `--migrate-native`；实际覆盖与异常旧档限制见 `docs/verification/dsh-021-save-upgrade.md`。
