# dsh-tavern-tts

独立 DSH 静态包，提供宿主服务 `tts`、浏览器服务 `ttsClient` 和设置页 Speech Services。
Tavern 通过公开 source/grant 接口消费声音；本包不导入、不迁移、不接管 Tavern，也不依赖私有本地插件。

- 原生设置 namespace：`tts`，由 `settings.installSection` 注册。
- 密钥：DSH `credentials`，保留 `DSH_TAVERN_TTS_<ID>_<FIELD>` 引用规则。
- 缓存：composition 指定 `dataDir`，本 profile bundle 显式选择 `dshHomePath('profile-data', 'tavern', 'tts')`。其他 profile 必须覆盖整个 config。
- 控制：登录保护的 Connection exact Fetch route `/api/dsh-tts/v1/control`；请求 `{method,args}`。不接受浏览器提供的文件路径或伪造 ConsumerGrant。
- 音频：`GET /api/dsh-tts/v1/audio?ticket=...`，同源、登录 Cookie、最长 60 秒 ticket、private/no-store。
- 合成仅宿主调用：先 `registerProvider` / `registerVoiceSource`，消费者授权后 `grantConsumer`，再 `synthesize`。关闭来源/插件立即撤销访问。

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
