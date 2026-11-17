# dsh-tavern-audiobook（有声书）

DSH Tavern 的酒馆内置插件：像听有声书一样连续朗读正文。

- 在「语音后端 › 朗读全文」里打开「有声书」（默认关）。打开后正文顶栏 BGM 旁边出现小喇叭，手机在 ⋯ 菜单里是「有声书」一行。
- 一屏是一页：正在读的句子高亮，读到屏幕下方时正文自动往下翻。没动过就接着上次读，滚动或跳过楼层后从这一屏第一句开始；读的时候滚走会出现「回到朗读处」。
- 有声书开着时，舞台和正文气泡不配音（`tavernUi.holdVoice`）。

只用公开接口（`tavernUi` apiVersion 9，见 `docs/plugin-api.md`）：`registerHeaderTool`、`components`、`readingUnits` / `prepareReading` / `playReading` / `pauseReading` / `resumeReading` / `stopReading` / `tuneReading` / `readingVoices`、`holdVoice`，以及语音后端的 `ttsPanelSections`。读什么、每句用什么声音都是舞台的读法，插件只决定从哪里读、怎么跟着翻页。

构建：`node -e "import('./build.mjs').then(m => m.buildAudiobookClient())"`，生成 `client.js`。