# DSH Tavern Domain

## Story Timeline

Tavern Chat 中唯一权威的剧情记录。它用单调递增的 revision、branch、checkpoint 和 operation 描述当前有效剧情；DSH Session、后台 Agent 与浏览器界面都是它的生产者或投影。

## Foreground Turn

玩家可见的一轮输入与正文回复，也是剧情的独立提交边界。Foreground Turn 成功后立即推进 Story Timeline revision 并建立 checkpoint；后续状态结算失败不能撤销正文，也不能阻止下一轮。

## Round

一次已提交的 Foreground Turn 及其绑定的派生状态工作。正文提交决定 Round 是否存在；状态结算可以随后完成、失败或因版本过期作废，不参与正文的提交与回退边界。候选生成不属于 Round。

## Last Round Replacement

对最后一个已提交 Foreground Turn 的替代。系统保留原玩家输入；新正文成功后立即替换旧正文、建立新的 checkpoint 并更新模型可见投影，随后重新执行后台状态结算。只有前台生成或提交失败才恢复旧正文；后台失败保留新正文。它不保存或切换多个 Swipe，也不允许修改已有后续剧情的历史轮次。 正文提交前中断时恢复原剧情，并保留期间保存的 Guide 等非剧情设置；正文提交后保留持久投影记录，直到原生 Session 替换并保存成功。重启或重试只能补完已提交正文的投影，不能再撤销正文。生成与投影恢复期间，服务端拒绝其他前台输入和回退。

## Failed Turn Replay

生成中断后对失败尾部的恢复：该轮从未提交为 Round，因此不存在回退或替代对象。系统从只追加事件历史里取回该轮原始玩家输入，先移除被中断的正文残留与错误提示，再原样重发同一输入，使请求前缀与失败前一致、复用模型缓存。它不写 checkpoint、不删除已完成剧情，也不接受额外意见输入。

## Character Design

人物设计先按姓名或别名读取本局世界书与已有档案。原世界书已有完整设定时，通过已读条目复用完成任务，不建立平行档案；同名或同别名原条目阻止重复保存。仅缺少设定的新人物及已有设计的修订将档案与本局世界书一起提交。新人物创建以姓名和别名触发的非常驻条目，下一轮按世界书召回规则使用；写入绑定的原始世界书（多本时写主书，未绑定时创建人物卡内置世界书），仅自动同步本次人物条目变化，保留其他本局编辑。后续保存更新工具创建的对应条目，保留手动调整的关键词与激活设置；正文被手动修改时拒绝覆盖并报告冲突。外部人物卡、世界书更新仍需用户允许同步。

## Background Agent

每个 Tavern Chat 共享的单一持久 Agent。它串行执行世界书候选筛选、状态结算与候选生成，不直接拥有剧情权威。世界书由 Tavern 本地匹配与投影，候选池超过阈值时由该 Agent 筛选，不新建独立会话。

## Background Operation

Background Agent 基于特定 Story Timeline branch/revision 执行的一项工作。运行时长本身不构成失败；operation 只有排队、运行、完成、失败、过期或取消等生命周期事实。后台模型阶段连续 5 分钟没有有效流式输出时中断并记录失败；思考、正文及工具参数增量会刷新进展，工具执行阶段不使用模型空闲超时。长时间运行只提示阶段和停止入口。超时或主动停止后不复用可能未响应取消的 Agent，迟到工具调用被拒绝；重试使用新后台 Session，已提交的前台正文保持不变。

## Background Cycle

Foreground Turn 提交后产生、并绑定该正文 branch/revision 的状态结算 Background Operation。世界书关键词匹配在本地完成；需要模型筛选时，在正文准备阶段执行独立 operation，复用同一个后台 Agent，不属于正文提交后的结算周期。结算失败会暴露重试入口但不阻塞下一次 Foreground Turn；旧 operation 的迟到结果不能覆盖更新 revision 的状态。

## MVU Delivery

MVU 模型提交先保存到 Chat 消息的 `mvu.pendingSubmission` 与 `mvu.delivery`，再交给浏览器执行。通知与领取租约只负责唤醒和调度，领取失败、页面断线不会删除持久任务。仅对待办会话自动复查，连接恢复后使用已保存提交接续，不重新调用模型。

每次执行使用独立事件标识，并在隔离草稿里修改变量；失效事件不能写入权威 Chat。校验成功的 effect 先作为 delivery 保存点落盘，再通过 Story Timeline 原子提交变量和完成回执。重启丢失草稿可重建，已保存 effect 可直接提交；branch、revision、生命周期和 Swipe 必须仍匹配。主动停止、目标过期、初始化或校验失败不自动接续。此契约覆盖宿主管理的变量提交，不把人物卡脚本任意外部网络副作用变成事务。

