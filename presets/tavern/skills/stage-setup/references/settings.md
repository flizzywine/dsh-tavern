# 开关与皮肤

## 四态开关

舞台设置 › 基础设置的每个开关都有四个状态：全局开启、全局关闭、本卡开启、本卡关闭。生效顺序是 本卡关闭 > 全局开启 > 本卡开启 > 全局关闭，也就是这张卡选过就按这张卡的，没选过就跟随全局。在卡上选「全局…」会清掉这张卡的选择并改全局。

| 界面名 | 引擎 `stageToggles` 键 | 全局默认 | 依赖 |
| --- | --- | --- | --- |
| 对话气泡 | `dialogue` | 关 | — |
| 配音（四态开关，› 打开详情） | `voice` | 开 | 对话气泡 |
| 舞台模式 | `stage` | 关 | 对话气泡 |
| BGM / 音效 / 环境音 | `music` / `sfx` / `ambience` | 开 | 舞台模式 |
| 物品 / 演出组合 / 入场演出 | `items` / `performance` / `entrance` | 开 | 舞台模式 |

- 对话气泡和舞台模式的本卡层是卡的舞台声明（`stage.enabled`），点「启用舞台（对话气泡）」或导入带舞台的卡时就是本卡开启。全局层在 设置 ›「舞台」›「基础设置」，默认关，所以普通人物卡不受影响。
- 其余开关的本卡层是 `stage.switches`（`'on'` / `'off'`，没有这个键就跟随全局）。
- 基础设置的「配音」是四态开关，› 打开配音页：通用声音（所有卡共用，可选「不配音」）、旁白（四态开关，默认全局关闭）、旁白声音（旁白开启时显示）。旁白声音默认写全局，「本卡单独指定」开启时写本卡，关闭时移除本卡声音；没有单独指定声音的旁白使用通用声音。这些都由用户在界面里设置。
- 同一区还有「自动生成选项」（全局层是 设置 › 剧情「自动生成候选项」）和「默认皮肤」。
- 某张卡没有对应素材时，开关开着导演也收不到相关说明，不需要为此关开关。

本卡层只能由用户在界面里选；工具能读、不能写。

## 调用格式

每个工具只有一个 `request` 参数。读取把 `action` 和字段直接写在 `request` 里；写入把 `expectedRevision` 和 `patch` 放在外层，`action` 放进 `operation`。

- 读卡：`tavern_stage_read({request:{action:'card'}})`，不带 `path` 即当前卡；`bindings.revision` 是写卡要用的 revision，`bindings.extension.stage` 是本卡层，`openings` 是开场画面。
- 写卡：`tavern_stage_patch({request:{expectedRevision:'卡的 revision', patch:{defaultSkin:'crt'}, operation:{action:'card'}}})`。卡补丁只接受 `openings` 和 `defaultSkin`。
- 读写引擎（全局）：`tavern_stage_read({request:{action:'engine'}})`；`tavern_stage_patch({request:{expectedRevision:'引擎 revision', patch:{…}, operation:{action:'engine'}}})`。
- 可写字段：`tavern_stage_read({request:{action:'schema', section:'engine'}})`（或 `'openings'`）。

## 完整例子：关掉所有卡的 BGM

1. `tavern_stage_read({request:{action:'engine'}})`：记下引擎 `revision`，确认 `stageToggles.music` 当前为 `true`。
2. 告诉用户"这是全局设置，会影响所有卡片：关闭 BGM，选了本卡开启的卡不受影响"，再调用 `tavern_stage_patch({request:{expectedRevision:'第 1 步的引擎 revision', patch:{stageToggles:{music:false}}, operation:{action:'engine'}}})`。补丁只带要改的键。宿主在这次调用中请用户确认。
3. 回执成功后再读 `engine`，`music` 为 `false` 才报告"已关闭"；审批未通过时报告"没有改动"。

用户只想让某一张卡没有 BGM 时，不改全局：请用户在这张卡的基础设置「BGM」选「本卡关闭」。

## 皮肤

- 本卡皮肤：卡补丁的 `defaultSkin`，界面叫「使用皮肤」，随卡导出、导入即选中；玩家在舞台控制栏齿轮「设置」›「画面」›「本卡皮肤」换皮肤也改它。
- 默认皮肤：引擎的 `dialogueTheme`（全局），界面是 舞台设置 › 舞台模式 › 皮肤「默认皮肤」，给所有没指定皮肤的卡用。
- 可选值：内置 `classic`（经典，沉静深色）、`crt`（显像管，深夜绿色荧光）、`aero`（千禧晴空，天空蓝玻璃）；包里的皮肤写 `{packId, kind:'skins', assetId}`，所在包要对这张卡生效。候选用 `tavern_assets_read` 的 `item {kind:'skins'}` 查。
- 用户问"有哪些皮肤"时，列出内置皮肤和当前卡可用包里的皮肤条目。

## 其他全局引擎设置

`dialogue` 里有气泡差分列表、格式注入和正文语言（`zh` / `ja` / `en`）。保存后宿主刷新每张卡由插件管理的气泡格式世界书条目，那条条目不用 edit-card 手改。可用演出（`dimensions`）和每轮上限（`actionCaps`）属于 stage-directing；导演模型在 设置 ›「舞台」›「舞台模型」，由用户在界面选。人物声音（及其所用的服务）属于 figure-voice。只改用户要改的字段，补丁里不带其他字段的旧值。

## 进行中的游戏

开场画面只在开场白显示时使用，不改变已经开始的游戏的背景、人物或音乐。开关和气泡格式改动在之后的轮次生效；进行中的会话的正文格式在新会话或上下文压缩后才换成新格式。

## 完成标准

写入回执成功，回读显示目标值。交付时请用户在游玩页看一次；没看过页面时只说"已保存"。工具做不到的事（本卡开关、设置向导、字体），给出界面位置并说明需要用户自己操作。报错里的 `example` 是最小合法骨架：占位符换成读到的值，空数组只表示类型、不代表清空。
