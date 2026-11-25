# AI检定 `dsh.dice`

两个前台工具，由写正文的模型调用：

- `tavern_roll`（`dice.js`、`tools.js`）：没有规则的卡用的 1d100 检定，五档结果，可暗骰。
- `tavern_check`（`check-expr.js`、`check-engine.js`、`check-tool.js`）：卡自己声明检定规则时用的规则检定。引擎按卡的规则掷骰、结算这次掷骰和它的直接后果，模型只提出检定和写正文。只管掷骰：每个检定至少掷一颗骰子；不掷骰的记账（阶段转换、花资源、发奖励）是卡的变量更新规则的事，由 MVU 后台结算用 delta 做。

## 用到的接口

- 前台工具：`tools.js` 默认导出两个工具（`lib/mod-tools.js`）。工具的 core 里有 `readCard(chat)`（这局游戏用的卡，开局时冻结）和 `results(exec)`（本工具在这局当前分支上的历史结果文本，`lib/domain/surface-tool-results.js`）。
- 提示词：`mod.json` 的 `rules`（只讲 `tavern_roll`）。`tavern_check` 不加提示词：用法写在工具说明里，每张卡的规则用 `action: "status"` 读。
- 掷骰点：工具调用在这一轮正文里的位置。工具说明（`CALL_HINT`）告诉模型玩家会在调用的那一刻看到掷骰演出，所以写到需要判定时再调用：先写铺垫，调用，再从结果接着写。两个工具的每条带编号的记录（`tavern_roll` 每条）带 `at`：这一轮在调用之前已经写出的舞台段落数（宿主 `lib/mod-tools.js` 的 `storyUnitsBefore`，按舞台分页用的同一套段落 `lib/domain/stage-paragraphs.js` 数）；调用前一个字都没写时没有 `at`。舞台把读者所在的位置交给模组部件（`place` 属性：这一页的段落、是否是该段第一页、是否是写完这一轮的最后一页等，舞台 `controller.cjs`），模组按它决定何时演（`client/place.js`）：有 `at` 的记录，读到调用之后那一段（第 `at + 1` 段）的第一页才掷骰、放演出，文本框上沿的卡从那一页起才出现；调用后没有再写段落的，在这一轮最后一页演；等玩家选择的记录在那里掷骰、显示「现在」的结果，结果页和卡上的选择按钮留到这一轮最后一页。没有 `at` 的记录（模型先调工具再写）照旧：记录一到就演，卡排在最前。翻历史时 `tavern_roll` 在调用之后那一段的第一页重掷（没有 `at` 的在第一页）。聊天楼层的卡位置不变。
- 本体客户端部件：`client/core.js` 把 `roll.js`（`tavern_roll` 的卡片）和 `check.js`（`tavern_check` 的记录卡）放进聊天楼层与舞台文本框上沿；舞台叠层是 `throw.js`（`tavern_roll` 的百分骰掷骰）、`check-throw.js`（`tavern_check` 的掷骰）和 `show.js`（检定结果的演出，见下文 `show`；画面在 `show-art.js`，声音在 `show-sound.js`）。

## 三维骰子（`client/dice3d.js`）

所有掷骰共用的基础效果：真实的四面、六面、八面、十面、十二面、二十面骰；百分骰是一颗十位十面骰（00–90）加一颗个位十面骰；二面、三面骰用六面骰（数字各重复）；别的面数不掷，只在记录卡上显示。动画是关键帧，不做物理模拟：引擎先掷出结果，每颗骰子的旋转衰减到结果朝上（四面骰是结果那个角朝上）、数字正对镜头，同时沿弹跳曲线落到停点；碰桌、滑停和骰子相撞的音效按同一套关键帧算出时刻（`diceContacts`）。Three.js 用舞台已有的内置运行库，第一次掷骰时才载入。

