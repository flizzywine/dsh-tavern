# AI检定 `dsh.dice`

两个前台工具，由写正文的模型调用：

- `tavern_roll`（`dice.js`、`tools.js`）：没有规则的卡用的 1d100 检定，五档结果，可暗骰。
- `tavern_check`（`check-expr.js`、`check-engine.js`、`check-tool.js`）：卡自己声明检定规则时用的规则检定。引擎按卡的规则掷骰、结算这次掷骰和它的直接后果，模型只提出检定和写正文。只管掷骰：每个检定至少掷一颗骰子；不掷骰的记账（阶段转换、花资源、发奖励）是卡的变量更新规则的事，由 MVU 后台结算用 delta 做。

## 用到的接口

- 前台工具：`tools.js` 默认导出两个工具（`lib/mod-tools.js`）。工具的 core 里有 `readCard(chat)`（这局游戏用的卡，开局时冻结）和 `results(exec)`（本工具在这局当前分支上的历史结果文本，`lib/domain/surface-tool-results.js`）。
- 提示词：`mod.json` 的 `rules`（只讲 `tavern_roll`）。`tavern_check` 不加提示词：用法写在工具说明里，每张卡的规则用 `action: "status"` 读。
- 本体客户端部件：`client/core.js` 把 `roll.js`（`tavern_roll` 的卡片与 3D 掷骰）和 `check.js`（`tavern_check` 的记录卡）放进聊天楼层与舞台文本框上沿；舞台叠层是 `throw.js`（掷骰飞入）和 `show.js`（检定结果的演出，见下文 `show`；画面在 `show-art.js`，声音在 `show-sound.js`）。

## 持久状态

两个工具都不另存数据：唯一的记录是回合里的工具结果。`tavern_check` 的每条记录带着结算后的全部资源（`state`），最新一条就是当前资源（卡在游戏中途更新、规则多了资源时，旧记录里没有的资源从初始值开始）；记录跟着回合走：回退一轮，那一轮的检定和资源变化一起消失；重新生成只重写正文，上一版的检定照旧有效（本体的重新生成把旧回复的工具结果留在消息面上，见下文）。等玩家选择的记录（`status: "awaiting"`）资源不变，`settle` 用它自己的种子重放后结算。

资源也可以放在卡的 MVU 变量里：资源写 `mvu: "/特工/混沌"`（stat_data 下的路径，各段不含 `/` 和 `~`）。这时以变量为准：引擎读游戏最近一次结算成功的变量，以及它属于哪一轮；比它更新的记录（记录带 `turn`）还没写进变量，以最新的那条为准。变量形状不对（不是整数、条目不在集合里）就拒绝并报出路径；变量里还没有的路径沿用记录或初始值。变化行带 `path`、`from`、`to` 和增量 `add`：引擎不写变量。`tools.js` 给 `tavern_check` 声明了 `settlement`（`checkSettlement`）：回复结算时，宿主把基线变量之后、当前分支上的检定记录改到的每个变量，按最后一条记录的值直接写入（replace，排在后台操作前面）；后台只被告知这些值已经写了，它对这些路径的写入不作数。正文不用复述这些数；结算重跑写的是同样的值，不会加两遍；上一条回复的结算没写成时，它的记录随下一条一起写。回退和分支时，结果跟着回合走：退掉的回合的记录不在当前分支上。重新生成只换正文（lib/domain/round-history.js）：被重写的那一版的工具结果留在当前分支上、照旧作数，重写回合自己的工具结果不留；所以重写时 ct/choose 被拒（REGENERATING，status 照常），要把裁定重来就回退这一轮。上下限由卡写在初值的 `$meta.limits` 里（和 `extensible` 同处），后台结算超限即退回。

已知缺口：不用变量的资源只跟着记录走，上下文压缩把很早的工具结果移出当前分支、又没有记录留下时，会回到初始值。

## 规则数据（`dsh-rules` v2）

卡的 `data.extensions["dsh.rules"]`（`rules-engine.js`）。分工：AI 只说「发生了什么」（选一个声明过的动作、给参数），脚本算数；规则管的量只存在变量里，状态 = 最近一次结算成功的变量 ⊕ 当前分支上比它更新的记录，回复结算时宿主把这些记录的最终值直接写进变量（`checkSettlement`）。v1 是「每个动作都掷骰、资源可以不落变量」的旧格式，继续能读。

