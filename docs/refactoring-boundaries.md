# 重构后的职责与验证

本轮保持外部 RPC/CLI、请求语义及存档格式。每个职责单独提交。

## 回合历史操作

- `domain/round-history.js` 负责重生成和回退的完整执行顺序：读取目标、准备历史 revision、调用时间线、脚本事件、DSH 生成、失败恢复、Swipe 提交、后台结算和原生消息替换。
- `index.js` 仅提供 Chat、Session、脚本和展示的宿主接口，保留 `regenBody` / `rollbackTurn` RPC。
- `story-timeline.js` 继续独占分支、revision 和 checkpoint 规则；`tavern-swipe-regeneration.js` 保留 Swipe 合并和冲突判断；`rollback-surface.js` 保留 DSH 消息定位。没有新增第二套历史。
- 客户端 `createTurnHistoryProjection()` 集中处理权威隐藏轮次与旧 localStorage 记录。`TurnHistoryProjection` 独立挂载，候选面板不再维护历史隐藏。继续使用 DSH loader，不引入浏览器打包协议。
- 重生成目标和浏览器隐藏测试改为调用生产接口，不再截取源码；新增完整流程测试，覆盖成功、抛错、缺少正文、空正文、连续重生成、重新创建模块、回退 checkpoint 与旧剧本。

验证：完整 Node 测试 989 项，985 通过、4 项环境条件跳过、0 失败。浏览器加载实际客户端模块，确认回退隐藏目标整轮、保留相邻轮；旧隐藏记录保留用户输入而隐藏正文。浏览器检查使用隔离夹具，不接触真实用户会话，不等同真实模型/所有 DSH 平台验收。

## 预设库

- `domain/preset-library.js` 集中读取/检查/转换预览、目录与当前选择、原文导出、编辑后读取和旧方案/旧对话迁移。
- 选择新预设时验证可运行性并清空旧方案激活；启动迁移的两阶段顺序由库自己维护。宿主保留原 RPC 参数和返回结构。
- `runtime-presets`、`preset-editor`、`bypass-plans` 的格式与编译规则不变；库复用这些现有接口。删除与重命名仍归资源引用图管理。
- 新增库级测试验证重复正则 ID/空槽位原文定位、未知字段保留、选择与重建实例、失败资源隔离、重复迁移、丢失预设源的快照迁移及原文导出。

验证：完整 Node 测试 995 项，991 通过、4 项环境条件跳过、0 失败。新增 6 项库级测试调用实际编辑、运行预设和迁移实现，以隔离存储替代用户数据；未修改预设 UI。

## 启动器

- `bin/dsh-tavern.mjs` 只负责命令分派，并重新导出原有 helper 接口以保持调用方兼容。
- `profile-installation.mjs` 负责环境检查、旧数据发现、依赖安装、Profile 配置事务和命令安装。
- `service-lifecycle.mjs` 负责进程身份、端口/就绪判断、启动停止、访问地址校验及浏览器启动。
- `application-update.mjs` 负责平台脚本选择、临时副本执行、输出收集、清理，以及成功/失败/已安装待重启状态。
- `launcher-environment.mjs` 共享路径和进程调用，`launcher-settings.mjs` 保留设置迁移；模块导入不执行安装、更新或启停。原有 58 个函数体保留，未更改超时、平台命令或回滚策略。
- 发布包测试明确要求新增模块进入 Git 包和 CDN 清单，支持以暂存树验证待提交版本。

验证：完整 Node 测试 996 项，992 通过、4 项环境条件跳过、0 失败。实际 CLI 在隔离目录启动 HTTP 子进程，验证重复启动、重启、停止、重复停止和拒绝操作其他进程。原有 Windows 脚本/编码/路径与 Android 路由测试通过；本机未运行 Windows/Android 实机安装。

## 人物卡页面与脚本生命周期

