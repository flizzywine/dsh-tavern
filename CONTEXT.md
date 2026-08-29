# DSH Tavern Domain

## Story Timeline

Tavern Chat 中唯一权威的剧情记录。它用单调递增的 revision、branch、checkpoint 和 operation 描述当前有效剧情；DSH Session、后台 Agent 与浏览器界面都是它的生产者或投影。

## Foreground Turn

玩家可见的一轮输入与正文回复。只有成功提交到 Story Timeline 的 Foreground Turn 才能推进剧情，并产生后续 Background Cycle。

## Background Agent

每个 Tavern Chat 共享的单一持久 Agent。它串行执行状态结算与候选生成，不直接拥有剧情权威。世界书由 Tavern 本地确定性投影，不进入后台 Agent。

## Background Operation

Background Agent 基于特定 Story Timeline branch/revision 执行的一项工作。运行时长本身不构成失败；operation 只有排队、运行、完成、失败、过期或取消等生命周期事实。

## Background Cycle

Foreground Turn 成功后产生的状态结算 Background Operation。世界书关键词匹配在本地完成，不创建 Background Operation，也不阻止下一次 Foreground Turn。

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

运行人物卡携带的 Tavern Helper、MVU、EJS 和其他 JavaScript 程序的独立模块。中文正式名称为“酒馆脚本运行模块”；它只认识酒馆脚本和酒馆宿主接口，通过 Host Adapter 与 dsh-tavern 隔离。

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
