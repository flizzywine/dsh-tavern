# 助手正文 HTML 渲染设计

> 状态：已实施并完成本地验收。
> 机制依据：[酒馆正则如何把 `【首页】` 变成可交互卡片](../research/sillytavern-regex-rendering-memo.md)。

## 普通正文原生渲染

普通文本、Markdown 和代码示例走 DSH `MarkdownText`，不再为了统一 HTML 渲染而创建 iframe。这样正文与聊天页共用滚动区域。

- 明确的 HTML 围栏（`html` / `htm`，或未标语言但含 HTML）仍各自进入 iframe；前后普通正文保持原生渲染和原始顺序。
- 明确标注其他语言的代码围栏、行内代码中的 HTML 标签不执行。
- 含 raw HTML 的片段和完整 HTML 页面仍原样隔离，不猜测其 DOM、样式和脚本依赖，也不把外来 HTML 注入宿主。
- 纯 Markdown 历史若与 Session 显示文本相同，沿用原生正文；显示正则改变文字、旧候选覆盖等情形仍产生 Markdown 投影。
- 不改 `sourceText` / `sessionText`、正则处理顺序、iframe 权限及交互。整篇正文被正则包成 HTML 的场景不在本次移出 iframe 的范围内。

验证入口：`tests/reply-presentation.test.mjs`、`tests/card-opening-previews.test.mjs`、`tests/fixtures/native-prose-browser-smoke.mjs`。后者使用真实 DSH MarkdownText 和正式消息 renderer；桌面 Chromium 的手机尺寸与触摸模拟不能代替 iOS / Android 真机验收。

## 目标

dsh-tavern 在消息原位置承接酒馆的“显示正则 + 前端渲染”机制，同时支持模型直接输出的 HTML：

```text
模型原始输出 R
  ├─ prompt 投影 → sessionText → DSH Session / 下一轮上下文
  └─ display 投影 → displayText
                         → 按原顺序拆成 Markdown / HTML
                         → HTML 在独立 iframe 中渲染
```

内容不再因 `<details>`、注释、样式或完整 HTML 形状被搬到右侧栏。正则只改写字符串，renderer 只解释最终展示投影。

## 权威行为

1. `sourceText` 保存模型原始输出，用于审计和重新投影。
2. `sessionText` 执行 prompt 阶段正则，并写入有效 DSH Session。
3. `displayText` 执行 Markdown/display 阶段正则，只用于 UI。
4. `displayText` 保持所有内容的原始相对顺序，不抽取或搬运 HTML。
5. HTML 不必来自正则：模型直接输出的 HTML 也应渲染。
6. `html` / `htm` 代码围栏，以及未标语言但内容含 HTML 标签或注释的围栏，视为 HTML。它覆盖酒馆助手以 `html>`、`<head>`、`<body` 识别完整前端页面的范围。
7. 围栏之外出现的 raw HTML 也渲染；只有普通 Markdown 时继续使用 DSH `MarkdownText`。
8. HTML 注释按浏览器语义保留但不可见，不把注释内容改写成可见文本。
9. iframe 产物不写入 Session，也不能反向修改 Session。

## 投影接口

`projectReplyLayers()` 返回：

```js
{
  sourceText,
  projectionText,
  sessionText,
  displayText,
  displayMode,       // 'markdown' | 'html'（含 HTML 的混排通过 displayParts 分流）
  displayParts: [
    { kind: 'markdown', text },
    { kind: 'html', content },
  ],
  applied: { session: [], display: [] },
  warnings: [],
}
```

`displayParts` 是临时 UI 投影，不是新的聊天权威数据：

- `markdown`：交给 DSH 原生 Markdown 组件；
- `html`：表示需要隔离解释和运行的内容。raw HTML 片段原样保留，HTML 围栏去掉围栏；两者进入同一种 iframe。`marked` 仅用于识别代码示例之外的活动 HTML，不再把普通正文编译成 iframe 文档；
- 历史显示应从 `sourceText` 和当前正则重新生成，因此关闭显示正则后可恢复原始消息。

投影版本为 `2`。旧版本 `{ mode: 'html', html }` 只作为只读兼容输入。

## DSH 接入

客户端通过正式 keyed slot 接管 Tavern 游玩消息：

```js
slots.register({
  name: 'conversation.chat.node',
  key: 'assistant-step',
  priority: -1,
}, TavernAssistantNodeView)
```

renderer 必须保持 text、reasoning、image、streaming、interrupted 和文件引用的原顺序。流式阶段使用原生安全文本，消息定稿后再切换到 display 投影。没有投影或投影版本未知时回退到 DSH 原消息。

## iframe 边界

每个 `html` part 对应消息原位置的一个 iframe：

- `sandbox="allow-scripts"`，不添加 `allow-same-origin`；
- `referrerPolicy="no-referrer"`；
- 允许 HTTPS 脚本、样式、图片、字体、媒体、连接和子页面，以承接社区卡片的远程依赖；远程 API 仍须允许浏览器跨域访问；
- 禁止 object、base 和 form；
- 不暴露 Host DOM、Cookie、DSH Session、文件系统或 Tavern Helper bridge；
- 高度上报同时校验随机 token 与 `event.source`，并设置高度上限；
- 单个 iframe 失败不能拖垮消息或会话。

这是“可信人物卡代码”的兼容环境，不是运行任意不可信网页的安全容器。相比酒馆助手无 `sandbox` 的实现，DSH 保留 opaque-origin 隔离；相比旧版 DSH 方案，网络不再默认关闭，因为 `【首页】` 案例确实依赖远程资源。

## 旧路径

- 新回复不再写 `chat.presentation` 或右侧人物卡 HTML。
- 不使用 document-wide `MutationObserver` 查找并隐藏 DSH 消息 DOM。
- 旧 `chat.presentation` 仅在缺少 `sourceText` 时合并回原消息位置，生成一次兼容投影。
- 旧持久字段暂不做破坏性迁移；新显示始终以当前 `sourceText + regex` 重算结果为准。

## 验收

- `【首页】` 经 `markdownOnly` 变成前端代码并在原位置渲染，Session 仍是 `【首页】`。
- promptOnly 结果进入 Session，但不决定玩家看到的展示结果。
- 模型直接输出的 raw HTML、HTML 代码围栏和混合 Markdown/HTML 都能渲染。
- 普通 Markdown、reasoning、图片和中断状态不退化。
- 刷新、历史重放、回退和重生成仍按 turn 找到展示投影。
- iframe 可以加载 HTTPS 社区资源，但不能访问宿主页面。
- 右侧人物卡 HTML 区和自动搬运逻辑不存在。
- 领域测试、客户端测试、全量测试、`git diff --check` 和真实浏览器案例通过。

## 本地验收记录

- 405 项自动化测试通过；
- 旧会话中的长正文与状态面板在同一消息 iframe 内按原顺序显示；
- 高度计算覆盖 `scrollHeight` 失真的人物卡样式，长内容会上限到 1200px 后在 iframe 内滚动；
- 使用运行中 iframe 的 CSP 实测从 jsDelivr `fetch` 远程 JSON 成功；
- 浏览器控制台无渲染错误。

相关文档：

- [正则三层语义备忘](regex-three-layer.md)
- [在 DSH 对话中插入 HTML](html-in-dsh-messages.md)
- [dsh-visualize HTML 嵌入机制研究](../research/dsh-visualize-html-embedding.md)
