# 数据删除 `dsh.redaction`

导演把正文里的机密词盖住（黑条或乱码），玩家点三下揭开。存档、编辑和下一轮发给模型的上下文里都是原文，只在显示时盖住；没标到的段落先照常显示，导演标到了再盖上。

## 用了哪些接口

- **导演指令** `redact quote="…" [kind=bar|glitch]`（op `mod.dsh.redaction.redact`），放在那一段的拍子里。清单里声明 `textMark: {quote: "quote"}`：这是一个**文字标记**指令，`quote` 是本段原文的逐字引用。
  - 这是本项新加的通用接口（`lib/domain/mods/declarations.js` 校验声明；`stage-asset-pack-validation.js` 在导演的提交工具里核对引用确实出现在那一段，不符合作为工具结果退回去改；`dsh-presentation-protocol/src/text-marks.cjs` 是各视图找标记、切分、估算整句朗读里标记落在哪段时间的唯一实现）。舞台和本体只认声明，不点名本模组。
  - 缺的接口和为什么现有的不够：`sourceMarker` 把整段交给模组的来源视图（手机），`backlog.line` 只给整行贴标签；两者都不能盖住一段里的几个字，也都不核对引用。
- **导演事务钩子**（`stage.js`）：`admitParams` 把本卡默认样式写进没写 `kind` 的标记，记录里就是显示的样式；`hostExtension` 是揭示记录（下文）。
- **提示词**：`commandPrompts` 两段，`redact-rule`（规则）和 `redact-guidance`（遮挡指引；`runtime.js` 的 `prepare` 用本卡设置替换）。只进导演的提示词，正文模型的提示词不变。
- **舞台画面**（`client/stage.cjs`）：舞台功能的新字段 `textMark`（`features.cjs`），给出指令名、引用参数和画遮挡的部件 `RedactionMark`（`client/marks.cjs`）。舞台在文本框（打字机、逐行旁白）和履历里按 `text-marks.cjs` 找到标记，一处遮挡是打字的一步，由本部件画。
- **本体客户端**：`src/client/mod-clients.js` 的 `TavernRedacted` 和 `lib/client-assets/mod-config.css` 的 `.dsh-redact`：只给模型看的值（如检定规则里的隐藏数值）的黑条占位，点不开。检定模组接入时用它。

## 持久状态

- 标记本身就是导演写在这一轮消息上的演出记录（`stageDirectionAssetPacks` 的 `mod.command`），跟着分支走，重新生成的那一轮重新标。
- 揭示记录在宿主侧：`profile-data/tavern/data/redaction/<session id>.json`，`{version:1, turns:{<原生轮次>:{source, marks:{"<段>:<第几处>": 点击次数}}}}`。`source` 是那一轮导演记录的 sourceKey，重新生成后不同，那一轮的点击作废、重新盖上。每次点击都记下（最多 3），黑条的擦痕按点击次数和种子重画。删除聊天时这个小文件不删（几百字节）。
- RPC：`getStageRedactions {sessionId}`、`tapStageRedaction {sessionId, turn, source, para, index}`。

## 提示词与工具 schema 字节（UTF-8 实测，2026-11-12）

| 分节 | 字节 |
| --- | --- |
| `redact-rule`（`prompts/redaction.txt`） | 579 |
| `redact-guidance` 通用一句（`prompts/guidance.txt`） | 86 |
| `redact-guidance` 一条 40 字左右的卡片遮挡指引 | 约 117 |
| 指令语法行（`director.commands.presentation`） | 62 |
| `stage_update` 工具 schema 里这条指令 | 286 |

本卡开着本模组时，导演提示词多约 760 字节；工具 schema 按已安装模组冻结，安装后每张卡的导演工具都多 286 字节，开关不改 schema。正文模型的提示词和工具不变。

## 配音与没做的

- **聊天楼层**照常显示原文。要盖住得改本体的 `src/client/ui/message-frame.js`（正文交给 Markdown 之前过一次文字标记），以后另提。
- **配音**：整句照常合成，播到还盖着的词时人声压到约 5%，同时放 `client/noise.cjs` 现场生成的杂音（每次播放换种子，没有素材文件）；揭开以后重播念原文。浏览器朗读改念去掉被盖词的文字。舞台那边的接口：功能字段 `textMark` 的 `open(place, index)` 和 `noise(sampleRate, seed)`。
- 手机里显示的消息、逐字幕卡以外的视图（片段导出）不盖。

## 测试

- `tests/redaction-marks.test.mjs`：标记查找与切分、清单声明、默认样式与遮挡指引、导演提交工具的逐字核对（离线导演夹具）、揭示记录、打字机里的遮挡、乱码与橡皮擦。
- `tests/redaction-voice.test.mjs`：遮挡在句中的时间、混音器在遮挡时段压低人声并放杂音（暂停、结束、首字遮挡）、杂音按种子生成。
