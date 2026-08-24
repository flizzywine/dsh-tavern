# 助手正文投影与内联 HTML 改造设计

> 状态：已按本文完成第一版实现与本地验收。  
> 目标版本：dsh-tavern `0.6.x`，DSH `0.1.1-rc.2`。  
> 实现边界：HTML 消息由固定版本 `marked@16.3.0` 编译后进入 opaque-origin iframe；暂不提供 Tavern Helper Host bridge 或远程资源权限。

## 目标

本次改造只解决一件事：**人物卡原始回复继续保持原有消息结构；展示正则在原消息位置生效；正则产生的 HTML 也在助手正文中渲染。**

改造后不再：

- 根据 `<details>`、`<style>` 或完整 HTML 形状自动把内容从正文搬到右侧栏；
- 为节省上下文而把人物卡状态块从 Session 中无条件删除；
- 用 `MutationObserver` 查找 DSH 消息 DOM、隐藏原生节点并插入纯文本副本；
- 把普通助手回复伪装成工具调用。

正则语义和 HTML 渲染仍是两个独立阶段。正则决定展示文本和 Session 文本分别是什么；renderer 决定展示文本如何呈现。

## 当前实现及问题原因

当前链路如下：

```text
DSH assistant/message 原始回复
  → agent/turn-stopping
  → turn-orchestration.finalize()
  → projectReplyPresentation()
       ├─ 从正文剥离显示正则命中内容
       ├─ 自动提取完整 HTML / details / HTML fence
       └─ 返回 bodyText + presentationHtml
  → replaceAssistantReply() 把 DSH Session 回复替换为 bodyText
  → Tavern chat 保存 sourceText、bodyText 和最新 presentation
  → sessionView() 返回 replyProjections + presentation
  → Client MutationObserver 查找 turn-tail
  → 隐藏该轮原生节点，插入 textContent 纯文本
  → presentationHtml 在右侧“人物卡界面” iframe 展示
```

这里有三个建模错误：

1. **把展示投影误当成内容所有权。** HTML 只是内容格式，不表示它属于侧栏。
2. **把 display 与 prompt 投影合并成一次剥离。** `markdownOnly` 和 `promptOnly` 的目标不同，不能共享一个 `bodyText`。
3. **把 UI seam 放在 DOM 结果上。** 页面结构不是稳定 Interface；DSH slots 才是正式 seam。

直接影响包括：

- 正文、状态块和选项的原始顺序被破坏；
- HTML 注释等人物卡状态协议可能被从下一轮上下文删除；
- 展示正则只能得到纯文本副本，无法在正文渲染样式；
- 多轮投影只靠 turn 和 DOM 邻接关系匹配，分页、重生成和 DSH 升级容易失效；
- 侧栏 presentation 只保留最新一份 HTML，不能表达每条历史消息自己的展示。

## 目标数据流

```text
模型原始输出 R
  → Reply Projection Module
       ├─ sourceText = R
       ├─ sessionText = promptOnly 投影 S
       └─ displayText = markdownOnly 投影 D

S → 替换当前 DSH assistant/message → 后续模型上下文
D → 保存为不可送模的消息展示投影 → Client Tavern Assistant Renderer
R → Tavern chat 留档 → 排错、重算展示、正则配置变化后重投影
```

Client 端：

```text
conversation.chat.node / assistant-step
  → Tavern Assistant Renderer
       ├─ 没有 Tavern 投影：原生风格 fallback
       ├─ D 只有 Markdown：Markdown renderer
       └─ D 含可渲染 HTML：Tavern Frame Renderer
                                      → iframe srcDoc
```

## Module 设计

### 1. Reply Projection Module

位置：重构 `tavern-plugin/lib/domain/reply-presentation.js`。文件可以后续改名为 `reply-projection.js`，第一阶段不为改名扩大 diff。

External Interface 只保留两个操作：

```js
projectReplyLayers(sourceText, options) -> ReplyLayers
projectReplyHistory(messages, options) -> ReplyProjection[]
```

`ReplyLayers`：

```js
{
  sourceText,
  sessionText,
  displayText,
  displayMode,       // 'markdown' | 'html'
  applied: {
    session: [],
    display: []
  },
  warnings: []
}
```

Interface 规则：

- `sourceText` 永远不被修改；
- `sessionText` 只执行适用于 prompt 的规则；
- `displayText` 只执行适用于 Markdown/display 的规则；
- 两个 flag 都未启用的规则作用于两条投影，但仍保留 `sourceText` 审计副本；
- 多来源规则顺序由调用方一次性传入，Module 按数组顺序执行；
- 单条规则失败只增加 warning，当前文本交给下一条规则继续处理；
- 不再抽取 HTML 后缀、HTML fence 或 `<details>`；
- 不再把正则替换产物与未匹配正文拆成两个区域；`displayText` 必须保持完整顺序；
- HTML 判断只决定 `displayMode`，不能改变文本内容。

