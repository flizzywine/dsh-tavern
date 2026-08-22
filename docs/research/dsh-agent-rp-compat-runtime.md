# dsh-agent-rp 兼容运行时源码研究

研究对象：[`hewzhew/dsh-agent-rp`](https://github.com/hewzhew/dsh-agent-rp)，固定到提交 [`3dc7083`](https://github.com/hewzhew/dsh-agent-rp/tree/3dc7083dee2d1d2d943710df3bbba1667ba65408)（2026-08-22 获取）。

研究范围：QuickJS/EJS、世界书正则、失败隔离、Tavern Helper、显示正则、轻量 HTML、MVU 和 iframe/Host 边界。结论来自静态源码与仓库测试代码核查；本次没有启动完整 DSH 浏览器环境做真实社区卡验收。

## 结论

这个项目不是用一个万能沙箱承载全部兼容功能，而是拆成三条执行管线：

1. **QuickJS/WASM 管线**：同步 EJS 兼容子集和世界书激活正则。EJS 每次求值新建 runtime/context；世界书正则每次 inspection 新建一个有界 matcher。失败返回结构化结果，不向上抛成整轮异常。
2. **浏览器 iframe 管线**：每条 Tavern Helper 脚本独立 iframe；轻量 HTML 也进入无 Host 同源权限的 iframe。Host 只通过经过身份、来源、字段和权限检查的 `postMessage` 桥接状态与操作。
3. **Host 显示正则管线**：普通消息显示/提示正则直接使用 Host JavaScript `RegExp` 顺序替换，非法表达式会跳过。这一部分**不在 QuickJS 中，也没有执行中断/内存限额**。Tavern Helper iframe 内另有一份显示正则兼容实现，供脚本 API 使用。

因此 README 的“隔离的 QuickJS”对 EJS 和世界书正则成立；“隔离脚本环境中运行兼容的 Tavern Helper 脚本、显示正则、轻量 HTML 界面与 MVU 状态”是产品级概括，不应理解成这四者共用同一种沙箱。

## 1. QuickJS 中的 EJS

### 1.1 初始化与调用链

插件启动时尝试创建一次 `EjsTemplateEngine`；QuickJS WASM 模块加载失败会记录 warning，模板保留但不激活，不阻止插件启动。[`src/index.ts#L1109-L1116`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/index.ts#L1109-L1116)

每轮准备时，`prepareRoleplayTurn` 把角色名、用户名、可见消息、角色保留 transcript、Tavern 变量作用域、MVU `stat_data` 和世界书只读索引冻结成模板上下文，再创建本轮 renderer；同一个 renderer 同时交给世界书和预设/角色提示管线。[`src/roleplay-turn-plan.ts#L217-L248`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/roleplay-turn-plan.ts#L217-L248) [`src/roleplay-turn-plan.ts#L260-L286`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/roleplay-turn-plan.ts#L260-L286)

EJS 不是直接引入 npm `ejs` 后在 Host 中执行。项目自己把 `<% %>`、`<%= %>`、`<%- %>` 分段，拼成严格模式函数，并只注入 JSON 化上下文和项目定义的 helper。[`src/ejs-template.ts#L113-L186`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/ejs-template.ts#L113-L186)

### 1.2 隔离和限额

每次 `render()` 都新建并最终销毁 QuickJS runtime/context，而不是复用可被模板污染的全局环境。限制包括：

- 模板 256 KiB、输出 256 KiB；
- runtime 内存 16 MiB、栈 512 KiB；
- interrupt poll 512 次、pending jobs 1024；
- 单次 prompt/projection renderer 最多求值 256 个模板；
- 世界书资源累计读取 4 MiB、最多 128 次，并禁止递归读取仍含 EJS 的条目。

常量见 [`src/ejs-template.ts#L16-L28`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/ejs-template.ts#L16-L28)，runtime 创建、受控世界书读取、pending-job 收敛和 dispose 见 [`src/ejs-template.ts#L561-L657`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/ejs-template.ts#L561-L657)。仓库测试还直接验证 `process`、`require`、`fetch` 都是 `undefined`。[`tests/ejs-template.test.ts#L63-L69`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/tests/ejs-template.test.ts#L63-L69)

所谓“同步 EJS”更准确地说是**无 Host I/O 能力的、确定性兼容子集**。生成代码虽然用 async wrapper 并执行有限 pending jobs，但没有向模板暴露网络、文件、进程或模块加载接口；悬空 promise 最终被归为 `execution-limit`。

### 1.3 单条模板失败怎样继续

`render()` 永不把模板异常直接抛给调用者，而是归类为 `source-limit`、`syntax-error`、`runtime-error`、`execution-limit`、`memory-limit`、`output-limit`、`resource-unsupported` 或 `resource-limit`。[`src/ejs-template.ts#L92-L107`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/ejs-template.ts#L92-L107)

不同资源的降级粒度不同：

- **世界书条目**：该条 `candidate=false`，原因记为 `template-error`，并保存具体失败种类；其他条目继续 map、预算和组装。[`src/import/lorebook.ts#L254-L272`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/import/lorebook.ts#L254-L272) [`src/import/lorebook.ts#L339-L368`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/import/lorebook.ts#L339-L368)
- **预设 prompt module**：失败的 module 返回 `undefined` 被省略，同时累加 `templateFailures`；其余 modules 继续组装，EJS adapter 标记为 degraded。[`src/preset-prompt.ts#L241-L271`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/preset-prompt.ts#L241-L271) [`src/roleplay-turn-plan.ts#L192-L213`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/roleplay-turn-plan.ts#L192-L213)
- **角色提示字段**：每个系统提示/描述/性格/场景/示例/post-history 字段单独调用 renderer；失败字段变为空字符串，不会让整段角色提示构造失败。[`src/prompt.ts#L30-L34`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/prompt.ts#L30-L34) [`src/prompt.ts#L174-L215`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/prompt.ts#L174-L215)

仓库测试覆盖了无限循环模板被隔离为 `execution-limit`，而相邻正常世界书条目仍进入 prompt。[`tests/ejs-template.test.ts#L291-L315`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/tests/ejs-template.test.ts#L291-L315)

## 2. 世界书正则

### 2.1 QuickJS matcher

世界书 `useRegex` 不调用 Host `RegExp`。一个 inspection pass 创建一个 QuickJS runtime/context 和预编译的 `(pattern, flags, text) => new RegExp(...).test(text)`，整批条目共用 matcher，结束后 dispose。[`src/ejs-template.ts#L490-L559`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/ejs-template.ts#L490-L559) [`src/import/lorebook.ts#L378-L397`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/import/lorebook.ts#L378-L397)

正则限制包括模式 16 KiB、输入 512 KiB、每 matcher 最多 4096 次求值、累计模式 2 MiB、单次匹配 interrupt poll 64 次，并复用 QuickJS 的 16 MiB/512 KiB 内存栈限制。[`src/ejs-template.ts#L24-L28`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/ejs-template.ts#L24-L28) [`src/ejs-template.ts#L490-L543`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/ejs-template.ts#L490-L543)

### 2.2 失败不打断会话

matcher 初始化失败会被吞掉，系统退回“仅字面量”路径；不能化简成字面量的复杂模式得到 `regex-runtime-unavailable`。非法、超时、资源超限分别转成 entry-level `regex-invalid`、`regex-execution-limit`、`regex-resource-limit`，该条不激活，其余条继续。[`src/import/lorebook.ts#L74-L81`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/import/lorebook.ts#L74-L81) [`src/import/lorebook.ts#L121-L171`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/import/lorebook.ts#L121-L171) [`src/import/lorebook.ts#L194-L252`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/import/lorebook.ts#L194-L252)

仓库测试覆盖了灾难性回溯正则被中断，而不是交给 Host 引擎卡死。[`tests/ejs-template.test.ts#L263-L273`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/tests/ejs-template.test.ts#L263-L273)

## 3. Tavern Helper 兼容脚本

### 3.1 一条脚本一个运行时

运行时从 global/preset/character 三个 scope 收集启用脚本，然后**逐脚本异步解析、逐脚本生成 iframe 文档**。某条脚本依赖解析、权限或文档生成失败时，只把错误写进该 `TavernScriptFrame`；循环中的其他脚本继续安装。[`src/client/index.tsx#L7595-L7601`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/index.tsx#L7595-L7601) [`src/client/index.tsx#L7880-L7952`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/index.tsx#L7880-L7952)

每个脚本 iframe 使用 `data:text/html;base64` 导航，并设置 `sandbox="allow-scripts allow-same-origin allow-forms"`。由于顶层文档是 `data:` URL，它仍是 opaque origin；`allow-same-origin` 不会让它变成 DSH Host 来源。Host 只在收到 `origin === "null"` 的 bootstrap request 后，把大体积 vendor、程序和当前 Session snapshot 通过消息送进去。[`src/client/tavern-runtime.ts#L841-L874`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/tavern-runtime.ts#L841-L874) [`src/client/index.tsx#L8235-L8245`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/index.tsx#L8235-L8245) [`src/client/index.tsx#L9443-L9452`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/index.tsx#L9443-L9452)

iframe CSP 默认 `default-src 'none'`、`connect-src 'none'`；脚本、图片、样式、字体、子 iframe 按内置来源或玩家对该卡/预设/脚本的精确授权开放。[`src/client/tavern-runtime.ts#L755-L822`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/tavern-runtime.ts#L755-L822)

### 3.2 远程模块不是直接放行网络

Host 先静态解析 ESM：动态 import 必须是固定 HTTPS URL；来源必须是内置 jsDelivr 或玩家批准来源；跨来源重定向拒绝；单文件 2 MiB、全部远程脚本 4 MiB、缓存最多 32 项。Host 抓取并重写固定依赖图，iframe 内再以 blob URL 实例化。[`src/tavern-script-resolver.ts#L17-L22`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/tavern-script-resolver.ts#L17-L22) [`src/tavern-script-resolver.ts#L72-L114`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/tavern-script-resolver.ts#L72-L114) [`src/tavern-script-resolver.ts#L420-L489`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/tavern-script-resolver.ts#L420-L489)

### 3.3 兼容来自 facade，不是完整复刻

iframe 注入的是 Tavern Helper/SillyTavern 风格 facade：变量作用域、聊天、世界书、提示注入、预设、正则查询、事件、jQuery/lodash 子集、生成请求等。初始数据是 JSON snapshot；写操作必须发 `postMessage` 回 Host，由 Host 验证 event source 对应哪一条 frame，再按 action/schema/capability 执行。[`src/client/tavern-runtime.ts#L192-L250`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/tavern-runtime.ts#L192-L250) [`src/client/index.tsx#L8192-L8268`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/index.tsx#L8192-L8268)

运行异常通过 `error`/`unhandledrejection` 变成 `runtime-error`；Host 只把该脚本标为失败、清掉它的 readiness marker 并记录 warning，不结束会话或卸载别的脚本。[`src/client/tavern-runtime.ts#L720-L724`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/tavern-runtime.ts#L720-L724) [`src/client/index.tsx#L8348-L8362`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/index.tsx#L8348-L8362)

边界：iframe 没有 QuickJS 那样的硬 CPU/内存 interrupt。15 秒握手只检测“未 ready”，不能抢占一个正在浏览器线程中无限同步执行的脚本。因此这里实现的是来源/DOM/存储/能力和故障状态隔离，不是强计算资源沙箱。

## 4. 显示正则与轻量 HTML

### 4.1 普通显示正则

主显示管线将 preset regex 放在角色卡 regex 前，先跑普通规则，再跑 display-only 或 prompt-only 规则。非法表达式 `compileRegex()` 返回 `undefined`，当前脚本保持原文，reduce 会继续处理下一条；因此“非法单条正则不打断”成立。[`src/frontend-regex.ts#L155-L165`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/frontend-regex.ts#L155-L165) [`src/frontend-regex.ts#L225-L280`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/frontend-regex.ts#L225-L280)

但是它直接构造 Host `RegExp`，没有 QuickJS、超时、输入长度或资源预算。合法但灾难性回溯的显示正则仍可能阻塞 Host JS；源码也没有包住 `raw.replace()` 的总 try/catch。这和世界书正则的安全等级不同。

Tavern Helper iframe 内另外实现了 `formatAsDisplayedMessage`/`formatAsTavernRegexedString`，那份正则确实随脚本运行在隔离 iframe 内，但同样没有硬执行限额。[`src/client/tavern-runtime.ts#L546-L550`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/tavern-runtime.ts#L546-L550) [`src/client/tavern-runtime.ts#L707-L715`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/tavern-runtime.ts#L707-L715)

### 4.2 轻量 HTML

显示正则只产生字符串，不直接执行 HTML。编译器把结果切成 Markdown、完整 HTML 文档、inline HTML 三类；完整 HTML fence 和正文顺序被保留。[`src/card-display-compiler.ts#L177-L269`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/card-display-compiler.ts#L177-L269)

- 完整 HTML 文档进入 iframe，可保留脚本，但 iframe 只有 `allow-scripts`，没有 `allow-same-origin`，所以不能访问 Host DOM/存储。
- inline HTML 先经 Markdown 渲染和 DOMPurify，显式删除 `script`、`iframe`、`form`、`object`、`embed`、`srcdoc` 等主动内容，再进入同类 iframe。
- iframe 文档注入 CSP，远程资源类别按权限开放；默认连接、frame、外部脚本等关闭。

对应实现见 [`src/client/card-frame.ts#L361-L389`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/card-frame.ts#L361-L389)、[`src/client/card-frame.ts#L324-L358`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/card-frame.ts#L324-L358) 和 [`src/client/card-display.tsx#L96-L154`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/card-display.tsx#L96-L154)。

## 5. MVU 状态

MVU 的权威状态不放在 iframe DOM 中，而是 Host Session 的追加事件 `agent-rp/mvu-state`。初始值从 `[initvar]`/`<initvar>` 世界书条目解析 YAML 并合并；随后 fold 持久 MVU snapshot、Tavern Helper 的 message/chat 变量 mutation，以及当前可见 assistant reply 的 `<UpdateVariable>`。[`src/mvu.ts#L27-L31`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/mvu.ts#L27-L31) [`src/mvu.ts#L63-L131`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/mvu.ts#L63-L131)

`<JSONPatch>` 只接受 `replace`、`delta`、`insert`、`remove`、`move`，先 clone 当前 JSON，再应用全部完整 block；任一操作失败会抛弃这次候选更新，保留旧状态并记录 `lastError`，所以不会得到半更新状态。[`src/mvu.ts#L240-L301`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/mvu.ts#L240-L301)

模型正文缺少 MVU block 时，stream wrapper 用 temperature 0、reasoning off 的附加调用只补 MVU/选项结构；补充调用失败仅 logger warning，原正文照常 finish。[`src/mvu-stream.ts#L56-L100`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/mvu-stream.ts#L56-L100) [`src/mvu-stream.ts#L122-L169`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/mvu-stream.ts#L122-L169)

两类 iframe 只拿到状态副本和 facade：

- 轻前端 iframe 暴露 `Mvu.getMvuData`、局部 `replaceMvuData` 和变量桥；需要持久化的 `replaceVariables` 必须经 capability token + `postMessage` 回 Host。[`src/client/card-frame.ts#L146-L172`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/card-frame.ts#L146-L172) [`src/client/card-frame.ts#L189-L210`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/card-frame.ts#L189-L210)
- Tavern Helper iframe 的 `Mvu.replaceMvuData` 直接映射到受控 `__dshReplace`，再由 Host mutation 管线持久化；Host 在投影变化时把最新 snapshot 同步回每条脚本。[`src/client/tavern-runtime.ts#L604`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/tavern-runtime.ts#L604) [`src/client/index.tsx#L7975-L7991`](https://github.com/hewzhew/dsh-agent-rp/blob/3dc7083dee2d1d2d943710df3bbba1667ba65408/src/client/index.tsx#L7975-L7991)

## 6. README 声明与实现边界

| README 说法 | 源码结论 |
|---|---|
| 世界书、角色提示、预设的同步 EJS 在 QuickJS 中运行 | 已实现；同一 engine、不同资源入口，每次模板 fresh runtime/context。兼容的是项目自定义子集，不是任意 SillyTavern 插件环境。 |
| 单条模板失败不打断会话 | 已实现；世界书禁用该条，预设省略该 module，角色提示清空该字段。 |
| 单条正则失败不打断会话 | 对世界书正则已做强隔离和结构化降级；普通显示正则只对“无法编译”安全跳过，合法 ReDoS 没有硬保护。 |
| Tavern Helper 脚本在隔离环境运行 | 已实现为逐脚本 opaque-origin iframe + CSP + capability bridge；但没有 QuickJS 式 CPU/内存抢占。 |
| 显示正则、轻量 HTML、MVU 都在隔离脚本环境 | 说法过于合并。主显示正则在 Host；HTML 在 card iframe；MVU 权威状态在 Session，iframe 只有副本/facade；Tavern iframe 内另有显示/MVU兼容 API。 |

## 7. 对 dsh-tavern 最值得借鉴的机制

1. 不按“酒馆功能名”划一个大兼容层，而按风险划执行器：纯数据翻译、QuickJS 受限求值、iframe UI、Host 权威 mutation。
2. 所有不可信求值都返回 `ok/result + stable failure kind`，调用方在**最小资源粒度**降级：一条 world entry、一个 preset module、一个 card field、一条脚本。
3. 状态写入永远回到 Host 的 schema/capability/append-only 入口；沙箱只持副本，不拥有权威状态。
4. 资源授权绑定角色卡、预设、脚本 scope、脚本 id、资源类别和 origin，避免“一次允许，全部脚本继承”。
5. 如果照搬显示正则，需要补上 dsh-agent-rp 当前缺少的部分：不要在 Host 直接跑任意合法正则；应复用 QuickJS/RE2/worker deadline，并设置输入、输出、替换次数和累计预算。