## Background Activity

Story Timeline 中 Background Operation 生命周期的只读投影，用于回答 Background Agent 是否空闲以及交互是否可用。它不是独立保存的第二份权威状态。

## Tavern Compaction

以一条 Tavern Chat 为边界，分别压缩 Foreground Session 与共享 Background Session 的维护操作。两边可以使用不同摘要契约并保留独立结果；压缩不改变 Story Timeline 的权威性。

## Session Continuity

浏览器与当前 DSH runtime 中同一个 Session 的连接连续性。它负责识别 runtime 重启、恢复 Session 和保留未发送草稿，但不能决定或改写 Story Timeline 与 Background Operation。

## Projection

从权威领域状态派生、可随时重建的只读表示。DSH Session Surface、Background Activity、Tavern 状态视图和浏览器交互状态都是 Projection。

## Session Signal

Host 向 Tavern 浏览器消费者发布的带类型唤醒通知。所有活跃会话共用一个 DSH Remote Snapshot Stream，并复用 DSH API Gateway 的 `/api/remote.mux` WebSocket；会话集合变化或断线重连时替换完整基线，普通变化只发增量，因此不占用 HTTP/SSE 连接槽。通知至少携带领域类型与权威版本标识；`tavern-state` 可以附带同版本的只读 Projection，供消费者避免二次 HTTP 读取。附带 Projection 仍不是权威状态，缺失、重复与丢失都不能改变领域结果，消费者在首次连接与重连时仍从领域 Module 校准。`runtime-work` 表示浏览器脚本队列可能有新工作，`tavern-state` 表示包含结算、候选和展示投影的 Tavern 权威视图可能变化；候选持久任务自身的 `candidate` 类型不冒充 Session Signal。

运行时的领取、开工确认、续租、回执和释放也复用同一 Remote mux WebSocket，以一次性 stream 返回结果，避免排在慢视图请求占满的 HTTP 连接之后。控制通道只开放固定的运行时方法，不代理重视图或一般游戏写入；传输失败由执行器按原事件与租约查询恢复，传输层不自动重放。

## External Preset

从 SillyTavern 等外部系统导入的只读来源。中文正式名称为“外部预设”。用户在预设库中查看它，并手动选择需要启用的提示词和正则；系统不会直接运行整份预设。

## Preset Selection Snapshot

根据用户在 External Preset 中的选择生成的内部自包含运行快照。它用于保持请求稳定并兼容旧数据，不是独立产品资源，不在 UI 中提供单独的资源库、导入、导出或编辑入口。

## Internal Preset Projection

运行时从 Preset Selection Snapshot 确定性生成的内部请求结构。中文正式名称为“内部预设投影”。它可以包含稳定前缀、每轮注入和后带内容，或在兼容模式下投影为 SillyTavern 消息顺序；它不是用户资源，不在 UI 中展示或激活。

## Compatibility Mode

普通用户可以在设置中主动开启的实验性游玩模式。中文正式名称为“兼容模式（实验性）”。它选择兼容编排策略，不运行普通游玩编排策略的后台状态结算；候选项可以按需手动生成。该设置默认关闭，只控制入口与新建权限；已有兼容对话不会因关闭设置而被改写。

## Orchestration Strategy

决定一轮游戏如何解释资源、组织上下文和调用执行能力的策略。中文正式名称为“编排策略”；普通游玩和兼容模式是两种编排策略，不是两个独立运行时。

## Native Play Orchestration Strategy

以持续 DSH Session 和增量 Frame 为核心的编排策略。中文正式名称为“普通游玩编排策略”；它原生解释人物卡、世界书、宏和正则，并按需调用酒馆脚本运行模块。

## Compatibility Orchestration Strategy

按 SillyTavern 可观察语义重建完整请求的编排策略。中文正式名称为“兼容编排策略”；它负责 Prompt Order、历史重排和精确注入位置，并与普通游玩共享酒馆脚本运行模块。

## Tavern Script Execution Module

执行人物卡携带的 Tavern Helper 和其他 JavaScript 程序的独立模块。中文正式名称为“酒馆脚本运行模块”；它由 dsh-tavern 重新实现，复刻人物卡脚本可观察到的酒馆 API、事件与运行环境，只认识酒馆脚本和酒馆宿主接口，通过 Host Adapter 与 dsh-tavern 隔离。

## Tavern Script Dispatch