- `tavern_roll`：两颗十面骰落定后数字飞进大数字，盖结果印章；暗骰被骰盅扣住（`throw.js`）。
- `tavern_check`：实时到达的记录走一条时间线（`check-throw.js`；记录的读法、结果页和效果点在 `check-result.js`）：① 骰子上方一行「标题 · 动作名 · 标签」（规则的 `tags`）；② 骰子按各自形状掷进文本框上方，落成一排；③ 逐颗读骰：计入的发光（规则标记的面 `faces.mark` 用标记色 `faces.markColor`，不写用主题强调色），不计的（`flags` 是 `dropped`）变暗；被玩家的选择翻过的骰子（`changed`）先跳一下翻到新的面；然后骰子下方亮出主数字和目标（`report` 的 `main`/`target`）；④ 等玩家选择的记录（有玩家的选择）打开结果页：在骰子那块地方，列出标题和标签、带状态的骰子、主数字和目标、「现在」的结果，以及每个选择的按钮（每个值会变成什么结果、花什么，按钮前的圆点是那个结果的颜色）；点了就把答案作为玩家的下一句发出，结果页关上；按 Esc 把它收回文本框上的记录卡（卡上是同样的按钮）；点别处、跳过动画都不会跳过它；⑤ 了结的记录把结果名盖章（颜色按结果的 `tone`），列出改了什么，然后整体缩进文本框上的记录卡。记录卡在这期间隐藏，所以结果和选项不会先于骰子出现。结算记录（`of`）的等待记录掷过时不再掷：骰子一开始就停在原处，翻过的骰子翻面，然后盖章。带演出（`show`）的记录由演出自己排骰，不另掷。只演实时到达的记录：重新载入、翻历史、回复没在跑时不演；点一下或按 Esc 直接出结果（要问玩家的记录直接出结果页）；减少动态时不演动画，结果页照常出。声音同百分骰（舞台音效总线）；模组选项 `sound` 关掉就无声，`rollSound`（皮肤素材）换成皮肤自己的一声。
- 效果点（`checkCues`，`check-result.js`）：时间线的每一拍都报一个效果点——`declare`、`throw`、`land`、`rest`、`count`、`drop`、`headline`、`tier`、`ask`、`choose`、`resolve`、`change`、`file`，各带这条记录和这一拍的内容（哪颗骰、它在舞台上的位置、结果和 `tone`、选了什么、哪一条变化）。内置画面和皮肤的效果都挂在这些点上。
- 记录卡（聊天楼层和舞台文本框上的同一张）：不计的骰子变暗，翻过的骰子显示新的面并带虚线框，主数字放大并按结果的 `tone` 上色、目标写在旁边；暗骰（`hidden`）只写「暗骰」，不显示骰面、主数字和变化。

## 皮肤选项（规则检定的外观和效果）

规则说「是什么意思」（骰组的 `look`、`order`、结果的 `tone`、特殊面 `mark`），皮肤说「长什么样」：都在皮肤的 `mods["dsh.dice"].options`，图和声音是皮肤的素材键（`assets`；对象和列表里的素材键同样在安装时核对，缺了整项不生效）。都可以不写。

