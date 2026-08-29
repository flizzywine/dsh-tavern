# 编排策略、酒馆脚本运行模块与 Host Adapter

> 状态：目标架构与当前实现映射。本文定义长期模块关系，不把尚未落地的物理拆分写成完成状态。

## 一句话结论

dsh-tavern 不是把 SillyTavern、酒馆助手或 MVU 原程序嵌入系统，而是重新实现人物卡所依赖的可观察语义：两种编排策略决定一轮游戏如何运行；原生 modules 解释静态资源和确定性协议；酒馆脚本运行模块执行人物卡 JavaScript；Host Adapter（桥接层）把脚本的酒馆宿主调用转换成 dsh-tavern 原生行为。

```text
人物卡 / 世界书 / 预设 / 正则 / 脚本
                    ↓
               编排策略
         ┌──────────┴──────────┐
         ↓                     ↓
普通游玩编排策略          兼容编排策略
         └──────────┬──────────┘
                    ↓
        ┌───────────┴───────────┐
        ↓                       ↓
原生 modules              酒馆脚本运行模块
人物卡/世界书/宏              ↕ Host interface
正则/EJS/MVU              Host Adapter（桥接层）
        ↓                       ↓
        └───────────┬───────────┘
                    ↓
       dsh-tavern 权威状态 / DSH Runtime / UI
```

## 核心判断

### 普通游玩与兼容模式是两种编排策略

它们决定如何组织一次游玩，不是两套互相隔离的资源系统。

- **普通游玩编排策略**以持续 DSH Session 和增量 Frame 为核心，原生解释人物卡、世界书、宏、正则和预设。
- **兼容编排策略**按 SillyTavern 的可观察语义重建完整请求，处理 Prompt Order、历史重排、精确注入位置和旧卡的单前台模型输出协议。

两种策略可以调用同一套原生 modules，也可以按需调用同一个酒馆脚本运行模块。

### 酒馆脚本运行模块也是 dsh-tavern 的实现

酒馆脚本运行模块不是原版 SillyTavern 扩展系统，也不是把酒馆助手完整搬进 dsh-tavern。它由 dsh-tavern 重新实现，只复刻人物卡脚本能够观察到的运行环境：

- 脚本加载与生命周期；
- 每脚本一个常驻、事件驱动的 iframe；
- Tavern Helper 风格的函数和事件；
- 常见 JavaScript、Vue、jQuery、Lodash 等依赖；
- 脚本按钮、Popup、错误和 UI 生命周期；
- 外部 `import` 与资源加载。

人物卡脚本看到的是酒馆形状的宿主接口，不应该知道底层宿主已经替换成 dsh-tavern。

### Host Adapter 承担“李代桃僵”

Host Adapter 是酒馆脚本运行模块与 dsh-tavern 之间唯一公开的 seam。

```text
人物卡脚本调用：getVariables / setChatMessages / getWorldbook
                              ↓
                    酒馆形状的 Host interface
                              ↓
                          Host Adapter
                              ↓
             DSH 消息楼层 / swipe / 状态仓库 / 世界书仓库
```

Host Adapter 负责翻译和执行，不只是转发：

- 把 DSH 消息投影成酒馆消息、楼层和 swipe；
- 把脚本变量读写映射到对应消息快照、聊天变量或脚本变量；
- 把世界书操作映射到 dsh-tavern 的世界书仓库；
- 把脚本事件接入 dsh-tavern 的回合生命周期；
- 把 Popup、按钮和消息 UI 映射到 dsh-tavern 的 Presentation；
- 拒绝或降级无法安全、准确表达的酒馆行为。

权威状态始终属于 dsh-tavern。脚本运行模块不能建立第二份聊天历史、变量数据库或世界书仓库。

## 模块职责

### 编排策略

编排策略决定本轮调用顺序和上下文组织方式，包括：

- 读取哪些资源；
- 如何构造前台输入；
- 是否重建完整 SillyTavern 请求；
- 何时调用 MVU、正则和脚本；
- 如何保存正文与本轮状态。

编排策略不实现具体的 MVU 命令、EJS 语法或 Helper 函数。

### 原生资源 modules

能够确定性解释的能力由 dsh-tavern 原生实现，不经过 Host Adapter：

