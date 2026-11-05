---
name: figure-voice
description: "配置配音：TTS 语音服务、声音预设、全局读音词典，素材人物的音色（声音克隆、Fish 声音库、在线 TTS、浏览器朗读）、调音方案、配音语言、参考音频和声音模板。配音开关、通用声音和旁白在 stage-setup；人物图片和服装用 figure-assets。"
---

# 配音

配音分三层：**语音服务**（本机，含地址和密钥）→ **音色**（存在素材包里，可被多个人物共用）→ **调音方案**（语速、音高等）。人物只记录用哪个音色、哪个方案、什么语言。工具：`tavern_voice_read`、`tavern_voice_patch`，参考音频上传用 `tavern_media_upload`，查找人物用 `tavern_assets_read`。数据细节读 [声音数据](references/voice-data.md)。

## 调用格式

每个工具只有一个 `request` 参数。几个动作共用的字段放在外层，`action` 和这个动作其余的字段放进 `operation`，可以嵌套多层，层级以工具 schema 为准；下文的 `动作 {字段}` 只列出字段。例如改人物的声音绑定：

`tavern_voice_patch({request:{expectedRevision:'包的 revision', operation:{packId:'…', figureId:'…', operation:{action:'binding', binding:{…}}}}})`

只读的列表把 `action` 直接写在 `request` 里，例如 `tavern_voice_read({request:{action:'services'}})`、`tavern_voice_read({request:{action:'readings'}})`。

## 读音词典

读音词典（"把林澄读成 chéng"）用 `readings` 系列，是全局设置；`presets` 是声音的调音预设，与读音无关。完整例子：

1. `tavern_voice_read({request:{action:'readings'}})`：看现有预设和当前使用的一套。
2. 先说明"这是全局设置，会影响所有卡片"，再写入：
   - 新建预设：`tavern_voice_patch({request:{action:'reading-create', name:'…'}})`；新预设要用 `reading-active {id}` 切换后才生效。
   - 加一行：`tavern_voice_patch({request:{id:'预设 ID', expectedRevision:3, operation:{action:'reading-edit', op:'add', entry:{forms:['林澄'], reading:'lín chéng'}}}})`，`expectedRevision` 是 `readings {id}` 读到的整数。中文读音写带调拼音，日语写假名。
3. 再读 `readings`，看到新预设或新行才报告"已保存"。

## 语音服务（全局）

- `services` 列出已配置的服务和凭据状态，`provider-kinds` 列出支持的服务类型与能力。这些是配置信息：报告写成"已配置，凭据已填/未填，连接未测试"；参考音频的上限为 `null` 表示未声明上限，不等于没有限制，实际文件是否可用要上传后才知道。服务和密钥在「配音后端」（侧栏的「配音后端」页，或 设置 ›「配音后端」）里配。可用类型包括 Azure、通义千问（国内/国际区域）、火山引擎、MiniMax、OpenAI 兼容接口和 Fish Audio（云端或自托管）；以 `provider-kinds` 的返回为准。
- 保存或删除服务、声音预设、读音词典都是全局写入：先告诉用户"这是全局设置，会影响所有卡片"和具体变化，宿主弹出确认后才写入。
- 工具不接收密钥。新服务返回 `credentials-required` 时，请用户到「配音后端」里给该服务填写密钥，完成后再继续；不要让用户把密钥贴到对话里。
- `test-service` 可能发出真实请求并计费，只在用户要求测试时调用，宿主会弹出付费确认。失败时按返回的状态（离线、缺凭据、不支持）给出修法，不换服务重试。
- 删除仍有人物在用的服务会返回 `SERVICE_IN_USE`（还有人物的配音来源由它朗读）。告诉用户删除后这些人物会不出声；用户仍要删除时，才带 `force:true` 和简短理由再删一次。
- **人物的声音自带服务**：音色来源可带 `serviceId`（见 `references/voice-data.md`），没有全局的「默认服务」。同一种服务只装了一个时不用写；装了几个时（例如云端 Fish Audio 和本机的 Fish 服务），在来源里写 `serviceId`，取自 `services` 的 `id`。来源写的服务在本机没有配置时，人物不出声，`issues` 报 `SERVICE_REQUIRED`，界面显示「还没有在配音后端设置 …」；不会悄悄换成别的服务或浏览器朗读。
- 同一种服务能用的来源不完全一样：Fish Audio 云端支持声音克隆（`reference-list`）和声音库（`voice-id`）；自托管的 Fish 服务一定支持声音克隆，只有服务器声明了声音库时才支持 `voice-id`。不确定时先写入，再看 `figure` 的 `issues`。

## 人物的声音

