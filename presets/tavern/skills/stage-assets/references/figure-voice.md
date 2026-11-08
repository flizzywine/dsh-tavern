# 给人物配声音

用户要给某个素材人物配声音、换声音、改成不配音时读这篇。克隆读[声音克隆](voice-clone.md)，调语速、情绪方案和语言读[声音变体](voice-variants.md)，数据形状见[声音数据](voice-data.md)。

配音分三层：语音服务（本机，含地址和密钥）→ 音色（存在素材包里，可被多个人物共用）→ 调音方案。人物只记录用哪个音色、哪个方案、什么语言。

## 界面

素材库打开人物 →「声音」行（显示声音名，⚠ 表示现在出不了声，「不配音」表示静音）→ 声音页：

- 「配音来源」：「Fish Audio · 声音克隆」「Fish Audio · 声音库」「在线 TTS」「浏览器朗读」「不配音」；右侧「配音后端 ›」跳去配服务。
- 「调音」和「配音语言」。
- 「试听」：用文本框里的台词合成一句，按钮在播放时变「停止」。会计费的服务先弹「付费试听」确认（「⋯」菜单里可关掉「付费试听前确认」）。

## 工具

### 1. 找到人物并读声音

用 `tavern_assets_read` 的 `bindings` 找到当前卡能用的包，对这些包读 `item {kind:'figures', packId}` 按名字找到人物的 `packId` 和 `id`（见[人物](figures.md)「先找到人物」），再 `tavern_voice_read({request:{action:'figure', packId, figureId}})` 读当前绑定、包里的音色、实际生效结果 `effective` 和问题列表 `issues`。

### 2. 写入

调用格式：几个动作共用的字段放在外层，`action` 和其余字段放进 `operation`，可以嵌套多层。例如：

`tavern_voice_patch({request:{expectedRevision:'包的 revision', operation:{packId:'…', figureId:'…', operation:{action:'assign-figure', choice:{…}}}}})`

- **新音色** `assign-figure`：给人物一份新音色，原有音色保留在包里。`choice` 两种写法：
  - `{voiceSpec:{…}}`：直接写一份音色，适用于所有来源。例如通义千问：`choice:{voiceSpec:{name:'林澄', language:'zh', defaultSource:'online', sources:{online:{kind:'preset', provider:'qwen', voiceName:'Cherry'}}}}`。
  - `{voiceId:'…'}`：用 `tavern_voice_read choices` 的 `voices` 里列出的现成声音（用户保存的声音预设和服务自带的声音），宿主把它转成包里的音色。`choices` 的 `recommended` 是 Fish Audio 声音库的推荐声音，用它时写 `voice-id` 来源的 `voiceSpec`。
- **声音模板**：`templates` 列出用户保存的模板，`assign-template` 把副本放进人物的包，之后与模板不再联动。保存、删除模板是全局写入。
- **改用包里已有的音色或改成不配音**：`binding`，`source:null` 表示静音但保留资料（见[声音数据](voice-data.md)）。

音色可能被多个人物共用：修改共用音色会影响所有用它的人物，宿主会提示确认；用户只想改这一个人物时，给它一份独立音色。

### 浏览器朗读

免费，不需要语音服务。来源是 `{kind:'preset', provider:'browser', voiceName}`，`voiceName` 是用户浏览器里的系统声音名，不写就是系统默认声音。系统声音列表只在浏览器里，工具读不到，源码、注册表和系统设置里也找不到，不要去翻。

- 包里已有浏览器朗读的音色：用 `binding` 让人物用它。
- 没有：`assign-figure` 写 `choice:{voiceSpec:{name:'林澄', language:'zh', defaultSource:'browser', sources:{browser:{kind:'preset', provider:'browser'}}}}`。回读时 `issues` 为空，界面显示「浏览器朗读 · 系统默认」。用户想换别的系统声音时，请他在人物「声音」页「浏览器朗读」里选（▶ 可试听）。
- 调音方案对浏览器朗读不起作用。要快一点只能调舞台齿轮「设置」›「声音」›「配音」组的「配音倍速」（0.8–2.0 倍，所有配音一起变，存在这台设备上），例如 1.1–1.2 倍。
- 手机模组里的电话通话不能用浏览器朗读，会转成文字。

## 完成标准

写入回执成功，`figure` 回读显示新的绑定，`issues` 里没有新问题（例如 `SERVICE_REQUIRED`、语言不支持）；只剩要用户在界面里补的项（例如克隆还没有参考音频）时，如实列出并说明在哪里补。保存不等于能发声：不自动试听，请用户在人物「声音」页「试听」，或在游玩页听下一句台词。进行中的游戏从之后的台词开始用新声音，已生成的音频不重新合成。
