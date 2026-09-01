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

## Tavern MVU Core

由 dsh-tavern 重新实现的 MVU 协议解析器和变量状态机。中文正式名称为“MVU 核心”；它读取模型原始输出、提取变量命令、计算楼层与 swipe 变量，并向酒馆脚本运行模块产生 MVU 生命周期事件。它不属于酒馆脚本运行模块。

## Prompt Template Runtime

由 dsh-tavern 重新实现的 ST Prompt Template/EJS 运行模块。中文正式名称为“提示词模板运行模块”；它在请求构造阶段处理模板、变量和提示词加工，不属于酒馆脚本运行模块。

## Host Adapter（桥接层）

dsh-tavern 向酒馆脚本运行模块提供的宿主适配器。它把脚本对消息、变量、世界书、模型和展示的操作映射到 dsh-tavern 的权威状态、执行轨迹和 Projection。

## Stable Prefix

Internal Preset Projection 中拼在请求前部、后续请求保持稳定的部分。中文正式名称为“稳定前缀”。它不写入权威 Session 历史。

## Per-Turn Injection

Internal Preset Projection 中每轮根据当轮状态重新生成、只在该轮生效的部分。中文正式名称为“每轮注入”。它可以保存当轮快照以供追溯，但旧轮快照不会在后续请求中重复累积。

## Tail Content

Internal Preset Projection 中在发送模型请求前临时追加到末尾、但不写入 DSH Session 的部分。中文正式名称为“后带内容”。

## Script

用于引导故事主线的叙事资源，可以是小说、剧情大纲或故事素材。Script 可以暂未绑定；一份 Script 最多绑定一张人物卡，一张人物卡最多绑定一份 Script。

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
