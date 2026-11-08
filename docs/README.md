# dsh-tavern 文档

正式使用文档统一在 [GitHub Wiki](https://github.com/flizzywine/dsh-tavern/wiki)维护，登录 GitHub 即可直接编辑。此目录只保留工程设计、架构与历史研究资料，不再维护使用手册或网站副本。旧文档网站已停用。

## 权威文档

- [领域契约](../CONTEXT.md)：Story Timeline、前后台轮次和持久化边界的当前定义。
- [产品设计原则](product-design.md)：项目使命、核心体验，以及 Agent、上下文、生态组合、候选和剧本等产品取舍。
- [软件不是代码的集合](software-is-experience.md)：AI 加速实现之后，真实体验、反复测试与产品打磨仍由人完成。
- [插件生态](plugin-ecosystem.md)：开放插件接口，像市场汇总分散信息一样，把一个人想不到的巧思以插件形式吸收进来。
- [架构与领域语言](architecture.md)：统一术语、DSH seam、领域模块、适配器和关键规则。
- [舞台模组编写合同](mod-authoring.md)：新舞台模组的文件夹、清单、接口、文档与测试。
- [TODO](todo.md)：当前优先级、后续功能与发布门槛。

## 设计与决策

- [`adr/`](adr/)：已经接受的关键架构决策。
- [`design/`](https://github.com/flizzywine/dsh-tavern/wiki/%E5%BC%80%E5%8F%91%E8%80%85%EF%BC%9A%E8%AE%BE%E8%AE%A1%E6%96%87%E6%A1%A3)：剧情时间线、剧本游标、状态栏、文风 Skill、[大型人物卡机制工程化备忘](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Alarge-card-engineering-memo)（结算 Agent 自主检索变量与规则）、[从 LLM 游戏重新审视酒馆生态](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Arethinking-tavern-ecosystem-as-llm-games)、[Agent 自主上下文](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Aagent-owned-context)、[最后一轮整体替换](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Alast-round-replacement)、[编排策略与酒馆脚本运行模块架构](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Aorchestration-strategies-and-tavern-script-module)、[官方 MVU 本地运行时迁移方案](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Aofficial-mvu-runtime-migration)、[MVU 只结算、不注入前台备忘](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Amvu-settlement-only-memo)、[持久化状态视图 Runtime 改造方案](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Apersistent-status-view-runtime)、[LLM-Harness 架构总纲](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Allm-harness-architecture)、[当前纯兼容模式阶段备忘](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Atavern-pure-compatibility-phase-memo)、[酒馆能力在 LLM Harness 中的重新安置](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Atavern-capabilities-in-llm-harness)、[世界书召回](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Aworldbook-recall)、[运行时预设](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Apreset-library)、[酒馆预设到 DSH 原生预设转换协议](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Atavern-to-dsh-preset-conversion)、[单会话可追溯压缩](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Acontext-compaction-drilldown)、[正则三层语义备忘](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Aregex-three-layer)、[DSH 对话内 HTML](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Ahtml-in-dsh-messages)、[助手正文投影与内联 HTML 改造](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Ainline-message-renderer-refactor)、[高 ROI 酒馆兼容功能](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Ahigh-roi-sillytavern-compatibility)和[SillyTavern 生态翻译](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Asillytavern-translation)设计。
- [`specs/`](specs/)：产品规格，包括[卡片工作台](specs/card-workbench.md)以及[候选项容错与用户配置保留需求](specs/candidate-tolerance-and-user-config.md)。

用户功能和演示见项目 [README](../README.md)；安装、更新、数据备份及排错见[安装说明](https://github.com/flizzywine/dsh-tavern/wiki/%E5%AE%89%E8%A3%85%E3%80%81%E6%9B%B4%E6%96%B0%E4%B8%8E%E6%95%B0%E6%8D%AE%E5%A4%87%E4%BB%BD)。

v3.0 发布说明见 [变更记录](https://github.com/flizzywine/dsh-tavern/releases) 和 [完整提交清单](https://github.com/flizzywine/dsh-tavern/releases)。

## 查找资料

| 目录 | 用途 |
| --- | --- |
| [`design/references/`](https://github.com/flizzywine/dsh-tavern/wiki/%E5%BC%80%E5%8F%91%E8%80%85%EF%BC%9A%E8%AE%BE%E8%AE%A1%E6%96%87%E6%A1%A3) | Apple、Claude 的视觉参考，不作为项目架构规范 |
| [`testing/`](testing/) | 测试边界与方法；运行入口见 [测试目录说明](../tests/README.md) |
| [`releases/`](https://github.com/flizzywine/dsh-tavern/releases) | 历史版本发布记录 |

历史方案和验证记录保留当时的结论，不自动代表当前实现；当前行为优先核对领域契约、正式实现及对应测试。本地研究副本和临时请求快照已清理，受跟踪的报告与证据仍保留。
