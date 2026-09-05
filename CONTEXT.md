# DSH Tavern Domain

## Story Timeline

Tavern Chat 中唯一权威的剧情记录。它用单调递增的 revision、branch、checkpoint 和 operation 描述当前有效剧情；DSH Session、后台 Agent 与浏览器界面都是它的生产者或投影。

## Foreground Turn

玩家可见的一轮输入与正文回复。Foreground Turn 完成后只是当前 Round 的暂存结果；在配套状态结算成功前，它不会单独推进 Story Timeline revision，也不会产生 checkpoint。

## Round

一次不可拆分的正式剧情事务，由 Foreground Turn 与紧随其后的状态结算组成。只有两者都成功，Round 才一次性提交正文、派生状态、checkpoint 和新的 Story Timeline revision。未完成、等待运行时或结算失败的 Round 会阻止下一轮正文、回退与正文替代；候选生成不属于 Round。

## Last Round Replacement

对最后一个已完成 Round 的整体替代。系统保留原玩家输入，重新生成正文并重新执行后台状态结算；只有新 Round 全部成功后，才用它替换旧正文、派生状态和模型可见投影。失败时旧 Round 继续有效。它不保存或切换多个 Swipe，也不允许修改已有后续剧情的历史轮次。

## Background Agent

每个 Tavern Chat 共享的单一持久 Agent。它串行执行状态结算与候选生成，不直接拥有剧情权威。世界书由 Tavern 本地确定性投影，不进入后台 Agent。

## Background Operation

Background Agent 基于特定 Story Timeline branch/revision 执行的一项工作。运行时长本身不构成失败；operation 只有排队、运行、完成、失败、过期或取消等生命周期事实。

## Background Cycle

Foreground Turn 完成后产生、并与它属于同一 Round 的状态结算 Background Operation。世界书关键词匹配在本地完成，不创建 Background Operation。Background Cycle 成功前，当前 Round 不提交，也不能开始下一次 Foreground Turn。

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

Host 中管理酒馆脚本工作的排队、offer、显式 start、执行租约、分段超时和结果回执的 Module。它通过 Session Signal 唤醒浏览器执行器，但工作记录仍由自身持有；浏览器沙箱只能领取、确认开始并回执，不能凭 Signal 决定工作是否存在或完成。重复 claim 返回同一 offer，只有 start 确认后才开始计算执行超时。

## Tavern MVU Core

由 dsh-tavern 重新实现的 MVU 协议解析器和变量状态机。中文正式名称为“MVU 核心”；它读取模型原始输出、提取变量命令、计算楼层与 swipe 变量，并向酒馆脚本运行模块产生 MVU 生命周期事件。它不属于酒馆脚本运行模块。

## MVU Settlement Effect

酒馆脚本运行模块完成一次 MVU 结算后返回的、绑定 Background Operation 与 Story Timeline 版本的纯数据效果。它在浏览器执行阶段不写入 Chat；只有对应 Round 仍有效时，Background Task Coordinator 才把变量效果、Settlement Receipt、checkpoint 与新 revision 一次提交。中文正式名称为“MVU 结算效果”。

## MVU Settlement Reconciler

把持久化的 pendingSubmission 与当前酒馆脚本运行时状态重新协调的 Host Module。它在服务启动时扫描，在 Session Signal 唤醒时复查，并对瞬时读取或调度失败自动退避重试；pendingSubmission 才是待接续事实，浏览器就绪与 Signal 都只是触发复查的提示。中文正式名称为“MVU 结算协调器”。

## Prompt Template Runtime

由 dsh-tavern 重新实现的 ST Prompt Template/EJS 运行模块。中文正式名称为“提示词模板运行模块”；它在请求构造阶段处理模板、变量和提示词加工，不属于酒馆脚本运行模块。

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
