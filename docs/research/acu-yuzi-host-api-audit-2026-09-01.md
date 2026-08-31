# ACU 数据库、玉子手机：DSH 宿主兼容性审计

> 更新说明：前半部分保留最初审计快照；当前实现进度见文末各批实现，最新为“第三批实现”。不能把历史缺失项直接当成当前状态。
> 更新：下文保留首次审计快照；本轮实现及验证结果见文末“首批实现”。不能再把原始差异表当作最新状态。

日期：2026-09-01。范围：研究宿主依赖及现有缺口，不修改插件或 DSH 代码，不安装插件，不调用真实模型，不操作用户聊天数据。

## 结论

方向成立：以实际插件为样本，抽取共同宿主契约，再对接 DSH 已有能力，比按插件名称逐个重写更可持续。但目前只能确认 DSH 有一部分酒馆助手脚本能力，不能认定 ACU 或玉子手机能够直接、完整运行。

现有问题包括接口查找入口不同、数据保存占位、世界书写入范围不足、生成和事件契约未开放，以及脚本窗口的权限和共享环境不同。给缺失函数补同名外壳，无法解决这些问题。

这不是全部酒馆 API 的清单，也不是覆盖率统计。下列条目来自两个固定版本的实际调用点，区分核心路径与可选功能；未声称穷尽动态调用、远程资源和所有插件组合。

## 版本及证据边界

| 项目 | 审计版本 |
|---|---|
| ACU 数据库 | `e6f8ef383f306700736e9cd6b18e3927f963910c`，SP·数据库 9.1 |
| 玉子手机 | `198a6e53279594213a95f8725f96d66f08d8ba69`，发布标签 y40；manifest 版本 2.2.0 |
| dsh-tavern | 起始 HEAD `e7b5a01194b0d0d0a510b89ab658d118650722af`；核验结束 HEAD `dbf9adde1b77dadecda6efb5b9e9876e99d8997b` |

两个上游仓库的 main 在审计时与所列提交一致。DSH 工作区有其他工作的未提交修改，审计期间也出现了并发提交；已检查本报告涉及的兼容层实现未因此改变。本次只新增这份研究文档，未提交、撤销或覆盖其他改动。

ACU 审计对象是最新仓库，不是用户早先上传的旧“数据库-v2.json”。玉子手机是 yuzi83/st-yuzi-phone，不是绘梨衣卡里的 phone-ctn 手机。两者都区分原生扩展入口与酒馆助手加载入口：能执行助手加载脚本，不等于实现了 SillyTavern 原生扩展安装机制。

证据分为源码核对、现有单元测试、隔离探针。没有进行真实浏览器中两个插件的端到端运行，也没有验证模型请求、刷新恢复或全部交互正常。

## 宿主能力差异表

“部分”表示存在实现但范围或行为不足；“占位”表示名字存在却未完成对应操作；“缺失”限定为本次检查的 DSH 脚本宿主接口和路由。