Host 中管理酒馆脚本工作的排队、offer、显式 start、可续租执行状态和幂等结果回执的 Module。它通过 Session Signal 唤醒浏览器执行器，但 Signal 不代表工作存在或完成。重复 claim/start 确认同一工作；浏览器通过携带 eventId、runtimeId、leaseToken 的状态查询，在沙箱仍响应时续租，执行没有固定总时限。失联释放执行租约并延期持久 MVU 工作，不伪造脚本失败。完成回执丢失时查询或补发同一结果，不能重新执行回调。沙箱同一事件只执行一次，结果在父页 ACK 前保留，ACK 后保留去重身份。Host 的有界内存回执只确认执行交接；重启后的恢复事实仍是 MVU Delivery 的 pendingSubmission/effect 和 Story Timeline 的 Settlement Receipt，不能将执行 ACK 当成变量提交成功。

## Tavern MVU Core

由 dsh-tavern 重新实现的 MVU 协议解析器和变量状态机。中文正式名称为“MVU 核心”；它读取模型原始输出、提取变量命令、计算楼层与 swipe 变量，并向酒馆脚本运行模块产生 MVU 生命周期事件。它不属于酒馆脚本运行模块。

## MVU Settlement Effect

酒馆脚本运行模块完成一次 MVU 结算后返回的、绑定 Background Operation 与 Story Timeline 版本的纯数据效果。它在浏览器执行阶段不写入 Chat；只有对应正文仍是当前 branch/revision 时，Background Task Coordinator 才提交变量效果与 Settlement Receipt。正文 checkpoint 与 revision 已在 Foreground Turn 成功时独立提交。中文正式名称为“MVU 结算效果”。

## MVU Transaction History

原生分页存档中，MVU 工作副本固定一个不可变存档版本，只加载实际访问的楼层。异步宿主边界先确保楼层已加载，内部同步数组视图保留完整长度与绝对下标；未加载楼层不能被当作不存在。首次修改复制该楼层，事务覆盖层优先于固定版本的历史，提交只包含明确修改的楼层和头部字段。显式完整上下文请求仍可读取全部历史。原生消息摘要保存 MVU 快照标记，旧摘要缺失标记时按需检查变量形状。

原生存储随 head CAS 发布版本变更清单，Helper 可在不建立整档缓存的情况下交接增量上下文。变更覆盖缺失或超过查询窗口时保留完整恢复语义。新原生 MVU 效果同时保存修改字段的旧值，提交先检查字段冲突，再应用全部修改；既有剧情版本、生命周期和 swipe 校验继续生效。

## MVU Settlement Reconciler

把持久化的 pendingSubmission 与当前酒馆脚本运行时状态重新协调的 Host Module。它在服务启动时扫描，在 Session Signal 唤醒时复查，并对瞬时读取或调度失败自动退避重试；pendingSubmission 才是待接续事实，浏览器就绪与 Signal 都只是触发复查的提示。中文正式名称为“MVU 结算协调器”。

## Prompt Template Runtime

执行完整上游 ST Prompt Template/EJS 语义的模块。中文正式名称为“提示词模板运行模块”；它负责模板任务的完整执行过程，模板产生的持久变化仍受 Tavern 权威状态与版本约束，不属于酒馆脚本运行模块。

历史消息的模板展示按消息版本保存，普通新轮次、当前变量或全局配置变化不重新渲染旧展示；编辑与切换回复版本只更新对应消息，回退恢复历史快照。当前状态栏的脚本仍读取当前变量。原生分页存档的服务端模板上下文首先读取末尾 200 条，以保留绝对楼层的真实数组按需读取旧楼层；隔离进程通过专用只读管道读取签名版本中的单条历史。展示扫描、差异计算及保存只处理已加载楼层。旧格式和显式完整历史展示仍保留完整上下文及游标增量路径；游标仅用于传输缓存，不代替权威存档版本及写入冲突校验。变化楼层继续传给展示同步；模板保存及回执使用局部修改，宿主按持久化读取版本还原后执行原有冲突校验。

## Display Source

正文展示、正文编辑与模板格式化镜像共用的无副作用分类：区分 Markdown、协议标记、HTML 与带围栏的 HTML，保留作者脚本和样式内部的原始内容。模板表达式在解析期间保持不透明，只为上游 EJS 恢复一层转义；代码块是否执行模板仍由原有设置决定。

旧模板展示恢复只作用于读取时的展示副本。只有当前源文或单条富文本美化规则能重现旧 Markdown 解析器对脚本/样式的相同损坏时，才替换对应内部内容；历史正文、其他模板结果和存档保持不变。不执行 EJS，不重放变量副作用，不以当前人物卡覆盖无法确认的历史展示。

## Host Adapter（桥接层）