- `TavernScriptRuntime` 在当前会话的输入区挂载一次，持有 `createTavernScriptExecutionModule`；历史消息的展示组件不再各自同步共享脚本。会话组件卸载时释放运行权、销毁沙箱并停止轮询；同一会话的普通刷新复用原沙箱。
- 执行模块统一管理运行权、轮询、事件回执和清理。每次会话生命周期有独立运行权身份，A→B→A 的旧轮询/初始化回调不能激活新实例；迟到轮询若重新取得旧运行权，会按旧身份释放。运行权竞争、原有轮询间隔、事件与错误回执协议保持不变。
- `createTavernHelperScriptRuntime` 继续负责共享脚本沙箱和原生模块加载。替换沙箱时取消属于它的未完成事件、清除初始化计时器；旧 iframe 的 load、消息和 RPC 回调不能继续操作新会话。脚本失败隔离和官方 MVU 的加载顺序保持不变。
- `createTavernMessageFrameLifecycle` 管理可见/待就绪文档、替换、测高、只读状态刷新及消息接收。`TavernMessageFrame` 只负责 React 挂载、懒加载和渲染；同一会话的新文档就绪前保留旧页面，切换会话则丢弃旧页面的接收资格。
- 每个文档的 `createTavernFrameContextChannel` 独立持有发送基线和就绪状态。加载期间合并更新，就绪后补发最新状态；继续使用原 snapshot/patch 协议，回退、缺失基线和重复 ready 的处理语义不变。消息仍校验来源窗口和 token，写入仍携带生命周期 revision。
- 不改变 DSH loader、模型请求、人物卡资产、官方 MVU 协议或存档格式；没有新增浏览器打包工具，也不修改文生图功能。

验证：新增 `card-runtime-lifecycle.test.mjs`，通过生产接口验证运行权复用/释放、快速会话切换、迟到事件、失败重试、文档替换、上下文恢复与卸载清理；原 `helper-context-refresh` 测试直接使用导出的实际 React 组件，不再注入导出语句。更新原接线测试，保留行为验证与原断言覆盖。

浏览器夹具 `status-refresh-browser-smoke.mjs` 验证实际 React/iframe 的变量晚到、下一轮、回退和无变化不重建；`card-lifecycle-browser-smoke.mjs` 通过生产注册入口、实际脚本模块加载及宿主事件门验证失败脚本隔离、变量写入、失败后继续、A→B→A 和卸载后无轮询。两者只使用隔离数据，外部依赖替换为本地空模块；不等同任意社区卡或所有 Desktop/Android 平台的实机验收。

## 对话初始化与人物卡上下文快照

- `domain/conversation-initialization.js` 统一持有 `start` / `ensureOpening`：模式与兼容策略、预设读取、开场选择与投影、官方 MVU 待初始化状态、剧本对齐、存档发布及原生开场恢复。宿主保留原 RPC 参数和返回结构，只接入资源、Registry、DSH Session 与展示。
- 同一 Session 的创建与恢复顺序执行。同卡同大模式继续复用原 Chat，不因重新进入而换开场白、重建 MVU 或读取新预设。没有 Session 的原调用仍创建独立 Chat；不跨进程承诺互斥。
- 新对话在取得可写 Session 后发布；准备快照不提前落盘。Registry 继续独占 Chat/映射/索引的发布与回滚。发布后若原生写入失败，保留同一 Chat 供恢复，不另建一条存档。
- 开场白使用既有 `message.id` 字段保存由 Chat ID 派生的稳定身份，不增加存档字段或 DSH 自定义事件。重试只补齐缺失的开场事件，不删除原历史；恢复时跳过 DSH 的 `session/end-seed`。旧随机 UUID 的完整独立开场事件可识别复用；历史已交错推进时拒绝补写。原生 flush 成功后才保存完成标记，空开场白同样可完成初始化。Chat 与 Session 仍是两个存储，不声称跨存储原子事务。
- `domain/play-card-snapshots.js` 独占新快照准备、v5 迁移、清理、常驻世界书失败隔离、并发构建与保存。保存失败不让调用者内存提前变成已迁移；等待同一次构建的读取者获得快照字段，但保留自己的存储 revision，供后续乐观合并。保存发起者采用持久化层返回的合并结果后才采用新 revision。
- 请求模式、预设原文未知字段、开场 source/display/session 投影、官方 MVU 所有权与 Swipe 变量初始化规则保持不变；不增加模型生成调用，不涉及文生图。

验证：快照测试直接导入生产模块，不再截取宿主源码执行。流程测试覆盖重复点击、模式别名、剧本与 MVU、发布失败、各原生事件写入失败、flush/完成标记失败、展示失败、丢失映射恢复、旧开场复用及并发快照保存。原接线断言随职责迁移更新。

`conversation-initialization-native.test.mjs` 使用已安装 DSH 的真实 Session、AgentLoop、消息投影与本项目 Chat journal，在临时目录验证磁盘恢复、五个部分写入位置、完成标记失败、flush 失败，以及恢复后首个玩家输入从第 2 轮开始、固定背景进入真实模型适配器输入。模型为本地脚本回复，不调用收费服务，也不读取真实用户对话；不等同 Windows/Android 实机验收。

范围外发现：通用 `ChatPersistence` 的并发三方合并遇到其他写入者删除字段时，可能尝试克隆内部 `MISSING` Symbol 并报错；该问题在原持久化模块中，本次不修改其通用合并规则。上述快照并发验证覆盖更新字段及未知字段保留。
