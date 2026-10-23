# 命定之诗交互开场接入方案

## 问题与已验证事实

本地命定之诗 v4.3.1 的默认开场是 `【首页】`，通过正则加载 `FrontEnd-for-destined-journey@1.9.16/dist/home/index.html`。

已修复预览缺少 jQuery、正式对话因 Git 引用解析失败而禁用正则两个问题。真实浏览器中，预览和正式对话都能显示首页，但“继续”被环境检查禁用，不能视为完成兼容。

首页同步调用 `getTavernHelperVersion()`，要求版本至少 4.8.19；通过 `window.top.SillyTavern.getContext().extensionSettings.EjsTemplate` 检查 EJS；通过 `waitGlobalInitialized('Mvu')` 检查 MVU。最初报错为 `getTavernHelperVersion is not defined`。现有脚本运行时另有异步版本接口，不能直接满足这个同步调用。

首页后续通过 `window.top.TavernHelper.getWorldbook/updateWorldbookWith` 读取并启停世界书条目，直接改写 `SillyTavern.chat[0].swipe_id/mes`，调用 `saveChat()`、`reloadCurrentChat()` 来切换开场。DSH 明确将 `reloadCurrentChat` 标为未支持。

## 已确认的宿主兼容原则

向卡片脚本提供酒馆宿主的接口与可观察行为，底层由 DSH 自己实现，类似虚拟机实现运行时契约。脚本不需要识别 DSH，也不需要为 DSH 修改源码。兼容范围内，同步/异步语义、返回数据、事件顺序和保存行为应与酒馆一致。不能只提供同名空函数或通过伪造就绪状态绕过检查。

内部仍使用 DSH 原生 Session、Frame 与状态管理；准备阶段对聊天和世界书的修改映射到本局草稿，正式开始时提交。宿主兼容不意味着开放顶层窗口或允许改写原生历史。尚未实现的能力应明确失败，不宣称全面不可区分。

## 实施方案

以游戏准备页承载完整开场选择，再通过现有原生初始化流程建立 Session。

1. 梳理首页实际使用的接口，建立明确的兼容能力清单。同步查询只返回已经准备好的本地状态，不把 Promise 当成版本字符串。版本接口表示已实现的兼容契约，必须由对应能力和行为测试支撑。
2. 隔离 iframe 内的兼容接口通过现有消息桥访问必要数据。只映射明确支持的酒馆对象访问，不开放整个顶层窗口，不解除 iframe 隔离。
3. 准备阶段保存临时开场选择与设置草稿。提供真实的模板解析和变量准备结果；缺失能力或初始化失败时显示具体原因，不以“检查通过”掩盖未实现功能。
4. 实现首页环境检查依赖的宿主接口，让原脚本自行完成检查，保留协议确认。不改写这张卡的检查函数，不只改版本号或按钮 disabled 属性。
5. 开场切换接入原生 opening choice；准备阶段对第一条消息的选择只更新草稿。确认开始新游戏后，统一保存获准的设置并走原生 Session 初始化，不重写已玩的历史。
6. 已经建立、但仍停在占位首页的会话，提供返回游戏准备重新选择的入口；有正式剧情的会话不能通过首页脚本覆盖第一轮。已有会话不静默重置。

## 实现边界

首页可以启停绑定世界书条目。为避免一次开局影响其他对话，准备页先暂存这些选择，完成时应用到新游戏的资源配置；这需要核对并设计与现有世界书绑定、运行时编辑接口的关系，不直接修改共享人物卡资源。

只承诺经过验证的接口与流程，不能将此改动表述为全面兼容酒馆助手或 EJS 插件。

## 验收

- 用本地合成卡验证准备页到开场选择、设置保存、原生建局的完整路径，不调用付费模型。
- 用该卡验证首页检查明确结束、协议确认后可继续、选择确实生效，不能只验证页面出现或按钮变亮。
- 验证重新打开、刷新和返回准备页不会重复保存、覆盖初始变量或修改其他会话。
- 验证普通开场、已有 MVU 初始化、回退和分叉没有回归。
- 原始人物卡与 Session 事件保持可追溯；失败时不给出“已保存/已就绪”的假成功。