现有 `tavern-regex-display.js` 先作为内部实现保留，但 `renderTavernRegexDisplay()` 的“token 化替换产物、从 bodyText 删除命中源、汇总 presentationParts”逻辑应退出。深层 Interface 应建立在“对一份字符串顺序执行规则”上，而不是“正文 + presentation”上。

### 2. Turn Reply Commit Module

位置：`turn-orchestration.js` 与 `index.js` 的 DSH Adapter seam。

职责：一次性提交三种结果，避免 Host、Tavern chat 和 UI 各自重新解释同一条回复。

提交后的 Tavern assistant message 建议形状：

```js
{
  role: 'assistant',
  turn,
  text: sessionText,
  sourceText,
  displayText,
  displayMode,
  projectionVersion: 1,
  projectionWarnings: [],
  ts
}
```

规则：

- DSH `assistant/message` 写入 `sessionText`，即下一轮真实读取内容；
- Tavern chat 同时保存 `sourceText` 和展示投影；
- `replaceAssistantReply()` 改为比较并提交 `sessionText`，不再以“是否存在 presentationHtml”为条件；
- replacement 保持原 turn、step 和 source 信息，并记录原事件 seq；
- `sessionView()` 返回按 turn 对齐的完整展示投影，而不是只有 `{ turn, text }`；
- story/script 每轮只允许一个正文 assistant projection；遇到多 step 时明确选择最终正文 step并记录诊断；
- 重生成、回退和分支必须随 Story Timeline 一起替换或丢弃对应投影。

这里不新增独立数据库或新的持久化 Port。生产和测试都已经通过 Tavern chat Store 保存消息；再加一层存储 Interface 只会成为浅 Module。

### 3. Tavern Assistant Renderer Module

位置：`tavern-plugin/lib/client.js` 内新增一个纵向 Feature Module，保持当前 Web 端“能力内聚、`apply()` 只组合注册”的项目约定。

External Interface：

```js
createTavernAssistantRendererFeatureModule().register({ ctx, slots })
```

注册 seam：

```js
slots.inject('conversation.chat.node', () => slots.register({
  name: 'conversation.chat.node',
  key: 'assistant-step',
  priority: -1
}, TavernAssistantNodeView))
```

Renderer 从 `node.location.turn` 获取逻辑 turn，通过现有 `Live Tavern View` 读取该 turn 的展示投影。没有投影、非游玩模式、RPC 失败或投影版本未知时，必须渲染 `node.data.blocks` 的原生风格 fallback。

因为 DSH 没有公开导出完整 `AssistantMarkdown`，本 Module 需要保持这些行为：

- text、reasoning、image block 的原顺序；
- streaming、settled、interrupted；
- 文件 mention；
- 连续图片使用 `renderMessageImages`；
- 没有 HTML 时使用 DSH `MarkdownText`；
- 未知 block 安全显示诊断，不抛出整个消息节点。

第一版策略：流式阶段显示原生安全文本；消息 settled 后再切换到持久展示投影。这样不会对半个标签或半条正则反复创建 iframe。

### 4. Tavern Frame Renderer Module

位置：Tavern Assistant Renderer 的内部 Module，不单独暴露给其他 Feature Module。

Internal Interface：

```js
buildTavernFrameDocument({ displayText, theme, token, policy }) -> string
```

职责隐藏在 Interface 后面：

- Markdown 与 raw HTML 共同编译为一个保持顺序的完整 iframe 文档；
- 注入 DSH 主题变量和基础排版；
- 注入 CSP；
- 注入 Host 控制的高度上报脚本；
- iframe 使用 `sandbox="allow-scripts"`，但不使用 `allow-same-origin`；
- 父页面同时校验随机 token 和 `event.source === iframe.contentWindow`；
- 高度设置上下限，超出后 iframe 内滚动；
- iframe 卸载时移除监听。

若展示文本含 HTML，整条 `displayText` 进入同一 frame，避免把 CSS、标签嵌套和正文顺序再次切碎。为此需要一个明确的 Markdown-to-HTML 实现；不能直接把 Markdown 原文塞入 iframe，也不能调用会转义 raw HTML 的 DSH `MarkdownText`。具体库在实施前通过一个最小 prototype 选择，Interface 不暴露该依赖。

## HTML 能力策略

