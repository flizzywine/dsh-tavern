# 持久化状态视图 Runtime 改造方案

> 状态：核心 Runtime 已实施并通过真实页面核验。依赖 Profile、历史 HTML 全量静态化和独立诊断存储保留为后续数据驱动优化。
>
> 本文只讨论前台消息中的动态状态栏。后台 Frame、后台状态栏生成与卡片专属协议不在本轮范围内。

## 一句话结论

状态栏不应继续作为“最新一条消息里的一个 HTML iframe”反复重建，而应成为每个当前游玩对话中长期存活的 `StatusViewRuntime` Module。

人物卡 HTML 和依赖只初始化一次；之后由 Host Adapter 把消息、变量和 MVU 事件以增量方式送入 iframe。只有状态栏模板本身发生变化时，才使用双缓冲方式替换 iframe。

## 目标

1. 普通变量更新不重建 iframe。
2. 新增一轮正文不重新加载 Vue、jQuery、Lodash、Zod、Tailwind 等依赖。
3. 状态栏更新期间始终保留上一份完整画面，不出现半屏、空白或闪烁。
4. 不依赖 `visual_cards`、人物卡名称或某个 MVU 实现判断状态栏。
5. 人物卡代码继续认为自己运行在 SillyTavern/Tavern Helper 宿主中，不认识 DSH 数据结构。
6. 历史正文、状态栏运行状态和 dsh-tavern 权威变量各自只有一个清晰职责。
7. 保留任意社区卡片 HTML 的兼容能力，不要求卡片改写为 DSH 专用前端。

## 非目标

- 不把任意人物卡 HTML 编译成 React 或 DSH 原生 UI。
- 不在这一阶段按源码猜测每张卡使用了哪些 JavaScript 库。
- 不复用多个对话之间的 JavaScript 全局环境。
- 不让状态栏 DOM 成为剧情、消息或 MVU 变量的权威来源。
- 不解决浏览器整页刷新后 JavaScript Realm 必须重新创建的问题；整页刷新时的目标是只创建一次，并用旧画面或占位平滑过渡。

## 改造前实现与问题

本节记录本轮改造要消除的旧行为，作为设计缘由，不再表示当前代码状态。

### 一个消息可以创建多个完整 iframe

`projectDisplayParts()` 会把正文、HTML 围栏和其他片段拆成多个展示 part；客户端随后为每个 HTML part 创建一个 `TavernMessageFrame`。

当前调用链：

```text
模型回复 / 显示正则
  → projectDisplayParts()
  → projection.parts[]
  → 每个 HTML part 一个 TavernMessageFrame
  → 每个 iframe 独立加载依赖与 Helper Context
```

正文、状态栏和空白片段因此可能同时建立两到三个独立运行环境。

相关实现：

- `tavern-plugin/lib/domain/reply-presentation.js`
- `tavern-plugin/lib/client.js` 中的 `projectionPartsOf()`、`renderTavernProjection()`

### 静态缓存没有消除初始化成本

当前 Helper 消息 iframe 默认注入：

- Font Awesome；
- Tailwind Browser；
- jQuery；
- jQuery UI 与 Touch Punch；
- Vue；
- Vue Router；
- Lodash；
- Zod。

本地静态资源缓存可以避免重复联网，但每个 opaque-origin iframe 仍拥有独立 JavaScript Realm。浏览器仍需重复解析脚本、执行模块、建立 Vue/jQuery 全局对象并解析 CSS。

因此，“把依赖提前下载好”只能优化首次网络等待，不能解决当前主要开销。真正有效的复用是让已经初始化的 iframe 持续存活。

### Helper Context 被整份复制到每个 iframe

`projectTavernHelperContext()` 当前投影全部消息、全部 swipe、各楼层变量、聊天变量和脚本变量。客户端又把完整 Context 序列化并纳入 iframe 文档 identity。

结果是：

- 多个 iframe 重复持有同一份历史；
- 每次状态变化都要重新构造和序列化完整 Context；
- Context 的普通变化可能被解释成整个 iframe 文档发生变化。

### 状态栏与消息生命周期耦合

`retainLatestMvuView()` 会找到历史中实际使用过 MVU 的可执行 HTML，再将其复制到最新助手消息的展示投影。

这个行为保证了模型漏写状态栏时仍能显示 UI，但也意味着状态栏不断从一轮消息“搬到”下一轮消息，没有独立生命周期。

### 运行诊断进入热路径

当前 iframe 会观察 DOM、console、网络和错误，并把稳定后的 DOM 序列化回聊天记录。`mvu-view-used` 上报还可能触发一次完整 Live View 刷新。