## 实现进度

已实现第一阶段：准备页拥有独立的世界书草稿；宿主形状的 `getCharWorldbookNames`、`getWorldbook`、`updateWorldbookWith`、`SillyTavern.chat`、`saveChat` 和 `reloadCurrentChat` 将操作映射到草稿与原生开场选择。新局第一次持久化前保存世界书快照；稳定前缀、动态召回、EJS 世界书读取和正式脚本世界书读写均读取本局配置。没有草稿的旧对话沿用原有资源绑定。

测试覆盖草稿隔离、过期写入冲突、开场索引校验、保存与重载顺序，以及内嵌/独立世界书的运行时本局读写。尚未完成真实浏览器完整开场验收。

后续仍需完成，不能将第一阶段视为卡片兼容修复完成：

- 验证命定之诗原始环境检查、协议确认、设置选择与实际开场的完整 UI 路径。
- 已有占位首页会话返回准备页的入口。

当前不会伪造 MVU 已初始化。原有简单开场选择器仍沿用既有桥接，避免改变其行为。


## 第二阶段：环境检查（2026-09-07）

按用户最新要求，本阶段以环境检查接通为范围，后续模板行为差异留待实际使用时处理。

准备页复用现有宿主 bootstrap 和 MVU bundle loader，加载真实 MVU 模块；模板引擎通过现有 QuickJS/EJS 路径初始化初始变量。脚本变量与插件设置保存在草稿中，不写全局资源。页面同步版本接口返回兼容标识 `4.8.19`，不是实际安装了 Tavern Helper，也不代表完整实现了该版本所有接口。

远程/内嵌开场脚本通过 AST 将已知的顶层 `SillyTavern`、`TavernHelper` 对象访问映射到本地宿主。字符串、注释、局部绑定和其他顶层访问不改动；iframe 隔离保持不变。远程入口 URL 增加投影版本，避免浏览器继续使用编译前的不可变缓存。

真实 Chrome 准备页已看到三项绿色：酒馆助手正常、EJS 存在且已启用、MVU 正常；本次页面无新增脚本错误。仅验证到环境检查，未将协议按钮、最终建局或模板全文行为视为完成验收。

已记录的模板缺口：这张卡使用 `_.omit`、`_.pick`、`_.chain` 等现有模板沙箱没有完整实现的 Lodash 接口；部分可选条目还使用 `matchChatMessages` 等接口。用空状态运行当前启用条目时，`variables` 和 `[长途移动与地理参考]` 返回 runtime-error；实际剧情状态下仍需另行验证。环境“存在且已启用”只说明宿主入口与现有引擎可用。

### 正式会话复测发现（2026-09-07）

环境检查通过不代表正式开局完成。真实页面随后暴露两处不同缺口：

- 正式消息 iframe 只提供世界书全局函数，未提供 `TavernHelper` 命名空间及绑定世界书名称。首页调用 `TavernHelper.getCharWorldbookNames('current')` 因而抛错，核心/DLC 列表为空。现已补齐别名并把实际绑定世界书投影传入消息上下文；读写复用原有宿主 RPC，不改共享资源。回归测试复现原异常后通过，完整页面仍需复测。
- `Automated-script-for-destined-journey@3.4.5/dist/index.js` 在 MVU 回调中调用 `uninjectPrompts` / `injectPrompts`，现有宿主未实现，导致变量保存之前抛出 ReferenceError。不是官方 MVU 重复加载，也不是刷新能解决的问题。本次没有用空函数吞掉错误。

#### 当时待确认的方案：脚本提示词注册表

以下为当时的拟议边界；后续用户已确认并简化为原生 Frame，实施情况见第三阶段。

1. 外部脚本沿用原 API，DSH 维护会话内按 ID 替换/删除的提示词注册表。
2. `position: none, should_scan: true` 仅参与世界书扫描；有正文位置的提示进入本轮原生请求构造路径，不改已保存的历史 Frame。
3. 注册表写入与 MVU 变量结算使用同一事务，失败不留下半套状态；回退、重新生成、切换会话沿用现有 lifecycle revision，阻止旧脚本写回。
4. 准备页使用临时注册表，正式会话隔离；重载和脚本销毁清理规则需对照上游 API 契约，不把临时提示错误地永久累积。
5. 必须验证真实初始化保存成功、扫描能激活对应世界书、下一次模型请求能收到指定提示，以及删除/回退后不再注入。仅环境检查绿色不算完成。

