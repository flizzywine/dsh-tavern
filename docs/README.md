# dsh-tavern 文档

## 权威文档

- [产品设计原则](product-design.md)：项目使命、核心体验，以及 Agent、上下文、生态组合、候选和剧本等产品取舍。
- [架构与领域语言](architecture.md)：统一术语、DSH seam、领域模块、适配器和关键规则。
- [TODO](todo.md)：当前优先级、后续功能与发布门槛。

## 设计与决策

- [`adr/`](adr/)：已经接受的关键架构决策。
- [`design/`](design/)：剧情时间线、剧本游标、状态栏、文风 Skill、[世界书召回](design/worldbook-recall.md)、[运行时预设](design/preset-library.md)、[正则三层语义备忘](design/regex-three-layer.md)、[DSH 对话内 HTML](design/html-in-dsh-messages.md)、[助手正文投影与内联 HTML 改造](design/inline-message-renderer-refactor.md)、[高 ROI 酒馆兼容功能](design/high-roi-sillytavern-compatibility.md)和[SillyTavern 生态翻译](design/sillytavern-translation.md)设计。
- [`specs/`](specs/)：产品规格，包括[卡片工作台](specs/card-workbench.md)以及[候选项容错与用户配置保留需求](specs/candidate-tolerance-and-user-config.md)。
- [`reviews/`](reviews/)：历史审查及实施记录，不作为当前架构入口。
- [`research/`](research/)：外部项目与兼容机制研究。统一入口见[参考项目库](research/reference-projects.md)，已有专题包括[梨园架构研究与借鉴范围](research/liyuan-architecture-reference.md)和[dsh-visualize HTML 嵌入机制](research/dsh-visualize-html-embedding.md)。研究结论用于设计取舍，不等同于已经实现或正式支持。

用户功能、演示和安装方式见项目 [README](../README.md)。