诊断能力有价值，但不应成为每次状态更新的必经路径，也不应依靠完整 DOM 快照维持状态栏存活。

### 卡片自身可能继续轮询

以《灯火阑珊》为例，状态栏同时监听消息/MVU 事件，并每四秒轮询一次变量作为兜底。宿主不能假设所有卡片都完全事件驱动。

持久化 Runtime 不必禁止这些轮询；它只需让轮询读取本地 Context 镜像，而不是每次触发服务器读取或 iframe 重建。

## 目标架构

```text
Conversation View
├── MessageHtmlFrame Module
│   ├── 历史正文 HTML
│   ├── 不拥有实时 MVU 状态
│   ├── 可见时才加载
│   └── 文档完成后保持不变
│
└── StatusViewRuntime Module（每个当前游玩对话最多一个）
    ├── Persistent iframe
    ├── Dependency Runtime
    ├── Tavern Helper Context Mirror
    ├── MVU / Message Event Dispatcher
    └── Atomic Template Replacement
                 ↕ postMessage
            Host Adapter
                 ↕
      dsh-tavern 权威消息与变量
```

### Module 1：MessageHtmlFrame

职责：渲染消息历史中的静态 HTML 表现。

Interface 只需要表达：

```text
render({ document, styleEnvironment, identity })
dispose()
```

规则：

- 默认不注入完整 Helper Context；
- 不因当前 MVU 变量变化而刷新历史 iframe；
- 使用 IntersectionObserver 延迟加载；
- 空内容不创建 iframe；
- 历史消息需要保留状态栏外观时，使用静态快照，而不是继续运行脚本。

### Module 2：StatusViewRuntime

这是本方案的核心深 Module。调用者只处理状态栏生命周期，不了解依赖加载、Context 镜像、事件兼容、双缓冲和恢复逻辑。

建议 Interface：

```text
mount({
  sessionId,
  viewId,
  document,
  templateRevision,
  dependencyProfile,
  initialContext,
  stateRevision
})

update({
  viewId,
  stateRevision,
  contextPatch | contextSnapshot,
  events
})

replaceDocument({
  viewId,
  document,
  templateRevision,
  dependencyProfile
})

dispose({ viewId })
```

Interface 不暴露 Vue、jQuery、iframe token、DOM MutationObserver 或消息存储结构。这些属于 Implementation。

### Module 3：Live View Registry

每个当前游玩对话维护最多一个活动状态视图：

```text
sessionId → {
  viewId,
  sourceTurn,
  sourcePartIndex,
  templateRevision,
  stateRevision,
  observedCapabilities
}
```

Registry 只记录身份和生命周期，不保存第二份权威 MVU 数据。

状态栏放在 Better Sidebar 已有的“酒馆状态”面板中，不占用正文消息流或 DSH 的粘滞输入区域。新消息只更新状态数据，React 不需要把 iframe 从一个消息节点移动到另一个消息节点；切换右侧标签时面板只隐藏，不销毁状态 iframe。

### Module 4：Host Adapter

Host Adapter 继续冒充 SillyTavern/Tavern Helper 宿主。

它负责：

- 首次挂载时投影一份完整 Helper Context；
- 后续只发送新增消息、swipe 变化、变量变化和生命周期 revision；
- 在 iframe 内维护同步可读的 Context 镜像；
- 继续提供同步的 `getChatMessages()`、`getVariables()` 和 `Mvu.getMvuData()`；
- 把 iframe 写操作翻译为 dsh-tavern 权威状态写入；
- 在增量 revision 断裂时自动回退到完整 Context 快照。

人物卡脚本仍然只看到酒馆形状的函数和事件。

## 如何通用识别状态栏

不能使用以下判断：

- 文本中是否存在 `<visual_cards>`；
- 人物卡是否叫《灯火阑珊》；
- HTML 是否包含某个 CSS class；
- 当前模型是否输出某个标签。

继续采用运行行为观察：

```text
HTML iframe 首次运行
  → 调用 getVariables() / Mvu.getMvuData()
  → Host 观察到 mvuViewUsed
  → 将该 document identity 提升为 Live Status View
```

首次识别允许发生一次提升和重新挂载。提升完成后，该状态视图不再跟随消息轮次重建。

若同一轮有多个 HTML part 使用 MVU，第一阶段选择最后一个成功 ready 且实际读取 MVU 的 part；未来如真实人物卡证明需要多个并存状态视图，再把 Registry 扩展为有上限的列表。不要提前为假设场景扩大 Interface。

## 文档 identity 与 revision