dsh-tavern 向酒馆脚本运行模块提供的宿主适配器。它把脚本对消息、变量、世界书、模型和展示的操作映射到 dsh-tavern 的权威状态、执行轨迹和 Projection。MVU 结算期间的写入必须携带当前 Tavern Script Dispatch event ID，不能仅凭 Session 身份加入事务。

## Stable Prefix

Internal Preset Projection 中拼在请求前部、后续请求保持稳定的部分。中文正式名称为“稳定前缀”。它不写入权威 Session 历史。

## Per-Turn Injection

Internal Preset Projection 中每轮根据当轮状态重新生成、只在该轮生效的部分。中文正式名称为“每轮注入”。它可以保存当轮快照以供追溯，但旧轮快照不会在后续请求中重复累积。

## Tail Content

Internal Preset Projection 中在发送模型请求前临时追加到末尾、但不写入 DSH Session 的部分。中文正式名称为“后带内容”。

## Script

用于引导故事主线的叙事资源，可以是小说、剧情大纲或故事素材。Script 可以暂未绑定；一份 Script 最多绑定一张人物卡，一张人物卡最多绑定一份 Script。

## Native LLM Game

以事件与状态维持世界连续性、由 Agent 与确定性程序共同推动、并通过一个或多个 View 与玩家交互的游戏作品。中文正式名称为“原生 LLM 游戏”。人物卡、世界书、MVU、正则和酒馆脚本可以作为它的导入来源或兼容资源，但不定义其内部领域边界。

## Checkpoint

Story Timeline 上一份可以恢复和继续演化的完整游戏存档点。它绑定确定的 branch 与 revision，并覆盖正文、世界状态、人物状态、知识披露及属于该位置的待执行操作；切换 Checkpoint 不改写已经存在的历史。

## Game Fork

从一份已完成的 Checkpoint 或当前已提交剧情头创建的新游戏世界线。分叉继承该位置的正文与持久游戏状态，但拥有新的 Tavern Chat、DSH Session、branch 和后台 Agent 生命周期；源游戏保持不变，分叉后的两个游戏互不影响。中文正式名称为“游戏分叉”。

## Cast System

同一游戏中全部人物、群体与组织及其关系的集合。中文正式名称为“人物集系统”。人物的稳定设计档案、世界线运行状态、个人知识与表现资源属于不同信息层，不能互相替代。

## Context Disclosure System

根据世界线、场景、参与人物、任务、知识权限与注意力预算，决定某个 Agent 在一次任务中可以看到哪些世界知识及其精度的领域能力。中文正式名称为“上下文披露系统”。检索命中不等于允许披露，披露也不改变世界事实。

## Agent-Owned Context

Agent 在执行当前任务期间，根据已发现的信息缺口主动搜索、读取、查询和核实资料而形成的最小上下文工作集。中文正式名称为“Agent 自主上下文”。系统仍可提供确定性上下文投影，但不要求它预先猜中全部相关知识；任务结束后，取回资料不默认继续占用后续上下文。

## Hybrid Context Supply

由程序确定性 Push 与 Agent 自主 Pull 共同组成的上下文供给方式。中文正式名称为“混合上下文供给”。程序负责高置信、低延迟、低成本和不可遗漏的投影，Agent 负责低频、长尾、需要任务理解或连续追查的资料；Host 独立强制权限和事务约束。

## State Context Policy

决定结构化游戏状态如何进入 Agent 上下文的混合供给规则。中文正式名称为“状态上下文策略”。小型基础状态固定 Push，本轮高相关状态按条件 Push，长尾状态由 Agent Pull，内部或受限状态保持 Host Only；所有投影、查询和行动检查必须属于同一 branch、revision 与 checkpoint。

## Game View System

把游戏状态投影为 HUD、手机、地图、任务、战斗或其他交互界面，并把玩家操作转换为受控 Command 的领域能力。中文正式名称为“游戏 View 系统”。View 不拥有世界状态权威，也不能直接改写历史。

## Continuity and Memory System

通过完整事件、存档点、分层摘要、人物记忆与可重建检索索引维持长程游玩连续性的领域能力。中文正式名称为“世界连续性与记忆系统”。摘要和索引是 Projection，不能替代原始事件与 Story Timeline。

## State Effect

由正文结算、玩家 Command、确定性规则、后台模拟或 Agent 工具调用提出，并经过 Schema、权限、branch 与 revision 校验后才可提交的一组状态变化。中文正式名称为“状态效果”。Agent 生成 State Effect 不等于游戏状态已经改变。

## 场景配图术语

