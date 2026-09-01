# dsh-tavern 文档

## 权威文档

- [产品设计原则](product-design.md)：项目使命、核心体验，以及 Agent、上下文、生态组合、候选和剧本等产品取舍。
- [软件不是代码的集合](software-is-experience.md)：AI 加速实现之后，真实体验、反复测试与产品打磨仍由人完成。
- [架构与领域语言](architecture.md)：统一术语、DSH seam、领域模块、适配器和关键规则。
- [TODO](todo.md)：当前优先级、后续功能与发布门槛。

## 设计与决策

- [`adr/`](adr/)：已经接受的关键架构决策。
- [`design/`](design/)：剧情时间线、剧本游标、状态栏、文风 Skill、[编排策略与酒馆脚本运行模块架构](design/orchestration-strategies-and-tavern-script-module.md)、[官方 MVU 本地运行时迁移方案](design/official-mvu-runtime-migration.md)、[MVU 只结算、不注入前台备忘](design/mvu-settlement-only-memo.md)、[持久化状态视图 Runtime 改造方案](design/persistent-status-view-runtime.md)、[LLM-Harness 架构总纲](design/llm-harness-architecture.md)、[当前纯兼容模式阶段备忘](design/tavern-pure-compatibility-phase-memo.md)、[酒馆能力在 LLM Harness 中的重新安置](design/tavern-capabilities-in-llm-harness.md)、[世界书召回](design/worldbook-recall.md)、[运行时预设](design/preset-library.md)、[酒馆预设到 DSH 原生预设转换协议](design/tavern-to-dsh-preset-conversion.md)、[单会话可追溯压缩](design/context-compaction-drilldown.md)、[正则三层语义备忘](design/regex-three-layer.md)、[DSH 对话内 HTML](design/html-in-dsh-messages.md)、[助手正文投影与内联 HTML 改造](design/inline-message-renderer-refactor.md)、[高 ROI 酒馆兼容功能](design/high-roi-sillytavern-compatibility.md)和[SillyTavern 生态翻译](design/sillytavern-translation.md)设计。
- [`specs/`](specs/)：产品规格，包括[卡片工作台](specs/card-workbench.md)、[候选项容错与用户配置保留需求](specs/candidate-tolerance-and-user-config.md)以及[场景配图功能草案](specs/scene-illustration.md)。
- [`reviews/`](reviews/)：历史审查及实施记录，不作为当前架构入口。
- [`research/`](research/)：外部项目、兼容机制、产品判断与故障研究。统一入口见[参考项目库](research/reference-projects.md)，已有专题包括[《灯火阑珊》MVU 兼容链路验收](research/lighthouse-mvu-compatibility-e2e-2026-08-28.md)、[强烈而旺盛的角色扮演游戏需求备忘](research/roleplaying-demand-memo.md)、[酒馆预设兼容边界备忘](research/preset-compatibility-boundary-memo.md)、[酒馆正则如何把 `【首页】` 变成可交互卡片](research/sillytavern-regex-rendering-memo.md)、[梨园架构研究与借鉴范围](research/liyuan-architecture-reference.md)、[dsh-visualize HTML 嵌入机制](research/dsh-visualize-html-embedding.md)以及[Windows 聊天落盘、候选失败与后台压缩排查报告](research/windows-chat-persistence-and-background-compaction-diagnosis-2026-08-27.md)。研究文档通常只提供证据；其中正则渲染备忘已由对应设计明确采纳为兼容基线。

用户功能、演示和安装方式见项目 [README](../README.md)。
