---
name: stage-status-panel
description: "编写人物卡自带的状态面板（data.extensions.dsh_tavern.statusPanel）：游玩时按 S 或 Esc 菜单「状态」打开的整页 HTML，以及它读的 MVU 变量、台账分区和人物头像。galgame 舞台设置、开场画面和皮肤用 stage-setup；加变量用 card-to-mvu。"
---

# 状态面板

状态面板是人物卡自带的一页 HTML，写在人物卡 raw 的 `data.extensions.dsh_tavern.statusPanel`。引擎只提供入口和容器：舞台上的 S 键、Esc 菜单「状态」行，以及一个履历式覆盖层（标题栏、✕、点面板外或 Esc 关闭）。覆盖层里画什么完全由卡的 `html` 决定。

## 要点

- **只读、只给声明的数据。** 面板拿到的是快照：`variables.reads` 里的 MVU 路径、`ledger` 里的台账分区、`figures` 里的人物头像，外加当前皮肤配色。不能写变量、台账或剧情。
- **最新已结算状态。** 打开时读一次；面板开着时每结算完一轮再读一次并推送（`onData`）。生成中的半成品不会出现。
- **没有声明就没有入口。** 卡没有 `statusPanel` 时没有「状态」行，S 键不响应；卡片模式下也没有。面板每次从人物卡库里的卡读取，改完保存后重新打开就是新版本，不需要「应用变化到当前游戏」；第一次加面板后菜单里还没有「状态」，刷新游玩页。
- **只在写入时校验。** 保存时检查一次，失败返回 `CARD_STATUS_PANEL_INVALID` 和出错字段的路径，按报错改完再保存。

## 做法

- **选数据**：从卡的变量结构（初始变量、`[initvar]` 世界书条目、MVU schema）和台账里挑要显示的值，只声明用到的路径和分区。卡没有对应状态时先用 card-to-mvu 加变量，不在 HTML 里写固定值冒充状态。
- **写 HTML**：用 `DshStatusPanel.data()` 画当前快照，`DshStatusPanel.onData(fn)` 接后续推送；配色用快照里的 `theme`。面板文档默认是黑字，舞台表面是深色，不设配色就看不清。
- **写入**：`tavern_update_card` 的 `rawOperations` 只 `set` 到 `/data/extensions/dsh_tavern/statusPanel`，不整个覆盖 `dsh_tavern`（会冲掉 `modSystem` 等同级字段）。
- **交付**：说明面板显示了哪些变量和台账分区，请用户在游玩页按 S 打开，宽屏和窄屏各看一次，再玩一轮看数据是否更新。保存通过不代表视觉效果已确认。

## 参考

- 字段与上限、快照格式、`DshStatusPanel` 接口、配色和渲染方式：[面板合同](references/panel-contract.md)。
- 从零写一个面板：[最小示例](references/example.md)。