此前仅要求先通过环境检查，本项涉及请求与状态生命周期，实施前单独确认。完整 EJS、最终自定义开局写入等既有待办仍未被本次测试证明完成。

### 第三阶段：脚本提示进入原生 Frame（2026-09-07）

用户已确认采用原生 Frame：扫描信息触发世界书，匹配正文和直接要求进入本轮；不修改世界书，也不修改旧 Frame。

实现：

- 暴露同步 `injectPrompts` / `uninjectPrompts`，按会话内 ID 替换或删除，`injectPrompts` 返回 `{ uninject }`。准备页操作保留在临时 draft。
- `none` 不直接进入 Frame；`should_scan` 默认开启。原生回合准备通过现有 `prepareWorldBookRecall` 执行关键词匹配，沿用条目上限与冷却，记录命中来源。
- `in_chat` 正文作为本轮 Guide contribution 进入原生 Frame。`role`、`depth` 保留为来源信息；按本项目约定不模拟酒馆按 depth 改写历史排列。旧 Frame 仍留在原生历史，删除只影响后续 Frame。
- `once` 在第一次成功保存本轮准备结果时消费，重复 prepare 复用已保存 Frame。未实现可执行 `filter` 回调，明确报错，不静默忽略。
- 提示词注册表进入 Story Timeline 快照及 MVU settlement effect，复用回退、分叉与过期 lifecycle 检查。正式 MVU 结算草稿中的提示与变量一起生效，结算失败不提交提示。
- 同一脚本 runtime 的 RPC 顺序执行；宿主事件串行，等待未显式 await 的提示词写入确认后才完成事件，防止串事件或迟到写入。

参考上游接口契约： https://github.com/N0VI028/JS-Slash-Runner/blob/main/%40types/function/inject.d.ts 。这是原生 Frame 适配，不是完整酒馆请求排列的复制。

验证：新增测试覆盖实际原生 prepare -> Frame -> Session adapter，扫描与直接提示分流、一次性消费及重复准备、ID 替换删除、无效批次、过期写入、原生回退、MVU effect 原子携带提示，以及并发宿主事件的写入编号。真实页面复测曾发现事件编号串用，已据此补串行处理与测试；修正后的最后一次浏览器认证页面被工具策略阻止，尚不能据此承诺这张卡的完整开局成功。

### 正式首页的“开始旅程”（2026-09-07）

用户确认是在已经创建的对话内点击。该页依次修改世界书、设置 `SillyTavern.chat[0].swipe_id/mes`、调用 `saveChat()` 和 `reloadCurrentChat()`；正式消息 iframe 缺少 `SillyTavern`，卡片自身返回 false 且只写 console，表现为无反应。

现为仅含一条原始 greeting、尚无剧情和运行中操作的会话提供受限开场宿主。保存时校验目标为人物卡现有开场，把当前绑定的本局世界书复制到准备草稿；重新加载映射为现有 Conversation Lifecycle 的新开局流程。目标 Session 使用选定开场和世界书设置。原 Session 保留，不对其 Event Log 或正文做原地替换。

准备 ticket 绑定原 Session 与 lifecycle revision，创建前重新检查源仍处于开场阶段。前端只接受同一消息 iframe 已保存的 ticket，重复开始调用共用 Promise。保存/创建失败上报可见错误。没有给普通正式消息开放任意 saveChat 正文改写。

新增集成测试执行生成消息 iframe 的真实开场桥、准备草稿及原生 Conversation Lifecycle，验证新 Session 打开、世界书选项携带、原历史未改、重复点击、已有剧情拒绝与伪造开场拒绝。完整实机页面仍需用户刷新后确认；浏览器认证页面此前被工具安全策略拒绝，未绕过该限制。

### 准备页的脚本楼层与聊天数据（2026-10-24）

