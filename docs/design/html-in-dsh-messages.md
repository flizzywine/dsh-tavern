# 在 DSH 对话中插入 HTML

> 状态：第一版已实现并通过本地浏览器验证。  
> 当前验证边界：DSH `0.1.1-rc.2`。

## 结论

DSH Web 可以在对话流中展示 HTML，但要区分两种入口：

1. **工具结果 HTML**：注册 `tool.call.toolview`，适合 `visualize` 一类显式工具卡片。
2. **普通助手正文 HTML**：注册 `conversation.chat.node` 的 `assistant-step`，用更低 priority 接管整个助手消息渲染器。

dsh-tavern 的人物卡展示正则处理的是普通模型回复，应使用第二种入口。不能为了复用工具卡片而把每轮人物卡回复伪造成工具调用。

## DSH 中的正式接入点

DSH 把普通助手消息投影为 `assistant-step` Chat Node，再由 keyed slot `conversation.chat.node` 选择渲染器。内置助手渲染器使用默认 priority `0`；Tavern Profile 可以注册 priority `-1` 的同 key 渲染器，使其成为当前活动视图：

```ts
ctx.slots.inject('conversation.chat.node', () =>
  ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'assistant-step',
    priority: -1,
  }, TavernAssistantNodeView),
)
```

这是 DSH slots 的正式 shadowing 机制，不需要查询、隐藏或替换页面 DOM。插件卸载后，内置渲染器仍可恢复。

当前 DSH 没有更细的 assistant body 子插槽，也没有公开导出完整的 `AssistantMarkdown` 组件。因此，这个入口是**完整接管助手节点**，不是在原生正文外面简单包一层。

## dsh-tavern 的数据流

正则执行和 HTML 渲染是两个独立阶段：

```text
模型原始输出 R
    ├─ promptOnly 正则 → Session 文本 S → 写入 DSH Session
    └─ markdownOnly 正则 → 展示投影 D → TavernAssistantNodeView
                                              ├─ 普通 Markdown → 原生风格展示
                                              └─ 含 HTML       → iframe 展示
```

必须注意：如果 `promptOnly` 已经在写入 Session 前改变文本，那么浏览器从普通 `assistant-step` 中读到的可能只有 `S`，不能再由 `S` 反推出原始输出 `R`。

因此回复接收层需要分别生成 `S` 和 `D`：

- `S` 作为下一轮真实上下文写入 Session；
- `D` 或生成 `D` 所需的原始输出作为不可送模的展示投影保存；
- 展示投影使用稳定的消息标识或最终事件序号与 `assistant-step` 对齐；
- 找不到展示投影时，渲染器必须回退到 DSH 原有消息文本。

HTML 不能成为 Session 权威内容，iframe 也不能反向修改 Session。相关正则语义见[正则三层语义备忘](regex-three-layer.md)。

## Tavern 助手渲染器的职责

接管 `assistant-step` 后，Tavern renderer 不能只处理 HTML，还要保持 DSH 原有消息行为：

- 按原顺序处理 text、reasoning 和 image block；
- 区分 streaming、settled 和 interrupted；
- 普通文本继续使用 DSH 的 Markdown 基础组件和文件引用能力；
- 连续图片继续通过 DSH 提供的图片渲染入口；
- 没有 Tavern 展示投影时保持原生显示；
- 单次正则或 HTML 编译失败时显示原文，不让整条消息消失。

第一版可以只在消息定稿后运行完整展示正则并切换 HTML；流式过程中继续显示安全的普通文本。这样可以避免在不完整标签和不完整正则输入上反复构造 iframe。

## iframe 如何进入正文

Tavern renderer 在助手消息正文位置返回 React iframe：

```tsx
<iframe
  sandbox="allow-scripts"
  referrerPolicy="no-referrer"
  srcDoc={documentHtml}
/>
```

`documentHtml` 由 Host 组装，而不是让人物卡提供整个浏览器文档：

