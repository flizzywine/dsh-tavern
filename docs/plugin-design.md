# 插件开放层设计

## 自定义玩法（gameMode）

通用玩法接口已发布到 main。宿主注册、持久成员、状态投影和恢复契约见[玩法 API](../presets/tavern/skills/tavern-plugin/references/plugin-api-game.md)；独立页面与大厅见[浏览器 API](../presets/tavern/skills/tavern-plugin/references/plugin-api-ui.md)。

狼人杀是独立人物卡，其规则、界面、构建与测试由 [dshcard-werewolf](https://github.com/flizzywine/dshcard-werewolf) 维护；[下载最新版人物卡](https://github.com/flizzywine/dshcard-werewolf/releases/latest/download/werewolf.dshcard)。Tavern 只维护通用玩法能力，不内置狼人杀规则。

状态：**已确认**（2026-10-09）。按「实施分期」分批实现；每一批都不改已发布的接口。

## 1. 为什么要系统设计

插件作者的需求会一直来。一个个满足，接口会越长越散，每个都带着当时那个需求的形状，最后谁也说不清插件到底能动哪里。

所以先把 Tavern 的一轮游戏拆成固定的**阶段**，再规定插件在每个阶段能用哪几种**方式**介入。新需求先问「它落在哪个阶段、用哪种方式」，而不是新造一个接口。

三条原则：

1. **核心只开接缝，变化留在开放层。** 核心在每个阶段的固定位置调用开放层一次；插件接口怎么扩展，都只改开放层（`tavern-plugin/lib/plugin-api.js`）。
2. **默认是对的。** 插件作者多半是用 AI 写插件的业余作者。回退、分叉、重新生成这类最容易写错的事，由 Tavern 统一处理，插件不用管。
3. **插件出问题，游戏不出问题。** 任何插件出错、超时、交回不合格的结果，都只影响它自己那一份，或者退回 Tavern 自己的做法。

开放层还有一个目的：**吸收原作者想不到的信息。** 该做什么功能、做成什么样，信息分散在玩家和插件作者手里。插件把这些信息变成能试用的东西；好的插件精简后吸收进本体，或者只吸收思路（见[插件生态](plugin-ecosystem.md)）。所以拿不准的需求，优先开接口，而不是自己猜着做。

## 2. 阶段

阶段的**输入和输出**是要长期兼容的约定；阶段内部 Tavern 怎么实现，随时可以改。

| 阶段 | 输入 | 输出 | 现在开放的 |
|---|---|---|---|
| 输入 | 玩家原话 | 保存的玩家消息、发给模型的输入 | — |
| 上下文 | 本轮输入、存档状态 | 固定前缀、本轮上下文（世界书、现场状态、Guide 等） | 添加：`promptSection`、`turnSection`、`worldbookSource`、`worldbookEntries`；观察：`getRequestContext`（本轮实际用到的各段） |
| 生成 | 组装好的请求 | 模型原始回复 | — |
| 回复 | 模型原始回复 | 保存的正文、显示用的正文 | 浏览器侧：正文标记、媒体渲染；替换显示：`registerTurnView`（正文本身不变） |
| 结算 | 本轮正文、存档状态 | 现场姿势、变量更新、人物设计 | 添加：`settlementSection`、`settlementTool`，以及插件自己的结算任务 `settlementTask`（结算前、与结算同时、结算后，玩家可排序、开关）；替换：`replaceSettlement`（普通卡的姿势结算） |
| 候选 | 本轮正文、存档状态 | 下一步行动候选 | 添加：`candidateSection` |
| 压缩 | 历史消息 | 历史摘要 | 添加：`compactionSection` |
| 生命周期 | — | 轮次写完、回退、撤销回退、重新生成、分叉、删局 | 观察：`onTurnSettled`、`onTimelineChanged`、`onGameRemoved`、`versionSignal`（版本失效即中止） |
| 人物卡 | 卡库、卡文件 | 卡的工作版、角色素材、素材包 | 观察：`onCardChanged`；添加：`cardImporter`（Tavern 不认识的格式）、写角色素材与素材包；改卡：`updateCardRaw`（可带 `expectedRevision`） |
| 界面 | — | 媒体、按钮、面板 | 浏览器侧 `tavernUi`（含侧栏面板 `registerPanel`、状态分节 `registerStatusSection`、`watchState`）；宿主侧 `attach`、`publishState` 等 |

## 3. 三种介入方式

| 方式 | 插件做什么 | 插件出错时 |
|---|---|---|
| 观察 | 收到只读通知，或按需读取 | 不影响任何东西 |
| 添加 | 往阶段输出里加内容：段落、条目、工具、媒体 | 丢掉它这一份 |
| 替换 | 接管整个阶段，交回符合约定的输出 | 退回 Tavern 自己的做法 |

**所有阶段通用的规则：**

- **超时**：插件的回调默认 30 秒内必须返回，超时按出错处理。
- **顺序**：同一阶段有多个插件时，按插件名排序；需要明确先后的，以后再加优先级。
- **替换的唯一性**：同一阶段、同一局只能有一个插件生效。冲突时以玩家在本局的选择为准；玩家没选时都不生效，并在界面上提示。
- **替换的约定**：每个可替换的阶段都要写明「必须交回什么、怎么校验」。不合格的结果和出错同样处理：退回 Tavern 自己的做法，并告诉玩家是哪个插件、为什么。
- **可见**：插件添加或替换的内容，在诊断和「完整上下文」里标明来自哪个插件。
- **版本**：接口带版本号，只加不改；废弃的先标记，至少保留 6 个月。

## 4. 插件存档数据

记忆、叙事锚点这类插件需要按轮保存状态。玩家回退、重新生成、分叉时，插件的数据必须跟着变，否则就和正文对不上。

**做法：数据绑定正文版本，由 Tavern 自动处理。** 不做快照，也不靠通知同步，而是和插件媒体项现在的做法一样：

- 插件写数据时，挂在「这一局、第几轮、这一轮的正文版本」上。
- 插件读数据时，问「当前显示的这条剧情线上，第 N 轮及之前最新的一条」。
- 回退或重新生成后，旧正文版本不再显示，挂在它上面的数据自然读不到；撤销回退，数据自然回来。插件不需要做任何事。
- 读取是按需查询，不依赖通知，所以不存在「插件没加载时漏掉了一次回退」的问题。

**两种存储，由插件按需选择：**

| 存储 | 随回退变化 | 用来放 |
|---|---|---|
| 按轮数据 | 是 | 记忆、状态、锚点等跟剧情走的东西 |
| 整局数据 | 否 | 插件设置、缓存、跨分支的统计 |

**各种操作下的行为：**

| 操作 | 按轮数据 | 整局数据 |
|---|---|---|
| 回退 | 被回退的轮次读不到 | 不变 |
| 撤销回退 | 恢复 | 不变 |
| 重新生成、编辑正文、切换版本 | 新版本没有数据，旧版本的数据读不到；切回旧版本时恢复 | 不变 |
| 分叉 | 分叉点及之前、当前显示的数据带到新游戏 | 复制一份到新游戏 |
| 删局 | 删除 | 删除 |
| 导出、导入存档 | 第一批不包含，以后再做 | 同左 |

**接口（第 2 版，已实现）：**

```js
// 写：只能写到当前显示的正文版本上
await ctx.tavern.saveTurnData({ gameId, turn, textVersion /* 可省略 */, data })
// 读：这条剧情线上第 turn 轮及之前最新的一条；没有时返回 null
const { turn, data } = await ctx.tavern.readTurnData({ gameId, turn })
// 整局数据
await ctx.tavern.saveGameData({ gameId, data })
const data = await ctx.tavern.readGameData({ gameId })
```

- 上限：每条 64 KB；整局数据 256 KB。
- 推荐插件每轮存一份**完整状态**，而不是只存变化：读取最简单，回退后也不用重算。
- 每个插件每局最多 2000 条、合计 8 MB。
- 每个插件只能读写自己的数据。

**分叉：** 媒体项和按轮数据都按游戏编号存储，而正文版本的编号里包含游戏编号。分叉时按新游戏重新计算有数据的那几轮的正文版本，把媒体项和按轮数据一起搬过去（第 1 批已实现；此前分叉时插件媒体项不会带过去）。

### 4.1 为什么没有「快照 token + 两阶段提交」（第 3 版）

外部插件提议过让插件参与 Tavern 的轮次事务（prepare / commit / invalidate / fork），并由宿主签发快照 token。没有采用，因为本节的做法已经给出同样的保证，而且更不容易写错：

- **迟到的结果写不进来**：`saveTurnData`、`attach`、`setVariables`、`editTurn` 都校验 `textVersion`，旧版本的写入一律拒绝。`textVersion` 本身就是宿主签发、插件拼不出来的版本标识。
- **不会出现「剧情已回退、插件还指向旧版本」**：插件数据和媒体挂在版本上，读取时只认当前版本，回退、撤销回退、分叉都不需要插件做任何事。
- **在途任务能及时停**：`versionSignal` 在版本失效时中止，结算任务的 `signal` 也一样。插件只负责「停」，不用实现提交和回滚。

两阶段提交要求每个插件都正确实现四个回调，错一个就会出现不一致；而版本绑定让「默认是对的」。确有绑定版本也解决不了的需求时，再按具体场景开放。

## 5. 玩家可见与管理

替换类接口上线前必须先有：

- **只有全局开关**：装好并启用的插件在每一局都生效，停用在「设置 → 酒馆插件」里做；卡内插件只在它那张卡的局里生效。（2026-10 去掉了本局插件面板和按局开关。）
- **出错提示**：插件的结果被退回或丢弃时，界面上告诉玩家是哪个插件、为什么。

## 6. 现有接口归位

| 接口 | 阶段 | 方式 |
|---|---|---|
| `onTurnSettled`、`onTimelineChanged`、`onGameRemoved` | 生命周期 | 观察 |
| `on(event, handler)` | 生命周期（事件表：玩家发送、正文开始、正文写完、本轮结算完、回合作废、剧情回退或改写、任务完成） | 观察；列在后台任务页「触发关系」里。「任务完成」带任务、成员和状态，可接在别的任务之后 |
| `emit(name, { gameId, data })` | 插件自己的事件 `<插件名>:<name>` | 添加：别的插件用 `on('<插件名>:<name>')` 接；data 至多 8 KB，每局每 10 秒至多 60 次 |
| `job({ name, title, on, needs, if, member, run })` | 任务表 | 添加：和酒馆自己的任务一样声明一项任务（仿 GitHub Actions 的 workflow）。`on` 是启动它的事件；`needs` 是它要等的别的插件任务（「插件名:任务名」），那些任务同一轮都做完才跑，`run` 收到它们返回的产出（`needs['插件名:任务名']`）。`run` 返回的就是本轮产出，只在内存，剧情回退到那一轮时作废。列在后台任务页的任务目录和触发关系里。示例见 examples/tavern-plugin-map 与 examples/tavern-plugin-phone-call |
| `publishOutput`、`readOutput` | 任务产出 | 添加：按轮次在存档里存一份带名字的结果（至多 64 KB），重启后也读得到；别的插件按插件名和名字读 |
| `member({ name, title, system?, tools? })` | 后台成员 | 添加：插件的常驻后台 Agent，每局一个，有自己的会话和缓存；不进存档时间线，不随剧情回退。带 `system` 时它有自己的前缀（这段系统提示词和 `tools`，每个任务都相同），`runTask({ member })` 只送一条工单、不能再带工具；不带时沿用 Tavern 的后台前缀（人物卡、世界书） |
| `getTurn`、`getTurnState`、`getCardContext`、`backgroundModel` | 上下文 | 观察（按需读取） |
| `promptSection`、`turnSection`、`worldbookSource` | 上下文 | 添加 |
| `settlementSection`、`settlementTool` | 结算 | 添加 |
| `replaceSettlement` | 结算 | 替换 |
| `settlementTask`、`manualTask`、`startTask` | 结算、手动任务 | 添加；带 `member` 时在该成员的常驻会话里按顺序跑 |
| `runTask` | 后台任务 | 默认开一次性临时 Agent；带 `member` 时进该成员的常驻会话排队。示例见 examples/tavern-plugin-diarist |
| `candidateSection` | 候选 | 添加 |
| `speechProvider`、`imageProvider` | 配音、生图渠道 | 添加：插件提供渠道，Tavern 自己不保存渠道 |
| `synthesizeSpeech`、`generateImage` | 配音、生图 | 借用：任何插件用玩家配好的渠道合成一句或画一张图；`generateImage` 与素材库生图共用同时至多四张的限制 |
| `compactionSection` | 压缩 | 添加 |
| `tavernUi.registerPanel` | 界面 | 添加 |
| `tavernUi.openOverlay` | 界面 | 添加 |
| `tavernUi.assetUrl` | 界面（插件 `assets/` 静态资源） | — |
| `tavernUi.setInput`、`tavernUi.submitInput` | 玩家输入 | 代玩家填写或发送，走玩家输入的同一条路径 |
| `tavernUi.onPlayEvent` | 玩家操作（选项、翻页停留、重播、报错） | 观察：只有计数和序号，不含正文 |
| `saveTurnData`、`readTurnData`、`saveGameData`、`readGameData` | （存档数据，见第 4 节） | — |
| `attach`、`update`、`remove`、`list` | 界面 | 添加 |
| `tavernUi` 全部 | 界面、回复 | 添加 |

现有接口都不需要改名或改字段，只是有了归属。

## 7. 实施分期

| 批次 | 内容 | 依赖 |
|---|---|---|
| 1 ✅ | 插件存档数据（按轮、整局）；分叉时带上按轮数据和媒体项；生命周期观察 `onTimelineChanged`（回退、撤销回退、重新生成、编辑、分叉）；编辑正文后重新发 `onTurnSettled` | — |
| 2 ✅ | 插件出错时退回 Tavern 自己的做法并记进日志（本局插件面板与按局开关已于 2026-10 去掉） | — |
| 3 ✅ | 第一个替换类接口：结算替换 `replaceSettlement`。第一版只替换普通卡的姿势结算，交回 `posture`；官方 MVU 卡的变量结算仍由 Tavern 负责，变量更新的交回格式等有实际需求再定 | 批次 2 |
| 4 部分 ✅ | 已开放：候选与压缩的「添加」（`candidateSection`、`compactionSection`）、浏览器侧插件面板 `registerPanel`。其余（输入、生成、宿主侧回复处理、世界书召回替换、候选与压缩的替换、MVU 变量结算替换）按实际需求开放 | 各自的需求 |

每一批都附带：文档、内置 Skill 里的副本、示例插件中相关的部分，以及「插件出错时游戏照常」的测试。

## 8. 已定的问题

1. **编辑正文后通知插件**：编辑产生新的正文版本后，也发一次 `onTurnSettled`（新的 `textVersion`），插件据此重算这一轮的数据。
2. **替换冲突**：同一阶段有多个插件要替换时，都不生效，用 Tavern 自己的。
3. **导出存档**：带上当前剧情线上的插件按轮数据、整局数据和媒体项（含媒体文件），导入时按新游戏的正文版本重新绑定；被回退的版本不带。

## 9. 语音服务

配音由语音插件（`dsh-tavern-tts`）提供，本体与舞台只通过契约读写，不 import 插件文件，也不拼插件的 HTTP 地址：

- **契约唯一来源**：`dsh-presentation-protocol/tts`（`src/types/tts.d.ts`）。插件的类型从这里 re-export；本体与舞台不另抄一份。
- **三个服务**：`ctx.get('tts')`（宿主侧 `Tts`：合成、缓存、服务列表、素材包声音来源与授权）、`ctx.get('ttsClient')`（浏览器侧 `TtsClient`：`available()`、`synthesize`、`audioUrl`、`jobStatus`、`cancelJob`）与 `ctx.get('ttsControl')`（配音设置页的控制 RPC）。插件未启用时这些服务都不提供，每次使用前重新 `ctx.get`。
- **没有服务时**：调用方保持安静，以 `TTS_UNAVAILABLE` 作为诊断；正文、存档和聊天照常，错误不进聊天。
- **内置朗读**：普通聊天正文的「🔊 朗读」通过 `readAloudLine({text})` 使用独立的 `tts.reading.readAloud.voice`，自动开关为 `readAloud.auto`，默认关闭；两项都在 酒馆设置 › 酒馆插件。`readAloudState()` 返回 `{stepAside, auto}`，是客户端唯一使用的舞台相关信号；有效舞台配音开启时让位，舞台画面不整篇朗读。仅对本页观察到完成的流式回复自动读一次，不在刷新或重挂载时补读。合成复用语音服务，播放复用同一个播放器，不读取通用声音或旁白设置。
- **台词朗读**：角色配音的正文 🔊 与插件的 `synthesizeSpeech` 都经 `speakLine` 交给语音服务（`domain/speech.js`）；本体没有自己的配音渠道、设置或音频缓存。朗读声音是插件设置 `tts.reading`：`dialogueVoice`（通用声音，所有卡通用：没绑定声音的人物和临时 NPC 使用；可选 `{silent:true}` 表示不配音）与 `narrator`（旁白的全局层，默认关闭；卡片的 `stage.narrator` 逐键覆盖它）。舞台的「配音」使用 `voice` 四态开关，详情页包含通用声音、旁白及旁白声音。「本卡单独指定」写入或移除 `stage.narrator.voice`；旁白没有单独指定声音时由 `effectiveNarrator` 回退至通用声音。声音的写法与人物声音选择器一致：`{browser}` 或 `{serviceId, voice}`。`tavern.speechProvider({synthesize})` 注册的渠道作为语音服务的 provider `tavern-plugin:<owner>:<id>` 接入。

  配音提供者的 `synthesize({text,voice,emotion,signal})` 应返回 `{data,mediaType:"audio/wav"}`，其中 `data` 是带 RIFF/WAVE 头的 PCM16 WAV 字节（不是裸 PCM）。该格式直接进入语音缓存，无需 ffmpeg；建议单声道、24 kHz。已有返回 MP3、Ogg 等压缩音频的插件仍受支持，但需要安装 ffmpeg 才能转换。无需新增输出格式协商字段。
- **边界守门**：`tests/tts-boundary.test.mjs`（只减不增）检查本体与舞台不以相对路径 import 插件、插件的 HTTP 根不出现在本体与舞台，以及 `ctx.get('tts*')` 调用点与本体 `provide('tts*')` 的上限。