报错来源是准备页的能力白名单：脚本在开场预览里调用 `createChatMessages` 与 `saveChat`，落到宿主即 `createTavernHelperMessages` 与 `saveTavernChatData`，此前直接在 `callOpeningRuntime` 末尾以“准备阶段暂不支持此宿主操作”拒绝，向导型开场因此停在初始化。

现在两项都按同一原则映射到本局草稿，不写任何共享资源，也不改原生历史：

- `createTavernHelperMessages` 复用正式会话的 `appendTavernHelperMessages`，楼层以 `tavern-helper` 身份（`tavernRole` 保留 system/assistant/user）追加到草稿，只允许落到末尾，`insert_before` 与非法 role 明确报错。
- `saveTavernChatData` 复用 `validateChatPluginRequest` 与 `applyChatPluginData`：开场白的 `tavernPluginData`、当前变量快照与聊天 `tavernPluginMetadata` 写入草稿，返回新的 `context`，脚本可在下一次调用里读到新状态。
- 草稿自 `_storageRevision: 1` 起记录每次写入的快照（最近 16 版），保存请求必须命中其中的版本，否则提示重新打开准备页；跨聊天、跨 lifecycle 的请求一律拒绝。

建局时上述内容一并提交：开场白带插件数据，聊天元数据进入新局，脚本预写的楼层排在开场白之后、开局系统楼层之前。系统楼层仍由 `applyOpeningCommand` 追加，因此“设定在系统位置、场景楼层在前”的顺序不变；已存在的会话不会补写这些草稿楼层。

测试：`tests/opening-preparation-chat-data.test.mjs` 覆盖楼层追加与顺序、非法 role/insert_before、插件数据与元数据往返、过期版本与错聊天拒绝，以及准备页草稿直接建局的继承路径。

### 开局命令先记录后开始（2026-10-24）

向导卡把开始拆成两步是常态。大凉龙虎传 v4.1 的写法是 `await triggerSlash('/send ' + txt)` → `await DSHOpening327.persist()` → `await triggerSlash('/trigger')`，其中 persist 要把预设、门派写进本局变量。旧实现在第一句就把单独的 `/send` 折成“/send 文本 | /trigger”并立刻建局，预览 iframe 在 persist 之前卸载，卡固有问题因此永远丢数据。

现在的分工是：单独的 `/send 文本` 与 `/sys 文本` 只把内容记进草稿（`draft.pendingOpening`），返回 `{ deferred: true, input: '' }`，页面继续挂着，卡的 persist 与建局前脚本楼层照常写草稿；下一条 `/trigger` 才用 `applyPendingOpeningCommand` 合成开始命令：留住的 `/send` 文本成为首轮输入，留住的 `/sys` 文本成为开局系统楼层。

- 显式管道优先：`/sys 文本 | /trigger`、`/send 文本 | /trigger`、`/cut 0` 组合不再看草稿里留的内容，写什么就是什么。
- 调用串行：`sourceDocument.openingCommandQueue` 让卡的连续调用按顺序结算；`openingCommandStarted` 保证只建一局，重复 `/trigger` 返回同一结果。
- 兜底：只发 `/send` 却从不发 `/trigger` 的卡（如无限回廊 9.10）不会卡住——页面安静 2 秒后按记下的文本开局，这正是 SillyTavern 里 `/send` 的行为；期间真 `/trigger` 到了就按它走，仍然只开始一次。
- 宿主窗口的观察器：`window.parent.MutationObserver` 属于宿主领域，拿不到沙箱里的补丁。`小手机v9` 正是用它观察 `window.parent.document.body`，于是宿主节点代理直接进了原生构造器，报“parameter 1 is not of type 'Node'”。兼容窗口现在对 `MutationObserver`、`IntersectionObserver`、`ResizeObserver` 统一套一层解包，取不到合法节点时改为观察文档根。

测试：`tests/tavern-opening-slash-bridge.test.mjs` 覆盖单独 `/send`、单独 `/sys`、显式管道优先、重复 `/trigger` 只提交一次与其余命令拒绝；`tests/opening-preparation-chat-data.test.mjs` 覆盖草稿里的“先记录后开始”以及两步之间继续保存插件数据。