```json
{
  "format": "dsh-rules", "version": 2, "name": "规则名",
  "sets": { "stats": ["力量", "机敏"] },
  "tables": { "tools": { "撬棍": { "cost": 2 } } },
  "state": {
    "phase": { "path": "/阶段", "label": "阶段", "values": [0, 1, 2] },
    "money": { "path": "/角色/钱", "label": "钱", "min": 0 },
    "clues": { "path": "/线索", "label": "线索", "keys": "*", "min": 0 },
    "staff": { "path": "/员工", "label": "员工", "keys": "*", "fields": { "能力": { "min": 0 }, "季薪": { "min": 0 } } },
    "heat": { "path": "/幕后/热度", "label": "热度", "secret": true }
  },
  "read": { "started": "/开场/完成" },
  "derived": { "ending": { "path": "/终局", "label": "终局", "value": "phase == 2 ? '结案' : ''" } },
  "actions": {
    "buy": { "label": "买工具", "by": "player", "summary": "给模型的一句话：什么时候提交", "when": "phase == 1",
      "params": { "item": { "label": "工具", "table": "tools" } },
      "require": [{ "when": "money >= item.cost", "message": "钱只有 {money}，「{item}」要 {item.cost}：在戏里婉拒。" }],
      "effects": [{ "var": "money", "add": "-item.cost" }],
      "text": "买下「{item}」，还剩 {money - item.cost}。", "stop": "（换阶段的动作写：这一轮写到哪里为止）" }
  }
}
```

- `state`：归规则管的变量（必须有 `path`，stat_data 下、不含 `$…`、`schema` 和原型名，彼此不重叠）。`keys` 是集合名（固定条目）或 `"*"`（条目不固定：关系、物品）；`fields` 让每个条目是一个带字段的对象（`/员工/老周/能力`），范围按字段写；`values`、`min`/`max`（公式，可读 `key`）、`initial`、`secret`。后台 AI 写这些路径不作数（丢弃并记进诊断）；它们的范围只写在这里，初值的 `$meta.limits` 再写同一路径时卡检查报错。
- `read`：只读、由别人写的变量（缺了是 `null`）。`derived`：派生量 = 公式，每次动作后自动写，载入时查环。
- 动作：`label`、`summary`、`by`（`player`/`gm`，给模型的提示）、`when`（现在能不能用）、`params`、`dice`、`let`、`require`、`choices`、`then`、`ensure`、`outcomes`（可带 `text`、`stop`、`show`）、`effects`、`report`、`text`、`stop`。没有骰子也行。
- 结算顺序：参数 → 掷骰 → `let` → `require`（不成立就拒绝，不留记录，卡写的话原样回给模型）→ 玩家的选择 → `then` → `ensure`（不成立就退回这次选择，记录继续等）→ 结果档位 → 效果 → 派生量。`text`、`stop`、`report` 读的是效果之前的值（「还剩 {money - item.cost}」）；每条效果读前面效果改过的状态。
- 参数与选择的种类：v1 的五种，再加 `table`（选表里一行，公式里 `参数.列` 读）、`keyOf`（从某个变量现有的条目里选）、`text {max}`（限长的名字，用来新建条目；不能含 `/`、`~`）。参数可以带 `when`（只在某种情况下要给）。等待中的记录带上选择之前已经算定的 `report`。
- 效果：`{var, key | each, field?, add | set | remove, when?, strict?}`。`each` 是名字的列表（或一个对象，取它的条目名），公式里用 `key` 读当前条目；`remove` 只用于 `"*"` 的条目；越界的值夹回范围内，`strict` 就拒绝。
- 步骤可以是逐条累加：`{"name": "revenue", "each": "goods", "sum": "goods[key]['销量'] * goods[key]['单价']", "when": "goods[key]['在售']"}`。
- 公式比 v1 多三个函数：`get(表, 键, 缺省)`、`join(…)`（拼条目名）、`keys(表)`。公式最长 2000 字、嵌套最多 40 层，规则文件最大 256 KB。
- 工具：`op=status`（现在可用的动作、参数和当前值）、`op=act`（`action`、`params`、一句 `reason`）、`op=choose`（`choice`，空对象取默认）。记录编号是「轮次-序号」（`7-2`），一条回复最多 16 次裁定。旧写法（`action: status|roll|settle`、`check`）继续接受，v1 的卡也能用新写法。
- 记录：了结的记录只带骰面、结果、文字、`stop`、`report` 和变化行（`{path, label, from?, to?, secret?}`：没有 `from` 是新增条目，没有 `to` 是删除），不带全部资源的快照。聊天里：掷骰和等玩家选的记录是一张卡；不掷骰的裁定只在有玩家能看的变化时出一行小字（「嘉奖 +1」），保密的变化不显示。
- 补记：v2 的卡，回复的变量结算里后台模型也能用 `tavern_check`（`CHECK_BACKFILL`，只有 `op=act`/`status`）：正文里发生了、这条回复却没提交的动作由它补上，和这条回复的记录一起由宿主写入。掷骰的动作、要玩家选的动作不补；前提不满足被拒的，记进结算诊断「正文与规则不一致」。补记的记录带 `backfill: true`，只在这次结算里，下一轮从变量读到。
- 卡检查：卡保存时的格式校验（`lib/domain/card-validation.js`）调用 `tools.js` 的 `checkCard`：规则编译一次，错误带路径。

