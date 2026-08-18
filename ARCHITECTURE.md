# dsh-tavern 架构

架构只服务于一件事：在需要时注入最少但足够的上下文，同时守住候选项、剧本模式和人物卡准备三个核心能力。

## 边界

DSH 负责通用 Agent 基础设施：会话、模型选择、工具调用、消息流和 Web 宿主。dsh-tavern 不复制这些能力，只负责文字游戏领域逻辑。

`tavern-plugin/lib/index.js` 是宿主适配层。它连接 DSH、文件存储、HTTP 和领域模块，但不自行决定正文与卡片上下文、剧本状态转换、候选格式或人物卡字段政策。

`tavern-plugin/lib/prompt-catalog.js` 是固定提示词的文件适配层。领域模块只通过注入的 `prompt` 读取提示词，不直接依赖文件系统；动态上下文仍由 Context Planner 选择和组合。

正常回合不要求模型调用工具来“读取上下文”或“提交正文”。DSH 在生成前触发上下文准备，在最终回复完成后触发状态提交；模型只负责生成一次回复。工具只保留模型确实需要临时决定的动作：按需读取剧本、按需读取世界书，以及用户确认后修改人物卡。

## 领域模块与 DSH 适配器

| 模块 | 公开操作 | 唯一职责 |
| --- | --- | --- |
| Context Planner | `plan` | 按正文、候选项、卡片设定或素材抽取的用途，选择并组合本次必需的上下文，同时返回注入审计 |
| Script Continuity | `start`、`transition`、`inspect` | 维护剧本游标、回合参考、提交与回退；提供只读查看，不让调用方直接改内部状态 |
| Candidate Generator | `generate`、`find` | 单次生成、校验和保存候选项，失败时不自动创建新 Agent；剧本模式在隔离上下文中按块号或关键词自由读取剧本，候选成功后自动把最后一次成功读取的位置提交为下一轮游标 |
| Card Preparation | `create`、`update`、`present` | 统一人物卡导入、素材成卡、手动编辑、对话式修改和 SillyTavern 导出所使用的字段规则 |
| Turn Orchestrator | `prepare`、`stageChanges`、`finalize`、`discard`、`visibleTools` | 把 DSH 回合生命周期转换为酒馆上下文与状态变化；卡片修改先校验暂存，最终回复完成后统一提交 |

`Candidate Agent Runner` 是 DSH 适配器，通过 `run` 执行候选研究，并通过 `owns` 让宿主识别正在运行的候选会话。它为每次候选生成创建独立的一次性 DSH 子 Agent 和持久 Session，在该 Agent 的作用域内注册剧本研究工具；正文的上下文注入、状态结算和工具过滤必须跳过这些会话。运行结束后释放 Agent 实例，但推理、工具调用和工具结果继续由 DSH 原生事件日志长期保存。

## 关键规则

1. 正文、候选项和人物卡准备的上下文规则只在 Context Planner 和 Candidate Generator 中定义；宿主适配层只请求某种用途的上下文。
2. 剧本状态只能通过 Script Continuity 改变，且唯一进度变量是游标。查看剧本和提交正文都不强制推进；候选项根据正文实际演到的位置，让下一轮游标保持、后退、前进或结束。
3. 人物卡的导入、编辑、Agent patch 和导出共享同一字段政策；未知字段明确失败，不能静默丢弃。
4. 候选项由独立的一次性 DSH 子 Agent 生成，不混入正文，也不复用正文输出约束。候选查阅剧本产生的推理、工具调用和返回内容写入持久 Session，可从候选框进入原生父子导航查看；运行实例释放后轨迹仍然保留。
5. 领域模块不依赖 DSH 或文件系统。模型和存储通过小型适配器传入，因此可以直接做行为测试。
6. 自由故事不暴露 Tavern 工具；剧本游玩只暴露剧本读取；卡片模式只暴露与当前准备任务有关的读取和修改工具。
7. 工具参数和输出使用结构化字段并严格校验，不用字符串包裹 JSON，也不让模型重复传递完整正文。

## 目录

```text
tavern-plugin/lib/
├── client.js                 Web 界面
├── candidate-agent-runner.js 独立候选 Agent 的 DSH 适配器
├── index.js                  DSH、HTTP、存储适配层
├── prompt-catalog.js         固定提示词文件适配层
└── domain/
    ├── candidate-generation.js
    ├── card-preparation.js
    ├── context-planner.js
    ├── script-continuity.js
    └── turn-orchestration.js

tavern-plugin/prompts/        可独立编辑的固定提示词
```

领域用语见 [CONTEXT.md](CONTEXT.md)，产品取舍以 [MISSION.md](MISSION.md) 为准。
