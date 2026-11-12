# AI检定 `dsh.dice`

两个前台工具，由写正文的模型调用：

- `tavern_roll`（`dice.js`、`tools.js`）：没有规则的卡用的 1d100 检定，五档结果，可暗骰。
- `tavern_check`（`check-expr.js`、`check-engine.js`、`check-tool.js`）：卡自己声明检定规则时用的规则检定。引擎按卡的规则掷骰、结算，模型只提出检定和写正文。

## 用到的接口

- 前台工具：`tools.js` 默认导出两个工具（`lib/mod-tools.js`）。工具的 core 里有 `readCard(chat)`（这局游戏用的卡，开局时冻结）和 `results(exec)`（本工具在这局当前分支上的历史结果文本，`lib/domain/surface-tool-results.js`）。
- 提示词：`mod.json` 的 `rules`（只讲 `tavern_roll`）。`tavern_check` 不加提示词：用法写在工具说明里，每张卡的规则用 `action: "status"` 读。
- 本体客户端部件：`client/core.js` 把 `roll.js`（`tavern_roll` 的卡片与 3D 掷骰）和 `check.js`（`tavern_check` 的记录卡）放进聊天楼层与舞台文本框上沿；舞台叠层是 `throw.js`（掷骰飞入）和 `show.js`（检定结果的演出，见下文 `show`；画面在 `show-art.js`，声音在 `show-sound.js`）。

## 持久状态

两个工具都不另存数据：唯一的记录是回合里的工具结果。`tavern_check` 的每条记录带着结算后的全部资源（`state`），最新一条就是当前资源；记录跟着回合走，重新生成或回退一轮，那一轮的检定和资源变化一起消失。等玩家选择的记录（`status: "awaiting"`）资源不变，`settle` 用它自己的种子重放后结算。

资源也可以放在卡的 MVU 变量里：资源写 `mvu: "/特工/混沌"`（stat_data 下的路径，各段不含 `/` 和 `~`）。这时轮与轮之间以变量为准，引擎每次从游戏最新存下的变量读（与 `tavern_read_variables` 同一个读取）；同一轮里变量还没结算，以本轮最新的记录为准（记录带 `turn`）。变量形状不对（不是整数、条目不在集合里）就拒绝并报出路径；变量里还没有的路径沿用记录或初始值。变化行带 `path`，即那个变量的新值：引擎不写变量，由正文把新值写出来、再由变量结算照抄（卡的更新规则里写明），所以「每个数字只由引擎算」仍成立，但「变量照抄」靠模型。

已知缺口：不用变量的资源只跟着记录走，上下文压缩把很早的工具结果移出当前分支、又没有记录留下时，会回到初始值。

## 规则数据（`dsh-check-rules` v1）

卡的 `data.extensions["dsh.dice"].rules`：

```json
{
  "format": "dsh-check-rules", "version": 1, "name": "规则名",
  "guide": "给模型的一句话：这套规则什么时候掷骰",
  "sets": { "stats": ["力量", "敏捷"] },
  "resources": {
    "hp": { "label": "生命", "initial": 10, "min": 0, "max": "hpMax", "gm": true, "note": "说明" },
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
- 公式：数字、`'文字'`、`true/false`、名字、`+ - * / %`、比较、`and or not`、`a ? b : c`、`列表[序号]`、`count sum len max min abs floor ceil clamp has`。名字是资源、集合、参数、骰子、步骤、选择和 `outcome`；`each` 效果里 `key` 是正在改的条目。规则在载入时校验一次，拼错的名字带路径报错。
- 演出：结果可以写 `show`，让舞台在这个结果出现时演一段，名字只能从引擎的 `CHECK_SHOWS` 里选，载入时校验。现在只有 `converge`（约 7 秒，盖住整个舞台，含文本框）：三片快门合上，舞台变成一张白纸；这次的骰子排成一行，没标记的划成空框，被标记的面（`mark`）逐个点数，飞到一个大图形的角上（三个就是三角形），尺规连边、盖章填实，停一拍；图形吞掉整个舞台，满屏标记色（`markColor`）上描出三座光尘三角，结果名用尽量大的字逐字砸下，最后整片收回图形、归档到文本框上的记录卡。画面只用纸白、墨黑、标记色三个平涂色，由一张 canvas 逐帧画出（`show-art.js`）。声音是代码合成的（`show-sound.js`，没有音频文件）：每个节拍一声，点数的音各高五度，高潮是这几个音合成的大三和弦；走舞台「音效」总线，音效或总音量静音、为 0 时不出声也不合成；在后台线程合成，不卡画面。记录带 `show: {effect, label}`（label 是结果名）。结果在玩家选择之前就已确定时（它和排在它前面的结果都只读掷骰前已知的名字，如三角机构的三重升华），等选择的记录就带上 `show`，演出在掷骰时播一次，结算记录（`of` 指向它）不再播。只在 live 新出现的记录上播；重新载入、翻历史、片段回放都不播；点一下或 Esc 结束，声音同时掐断；减少动态时不动，只淡入高潮的定格再淡出，声音只有三声轻钟音和和弦、没有撞击声；光敏保护下图形吞掉舞台的那一下放慢，全程没有闪烁。聊天楼层只把结果名染成标记色。
- 骰子：`dice.<名字> {count, sides, mark?, markColor?}`。`mark` 是本作要突出的面（如三角机构的 `[3]`），`markColor` 是它们的颜色（`#rrggbb`，不写用主题强调色），都只影响显示；记录带 `faces {<名字>: {sides, mark?, markColor?}}`，聊天里的检定记录据此画骰：四面骰画成读数朝上的三角形（顶上是结果，下两角是这一面的另两个数），被标记的面红底白窗；其他骰子是方块。
- 资源：`keys` 是按集合分条目的资源；`min`/`max` 是公式；检定的效果夹在上下限内，`strict` 效果和所有 GM 调整越界就拒绝；`gm: true` 的资源模型可以用 `action: "adjust"` 带理由改；`secret: true` 的资源对玩家保密：模型照常在记录和 status 里读到，聊天和舞台上的检定记录卡（改了什么、选项预览、掷后资源）都不显示它，记录带 `secret: [资源 id]`（如三角机构的混沌）；`mvu` 见上。

## 字节

- 提示词：无新增（`tavern_check` 不注入说明）。
- `tavern_check` 工具 schema（`defineTool` 后 JSON）：2008 字节，开着 AI检定 的卡都带上（工具表按已安装模组冻结）。
- 工具结果（三角机构示例卡实测）：等选择的记录（带预览）1440 字节，结算后 1120 字节，status 3852 字节；带演出的记录多 49 字节（`show`）。

## 测试

- `tests/dice.test.mjs`、`tests/fork-dice-mod.test.mjs`、`tests/fork-dice-roll-browser.test.mjs`、`tests/fork-dice-throw-browser.test.mjs`、`tests/fork-dice-throw-live-stage-browser.test.mjs`：`tavern_roll`。
- `tests/fork-check-show-live-stage-browser.test.mjs`：结果演出在真实舞台上：live 记录播一次、卡片等演出结束才出现、结算记录与无演出记录不播、历史不播、点击结束、减少动态定格；`DSH_CHECK_SHOW_SHOTS=<目录>` 另存逐帧审阅图。
- `tests/dice-check.test.mjs`：公式、规则校验、结果演出（`show` 的校验，等选择的记录何时带上）、两类规则（2d6 加属性三档、数六的骰池，骰面标记）、等选择与结算、同种子重放、工具记录折叠、资源放在变量里（轮间读变量、轮内接记录、形状不对报路径）、本体读取当前分支的工具结果。
