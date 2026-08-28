# dsh-agent-rp 的 MVU 与 Tavern Helper 兼容实现审计

## 结论先行

`hewzhew/dsh-agent-rp` 并不是把酒馆助手或官方 MagVarUpdate 原样移植进 DSH。它采用的是一套“双层兼容”方案：

1. Host 侧自己实现 MVU 初始化、JSON Patch 解析、状态持久化和回复版本绑定；
2. 浏览器侧为每个人物卡脚本建立隔离 iframe，并模拟 `TavernHelper`、`SillyTavern`、`Mvu`、变量、消息、世界书、事件、正则和生成 API。

最能说明这一点的证据是：当脚本导入官方
`MagicalAstrogy/MagVarUpdate/artifact/bundle.js` 时，解析器会把这条 import 从待执行源码中删除，而不是下载并运行它。运行时看到的 `Mvu` 对象由 dsh-agent-rp 自己注入。[源码：识别官方 MVU URL](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/tavern-script-resolver.ts#L132-L135)；[源码：删除 import](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/tavern-script-resolver.ts#L553-L581)；[测试：官方 bundle 不会进入执行计划](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/tests/frontend-regex.test.ts#L1024-L1044)。

因此，项目所说的“MVU 和底层酒馆助手兼容”应理解为：**兼容一部分公开数据结构、全局对象、函数和事件，而不是运行完整上游实现，也不是行为完全等价。**

## 审计范围

- 仓库：<https://github.com/hewzhew/dsh-agent-rp>
- 分支：`main`
- 锁定提交：`cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d`
- 提交时间：2026-08-27 11:12:21 +08:00
- 包版本：`0.0.0-rc.252`
- 许可证：MIT
- 审计方式：静态阅读源码、测试和项目文档；本报告没有把 README 声明当成运行证明，也没有对社区人物卡做浏览器端实测。

## 总体架构

```text
人物卡内 Tavern Helper 脚本
        │
        │ Host 解析 import、拉取和重写依赖
        ▼
每脚本一个隔离浏览器 iframe
        │
        │ 注入 TavernHelper / SillyTavern / Mvu facade
        │ 通过 postMessage 发出受控请求
        ▼
React Host bridge
        │
        │ /rp-tavern-variables 等私有命令
        ▼
DSH Session 事件日志
        ├── agent-rp/tavern-state
        ├── agent-rp/tavern-state-attachment
        └── agent-rp/mvu-state
```

这套设计把“兼容外观”和“权威状态”分开：脚本只在浏览器 iframe 中看到一个 SillyTavern 风格的镜像；真正的聊天、变量、世界书和 MVU 状态由 Host 校验后写入 DSH Session。

## 1. MVU：自行实现，而非运行官方 MagVarUpdate

### 1.1 初始化

Host 会从生效世界书中查找：

- 内容包含 `<initvar>...</initvar>` 的条目；
- 名称或注释包含 `[initvar]` 的条目。

内容以 YAML 解析，要求得到 JSON 兼容对象；多个初始化对象递归合并。[源码](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/mvu.ts#L51-L103)。

这实现的是初始化的常见可观察语义，但没有复用 MagVarUpdate 的初始化代码。

### 1.2 变量更新

模型回复中的完整结构：

```xml
<UpdateVariable>
  <JSONPatch>[...]</JSONPatch>
</UpdateVariable>
```

由 Host 直接解析。支持的操作为：

- `replace`
- `delta`
- `insert`
- `remove`
- `move`

路径使用 JSON Pointer，前导 `/stat_data` 会被归一化掉；整批操作先复制当前状态，再原子应用。[源码：语法解析](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/mvu.ts#L241-L345)；[源码：原子应用](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/mvu.ts#L347-L398)。

若更新失败，旧 `statData` 保持不变，并在状态快照上记录 `lastError`。MVU 的权威数据不是酒馆式 `message.variables[swipe]`，而是 DSH 事件：

```ts
agent-rp/mvu-state = {
  statData,
  updateCount,
  lastError?,
  source?
}
```

[源码：状态事件定义与折叠](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/mvu.ts#L27-L45)；[源码：从 Session 事件重建状态](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/mvu.ts#L106-L180)。

### 1.3 它目前不仅有“前台随正文输出”模式

当前项目还提供独立的正文后补全请求：如果主回复缺少 MVU 更新块，流包装器可以把当前状态、用户消息、正文和卡片规则交给另一次模型调用，并只接受规范化后的变量块。[源码：补全请求内容](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/mvu-stream.ts#L89-L127)；[源码：检测缺失并发起补全](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/mvu-stream.ts#L148-L265)。

此外，它还有一条更 DSH 原生的状态工具结算路径。因此这个项目的完整 MVU 方案已经偏向“正文与状态后台拆分”，不能直接照搬为 dsh-tavern 当前要求的纯前台兼容模式。

## 2. Tavern Helper 脚本宿主

### 2.1 运行位置

Tavern Helper 脚本不在 QuickJS 中运行，而是在浏览器 iframe 中运行。每个启用的 global、preset、character 脚本有独立 frame；iframe 使用：

```text
sandbox="allow-scripts allow-same-origin allow-forms"
src="data:text/html;base64,..."
```

[源码：实际 iframe](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/index.tsx#L11171-L11188)；[源码：data URL](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/tavern-runtime.ts#L905-L912)。

由于文档是 `data:` URL，它仍是 opaque/null origin；这里的 `allow-same-origin` 不会使脚本和 DSH Host 同源。Host 还用 CSP 默认禁止网络、对象、顶层表单提交和 Host 资源，只向经过批准的脚本、图片、样式、字体和子 iframe 来源定向开放。[源码：CSP 生成](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/tavern-runtime.ts#L793-L860)。

### 2.2 启动握手

大脚本和 Session 私有快照不会塞进 iframe URL。导航页面先启动一个很小的 loader，通过 `postMessage` 向父页面请求 bootstrap；Host 确认它是登记过的 frame 且来源为 opaque origin 后，再发送 vendor、运行时程序和快照。[源码](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/tavern-runtime.ts#L863-L902)。

### 2.3 远程模块处理

Host 用 `es-module-lexer` 静态分析 import，只允许固定 HTTPS URL和已批准来源，并限制远程源码总量。模块源码由 Host 拉取，依赖地址被改写成 frame 内 Blob URL，再在隔离 frame 中 `import()`。[源码：执行计划](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/tavern-script-resolver.ts#L44-L90)；[源码：模块执行](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/tavern-runtime.ts#L755-L819)。

例外正是官方 MagVarUpdate：其 side-effect import 被删除，改走 Host 内建 MVU facade。

## 3. 模拟了哪些全局对象和接口

项目不是提供一个空壳 `window.TavernHelper`，而是构造了相当大的兼容表面。

### 3.1 变量

提供：

- `getVariables`
- `replaceVariables`
- `updateVariablesWith`
- `insertOrAssignVariables`
- `insertVariables`
- `deleteVariable`
- `getAllVariables`

作用域包括 `global`、`preset`、`character`、`chat`、`message`、`script`。frame 内先更新镜像，再通过 `postMessage` 请求 Host 持久化。[源码](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/tavern-runtime.ts#L390-L455)。

### 3.2 `Mvu`

注入对象为：

```js
window.Mvu = {
  events: { ... },
  getMvuData(...),
  replaceMvuData(...),
  isDuringExtraAnalysis() { return false }
}
```

[源码](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/tavern-runtime.ts#L618-L618)。

这里的 `Mvu` 只是一层变量 API facade，不是完整 MagVarUpdate 实例，也没有原版设置面板；`isDuringExtraAnalysis()` 永远返回 `false`。

### 3.3 `SillyTavern` 与 `TavernHelper`

运行时构造 `window.SillyTavern`，包含聊天镜像、角色、聊天 metadata、扩展提示词、事件源、弹窗、停止生成和部分 context；随后直接设置：

```js
window.TavernHelper = window
```

也就是说，大多数酒馆助手 API 是作为 frame 的全局函数实现的，而 `TavernHelper` 只是指向这一套受限 window facade。[源码](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/tavern-runtime.ts#L618-L643)。

运行时还补了 jQuery/Lodash、Zod、YAML、Vue 等常用依赖，以及一个有限 DOM、隐藏聊天 DOM、toastr、弹窗、脚本按钮、本地存储和生成接口。

### 3.4 世界书、正则和提示注入

frame 能调用世界书查询、替换、创建、删除和绑定 API；Host 把公共酒馆字段与内部世界书结构相互转换。[源码：世界书 facade](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/tavern-runtime.ts#L406-L436)。

还提供 `injectPrompts`、`setExtensionPrompt`、预设读写、正则读写和部分 slash 命令。[源码：提示注入](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/tavern-runtime.ts#L456-L480)；[源码：正则 facade](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/tavern-runtime.ts#L496-L513)。

所有有副作用的操作最终通过不同 Host action 路由，而不是把真实 DSH 对象暴露给 iframe。例如世界书和聊天 mutation 会先校验能力类别，再串行写入 Session；变量替换也只接受固定作用域和 JSON 对象。[源码](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/index.tsx#L10430-L10588)。

## 4. 事件生命周期

frame 内维护自己的 listener map，支持：

- `eventOn`
- `eventOnce`
- `eventMakeFirst`
- `eventMakeLast`
- `eventEmit`
- `eventEmitAndWait`

事件 emit 会先通知 Host 广播给其他脚本 frame，再在本 frame 顺序执行监听器。[源码](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/tavern-runtime.ts#L594-L608)。

Host 将 DSH 投影变化翻译为酒馆事件：

- 新 user 消息 → `message_sent`
- 新 assistant 消息 → `message_received`
- assistant 生成结束 → `generation_ended`
- MVU 首次出现 → `mag_variable_initialized`，同时兼容拼写错误版本
- MVU 状态改变 → `mag_variable_update_ended`

[源码：消息事件翻译](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/index.tsx#L9829-L9868)；[源码：脚本 ready 后补发初始事件](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/index.tsx#L9989-L10014)。

重要缺口：源码虽然在 `Mvu.events` 中声明了 `VARIABLE_UPDATE_STARTED`、`COMMAND_PARSED` 和 `BEFORE_MESSAGE_UPDATE` 的名字，但 Host 的原生 MVU 更新链路没有发现对应的自动广播；它明确自动广播的只有初始化和更新结束。因此，依赖 `COMMAND_PARSED` 修改命令的变量守卫不能仅凭这个 facade 断言已经兼容。

这正是“接口名字存在”与“完整生命周期兼容”之间的区别。

## 5. 消息、变量和 swipe

### 5.1 frame 中的酒馆式镜像

`SillyTavern.chat` 会被投影成类似酒馆的结构：

```js
{
  mes,
  swipe_id: 0,
  swipes: [mes],
  variables: [message.data],
  swipe_info: [message.extra]
}
```

`getChatMessages({ include_swipes: true })` 同样返回 `swipes`、`swipes_data` 和 `swipes_info`。[源码](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/tavern-runtime.ts#L527-L571)。

### 5.2 实际并没有完整酒馆 swipe

这个结构只是兼容投影。Host 明确拒绝：

- `swipe_id !== 0`
- 多于一个 `swipes`
- 多于一个 `swipes_data`
- 多个 `swipes_info`

并且当前只允许为最新楼层保存 `data` 变量。[源码](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/tavern-chat.ts#L127-L159)；[源码：最新楼层限制](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/tavern-chat.ts#L170-L206)。

项目内部另有 DSH 回复版本系统。每个版本会关联其 Tavern state snapshot 和 MVU snapshot；切换版本时恢复对应状态。[源码](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/generation.ts#L470-L528)。这解决了“回复版本与状态一致性”，但不是对酒馆 `message.variables[swipe_id]` 数据模型的逐字段复刻。

## 6. 状态持久化方式

Tavern Helper 状态是一个完整快照，包含：

- global/preset/character/chat/message 变量；
- 按脚本 scope + script id 隔离的 script variables；
- 脚本树覆盖；
- 注入提示词；
- 状态面板；
- 隐藏消息前缀；
- 世界书覆盖、删除墓碑和绑定；
- 最后一次 mutation 的因果来源。

[源码：状态结构](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/tavern-helper.ts#L163-L231)。

每次变量或世界书操作先经过解析和限额校验，再生成 revision + 1 的新快照。[源码：初始化和跨卡保留规则](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/tavern-helper.ts#L758-L871)；[源码：mutation reducer](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/tavern-helper.ts#L1057-L1204)。

浏览器请求最终走 `/rp-tavern-variables` 私有命令进入 Host，而不是让 frame 直接改 Session。[源码](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/client/index.tsx#L13217-L13220)。

## 7. 世界书正则、显示正则与 EJS

这些能力没有混在 Tavern Helper iframe 里统一执行。

### EJS 与世界书正则

EJS 和世界书正则使用 QuickJS/WASM。EJS 每次 render 创建新的 runtime/context，并限制源码、输出、资源、内存、栈、解释器轮询和 pending jobs；世界书正则也有独立的 pattern、输入和执行限额。[源码：限额](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/ejs-template.ts#L16-L30)；[源码：独立 QuickJS 执行器](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/ejs-template.ts#L583-L681)。

它不是运行 ST Prompt Template 扩展，而是自行实现一部分 EJS 可观察语义。

### 显示/提示词正则

人物卡和预设正则走项目自己的文本投影管线：prompt-only 只影响发给模型的文本，display-only 只影响展示。这里使用 Host JavaScript `RegExp`，并对 placement、depth、禁用、无效表达式分别记录结果。[源码](https://github.com/hewzhew/dsh-agent-rp/blob/cf0a7b88438e5c6d5e4b8d7b894fb8cf0b5f438d/src/frontend-regex.ts#L150-L213)。

因此本项目实际有三种执行环境：

| 能力 | 执行环境 | 是否暴露 Host |
|---|---|---|
| Tavern Helper 人物卡脚本 | 浏览器 sandbox iframe | 否，通过 postMessage facade |
| EJS、世界书正则 | QuickJS/WASM | 否，JSON 输入输出 |
| 显示/提示词替换正则 | Host 文本投影代码 | 内部可信代码执行导入规则 |

## 8. 支持范围与明确缺口

| 项目 | 当前实现判断 |
|---|---|
| 官方 MagVarUpdate bundle 原样运行 | **否**，官方 side-effect import 被删除 |
| MVU 初始化与 JSON Patch | 支持常见子集，Host 自行实现 |
| `Mvu.getMvuData/replaceMvuData` | 有 facade |
| MVU 初始化、更新结束事件 | Host 自动广播 |
| `COMMAND_PARSED` / 更新开始完整生命周期 | 未发现 Host 自动广播，不应宣称完整 |
| 额外模型解析 | 项目有独立补全/后台路径；`isDuringExtraAnalysis()` facade 固定为 false |
| 酒馆助手脚本运行 | 支持一部分，独立浏览器 iframe |
| 任意 SillyTavern/酒馆助手 API | 不支持；只实现列出的 facade |
| DOM/jQuery | 有限兼容 DOM 和 jQuery 子集，不是 ST 页面 DOM |
| 网络 | 默认禁用；静态资源和生成能力分级授权 |
| 消息 mutation | 支持受限的 set/create/delete/rotate/hide |
| 多 swipe 与每 swipe 变量 | **不支持**，只投影 `swipe_id = 0` |
| EJS | QuickJS 中自行实现的同步/确定性子集 |
| 世界书 | 自己的 Host 引擎和受控 mutation，不是 SillyTavern 原引擎 |
| 原版 MVU 设置 UI | 不挂载 |

## 9. 对 dsh-tavern 最值得复用的设计

### 最值得复用：宿主边界，而不是它的 MVU 替代策略

dsh-agent-rp 最有价值的设计是：

```text
脚本 iframe 中模拟酒馆 API
            ↕ postMessage
Host 校验、排队、持久化
            ↕
dsh-tavern 对话与世界书
```

具体可复用四点：

1. **每个脚本独立 iframe**：一项失败不拖垮整张卡；按 character/preset/global + script id 建立身份。
2. **快照 + mutation 协议**：frame 收到只读镜像，所有写入都变成显式 RPC；Host 是唯一权威状态。
3. **统一 facade**：`SillyTavern`、`TavernHelper`、消息、变量、世界书和事件都集中在一个兼容运行时，不把兼容代码散到业务层。
4. **生命周期因果标识**：`replySeq` 把脚本 mutation 绑定到触发它的回复版本，避免切换回复后应用迟到写入。

### 不建议直接复用的部分

1. **不要照搬其“删除官方 MagVarUpdate import”策略作为第一步。** dsh-tavern 当前目标是最大兼容性优先，更合理的第一阶段是让官方 bundle 在隔离运行时中真的运行，记录它实际缺少哪些宿主能力；遇到无法支持或风险过大的行为后，再按 URL 定向替换。
2. **不要照搬后台 MVU 补全与 Agent state tool。** 当前约束是全部由前台模型完成，第一版只需让前台正文携带 MVU 更新块，并在当前回合结算。
3. **不要把 `window.Mvu` 有对象等同于完整 MVU 兼容。** 《灯火阑珊》的变量守卫很可能依赖 `COMMAND_PARSED` 等真实事件；必须以真实脚本调用清单和端到端卡片验收为准。
4. **不要把 DSH 回复版本冒充 SillyTavern swipe。** 可以第一期只支持 `swipe_id = 0`，但必须明确降级；未来若实现 swipe，需要让正文、message variables、script state 和世界书 mutation 一同分支。

### 建议给 dsh-tavern 的第一阶段结构

```text
TavernHelperRuntime（浏览器）
  ├── ScriptFrame：原人物卡脚本/原 MVU bundle
  ├── SillyTavernFacade：聊天与角色镜像
  ├── VariableFacade：作用域变量
  ├── EventBus：酒馆/MVU生命周期
  └── RPC Client：只发送结构化 mutation

TavernHelperHostAdapter（dsh-tavern）
  ├── snapshot：从当前 chat/card/worldbook 构造镜像
  ├── mutation validator：校验变量、消息和世界书写入
  ├── lifecycle：在前台回复完成后发 MESSAGE_RECEIVED
  ├── transaction：脚本结算完成后原子提交正文与状态
  └── diagnostics：逐脚本启动、错误和超时
```

第一阶段可以宽松授权受信卡片，但所有权限仍应经过 Host Adapter；这样以后收紧网络、DOM 或世界书写入时，不需要重写人物卡脚本。

## 10. 对“直接移植酒馆助手”的启示

dsh-agent-rp 证明了在 DSH 中兼容酒馆助手脚本是可行的，但它也证明“直接移植”最终仍然需要大量宿主适配：聊天镜像、变量作用域、事件翻译、世界书转换、提示注入、生成接口、持久化、UI 和权限都必须重新接到 DSH。

因此对 dsh-tavern 更准确的目标不是：

> 把酒馆助手代码复制过来。

而是：

> 尽量复用酒馆助手的脚本执行语义和原脚本，在 DSH 外面重建一套兼容宿主；第一阶段优先真的运行原版 MVU，待证据表明无法兼容时再做定向 Host 替代。

这与 dsh-agent-rp 的 iframe + facade + Host adapter 架构一致，但在 MVU 取舍上比它更偏向“原实现优先”。
