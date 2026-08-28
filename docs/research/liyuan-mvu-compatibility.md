# Liyuan 的 MVU 与 Tavern Helper 兼容实现审计

## 结论先行

`weidu12123/Liyuan` 没有把官方 MagVarUpdate 移植为自己的权威 MVU 运行时。它采用的是三层“形状兼容”：

1. **Host 自建 MVU 状态树**：从 `[initvar]` 或脚本里的 Zod `prefault` 静态提取初值；
2. **正文后场记模型更新**：主模型不输出 `<UpdateVariable>`，另一次隐藏模型请求阅读正文并生成 Liyuan 自定义的点路径补丁；
3. **浏览器侧 Tavern Helper/MVU 垫片**：把 `getAllVariables().stat_data`、少量事件、jQuery/Lodash 和页面级脚本宿主提供给状态栏与悬浮窗。

官方 MVU 的 import 并未像 dsh-agent-rp 那样被主动删除：作者脚本会原样进入同源 iframe，带顶层 `import` 的脚本会作为 ES Module 执行，因此浏览器会**尝试**加载官方 bundle。但 Liyuan 自己的 MVU 核心不依赖这次加载；源码还明确记录，实测官方 bundle 因缺少 `Vue`/`z` 全局而失败，所以不能把“允许 import”理解为“官方 MagVarUpdate 已成功运行”。[作者脚本原样提取](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/authorScripts.ts#L59-L85)；[模块脚本加载器](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/scriptHostDoc.ts#L33-L88)；[官方运行依赖失败的源码记录](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/mvu.ts#L190-L216)。

因此，它所说的“兼容 MVU 角色卡、MVU 状态栏以及悬浮窗”，准确含义是：**支持部分 MVU 卡的数据初值、当前状态栏和部分作者前端，而不是兼容 MagVarUpdate 的完整命令、事件、Schema、变量守卫和逐消息 swipe 数据模型。** 项目发布说明确实只给出笼统兼容声明；README 同时承认完整 STscript、直接改写正文和依赖酒馆 DOM 的插件仍不兼容。[发布声明](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/docs/RELEASE-v1.5.2.md#L1-L6)；[README 兼容边界](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/README.md#L55-L70)。

## 审计范围

- 仓库：<https://github.com/weidu12123/Liyuan>
- 分支：`main`
- 锁定提交：`227c1d55dc8f5d3e95e70de6918490c34420ba25`
- 提交时间：2026-08-27 00:27:03 +08:00
- 审计方式：静态阅读源码、测试和项目文档，并运行 MVU、场记、swipe、Tavern Shim、Script Host 五组针对性测试。
- 测试结果：58 项，57 通过、1 跳过；跳过项依赖未纳入仓库的本地私有人物卡。
- 证据边界：没有在真实浏览器里导入《灯火阑珊》做端到端运行，因此不能把源码中的“真卡实测”注释当成本次独立复现。

## 总体架构

```text
人物卡 / 世界书
  ├── [initvar] YAML ──────────────┐
  ├── registerMvuSchema(prefault) ─┤ 静态提取初始树
  ├── MVU 更新规则 ────────────────┤
  ├── regex_scripts ───────────────┤ 显示面板
  └── TavernHelper scripts ────────┤ 页面级脚本 / 悬浮窗
                                   ▼
                     WorldState.mvu（权威当前树）
                                   │
主剧情模型只输出正文               │
          │                        │
          ▼                        │
隐藏场记模型：正文 + 当前树 + 规则 ─┤ 生成 mvu_patch
          │                        │
          ▼                        │
applyMvuPatch + rp-state 分支快照 ──┘
          │
          ▼
前端 postMessage { stat_data: mvu }
          │
          ▼
消息 iframe / 页面脚本 iframe
getAllVariables() + Mvu 更新结束事件
```

这是一套 **Liyuan 原生账本驱动的 MVU 前端适配**，不是原版“模型输出 MVU 命令 → MagVarUpdate 解析 → message.variables[swipe]”链路。项目源码对这个差异写得很直接：主模型的 MVU 协议条目会被剥除，状态判断交给场记，落值由自建补丁函数执行。[设计与差异说明](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/mvu.ts#L1-L26)；[主模型协议过滤](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/protocol-detect.ts#L1-L24)。

## 1. 是否真正运行官方 MagVarUpdate

### 1.1 作者脚本确实会被原样尝试执行

Liyuan 从 `extensions.TavernHelper.scripts` 或 `extensions.tavern_helper.scripts` 提取所有启用脚本，不按名字或 URL 过滤源码。[提取逻辑](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/authorScripts.ts#L37-L85)。页面级宿主逐条创建 `<script>`；检测到行首 `import`/`export` 时设置 `type="module"`，因此类似：

```js
import 'https://cdn.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';
```

会触发浏览器网络加载，而不是被 Liyuan 删除。[脚本加载器](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/scriptHostDoc.ts#L33-L88)。CSP 也明确允许 HTTP(S) 脚本和连接。[脚本帧 CSP](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/frameDoc.ts#L346-L352)。

### 1.2 但“尝试加载”不是“成功运行”

加载器在把 `<script>` append 到 DOM 后立即 `ok++`，没有等待 module 的 `load`/`error`；因此诊断里的 `ok` 只证明元素已插入，不能证明远程依赖执行成功。[加载与计数](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/scriptHostDoc.ts#L59-L76)。

更关键的是，Liyuan 的源码明确说明：真浏览器尝试加载 MVU/Zod 相关模块后分别遇到 `Vue is not defined` 和 `z is not defined`，因此它选择静态解析 Schema，而不是依赖官方插件运行。[源码记录](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/mvu.ts#L190-L216)。

**判定：**Liyuan 没有主动屏蔽官方 MVU，但也没有建立足够完整的宿主来证明它能够稳定运行。权威变量更新始终走 Liyuan 自建链路。

## 2. MVU 初始化

Liyuan 支持两类初值来源，顺序固定：

1. 世界书正文中的 `[initvar]...[/initvar]`；
2. 条目标题带 `[initvar]`、正文为裸 YAML；
3. 若二者不存在，再静态解析人物卡脚本中 `registerMvuSchema(Schema)` 的 Zod `.prefault()`/`.default()`。

`[initvar]` 解析器只实现 YAML 子集：缩进对象、标量、空对象和空数组；多行数组、锚点等高级 YAML 会被跳过。[初值发现](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/mvu.ts#L32-L55)；[YAML 子集边界](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/mvu.ts#L137-L188)。

Schema 也没有真正执行：代码只扫描 `registerMvuSchema(标识符)`，静态解释它能识别的 Zod 对象和默认值；复杂表达式会被跳过。[静态 Schema 入口](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/mvu.ts#L453-L471)。播种时 `[initvar]` 优先，Schema 默认值兜底，已有 `state.mvu` 永不覆盖。[播种语义](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/mvu.ts#L598-L627)。

服务端在读取当前状态时也会懒播种，使新会话即便尚未产生 `rp-state` 快照，状态栏仍能拿到初值。[当前状态读取](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/server/main.ts#L389-L453)。

## 3. MVU 更新：不是官方命令，而是场记模型的自定义补丁

### 3.1 主剧情模型不负责 MVU

Liyuan 会识别 `<UpdateVariable>`、`<JSONPatch>`、`[mvu_update]` 等协议信号，并把相应世界书协议条目对主模型停用；另有 `check:` 形式的更新规则也从主模型材料中摘除，改由场记读取。[协议识别](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/protocol-detect.ts#L47-L68)；[材料归属切换](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/stage/materials.ts#L243-L264)。

因此，Liyuan 并不解析主模型正文里的官方 RFC 6902/`_.set` 命令来更新变量。

### 3.2 另一次隐藏模型请求负责判断变化

主回复定稿后，`runScribeTurn` 把当前账本、MVU 树、卡作者更新规则、用户输入和助手正文交给 `sideText`，要求输出：

```json
{
  "patch": {},
  "mvu_patch": {
    "user.背包.金币": 480,
    "世界.当前地点": "裂谷城"
  }
}
```

[场记提示词](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/scribe.ts#L55-L103)；[结果解析](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/scribe.ts#L105-L164)。

Host 只实现简单的“点路径 → 完整新值”更新：自动补中间对象、允许整段替换，不支持官方 MVU 的 JSON Patch 操作集、`delta`/`insert`/`remove`/`move` 语义或数组下标。[补丁语义与边界](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/mvu.ts#L474-L530)。

### 3.3 前台/后台模型路径

MVU 变量更新明确是第二次、正文后的隐藏模型调用，不是主剧情模型同一次输出。当前实现把本轮使用的 `model` 原样传给 `#sideText`，默认关闭 reasoning，并限制到 2048 tokens；源码没有为 MVU 场记单独选择另一个模型。[调用位置](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/stage/engine.ts#L911-L945)；[旁路请求实现](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/stage/engine.ts#L1491-L1531)。

所以它属于：**同一模型、第二次后台/旁路请求、同步结算后落账**。这与 dsh-tavern 当前“纯前台单次生成”的目标不相容。

## 4. 事件、Schema 与变量守卫

### 4.1 事件只是很小的壳

iframe 里提供了一个局部 `eventOn/eventEmit` 总线，并注入：

```js
Mvu.events = {
  VARIABLE_UPDATE_STARTED,
  VARIABLE_UPDATE_ENDED,
  VARIABLE_UPDATE_FAILED
}
```

前端收到新变量后只自动触发 `VARIABLE_UPDATE_ENDED`。[事件总线](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/tavernShim.ts#L60-L90)；[变量投递与结束事件](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/tavernShim.ts#L369-L386)；[`Mvu` 壳](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/tavernShim.ts#L470-L486)。

没有找到以下官方 MVU 生命周期的实现：

- `VARIABLE_INITIALIZED`
- `COMMAND_PARSED`
- `BEFORE_MESSAGE_UPDATE`
- 可等待/可修改命令的事件链
- `getMvuData` / `replaceMvuData`
- `isDuringExtraAnalysis`

因此，事件名存在不等于生命周期兼容。

### 4.2 Schema 只取初值，不做运行期校验

`registerMvuSchema` 没有作为全局 API 注入；Liyuan 只静态读取源码里的 Schema 默认值，没有真正执行 Zod `parse`、`transform`、`refine` 或 strict 校验。[Schema 静态解析原因](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/mvu.ts#L190-L216)；[静态入口](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/mvu.ts#L453-L471)。

### 4.3 变量守卫不兼容

依赖 `COMMAND_PARSED` 拦截、修改或拒绝更新命令的“变量守卫”，在这条链路上没有执行位置：Liyuan 的场记直接生成最终路径值，然后 Host 直接写树。[场记直接落补丁](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/stage/scribe-run.ts#L77-L105)。

**对《灯火阑珊》的含义：**状态栏可能被点亮，但其变量结构脚本、Schema 转换、`COMMAND_PARSED` 守卫和更新结束后的派生逻辑不能据此视为完整兼容。

## 5. 消息、swipe 与状态权威

### 5.1 权威状态是 `WorldState.mvu`

MVU 树被存为 Liyuan 世界账本的一部分，而不是 SillyTavern 的：

```text
message.variables[swipe_id]
```

`WorldState.mvu` 的注释明确说明它复用 `rp-state` 快照、分支和叶守卫，随当前会话分支恢复。[状态定义](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/types.ts#L52-L78)。读取时从当前分支最后一条 `rp-state` 恢复，树上没有快照才回到默认状态。[分支恢复](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/stage/assemble.ts#L229-L238)。磁盘 `.liyuan-state/<sessionId>.json` 只是缓存，树上 custom entry 才是权威；落盘失败不会推翻树上状态。[场记提交](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/stage/scribe-run.ts#L87-L105)。

### 5.2 swipe 是分支语义，不是逐消息变量槽

Liyuan 的 swipe 把同一 user 下的多个 assistant 子树作为回复变体，模型只读取当前 leaf 到根的路径。[swipe 数据模型](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/swipe.ts#L1-L10)；[变体枚举](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/swipe.ts#L99-L119)。场记在异步调用前后检查 leaf；期间发生 swipe/rewind 就丢弃补丁，防止状态写错分支。[叶守卫](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/stage/scribe-run.ts#L55-L85)。

这能保证“选择哪个回复，就恢复哪个分支的当前 MVU 状态”，但不等同于原版 MVU 的逐楼层、逐 swipe `variables[]` 快照。源码也明确承认 Liyuan 只持有当前一棵树，因此只给最新消息挂 MVU 面板，历史消息不会显示各自当时的变量状态。[历史面板限制](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/mvu.ts#L690-L704)。

## 6. Tavern Helper 兼容宿主

### 6.1 页面级作者脚本

Liyuan 会运行卡/预设声明的作者脚本。一个隐藏的、长生命周期 iframe 承载整批脚本；换卡时替换 iframe，并清理作者挂到父页面顶层的 DOM。[ScriptHost 生命周期](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/components/ScriptHost.tsx#L32-L136)。脚本逐条独立注入，某条同步 append 失败不会阻止后续脚本；但 module 的异步加载错误并未被可靠计入 failed。[脚本加载器](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/scriptHostDoc.ts#L33-L88)。

### 6.2 提供的兼容面

垫片提供：

- jQuery 3.7.1；
- Lodash 常用子集；
- `eventOn/eventEmit`；
- `TavernHelper.generate/stopAllGeneration`；
- `triggerSlash` 的 `/send`、`/trigger` 和部分 Liyuan 命令；
- `getAllVariables/getVariables`；
- `global/script` 作用域变量写入；
- `toastr`、`errorCatched`、部分 util；
- 极小的 `Mvu` 对象壳。

[父页与 iframe bridge](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/tavernShim.ts#L179-L311)；[全局垫片清单](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/tavernShim.ts#L315-L340)。

它没有提供完整 `SillyTavern` 聊天镜像、消息增删改、世界书 CRUD、提示词注入、完整 slash、事件优先级/等待语义等。`getLastMessageId()` 固定返回 0，`getChatMessages()` 固定返回空数组；`stopAllGeneration()` 也是 no-op。[降级桩](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/tavernShim.ts#L218-L253)；[消息读族空桩](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/tavernShim.ts#L467-L486)。

### 6.3 变量写入是刻意受限的

`global/script` 被视为纯 UI 自留状态，写入 localStorage；缺省、chat、message 等剧情变量作用域只读，所有写操作告警后空转。[作用域分流](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/tavernShim.ts#L399-L450)。

这符合 Liyuan“剧情状态只由 agent/场记推动”的产品原则，但会直接破坏依赖 Tavern Helper 写 chat/message variables 的卡片兼容性。

## 7. 状态栏显示链路

Liyuan 自己在最新回复末尾补 `<StatusPlaceHolderImpl/>`，然后让人物卡的显示正则把它替换成完整 HTML 面板；这复刻了官方 MVU 的一个可观察结果，但不是运行官方插件完成的。[挂载点机制说明](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/mvu.ts#L629-L654)；[挂载实现](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/mvu.ts#L678-L704)。

前端把当前 `worldState.mvu` 包成 `{stat_data: mvu}`，广播给所有 iframe；iframe 的 `getAllVariables()` 读取这份镜像，并触发一次 `VARIABLE_UPDATE_ENDED`。[前端投递](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/App.tsx#L425-L459)；[iframe 接收](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/tavernShim.ts#L369-L386)。

因此它最可靠的兼容对象是：**只读 `stat_data`、轮询或监听更新结束事件、再重绘 UI 的状态栏。**

## 8. 安全与隔离

### 8.1 好的一面

- 作者脚本不在 Node/DSH 服务端执行，不直接获得文件系统权限；
- 脚本放在可整体销毁的 iframe 生命周期中；
- 静态消息 iframe 默认禁脚本，只有程序卡脚本帧使用开放 CSP；
- chat/message 变量写入被垫片拒绝。

[脚本宿主设计](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/scriptHostDoc.ts#L1-L25)；[变量写边界](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/tavernShim.ts#L336-L340)。

### 8.2 不能称为安全沙箱的部分

脚本宿主同时开启 `allow-scripts` 与 `allow-same-origin`，并且作者脚本被明确允许访问 `parent.document`，把任意 DOM 挂到 Liyuan 父页面。[同源需求](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/scriptHostDoc.ts#L8-L24)；[sandbox 配置](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/scriptHostDoc.ts#L109-L110)。CSP 又允许任意 HTTP(S) 脚本、连接、图片和媒体。[CSP](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/frameDoc.ts#L346-L352)。

这意味着被人物卡远程 import 的代码拥有接近 Liyuan Web 页面的 DOM 权限和广泛网络外连能力。iframe 能隔离局部全局变量、异常和定时器生命周期，但不能对恶意同源脚本形成可靠的权限边界。`postMessage` 多处使用 `"*"` 且没有严密校验来源，也不能视为能力安全协议。[变量广播](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/App.tsx#L437-L458)。

因此，README 的“浏览器沙箱”更适合解释为“浏览器内执行、无 Node 文件系统权限”，而不是“人物卡脚本无法影响宿主页面”。

## 9. 与 dsh-agent-rp 的简短对比

| 维度 | Liyuan | dsh-agent-rp |
|---|---|---|
| 官方 MagVarUpdate | 不屏蔽 import，但未建立成功运行证明；核心不依赖它 | 明确删除官方 MVU import，使用 Host 内建实现 |
| MVU 更新来源 | 正文后隐藏场记模型生成自定义点路径 patch | 主回复 `<UpdateVariable>`；缺失时还可额外模型补全 |
| 官方命令语义 | 不支持；自定义整值覆盖 | 支持一组 JSON Patch/MVU 操作子集 |
| Schema | 静态取 `prefault/default` 初值 | 未完整运行原版 Schema 生命周期 |
| 变量守卫 | 无 `COMMAND_PARSED`，不兼容 | 暴露事件名但 Host 未完整广播，同样不能证明兼容 |
| 状态权威 | `WorldState.mvu` + `rp-state` 分支快照 | DSH Session 的 `agent-rp/mvu-state` 事件 |
| swipe | 分支状态一致，但无逐消息 `variables[swipe]` | 回复版本绑定状态快照，但 facade 仍基本固定 swipe 0 |
| Tavern Helper 面 | 轻量 UI/read shim，无完整 `SillyTavern` | 大得多的消息、变量、世界书、提示、正则和生成 facade |
| iframe 安全 | `srcdoc` 同源，脚本可读写父 DOM，CSP 广放网络 | `data:` opaque origin，Host capability bridge，远程源受控 |

两者共同点是：**都没有证明原版 MagVarUpdate 完整运行；都选择 Host 权威状态 + 浏览器 facade；都对原版事件和 swipe 模型做了简化。**

## 10. 对 dsh-tavern“纯前台、最大兼容”路线的参考价值

### 值得借鉴

1. **页面级 ScriptHost 与消息级 HtmlFrame 分开。** 悬浮窗不应塞进某条消息气泡；换卡时整体销毁脚本宿主并清理作者 DOM。[实现](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/components/ScriptHost.tsx#L32-L136)。
2. **作者脚本逐条独立加载。** 一条脚本失败不阻塞后续脚本；classic/module 分流是必要兼容能力。[实现](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/scriptHostDoc.ts#L33-L88)。
3. **垫片必须先于人物卡脚本。** jQuery、Lodash、事件、变量读 API 和通知等宿主前提应在作者第一行代码前就绪。[实现](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/scriptHostDoc.ts#L90-L106)。
4. **状态与分支绑定，并设置叶守卫。** 异步处理期间若用户切 swipe/回档，应丢弃旧分支结果。[实现](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/src/stage/scribe-run.ts#L55-L85)。
5. **状态栏数据通过稳定的 `getAllVariables().stat_data` 投影。** 即使内部存储不同，也可以向卡脚本保持生态形状。[实现](https://github.com/weidu12123/Liyuan/blob/227c1d55dc8f5d3e95e70de6918490c34420ba25/web/src/App.tsx#L425-L459)。

### 不应照搬

1. **不要照搬后台场记更新。** 它直接违背当前“全部由前台模型完成”的兼容阶段目标。
2. **不要剥掉主模型的 MVU 协议。** 纯前台模式必须保留卡作者原本要求的 `<UpdateVariable>`/JSON Patch 输出，然后由 MVU 运行时在本轮结算。
3. **不要把 Schema 降为默认值提取。** 最大兼容应真正执行注册、校验、transform/refine，并支持相关事件。
4. **不要把 `Mvu` 做成只有三个事件名的壳。** 《灯火阑珊》的变量守卫需要 `COMMAND_PARSED` 等可干预生命周期。
5. **不要只维护当前一棵树。** 应至少把 MVU 状态绑定到每条助手消息/回复变体，以支持历史、swipe、回档和重新生成。
6. **不要以同源父 DOM 直通作为默认安全模型。** 最大兼容阶段可以提供“可信脚本模式”，但应该明确授权，并让状态 mutation 经过统一 Host Adapter；未来才能逐步收紧。

### 建议组合路线

对 dsh-tavern，Liyuan 最适合贡献的是 **前端作者脚本宿主和 UI 投影经验**；dsh-agent-rp 更适合贡献 **较大的 Tavern Helper facade、消息/世界书 API 与 Host 权威 mutation 架构**。MVU 本身则应优先尝试运行官方 MagVarUpdate：

```text
Liyuan 的页面级 ScriptHost / HtmlFrame 经验
                    +
dsh-agent-rp 的 Tavern Helper / SillyTavern facade 与 Host bridge
                    +
官方 MagVarUpdate 原样运行（不删除 import）
                    +
前台正文中的 MVU 指令在本轮结束时结算
```

如果官方 bundle 在这个兼容宿主中暴露缺失能力，就以真实报错和具体人物卡为阶梯补 facade；不应先退化为另一套自定义 MVU 实现。

## 验证说明

本次在锁定提交上运行：

```text
node --test \
  test/mvu.test.ts \
  test/stage-scribe.test.ts \
  test/tavernShim.test.ts \
  test/script-host.test.ts \
  test/swipe.test.ts
```

结果：58 项；57 通过，1 项因 clean clone 没有私有人物卡而跳过。它验证了纯函数、shim 字符串结构和分支算法，但没有验证：

- 官方 MagVarUpdate 远程 bundle 成功加载；
- 《灯火阑珊》Schema/变量守卫运行；
- 真实浏览器中的完整事件时序；
- 恶意或异常远程脚本的隔离效果；
- Liyuan UI 上的端到端 MVU 更新与 swipe 恢复。
