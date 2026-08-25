# 在 DSH 对话中插入 HTML

> 本文只说明接入方式；行为与数据边界以[助手正文 HTML 渲染设计](inline-message-renderer-refactor.md)为准。

## 结论

dsh-tavern 通过 DSH 的 `conversation.chat.node / assistant-step` 正式插槽接管游玩消息，而不是修改页面 DOM，也不把普通回复伪造成工具调用。

展示链路是：

```text
displayText
  → 保持原顺序生成 displayParts
      ├─ Markdown       → DSH MarkdownText
      └─ HTML           → 必要时 marked 编译 → iframe
```

前端围栏包括：

- 标注为 `html` 或 `htm` 的代码围栏；
- 未标注语言，但源码含 HTML 标签或注释的围栏；其中包含 `html>`、`<head>` 或 `<body` 的完整页面与酒馆助手识别方式兼容。

HTML 不要求来自正则。模型原始输出、普通规则或 `markdownOnly` 规则产生的 HTML 都使用同一条展示链路。

这里不再把“原生 HTML”和“前端代码”建模为两种能力。它们都是需要浏览器解释和运行的 HTML；区别只在输入预处理：raw HTML 与周围 Markdown 一起编译，代码围栏先去掉围栏。

## 为什么使用 iframe

人物卡 HTML 可能包含 CSS、JavaScript 和远程依赖。直接放进宿主 DOM 会污染 DSH 样式并获得不必要的宿主能力。iframe 可以让界面出现在正文原位置，同时隔离文档、样式和脚本。

当前 iframe 使用：

```tsx
<iframe
  sandbox="allow-scripts"
  referrerPolicy="no-referrer"
  srcDoc={documentHtml}
/>
```

它允许 HTTPS 远程脚本、样式、图片、子页面和网络请求，以支持 jsDelivr 及社区卡片接口；但不启用 `allow-same-origin`，不提供 Tavern Helper Host bridge，也不允许读取 DSH Session 或宿主 DOM。父页面只接受带随机 token、且来源确为该 iframe 的高度消息。远程 API 如果不允许跨域，`fetch` 仍会被浏览器拒绝。

## 与 Session 的关系

iframe 只消费 `displayText` 的临时投影。DSH Session 保存的是 `sessionText`：

- `markdownOnly` 只改变 UI；
- `promptOnly` 只改变写入上下文的文本；
- 原始输出另存为 `sourceText`；
- iframe 文档、DOM 状态和用户在卡片中的临时操作都不写回 Session。

因此 `【首页】` 可以在 Session 中保持短占位符，而玩家看到正则生成的交互页面。具体来源证据见[酒馆正则渲染备忘](../research/sillytavern-regex-rendering-memo.md)。

## 明确不采用

- 不把 HTML 搬到右侧栏；
- 不扫描并隐藏 DSH 已渲染的 DOM；
- 不让所有 DSH 会话全局开启 raw HTML；
- 不用 HTML 标签形状决定内容所有权；
- 不把 iframe 产物送入模型上下文。

HTML 注释仍按标准浏览器行为不可见。若卡片希望把注释中的数据展示出来，应由自己的显示正则或前端代码明确完成，而不是由 Host 擅自把注释转成可见文本。