第一阶段参考 `dsh-visualize` 的隔离骨架，允许 self-contained HTML/CSS/JS 在 opaque-origin iframe 内运行，但不提供 Tavern Helper Host bridge：

- `default-src 'none'`；
- inline style/script 只在 iframe 内执行；
- `connect-src 'none'`；
- 禁止 form、frame、object、base 和顶层导航；
- 静态资源来源默认关闭；真实人物卡证明需要后，再增加按资源类别授权；
- iframe 只能向 Host 上报高度，不能读取或修改 Session；
- 单条消息 iframe 崩溃时回退显示 `displayText` 的安全文本。

这一级可以支持人物卡展示正则生成的样式和自包含交互，但不承诺 MVU、Tavern Helper、远程依赖或宿主状态写回。那些能力需要独立兼容环境，不能顺手扩大本次 seam。

## 旧逻辑删除与迁移清单

### 第一阶段保留

- `applyTavernRegexText()` 的顺序替换、flag、placement、depth、capture 和 warning 语义；
- Tavern chat 的 `sourceText`；
- `Live Tavern View` 缓存与订阅机制；
- 右侧栏中的 Guide、人物姿势、世界书与后台状态等非 HTML 能力；
- 旧 `chat.presentation` 字段的只读兼容。

### 新 renderer 验证通过后删除

- `applyReplyProjections()`；
- `replyProjectionCache` 与 `setReplyProjections()`；
- CandidateQuestion 中为投影创建的 document-wide `MutationObserver`；
- `.dsh-tavern-projected-reply` 样式；
- `revealCommentOnlyDetails()`；
- `findPresentationSuffix()` 与通用 HTML 自动搬运；
- turn finalize 中写入最新 `chat.presentation` 的 reply 路径；
- 右侧栏“人物卡界面”HTML section；
- `replaceAssistantReply()` 里“只有 presentationHtml 才替换 Session”的条件。

### 旧会话兼容

不立即删除持久化的 `chat.presentation`：

- 新回复不再写该字段；
- 有 `sourceText` 的旧消息从原文重新生成两条投影；
- 只有 `bodyText + chat.presentation`、没有原文的旧数据，按“正文后追加 legacy HTML”生成一次兼容展示，并标记 warning；
- 完成一个发布周期和真实旧会话验证后，再决定是否迁移或废弃字段。

开场白也迁移到同一消息展示投影。纯 HTML 开场不再用不可见空白代表正文并把 HTML送到侧栏；DSH Session 是否保留原文或 prompt 投影，按与普通助手回复相同的规则处理。

## 逐文件改造计划

| 文件 | 改造内容 |
|---|---|
| `domain/tavern-regex-display.js` | 收敛为纯字符串投影执行器；保留 flag/顺序/捕获与失败隔离 |
| `domain/reply-presentation.js` | 改为 Reply Projection Module；返回 source/session/display 三层，不再抽取 presentation |
| `domain/runtime-content-projection.js` | 调整调用方，开场白与运行时内容使用新的 ReplyLayers |
| `domain/turn-orchestration.js` | 同时持久化 source/session/display；停止写 reply presentation |
| `lib/index.js` | 用 sessionText 替换 DSH message；`sessionView()` 暴露按 turn 的展示投影；保留旧字段 fallback |
| `lib/client.js` | 新增 Tavern Assistant Renderer 和 Frame Renderer；注册 `assistant-step`；验证后删除 DOM 投影和右侧 HTML 区 |
| `tavern-plugin/package.json` | 声明并固定 Client renderer 使用的 DSH UI 版本边界；新增 Markdown 编译依赖时明确锁定 |
| `tests/*` | 用新 Interface 行为测试替换“内容被搬到 presentation”的旧断言，增加 slot、iframe、回放与失败回退测试 |

不在本次改造中拆分整个 `client.js`，也不顺手迁移 TypeScript/构建系统。Tavern Assistant Renderer 先作为文件内纵向 Feature Module落地，待它形成稳定第二个维护需求后再考虑物理拆文件。

## 分阶段实施

### Phase 1：纯领域投影

- 先写 `projectReplyLayers()` 的行为测试；
- 覆盖四种 `markdownOnly` / `promptOnly` 组合；
- 覆盖规则顺序、未命中正文、HTML替换、注释、失败隔离和整轮替换；
- 删除“显示规则覆盖整轮就忽略”保护：整轮 HTML 展示是合法结果；
- 暂不接 UI。

### Phase 2：Session 与持久化

- finalize 同时保存三层文本；
- DSH replacement 写入 sessionText；
- `sessionView()` 提供新版展示投影；
- 加载旧对话时验证 fallback；
- 验证下一轮模型实际读取 promptOnly 结果，而不是 displayText。

