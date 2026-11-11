# 声音克隆

用户要用一段录音克隆某个人物的声音、补充或替换参考音频时读这篇。

## 前提

克隆要一个支持声音克隆的服务：Fish Audio 云端，或自托管的 Fish 服务（「自定义 Fish 协议」）。还没配就先按[配音后端](voice-backend.md)添加。`tavern_voice_read provider-kinds` 和 `services` 能看到每个服务是否支持克隆、参考音频的段数和大小上限（`null` 表示未声明，不等于没有限制）。

## 界面

素材库打开人物 →「声音」→「配音来源」选「Fish Audio · 声音克隆」，在下面添加参考音频并填对应原文，「试听」确认。

## 工具

1. 找到人物并读声音：见[给人物配声音](figure-voice.md)第 1 步。
2. 上传录音：工作台里的 WAV/MP3 用 `tavern_media_upload({request:{action:'blob', packId:'…', expectedRevision:'包的 revision', file:'voice/lin-01.wav', purpose:'voice-reference'}})`，回执给出 `hash` 和新 revision。几段就传几次，每次用上一次回执的 revision。
3. 写音色：`assign-figure` 写一份 `reference-list` 来源，或用 `pack-voice` 改人物现有的音色：

   ```js
   choice:{voiceSpec:{name:'林澄', language:'zh', defaultSource:'clone', sources:{clone:{kind:'reference-list', provider:'fish-audio',
     references:[{media:'第 2 步的 hash', text:'这段录音里说的原话', language:'zh'}]}}}}
   ```

4. 回读 `figure`：`issues` 没有 `MISSING_REFERENCE`、`REFERENCE_UNSUPPORTED` 才算写好。

## 要点

- 参考原文必须和录音一字不差，原文错了克隆出的声音会跑偏。
- 参考音频是有序列表：Fish Audio 每句都发送完整列表；只支持单段的服务固定用第一段。服务不支持多段时会报错，不要悄悄只保留第一段。
- 没有参考音频的克隆也能先保存，`issues` 会写 `MISSING_REFERENCE`，补齐前人物不出声。
- 差分和情绪参考的对应只按用户指定写，不自己推测哪种情绪该用哪段录音。

## 完成标准

`figure` 回读看到 `reference-list` 来源和参考音频、`issues` 为空；用户试听后认可音色。