## 规则数据（`dsh-check-rules` v1）

卡的 `data.extensions["dsh.dice"].rules`：

```json
{
  "format": "dsh-check-rules", "version": 1, "name": "规则名",
  "guide": "给模型的一句话：这套规则什么时候掷骰",
  "sets": { "stats": ["力量", "敏捷"] },
  "resources": {
    "hp": { "label": "生命", "initial": 10, "min": 0, "max": "hpMax", "note": "说明" },
    "rating": { "label": "属性", "keys": "stats", "initial": { "力量": 2 } }
  },
  "checks": {
    "move": {
      "label": "行动", "title": "{stat}", "summary": "给模型看的一句话",
      "params": { "stat": { "label": "属性", "set": "stats" } },
      "dice": { "d": { "count": 2, "sides": 6 } },
      "let": [["total", "d[0] + d[1] + rating[stat]"]],
      "require": [{ "when": "hp > 0", "message": "倒地时不能行动" }],
      "choices": [{ "id": "push", "label": "加把劲", "when": "total < 10", "int": { "min": "0", "max": "1", "default": "0" } }],
      "then": [["band", "total + push * 3"]],
      "outcomes": [{ "id": "hit", "label": "成功", "when": "band >= 7" }, { "id": "miss", "label": "失败" }],
      "effects": [{ "resource": "hp", "add": "-push", "strict": true }],
      "report": [{ "id": "total", "label": "总值", "value": "band" }]
    }
  }
}
```