### Phase 3：正式 assistant renderer

- 注册 priority `-1` 的 `assistant-step`；
- 先实现 Markdown、reasoning、图片、streaming、interrupted parity；
- 用测试和真实浏览器确认无 Tavern HTML 时与原生 DSH一致；
- 保留旧 DOM 投影但关闭，只作为短期 feature flag 回退。

### Phase 4：iframe HTML

- 用最小 prototype 确认 Markdown + raw HTML 编译器；
- 实现 sandbox、CSP、主题、自动高度和错误回退；
- 用真实人物卡覆盖纯 HTML、正文 + 状态块、CSS、注释和自包含脚本；
- 确认内容仍在原消息顺序和宽度内。

### Phase 5：删除旧 presentation 路径

- 删除 DOM MutationObserver 投影；
- 删除右侧人物卡 HTML 展示区和自动搬运；
- 停止写 `chat.presentation`，保留只读旧会话 fallback；
- 更新架构、TODO 和正则三层文档；
- 完成全量测试、`git diff --check`、重启与浏览器真实流程验证。

每个 Phase 单独提交。任何 Phase 未通过，都不进入下一阶段；不把领域语义、Session 提交和 Client renderer 一次性混成一个不可诊断的大提交。

## 测试 Interface

### Reply Projection Module

- 输入一份 source 和规则，直接断言 source/session/display/diagnostics；
- 测试不再访问 token、presentationParts 或 HTML 抽取内部实现。

### Turn Reply Commit Module

- 使用内存 Tavern chat Store 和 DSH Session adapter；
- 断言 DSH Surface 中是 sessionText，Tavern chat 中三层文本齐全；
- 回退、重生成和分支后只保留有效投影。

### Tavern Assistant Renderer Module

- slots 注册测试：`assistant-step`、priority `-1`、卸载恢复；
- block parity 测试：text/reasoning/image/streaming/interrupted；
- 无投影与 RPC 失败 fallback；
- 不允许 document selector、MutationObserver 或隐藏原生节点。

### Tavern Frame Renderer Module

- CSP、sandbox 和 referrer policy；
- HTML 与 Markdown 顺序；
- 高度消息 token + event.source 校验；
- 高度上限、卸载清理和错误 fallback；
- iframe 内脚本不能访问 Host DOM、Session 或网络。

### 真实浏览器验收

至少选择三类真实人物卡：

1. 纯文本或 Markdown 卡：验证原生表现没有退化；
2. 展示正则生成静态 HTML/CSS 的卡：验证顺序和样式；
3. `<details>`、HTML 注释或自包含脚本状态块：验证上下文连续性和隔离。

每张卡至少走：新建会话、两轮回复、刷新、重生成、回退、分支和导出。

## 版本与失败策略

- 当前设计绑定 DSH `0.1.1-rc.2` 的 `conversation.chat.node`、`assistant-step` 和 Chat Node block 结构；
- 插件启动时检查 slot 和必要 props，能力不满足时不遮蔽内置 renderer，并记录一次明确诊断；
- renderer 自身异常必须局部退位或显示安全 fallback，不能让对话页空白；
- DSH 升级门槛增加一项 assistant renderer parity 浏览器测试；
- 长期推动 DSH 增加 `conversation.chat.assistant-body` 子 slot，届时用更小的 Adapter 替换完整节点接管。

## 本次不做

- MVU 权威状态和 JSON Patch；
- Tavern Helper Host bridge；
- 远程脚本依赖解析与授权 UI；
- 世界书正则安全运行时；
- 预设编译器；
- 全面重写 Web Client 或引入新的构建体系。

这些能力可以复用 iframe sandbox 或正则执行器的内部机制，但不能扩大本次 External Interface。

## 验收结论

只有同时满足以下条件，才能认为改造完成：

1. Session 中保存的是 prompt 投影，展示层使用的是 display 投影，原文可追溯；
2. HTML、状态块和选项保持在生成位置，不再自动进入右侧栏；
3. 普通 DSH Markdown、reasoning、图片和中断状态没有退化；
4. 删除 document-wide DOM 投影后，刷新、分页、重生成和回退仍稳定；
5. 任意单条正则或单条 HTML 消息失败，只回退该条原文，不拖垮会话。

相关文档：

- [正则三层语义备忘](regex-three-layer.md)
- [在 DSH 对话中插入 HTML](html-in-dsh-messages.md)
- [dsh-visualize HTML 嵌入机制研究](../research/dsh-visualize-html-embedding.md)
