---
name: stage-status-panel
description: "编写卡自带的状态面板（data.extensions.dsh_tavern.statusPanel）：游玩时按 S 键或 Esc 菜单「状态」打开的整页面板，面板 HTML、读哪些 MVU 变量和台账分区、显示哪些人物头像。用户说状态面板、S 键、Esc 菜单「状态」、卡自带面板、写面板 HTML 时使用。正文周围的 HUD 和特效层（dsh_stage）用 card-stage；galgame 舞台、开场画面和皮肤用 stage-setup。"
---

# 状态面板

本 Skill 只管状态面板：card-stage 管 `dsh_stage` 的 HUD 展示层，stage-setup 管 galgame 舞台设置。

状态面板是人物卡自带的一页 HTML，写在人物卡 raw 的 `data.extensions.dsh_tavern.statusPanel`（与 `openingSetup` 同级）。引擎只提供入口和容器：舞台上的 S 键、Esc 菜单里「履历」和自动/快进之后的「状态」行，以及一个履历式的覆盖层（标题栏、关闭按钮、S/Esc 关闭）。覆盖层里画什么完全由卡的 `html` 决定。

## 要点

- **只读。** 面板拿到的是数据快照，不能写变量、台账或剧情。只能读到卡声明的东西：`variables.reads` 里的 MVU 路径、`ledger` 里列出的台账分区、`figures` 里列出的人物头像，其余一概看不到。
- **最新已结算状态。** 数据取自最近一次已结算的回合。打开时读一次；面板开着时，每结算完一轮再读一次并推给面板（`onData`）。生成中的半成品不会出现。
- **没有声明就没有入口。** 卡没有 `statusPanel` 时，菜单里没有「状态」行，S 键也不响应；卡片模式下也没有。面板定义每次从人物卡库里的卡读取，改完保存后重新打开面板就是新版本，不需要「应用变化到当前游戏」；第一次给卡加面板后菜单里还没有「状态」时，刷新游玩页。
- **只在写入时校验。** 定义在保存时检查一次，报错随保存结果返回，按报错改完再保存。

## 做法

- **选数据**：从卡的变量结构（初始变量、`[initvar]` 世界书条目、MVU schema）和台账里挑面板要显示的值，只声明真正用到的路径和分区。卡没有对应状态时先用 card-to-mvu 加变量，不在 HTML 里写固定值冒充状态。
- **写 HTML**：用 `DshStatusPanel.data()` 渲染当前快照，用 `DshStatusPanel.onData(fn)` 接收后续推送；配色用快照里的 `theme`，与当前舞台皮肤一致。小图可以内联成 `data:` URI。
- **写入**：用 `tavern_update_card` 的 `rawOperations` 只改 `data.extensions.dsh_tavern.statusPanel`，人物卡其他部分不变（用户另有要求除外）；看保存结果附带的校验。
- **交付**：说明面板显示了哪些变量和台账分区，请用户在游玩页按 S 打开，宽屏和窄屏各看一次，再玩一轮看数据是否跟着更新。保存通过不代表视觉效果已确认。

## 参考

- 写或改字段、数据格式、`DshStatusPanel` 接口、皮肤配色和渲染方式时读 [面板合同](references/panel-contract.md)。
- 从零开始写一个面板、需要最小可用模板时读 [最小示例](references/example.md)。
