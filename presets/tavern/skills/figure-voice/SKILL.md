---
name: figure-voice
description: "配置配音：TTS 语音服务及各类声音默认服务、声音预设、全局读音词典，素材人物的音色、调音方案、配音语言、参考音频和声音模板。配音总开关在 stage-setup；人物图片和服装用 figure-assets。"
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

- `services` 列出已配置的服务和凭据状态，`provider-kinds` 列出支持的服务类型与能力。这些是配置信息：报告写成"已配置，凭据已填/未填，连接未测试"；参考音频的上限为 `null` 表示未声明上限，不等于没有限制，实际文件是否可用要上传后才知道。密钥入口在「配音」›「语音服务」。可用类型包括 Azure、通义千问（国内/国际区域）、火山引擎、MiniMax、OpenAI 兼容接口和 Fish Audio（云端或自托管）；以 `provider-kinds` 的返回为准。
- 保存或删除服务、声音预设、读音词典都是全局写入：先告诉用户"这是全局设置，会影响所有卡片"和具体变化，宿主弹出确认后才写入。
- 工具不接收密钥。新服务返回 `credentials-required` 时，请用户到「配音」›「语音服务」里给该服务填写密钥，完成后再继续；不要让用户把密钥贴到对话里。
- `test-service` 可能发出真实请求并计费，只在用户要求测试时调用，宿主会弹出付费确认。失败时按返回的状态（离线、缺凭据、不支持）给出修法，不换服务重试。
- 删除仍在使用的服务会返回 `SERVICE_IN_USE` 和引用它的人物。先把这些引用给用户看；用户仍要删除时，才带 `force:true` 和简短理由再删一次。
- **人物的声音自带服务**：音色来源可带 `serviceId`（见 `references/voice-data.md`），没有全局的「默认服务」。同一种服务只装了一个时不用写；装了几个时，在人物「声音」里选对应服务的那一行，或用 `pack-voice` 写来源的 `serviceId`。

## 人物的声音

1. 用 `tavern_assets_read` 的 `bindings` 找到当前卡能用的包，对这些包读 `item {kind:'figures', packId}`，按名字找到人物的 `packId` 和 `id`（`resolve` 不接受名字）；再 `tavern_voice_read figure {packId, figureId}` 读取当前绑定、包里的音色、实际生效结果和问题列表。
2. `choices` 列出可选的声音（个人模板、服务声音）。用 `assign-figure` 选定；选现成声音会在包里生成一份新音色，原有音色保留。
3. 调语速语调、改配音语言、设差分对应的调音方案，用 `binding` 或 `pack-voice`。差分到方案或情绪参考的对应只按用户指定写，不自己推测哪种情绪该用哪段录音。

音色在包里，可能被多个人物共用。修改共用音色会影响所有用它的人物，宿主会提示并要求确认；用户只想改这一个人物时，改为给它一份独立音色。

## 参考音频

克隆类声音需要参考音频：先用 `tavern_media_upload` 的 `blob`（用途 `voice-reference`）上传工作台里的 WAV/MP3，再把返回的 hash 和对应原文写进音色。参考音频是有序列表，数量、单段和总量上限由服务能力决定，以读取结果和报错为准；服务不支持多段时会报错，不要悄悄只保留第一段。参考原文必须和录音一致。

## 相关但不在这里

- 配音总开关（`stageToggles.voice`）是全局舞台开关，属于 stage-setup。
- 进行中的游戏会在之后的台词使用新声音；已生成的音频不重新合成。

## 用工具完成，按事实报告

- 配音设置只通过本 Skill 的工具读写。报错里的 `example` 是最小合法骨架：占位符换成读到的值，空数组只表示类型、不代表清空。工具做不到的事，说明缺什么或界面位置。
- 报告只描述工具结果里出现的事，分清：计划（还没调用写工具）、已问你（等你回复）、等待宿主批准、未获批准没有改动（照审批错误的 `message` 转述，会话策略自动拒绝不说成用户拒绝）、已保存（回执成功且回读到目标值）。

## 完成标准

写入回执成功，`tavern_voice_read figure` 显示新的绑定，`issues` 里没有新问题（例如服务缺失、语言不支持）。保存不等于能发声：不要自动试听。请用户在素材库打开该人物的「声音」，用 ▶ 或「付费试听」确认音色，或在游玩页听下一句台词。服务只说"已保存，凭据已配置/未配置"，测试过才说"连接正常"。