- `dice.<身份名>`：一套骰子的外观——`body`（骰身色）、`ink`（数字色）、`markInk`（特殊面的颜色，取代规则的 `markColor`）、`texture`（铺在每个面上的花纹图）、`faces`（`{"20": 素材键}`：这个面画图案不画数字）。不写就是舞台主题色。
- `tones`：`{great, good, mixed, bad, terrible}` 各档的颜色（`#rrggbb`），不写用舞台的 `--gal-check-tone-*`。
- `toneSounds`：各档定案时的音效，等于每档一条 `{at: "resolve", tone, sound}` 的挂点。
- `shows.<演出名>`：内置演出的配色（现在是 `shows.converge`：`paper` 底色、`ink` 字色、`mark` 标记色，不写 `mark` 用规则的 `markColor`）。
- `result`：`seal`（结果名的样子：`stamp` 印章、`plain` 只有字、`none` 不显示）、`frame`（结果页的底图）、`card`（舞台文本框上记录卡的样子：`line` 一行标题加骰子，默认；`ledger` 表格：头一行是标签、标题和编号，下一行从左到右读成算式——不计的骰子、掷出时计入的骰子（规则抵掉的打斜杠）、主数字行的各步修正（`steps`）、主数字、结果色块；等玩家选择时结果角上标「待定」。聊天楼层的卡不变）、`tagColors`（`ledger` 的标签格底色，按标签文字：`{"异常能力": "#2b3f9e"}`；不写的用文字色）。
- `cues`：效果挂点，按顺序匹配，同一个效果点可以命中多条。每条写 `at`（效果点，见上），条件只对规则已经给出的语义：`action`、`outcome`（结果 id）、`tone`、`look`、`mark`（是不是特殊面）、`state`（`kept` / `dropped` / `changed`）、`choice`（选的哪个：`id` 或 `id:值`）；要更细的条件就在规则里多分一个结果或多标一个特殊面。播的东西：`effect`（舞台核心效果：`shake-1`–`3`、`flash`、`flash-red`、`glitch`、`shock`、`heartbeat`、`blackout`，经舞台的安全设置）、`sound`（素材键，走舞台音效总线）、`show`（内置演出，现在是 `converge`）。`hold: true` 的演出播完时间线才往下走。代码里每种「播的东西」是 `check-result.js` `CHECK_CUE_PLAYS` 的一项：加一种就是在那里登记一项、在 `mod.json` 的 `cues` 里加它的字段。

```jsonc
"mods": { "dsh.dice": { "options": {
  "dice": { "main": { "body": "#151515", "ink": "#f2f0eb", "markInk": "#c8202f" }, "sponsor": { "body": "#c9993f", "ink": "#1a1208" } },
  "toneSounds": { "great": "se-great" },
  "cues": [ { "at": "count", "mark": true, "sound": "se-three" }, { "at": "resolve", "tone": "terrible", "effect": "shake-2" } ]
} } }
```

## 持久状态

两个工具都不另存数据：唯一的记录是回合里的工具结果。`tavern_check` 的每条记录带着结算后的全部资源（`state`），最新一条就是当前资源（卡在游戏中途更新、规则多了资源时，旧记录里没有的资源从初始值开始）；记录跟着回合走：回退一轮，那一轮的检定和资源变化一起消失；重新生成只重写正文，上一版的检定照旧有效（本体的重新生成把旧回复的工具结果留在消息面上，见下文）。等玩家选择的记录（`status: "awaiting"`）资源不变，`settle` 用它自己的种子重放后结算。

资源也可以放在卡的 MVU 变量里：资源写 `mvu: "/特工/混沌"`（stat_data 下的路径，各段不含 `/` 和 `~`）。这时以变量为准：引擎读游戏最近一次结算成功的变量，以及它属于哪一轮；比它更新的记录（记录带 `turn`）还没写进变量，以最新的那条为准。变量形状不对（不是整数、条目不在集合里）就拒绝并报出路径；变量里还没有的路径沿用记录或初始值。变化行带 `path`、`from`、`to` 和增量 `add`：引擎不写变量。`tools.js` 给 `tavern_check` 声明了 `settlement`（`checkSettlement`）：回复结算时，宿主把基线变量之后、当前分支上的检定记录改到的每个变量，按最后一条记录的值直接写入（replace，排在后台操作前面）；后台只被告知这些值已经写了，它对这些路径的写入不作数。正文不用复述这些数；结算重跑写的是同样的值，不会加两遍；上一条回复的结算没写成时，它的记录随下一条一起写。回退和分支时，结果跟着回合走：退掉的回合的记录不在当前分支上。重新生成只换正文（lib/domain/round-history.js）：被重写的那一版的工具结果留在当前分支上、照旧作数，重写回合自己的工具结果不留；所以重写时 ct/choose 被拒（REGENERATING，status 照常），要把裁定重来就回退这一轮。上下限由卡写在初值的 `$meta.limits` 里（和 `extensible` 同处），后台结算超限即退回。

已知缺口：不用变量的资源只跟着记录走，上下文压缩把很早的工具结果移出当前分支、又没有记录留下时，会回到初始值。