**人物方案（CharacterPlan）**：
为同一游戏中的一个人物持续维护的绘图资料，包含身份、固定外貌以及随剧情变化的服装、动作、表情和站位。人物方案具有对应剧情位置的历史版本，不是原始人物卡，也不拥有游戏状态权威。
_Avoid_: 临时人物提示词、人物缓存

**画面方案（ScenePlan）**：
针对某一剧情位置的一张插图的完整描述，引用该位置对应的人物方案版本，并包含环境、构图和本次绘图要求。单张图的临时调整不自动改变持久人物方案。
_Avoid_: 人物方案、场景方案

**标签块（PromptBlock）**：
人物方案或画面方案中某一类信息对应的可复用绘图表达，可包含标签及必要的关系短句。标签块持久维护并关联来源与表达版本；一次生图使用一组适用标签块组成完整提示词，而不是让标签本身成为游戏事实。
_Avoid_: 人物方案、一次性完整提示词

## Scene Status Index

原生存档的图片状态读取以 sceneIndexRef 定位指定轮次，索引与消息通过同一 head CAS 发布，sceneIndexRevision 必须与 Chat 版本一致。消息页持久化既有图片 key 的 SHA-256 前缀续算状态，因此普通追加无需重读前文，变量更新复用索引，改写早期正文重建受影响后缀。旧图片 key 算法保持不变。缺失或失效索引保留完整兼容读取，后续写入补建；此首次补建成本不属于常规点查询。状态查询的参考图端点读取也固定同一存档版本，不能借用其他分支的图片。

## Host Projection Replay

Tavern 启动时通过 `host-projection-replay.js` 适配宿主未发布的批量历史重放：contextBreakdown v4 / turnOutline v2 保留原生计算，仅对批次私有累计数组原位追加，消除 O(N²) 复制。buildCell / restore 每批独立，首次修改复制输入，原生 schema / 序列校验 / 检查点格式 / 实时 apply 与通知保持原样；未知版本回退。该层依赖宿主私有接口，升级需跑原生差分测试，不直接修改已安装 DSH。

万轮严格 E2E run-mQUIoR 状态栏就绪 4.960 秒（上轮 13.734 秒），正文 1.965 秒；重新结算 5.042 秒、MVU 完成到落盘 1.085 秒。仍有 O(N) 宿主事件重放，整体打开尚未达到轮数无关。测试与兼容基线见 `docs/verification/host-projection-replay-20260928.md`。

## Opening Metadata Reads

Task State reader 为候选同步、活动与启动恢复检查提供只读头部字段；Skill 列表与身份判断、空闲 manual 压缩检查不再读取全历史摘要。真正的任务恢复、开启的压缩与旧版未完成正文迁移保留完整读取。显示诊断在楼层语义一致时复用 scene 索引点查询；新增 displayIndexRevision 防止旧写入器留下的过期元数据被误用，旧索引 / 推断轮号不一致则回退。

最终万轮 E2E run-rZVvyd：状态栏 3.005 秒，正文 1.637 秒，重新结算 4.464 秒，MVU 完成到落盘 0.954 秒；首屏及后续空闲诊断全历史摘要遍历为 0。严格检查用 `TAVERN_PERF_REQUIRE_BOUNDED_STATE=1`，测试与剩余边界见 `docs/verification/current-header-opening-20260928.md`。宿主事件恢复等工作仍随历史增长，不能宣称整体 O(1)。

## Unified Save Upgrade

DSH 0.2.1 存档升级由 `save-upgrade.js` 统一管理。启动时先在宿主打开会话前通过 `session-upgrade.js` 升级旧 DSH 日志；界面的「升级存档」检查前台、后台和撤销回退关联会话均已就绪，再通过 `chatJournalStore.upgradeStorage` 将旧 JSON、journal 或兼容增量树转为原生分页布局。后台任务提供阶段、错误和重试；新版存档隐藏入口。诊断 CLI `bin/migrate-conversation-storage.mjs --native` 保留。

会话转换使用宿主的历史格式链及父子会话目录，严格验证正文、工具结果、摘要和引用后原子发布新的 v4 文件，保留原文件，不覆盖已有新版。升级元数据保存旧事件位置到新位置的映射；剧情轮号、回退锚点、编辑记录、后台边界和撤销回退沿此映射恢复。不能证明安全的异常日志拒绝升级并报告原因。

剧情存储转换与写入共用 conversation lock，发布前完整读回比对并检查源版本。`legacyInitialRevision` 让旧 revision 继续由原存储解析，新进度只写原生布局；旧文件不代表升级后的最新进度。未修改已安装 DSH 本体。验证范围与异常旧档边界见 `docs/verification/dsh-021-save-upgrade.md`。
