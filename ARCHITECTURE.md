# dsh-tavern 架构

架构只服务于一件事：在需要时注入最少但足够的上下文，同时守住候选项、剧本模式和人物卡准备三个核心能力。

## 边界

DSH 负责通用 Agent 基础设施：会话、模型选择、工具调用、消息流和 Web 宿主。dsh-tavern 不复制这些能力，只负责文字游戏领域逻辑。

`tavern-plugin/lib/index.js` 是宿主适配层。它连接 DSH、文件存储、HTTP 和领域模块，但不自行决定正文与卡片上下文、剧本状态转换、候选格式或人物卡字段政策。

## 四个领域模块

| 模块 | 公开操作 | 唯一职责 |
| --- | --- | --- |
| Context Planner | `plan` | 按正文、候选项、卡片设定或素材抽取的用途，选择并组合本次必需的上下文，同时返回注入审计 |
| Script Continuity | `start`、`transition`、`inspect` | 维护剧本游标、回合参考、提交与回退；提供只读查看，不让调用方直接改内部状态 |
| Candidate Generator | `generate`、`find` | 独立生成、校验、重试和保存候选项；剧本模式下负责决定下一轮剧本游标 |
| Card Preparation | `create`、`update`、`present` | 统一人物卡导入、素材成卡、手动编辑、对话式修改和 SillyTavern 导出所使用的字段规则 |

## 关键规则

1. 正文、候选项和人物卡准备的上下文规则只在 Context Planner 和 Candidate Generator 中定义；宿主适配层只请求某种用途的上下文。
2. 剧本状态只能通过 Script Continuity 改变。查看剧本不推进游标，提交只确认本轮参考，候选项决定下一轮游标。
3. 人物卡的导入、编辑、Agent patch 和导出共享同一字段政策；未知字段明确失败，不能静默丢弃。
4. 候选项是独立调用和独立持久化结果，不混入正文，也不复用正文输出约束。
5. 领域模块不依赖 DSH 或文件系统。模型和存储通过小型适配器传入，因此可以直接做行为测试。

## 目录

```text
tavern-plugin/lib/
├── client.js                 Web 界面
├── index.js                  DSH、HTTP、存储适配层
└── domain/
    ├── candidate-generation.js
    ├── card-preparation.js
    ├── context-planner.js
    └── script-continuity.js
```

领域用语见 [CONTEXT.md](CONTEXT.md)，产品取舍以 [MISSION.md](MISSION.md) 为准。
