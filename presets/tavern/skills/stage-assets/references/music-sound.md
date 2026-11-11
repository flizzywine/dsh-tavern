# 音乐、音效、环境音

用户要加 BGM、音效或环境音，或调它们的音量、循环和触发词时读这篇。BGM / 音效 / 环境音的四态开关在 stage-setup，开关没生效时导演看不到这些条目。

## 界面

包里「添加文件」→「音乐」「音效」「环境音」，选 mp3/ogg/wav/m4a/flac（单个不超过 60 MB）。每个文件建一条，名字取自文件名；新条目是关灯的绿灯、没有触发词，填好 3–6 个触发词再开灯（[灯态与触发词](lamps-recall.md)）。

## 用工具加一首 BGM

音频分两步：先上传得到 hash，再写条目。只上传不写条目，素材不会出现。

1. `tavern_assets_read({request:{kind:'music', operation:{action:'schema'}}})` 看字段；`item {kind:'music', packId}` 记下包的 `revision`。
2. `tavern_media_upload({request:{action:'blob', packId:'…', expectedRevision:'第 1 步的 revision', file:'audio/rain-theme.ogg', purpose:'music'}})`，回执给出 `hash` 和新的 `revision`。
3. 用新 revision 写条目：

   ```js
   tavern_assets_patch({request:{expectedRevision:'第 2 步回执的 revision', operation:{packId:'…', operation:{action:'item', item:{
     kind:'music', id:'rain-theme', name:'雨之歌', enabled:true, media:'第 2 步的 hash',
     recall:{mode:'keyword', keywords:['下雨', '雨天', '伤心']}, directorNote:'安静的钢琴曲，适合下雨或低落的场面。'}}}}})
   ```

4. 带 `id` 读一次，确认条目在、灯态和触发词是目标值。

## 字段要点

- 音乐：`media`，可选 `usage`（用途，≤300 字）、`tags`、`volume`（0–1）、循环点 `loopStart`/`loopEnd`（两个都写，结束晚于开始）。
- 音效：一次性播放（`loop` 只能为 false），可选 `category`（音效分类）、`volume`、`gainDb`（−18 到 8）。触发词写物理事件（「敲门」「咚咚」），不加「-声」。
- 环境音：默认循环（界面「循环播放」），可选 `tags`、`category`。环境音独立于背景，换背景不会换掉环境音。
- 歌曲的触发词不加乐队/组合名。

## 完成标准

回读到条目和 `media`、灯态、触发词是目标值。是否播放要看下一轮游玩时导演是否选用；已经在播的音乐不会因为保存而换掉。