- 结算顺序：参数（模型给）→ 掷骰（种子）→ `let` → `require` → 玩家的 `choices` → `then` → `outcomes`（第一条命中的，最后一条是默认）→ `effects` → `report`。
- 参数与选择的种类：`int {min,max,default}`、`options {id: 名称 | {label, 属性…}}`（公式里用 `参数.属性` 读）、`set`（集合中的一个名字）、`pick {set,min,max}`（集合中的若干名字，可重复）、`type: "boolean"`。
- 有打开的选择（`when` 成立、整数范围不止一个值）时检定先停下等玩家；整数选择的每个值都附带「会怎样」的预览。
- 公式：数字、`'文字'`、`true/false`、名字、`+ - * / %`、比较、`and or not`、`a ? b : c`、`列表[序号]`、`count sum len max min abs floor ceil clamp has get join keys range slice`。逐颗骰子查表：步骤 `{"name": "delta", "each": "range(len(w))", "sum": "events[w[key]]['a']"}` 里 `key` 是第几颗，`count(slice(w, 0, key + 1), w[key])` 是这个面第几次出现。名字是资源、集合、参数、骰子、步骤、选择和 `outcome`；`each` 效果里 `key` 是正在改的条目。规则在载入时校验一次，拼错的名字带路径报错。
- 演出：结果可以写 `show`，让舞台在这个结果出现时演一段，名字只能从引擎的 `CHECK_SHOWS` 里选，载入时校验。现在只有 `converge`（约 7 秒，盖住整个舞台，含文本框）：三片快门合上，舞台变成一张白纸；这次的骰子排成一行，没标记的划成空框，被标记的面（`mark`）逐个点数，飞到一个大图形的角上（三个就是三角形），尺规连边、盖章填实，停一拍；图形吞掉整个舞台，满屏标记色（`markColor`）上描出三座光尘三角，结果名用尽量大的字逐字砸下，最后整片收回图形、归档到文本框上的记录卡。画面只用纸白、墨黑、标记色三个平涂色，由一张 canvas 逐帧画出（`show-art.js`）。声音是代码合成的（`show-sound.js`，没有音频文件）：每个节拍一声，点数的音各高五度，高潮是这几个音合成的大三和弦；走舞台「音效」总线，音效或总音量静音、为 0 时不出声也不合成；在后台线程合成，不卡画面。记录带 `show: {effect, label}`（label 是结果名）。结果在玩家选择之前就已确定时（它和排在它前面的结果都只读掷骰前已知的名字，如三角机构的三重升华），等选择的记录就带上 `show`，演出在掷骰时播一次，结算记录（`of` 指向它）不再播。只在 live 新出现的记录上播；重新载入、翻历史、片段回放都不播；点一下或 Esc 结束，声音同时掐断；减少动态时不动，只淡入高潮的定格再淡出，声音只有三声轻钟音和和弦、没有撞击声；光敏保护下图形吞掉舞台的那一下放慢，全程没有闪烁。聊天楼层只把结果名染成标记色。
- 骰子：`dice.<名字> {count, sides, mark?, markColor?}`。`mark` 是本作要突出的面（如三角机构的 `[3]`），`markColor` 是它们的颜色（`#rrggbb`，不写用主题强调色），都只影响显示；记录带 `faces {<名字>: {sides, mark?, markColor?}}`，聊天里的检定记录据此画骰：四面骰画成读数朝上的三角形（顶上是结果，下两角是这一面的另两个数），被标记的面红底白窗；其他骰子是方块。
- 资源：`keys` 是按集合分条目的资源；`min`/`max` 是公式；检定的效果夹在上下限内，`strict` 效果越界就拒绝；`secret: true` 的资源对玩家保密：模型照常在记录和 status 里读到，聊天和舞台上的检定记录卡（改了什么、选项预览、掷后资源）都不显示它，记录带 `secret: [资源 id]`（如三角机构的混沌）；`mvu` 见上。

## 字节

- 提示词：无新增（`tavern_check` 不注入说明）。
- `tavern_check` 工具 schema（`defineTool` 后 JSON）：2009 字节（v2 的 op 写法与旧写法都在内），开着 AI检定 的卡都带上（工具表按已安装模组冻结）。
- 工具结果（三角机构示例卡实测）：等选择的记录（带预览）1440 字节，结算后 1120 字节，status 3852 字节；带演出的记录多 49 字节（`show`）。

## 测试

- `tests/dice.test.mjs`、`tests/fork-dice-mod.test.mjs`、`tests/fork-dice-roll-browser.test.mjs`、`tests/fork-dice-throw-browser.test.mjs`、`tests/fork-dice-throw-live-stage-browser.test.mjs`：`tavern_roll`。
- `tests/fork-check-show-live-stage-browser.test.mjs`：结果演出在真实舞台上：live 记录播一次、卡片等演出结束才出现、结算记录与无演出记录不播、历史不播、点击结束、减少动态定格；`DSH_CHECK_SHOW_SHOTS=<目录>` 另存逐帧审阅图。
- `tests/dice-check.test.mjs`：公式、规则校验、结果演出（`show` 的校验，等选择的记录何时带上）、两类规则（2d6 加属性三档、数六的骰池，骰面标记）、等选择与结算、同种子重放、工具记录折叠、资源放在变量里（轮间读变量、轮内接记录、形状不对报路径）、本体读取当前分支的工具结果。