| 宿主能力及代表接口 | 插件用途 | DSH 现状 | 影响与优先级 |
|---|---|---|---|
| 通用插件加载、生命周期 | 加载 ACU、玉子脚本及资源 | 有模块脚本顺序加载、错误隔离；但入口受 `chat.mvu.enabled` 控制，未见对应的原生扩展安装契约 | P0：普通非 MVU 资产不能保证进入脚本运行环境 |
| `window.TavernHelper` | ACU、玉子查找酒馆助手能力 | 缺失该命名空间；有一批同名全局函数 | P0：函数已有也可能无法被插件发现 |
| `SillyTavern.getContext()` / 全局 `getContext()` | 当前聊天、角色、设置、事件和服务入口 | 缺失；提供的是一个较小的扁平 `SillyTavern` 对象 | P0：玉子的 context bridge 无法取得预期上下文 |
| `chatId`、`chatMetadata`、`updateChatMetadata`、`name1`、角色/群聊身份 | 按对话隔离表格、手机会话和存档 | `getCurrentChatId()`、`name2`、当前角色读取有实现；其他字段缺失或为空数组/常量 | P0：不能把固定 `characterId:0` 等当作真实身份 |
| `getChatMessages`、`getLastMessageId` | 读取故事和当前楼层 | 全局函数存在；消息字段、过滤、范围语义是子集 | 部分：需要核对双方使用的消息结构，而非只核对函数名 |
| 可修改的 `context.chat` + `saveChat()` | ACU 把 `TavernDB_ACU_*` 写入消息并保存 | `chat` 每次读取重新投影对象；`saveChat()` 只返回 true；自定义消息字段没有保存桥 | P0：数据可在下一次读取就消失，且没有报告保存失败 |
| `setChatMessages`、删楼、停止生成 | 编辑消息、清理流程、停止任务 | 全局 `setChatMessages` 只支持部分内容/变量/swipe 修改；缺 `SillyTavern.setChatMessages`、`deleteLastMessage`、`stopGeneration` 等入口 | 部分/缺失：不能把已有局部修改能力当成完整聊天操作 |
| `extensionSettings` + `saveSettingsDebounced()` | 保存插件配置 | settings 是当前脚本环境内对象，保存函数为空 | P0：设置没有接入持久化 |
| `getVariables`、`insertOrAssignVariables`、`updateVariablesWith` | 玉子变量面板及通用脚本数据 | message/chat/script 有真实写入桥；其他变量作用域不支持；部分写法提前返回 | 部分：玉子通过 Helper 命名空间调用仍受入口缺口阻挡；还需保证 await 的完成含义 |
| 新旧世界书读取 API | 两者读取世界书、角色绑定 | 有 `getWorldbook`、`getWorldbookNames`、`getCharWorldbookNames` 等；仅当前绑定世界书；旧 schema 转换不完整 | 部分：新旧 API 不能仅做名字别名 |
| `create/set/deleteLorebookEntries`、`create/deleteWorldbookEntries`、`replaceWorldbook` | ACU 创建、更新、删除数据库投影；玉子写入 QQ 投影 | 上述全局接口未开放；已有 `updateWorldbookWith` 明确拒绝条目数量变化 | P0：无法完成一般世界书增删流程 |
| `loadWorldInfo` + `saveWorldInfo` | 原生 ST 兼容路径；玉子 QQ 世界书网关 | 仅有不完整读取投影，缺 `saveWorldInfo` | P0：不能借原生 ST 路径绕过前一项 |
| 关键词、位置、深度、概率、递归等世界书字段 | 控制哪些内容进入模型及插入位置 | 写回仅处理名称、内容、启用、策略类型；其余字段修改未生成更新操作 | P0：保存文字成功，也不代表后续模型能按预期读到 |
| `eventSource`、`eventTypes`，on/off/once/makeFirst/makeLast/emit | 两者订阅宿主生命周期、控制回调顺序 | 有独立的全局 eventOn/eventOff/eventEmit；缺 ST eventSource/eventTypes；eventMakeFirst 等同普通注册 | P0：插件注册入口和顺序契约都不完整 |
| 生成前/后、停止、消息渲染、聊天切换事件 | 自动填表、发送前召回、手机刷新及清理 | 有部分消息/切换事件；缺关键生成事件；现有 MESSAGE_RECEIVED 与官方 MVU 结算绑定 | P0：不能把后台 MVU 结束直接当作所有插件期待的正文生成结束 |
| `generateRaw`、`generate`、连接配置服务 | ACU 请求填表/总结；部分生成拦截逻辑 | 未向脚本暴露对应接口 | P0/P1：按选用的 AI 后端而定；DSH 有生成能力不等于插件能调用 |
| `triggerSlash` / `executeSlashCommandsWithOptions` | ACU 基础探测及 `/profile` 等调用 | 缺失 | P0：ACU 当前启动最低检查包含 triggerSlash |
| Slash 注册/注销、命令注册表 | 玉子可选命令入口 | 缺失通用注册接口；玉子自带部分本地降级 | P1：不应把这个可降级点夸大为整部手机必然失败 |
| ST HTTP 生成、状态、设置和文件路由 | 两者选择的后端及附加能力 | 未在仓库中找到对应 ST 兼容路由；只有 DSH 自己的服务协议 | 核心后端路径与可选功能分别补，不能只改 URL |
| 跨窗口共享对象、DOM、IndexedDB | ACU 发布对象/挂载 UI；玉子读 ACU、保存 QQ 数据 | 脚本共用 iframe，但默认 sandbox 只有 allow-scripts；无通用跨窗口兼容契约；localStorage 错误时仅内存兜底 | P0：可见性、持久化和权限是宿主契约的一部分 |
| Popup、toastr、页面菜单和输入框 | 插件设置、提示及宿主 UI 钩子 | Popup 简化；toastr 只写控制台；脚本文档只预设少数隐藏容器 | P1：代码加载完成不等于 UI 可见可操作 |

P0 表示建立基本运行闭环时优先处理，并非表中每个可选 API 都必须先全部实现。

## 最值得注意的四个具体问题

### 1. 入口不一致不能靠插件自行发现

玉子的消息和变量桥查找 `window.TavernHelper` 或 context 内的 TavernHelper，不会自动使用 DSH 的同名独立全局函数。玉子的世界书方法有额外全局回退，因此不同能力不能一概而论。

