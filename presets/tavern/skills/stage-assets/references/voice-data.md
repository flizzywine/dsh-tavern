# 声音数据

要知道音色、来源、人物绑定、调音方案的数据形状和边界时读这篇。

结构以 `tavern_voice_read figure` 和 `provider-kinds` 的返回为准；下面说明含义与边界。

## 音色（包里的 `voiceLibrary`）

每个音色有名称、语言、默认来源 `defaultSource`、若干来源 `sources`，可选调音方案 `variants` 和备用来源。来源是以下几种之一：

| 来源形状 | 用途 |
| --- | --- |
| `voice-id` | Fish Audio 声音库的声音编号，`{kind:'voice-id', provider:'fish-audio', voiceId}` |
| `preset` | 在线 TTS 的内置声音名，`{kind:'preset', provider:'qwen', voiceName:'Cherry'}`；`provider` 是服务类型（`qwen`、`azure`、`volcengine`、`minimax`、`openai-compatible`），可带 `model` |
| `preset` + `provider:'browser'` | 浏览器朗读，`voiceName` 是用户浏览器里的系统声音名。不写 `voiceName` 即系统默认声音（`issues` 为空）；工具读不到系统声音列表，要换别的系统声音由用户在界面里选（见[给人物配声音](figure-voice.md)「浏览器朗读」） |
| `reference-list` | 声音克隆：有序参考音频列表 `{kind:'reference-list', provider:'fish-audio', references:[{media, text, language}]}`，`media` 是上传返回的 hash |

每个来源都可以先选后配：没有参考音频的克隆、还没选声音的声音库或在线声音（浏览器朗读除外，不写声音即系统默认）都能保存，`figure` 的 `issues` 会写明还缺什么（`MISSING_REFERENCE`、`VOICE_NOT_FOUND`），人物在补齐之前不出声。

来源可选带 `serviceId`，指定由哪个已配置的服务朗读（同一种服务装了几个时才需要，例如云端 Fish Audio 和本地 Fish 服务）。没写或写的服务不在本机时，用这台电脑上唯一的同类服务；本机没有这类服务，或同类服务有多个又没写时，这个声音报 `SERVICE_REQUIRED` 并保持静音，请用户在「配音后端」配好服务，或在人物「声音」里选一行。

音色里不能写服务地址、密钥或本机路径；这些属于本机的语音服务。复制人物时，关联的音色及其参考音频会一起复制。

## 人物绑定

```json
{"voice": "actor", "source": "fish", "variant": "quick", "language": "ja", "emotionVariants": {"joy": "quick"}}
```

- `voice`：同包音色 ID，不能跨包引用。
- `source`：省略用音色的默认来源；`null` 表示静音但保留资料。
- `variant`：调音方案，省略用原声。
- `language`：配音语言，省略用音色语言。不是中文时，对白会另带一份这一语言的配音台词（正文固定用中文）。
- `emotionVariants`：差分 ID → 方案 ID，未列出的差分用默认方案。

## 调音方案

形状和写法见[声音变体](voice-variants.md)。

## 参考音频

顺序、段数和上限见[声音克隆](voice-clone.md)。

## 声音模板

声音模板（`templates`）是用户保存的可复用声音，`assign-template` 会把一份副本放进目标人物的包，之后与模板不再联动。保存和删除模板是全局写入。读音词典见[读音词典](voice-readings.md)。