当前把 `content + 完整 Helper Context + styleEnvironment + turn` 共同作为文档 identity，会让状态变化升级为模板变化。

目标拆分为：

| Revision | 表示什么 | 是否重建 iframe |
| --- | --- | --- |
| `templateRevision` | HTML、脚本或模板内容变化 | 是 |
| `dependencyRevision` | 依赖清单或版本变化 | 是 |
| `styleRevision` | 必须在初始化期应用的样式环境变化 | 视情况；优先热更新 CSS 变量 |
| `stateRevision` | 消息、变量、swipe、MVU 状态变化 | 否 |
| `diagnosticRevision` | console、网络或错误信息变化 | 否 |

正常一轮游玩只增加 `stateRevision`。

## 增量 Context 协议

### 首次挂载

为保持 Tavern Helper 同步读取语义，首次挂载仍发送完整 Context：

```json
{
  "type": "host.context.snapshot",
  "revision": 41,
  "messages": [],
  "turnMessageIds": {},
  "chatVariables": {},
  "scriptVariables": {}
}
```

这是每次打开对话一次的成本，不再复制给每个消息 iframe。

### 后续更新

```json
{
  "type": "host.context.patch",
  "baseRevision": 41,
  "revision": 42,
  "operations": [
    { "kind": "message.append", "message": {} },
    { "kind": "message.variables.replace", "messageId": 8, "swipeId": 0, "variables": {} }
  ],
  "events": [
    { "name": "MESSAGE_RECEIVED", "args": [8] },
    { "name": "mag_variable_update_ended", "args": [] }
  ]
}
```

iframe 按顺序执行：

1. 校验 `baseRevision`；
2. 更新本地 Context 镜像；
3. 更新当前楼层映射；
4. 投递酒馆/MVU 事件；
5. 卡片 Vue/Pinia 自行更新界面。

revision 不连续、页面恢复或补丁失败时，iframe 请求新的完整快照。补丁失败不能清空当前 UI。

## 依赖加载策略

### 第一阶段：完整依赖只加载一次

第一阶段不急于做源码识别和按需裁剪。兼容性优先：持久状态 iframe 仍可加载现有完整依赖，但每个对话只初始化一次。

这是最大的 Leverage：不改变卡片预期环境，就能消除绝大多数重复成本。

### 第二阶段：依赖 Profile

有性能数据后再引入少量稳定 Profile：

| Profile | 内容 |
| --- | --- |
| `base` | Host Adapter、基础样式、Font Awesome |
| `helper` | jQuery、Lodash、Tavern Helper facade |
| `vue` | `helper` + Vue；卡片自行携带 Pinia 等扩展 |
| `full` | Tailwind Browser、jQuery UI、Touch Punch、Vue Router、Zod 等完整兼容环境 |

不要仅靠正则搜索源码决定 Profile。优先顺序应是：

1. 人物卡导入时保存的明确依赖元数据；
2. 已观察到的运行能力；
3. 用户/卡片声明；
4. 无法判断时回退 `full`。

### 不建议做的预加载

- 不预加载人物卡全部图片；
- 不预加载所有远程扩展；
- 不尝试在父页面创建 Vue/jQuery 后共享给 opaque iframe；
- 不使用 SharedWorker 共享 DOM 相关运行时。

父页面和 iframe 可以共享浏览器 HTTP 缓存，但不能共享已经初始化的 DOM 库对象。

## 刷新与替换策略

### 状态更新

```text
变量变化
  → stateRevision 增加
  → postMessage 增量更新
  → iframe 内部响应
  → 不修改 srcdoc
```

### 模板更新

```text
状态栏 HTML / 依赖版本变化
  → 创建隐藏的新 iframe
  → 加载依赖并发送最新 Context
  → 等待 dependency ready + DOM quiet + 首次高度
  → 一次性切换
  → 销毁旧 iframe
```

当前已经实现的原子双缓冲可保留为 `replaceDocument()` 的内部 Implementation，不再承担普通变量更新。

### 浏览器整页刷新

整页刷新无法保留旧 JavaScript Realm。目标行为是：

- 只重建一个状态 iframe；
- 恢复上次稳定高度；
- 在新 iframe ready 前保留静态占位或最后稳定快照；
- ready 后一次性替换，避免先显示半成品。

不应为了这个占位而在每次 DOM mutation 后持久化完整 DOM。

## 诊断与持久化

### 热路径只保留轻量信号

默认记录：

- 是否使用 MVU；
- document identity；
- ready/failed；
- 最后一条错误摘要；
- template/state revision；
- 加载耗时。

### 完整运行诊断按需采集

