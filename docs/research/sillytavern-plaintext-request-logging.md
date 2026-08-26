# SillyTavern 请求与响应明文提取研究

> 日期：2026-08-26  
> 状态：仅研究，未修改 SillyTavern 或 dsh-tavern 代码  
> 研究基线：SillyTavern `1.18.0`，官方 `release` 分支 commit [`8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`](https://github.com/SillyTavern/SillyTavern/commit/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8)

## 结论

不必再开发一套“新酒馆”。先直接采集真实 SillyTavern 的请求链，和 dsh-tavern 做逐字段比对。

当前 SillyTavern 已经能提供大部分证据，但证据分散在三个地方：

1. Prompt Itemization / Prompt Inspector：查看前端组装后的提示词；
2. 浏览器 DevTools Network：查看发给 SillyTavern 后端的请求，以及后端原样转发回来的流式响应；
3. SillyTavern 服务端终端：查看 provider 转换完成后的最终请求体。

这套组合足够先做一次人工比对。更重要的是，本案真实配置为 `custom + strict_tools + stream=false`，SillyTavern 终端本来就会打印最终请求和响应，暂时可以先不插桩。但 `console.debug` 对超长字符串或深层对象仍可能截断；遇到截断时，应再增加 `JSON.stringify`/JSONL 最小探针。只有后续要长期、批量、可复现地比较多轮请求时，才有必要增加统一请求编号。

## 本案真实请求通道

本地真实 SillyTavern 设置已经确认：

```text
main_api = openai
oai_settings.chat_completion_source = custom
custom_model = google/gemini-3.7-flash
custom_prompt_post_processing = strict_tools
stream_openai = false
```

这意味着本案不会进入 SillyTavern 的原生 Google AI Studio / `sendMakerSuiteRequest()` 通道。它会把前端 messages 先执行 `strict_tools` 后处理，再通过通用 OpenAI-compatible Custom 分支发给 Infron。

当前首要差异候选因此是 `strict_tools`，不是 Gemini 原生通道的 `safetySettings`。

### `strict_tools` 实际改变了什么

路由收到 `/api/backends/chat-completions/generate` 后，会在选择 provider 分支之前执行 `postProcessPrompt()`。源码见 [`src/endpoints/backends/chat-completions.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/backends/chat-completions.js#L2157-L2168)。

`strict_tools` 对应 `mergeMessages(messages, names, { strict: true, placeholders: true, tools: true })`，见 [`src/prompt-converters.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/prompt-converters.js#L85-L104)。它会：

1. 把带 `name` 的消息名称写进正文，然后删除 `name` 字段；
2. 合并连续的同角色消息；
3. 只允许开头保留一条 `system`，把中途出现的 `system` 全部改为 `user`；
4. 必要时插入一个 `user` placeholder，保证严格交替所需的起始结构；
5. 再执行一次合并，使改成 `user` 的系统条目和相邻 `user` 消息继续合并；
6. `tools: true`，所以工具消息、`tool_calls` 和 `tool_call_id` 不会被删除。

完整实现见 [`mergeMessages()`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/prompt-converters.js#L812-L949)。

这套后处理发生在浏览器 Request Payload 之后、provider 最终请求之前。它会显著改变预设原始 `system/user/assistant` 边界；如果 dsh-tavern 兼容模式没有完全执行同样的合并、角色改写和 placeholder 规则，即使提示词文本相同，实际请求仍然不同。

### `safetySettings` 只适用于其他通道

官方 SillyTavern 的原生 Google AI Studio 通道会固定加入以下 `safetySettings`：

```json
[
  { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "OFF" },
  { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "OFF" },
  { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "OFF" },
  { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "OFF" },
  { "category": "HARM_CATEGORY_CIVIC_INTEGRITY", "threshold": "OFF" }
]
```

这些常量定义在 [`src/constants.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/constants.js#L141-L162)，并由原生 Gemini / OpenRouter Gemini 分支加入请求。

但本案使用的是 `chat_completion_source=custom`。Custom 分支不会因为模型名包含 Gemini 就自动加入这些参数；只有用户自己通过 `custom_include_body` 配置时才可能带入。因此，`safetySettings` 是原生 Gemini/OpenRouter 通道的比对候选，**不是当前 Infron Custom 案例的直接原因**。

## 一轮请求在 SillyTavern 中经过的层次

### 1. 前端提示词组装层

SillyTavern 先把人物卡、宏、世界书、预设条目和对话历史组装成带角色的消息数组。`ChatCompletion.getChat()` 输出扁平化后的 `role/content/name/tool_calls` 等字段；之后还会触发 `CHAT_COMPLETION_PROMPT_READY` 事件。源码见 [`public/scripts/openai.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/openai.js#L1598-L1613)。

`createGenerationParameters()` 再把消息、模型、温度、惩罚、`top_p`、`max_tokens`、流式开关等整理为发给 SillyTavern 后端的 `generate_data`。源码见 [`public/scripts/openai.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/openai.js#L2645-L2780)。

最后，`sendOpenAIRequest()` 把 `generate_data` POST 到 `/api/backends/chat-completions/generate`。源码见 [`public/scripts/openai.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/openai.js#L3044-L3060)。

### 2. SillyTavern 后端 provider 转换层

浏览器发出的 `generate_data` 还不是本案最终请求。后端先执行上述 `strict_tools`，再进入 Custom 分支：

- 合并用户配置的 `custom_include_body` 和 `custom_include_headers`；
- 处理媒体内容和 JSON schema；
- 组装最终 OpenAI-compatible `requestBody`；
- 应用 `custom_exclude_body`；
- POST 到 `${custom_url}/chat/completions`。

Custom 分支入口见 [`src/endpoints/backends/chat-completions.js#L2304-L2331`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/backends/chat-completions.js#L2304-L2331)，最终 `requestBody`、Debug 日志和 `fetch()` 见 [`L2553-L2601`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/backends/chat-completions.js#L2553-L2601)。

原生 Google AI Studio 是另一条路径，才会把 OpenAI 风格消息转换为 `systemInstruction/contents` 并加入 Gemini `safetySettings`。研究时不能因为模型名是 Gemini，就把两条 provider 通道混为一谈。

### 3. provider 原始响应层

本案 `stream_openai=false`，所以 Custom 分支会直接读取 provider JSON，并以 `Chat Completion response:` 打印到服务端终端，然后原样返回浏览器。请求则在真正 fetch 前以 `Chat Completion request:` 打印。因此，本案现有终端日志已经位于正确的实际 provider 请求/响应边界；若内容被 Node inspect 截断，再补结构化探针。

只有流式模式才会交给通用的 `forwardFetchResponse()`，把上游 body 直接 pipe 给浏览器而不逐 chunk 落盘。源码见：

- [Custom 流式与非流式分支](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/backends/chat-completions.js#L2588-L2615)
- [`forwardFetchResponse()`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/util.js#L709-L755)

如果以后重新开启流式，浏览器 Network 中 `/api/backends/chat-completions/generate` 的 Response 可以看到上游原始 SSE；但普通聊天 UI 只展示解析后的正文和部分错误，不是完整原始响应。

## 现有工具分别能看到什么

| 手段 | 能看到 | 看不到 / 局限 |
| --- | --- | --- |
| 回复消息的 Prompt Itemization | 本轮提示词组成、Raw Prompt | Chat Completion 展示/复制时会把消息数组 flatten 为 content 文本，角色边界也会丢失；更不含最终 provider body、URL、headers、完整流式响应 |
| Prompt Inspector 扩展 | 发送到后端前的 messages JSON，并允许检查/修改 | 官方扩展明确说明它发生在 backend-specific post-processing 之前，因此不含 `strict_tools` 及其他 provider 二次加工 |
| “Log prompts to console” | 浏览器控制台中的组装过程和提示词 | 仍是前端层，不是最终 provider HTTP body |
| DevTools Network 的 Request Payload | 完整前端 `generate_data`：messages、roles、模型和前端采样设置 | `strict_tools` 执行后的最终 messages，以及 include/exclude body 的结果 |
| DevTools Network 的 Response | 本案非流式 provider JSON；流式时为后端原样转发的 SSE 或错误正文 | 不会自动形成稳定、逐轮、可关联的测试日志 |
| SillyTavern 服务端终端 | 本案最终 `Chat Completion request` 和非流式 `Chat Completion response` | 长字符串或深层对象可能受 Node inspect 展示限制；若改成流式，成功响应只打印“finished” |
| `data/access.log` | 访问时间、客户端等访问记录 | 不含模型请求或响应正文 |

官方文档也只把 Prompt Itemization、Prompt Inspector、终端日志和浏览器控制台列为“查看 Prompt”的方式，并没有宣称 UI 能显示最终 provider HTTP 请求：[Prompts 文档](https://docs.sillytavern.app/usage/prompts/#viewing-the-prompt)。“Log prompts to console”开关见[用户设置文档](https://docs.sillytavern.app/usage/user-settings/#prompt-inspection-and-debugging)。Prompt Itemization flatten 内容的实现见 [`public/scripts/itemized-prompts.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/itemized-prompts.js#L248-L340)。官方 Prompt Inspector 也明确说明，Chat Completion 的 JSON 位于 backend-specific post-processing 之前，见[扩展 README](https://github.com/SillyTavern/Extension-PromptInspector/blob/97a9fd90afbc156db27478e9097b143dc27b9c7a/README.md#remarks)。

官方仓库目前仍有一个开放需求，专门指出 `rawPrompt` 是前端中间结果，无法显示后端 provider-specific shaping 后的最终请求；建议在 `fetch()` 前捕获最终 envelope，并用 UUID 和前端消息关联：[Issue #5657](https://github.com/SillyTavern/SillyTavern/issues/5657)。这与本次源码结论一致。

## 无代码改造的首轮采集办法

先用现有能力做一次真实对照：

1. 确认 `config.yaml` 的 `logging.minLogLevel` 为 `0`。官方默认值就是 DEBUG 0，见 [`default/config.yaml`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/default/config.yaml#L184-L190)。
2. 在 SillyTavern 用户设置中开启“Log prompts to console”。
3. 打开浏览器 DevTools → Network，开启 Preserve log，筛选 `chat-completions/generate`。
4. 保持本案真实的 `stream=false`，不要为了测试方便改变任何连接或预设设置。
5. 发送一轮测试后保存：
   - Network Request Payload：`strict_tools` 前的 messages、roles、采样配置；
   - SillyTavern 终端的 `Chat Completion request:`：`strict_tools` 和 Custom include/exclude 处理后的最终 provider body；
   - SillyTavern 终端的 `Chat Completion response:`：provider 响应；若显示被截断则以 Network Response 交叉验证；
   - Network Response：浏览器实际收到的同一响应，用来交叉验证。
6. 对日志中的 API key、Authorization、反向代理密码进行脱敏，原始文件不要提交到仓库。

这一步的重点不是阅读一大段提示词，而是先比较以下结构化字段：

```text
model
custom_url / chat/completions
messages[].role
messages[].content
temperature / top_p / top_k
max_tokens / stop / seed
stream（本案应为 false）
tools / tool_choice
custom_include_body / custom_exclude_body 的最终结果
```

其中最先应检查 `strict_tools` 前后 messages 的角色、条数、顺序和合并结果。

## 如果现有日志不够：最小插桩位置

只需做“日志探针”，不需要重写 SillyTavern 请求实现。

### 插桩 A：最终 provider 请求

本案位置：通用 Custom 分支构造 `requestBody` 之后、`fetch()` 之前，即 [`src/endpoints/backends/chat-completions.js#L2553-L2590`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/backends/chat-completions.js#L2553-L2590)。现有 `Chat Completion request:` 已经位于正确位置；若要自动化，只需把它改为结构化 JSONL 旁路记录。

记录为 JSONL：

```text
traceId, timestamp, provider, model, stream,
redactedUrl, redactedHeaders, exactRequestBody
```

这里的 `exactRequestBody` 才是可与 dsh-tavern 请求逐字段比较的权威数据。Authorization、Custom headers 和反向代理秘密必须在落盘前删除或遮盖。

### 插桩 B：原始 provider 响应

本案非流式，最小位置就是 Custom 分支 [`fetchResponse.json()` 与 `Chat Completion response:`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/backends/chat-completions.js#L2597-L2601)，把现有 Debug 输出旁路写成 JSONL 即可。

若以后测试流式，再在 [`src/util.js` 的 `forwardFetchResponse()`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/util.js#L709-L755) 增加 tee/Transform。

在不改变 pipe 行为的前提下，用 tee/Transform 同步复制原始字节，并按同一 `traceId` 记录：

```text
status, statusText, exactResponseJson,
finish_reason, provider error body, completed/aborted
```

流式模式才另外记录 raw SSE chunks。

### 关联方式

最稳妥的方式与官方 Issue #5657 的建议相同：前端发起请求时生成 UUID，通过 header 传给后端；请求和响应日志都使用同一 UUID。若只在后端生成，也必须把该 ID 返回给浏览器或和消息 ID 建立映射，否则重新生成、并发请求和后台请求会混在一起。

## 建议的差异比对顺序

1. 先比较最终 provider body，而不是先比较 UI 中的 Raw Prompt。
2. 比较 `strict_tools` 前后的消息，确认 dsh-tavern 是否执行了同样的 system→user、同角色合并和 placeholder 规则。
3. 再比较最终 `messages` 的角色、顺序、条数和逐条文本哈希。
4. 比较 Custom include/exclude body、stream、采样参数和 tools。
5. 最后比较非流式完整响应中的 `finish_reason`、错误对象和候选正文。
6. 只有请求体完全一致后，才把剩余差异归因于模型随机性或 provider 服务端状态。

## 当前判断

“真实酒馆不需要重试，而兼容模式会拒绝”目前不能解释为模型随机性。本案真实 SillyTavern 走的是 `custom + strict_tools + stream=false`；其中 `strict_tools` 会在服务端重写角色并合并消息，是前端 Raw Prompt 看不到、而兼容模式很可能没有完整复刻的请求语义。

下一步应直接从现有终端提取同一轮 `Chat Completion request:` 与 `Chat Completion response:`，和 dsh-tavern 最终请求逐字段比较。第一项就是 `strict_tools` 处理后的 messages。在这一步完成前，不应继续扩写兼容模式或另造请求实现。
