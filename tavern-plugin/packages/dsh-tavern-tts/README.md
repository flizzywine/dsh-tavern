# dsh-tavern-tts

独立 DSH 静态包，提供宿主服务 `tts`、浏览器服务 `ttsClient` 和设置页 Speech Services。
Tavern 通过公开 source/grant 接口消费声音；本包不导入、不迁移、不接管 Tavern，也不依赖私有本地插件。

- 原生设置 namespace：`tts`，由 `settings.installSection` 注册。
- 密钥：DSH `credentials`，保留 `DSH_TAVERN_TTS_<ID>_<FIELD>` 引用规则。
- 缓存：composition 指定 `dataDir`，本 profile bundle 显式选择 `dshHomePath('profile-data', 'tavern', 'tts')`。其他 profile 必须覆盖整个 config。
- 控制：登录保护的 Connection exact Fetch route `/api/dsh-tts/v1/control`；请求 `{method,args}`。不接受浏览器提供的文件路径或伪造 ConsumerGrant。
- 音频：`GET /api/dsh-tts/v1/audio?ticket=...`，同源、登录 Cookie、最长 60 秒 ticket、private/no-store。
- 合成仅宿主调用：先 `registerProvider` / `registerVoiceSource`，消费者授权后 `grantConsumer`，再 `synthesize`。关闭来源/插件立即撤销访问。

## 语音服务目录（对外契约）

「配音后端」里已保存的语音服务，由本包公布为唯一的一份目录，素材库、舞台和第三方插件都读它，不各自写死服务种类：

- 宿主：`ctx.get('tts').listVoiceServices()`；浏览器：`ttsClient.call('voiceServices')`。两者返回同一个 `VoiceServiceCatalog`（`types/index.d.ts`）。
- `services`：每个已保存的服务一项 `{id, kind, label, state, billing, sources, voiceList}`，其他插件注册的、报了配音来源的 provider 各一项，最后固定一项浏览器朗读（`kind:'browser'`，永远 `ready`、免费）。不含密钥、地址和 config 原文；`state` 取本次运行最近一次连接检查的结果（`ready` / `configured` / `needs-key` / `offline`）。
- `sources`：这个服务能接的配音来源（pack 声音来源的 `kind`）；`voiceList`：它的声音从哪里列（`fish-recommended` / `preset` / `provider` / `browser`）。两者都由该服务实例的 provider 自己回答（`Provider.capabilities.voiceSources` / `voiceList`），不按种类或名字写死：目录每次读取前调用 provider 的 `discover()`（不唤醒），能询问服务器的 provider 按服务配置缓存答案。Fish 协议：每个服务都有声音克隆；有没有声音库由该服务器自己回答——有 `GET /v1/info` 的服务器看其中的 `capabilities.voiceLibrary`（未声明即没有），没有 `/v1/info` 的服务器（官方云端）看它的声音库接口 `GET /model` 是否列出公开声音；问不到时保留上次的回答，不按地址或名字推断。其他在线协议语义固定，由服务种类声明只有预设声音。没报 `voiceSources` 的 provider 不进目录。
- `kinds`：所有支持的种类及其名称，用于显示指向未配置服务的来源（「通义千问 · 未设置」）。
- 目录变化（保存、删除、检查服务）时，`tts.subscribe` 发 `{type:'servicesChanged'}`。
- 运行时选服务仍用 `listServices()` / `chooseService()`；改名或删字段要走 `apiVersion`。

## Fish Audio

`fish-audio` 默认 Base URL `https://api.fish.audio`、模型 `s2.1-pro-free`。
API key 走既有 credentials；付费 `s2.1-pro` 只能明确选择，不自动回退。
预设使用 `params.referenceId`，人物自有 `reference` 音频则每次合成内联 `references`，
包含情绪槽与不同的 default，不创建持久模型。服务凭据缺失时支持 `FISH_AUDIO_API_KEY`。
免费请求单并发、429 尊重 Retry-After。

## 参考音频

figure/包拥有参考音频字节，随每次请求发给 Fish 协议渠道（云端或自托管，见上）。内置云预设的导出复制纯参数，不发付费合成请求。
本包不提供 GPT-SoVITS 渠道。

`src` 为维护源，`node build.mjs` 生成 `lib`；客户端生成 DSH ModuleLoader 包，不捆绑 React。`node build.mjs --check` 验证产物。
`importProviders` 是纯转换函数，不读写旧 `voice/providers.json`，不移动凭据。
