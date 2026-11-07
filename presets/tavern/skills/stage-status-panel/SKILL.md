---
name: stage-status-panel
description: "编写人物卡自带的舞台卡页面（data.extensions.dsh_tavern.pages，最多 8 页）：标题页、开场页、地图、状态等整页 HTML，用快捷键（shortcut）、Esc 菜单行（menu）或进入舞台时（showOn）打开；页面带完整 Tavern Helper（发送、生成、变量、MVU、世界书）和 DshCardPage（素材、台账、头像、配色、填入输入框），以及舞台设置「跳过标题页」怎样影响 showOn。galgame 舞台设置、开场画面和皮肤用 stage-setup；加变量用 card-to-mvu。"
---

# 舞台卡页面

卡页面是人物卡自带的整页 HTML，写在人物卡 raw 的 `data.extensions.dsh_tavern.pages` 数组里，每项一页。舞台只提供入口和容器：快捷键、Esc 菜单行、进入舞台时自动打开，以及一个跟随皮肤的覆盖层（标题栏、✕、Esc 关闭）。页面里画什么、做什么完全由卡的 `html` 决定。标题页、开场页、地图、状态都只是普通页面，没有哪个 id 有特殊含义。

## 要点

- **完整的 Helper，和正文里的卡片 HTML 一样。** 页面运行在文字模式卡片 HTML 的同一个框架和信任模型里：发送、生成（`triggerSlash`、`generate`）、`setChatMessages`、聊天变量与 MVU（`getVariables`、`replaceVariables`、`Mvu`）、世界书（`getWorldbook`、`updateWorldbookWith`），受信任时还能访问父页面。规则全部照上游 Helper，舞台不另加限制。世界书写的是人物卡库里的世界书，用它的其他聊天也会看到。
- **舞台只补一层 `DshCardPage`。** 本卡素材包的图片和视频（`asset`/`assets`）、声明的台账分区和人物头像、当前皮肤配色（`data`/`onData`），以及页面动作 `close`、`open`、`openSettings`、`fillInput`；标题页还有 `newGame`、`continueGame`、`openGallery`、`exit` 和皮肤界面音效 `sound`（或给按钮加 `data-dsh-sound`），`data().saved` 告诉页面「继续」能不能用。进入舞台时打开的 showOn 页开着时舞台的这一句（配音、自动播放）等进入舞台再开始；关掉这一页是回到文字模式，进入舞台用 `continueGame()`。
- **三种入口。** `shortcut` 是一个小写字母，按下开关这一页；`menu:true` 在 Esc 菜单里加一行；`showOn:{event:'stage-enter'}` 在玩家每次从文字模式进入舞台时打开（重新挂载、换轮、改设置不算）。加 `initial:true` 的 showOn 页只在新聊天（还没有玩家消息）时出现。
- **每次进入只开一页，取数组里第一个匹配的。** 新聊天有 `initial` 页时开第一个 `initial` 页；否则玩家打开了舞台设置「跳过标题页」就不开页、直接继续；否则开第一个不带 `initial` 的 showOn 页。「跳过标题页」不跳过 `initial` 页。
- **没有声明就没有入口。** 卡没有 `pages` 时没有页面行、没有页面快捷键；卡片模式下也没有。页面每次从人物卡库里的卡读取，改完保存后重新打开就是新版本，不需要「应用变化到当前游戏」。
- **只在写入时校验。** 保存时检查一次，失败返回 `CARD_PAGES_INVALID` 和出错字段的路径（如 `pages.1.shortcut`），按报错改完再保存。旧版状态面板字段已不再读取，要改写成 `pages` 里 id 为 `status` 的一页。

## 做法

- **定页面**：先说清每页做什么、怎么打开。标题页用 `showOn` + `size:'full'`；开场页用 `showOn` + `initial:true`；地图、状态这类随时查看的页用 `shortcut` + `menu:true`。快捷键只能用合同里列出的字母，且不能重复。
- **选数据**：变量从卡的变量结构（初始变量、`[initvar]` 世界书条目、MVU schema）里挑，用 Helper 读；台账分区和头像人物在页面声明里列出，用 `DshCardPage.data()` 读。卡没有对应状态时先用 card-to-mvu 加变量，不在 HTML 里写固定值冒充状态。
- **写 HTML**：页面文字从卡和变量里读，不把卡的剧情写死在代码里。配色用 `data().theme`，页面文档默认黑字，舞台表面是深色。按[合同](references/panel-contract.md)「怎么画」处理铺满、手机、键盘、减少动态和静音视频。
- **写入**：`tavern_update_card` 的 `rawOperations` 只 `set` 到 `/data/extensions/dsh_tavern/pages`，一次写整个数组；不整个覆盖 `dsh_tavern`（会冲掉 `modSystem`、`assetBindings` 等同级字段）。
- **交付**：列出每页的 id、入口和用到的数据，请用户在游玩页逐个打开，宽屏和窄屏各看一次；showOn 页要从文字模式进一次舞台确认，再玩一轮看数据是否更新。保存通过不代表视觉效果已确认。

## 参考

- 字段与上限、入口规则、Helper 与 `DshCardPage` 接口、配色、渲染和画法：[页面合同](references/panel-contract.md)。
- 两张完整示例卡（标题页 + 开场页；地图 + 状态页），分别为不同皮肤设计：[示例](references/example.md)。
