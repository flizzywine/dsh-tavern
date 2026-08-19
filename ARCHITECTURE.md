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
| Candidate Generator | `generate`、`find` | 生成、校验和保存候选项；剧本模式恢复同一个候选 Agent，在隔离上下文中自由读取剧本，只有显式 point 才能把下一轮游标向前定位 |
| Card Preparation | `create`、`update`、`present` | 统一人物卡导入、素材成卡、手动编辑、对话式修改和 SillyTavern 导出所使用的字段规则 |
| Turn Orchestrator | `prepare`、`stageChanges`、`finalize`、`discard`、`visibleTools` | 把 DSH 回合生命周期转换为酒馆上下文与状态变化；卡片修改先校验暂存，最终回复完成后统一提交 |

`Candidate Agent Runner` 是 DSH 适配器，通过 `run` 执行候选研究，并通过 `owns` 让宿主识别正在运行的候选会话。剧本模式首次生成时创建 `continuable` DSH 子 Session，之后通过 Session ID 恢复同一个候选 Agent；每轮完成后释放运行实例，但 Session、推理、工具调用和结果由 DSH 原生事件日志继续保存。自由故事仍使用一次性候选 Agent。

候选 Agent 是持久 Session、短时 Activation：只在生成期间占用运行资源，不使用会向正文父会话回送结算结果的 continuation manager。正文的上下文注入、状态结算和工具过滤必须跳过候选 Activation，保证两个锚点共享剧本方向但不共享消息流。候选 Session 的长上下文直接交给 DSH 原生 compact 处理。

## 关键规则

1. 正文、候选项和人物卡准备的上下文规则只在 Context Planner 和 Candidate Generator 中定义；宿主适配层只请求某种用途的上下文。
2. 剧本状态只能通过 Script Continuity 改变，且唯一进度变量是游标。查看剧本不改变游标；正文成功提交后游标前进一块；候选项只能通过显式 point 保持、向前跳转或进入结束位置，不能后退。
3. 人物卡的导入、编辑、Agent patch 和导出共享同一字段政策；未知字段明确失败，不能静默丢弃。
4. 剧本候选项由独立、可续接的 DSH 子 Agent 生成；同一游玩会话始终恢复同一候选 Session。它不混入正文，也不复用正文输出约束。候选查阅剧本产生的推理、工具调用和返回内容可从候选框或原生父子导航查看。
5. 候选上下文按稳定与动态分层：人物卡、固定任务和稳定世界书置前；每轮追加最新正文，并以最新 Guide、人物姿势和剧本窗口覆盖旧动态状态，提升缓存命中且避免旧状态污染。
6. 领域模块不依赖 DSH 或文件系统。模型和存储通过小型适配器传入，因此可以直接做行为测试。
7. 自由故事不暴露 Tavern 工具；剧本游玩只暴露剧本读取；卡片模式只暴露与当前准备任务有关的读取和修改工具。
8. 工具参数和输出使用结构化字段并严格校验，不用字符串包裹 JSON，也不让模型重复传递完整正文。

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
