# DSH 原生人物卡格式备忘

> 状态：方向备忘，尚未形成正式格式规范，也未实现。

## 核心定义

**DSH 原生人物卡**不是一段角色 Prompt，而是一份双 Agent 运行计划：

- **前台主 Agent**负责接收玩家输入并生成故事正文；
- **后台子 Agent**负责语义分析、状态结算、候选生成和工具调用；
- **权威剧情时间线与领域状态**负责两个 Agent 之间的同步；
- **展示器**把结构化状态和交互结果投影到玩家界面。

其目标是让前台主 Agent 保持纯粹的叙事能力，不向它暴露状态、UI、MVU 等工具，也不把后台工具调用轨迹塞进前台 Session。

## 核心原则：高级能力全部进入后台

正则、结构化格式、HTML、渲染、MVU、状态更新和候选项等高级能力，不再要求前台主 Agent 一边写正文一边完成。它们统一进入**后台能力层**：

```text
前台主 Agent：只生成正文
        ↓
后台能力工作流
    ├─ 确定性执行器：正则、HTML 编译、安全检查、Schema 校验、Patch 应用
    └─ 后台 Agent 工具：语义提取、状态提交、候选生成、View 发布
        ↓
权威状态与展示投影
        ↓
下一轮最小前台上下文
```

“进入后台”不等于所有能力都必须由模型主动决定。能确定执行的规则由后台工作流自动运行；只有需要理解剧情和作出语义判断的部分，才由后台子 Agent 调用工具。

## 基本结构

```yaml
format: dsh-character
version: 1

identity:
  name: "角色名"
  source: "可选的原始酒馆人物卡引用"

foreground:
  persona: "角色身份与行为原则"
  writing_rules: "叙事与文风要求"
  stable_context: []
  tools: []

background:
  instructions: "后台协作原则"
  capabilities:
    deterministic:
      - apply_display_regex
      - compile_html_view
      - validate_state_patch
    tools:
      - extract_structured_state
      - update_state
      - publish_view_model
      - publish_html_fragment
  tasks:
    - id: settle_turn
      trigger: after_reply
      inputs: [raw_reply, previous_state]
      tools: [update_state]

    - id: generate_choices
      trigger: after_settlement
      inputs: [raw_reply, current_state]
      tools: [publish_choices]

state:
  schema: {}
  initial: {}

views:
  - id: character_status
    source: state.character
    renderer: status-card

  - id: legacy_html
    source: presentation.html
    renderer: sandboxed-iframe

sync:
  foreground_context:
    - state.summary
    - state.current_scene
    - state.relationships
```

这只是表达领域结构的示意，不是最终字段设计。

## 回合生命周期

```text
玩家输入
  → 前台主 Agent 只生成正文 R
  → R 写入权威剧情时间线
  → 后台能力工作流读取 R、上一版状态和本轮任务
  → 确定性执行器处理正则、格式和安全检查
  → 后台子 Agent 按需调用状态、MVU、候选和展示工具
  → 后台工具提交状态补丁、候选和 View 数据
  → 程序校验并原子提交新的剧情 revision
  → 下一轮从权威状态生成最小前台上下文投影
```

后台子 Agent 不直接向前台主 Agent 发送聊天消息。它只能通过受控工具修改权威状态；前台下一轮读取的是程序生成的上下文投影，而不是后台 Session、后台推理或工具日志。

## 职责分配

| 内容 | 归属 |
|---|---|
| 人物身份、性格、叙事视角、文风 | 前台主 Agent |
| 玩家输入与故事正文 | 权威剧情时间线 |
| 常驻人物设定 | 前台稳定上下文 |
| 动态世界书匹配 | 确定性运行时 |
| 展示正则匹配与替换 | 后台确定性执行器 |
| HTML 编译、安全策略与 iframe 文档 | 后台展示执行器与 View renderer |
| 状态理解与结算 | 后台任务 |
| 状态写入 | 后台工具 |
| MVU 语义理解 | 后台任务 |
| MVU Patch 校验与应用 | 后台工具与确定性执行器 |
| 候选项生成 | 后台任务与候选工具 |
| 状态栏、地图、物品栏、选项 UI | View renderer |
| 后台完整日志与工具轨迹 | 后台 Session，不进入前台 |
| 下一轮必要状态 | 前台上下文投影 |

确定性规则不应为了“Agent 化”而改成模型任务。关键词匹配、排序、正则替换、Schema 校验和状态补丁应用等能够由程序确定完成的工作，继续由编译器或运行时负责；只有需要理解剧情含义和作出判断的工作才交给后台子 Agent。

## 后台能力层

后台能力层由三部分组成：

1. **后台任务**：描述何时需要完成什么目标。
2. **确定性执行器**：运行不需要模型判断的规则。
3. **后台工具**：限制后台子 Agent 可以提交什么结构化结果。

三者不能混成一个任意脚本环境。任务负责调度，执行器负责确定性变换，工具负责受控写入。

### 后台任务

后台任务描述“什么时候需要完成什么目标”，例如：