| Module | 职责 |
| --- | --- |
| Character Card | 读取和保存人物卡字段与扩展数据 |
| Worldbook | 召回、冷却、持久化和条目管理 |
| Macro Engine | 解析当前支持的宏 |
| Regex Engine | 处理提示词与显示文本转换 |
| Prompt Template Runtime | 执行 ST Prompt Template/EJS 的受支持语义 |
| MVU Core | 初始化变量、解析模型补丁、计算变量并产生生命周期事件 |

这些 modules 可以模仿酒馆生态协议，但它们仍然是 dsh-tavern 自己的实现。

### MVU Core

MVU Core 不属于酒馆脚本运行模块。它在 dsh-tavern 的回合结算路径中运行：

```text
前台 LLM 原始输出
  → 提取 JSON Patch / lodash 风格命令
  → 基于上一楼层变量计算新变量
  → 发出 MVU 生命周期事件
  → 允许人物卡脚本检查或修正
  → 保存到当前助手消息及对应 swipe
```

它负责 MVU 协议与变量状态机；人物卡专属脚本只是在相应事件上执行自己的业务逻辑。

### Prompt Template Runtime

Prompt Template Runtime 负责 EJS 模板、模板变量和提示词加工。它运行在请求构造阶段，产物交给当前编排策略继续组织。

它不是浏览器 iframe 中的常驻脚本，也不需要通过 Host Adapter 访问 dsh-tavern。

### 酒馆脚本运行模块

酒馆脚本运行模块只承接必须实际执行的卡片 JavaScript，例如：

- Tavern Helper 人物卡脚本；
- 变量守卫；
- 人物卡专属动态世界书管理脚本；
- 变量结构、按钮、Popup 和交互 UI 脚本；
- 监听 MVU 或消息事件的其他脚本。

它不负责：

- 解析 MVU 文本协议；
- 决定世界书召回规则；
- 编译完整模型请求；
- 保存 DSH 权威状态；
- 管理 DSH Agent Session。

### DSH Runtime

DSH Runtime 负责通用 Agent Harness：

- Session 和追加式执行轨迹；
- 模型与工具调用；
- 流式、重试、取消、压缩和恢复；
- 前台与未来后台 Agent 的运行。

DSH Runtime 不需要理解酒馆脚本接口、MVU 标签或人物卡扩展格式。这些领域语义由 dsh-tavern modules 解释后，再投影成 DSH 可以消费的 Frame 或行动。

## 酒馆脚本的完整运行链路

### 加载

```text
1. dsh-tavern 读取人物卡 extensions.tavern_helper.scripts
2. 筛选启用的卡片脚本并准备初始脚本变量
3. Session View 向浏览器发布脚本清单和宿主状态投影
4. 酒馆脚本运行模块为每个脚本建立独立 iframe
5. iframe 注入依赖、酒馆形状的 Host interface 和人物卡代码
6. 脚本顶层代码执行一次，随后常驻等待事件
```

每个脚本拥有独立 JavaScript 全局环境。所谓“持续运行”是常驻、事件驱动，而不是持续占用 CPU 循环执行。

### 事件

```text
dsh-tavern / MVU Core 产生事件
  → 酒馆脚本运行模块取得事件与上下文
  → 依次投递给各脚本 iframe
  → 脚本 eventOn(...) 监听器执行
  → 修改后的事件参数返回调用方
```

典型事件包括消息发送、消息接收、切换 swipe、删除消息和 MVU 变量更新。

### 宿主调用

```text
脚本调用 Tavern Helper 风格函数
  → iframe 向父页面发送结构化请求
  → 酒馆脚本运行模块校验调用来源和方法
  → Host Adapter 转换成 dsh-tavern 行动
  → dsh-tavern 写入权威状态
  → 最新投影返回 iframe
```

脚本执行没有统一的“最终返回值”。结果可能表现为：

- 消息、变量、swipe 或世界书发生持久化变化；
- 事件参数被修改；
- iframe 中出现 Popup 或交互 UI；
- 产生错误和运行诊断。

## MVU 与人物卡脚本如何配合

```text
LLM 输出 <JSONPatch> 等协议文本
            ↓
       MVU Core 解析
            ↓
发出 updateStarted / commandParsed / updateEnded 等事件
            ↓
酒馆脚本运行模块投递给人物卡脚本
            ↓
变量守卫、动态世界书等脚本执行
            ↓
通过 Host Adapter 请求修改 DSH 状态
            ↓
MVU Core 保存最终楼层变量快照
```