完整 DOM、console、network 和错误明细只在以下情况采集：

- iframe 初始化失败；
- 用户打开卡片调试；
- Agent 明确读取运行诊断；
- 首次识别状态视图时需要一次兼容证据。

完整诊断不应写入聊天权威消息；可放入独立、限额、可清理的诊断存储。

`mvuViewUsed` 只有从未观察变为已观察时才写入并刷新，重复上报不触发 Live View invalidate。

## 分阶段迁移

### 阶段一：削减无效刷新

状态：已完成。

范围小，不改变状态栏归属：

1. `captureDisplayRuntime()` 返回 `captured: false` 时不刷新 Live View；
2. 过滤空 HTML part；
3. 完整 DOM 诊断退出普通 mutation 热路径；
4. 缓存 `projectTavernHelperContext()`，同一 revision 不重复构造和序列化；
5. 把 `templateRevision` 与 `stateRevision` 分开，变量变化不再改变文档 identity。

验收：现有卡片行为不变；同一模板下修改变量不会创建 pending iframe。

### 阶段二：建立持久 StatusViewRuntime

状态：已完成核心路径。

1. 新建 Conversation 级固定状态视图区域；
2. 新建 Live View Registry；
3. 运行时观察到 `mvuViewUsed` 后，将对应文档提升为持久状态视图；
4. Host Adapter 首次发送完整 Context，之后发送增量；
5. 最新消息不再通过 `retainLatestMvuView()` 复制状态栏 HTML；
6. 当前双缓冲逻辑下沉为 `replaceDocument()` Implementation。

验收：连续十轮变量更新保持同一个 iframe/window 实例。

### 阶段三：历史与诊断收口

状态：状态栏相关部分已完成；任意历史 HTML 的全量静态化与独立诊断存储尚未实施。

1. 历史消息只保留正文 HTML；
2. 如需历史状态外观，生成静态快照；
3. 完整运行诊断迁移出 Chat；
4. 删除为状态栏复制服务的旧 liveness 逻辑；
5. 删除被新 Interface 覆盖的旧测试，测试改从 `StatusViewRuntime` Interface 进入。

### 阶段四：基于数据优化依赖

状态：暂不实施。当前真实页面已从“每轮重新初始化”收敛为“每个对话初始化一次”，应先采集数据再决定是否继续拆分依赖。

只有监测结果证明初始化仍是主要瓶颈时再做：

1. dependency Profile；
2. Tailwind CSS 预编译或持久 Runtime 内单次编译；
3. 初始化耗时、脚本执行耗时和首个稳定画面耗时统计。

## 测试策略

Interface 是主要测试面。

### Module 测试

- 首次 `mount()` 只加载一次依赖；
- 连续多个 `update()` 不替换 iframe；
- patch revision 断裂时请求 snapshot；
- 重复 `mvuViewUsed` 不刷新；
- `replaceDocument()` 在新 iframe ready 前保留旧 iframe；
- 过期的新 iframe ready 不能覆盖更新版本；
- `dispose()` 清理监听器、timer 和 pending RPC。

### Host Adapter 契约测试

- `getCurrentMessageId()` 随新回合更新；
- `getChatMessages()`、`getVariables()` 保持同步读取；
- `replaceVariables()` 写入 dsh-tavern 权威变量；
- MESSAGE/MVU 事件在 Context 更新后投递；
- snapshot 与同序列 patch 得到相同 Context。

### 浏览器验收

- 《灯火阑珊》打开后完整出现状态栏；
- 连续生成十轮，iframe 的 `contentWindow` identity 不变；
- 变量变化只更新需要变化的 Vue DOM；
- 不出现“半屏 → 空白 → 完整”的过程；
- 刷新页面只初始化一个状态 iframe；
- 切换 swipe、重新生成、回退和卡片编辑后状态正确；
- 普通 Markdown、普通 HTML 卡和没有 MVU 的卡不退化；
- 手机端不因隐藏的历史 iframe 持续轮询而增加明显 CPU 占用。

### 性能指标

至少记录：

- 每轮创建/销毁 iframe 数；
- 状态栏依赖初始化次数；
- `srcdoc` 总字符数；
- 首次完整画面耗时；
- 普通变量更新到稳定画面的耗时；
- Context snapshot/patch 字节数；
- 一分钟内 Live View invalidate 次数。

目标：

- 普通回合 iframe 新建数为 0；
- 普通回合依赖初始化次数为 0；
- 普通变量更新不发送完整 Context；
- 状态栏模板未变化时不执行双缓冲替换。

## 实施结果（2026-08-30）

本轮已完成：