## 规则数据（`dsh-rules` v2）

卡的 `data.extensions["dsh.rules"]`（`rules-engine.js`）。分工：AI 只说「发生了什么」（选一个声明过的动作、给参数），脚本算数；规则管的量只存在变量里，状态 = 最近一次结算成功的变量 ⊕ 当前分支上比它更新的记录，回复结算时宿主把这些记录的最终值直接写进变量（`checkSettlement`）。v1 是「每个动作都掷骰、资源可以不落变量」的旧格式，继续能读。

带规则的卡自己就提供 `tavern_check`，不看「AI检定」开关；它的局里也不提供通用的 1d100 `tavern_roll` 和它的提示词（开关开着也一样）：前台只有一个裁定工具，只有卡声明的动作。卡要自由掷骰，就在规则里声明一个掷 d100 的动作。

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

- `state`：归规则管的变量（必须有 `path`，stat_data 下、不含 `$…`、`schema` 和原型名，彼此不重叠）。`keys` 是集合名（固定条目）或 `"*"`（条目不固定：关系、物品）；`fields` 让每个条目是一个带字段的对象（`/员工/老周/能力`），范围按字段写；`values`、`min`/`max`（公式，可读 `key`）、`initial`、`secret`；`changeLabel`（可选）是记录和卡片里这个变量的变化给玩家看的名字，`{key}` 换成条目名（`"{key}条已标格"` 读成「职能条已标格 +1」），不写就是「名称·条目」。`internal: true`（可选，和 `secret` 不同时写）是只给规则自己记账的变量（阶段、任务次数这类推进流程用的数）：它照常出现在卡的页面和变量面板里，但检定记录卡、变化小字、选项预览都不说它的变化，只改了内部变量的裁定在舞台和聊天里什么都不显示；变化行带 `internal: true`。后台 AI 写这些路径不作数（丢弃并记进诊断）；它们的范围只写在这里，初值的 `$meta.limits` 再写同一路径时卡检查报错。只写 `min` 或只写 `max` 也照样夹住。
- `read`：只读、由别人写的变量（缺了是 `null`）。`derived`：派生量 = 公式，每次动作后自动写，载入时查环；也可以 `secret`。
- 保密（`state` 或 `derived` 的 `secret`）：模型照常在记录和 status 里读到；玩家哪里都看不到真值——检定记录卡、变化小字、选项预览不写它。`secret: true` 时变量面板、变量回执和卡自己的页面（状态栏、状态页）里它是「？？？」，名字照常显示，玩家知道有东西被藏着；`secret: "unlisted"` 连名字一起藏：这三处都不列出这一项（回执里它的变化整行没有，一轮只改了它们时回执是「本轮没有需要更新的变量」），一组字段全是 unlisted 的对象（`/幕后`）也不列出，玩家不知道它存在（`tools.js` 的 `hidden` 把这些路径并进卡的隐藏属性，`lib/mod-tools.js` `withModHidden`）。要在某个时刻让卡的页面读到它，在卡的隐藏属性（`extensions.dsh_tavern.mvuVisibility`）里给同一路径写一条带 `revealWhen: {"path": "/幕后/看见", "equals": true}` 的规则（`mode` 用 `masked` 或 `unlisted`）：卡自己的规则优先，条件成立后面板和卡的页面显示名字和真值；回执看不到当时的变量，仍按没揭开处理（`masked` 只说「已发生变化」，`unlisted` 不列出）。
- 动作的 `page`（可选，只用于不掷骰的动作）：本卡一张卡页面的 id。舞台上读到这条裁定时，由这一页在舞台中央把变化演出来，代替文本框上的变化卡（`client/page.js` 定时机，舞台 `status-panel.cjs` 的 `Performance` 放页面，页面怎么接见内置 Skill `stage` 的 `references/page-contract.md`「页面演出」）；记录带 `page`。同一处一起到的同一动作合成一次演出的几步。演不了（没有这一页、读取失败）就照旧出变化卡；聊天楼层照旧是一行小字。三角机构的「花时间」由档案页演格子被标上、被划掉。
- 动作：`label`、`summary`、`by`（`player`/`gm`，给模型的提示）、`when`（现在能不能用）、`params`、`dice`、`let`、`require`、`choices`、`then`、`ensure`、`outcomes`（可带 `text`、`stop`、`show`）、`effects`、`report`、`text`、`stop`。没有骰子也行。
- 结算顺序：参数 → 掷骰 → `let` → `require`（不成立就拒绝，不留记录，卡写的话原样回给模型）→ 玩家的选择 → `then` → `ensure`（不成立就退回这次选择，记录继续等）→ 结果档位 → 效果 → 派生量。`text`、`stop`、`report` 读的是效果之前的值（「还剩 {money - item.cost}」）；每条效果读前面效果改过的状态。
- 参数与选择的种类：v1 的五种，再加 `table`（选表里一行，公式里 `参数.列` 读）、`keyOf`（从某个变量现有的条目里选）、`text {max}`（限长的名字，用来新建条目；不能含 `/`、`~`）。参数可以带 `when`（只在某种情况下要给）。等待中的记录带上已经算定的 `report` 和已定的结果档位（它和排在它前面的档位都不读还没定的名字时）。
- 骰子：`dice.<名字>` 是一组骰池 `{count, sides}`（名字读作骰面列表，`count(d, 3)`、`sum(d)`），或一个骰子表达式 `{roll: "1d6 + 4d100 + 3"}`（名字读作表达式的值）。表达式里 `NdS` 是 N 颗 S 面骰之和（`d8` 是一颗；N、S 可以是括号里的公式：`(weapon.n)d(weapon.sides)`），其余照公式写（`2d6 + rating[stat]`、`max(1d20, 1d20)`）。一个动作可以有多组，各组面数不同；`count` 为 0 的组不掷（「满足某条件时多掷一颗」写成 `count: "条件 ? 1 : 0"`）。表达式的记录带每颗骰子，面数不同时 `faces.<名字>.sides` 是逐颗的列表，另有 `roll`（原式）和 `total`；聊天里画出每颗骰子并写一行「原式 = 结果」。
- 选择是一个序列，可以夹步骤：`choices` 里的 `["名", "公式"]`（或逐条累加的步骤）读它前面的选择。读到一个还没回答的选择的步骤和选择留到下一问：玩家回答后，记录再等一次，列出新打开的选择（等待记录带 `choice`：已经回答的；结算时一起重放）。一次给齐所有回答也行。例：赞助骰的 3 先由玩家定计入、扣除还是忽略，三重升华在这之后才判，再问三重升华的奖励或素质保证。
- 经理报的附带条件：选择写 `by: "gm"`（如「因果链里有没有向赞助方进贡」）。它和玩家的选择列在同一张等待记录里，聊天里写成一行说明（`hint`），不出按钮；`op=choose` 时由模型按玩家的回复和故事判断后给出，缺了就拒绝（不取默认）；预览里按它的默认值算。
- 效果：`{var, key | each, field?, add | set | remove, when?, strict?}`。`each` 是名字的列表（或一个对象，取它的条目名），公式里用 `key` 读当前条目；`remove` 只用于 `"*"` 的条目；越界的值夹回范围内，`strict` 就拒绝。
- 步骤可以是逐条累加：`{"name": "revenue", "each": "goods", "sum": "goods[key]['销量'] * goods[key]['单价']", "when": "goods[key]['在售']"}`。
- 公式比 v1 多三个函数：`get(表, 键, 缺省)`、`join(…)`（拼条目名）、`keys(表)`。公式最长 2000 字、嵌套最多 40 层，规则文件最大 256 KB。
- 工具：`op=status`（现在可用的动作、参数和当前值）、`op=act`（`action`、`params`、一句 `reason`）、`op=choose`（`choice`，空对象取默认）。记录编号是「轮次-序号」（`7-2`），一条回复最多 16 次裁定。旧写法（`action: status|roll|settle`、`check`）继续接受，v1 的卡也能用新写法。
- `report` 的一行可以带 `secret: true`：只给模型看（下一季的捷径、察觉的计数），玩家的记录卡上不显示。
- 给舞台的语义（都可以不写，不写记录就和以前一样；只说「是什么意思」，长什么样由皮肤定）：
  - 骰组的读法 `read`（只用于 `{count, sides}` 的骰组）：`sum`（求和）、`highest` / `lowest`（只留一颗：同点取第一颗）、`{count: [3]}`（数面在列表里的骰子）、`{count: ">= 8"}`（数满足比较的骰子，右边是公式，可读参数）。公式里 `read(骰组)` 是这样读出的值；记录 `faces.<骰组>` 带 `read`（读法）、`value`（读出的值）和 `flags`（和骰子等长，`kept` 计入 / `dropped` 不计）。不写 `read` 的骰组照旧（`count(d, 3)`、`max(d)` 继续能用，只是画面不知道哪颗不计）。
  - `adjusted`（只用于 `{count: [面]}` 的读法）：玩家的选择改完之后这组骰子数到几个（公式，在 `then` 之后算）。差几个就翻几颗：不计的骰子从前往后翻成列表里的第一个面，计入的从后往前翻成最小的不计的面；了结的记录里被翻的骰子标 `changed`，`faces.<骰组>.after` 是翻过之后的各面。`dice` 仍是掷出的原样（记录照种子重放）。三角机构花素质保证改骰就是这样写的。
  - `cancel`（只用于 `{count: [面]}` 的读法）：规则在玩家改骰之前抵掉的计入骰子，`[{label, count}]`（每项一个原因，`count` 是公式，最多 6 项）。每项从前往后把那么多颗计入的骰子标成 `cancelled`（面不变、不算数），记录的 `faces.<骰组>.cancel` 列出真的抵掉了骰子的原因和颗数；`value` 仍是掷出时数到的个数。有 `cancel` 时，`adjusted` 的差从抵掉之后的个数算起。等待记录里，`count` 不读还没定的名字时就已经标好。三角机构的燃尽（倦怠）每点抵掉一个 3 就是这样写的。
  - 骰组的 `look`（皮肤里一套骰子外观的名字，不写是 `main`）和 `order`（1–9：同一个数一起掷，小的先掷），原样进记录的 `faces`。
  - 结果的 `tone`：`great` / `good` / `mixed` / `bad` / `terrible`（大成功 / 成功 / 有代价 / 失败 / 大失败），决定舞台上的颜色、盖章和音效；记录的 `outcome` 带上它。等待中的记录在结果已定、且这个动作的结果写了 `tone` 时带 `decided`（`{id, label, tone}`）。
  - `report` 的一行写 `main: true` 是这次检定的主数字（最多一行），可带 `target {label, value, need}`（`need` 是 `>=` `>` `<=` `<` `==`：主数字要怎样比目标）；记录里这一行带 `main` 和算好的 `target`。主数字要等玩家的选择才算得出时，等待记录里这一行只有名字和 `pending: true`，选择的每个预览带 `main`（选这个值主数字是多少），舞台按默认值的预览亮出它。
  - `report` 的一行可带 `steps`：这个数是怎么来的，`[{label, value, when?}]`（2–8 步）。第一步是起点（通常是掷出的个数，不带 `when`），后面每步加上自己的值（抵掉的写负数）；记录里只留成立且不为 0 的步，只剩起点时不带 `steps`。各步加起来必须等于这一行的 `value`，否则这次动作报错并写明各步，由卡改公式。舞台在主数字前写出各步：「3 的个数 2 − 倦怠 1 = 1」。
  - 动作的 `tags`（最多 6 个模板，如 `["难度 {dc}"]`）：骰子上方的情境标签，渲染后为空的不显示；记录带 `tags`。动作的 `hidden`（`true` 或公式）：成立时这是一次暗骰，记录带 `hidden: true`，玩家看不到骰面和结果，模型照常读到。
