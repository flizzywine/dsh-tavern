# DSH Tavern MVU 配方

供实施转换时使用。以下是与题材无关的小样例，依据已跑通的“正文 → 后台工具结算 → 右侧只读视图”路线；变量名和视觉样式应替换为目标卡自己的字段。无需外部 MVU URL、动态插件或额外 Zod 库。

## 初值与后台规则

下面是外部 V3 卡 `data.character_book.entries` 的两个条目；若目标已含世界书则合并，并分配不冲突的 ID，保留其他条目。`[initvar]` 的 content 是 JSON 字符串（JSON 对象也可表达这里使用的 YAML 初值）。对象本身不额外套 `stat_data`。

```json
[
  {
    "id": 0,
    "keys": [],
    "comment": "[initvar]状态初值",
    "enabled": false,
    "constant": false,
    "insertion_order": 100,
    "content": "{\"场景\":{\"地点\":\"入口\"},\"玩家\":{\"位置\":\"门口\"},\"人物\":{\"$meta\":{\"extensible\":true,\"template\":{\"姓名\":\"\",\"位置\":\"未明确\",\"在场\":true}}}}",
    "extensions": {}
  },
  {
    "id": 1,
    "keys": [],
    "comment": "[mvu_update]状态更新规则",
    "enabled": true,
    "constant": true,
    "insertion_order": 100,
    "content": "只依据本轮已经发生的正文事实与当前变量快照更新。场景.地点和玩家.位置为字符串，仅在正文确认移动后改变；想去、准备去不算移动。人物是按姓名索引的可扩展对象，新增时用 insert 提交完整对象，字段为姓名、位置（字符串）、在场（布尔值）；未知位置用未明确，离场设在场为 false 并保留档案。用 mvu_submit_update 提交，路径相对于 stat_data，例如 /玩家/位置；无变化提交空 operations。不要输出 HTML 或变量协议文本。",
    "extensions": {}
  }
]
```

关键约定：

- DSH 按世界书条目 `comment`（投影层也兼容 title/name）的**前缀** `[mvu_update]` 分流；不是扫描正文中随意出现的标记。启用条目由后台读取，退出普通正文世界书注入。
- `[initvar]` 禁用的是普通条目注入，官方 MVU 初始化仍读取它。复制多个 initvar 前先查其合并语义，避免重复或冲突初值。
- `$meta.extensible` 和 `template` 用在预期能新增成员的集合。固定根对象不必全部开放；新对象按模板提交完整字段，不让后台猜结构。
- 若保留原卡 Zod 结构脚本，需使新增字段符合该脚本，不能以初值模板替代既有校验约束。只维护一套明确的校验来源。
- 初始化与 UI 都使用 `stat_data`，但后台工具操作路径是 `/玩家/位置`，不是 `/stat_data/玩家/位置`。路径键含 `~` 或 `/` 时用 JSON Pointer 的 `~0`、`~1` 转义。
- 数值 `delta` 的正值表示增加、负值表示减少。只有原卡存在该数值与变化规则时才使用。

后台实际提交形状示例（不是正文输出内容）：

```json
{
  "analysis": "正文确认玩家已走进大厅。",
  "operations": [
    { "op": "replace", "path": "/玩家/位置", "value": "大厅" }
  ]
}
```

工具接收并不代表最终通过 Schema。以结算回执、保存后的变量和当前轮 UI 为准。宿主或配套脚本可能产生派生变量，其差异数不一定等于 LLM 的 operations 数。

## 一次入口，显示与历史分离

可给每个开场的末尾放一次 `<mvu-status/>`。使用有辨识度、不与原卡冲突的入口名；改名时同步正则。以下是 `data.extensions.regex_scripts` 的**新增条目**，不要覆盖原有无关正则。`replaceString` 由完整 HTML 组装，不能留成文件路径或占位文字。

```js
const statusRegex = [
  {
    id: 'mvu-status-view', scriptName: 'MVU 状态视图',
    findRegex: '/<mvu-status\\s*\\/>/g',
    replaceString: '```html\n' + statusHtml + '\n```',
    placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true
  },
  {
    id: 'mvu-status-hide-marker', scriptName: '隐藏模型历史中的状态入口',
    findRegex: '/\\n*<mvu-status\\s*\\/>/g', replaceString: '',
    placement: [2], disabled: false, markdownOnly: false, promptOnly: true, runOnEdit: true
  }
];
```

合并 `extensions.tavern_helper` 时保留已有脚本与变量。新建简单卡可以是 `{ "scripts": [], "variables": {} }`；`[initvar]` 提供 MVU 资源识别线索，不需要加入假的核心脚本来启用功能。

正文提示字段按 SKILL.md 的“正文”步骤清理旧状态输出要求，不添加运行说明。这里的占位符与 HTML 是展示资源，不是给正文模型的指令；由上述显示正则和 promptOnly 正则分离处理。

## 只读视图生命周期

优先保留原卡布局，将硬编码/模型插值换成 MVU 读取。可改造本 Skill 的 `assets/status.html`；它是通用字段树，仅适合作为数据打通起点。

初始化过程：等待 `waitGlobalInitialized('Mvu')` → 注册事件 → 主动 render 一次。每次 render 都重新读取：

```js
const data = Mvu.getMvuData({ type: 'message', message_id: 'latest' }).stat_data;
```

读取该 API 是 DSH 识别 MVU 视图并提升到右侧持久状态面板的信号，不只是在正文画一个 HTML 框。不能只在启动时读一次快照后一直用旧对象。

已验证的简易订阅方式是：去重订阅 `Mvu.events.VARIABLE_INITIALIZED`、`Mvu.events.VARIABLE_UPDATE_ENDED` 和 `Object.values(tavern_events)`，回调只重绘。这样同时覆盖结算与消息恢复事件；复杂卡可缩小订阅集合，但应验证回退/重新生成。

使用 `textContent`、DOM 节点和自身 CSS；跳过 `$meta` 等内部字段。避免将变量字符串赋给 `innerHTML`。保持高度自然展开、背景/文字对比清晰，不依赖宿主暗色主题或阴影。原卡确需内部独立滚动区时再保留该交互。

## 验证边界

这条路线的首张航空测试副本已验证：导入、官方初始化、后台真实结算、右侧显示；宿主修复 `3e5a4fd` 后用户确认自动刷新，回退自动刷新此前亦已验证。它不是任意题材、复杂脚本、多开场或原生 SillyTavern 的全覆盖证明。

交付另一张卡时仍完成其自己的字段映射与验收；遇到宿主缺陷说明已知原因，不在卡片中加入一套重复运行时。