ACU 自带兼容后端，也不能简单说“没有 TavernHelper 就不能运行”。但它的原生后端最低条件包含 chat、loadWorldInfo、saveWorldInfo、executeSlashCommandsWithOptions；DSH 缺后两项，因此这条回退也不满足。

来源：[玉子 Helper bridge](https://github.com/yuzi83/st-yuzi-phone/blob/198a6e53279594213a95f8725f96d66f08d8ba69/modules/integration/tavern-helper-bridge.js#L11)、[玉子 context bridge](https://github.com/yuzi83/st-yuzi-phone/blob/198a6e53279594213a95f8725f96d66f08d8ba69/modules/integration/context-bridge.js#L5)、[ACU 启动探测](https://github.com/AlbusKen/shujuku/blob/e6f8ef383f306700736e9cd6b18e3927f963910c/src/presentation/triggers/settings-ui-sync/settings-ui-connect.ts#L101)、[ACU 原生后端最低条件](https://github.com/AlbusKen/shujuku/blob/e6f8ef383f306700736e9cd6b18e3927f963910c/src/shared/host-compat/native-st-backend.ts#L355)、[DSH 接口实现](/Users/cf/Workspace/dsh-tavern/tavern-plugin/lib/client.js:1762)。

### 2. chat 的可变引用也是 API

ACU 的消息仓库直接给消息增加 `TavernDB_ACU_IsolatedData` 等字段，再由宿主 saveChat 保存。仅把 DSH 消息转换成一个临时数组，不具备同样的行为。

需要支持这种修改的保存和回读，但不要求把 DSH 内部对象直接暴露给插件。可在兼容层维护受控的聊天视图及提交协议；保存失败必须能被调用者识别。

来源：[ACU 消息仓库](https://github.com/AlbusKen/shujuku/blob/e6f8ef383f306700736e9cd6b18e3927f963910c/src/data/repositories/chat-message-data-repo.ts#L817)、[ACU 保存网关](https://github.com/AlbusKen/shujuku/blob/e6f8ef383f306700736e9cd6b18e3927f963910c/src/data/gateways/chat-gateway.ts#L64)、[DSH saveChat 和 chat getter](/Users/cf/Workspace/dsh-tavern/tavern-plugin/lib/client.js:1972)、[DSH 消息投影](/Users/cf/Workspace/dsh-tavern/tavern-plugin/lib/domain/tavern-helper-context.js:43)。

### 3. 世界书兼容要一直验到实际模型输入

现有更新允许改文字，但不能增加/删除条目，也没有写回关键词和插入位置。ACU 和玉子产生世界书内容后，DSH 还必须遵循对应激活和排序语义，让模型在正确一轮读到它。

因此验收应从插件写入开始，检查保存、刷新后回读、关键词命中，以及最终发送给模型的内容。单独测试“函数没有报错”不够。

来源：[DSH 世界书写回限制](/Users/cf/Workspace/dsh-tavern/tavern-plugin/lib/domain/tavern-helper-worldbook.js:70)、[玉子世界书读写网关](https://github.com/yuzi83/st-yuzi-phone/blob/198a6e53279594213a95f8725f96d66f08d8ba69/modules/qq-v2/worldbook/st-gateway.js#L67)、[ACU 新旧世界书兼容](https://github.com/AlbusKen/shujuku/blob/e6f8ef383f306700736e9cd6b18e3927f963910c/src/shared/host-compat/tavern-helper-compat.ts#L79)。

### 4. 共享和隔离需要一起设计

ACU 在宿主窗口设置实例标记并发布服务；玉子读取 `parent.AutoCardUpdaterAPI`。这部分是插件之间的依赖：**AutoCardUpdaterAPI 应由 ACU 自己提供，不应由 DSH 重写数据库业务。** DSH 负责提供可用的加载、共享、发现和清理环境。

默认 opaque-origin iframe 会限制父窗口访问和浏览器存储。DSH 的 trustedCardMode 去掉该 sandbox，但这不补全 API，也不应作为未经评估的默认兼容方案。还要明确哪个插件能接触哪些聊天、设置、文件及网络能力；关闭脚本或切换聊天时如何注销监听、清理实例。

来源：[ACU 运行环境与实例标记](https://github.com/AlbusKen/shujuku/blob/e6f8ef383f306700736e9cd6b18e3927f963910c/src/shared/runtime-env.ts#L43)、[玉子数据库服务发现](https://github.com/yuzi83/st-yuzi-phone/blob/198a6e53279594213a95f8725f96d66f08d8ba69/modules/phone-core/db-bridge.js#L7)、[玉子 IndexedDB 存储](https://github.com/yuzi83/st-yuzi-phone/blob/198a6e53279594213a95f8725f96d66f08d8ba69/modules/qq-v2/storage/state-store.js#L235)、[DSH iframe 权限](/Users/cf/Workspace/dsh-tavern/tavern-plugin/lib/client.js:2287)。浏览器权限影响为代码与浏览器规则的推断，本次未做真实浏览器复现。

## 需要纳入契约的事件和 HTTP 路径

ACU 实际注册包含：CHAT_CHANGED、CHAT_DELETED、GROUP_CHAT_DELETED、MESSAGE_SENT、MESSAGE_DELETED、MESSAGE_SWIPED、GENERATION_STARTED、GENERATION_STOPPED、GENERATION_ENDED、GENERATION_AFTER_COMMANDS、CHAT_COMPLETION_SETTINGS_READY。它还会 emit MESSAGE_UPDATED。玉子 event bridge 另提供 USER_MESSAGE_RENDERED、CHARACTER_MESSAGE_RENDERED、MESSAGE_RECEIVED、MESSAGE_UPDATED、CHAT_CREATED 等；bridge 中存在不等于每个功能都无条件依赖该事件。

应核对事件载荷、异步监听是否等待、回调优先级，以及发送、重生成、删除、切换聊天、停止生成时的先后关系。DSH 当前采用大写事件字符串，玉子还有 ST 字符串回退；需要统一映射，不能让两个互不相通的事件总线同时存在。

来源：[ACU 生命周期](https://github.com/AlbusKen/shujuku/blob/e6f8ef383f306700736e9cd6b18e3927f963910c/src/presentation/bootstrap/init.ts#L175)、[玉子事件桥](https://github.com/yuzi83/st-yuzi-phone/blob/198a6e53279594213a95f8725f96d66f08d8ba69/modules/integration/event-bridge.js#L21)、[DSH 事件全局接口](/Users/cf/Workspace/dsh-tavern/tavern-plugin/lib/client.js:1863)、[DSH MVU 事件所有权](/Users/cf/Workspace/dsh-tavern/tavern-plugin/lib/domain/round-history.js:172)。

| 路径 | 使用方与条件 |
|---|---|
| `/api/backends/chat-completions/generate`、`/status` | ACU 多种 AI 请求路径；玉子本地后端。选用其他后端时依赖可能不同 |
| `/api/settings/get` | ACU 原生 ST 世界书后端读取列表/绑定 |
| `/api/characters/chats` | 两者枚举角色历史聊天，属于跨聊天功能 |
| `/api/files/upload`、`/delete` | ACU 向量索引文件存储等附加功能 |
| `/api/images/upload`、`/delete` | 玉子图片/文件桥 |

来源：[ACU AI 调用](https://github.com/AlbusKen/shujuku/blob/e6f8ef383f306700736e9cd6b18e3927f963910c/src/service/ai/api-call.ts#L242)、[ACU 设置读取](https://github.com/AlbusKen/shujuku/blob/e6f8ef383f306700736e9cd6b18e3927f963910c/src/shared/host-compat/native-st-backend.ts#L83)、[ACU 文件存储](https://github.com/AlbusKen/shujuku/blob/e6f8ef383f306700736e9cd6b18e3927f963910c/src/data/storage/vector-index-st-files-storage.ts#L367)、[玉子生成后端](https://github.com/yuzi83/st-yuzi-phone/blob/198a6e53279594213a95f8725f96d66f08d8ba69/modules/qq-v2/request/backend-proxy.js#L3)、[玉子图片桥](https://github.com/yuzi83/st-yuzi-phone/blob/198a6e53279594213a95f8725f96d66f08d8ba69/modules/integration/image-file-bridge.js#L305)、[玉子历史聊天](https://github.com/yuzi83/st-yuzi-phone/blob/198a6e53279594213a95f8725f96d66f08d8ba69/modules/qq-v2/host/adapter.js#L161)。

相对模块路径也是回退依赖：例如玉子 event bridge 尝试导入 `../../../script.js`。优先提供稳定公共入口，只有选定的插件路径确有需要时再提供相应模块兼容；不必先复制整个 ST 页面和模块树。

## 验证结果

1. 现有测试：helper-module-loading、tavern-helper-context、tavern-helper-worldbook、tavern-helper-event-gate、tavern-helper-scripts，共 **27/27 通过**。它们证明已有子集符合当前测试，不证明两个插件兼容。
2. 隔离探针：从真实 client.js 生成 bootstrap，在受控 VM 中执行；只把无关的 zod 下载替换为空模块，不运行插件业务、不连接实际宿主。
3. 探针确认：独立 getChatMessages/getVariables/updateWorldbookWith 存在；TavernHelper、SillyTavern.getContext/eventSource/eventTypes/saveWorldInfo、generateRaw、triggerSlash、replaceWorldbook、create/deleteWorldbookEntries 不存在。
4. 探针确认：新增消息自定义字段后，saveChat 返回 true、没有宿主调用，再次读取字段消失。
5. 探针确认：先普通注册、再 eventMakeFirst，执行顺序仍是普通回调在前。
6. 直接调用世界书转换函数确认：修改关键词/位置 order 返回空更新列表；改变条目数量被拒绝。

临时复现文件：`/tmp/acu-yuzi-host-audit-probe.mjs`；输出：`/tmp/acu-yuzi-host-audit-probe-results.json`；测试日志：`/tmp/acu-yuzi-host-audit-tests.txt`。临时文件不保证长期保留，结果已记录于本文。

## 建议的实施边界（尚未实施）

先以两个插件的基本操作作为验收样本，建立一张共同能力表。按“插件怎样找到宿主 → 怎样读写并保存 → 何时运行 → 怎样调用模型 → 怎样展示和恢复”的次序实现，不按“先给 ACU 打补丁，再给玉子打补丁”的次序实现。

第一阶段覆盖加载与上下文、真实聊天/设置存储、世界书读写、统一事件流程、基础生成服务，以及必要的 UI/存储权限。Slash、HTTP、模块兼容按已选运行路径补齐；可选图片、跨聊天管理、向量索引等列独立能力项，不能默默返回成功。

DSH 中已有的能力由 adapter 翻译；没有的通用能力在宿主层补建；插件私有业务继续由原插件执行。原生 DSH 状态和生成流程保持权威，兼容视图不能悄悄形成另一份不一致的聊天历史。

验收至少检查：两个未修改插件能够加载；ACU 表格与玉子状态刷新后保留且不串聊天；世界书投影真正进入下一次模型输入；停止/重生成/删楼/切聊天不重复执行或写错会话；插件之间能发现已加载服务；异常可见且可禁用。完成这些之后，才有依据说这两个固定版本“表现良好”。这仍不能推出所有未来版本和所有插件都兼容。


## 首批实现（2026-09-01）

用户授权：选择报告中当前能直接实现的部分进行实现。本轮选择共享脚本宿主的接口入口、事件订阅行为、两个变量合并写入接口，以及当前绑定世界书的读写。未改 ACU 或玉子代码，也未取消隔离策略。

### 已实现

| 能力 | 结果 |
|---|---|
| API 发现入口 | `window.TavernHelper`、`SillyTavern.getContext()`、全局 `getContext()` 可用。Helper 命名空间与已有全局函数共享引用，包装其中一个入口后，另一个入口仍可见该包装 |
| 当前身份读取 | context 的 `chatId`、`name1` 随上下文更新；没有将缺少的完整角色/群聊数据伪装为已实现 |
| 统一事件订阅 | context.eventSource 与 Helper 全局事件共用总线；提供 on/once/off/removeListener/makeFirst/makeLast/emit。支持监听去重、重排、一次性监听的递归防重入、异步等待、按脚本身份注销 |
| 事件名称 | 已有宿主事件的部分 ST 小写字符串映射到 DSH 的同名事件；不新增虚假的生成生命周期事件 |
| 变量写入完成语义 | `insertVariables`、`insertOrAssignVariables` 返回等待宿主保存的 Promise；保存失败或已过期会 reject，不再提前报告成功或只记录控制台错误 |
| 新世界书 API | `replaceWorldbook`、`updateWorldbookWith`、`createWorldbookEntries`、`deleteWorldbookEntries` 接通现有世界书库；保留 UID，新增分配 UID，拒绝重复编号 |
| 旧世界书 API | `getLorebooks`、`getLorebookEntries`、`setLorebookEntries`、`createLorebookEntries`、`deleteLorebookEntries`；正确转换关键的扁平字段及新增/删除结果结构 |
| 世界书字段保存 | 名称、内容、启用、激活策略、主副关键词、逻辑、扫描深度、插入位置/角色/深度/顺序、概率、递归、sticky/cooldown/delay，以及部分旧格式字段和自定义 extra |
| 数据保真 | 支持独立和内嵌两种世界书；未修改的未知原始字段保留；空名称、零深度、extra 字段删除不会被默认值恢复 |
| 写入冲突 | 更新器写回携带读取快照；发现其间已被修改会拒绝覆盖。仍使用现有宿主写入流程，不宣称具有跨进程/所有编辑入口的事务隔离 |
| 浏览器就绪时序 | 实测发现快速脚本会在 iframe load 前报告订阅完成，导致首个事件被丢弃并超时；现已等待窗口加载及脚本订阅都完成后再宣布就绪 |

### 验证证据

- `tests/helper-host-api.test.mjs`：共享入口、更新身份、跨入口事件顺序/去重、once、脚本隔离注销、变量保存等待/失败、快速脚本就绪竞态。
- `tests/helper-worldbook-api.test.mjs`：脚本 API → 生产宿主 adapter → 生产 World Book Library → 临时真实文件 → 创建新脚本环境回读。覆盖独立/内嵌世界书、增删改、字段、未知数据保留、extra 删除、冲突拒绝与绑定访问边界。
- 更新关键词后，通过现有 `prepareWorldBookRecall` 验证新的关键词和内容能进入 DSH 召回。**没有验证所有位置/递归配置在最终模型请求中的完整 ST 语义。**
- 浏览器夹具 `tests/fixtures/helper-host-browser-smoke.mjs` 使用真实浏览器、生产 srcdoc、模块加载器、iframe RPC 校验及宿主 adapter，存储指向可销毁的临时文件。只排除无关 CDN 库和图标，不访问用户资料、不调用模型。
- Chromium 验证：默认 `allow-scripts` sandbox 中创建与修改成功；销毁页面及脚本环境后，只读回读成功；两次宿主事件依次得到 `first, normal, once, first, normal`。快速只读脚本曾真实失败，修复后相同路径通过；受信任模式的同一回读与事件路径也通过。
- 全量 `node --test tests/*.test.mjs`：1094 通过、9 跳过、0 失败（1103 项，包含字段删除回归）；最后一次全量运行约 21 秒。跳过项不计为已验证。
- `git diff --check` 通过；没有重启或部署用户正在运行的 DSH 实例。

### 明确尚未实现

1. 通用脚本仍受现有 MVU 运行入口约束；本轮不包含全局扩展安装器，也未统一消息 HTML iframe 的另一套旧 shim。
2. `saveChat()` 与插件设置持久化仍未接通，完整角色/群聊/metadata、任意消息字段保存仍待实现。
3. `saveWorldInfo` 原生接口、所有世界书的枚举/绑定、新建或删除整本世界书未开放；本轮仅当前已绑定世界书的条目操作。
4. 旧格式 `use_group_scoring`、`automation_id`、`group_prioritized`、`group_weight` 尚无完整契约，非默认写入会明确拒绝；不冒充全部旧版世界书功能。
5. `generate/generateRaw`、Slash、ST HTTP 路由、完整生成前后事件、跨窗口 ACU 服务发布、IndexedDB/权限和 UI 兼容仍在后续范围。
6. 没有运行两个完整插件；不能据此宣称 ACU 或玉子已可直接使用，也没有验证官方 MVU 与所有社区脚本组合的端到端行为。

代码提交：`cb3e83d`（接口/事件/变量等待）、`c7d1a30`（世界书读写）、`dc44317`（extra 删除）、`6253851`（就绪竞态）。均为本地提交，未推送；保留工作区其他任务的修改。

## 第二批实现：普通脚本、插件设置、原生世界书（2026-09-01）

本轮补共同宿主能力，没有修改 ACU、玉子手机或人物卡内容。代码在 `feat/scene-image-generation` 本地分支，未推送、未重启用户 DSH。

| 能力 | 本轮行为 | 边界 |
|---|---|---|
| 普通人物卡脚本 | 启用的 Helper 脚本可独立于 MVU 进入运行环境；变量、消息、世界书宿主调用按脚本运行资格检查；普通脚本可收到已有 MESSAGE_SENT 事件 | 官方 MVU 结算仍要求启用 MVU；不向普通脚本伪造 Mvu；未实现全局扩展安装器或完整生成生命周期 |
| `extensionSettings` / `saveSettingsDebounced()` | 初始化从当前 Profile 的 `tavern-extension-settings.json` 读取；共享设置对象及插件持有的嵌套引用保持稳定；保存等待真实落盘，错误会 reject 并进入脚本诊断 | 与 DSH 设置和聊天历史分离；按插件命名空间合并独立修改，同一命名空间冲突拒绝；不实时同步其他已打开窗口，冲突后需重新加载 |
| 设置并发和完成语义 | 单宿主串行保存，保留写入期间的新编辑；字段及整个命名空间均可删除；不同 Profile 隔离 | 为减少关闭页面前丢失等待定时器的风险，采用异步串行保存而非复刻 ST 的防抖延迟；未等待完成就关闭页面仍不保证保存成功；跨进程竞争遵循现有文件锁，可能明确报冲突 |
| `loadWorldInfo` / `saveWorldInfo` | `SillyTavern.getContext()` 返回的接口使用 ST 原生 `entries` 字典、`key` 数组和数字 `position`；保存支持条目增删及自定义字段；独立文件与内嵌世界书各自保持原格式 | 只访问当前绑定世界书；保存前须先读取；不创建、重绑或删除整本世界书；不复刻可选延迟保存参数，返回 Promise 等待真实写入 |
| 世界书保真与冲突 | 自定义书字段、条目字段、字段删除、零深度和 nullable caseSensitive 有回归验证；内嵌转换不使用旧 originalData 复活已删除数据；新旧 API 共享按世界书资源的串行队列 | originalData 视为格式转换来源，不作为第二份可写权威；快照拒绝过期覆盖，但不宣称跨进程及所有编辑入口的事务隔离 |
| 绑定来源 | 绑定另一张卡的内嵌世界书时，读取真正的所属卡，而非当前卡的空白世界书 | 继续遵循现有世界书库的绑定规则 |

### 验证证据

- 普通脚本、宿主门控、消息 iframe 等相关测试首轮 **72/72** 通过。
- `tests/tavern-extension-settings.test.mjs` 验证临时真实 Profile 文件保存、跨实例恢复、独立插件并发合并、冲突拒绝、删除、Profile 隔离、特殊键安全、共享引用和写入期间编辑。
- `tests/helper-native-worldinfo.test.mjs` 使用生产 bootstrap → 生产 Host Adapter → World Book Library → 临时真实文件；覆盖独立/内嵌格式，新增/删除条目，未知字段增删，原生/Helper 交叉冲突和绑定限制。
- `tests/fixtures/helper-host-browser-smoke.mjs` 扩展为普通非 MVU 脚本，并支持 `--embedded`。真实 Chromium 默认 `allow-scripts` 沙箱中，独立世界书和内嵌世界书的写入均通过；分别销毁页面后从磁盘回读设置、世界书均通过。内嵌世界书还在受信任模式下回读通过。
- 浏览器验证继续使用生产 srcdoc、模块加载器、iframe RPC 白名单/令牌检查及生产宿主适配器；使用临时文件，不连接用户 Profile，不调用模型。排除了无关 CDN 依赖，并非完整应用及完整社区插件验收。
- 本次实现提交 `0caf22f` 的独立 worktree 全量测试：**1128 项，1118 通过、10 跳过、0 失败**，约 32 秒；直接运行 package.json 对应的 `node --test tests/*.test.mjs`。并行场景功能正在修改主工作区，其旧源码断言曾使一次工作区全量测试失败；未修改该任务文件。`git diff --check` 通过。

### 当前优先缺口

1. **真实聊天数据保存**：`context.chat` 的可变引用、自定义消息字段、chatMetadata、`saveChat()`；当前 saveChat 仍是占位，不能把数据库消息存档视为可用。
2. **生成与生命周期**：`generate/generateRaw`、停止生成、完整生成前后事件，以及与原生 DSH 请求/历史的准确关系。普通脚本已能加载，不代表自动填表已经触发或完成。
3. **生态运行环境**：Slash、必要的 ST HTTP/模块路径、原生扩展安装、全局脚本、跨窗口服务共享、IndexedDB 与 UI 权限契约。
4. **世界书范围和召回语义**：所有世界书枚举/创建/绑定及最终模型请求中的完整激活/排序语义；仍未覆盖所有旧 API 字段。
5. **整插件验证**：尚未运行 ACU、玉子手机或用户卡内手机的完整流程，不能宣称这些插件已经兼容。

本轮实现提交：`d8e4dd2`（普通脚本入口）、`e790327`（消息 iframe 的可选 MVU 事件保护）、`97a1a0b`（Profile 插件设置）、`0caf22f`（原生世界书读写）。

## 第三批实现：插件聊天数据存档，不改写 Frame 历史（2026-09-01）

用户明确限定：继续坚持追加式 Frame；本轮支持插件数据保存，不实现修改旧正文、增删或重排历史消息。不能把追加“更正”当成替换旧历史，也不能把存档接口的完成当成动态重建上下文已经兼容。

代码提交：`cc17b18`，本地 `feat/scene-image-generation` 分支，未推送、未重启用户 DSH。

### 已实现的保存契约

- `SillyTavern.getContext().chat` 返回稳定的可修改数组与消息对象，允许添加、修改、删除插件自定义 JSON 字段。内部存入消息的 `tavernPluginData`；不直接把插件字段混入 DSH 消息内部属性。
- `chatMetadata` 提供稳定的聊天元数据对象，内部存入当前聊天的 `tavernPluginMetadata`。
- `updateChatMetadata(values, reset)` 按顶层键合并或替换内存中的元数据；显式保存由 `saveChat()`、`saveMetadata()` 或 `saveMetadataDebounced()` 完成。它们返回等待真实存储完成的 Promise，失败会 reject 并进入诊断。Debounced 入口采用串行异步保存，不复刻上游延迟时长。
- 保存直接调用现有 Chat Persistence / Chat Journal Store，只有插件数据区发生变化。不是新增第二套聊天权威存储，也不调用模型、改写既有 Frame 或自动把插件数据注入正文。
- 每个待保存消息及元数据携带读取时的存储 revision；服务端从 Journal 读取真实基线，在当前聊天的原子更新中校验聊天身份、生命周期、目标消息版本及字段冲突。不同顶层插件字段可合并，同一字段冲突会拒绝整次保存；删除也有相同保护。
- 同一消息的不同字段可以合并；同一插件字段内部的并发修改保守地视为冲突，不按表格行猜测如何合并。
- 正常宿主刷新保留未保存编辑与对象引用；新消息追加后，旧消息数据仍保存到原位置。排队保存和写入期间的后续编辑不会被保存回执抹掉；切换聊天或历史生命周期后，旧对象隔离，旧请求回执不能恢复旧聊天视图。

接口语义核对使用 SillyTavern `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8` 的 [script.js](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js)（`updateChatMetadata` 顶层合并/reset、`saveMetadata` 调用聊天保存），以及 [context 导出](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/st-context.js)。这里保持自己的错误报告和存储边界，不声称所有上游保存副作用都已实现。

### 明确不支持及限制

1. 通过本轮 `saveChat()` 修改 `mes/message`、身份字段、变量/swipe 字段，或增删、替换、重排消息，都会在保存前明确失败；不能顺带保存同次请求中的其他修改。既有 Helper/MVU 专用接口没有在本轮扩展或改造。
2. 临时投影、尚未落盘的消息不能承接消息存档；内部 MVU 结算事务期间也会明确拒绝此保存入口，不能把事务草稿伪装成已持久化。
3. `chatMetadata` 里的键只按数据保存，不据此自动实现 ST 的提示词覆写、变量系统或其他功能。业务数据持久化与最终模型请求的语义是两个独立契约。
4. 仅支持 JSON 数据，不保存函数、DOM 或任意运行时对象；危险的 `__proto__` 键明确拒绝。历史基线不可用、聊天被切换、目标消息已变化时要求重新加载后操作。
5. 当前覆盖人物卡共享脚本运行环境的 ST facade，未统一消息 HTML iframe 的旧 shim，未实现原生 ST HTTP 聊天保存接口或跨聊天管理。
6. 没有运行完整 ACU、玉子手机，也没有证明它们的自动填表、提示词投影、生成时机或所有 UI 已兼容。后续核心缺口仍是生成接口、事件时序及其他宿主能力。

### 验证证据

- `tests/helper-chat-data.test.mjs`：11 项行为测试，使用生产 bootstrap、Host Adapter、Chat Persistence 和临时真实 Chat Journal 文件。覆盖保存/恢复、删除、metadata 合并/reset、聊天隔离、并发合并/冲突、追加消息、写入期间编辑、保存失败、旧正文保护、临时消息拒绝、刷新与切换聊天竞态。
- `tests/fixtures/helper-chat-data-browser-smoke.mjs`：真实 Chromium + 生产 srcdoc/模块加载器/RPC 令牌与白名单检查 + 生产宿主/存储。默认 `allow-scripts` 沙箱保存通过；销毁页面后的只读回读通过；受信任模式只读回读通过。原文、预置 Frame 和剧情 revision 保持不变。
- 浏览器故意尝试改写旧正文时收到预期拒绝。首次夹具还因未接入无关的诊断记录入口出现一次 500，已在夹具中单独接收诊断，重新运行保存与回读均通过，仅保留故意改写历史触发的预期错误；此项不属于存档 RPC 失败。浏览器测试排除了无关 CDN 依赖，不连接用户 Profile，也不发模型请求。
- 最终全量 `node --test tests/*.test.mjs`：**1169 项，1156 通过、13 跳过、0 失败**，约 31 秒。`git diff --check` 通过。测试期间工作区有其他并行任务，但未提交或修改它们的文件。