- 预览：等待中的选择带 `preview`（每个值会变成什么结果、`tone` 和变化）：整数范围不超过 13 个值时每个值都有；更宽的（最多 201 个值，如花幸运 0–99）每种结果只留离默认值最近的那个值（最便宜的走法）；选项、集合和是/否每一项都有；`by: gm` 的条件没有。
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
- 骰子：`dice.<名字> {count, sides, mark?, markColor?}`（v2 另可写 `roll` 表达式，见上）。`mark` 是本作要突出的面（如三角机构的 `[3]`），`markColor` 是它们的颜色（`#rrggbb`，不写用主题强调色），都只影响显示；记录带 `faces {<名字>: {sides, mark?, markColor?}}`，聊天里的检定记录据此画骰：四面骰画成读数朝上的三角形（顶上是结果，下两角是这一面的另两个数），被标记的面红底白窗；八面骰画成六边形轮廓里朝上的一面三角，被标记时那一面用标记色；其他骰子是方块。舞台演出里八面骰同样是六边形。
- 资源：`keys` 是按集合分条目的资源；`min`/`max` 是公式；检定的效果夹在上下限内，`strict` 效果越界就拒绝；`secret: true` 的资源对玩家保密：模型照常在记录和 status 里读到，聊天和舞台上的检定记录卡（改了什么、选项预览、掷后资源）都不显示它，记录带 `secret: [资源 id]`（如三角机构的混沌）；`mvu` 见上。