```text
固定 doctype/head
+ CSP
+ DSH 主题变量
+ 基础样式
+ 展示投影内容
+ Host 控制的高度上报脚本
```

iframe 宽度为消息正文宽度、边框透明。iframe 内用 `ResizeObserver` 监听文档高度，通过 `postMessage` 上报；父组件同时校验消息类型、随机 token 和 `event.source === iframe.contentWindow`，再设置 iframe 高度。超过上限时由 iframe 内部滚动。

视觉上，iframe 就是这条助手消息的正文；它不是侧栏、弹窗，也没有把内容从原消息顺序中搬走。

## Markdown 与 HTML 的选择

渲染器不应使用简单字符串正则判断 HTML，而应由展示编译器解析展示投影：

- 没有可渲染 HTML：继续走普通 Markdown；
- 存在 HTML/CSS 展示结构：交给 iframe；
- Markdown 与 HTML 混合且要求保持跨片段样式、标签关系和原始顺序：整条展示投影进入同一个 iframe；
- HTML 解析失败：回退为安全的可见原文。

正则只负责生成展示字符串，iframe 只负责显示该字符串。两者不能合并成同一个“正则运行沙箱”。

## 安全边界

HTML 是否允许人物卡脚本运行，是独立于“能否插入 HTML”的产品策略。最低安全要求包括：

- iframe 不启用 `allow-same-origin`，保持 opaque origin；
- CSP 默认拒绝网络、表单、嵌套页面、对象和宿主导航；
- 不向 iframe 暴露 Host `window`、DSH Session 或文件系统；
- `postMessage` 只开放明确、可校验的少量协议；
- 限制输入大小、输出大小、iframe 高度和资源来源；
- 某一条消息渲染失败只回退该消息，不影响会话和其他消息。

可分成两个能力等级：

1. **静态展示**：移除人物卡脚本，只允许 Host 自己的高度同步脚本。
2. **兼容脚本**：允许人物卡脚本在 opaque-origin iframe 内运行，并使用更严格的 CSP、资源授权和受限 Host bridge。

第一版采用哪一级需要单独确认，不能因为 iframe 已经隔离就默认放开全部脚本。

## 不采用的方式

### DOM 补丁

查找 DSH 已渲染的消息节点、隐藏原正文再插入 iframe，虽然短期可行，但会依赖 class、DOM 层级和渲染时序；流式消息、历史分页和 DSH 升级都可能破坏它。

### 伪造工具调用

把普通人物卡回复包装成 `visualize` 等工具调用，会向 Session 增加 tool call/result，改变 Agent 轨迹和模型上下文，不符合 `markdownOnly` 只改变 UI 的语义。

### 直接修改 DSH Markdown HTML 策略

让所有 `MarkdownText` 执行 raw HTML 会把普通会话也暴露给不可信 HTML，并污染 DSH 全局行为。HTML 能力应只在 Tavern Profile 的受控 renderer 中启用。

## 验收条件

- 无展示正则、无 HTML 的消息与原生 DSH 表现一致。
- 展示正则产生的 HTML 保持在原消息位置和原始顺序中。
- `markdownOnly` 变化不改变 Session 和下一轮模型上下文。
- `promptOnly` 变化能进入 Session，但不会决定玩家看到的展示结果。
- 刷新、历史重放、回退和分支后仍能找到对应展示投影。
- reasoning、图片、流式和中断消息没有功能回退。
- HTML、正则或 iframe 单项失败时显示安全原文，会话继续运行。
- DSH 升级时对 `assistant-step` slot、block 类型和原生消息行为进行兼容测试。

## 长期方向

当前完整替换 `assistant-step` 是 DSH `0.1.1-rc.2` 下最小的正式方案。更理想的上游能力是新增 `conversation.chat.assistant-body` 子插槽，让 DSH 继续拥有 reasoning、图片、停止状态和消息动作，dsh-tavern 只接管 text body 的展示投影。

源码研究与版本证据见：[dsh-visualize：HTML 如何进入 DSH 对话流](../research/dsh-visualize-html-embedding.md)。
