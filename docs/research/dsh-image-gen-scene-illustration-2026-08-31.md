# dsh-image-gen：Tavern 场景插画借鉴调研

日期：2026-08-31。范围：只读源码研究，不安装、不运行外部插件、不调用付费生图服务、不改产品代码。

外部项目固定在 [`0a1bb6d4ad0adb0e676a1193d098bd4c4589d167`](https://github.com/shanliuling/dsh-image-gen/tree/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167)，包版本 `0.2.4`。下文“已确认”仅表示这个提交的源码行为，不表示已在 Tavern 的 Desktop、CLI 或手机浏览器验证。提供商名称、模型默认值是该项目配置，不是本研究对其当前可用性的保证。

## 结论

值得借鉴的是 **提供商适配、凭据管理、图片附件落盘、结果展示与剧情分离**。不建议为“点一下给当前场景配图”整体引入它的 Agent 工具、工具结果投影、画廊、工作区文件流程。

它实现的是：`Agent 得到生图指令 → generate_image 工具 → 提供商 → DSH 附件 → 工具结果/对话图片节点`。用户希望的是：`点击本轮按钮 → 冻结本轮场景 → 生成图片 → 作为本轮插画展示`。前者并没有现成的“读取当前 Tavern 场景并插入某一轮”的能力。

尤其不能把它当成已经公开的生图 SDK：源码中有独立适配函数，但发布包只导出根入口、client、package.json；根入口没有导出 provider 调用函数或注册 `imageGeneration` service，也没有生成图片的 HTTP 接口，只有读取已存附件的接口。复用路径应是研究后移植小模块，或以后请上游拆出公开服务，不应依赖包内未导出的私有路径。[包导出](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/package.json#L15-L37)、[主入口](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/index.ts#L19-L44)。

## 可借鉴程度

| 部分 | 源码确认的能力 | 对 Tavern 的处理建议 |
| --- | --- | --- |
| 提供商适配器 | 输入 prompt/配置/signal，输出图片字节与 MIME；不必依赖 Agent 来完成 HTTP 请求 | 最值得提取思路和部分代码，但先补下文安全边界 |
| 凭据与设置 | DSH settings 存 provider/model/URL；credentials 存 key，浏览器仅检查是否配置 | 沿用宿主凭据服务，不把 key 放人物卡、正文或普通日志 |
| 附件存储 | 生成后先 `attachments.saveImage`，后续以 attachment ref 读取 | 存图片并保存引用，不热链提供商临时 URL，不把 base64 塞入正文 |
| 图片展示 | 工具结果元数据转成独立图片节点，可下载/放大 | 借鉴“图片是附件”而非照搬其 turn 工具事件投影 |
| Gallery | 浏览器 IndexedDB 索引、删除墓碑；二进制仍在 DSH 附件中 | 第一版不需要；也不能拿浏览器索引当跨设备存档真相 |
| 图片编辑/多参考图 | 从有效 Session 或 workspace 找图片，再调用 edit API | 后续做人物一致性时可研究，首版纯文生图不引入 |
| ComfyUI | API workflow 导入、prompt/seed 占位符、提交后轮询结果 | 单独可选适配器；不是“所有用户只填一个 API Key”能用 |

### 提供商适配不是统一换个 URL

| 提供商 | 该提交实际使用的协议 | 特殊点 |
| --- | --- | --- |
| OpenAI/兼容中转 | `POST <base>/images/generations`，Bearer，model/prompt/size | 兼容 `data/images/output` 数组、`b64_json` 或 URL；仅取首图。并非所有标称 OpenAI-compatible 的中转都提供 Images API |
| Seedream | 文生图复用兼容适配器并指定 URL 返回；编辑走 generations + data URL 数组 | 默认尺寸 `2K`；编辑不是 OpenAI multipart edits |
| Google | Gemini **Interactions API**，`x-goog-api-key`，`response_format` | 不能直接拿支持 Gemini `generateContent` 的中转地址替代；比例和分辨率分开传 |
| DashScope | `services/aigc/multimodal-generation/generation` | 代码只接受 `qwen-image*` 模型；尺寸 `1024*1024`；不能从 UI 的“万相/Qwen”字样推断支持所有万相模型 |
| ComfyUI | `/prompt` → `/history/{id}` 轮询 → `/view` 下载 | 用户导入 API workflow；默认 Host 可访问的 `127.0.0.1:8188`；当前不支持 edit_image |

依据：[OpenAI 适配](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/openai-compatible.ts#L16-L95)、[Google 适配](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/google.ts#L24-L105)、[DashScope 限制与请求](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/dashscope.ts#L82-L122)、[Seedream 编辑](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/seedream.ts#L8-L37)、[ComfyUI 流程](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/comfyui.ts#L14-L81)、[配置解析](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/config.ts#L96-L115)。

## 最值得直接学习的三处

### 1. 把 HTTP 适配和宿主生命周期分开

provider 函数接收已解析的配置与字节，返回 `{data, mediaType}`；主入口负责读凭据、调用适配器、存附件。分界清楚，Tavern 按钮不必为了生图先诱导前台 Agent 产生一次工具调用。[调用编排](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/index.ts#L54-L83)。

### 2. 附件成功和额外文件导出失败分开处理

`saveGenerated` 先存 DSH attachment，再可选存 workspace；workspace 保存失败只设置 `saveError`，不抹掉已经成功的图片。可借鉴这种分级失败，不让一个可选动作把主结果宣判失败。[保存流程](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/index.ts#L177-L199)。

workspace 写入有 realpath 检查和同目录 staging+rename，可借鉴原子写与目录边界；但文件名只有摘要前 8 位，不能把它当无碰撞的完整内容寻址方案。[文件名与边界](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/workspace-save.ts#L15-L61)、[落盘实现](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/workspace-save.ts#L107-L143)。

### 3. 图片结果不必伪装成剧情文本

现代 DSH UI 由 `tool/result` 元数据建立 `dsh-image-result` 节点，锚定到该 turn 最终回答附近，使图片不被 Compact 过程折叠。这说明“独立附件、视觉上随正文展示”可成立，不必改写原正文。[结果节点](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/client/image-result-node.ts#L50-L103)。

但该插件工具 render 同时返回 model-facing 的 image block，所以整引工具流程并不等于“只给用户看、不影响以后模型上下文”。是否被后续模型消费取决于 DSH 投影，本文未做网络验证。[工具输出](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/index.ts#L142-L165)。

## 不能直接照抄的边界

1. **返回图片 URL 的凭据转发。** OpenAI-compatible 的 `downloadImage` 对提供商返回的任意 URL 再发同一个 `Authorization: Bearer ...`，未检查 URL 与配置 endpoint 同源；初始下载目的地若为第三方即会收到 key。此为源码可确认的数据流，不需要假设重定向会转发 key。应默认不携带生成请求的 key；确需鉴权下载时只对明确受信任的目标配置。还应限制下载 URL 协议和目标，区分用户明确配置的本地 ComfyUI 与模型服务返回的任意地址。[证据](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/openai-compatible.ts#L97-L115)。
2. **超时并不统一。** Google/OpenAI/Seedream/DashScope 主要依赖调用者的 AbortSignal；未见它们自己的总 deadline。ComfyUI 才有覆盖提交、轮询、下载的超时控制。Tavern 按钮须自己规定超时、取消、重启后未完成任务状态，不能只搬 `fetch`。[ComfyUI deadline](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/comfyui.ts#L23-L43)。取消 Host 请求也不自动等于供应商停止计算或停止计费；源码未见 ComfyUI 远端队列取消调用。
3. **限制和错误处理有差异。** Google 在解码后检查实际字节数；OpenAI-compatible 限制 JSON 响应大小但 base64 分支没有同样的解码后上限检查；DashScope 先完整读 JSON/错误文本、完整下载 arrayBuffer，再检查图片大小。应统一流式字节限制、真实类型验证、错误脱敏，不把供应商原始大响应或潜在敏感内容直接展示。[Google 校验](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/google.ts#L74-L88)、[OpenAI 解析](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/openai-compatible.ts#L62-L75)、[DashScope 下载](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/dashscope.ts#L112-L155)。
4. **同源不是鉴权。** 读图 route 检查方法、Content-Type、Origin、附件形状、4KiB 请求限制，但无 Origin 时可继续，未在此函数检查 session 所属权。它依赖 DSH webServer 外层与 attachment 验证。Tavern 接入须确认现有 token/cookie、反代与权限边界，不可因写着 same-origin 就当所有鉴权已完成。[route](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/image-route.ts#L15-L43)。
5. **图片缓存与画廊不是持久化替代品。** 它读图用 POST + `private, no-store`，每次组件挂载重新取 blob 并销毁 object URL；IndexedDB 只存浏览器元数据且不是跨设备事实来源。Tavern 用户已有加载速度诉求，宜复用自己的鉴权附件加载/缓存策略，而不是照抄此路径。[加载](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/client/index.tsx#L674-L720)、[Gallery 数据](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/client/gallery-store.ts#L1-L24)。

这些是移植时的评估点；本研究未执行安全攻击、未向上游发 issue，也未证明所有部署都存在可利用漏洞。

## 为何不整包加载

- Host 会注册 `generate_image`、`edit_image` 两个 Agent 工具；并非只提供按钮背后的函数。[注册](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/index.ts#L44-L101)。
- client 除设置外，还注册两个 toolview、独立 chat node、Gallery view，并注入样式，图库活跃时甚至通过 CSS 隐藏 composer；这些不是 Tavern 首版需求。[客户端注册](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/client/index.tsx#L293-L386)。
- 独立图片节点依赖 DSH turn/tool/result/assistant-message 生命周期。后台按钮完成不自然地产生这一套前台事件；不能为了展示图片伪造 assistant/message 或开启一轮剧情。[节点状态机](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/src/client/image-result-node.ts#L50-L103)。
- 包声明 DSH peers `>=0.1.1-rc.2 <0.2.0`、React `>=18.2.0 <19`，开发依赖基于 rc.2；主调研者实读本机 DSH 为 `0.1.2-alpha.2`、其 trajectory 下 React 为 `19.2.8`，存在声明范围不一致，但不能据此宣称已实测不兼容。源码还有新旧 credentials/UI 兼容分支，表明维护成本确实存在。[依赖声明](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/package.json#L90-L127)。

## Tavern 最小接入建议（尚未实现）

主仓库接入点由主调研者读取后提供，基线为 [`55f7c609249553236bacefee645c42505ae336c8`](https://github.com/flizzywine/dsh-tavern/tree/55f7c609249553236bacefee645c42505ae336c8)：

- [client.js:2927](/Users/cf/Workspace/dsh-tavern/tavern-plugin/lib/client.js:2927) 的 `renderTavernProjection` 是正文展示位置；[client.js:2941](/Users/cf/Workspace/dsh-tavern/tavern-plugin/lib/client.js:2941) 的 assistant blocks 已处理 image 并交给附件渲染。它是可参考的显示能力，不意味着图片可以不建数据关系就直接插入。
- [client.js:3046](/Users/cf/Workspace/dsh-tavern/tavern-plugin/lib/client.js:3046) 的 `TavernAssistantNodeView` 及 keyed `conversation.chat.node/assistant-step` 控制当前正文节点。
- [story-timeline.js:95](/Users/cf/Workspace/dsh-tavern/tavern-plugin/lib/domain/story-timeline.js:95) 保存 messages 快照，[story-timeline.js:114](/Users/cf/Workspace/dsh-tavern/tavern-plugin/lib/domain/story-timeline.js:114) 恢复；插画需要定义是否随当前快照显示。
- [tavern-swipe-regeneration.js:40](/Users/cf/Workspace/dsh-tavern/tavern-plugin/lib/domain/tavern-swipe-regeneration.js:40) 的 `mergeRegeneratedSwipe` 保留旧 swipes 并选择新版本，因此不能假定重生成后旧正文永远消失。

建议第一版：

1. 每个已完成的正文轮次提供“场景插画”按钮，一次一图，点击时冻结当轮有效正文及少量与画面相关的人物外观/地点信息。不发送整卡、全部世界书、全部 MVU schema。
2. 增加独立的“场景 → 画面描述”步骤，或先用可控模板；不借前台 Agent 顺便续写剧情。该插件没有帮 Tavern 做这一层，需要自己设计。若用后台文本模型，明确只输出画面描述、不许补剧情，并记录最终 prompt 便于诊断；这是额外一次文本模型调用与费用。
3. Host 从 credentials 读 key，调用选定生图适配器，收到结果后先保存附件。图片元数据绑定 chat、turn、swipe、sourceDigest 和生成配置；视觉插在该轮正文下方，不拼回 `sourceText` / `sessionText`，不把 base64 放入历史，不触发 MVU。
4. 生成期间按钮忙碌、防重复点击；失败仅影响插画，允许明确重试。请求超时可能已被供应商受理，避免无提示自动重试造成重复收费。
5. 完成时检查目标轮次/swipe 仍存在且源正文未被替换。用户继续到下一轮不必丢弃结果，它仍属于点击时那一轮；目标删除/回退/改写才需要按约定中止挂载或处理孤儿附件。
6. 图片与绑定元数据持久化，刷新、重启、手机访问应恢复；不只存 React state 或 IndexedDB。不要求第一版搭建画廊、图片编辑、批量生图、自动每轮生图。

这满足“用户主动点一下、当前场景生成一张、放进正文阅读区”，同时不侵入剧情生成与变量结算。

## 首版需要决定的少量问题

- 优先一个用户实际可用的提供商协议，还是明确两种协议；不能只叫“自定义地址”而隐去接口类型差异。
- 按钮默认画“本轮的一个代表画面”，而不是试图把一整轮多个连续动作塞进一张图。
- 提示词是否允许用户展开修改；可以默认一键，高级编辑折叠，不增加必填步骤。
- 是否追求人物跨轮外貌一致。纯文生图不能仅靠重复名字保证一致；参考图、固定外貌描述属于后续能力，不应把首版承诺成已解决。

## 后续验证清单

真正实施后需验证，而非以外部测试文件存在代替通过：一次点击只触发一次生成；失败/取消不改剧情和 MVU；返回 URL/base64 两种模式；超大响应与无图响应；跨域下载不发 key；Desktop/CLI Web token 鉴权；刷新恢复；生成过程中继续剧情、回退、重生成、切换 swipe；插画不被误传成下一轮正文或扩大模型上下文；日志不带 key；供应商接受请求但客户端超时的重试提示。

外部仓库有 provider、index、reference-image、workspace-save、client compatibility 与 image-result-node 测试文件，提供了可借鉴的测试切分；本次未安装依赖或运行这些测试，不能宣称其端到端通过。

## 许可

仓库采用 MIT。若后续复制具有实质性的代码，需要保留原版权和许可声明；这次只写调研，没有复制外部实现进产品。[LICENSE](https://github.com/shanliuling/dsh-image-gen/blob/0a1bb6d4ad0adb0e676a1193d098bd4c4589d167/LICENSE#L1-L21)。