1. 用 `tavern_assets_read` 的 `bindings` 找到当前卡能用的包（省略 `path` 就是当前卡；要写 `path` 时用工作台里的卡文件路径，如 `cards/xxx.json`，不是卡名），对这些包读 `item {kind:'figures', packId}`，按名字找到人物的 `packId` 和 `id`（`resolve` 不接受名字）；再 `tavern_voice_read figure {packId, figureId}` 读取当前绑定、包里的音色、实际生效结果和问题列表。
2. 用 `assign-figure` 给人物一份新音色，原有音色保留在包里。`choice` 有两种写法：
   - `{voiceSpec:{…}}`：直接写一份音色（形状见 [声音数据](references/voice-data.md)），适用于所有来源。例如通义千问的在线声音：`tavern_voice_patch({request:{expectedRevision:'包的 revision', operation:{packId:'…', figureId:'…', operation:{action:'assign-figure', choice:{voiceSpec:{name:'林澄', language:'zh', defaultSource:'online', sources:{online:{kind:'preset', provider:'qwen', voiceName:'Cherry'}}}}}}}})`。
   - `{voiceId:'…'}`：用 `choices` 的 `voices` 里列出的现成声音（用户保存的声音预设和服务自带的声音），宿主把它转成包里的音色。`choices` 的 `recommended` 是 Fish Audio 声音库的推荐声音，用它时写 `voice-id` 来源的 `voiceSpec`。声音模板用 `templates` 和 `assign-template`。
3. 调语速语调、改配音语言、设差分对应的调音方案，用 `binding` 或 `pack-voice`。差分到方案或情绪参考的对应只按用户指定写，不自己推测哪种情绪该用哪段录音。

音色在包里，可能被多个人物共用。修改共用音色会影响所有用它的人物，宿主会提示并要求确认；用户只想改这一个人物时，改为给它一份独立音色。

### 浏览器朗读

浏览器朗读不需要语音服务，免费。来源是 `{kind:'preset', provider:'browser', voiceName}`，`voiceName` 是用户浏览器里的系统声音名，不写就是系统默认声音；系统声音列表只在浏览器里，工具读不到，源码、注册表和系统设置里也找不到，不要去翻。按下面做，这就是全部：

- 包里已有浏览器朗读的音色（`figure` 读到的音色里有 `provider:'browser'` 且带 `voiceName` 的来源）：用 `binding` 让人物用它。
- 没有：用 `assign-figure` 写一份不带 `voiceName` 的浏览器音色，例如 `choice:{voiceSpec:{name:'林澄', language:'zh', defaultSource:'browser', sources:{browser:{kind:'preset', provider:'browser'}}}}`。它用系统默认声音朗读，马上就能出声，回读时 `issues` 为空，界面显示「浏览器朗读 · 系统默认」。用户想换成别的系统声音时，请他在素材库打开该人物的「声音」，在「浏览器朗读」里选一个（▶ 可试听）。
- 快慢：调音方案对浏览器朗读不起作用，工具也改不了。唯一的入口是舞台齿轮「设置」›「声音」›「配音」组的「配音倍速」（0.8–2.0 倍，默认 1.0 倍，所有配音一起变，存在这台设备上）。用户要"稍快一点"时，请他调到 1.1–1.2 倍。

没配声音的人物（包括临时 NPC）本来就用「通用声音」朗读，默认是浏览器的系统默认声音，在 舞台设置 › 基础设置「配音 ›」里设置（stage-setup）。

## 参考音频

克隆类声音需要参考音频：先用 `tavern_media_upload` 的 `blob`（用途 `voice-reference`）上传工作台里的 WAV/MP3，再把返回的 hash 和对应原文写进音色。参考音频是有序列表，数量、单段和总量上限由服务能力决定，以读取结果和报错为准；服务不支持多段时会报错，不要悄悄只保留第一段。参考原文必须和录音一致。

## 相关但不在这里

- 普通聊天的整篇「朗读」在 酒馆设置 › 酒馆插件 设置，有独立的朗读声音和自动朗读开关，不读取舞台声音。
- 配音四态开关（引擎开关 `voice`）、通用声音和旁白都在 舞台设置 › 基础设置「配音 ›」，属于 stage-setup。
- 进行中的游戏会在之后的台词使用新声音；已生成的音频不重新合成。

## 用工具完成，按事实报告

- 配音设置只通过本 Skill 的工具读写。报错里的 `example` 是最小合法骨架：占位符换成读到的值，空数组只表示类型、不代表清空。工具做不到的事，说明缺什么或界面位置。
- 报告只描述工具结果里出现的事，分清：计划（还没调用写工具）、已问你（等你回复）、等待宿主批准、未获批准没有改动（照审批错误的 `message` 转述，会话策略自动拒绝不说成用户拒绝）、已保存（回执成功且回读到目标值）。

## 完成标准

写入回执成功，`tavern_voice_read figure` 显示新的绑定，`issues` 里没有新问题（例如服务缺失、语言不支持）；只剩要用户在界面里补的项（例如克隆还没有参考音频）时，如实列出并说明在哪里补。保存不等于能发声：不要自动试听。请用户在素材库打开该人物的「声音」，用 ▶ 或「付费试听」确认音色，或在游玩页听下一句台词。服务只说"已保存，凭据已配置/未配置"，测试过才说"连接正常"。
