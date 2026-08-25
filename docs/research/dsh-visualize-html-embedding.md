# dsh-visualize：HTML 如何进入 DSH 对话流

> 研究对象：[`Nagi-ovo/dsh-visualize`](https://github.com/Nagi-ovo/dsh-visualize/tree/b0bed38f40ffbb0d72bb88393d865307944c1bce)  
> 固定提交：`b0bed38f40ffbb0d72bb88393d865307944c1bce`（仓库版本 `0.1.2`）  
> 对应 DSH 依赖：`0.1.1-rc.2`；官方源码标签 [`dsh-v0.1.1-rc.2`](https://github.com/deepseek-ai/deepseek-harness/tree/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)  
> 检查日期：2026-08-25

> 当前项目说明：本文记录 `dsh-visualize` 的参考实现及早期方案，不定义 dsh-tavern 当前 HTML 权限。现行机制以[酒馆正则渲染备忘](sillytavern-regex-rendering-memo.md)和[助手正文 HTML 渲染设计](../design/inline-message-renderer-refactor.md)为准；当前实现允许可信人物卡使用 HTTPS 远程资源。

## 一句话结论

`dsh-visualize` 证明了：**DSH Web 插件可以通过正式的工具展示插槽，把一个 React 组件放在对话流中的工具调用位置，再由组件用 `iframe srcDoc` 渲染 HTML。**

它没有把 iframe 插进普通助手 Markdown 正文，也没有用 DOM 查询/替换做补丁。因此它本身只直接证明 iframe 卡片这条基础设施可行。第二阶段继续检查 DSH `0.1.1-rc.2` 后确认：`conversation.chat.node` 的 keyed slot 支持按 priority 遮蔽，第三方插件可以正式接管 `assistant-step` 整个节点；只是没有更细的“包裹或追加原生助手正文”插槽。

## 实际链路

```text
模型加载 visualize skill
  → 调用 visualize 工具，HTML fragment 作为 fragment 参数
  → Node 端校验并执行工具
  → HTML 同时写入工作区文件，并写进持久化 tool/result meta
  → Web 端按工具名 visualize 命中 tool.call.toolview
  → React 的 VisualizeCard 在该工具调用位置创建 iframe
  → buildFrameDoc 组装完整文档，赋给 iframe.srcDoc
```

### 1. 插件入口与 DSH 注册 API

插件分成 Node 和 Web 两半：

- Node 入口向 `ctx.tools` 注册 `visualize` 工具，向 `ctx.skills` 注册配套 skill：[源码](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/index.ts#L20-L47)。
- Web 入口依赖 `slots`，把 `VisualizeCard` 注册到 keyed slot `tool.call.toolview`，key 是工具 wire name `visualize`：[源码](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/client/index.tsx#L16-L34)。
- 它还把流式预览组件注册到 `conversation.input.dock`，但这是输入框附近的临时预览，不是最终对话记录：[源码](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/client/index.tsx#L31-L34)。

这不是非官方猜法。DSH `ui-tool` 官方文档明确规定，业务插件可以按工具名注册 `tool.call.toolview`；DSH 负责 call/result 配对、生命周期和它在 ChatFlow 中的位置：[官方说明](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-tool/README.zh.md#L5-L31)。官方 `ToolCallTree` 也确实按 `toolName` 分发该插槽：[官方源码](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-tool/src/client/tool/ToolCallTree.tsx#L25-L44)。

### 2. HTML 从哪里来，如何触发展示

HTML 不是从普通助手正文中识别出来的，也不是从某个 `.html` 文件直接加载到 iframe：

- 模型主动调用 `visualize` 工具，把完整的 inline HTML fragment 放在 `fragment` 参数里；工具描述允许 markup、`<style>` 和 `<script>`：[源码](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/tool.ts#L31-L88)。
- 配套 skill 告诉模型何时调用、fragment 的格式和权限：[源码](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/assets/visualize-skill.md#L33-L100)。
- 工具执行后把 fragment 写到工作区 `viz/*.html`，但 UI 重放不依赖这个文件；fragment 本身通过 `presentationMeta` 写入持久化的工具结果：[源码](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/tool.ts#L91-L175)。
- Web 端只在工具结果 meta 满足 `{ kind: 'visualize', fragment, title, mode, path }` 时挂载 iframe；失败或旧日志回退为普通文本：[源码](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/client/VisualizeCard.tsx#L122-L140)。

因此，**触发协议是工具调用，不是“消息里出现了 HTML”。**

### 3. 它显示在哪里

最终卡片属于：

- 对话 transcript 中的工具调用节点；
- 视觉上嵌在对话流里；
- 不是侧栏、弹窗、新窗口或独立 artifact 查看器；
- 也不是普通 assistant text / Markdown 正文。

工具执行还会留下可导出的工作区 `.html` 副本，但 UI 使用持久化 meta 里的 fragment，不读取该文件。因此“工作区 artifact”和“对话内卡片”是两个投影，不是同一个加载机制。

流式生成期间另有一个输入区 dock 预览；调用完成后该预览卸载，由 transcript 中的正式工具卡片接替：[源码](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/client/StreamingPreview.tsx#L142-L160)。

### 4. iframe 的具体机制

最终卡片直接渲染 React 元素：

```tsx
<iframe
  sandbox="allow-scripts"
  referrerPolicy="no-referrer"
  srcDoc={doc}
/>
```

对应源码：[VisualizeCard.tsx](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/client/VisualizeCard.tsx#L93-L118)。

`doc` 由 `buildFrameDoc` 组装成完整 HTML 文档：固定 `<head>`、CSP、基础 CSS、主题变量、原样插入的 fragment，以及高度上报脚本：[shell.ts](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/shell.ts#L75-L104)。

没有使用 blob URL、data URL、文件 URL或新窗口。核心就是 **React 组件 + `<iframe srcDoc>`**。

### 5. 高度、生命周期和通信

- iframe 内用 `ResizeObserver` 监听文档高度，通过 `parent.postMessage` 上报 `{ type, token, height }`：[源码](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/shell.ts#L106-L129)。
- 父页面监听 `message`，按工具调用 `callId` token 关联卡片，把高度限制在 `48px` 到 `800px`（inline）或 `1200px`（wide）；超过上限由 iframe 内部滚动：[源码](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/client/VisualizeCard.tsx#L25-L27)，[监听源码](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/client/VisualizeCard.tsx#L80-L103)。
- React 卸载时移除消息监听和主题监听。主题变化会重建 `srcDoc`，因此 iframe 内容会重载。
- 正式卡片从持久化 tool/result meta 恢复，所以重放不依赖原 fragment 文件仍然存在。
- 流式预览的 iframe 只创建一次；父页面每 150ms 左右将 fragment 前缀用 `postMessage` 发入 iframe，iframe 用增量 DOM 同步避免每个 token 都整页重载：[源码](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/client/StreamingPreview.tsx#L88-L139)，[同步脚本](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/shell.ts#L156-L225)。

当前通信只服务于高度和流式 fragment；项目 README 明确说卡片按钮暂时不能向主对话发送 follow-up。

### 6. 安全边界

它主要依靠隔离，而不是把 fragment 清洗成“安全 HTML”：

- `sandbox="allow-scripts"`，没有 `allow-same-origin`，所以 iframe 是 opaque origin，不能读取宿主页面 DOM、cookie 或存储。
- CSP 是 `default-src 'none'`；禁止嵌套 frame、object、base 和表单提交；`connect-src` 只允许 `blob:`/`data:`，因此普通 fetch/XHR/WebSocket 网络访问被阻止：[完整 CSP](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/shell.ts#L19-L46)。
- 允许 inline script、`unsafe-eval`、Wasm，以及从固定 CDN 加载脚本/样式/图片/字体/媒体。这意味着卡片内脚本是设计允许的，只是被困在 iframe 里；它不是“无脚本 HTML”。
- fragment 没有经过 DOMPurify 或通用 HTML sanitizer。校验只检查非空、字节上限和禁止自带 document skeleton：[源码](https://github.com/Nagi-ovo/dsh-visualize/blob/b0bed38f40ffbb0d72bb88393d865307944c1bce/src/fragment.ts#L45-L74)。
- 只有宿主传入的 CSS 主题值做了简单字符过滤，标题做 HTML escape；用户 fragment 是原样插入 `srcDoc`。
- `postMessage` 使用 `'*'`，接收端校验 message type 和 token，但没有同时校验 `event.source`。opaque-origin iframe 无法用正常 origin 字符串校验，不过仍可校验具体 `contentWindow`；本项目当前没有做这一层。

所以它的安全模型是：**允许 HTML/脚本充分运行，但通过 opaque-origin sandbox + CSP 将能力关进一个受限小环境。**

## 对 dsh-tavern 的意义

### 它能证明什么

1. DSH Web 的插件体系确实能在对话流内部挂载自定义 React UI，不需要查 DOM、隐藏节点再插入补丁。
2. 在该 React UI 中用 `iframe srcDoc` 展示 HTML、自动高度、主题桥接、会话重放都已经有可工作的社区先例。
3. `sandbox="allow-scripts"` 且不加 `allow-same-origin`，再配合严格 CSP，是运行第三方 HTML/CSS/JS 时可参考的隔离骨架。
4. 将 HTML 内容写进持久化事件 meta、把文件只当导出副本，可以避免会话重放依赖磁盘临时状态。

### 它不能证明什么

1. 它没有证明 `tool.call.toolview` 可以接管普通助手文字正文；该插槽只匹配工具调用。
2. 它没有实现或验证酒馆的 `markdownOnly` / `promptOnly` 正则，也没有处理“同一条助手消息经过展示正则后，正文中混合 Markdown 与 HTML”的问题。
3. 它的 HTML 来自一个显式 `visualize` 工具参数，不是从模型普通回复中提取，更不会保持普通回复中任意 HTML 片段的原位置。
4. 它自身没有使用 assistant body；“第三方可以接管整个 `assistant-step`”是第二阶段从 DSH 官方源码确认的，不是 `dsh-visualize` 的实现证据。
5. 它允许 fragment 脚本执行。人物卡展示正则是否也应允许脚本、允许哪些 CDN、是否需要更严格清洗，必须依据酒馆兼容范围另行决定，不能直接沿用。

## 可直接借鉴的部分

可借鉴的是基础设施，不是触发协议：

- React 组件内创建 `iframe srcDoc`；
- opaque-origin sandbox；
- CSP 能力白名单；
- iframe 内 `ResizeObserver` + `postMessage` 上报高度；
- 父侧限高、卸载监听、主题变量桥接；
- 持久化展示输入，保证会话重放稳定。

dsh-tavern 的上游输入仍应是“模型原始输出经过展示正则得到的展示投影”，而不是改造成 `visualize` 工具调用。

## 第二阶段：DSH 普通助手正文的正式接入点

> 固定源码：DeepSeek Harness `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，即 DSH `0.1.1-rc.2`。

### 1. 普通助手消息的渲染链路

普通助手消息与工具卡片走的是两条不同链路：

```text
assistant/chunk、assistant/message 持久事件
  → assistantDefinition 折叠为 Chat Node：kind = assistant-step
  → ChatNodeSeat 按 node.kind 分发 conversation.chat.node
  → 内置 key=assistant-step 的 AssistantNodeView
  → AssistantMarkdown 按 block 顺序处理
  → text block 交给 MarkdownText

tool call/result
  → Chat Node：kind = tool-call
  → ui-tool 的 ToolCallTree
  → 再按 toolName 分发 tool.call.toolview
  → dsh-visualize 只占用其中 key=visualize 的工具卡片位置
```

证据：

- `assistantDefinition` 从 `assistant/chunk` 和 `assistant/message` 生成 `assistant-step`，并保留 streaming、settled、interrupted 三种状态及原始 block 顺序：[官方源码](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts#L80-L131)，[最终投影](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts#L217-L310)。
- `ChatNodeSeat` 用 `entryKey: routedNode.kind` 分发 `conversation.chat.node`：[官方源码](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/chat/ChatNodeSeat.tsx#L18-L61)。
- ui-conversation 内置注册 `key: 'assistant-step'` 的 `AssistantNodeView`：[官方源码](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/chat/register-node-renderers.ts#L15-L24)。
- `AssistantNodeView` 把 `node.data.blocks` 交给 `AssistantMarkdown`：[官方源码](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/chat/AssistantNodeView.tsx#L5-L32)。
- `AssistantMarkdown` 按顺序渲染 text、reasoning、image，跳过已被 ChatView 分组为工具行的 tool-call；text 使用 `MarkdownText`：[官方源码](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/chat/AssistantMarkdown.tsx#L34-L114)。
- `MarkdownText` 明确把 assistant-authored Markdown 当成不可信内容，禁用 raw HTML；AST 的 `html` 节点直接返回字符串，因此显示为字面文本，不生成 DOM：[官方说明](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-primitives/src/markdown/MarkdownText.tsx#L140-L175)，[HTML 分支](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-primitives/src/markdown/render.tsx#L267-L269)。

因此，当前 DSH 原生正文不会执行或渲染人物卡正则产生的 HTML。

### 2. 第三方插件能否接管 `assistant-step`

**可以，且属于 slots 的正式能力。**

`conversation.chat.node` 是 keyed、session-scoped slot，并按 Chat Node kind 分发：[官方声明](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/contract/slots.ts#L113-L122)。它向注册组件提供 `node`、workspace、打开文件、fork、图片渲染和 file mention 等 owner currency；公开的 `ChatNodeViewProps` 类型可供第三方实现：[官方类型](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/contract/slots.ts#L403-L432)。

Slots 的规则不是“相同 key 永远不能再注册”，而是：

- 同一 key、同一 priority 会在注册时失败；
- 同一 key、不同 priority 可以共存；
- priority 数字越小越优先，最低的活动条目成为该 cell 的唯一 renderer；
- 优胜 renderer 崩溃并 abdicate 后，后面的 renderer 可以恢复为 fallback。

这些规则在类型注释和 `SlotCore.register` 中均为明确契约：[priority 类型契约](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-slots/src/index.ts#L476-L509)，[注册与遮蔽规则](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-slots/src/index.ts#L706-L724)，[优胜项选择](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-slots/src/index.ts#L924-L951)。

内置 `assistant-step` 未指定 priority，等于 `0`。所以第三方插件可以在该 slot 声明出现后注册：

```ts
ctx.slots.inject('conversation.chat.node', () =>
  ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'assistant-step',
    priority: -1,
  }, TavernAssistantNodeView))
```

这样 Tavern renderer 成为 `assistant-step` 的唯一活动视图；内置 renderer 仍在账本里，插件卸载或主动退位后可以恢复。本次还在随 `dsh-visualize` 安装的官方 `ui-slots 0.1.1-rc.2` 上做了最小运行验证：priority `-1` 的第三方条目是 `entriesOfSlot` 唯一 winner，priority `0` 的内置条目保留但不渲染。

### 3. 能否覆盖、包裹或追加

| 需求 | 当前正式能力 | 结论 |
|---|---|---|
| 覆盖整个普通助手节点 | `conversation.chat.node` 同 key、低 priority 遮蔽 | **可以** |
| 包裹原生 `AssistantMarkdown` | keyed slot 只选一个 winner，没有 `renderOriginal`/next renderer | **不能直接做** |
| 在每条 assistant body 前后追加内容 | assistant body 内没有 list/chain child slot | **不能直接做** |
| 在已完成轮次末尾追加一行 | `conversation.chat.turnTail` chain | 可以，但它是独立 turn-tail 节点，不是消息正文，只覆盖收尾消息 |
| 在 assistant 下增加按钮 | `conversation.chat.assistant-actions` list | 可以，但只属于已定稿消息操作栏，不是正文 |

“覆盖”是完整接管，而不是局部 decorator。替换组件必须自己处理：

- text / reasoning / image block 的顺序；
- streaming 与 interrupted 状态；
- 图片 slot；
- Markdown、文件 mentions；
- 原生正文未来新增的交互与样式兼容。

`/client` 的公开出口只导出 slot contract 类型，没有导出 `AssistantMarkdown` 或 `AssistantNodeView` 组件：[官方出口](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/index.ts#L17-L38)。因此第三方不能通过稳定公共 API 直接“原样渲染内置组件，再在外层加 iframe”；只能实现一个完整 replacement，或者推动 DSH 增加更细的正文 seat。

### 4. dsh-tavern 的最小可行接入方案

#### 方案 A：正式遮蔽 `assistant-step`（当前最小可行）

注册 priority `-1` 的 Tavern assistant renderer，从 `node.data.blocks` 读取 text block，对展示文本执行 `markdownOnly` 正则，再选择原生 Markdown 或 sandboxed iframe 渲染；reasoning、image 等其他 block 保持原顺序处理。

- 优点：使用正式 slot，不依赖 DOM 结构；流式、历史回放和分页都从同一 Chat Node 数据进入。
- 代价：必须复刻/维护当前 `AssistantMarkdown` 的非 HTML 行为；DSH 升级时要做兼容测试。
- Session 影响：**无。** 它只读取浏览器的会话快照并改变 React 展示，不改 `assistant/message` 事件，也不改变下一轮模型上下文。

#### 方案 B：向 DSH 增加 `conversation.chat.assistant-body` 子 slot（长期更干净）

让内置 `AssistantNodeView` 或 `AssistantMarkdown` 把正文渲染委托给新的 keyed/single/chain seat，并保留当前 Markdown renderer 作为 fallback；dsh-tavern 只接管 text body，原生 reasoning、image、interrupted 和未来功能仍由 DSH 持有。

- 优点：职责最小、升级风险最低，真正支持局部替换或包裹。
- 代价：需要 DSH 上游变更或维护补丁，当前 `0.1.1-rc.2` 没有这个 seat。
- Session 影响：**无**，只要新增的是 Client UI slot。

#### 方案 C：DOM patch

继续查找已渲染消息 DOM，隐藏 `MarkdownText` 并插入 iframe。

- 优点：不接管全部 React renderer。
- 代价：依赖 class/DOM/时序，流式重渲染、分页、主题和 DSH 升级都可能破坏它。
- Session 影响：**无**，但展示可靠性最差。

#### 不建议：借用 `visualize` 工具承载人物卡正文

把普通回复改造成 `visualize` 工具调用，会向 Session 增加工具 call/result，改变 agent 轨迹和模型后续看到的上下文，也丢失“展示正则只产生 UI 投影”的语义。它不是透明渲染方案。

同样，若为了 HTML 展示而在 `assistant/message` 写入前直接把原文替换成展示 HTML，则会改变 Session 权威内容和下一轮模型上下文。`markdownOnly` 展示投影不应该通过这条路径实现；`promptOnly` 是否改变 Session，应由既定的服务端正则提交语义单独处理，不能与 UI renderer 混在一起。

### 5. Session 与模型上下文边界

DSH 官方明确说明，ui-conversation 只在浏览器中渲染会话历史和流，不组装也不发送模型请求：[官方说明](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/README.zh.md#L49-L55)。ui-slots 同样没有模型请求或 KV Cache 影响：[官方说明](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-slots/README.zh.md#L24-L30)。

所以：

```text
assistant-step renderer 覆盖
  = UI 展示变化
  ≠ Session 事件变化
  ≠ promptOnly 正则
  ≠ 下一轮模型上下文变化
```

这正好允许 dsh-tavern 保持三层分离：Session/模型语义在 Host 侧确定，`markdownOnly` 只在 Client renderer 中形成展示投影，iframe 只是展示投影的最后渲染容器。

## 验证

在固定提交上执行 dsh-visualize 仓库测试：`3` 个测试文件、`32` 个测试全部通过。测试覆盖 fragment 校验、补丁语义、流式 fragment 解码、CSP 文档组装、高度脚本和工具持久化写入。

第二阶段另对官方 `ui-slots 0.1.1-rc.2` 做了最小运行验证：同一个 `assistant-step` keyed cell 中，priority `-1` 的插件条目遮蔽 priority `0` 的内置条目，`entriesOfSlot` 只返回插件 winner。普通助手正文 takeover 的结论来自固定版 DSH 源码和 slot 运行语义；尚未在真实浏览器中挂载 Tavern replacement renderer。