## 字节

- 提示词：无新增（`tavern_check` 不注入说明）。
- `tavern_check` 工具 schema（`defineTool` 后 JSON）：约 2770 字节（v2 的 op 写法与旧写法都在内；其中掷骰点说明 `CALL_HINT` 609 字节，`tavern_roll` 也带同一段），开着 AI检定 的卡都带上（工具表按已安装模组冻结）。写到一半才调用的记录多一个 `at`（约 8 字节）。
- 工具结果（三角机构示例卡实测）：等选择的记录（带预览）1440 字节，结算后 1120 字节，status 3852 字节；带演出的记录多 49 字节（`show`）。

## 测试

- `tests/dice-place.test.mjs`：记录的 `at` 按调用前已写的舞台段落数（同一步里调用前的文字、更早步骤的文字都算，上一轮不算，没写字就没有）；模组何时演（有 `at`、调用后没有段落、没有 `at`、读者在别的轮）、历史重掷在哪一页。
- `tests/fork-check-place-live-stage-browser.test.mjs`：真实舞台上，写到一半才调用的检定和 `tavern_roll` 读到调用之后那一页才掷、之前不出卡；先调工具的记录一到就掷；等玩家选择的在调用处掷、最后一页才开结果页。
- `tests/dice.test.mjs`、`tests/fork-dice-mod.test.mjs`、`tests/fork-dice-roll-browser.test.mjs`、`tests/fork-dice-throw-browser.test.mjs`、`tests/fork-dice-throw-live-stage-browser.test.mjs`：`tavern_roll`。
- `tests/fork-check-throw-live-stage-browser.test.mjs`：检定记录的三维掷骰在真实舞台上：六颗四面骰、一个表达式里的六面/二十面/百分骰按记录的面落定（从模型读回），卡片等骰子落定才出现；带演出的记录、已掷过的结算记录、回复没在跑、减少动态都不掷；点击结束。
- `tests/fork-check-show-live-stage-browser.test.mjs`：结果演出在真实舞台上：live 记录播一次、卡片等演出结束才出现、结算记录与无演出记录不播、历史不播、点击结束、减少动态定格；`DSH_CHECK_SHOW_SHOTS=<目录>` 另存逐帧审阅图。
- `tests/dice-check.test.mjs`：公式、规则校验、结果演出（`show` 的校验，等选择的记录何时带上）、两类规则（2d6 加属性三档、数六的骰池，骰面标记）、等选择与结算、同种子重放、工具记录折叠、资源放在变量里（轮间读变量、轮内接记录、形状不对报路径）、本体读取当前分支的工具结果。