1. `mvuViewUsed` 重复上报、空白展示 part 和普通 DOM mutation 不再触发无意义的完整刷新；
2. 服务端从消息展示投影中提取唯一的 `tavernStatusView`，不再把状态栏 HTML 逐轮复制到最新助手消息；
3. 前端在右侧“酒馆状态”面板挂载 Conversation 级固定状态区域，每个当前对话最多保留一个活动状态 iframe；
4. `stateRevision`、消息轮次和 Helper Context 变化不再进入状态 iframe 的文档 identity；
5. 首次挂载发送完整 Helper Context，后续发送带 revision 的增量 patch；revision 断裂时由 iframe 请求完整 snapshot；
6. 状态栏模板或样式环境变化仍沿用原子双缓冲替换，旧画面在新 iframe ready 前保持可见；
7. 状态栏 Runtime 关闭重复 MVU 观察和完整运行诊断，避免自身上报形成刷新回路；
8. 删除了旧的消息级状态栏 liveness 命名与复制职责。

真实页面核验结果：

- 《灯火阑珊》对话中固定状态区域完整显示；
- DOM 中只有一个 `.dsh-tavern-status-runtime` 和一个对应 iframe；
- 切换右侧面板触发普通 React 重渲染后，iframe 元素与 `contentWindow` identity 均保持不变；
- 模板 revision 与稳定高度保持不变，没有出现“半屏 → 空白 → 完整”的重新加载过程。

本轮有意不做：

- 不按源码猜测依赖，不提前引入 `base/helper/vue/full` Profile；
- 不把所有历史任意 HTML 改成静态快照；
- 不迁移全部调试诊断到新的持久化存储；
- 不实现后台 Frame 或后台状态栏生成。

## 架构不变量

1. 状态栏不是聊天消息、MVU 变量或剧情的权威状态。
2. dsh-tavern 始终拥有消息、swipe、变量和世界书的权威状态。
3. 人物卡脚本只能通过 Tavern 形状的 Host interface 操作宿主。
4. Host Adapter 是人物卡状态视图与 dsh-tavern 之间唯一公开 seam。
5. `stateRevision` 变化不能重建状态 iframe。
6. 只有 `templateRevision` 或依赖环境变化才能替换状态 iframe。
7. 历史消息 iframe 不接收当前状态更新。
8. 完整运行诊断不是展示热路径的一部分。
9. 单个状态视图失败不能阻断正文、消息发送或下一轮生成。
10. 无法增量恢复时回退完整 Context 快照，不能回退为清空 UI。

## 明确拒绝的方案

### 只增加 preload

只能减少网络等待，不能复用 JavaScript Realm，解决不了重复初始化。

### 通用 iframe 池

任意卡片可能注册全局事件、timer、Vue App 和 jQuery 插件。可靠清理比重新初始化更困难，容易产生跨卡状态污染。一个对话一个持久状态 iframe 更容易保证 Locality。

### 把状态栏全部改写为 Host React

性能最好，但会失去社区卡片 Vue、jQuery、Canvas 和任意 HTML 的兼容性。除非未来定义新的 DSH 原生卡片 UI 格式，否则不作为兼容模式实现。

### 父页面共享 Vue/jQuery

opaque-origin iframe 不能复用父页面已经初始化的 DOM Runtime；强行取消隔离会扩大宿主暴露面，也不能可靠兼容不同版本依赖。

### 永久保留每个历史状态栏 iframe

会同时保留 timer、轮询、网络和大对象，长对话内存与 CPU 持续增长。历史状态应静态化，只有当前状态栏保持活动。

## 预计收益

改造前，正常一轮可能发生：

```text
重新投影整段历史
  + 序列化完整 Helper Context
  + 建立 2～3 个 iframe
  + 每个 iframe 初始化整套依赖
  + DOM/网络诊断回写
```

改造后，正常一轮应收敛为：

```text
追加正文消息
  + 发送一份 Context patch
  + 投递 MESSAGE/MVU 事件
  + 状态栏内部更新 Vue/Pinia
```

最大的收益不是少下载几个文件，而是把“每轮完整启动一个小型前端应用”改成“应用只启动一次，之后只更新数据”。

## 相关文档

- [编排策略、酒馆脚本运行模块与 Host Adapter](orchestration-strategies-and-tavern-script-module.md)
- [回复展示与状态栏兼容](status-bar.md)
- [助手正文 HTML 渲染设计](inline-message-renderer-refactor.md)
- [《灯火阑珊》MVU 兼容链路验收](../research/lighthouse-mvu-compatibility-e2e-2026-08-28.md)