- 本轮正文结束后更新人物状态；
- 状态结算完成后生成候选项；
- 正文被重新生成后废弃旧结算并重新执行；
- 玩家主动打开某个面板时补充展示数据。

### 确定性执行器

确定性执行器由后台工作流自动调用，不要求后台子 Agent 判断“要不要运行”：

- `apply_display_regex`：按声明顺序生成展示投影；
- `apply_prompt_regex`：生成下一轮上下文投影；
- `compile_html_view`：把展示结果编译成受限 HTML 文档；
- `validate_state_patch`：校验状态或 MVU Patch；
- `apply_state_patch`：原子应用已验证的 Patch；
- `sanitize_view_resource`：执行 HTML、脚本和外部资源安全策略。

单条正则、HTML 或 Patch 失败只产生该能力的诊断和回退结果，不能拖垮正文或整个后台周期。

### 后台工具

后台工具描述后台子 Agent 被允许提交什么结果，例如：

- `extract_structured_state`
- `update_character_state`
- `update_world_state`
- `apply_mvu_patch`
- `publish_choices`
- `publish_view_model`
- `publish_html_fragment`
- `record_continuity_warning`

工具参数必须有 Schema。工具只提交候选变更，Host 负责校验剧情 branch、revision、来源正文 hash 和状态版本；依据过期、字段非法或整体验证失败时不得产生半更新状态。

渲染工具不直接操作前端 DOM。它只发布结构化 View Model 或受限 HTML fragment；Client renderer 根据声明的 View 类型完成真正展示。

## 前后台同步原则

后台完整状态可能很大，不能每轮全部同步到前台。人物卡应声明前台实际需要的投影：

```text
后台权威状态
  → 选择必要字段
  → 生成稳定摘要或结构化片段
  → 注入下一轮前台上下文
```

同步遵守以下规则：

1. 前台主 Agent 看不到后台工具定义和调用轨迹。
2. 后台结果只有通过 Host 校验并提交后才能进入下一轮上下文。
3. 展示数据默认不等于前台上下文；好看的 UI 不应自动送模。
4. 每项结果绑定 `{branchId, revision, sourceHash}`，回退或重新生成后旧结果自动失效。
5. 后台失败不删除、不改写、也不阻塞已经完成的正文。
6. 正则、HTML、MVU 和渲染工具的调用轨迹只保留在后台 Session。

## 从酒馆人物卡翻译

酒馆人物卡是源格式，DSH 原生人物卡是编译目标。导入时应保留完整原始文件，再通过统一中间表示分类翻译：

| 酒馆资产 | DSH 原生产物 |
|---|---|
| description、personality、scenario | 前台人物上下文 |
| system prompt、写作要求 | 前台规则或 DSH 预设 |
| 常驻世界书 | 稳定上下文 |
| 动态世界书 | 确定性召回规则 |
| 状态更新协议 | 后台结算任务与状态工具 |
| 候选项要求 | 后台候选任务 |
| 显示正则 | 后台确定性正则执行器与展示投影 |
| HTML 状态栏 | 后台 HTML 发布能力与 View renderer |
| MVU 更新 | 后台状态 Schema、MVU 工具、Patch 执行器与迁移规则 |
| EJS、Tavern Helper、复杂脚本 | 受限兼容模块，或标记无法原生翻译 |

不能把任意正则机械翻译成工具。正则描述的是“输出后如何变换文本”，工具描述的是“模型主动提交什么结构化行为”，两者语义不同。只有能识别出明确状态协议、字段和生命周期时，翻译器才可以提出工具化建议；语义不确定时继续使用兼容层并给出诊断。

## 编译产物与诊断

编译器应输出：

- DSH 原生人物卡；
- 前台上下文模块；
- 后台任务、确定性执行器与工具声明；
- 状态 Schema 与初始状态；
- View 声明；
- 尚未原生翻译的兼容资产；
- 翻译诊断报告。

诊断至少区分：

- 已无损翻译；
- 已近似翻译，行为可能变化；
- 仍由兼容层运行；
- 需要用户确认；
- 当前不支持。

原始酒馆人物卡始终保留。DSH 原生人物卡是带有源文件 hash、编译器版本和诊断信息的可重新生成产物，不取代原始文件。

## 非目标

- 不让前台主 Agent 同时写正文、填状态表和生成 UI。
- 不向前台主 Agent 暴露正则、HTML、渲染、MVU 或候选工具。
- 不把后台工具调用复制到前台 Session。
- 不为每个后台任务创建一个新的无状态 Agent；默认由一个持续存在的后台子 Agent 按任务模式工作。
- 不把所有规则都改成 Agent 判断。
- 不承诺任意酒馆脚本都能自动变成 DSH 原生工具。

## 尚待决定

1. DSH 原生人物卡是独立文件，还是人物卡 raw 中的扩展命名空间。
2. 后台任务、工具、状态和 View 是否分别版本化。
3. 前台上下文投影由人物卡声明字段，还是由独立策略模块生成。
4. 后台结算是同步等待、异步补充，还是按任务分别选择。
5. 原生 View 使用固定组件目录、声明式 UI，还是允许受限 iframe。
6. 酒馆人物卡自动翻译到什么程度后必须要求用户确认。
