# SillyTavern 世界书格式与执行语义

> 研究日期：2026-08-23  
> 源码基线：SillyTavern `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`；SillyTavern-Docs `70e5e4d3c239253fca4692fe82e3936cb9c4b1b1`。  
> 范围：只核对 SillyTavern 官方源码和官方文档。本文件描述的是当前实现事实，不代表 dsh-tavern 必须照搬其运行架构。

## 结论先行

1. **独立世界书与人物卡内嵌世界书是两种不同形状。** 独立文件以 `entries` 对象保存条目，字段多为 camelCase；人物卡的 `data.character_book` 以 `entries` 数组保存条目，核心字段使用 Character Card 规范名称，SillyTavern 的新增能力主要放在每条记录的 `extensions` 中。
2. **独立世界书文件的硬性要求很低。** 当前服务端导入只验证顶层存在 `entries`；新建文件甚至只有 `{ "entries": {} }`。文件名是资源 ID 的主要来源，顶层 `name`、`extensions` 会用于列表显示和扩展元数据，但不是导入必填项。[服务端导入与保存](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/worldinfo.js#L99-L156) [新建空世界书](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L4336-L4352)
3. **世界书的加载不是一次关键词过滤。** 它还包含来源合并、顺序、正则键、二级键逻辑、常驻、概率、包含组、递归、定时效果、token 预算、角色过滤、生成类型过滤、宏与显示正则、多个注入位置等语义。[官方文档](https://github.com/SillyTavern/SillyTavern-Docs/blob/70e5e4d3c239253fca4692fe82e3936cb9c4b1b1/Usage/worldinfo.md)
4. **兼容导入不等于立即复刻全部执行行为。** dsh-tavern 第一层应当无损保存原文件与未知字段，第二层再生成自己的稳定业务投影；未实现的酒馆语义必须明确标记，不能静默丢弃或假装等价。
5. **独立世界书库不应与人物卡绑定。** 世界书本身是独立资源；人物卡、会话、用户或全局启用关系应当放在单独的绑定层。人物卡内嵌 `character_book` 导入后可复制为一份独立资源，但原卡备份仍保持不动。

## 1. 独立世界书 JSON

### 1.1 顶层结构

SillyTavern 自己创建的最小文件是：

```json
{
  "entries": {}
}
```

当前源码对顶层字段的真实处理如下：

| 字段 | 当前含义 | 兼容策略 |
|---|---|---|
| `entries` | 必需；对象，键通常是字符串化 UID，值为条目对象 | 必须读取；不要假设对象键一定连续或等于数组下标 |
| `name` | 可选；列表优先把它作为展示名，否则使用文件名 | 保留；缺失时以导入文件名生成展示名 |
| `extensions` | 可选；列表接口原样作为扩展元数据返回 | 必须无损保留未知键 |
| `originalData` | 可选；从人物卡内嵌世界书导入时，SillyTavern 用它保留原始 `character_book`，以便以后再导出人物卡 | 视为兼容元数据，原样保存，不作为普通条目执行 |
| 其他未知字段 | 服务端不会主动剥离 | 原样透传 |

证据：世界书列表读取 `name` 与 `extensions`，获取接口返回整个 JSON；导入和编辑只检查 `entries`，随后原样/整体写回。[`worldinfo.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/worldinfo.js#L17-L78) [`worldinfo.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/worldinfo.js#L99-L156)

特别注意：`scan_depth`、`token_budget`、`recursive_scanning` 是人物卡 `character_book` 规范中的顶层字段；当前独立世界书运行时主要使用账户级 World Info 设置和条目级覆盖，不应擅自把这些字段当成独立文件的权威运行配置。[CharacterBook 类型](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/types/spec-v2.d.ts#L25-L52) [运行时设置](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L65-L88)

### 1.2 独立条目的完整当前字段

下面以 SillyTavern 的新条目模板为准。`uid` 在创建时另行加入；`displayIndex`、`characterFilter`、`extensions` 等也可能存在于保存文件中。[默认字段定义](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L3994-L4070)

#### 身份、内容与启用

| 字段 | 类型 / 默认值 | 语义 |
|---|---|---|
| `uid` | integer | 书内条目 ID；对象键与它通常一致，但导入器不能依赖此假设 |
| `comment` | string / `""` | 标题或备注，不进入模型上下文 |
| `content` | string / `""` | 激活后进入提示词的正文 |
| `disable` | boolean / `false` | `true` 表示禁用 |
| `addMemo` | boolean / `false` | 编辑器显示行为；不是召回条件 |
| `displayIndex` | number / 通常为 UID 或导入顺序 | UI 展示顺序 |

#### 激活条件

| 字段 | 类型 / 默认值 | 语义 |
|---|---|---|
| `key` | string[] / `[]` | 主关键词；支持 `/pattern/flags` 形式的 JavaScript 正则 |
| `keysecondary` | string[] / `[]` | 二级关键词/可选过滤器 |
| `constant` | boolean / `false` | 常驻条目，无需关键词即可激活 |
| `vectorized` | boolean / `false` | 允许向量扩展将它作为无关键词候选；不禁止普通关键词匹配 |
| `selective` | boolean / `true` | 是否启用二级关键词逻辑 |
| `selectiveLogic` | 0/1/2/3，默认 0 | `0=AND_ANY`、`1=NOT_ALL`、`2=NOT_ANY`、`3=AND_ALL` |
| `probability` | number / `100` | 激活后通过的百分比 |
| `useProbability` | boolean / `true` | 是否执行概率过滤 |
| `scanDepth` | number\|null / `null` | 条目级扫描深度覆盖；`null` 使用全局深度 |
| `caseSensitive` | boolean\|null / `null` | 条目级大小写覆盖 |
| `matchWholeWords` | boolean\|null / `null` | 条目级整词匹配覆盖 |
| `matchPersonaDescription` | boolean / `false` | 额外扫描用户 Persona 描述 |
| `matchCharacterDescription` | boolean / `false` | 额外扫描人物描述 |
| `matchCharacterPersonality` | boolean / `false` | 额外扫描人物性格 |
| `matchCharacterDepthPrompt` | boolean / `false` | 额外扫描人物 Note/Depth Prompt |
| `matchScenario` | boolean / `false` | 额外扫描 Scenario |
| `matchCreatorNotes` | boolean / `false` | 额外扫描 Creator Notes |
| `triggers` | string[] / `[]` | 限制 Normal、Continue、Impersonate、Swipe、Regenerate、Quiet 等生成类型 |
| `characterFilter` | object | `{ names: string[], tags: string[], isExclude: boolean }`，限制或排除人物/标签 |

主键与二级键逻辑由源码逐条执行；有效正则键会覆盖普通大小写和整词选项。普通键才使用 `caseSensitive` / `matchWholeWords`。[匹配器](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L268-L366) [官方关键词说明](https://github.com/SillyTavern/SillyTavern-Docs/blob/70e5e4d3c239253fca4692fe82e3936cb9c4b1b1/Usage/worldinfo.md#key)

#### 排序、分组与预算

| 字段 | 类型 / 默认值 | 语义 |
|---|---|---|
| `order` | number / `100` | 激活与插入顺序；较大值最终更靠近上下文尾部、影响通常更强 |
| `group` | string / `""` | 包含组，可用逗号加入多个组；同组最终只保留一个赢家 |
| `groupOverride` | boolean / `false` | “优先包含”；同组中按最高 `order` 决定赢家 |
| `groupWeight` | number / `100` | 未强制优先时的随机权重 |
| `useGroupScoring` | boolean\|null / `null` | 先按关键词命中分数淘汰低分组员 |
| `ignoreBudget` | boolean / `false` | 该条不受世界书 token 预算限制 |

概率在条目已经被关键词、常驻或递归激活后再过滤；包含组先按 timed effects / key score / priority 或 weight 选择赢家；预算按全局上下文比例与绝对上限计算。[官方概率与包含组说明](https://github.com/SillyTavern/SillyTavern-Docs/blob/70e5e4d3c239253fca4692fe82e3936cb9c4b1b1/Usage/worldinfo.md#probability-trigger-) [源码预算与概率阶段](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L4870-L4978)

#### 递归与跨轮效果

| 字段 | 类型 / 默认值 | 语义 |
|---|---|---|
| `excludeRecursion` | boolean / `false` | 本条不能被其他条目的内容递归触发 |
| `preventRecursion` | boolean / `false` | 本条激活后，它的内容不再触发其他条目 |
| `delayUntilRecursion` | number\|boolean / `0` | 只在递归阶段激活；数值可表示递归层级 |
| `sticky` | number\|null | 激活后继续保持 N 条消息 |
| `cooldown` | number\|null | 激活后 N 条消息内不能再次激活；与 sticky 同用时在 sticky 结束后开始 |
| `delay` | number\|null | 对话不足 N 条消息前不得激活 |

Timed Effects 的单位是“消息数”，作用域是当前聊天，状态保存在聊天元数据中；修改条目、删除/滑动导致聊天不前进等情况会清理效果。[官方 Timed Effects](https://github.com/SillyTavern/SillyTavern-Docs/blob/70e5e4d3c239253fca4692fe82e3936cb9c4b1b1/Usage/worldinfo.md#timed-effects) [源码状态管理](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L479-L770)

#### 注入与扩展

| 字段 | 类型 / 默认值 | 语义 |
|---|---|---|
| `position` | 0–7 / `0` | `0` 人物定义前，`1` 人物定义后，`2` AN 顶部，`3` AN 底部，`4` 对话深度，`5` 示例消息前，`6` 示例消息后，`7` Outlet |
| `depth` | number / `4` | `position=4` 时的对话深度，0 最靠近提示词末尾 |
| `role` | 0/1/2 / `0` | `position=4` 时为 System/User/Assistant |
| `outletName` | string / `""` | `position=7` 时通过 `{{outlet::Name}}` 显式取用；无名称会跳过 |
| `automationId` | string / `""` | 与 Quick Replies/STscript 自动化联动 |
| `extensions` | object | 未知扩展数据；不是模板必填，但可能由卡片转换或扩展写入 |

位置枚举及最终分桶由源码明确实现；条目内容在进入对应位置前还会执行宏替换和 World Info 位置的正则处理。[位置枚举](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L855-L864) [最终分桶](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L5071-L5162) [官方位置说明](https://github.com/SillyTavern/SillyTavern-Docs/blob/70e5e4d3c239253fca4692fe82e3936cb9c4b1b1/Usage/worldinfo.md#insertion-position)

## 2. 人物卡内嵌 `character_book`

### 2.1 顶层与条目形状

人物卡中的路径是 `data.character_book`：

```json
{
  "name": "可选名称",
  "description": "可选说明",
  "scan_depth": 4,
  "token_budget": 1024,
  "recursive_scanning": true,
  "extensions": {},
  "entries": [
    {
      "id": 0,
      "keys": ["王都"],
      "secondary_keys": [],
      "comment": "王都",
      "content": "……",
      "constant": false,
      "selective": false,
      "insertion_order": 100,
      "enabled": true,
      "position": "before_char",
      "case_sensitive": false,
      "extensions": {}
    }
  ]
}
```

SillyTavern 自己的 V2 类型把 `extensions` 与 `entries` 作为 book 必需字段；条目核心字段为 `keys`、`content`、`extensions`、`enabled`、`insertion_order`，其余多为可选。[类型定义](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/types/spec-v2.d.ts#L25-L52) [验证器](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/validator/TavernCardValidator.js#L124-L140)

### 2.2 与独立条目的映射

| 独立世界书 | `character_book` |
|---|---|
| `uid` | `id` |
| `key` | `keys` |
| `keysecondary` | `secondary_keys` |
| `order` | `insertion_order` |
| `disable` | `enabled`（语义取反） |
| `position=0/1` | `position=before_char/after_char` |
| `comment/content/constant/selective` | 同义核心字段 |
| 大多数新字段 | `entry.extensions` 中的 snake_case 键 |

当前转换会把 `position`、递归标记、概率、深度、包含组、扫描覆盖、大小写、整词、角色、向量、Timed Effects、附加匹配源、生成类型、预算例外等写入 `extensions`；反向导入时再恢复为独立条目的 camelCase 字段。[独立世界书 → 卡片](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/characters.js#L663-L710) [卡片 → 独立世界书](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L5498-L5555)

### 2.3 不能忽略的差异

- `character_book.entries` 是数组，独立文件 `entries` 是对象。
- 卡片扩展字段使用 snake_case，但有历史例外：源码仍读取 `extensions.useProbability`、`extensions.selectiveLogic` 这两个 camelCase 键。
- `position` 的规范核心字段只能表达 `before_char` / `after_char`；SillyTavern 的 AN、Depth、Example、Outlet 位置必须依赖 `extensions.position`。
- 从卡片导入世界书时，SillyTavern 会在缺少 `id` 时以数组下标补 ID，并保存 `originalData`；以后把该世界书重新嵌入卡片时可优先恢复原结构。[导入内嵌世界书](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L5498-L5555) [人物卡导出优先恢复 `originalData`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/characters.js#L628-L640)
- 官方文档说明只有人物卡绑定的“主世界书”会随人物卡导出，额外绑定的世界书不会自动嵌入。[Character Lore](https://github.com/SillyTavern/SillyTavern-Docs/blob/70e5e4d3c239253fca4692fe82e3936cb9c4b1b1/Usage/worldinfo.md#character-lore)

## 3. 导入与导出兼容范围

### 原生 JSON

- 导入：只要 JSON 顶层有 `entries` 即被服务端接受，不会做完整字段校验或归一化。
- 编辑加载：缺失的已知条目字段会按当前模板补默认值；`key`、`keysecondary`、`characterFilter` 会做类型修正。
- 导出：世界书编辑器直接下载当前完整 `data`，不是重新挑选一组白名单字段，因此未知顶层字段、未知条目字段和扩展数据有机会保留。[字段补全](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L2106-L2140) [原样 JSON 导出](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L2538-L2546)

### 其他官方导入路径

当前前端还识别并转换：

- NovelAI PNG 的 `naidata`；
- 带 `lorebookVersion` 的 Novel Lorebook；
- `kind === "memory"` 的 Agnai Memory Book；
- `type === "risu"` 的 Risu Lorebook。

这些格式会先转成 SillyTavern 独立 `entries` 对象，再交给同一个服务端导入接口。[导入识别](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L5727-L5771) [转换器](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L5358-L5496)

对 dsh-tavern 第一版而言，不必马上支持全部第三方格式。优先级应为：

1. SillyTavern 独立世界书 JSON；
2. 人物卡内嵌 `character_book` 提取；
3. 对未知字段的无损往返；
4. 再按真实用户案例增加 NovelAI/Agnai/Risu 转换。

## 4. 酒馆的实际加载流程

### 4.1 来源合并

一次生成会收集：Chat Lore、Persona Lore、Character Lore、全局选中的世界书。Chat Lore 固定在最前，其次 Persona Lore；Character 与 Global 按“混合排序 / 人物优先 / 全局优先”策略合并，然后每组按 `order` 降序处理。[官方来源与策略](https://github.com/SillyTavern/SillyTavern-Docs/blob/70e5e4d3c239253fca4692fe82e3936cb9c4b1b1/Usage/worldinfo.md#context-specific-sources) [源码合并](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L4336-L4493)

### 4.2 扫描内容

基础扫描对象是倒序传入的最近聊天消息，默认使用全局 `world_info_depth`，条目可用 `scanDepth` 覆盖。按条目开关还可追加 Persona、人物描述、性格、Note、Scenario、Creator Notes，以及允许参与扫描的扩展提示；递归阶段再加入已激活世界书内容。[扫描缓冲](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L199-L327)

扫描深度 0 表示不扫描普通聊天，只检查递归内容和允许扫描的扩展提示；1 表示最后一条消息。[官方 Scan Depth](https://github.com/SillyTavern/SillyTavern-Docs/blob/70e5e4d3c239253fca4692fe82e3936cb9c4b1b1/Usage/worldinfo.md#scan-depth)

### 4.3 每条记录的判定顺序

当前源码大致依次执行：

1. 跳过已经处理、已经激活或概率失败的条目；
2. `disable`；
3. 生成类型 `triggers`；
4. 人物/标签过滤；
5. delay、cooldown、sticky；
6. 递归阶段限制；
7. 内容 decorator 或外部强制激活；
8. `constant` / sticky；
9. 主关键词；
10. 二级关键词逻辑；
11. 同组竞争；
12. 概率；
13. 宏解析与 token 预算；
14. 记录激活并决定是否进入下一次递归。

源码主体见 [`checkWorldInfo`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L4595-L5065)。

### 4.4 递归、最少激活与预算

- 开启递归后，本轮新激活条目的 `content` 会加入递归扫描缓冲，再触发其他条目。
- `excludeRecursion` 控制“不能被递归触发”，`preventRecursion` 控制“不能触发下一层”，两者方向不同。
- Min Activations 会逐步扩大聊天扫描深度，直到达到数量、最大深度或预算；它与 Max Recursion Steps 互斥。
- Max Recursion Steps 为 0 时不按层数截断，只受预算约束。
- 世界书预算是最大上下文的百分比，可再设绝对 cap；`ignoreBudget` 条目例外。

[官方递归说明](https://github.com/SillyTavern/SillyTavern-Docs/blob/70e5e4d3c239253fca4692fe82e3936cb9c4b1b1/Usage/worldinfo.md#recursive-scanning) [源码递归状态推进](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L4970-L5065)

### 4.5 注入结果

激活后的条目不是简单拼成一段。SillyTavern 返回七类结果：人物定义前、人物定义后、示例消息、指定聊天深度、Author's Note 顶部、Author's Note 底部、Outlet。`position=4` 还按相同的 `depth + role` 合并为一条消息。[返回结构](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L892-L914) [构造结果](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L5067-L5162)

这套位置语义属于 SillyTavern 的动态 prompt 组装架构。dsh-tavern 可以保留并理解这些字段，但不需要照搬为每轮重组整个 Session；应把它们翻译成召回优先级、输出目标或后台任务上下文。

## 5. 版本与扩展兼容结论

世界书没有一个足以覆盖当前 SillyTavern 行为的封闭、稳定 schema：

- 服务端只要求 `entries`，前端模板持续增加字段；
- Character Card 的核心格式表达能力较小，新语义依赖 `extensions`；
- 同一语义在独立文件和卡片内嵌格式中有 camelCase / snake_case 两套名字；
- 扩展可以增加顶层、条目级字段，也可以监听扫描事件修改激活结果；
- 部分功能依赖 SillyTavern 其他模块，例如向量召回、正则、STscript、Quick Replies、宏和 Author's Note。

因此兼容层必须遵守：

1. 原文件不可变备份；
2. 所有未知顶层字段、未知条目字段、`extensions` 原样保留；
3. 业务投影只补默认值，不回写覆盖原值；
4. 导出优先从工作 raw 重建，而不是从有损业务投影重建；
5. 每项运行语义分别标记 `supported`、`translated`、`preserved-only`、`unsupported`；
6. 单条异常不阻断整个世界书或正文生成。

## 6. dsh-tavern 独立世界书库的最小兼容边界

### 6.1 资源模型

建议一个世界书资源至少保存三层：

```text
WorldBookResource
├── id                  dsh-tavern 自己的稳定 ID
├── displayName         展示名，不依赖源文件名长期充当主键
├── source              format / filename / importedAt / contentHash
├── raw                 完整不可变导入内容
├── workingRaw          可编辑、仍然无损的工作副本
└── projection
    ├── entries[]       统一读取投影
    ├── diagnostics[]   缺字段、冲突、未支持语义
    └── sourceMap       投影条目到 raw 路径的映射
```

绑定关系不要写进世界书资源本体：

```text
WorldBookBinding
├── worldBookId
├── scope               library / character / chat / persona
├── targetId            可空
├── enabled
└── policy              后续运行策略
```

当前产品要求“独立世界书库，不和人物卡绑定”，第一版只实现 `scope=library` 即可；未来绑定无需迁移世界书文件。

### 6.2 统一条目投影

第一版 projection 至少需要：

```text
ref, sourceUid, sourcePath,
title, content, enabled,
primaryKeys[], secondaryKeys[], selectiveLogic,
constant, vectorized,
order, position, depth, role,
probabilityEnabled, probability,
scanDepth, caseSensitive, matchWholeWords,
excludeRecursion, preventRecursion, delayUntilRecursion,
group, groupOverride, groupWeight, useGroupScoring,
sticky, cooldown, delay,
characterFilter, generationTriggers,
additionalMatchSources,
automationId, outletName, ignoreBudget,
rawEntry
```

这个投影是“读取方便层”，不是新的导出真相。`rawEntry` 与 `sourcePath` 必须保留，才能在未知字段不断增加时无损编辑。

### 6.3 第一阶段可以执行的最小子集

结合 dsh-tavern 的原生 Agent 架构，建议先执行：

1. `enabled=false`：明确跳过；
2. `constant=true`：以紧凑目录形式让后台 Agent 常驻知晓，正文细节仍按需读取；
3. 普通 `key` 与合法正则 key：对当前正文窗口做确定性匹配；
4. `keysecondary + selectiveLogic`：保持酒馆四种逻辑；
5. `order`：用作候选排序/召回优先级；
6. `content`：宏解析后交给后台 Agent，由它整理当前正文需要的最小事实，再注入前台；
7. 召回失败或条目异常：跳过该条并记录诊断，不阻断正文。

暂时只保存、不执行：`position/depth/role` 的酒馆精确位置、概率、包含组、Timed Effects、向量、Automation、Outlet、人物标签过滤、生成类型过滤等。等真实卡要求出现后逐项翻译，不能用近似行为冒充完整兼容。

### 6.4 导入边界

第一版导入器应接受：

- 独立世界书：顶层 `entries` 为对象；
- 人物卡内嵌世界书：`data.character_book.entries` 为数组；
- 直接选择一个裸 `character_book` 对象。

导入时：

1. 先识别格式，不改源对象；
2. 保存完整 raw 与 SHA-256；
3. 建立投影与字段来源映射；
4. 对缺失 `uid/id` 生成内部 `ref`，但不写回原文件；
5. 冲突 UID、错误字段类型、非法正则、未知 position 只产生诊断；
6. 人物卡内嵌世界书复制进世界书库后与人物卡解耦，后续修改互不影响；
7. 导出原格式时从 working raw 做最小修改，未知内容保持不变。

## 7. 对后续“修改加载机制”的直接建议

酒馆源码值得参考的是**资源格式和行为合同**，不是它每轮动态拼接整个提示词的架构。dsh-tavern 可以采用下面的翻译：

```text
独立世界书库
  → 无损导入与统一目录
  → 程序先做确定性过滤（启用、关键词、正则、二级逻辑）
  → 后台 Agent 看到常驻目录和命中条目摘要
  → 必要时调用工具分页读取原文
  → 后台 Agent 输出“本轮最少但足够的设定上下文”
  → 前台正文 Agent 只接收整理后的结果
```

这既保留酒馆生态的导入兼容性，也不会让每一个酒馆插入位置反过来支配 DSH 的 append-only Session。实现前应先收集几份真实独立世界书与人物卡内嵌世界书，建立格式快照和召回基线测试。
