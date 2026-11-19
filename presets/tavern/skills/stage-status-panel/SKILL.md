---
name: stage-status-panel
description: "编写人物卡自带的整页 galgame 舞台 HTML：标题页、开场页、开局页、地图或 MVU 状态页（包括手机样式），配置 Esc 菜单、快捷键和进入舞台时的打开方式。配置游戏内的手机模组用 stage-mods。"
---

# 舞台卡页面

卡页面是人物卡自带的整页 HTML，写在 `data.extensions.dsh_tavern.pages` 数组里。舞台只提供入口和跟随皮肤的容器，页面里画什么由卡的 `html` 决定；页面和正文里的卡片 HTML 用同一套 Helper，舞台另补 `DshCardPage`（素材、台账、头像、皮肤配色和页面动作）。字段、入口规则、接口和画法见[页面合同](references/panel-contract.md)；两张完整示例卡见[示例](references/example.md)。

- **选入口**：状态、地图等随时查看的页用 `menu:true` 和一个合法且不冲突的 `shortcut`；标题页用 `showOn` + `size:'full'`；只在新聊天出现的开场页再加 `initial:true`；带开局表单的整页用 `opening:true`，不是 `initial`。
- **状态页只展示真实数据**：先读本卡各开场的初值、变量路径和更新规则。当前数值读 MVU 的 `stat_data`，结算后刷新；没有对应变量、或仍用 ERA 等旧协议，先走 `card-to-mvu`。手机样式的状态页是一张普通卡页面，不需要启用手机模组（`dsh.phone`）；要让剧情里的短信和来电显示成手机画面时，才用该模组（`stage-mods`）。头像和台账从 `DshCardPage` 取，不用假数据填空。
- **写 HTML**：页面文字从卡和变量里读，不把剧情写死在代码里。配色取 `data().theme`，文字和背景颜色都从它取：皮肤有深色也有浅色，不假定某一种。
- **写入**：读取并保留已有页面，用 `tavern_update_card.rawOperations` 只 `set` 到 `/data/extensions/dsh_tavern/pages`，一次写整个数组，不覆盖同层的绑定、舞台和模组配置。保存失败返回 `CARD_PAGES_INVALID` 和出错字段的路径，按报错改完再保存。旧 `statusPanel` 不再读取；迁移后只保留一个对应的状态入口。
- **生效**：页面 HTML 每次打开时从人物卡库读取，改完保存后重新打开就是新版本；新增或删除页面、改 id、入口、快捷键、尺寸，要刷新游玩页才生效。
- **交付**：列出每页的 id、入口和用到的数据。请用户在游玩页用快捷键或菜单打开每一页，宽屏和窄屏各看一次；showOn 页要从文字模式进一次舞台确认；状态页再玩一轮看数值是否随结算更新。只验证过保存时，注明未试玩。