因此：

- MVU Core 是协议解析器和变量状态机；
- 酒馆脚本运行模块是 JavaScript 执行容器；
- 人物卡脚本是卡片专属业务程序；
- Host Adapter 是酒馆宿主语义到 dsh-tavern 原生行为的翻译者。

## 两种编排策略如何复用这些 modules

### 普通游玩编排策略

```text
原生读取人物卡、世界书、宏、正则和模板
  → 构造 ForegroundFrame
  → 追加到持续 DSH Session
  → 前台 Agent 生成正文
  → MVU Core 解析变量协议
  → 按需触发人物卡脚本
  → 保存正文与状态
```

它不会因为运行 MVU 卡或 Helper 脚本，就退回完整酒馆请求编译。

### 兼容编排策略

```text
读取人物卡、世界书、预设、历史和模板
  → 按 SillyTavern 可观察语义重建完整请求
  → 前台模型按旧卡协议生成正文、状态标签和 UI 数据
  → MVU Core、正则和人物卡脚本继续处理结果
  → 映射回 dsh-tavern 权威状态
```

它与普通游玩共享 MVU Core、Prompt Template Runtime、Regex Engine 和酒馆脚本运行模块；区别只在本轮如何编排上下文与模型调用。

## 当前实现映射

| 架构概念 | 当前实现 | 状态 |
| --- | --- | --- |
| 普通游玩编排策略 | `ForegroundFrameBuilder`、`Turn Orchestrator`、持续 DSH Session | 已有主要链路 |
| 兼容编排策略 | `compileCompatibilityTurn` 与临时 provider request 投影 | 已有主要链路，仍散落在 `index.js` |
| MVU Core | `Tavern MVU Runtime` | 已有；宿主原生重实现 |
| Prompt Template Runtime | Prompt Template/EJS 相关 domain modules | 已有受支持语义 |
| 酒馆脚本运行模块 | 卡片脚本读取、浏览器 iframe runtime、事件投递 | 已有能力，尚未物理收敛为独立 module |
| Host Adapter | Helper 上下文投影、消息/变量/世界书 mutation、UI 与事件桥接 | 已有子集，当前散落在客户端桥和服务端 domain modules |
| DSH Runtime | Session、模型和工具 Harness | 已有 |

## 架构不变量

1. 普通游玩和兼容模式只是两种编排策略。
2. 酒馆脚本运行模块、MVU Core 和 Prompt Template Runtime 都由 dsh-tavern 实现。
3. MVU Core 与 Prompt Template Runtime 不属于酒馆脚本运行模块。
4. 酒馆脚本运行模块只执行人物卡 JavaScript，并呈现酒馆形状的宿主接口。
5. 酒馆脚本运行模块不得认识 DSH 数据结构或直接写入 dsh-tavern 仓库。
6. 脚本产生的宿主操作必须经过 Host Adapter。
7. dsh-tavern 始终拥有消息、变量、世界书和剧情时间线的权威状态。
8. 原生人物卡、世界书、宏、正则、EJS 和 MVU modules 不绕行 Host Adapter。
9. 精确酒馆请求重建只属于兼容编排策略。
10. 新增脚本能力不能破坏 DSH 的追加式 Session、工具轨迹和上下文压缩。

## 后续物理收敛

1. 把浏览器脚本加载、iframe 生命周期、事件投递和错误诊断收进酒馆脚本运行模块。
2. 为酒馆脚本运行模块定义小而稳定的 Host interface。
3. 把客户端消息桥、服务端 RPC 和状态转换收敛成 Host Adapter 的实现。
4. 保持 MVU Core、Prompt Template Runtime 和原生资源 modules 独立。
5. 将兼容请求编译从 `index.js` 收进兼容编排策略，不与脚本执行混合。

## 相关文档

- [酒馆指令到 DSH Frame 改造方案](foreground-frame-migration-plan.md)
- [LLM-Harness 架构](llm-harness-architecture.md)
- [酒馆单 Agent 协议与 DSH 前后台 Agent 架构](tavern-single-agent-vs-dsh-dual-agent.md)
- [跨 Agent 剧情时间线设计](agent-timeline.md)
- [酒馆能力在 LLM Harness 中的重新安置](tavern-capabilities-in-llm-harness.md)
- [历史方案：酒馆超集设计](tavern-superset-compatibility-layer.md)
