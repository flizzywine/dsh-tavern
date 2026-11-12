---
name: script-play
description: "管理剧本游玩：导入剧本工作副本，绑定或解绑到当前卡，读取切块，调整游玩中的切块大小与进度，以及在本机静音卡片的 Helper 脚本。改卡内脚本代码用 edit-card。"
---

# 剧本游玩与卡片脚本

这里有两种完全不同的"脚本"，先分清用户说的是哪一种：

| | 剧本（story script） | 卡片 Helper 脚本 |
| --- | --- | --- |
| 是什么 | 小说、剧情大纲等故事素材，游玩时按切块推进 | 卡里自带的 JS 程序（例如 BGM 播放器） |
| 工具 | `tavern_script_manage` 的 `info`、`read`、`import`、`bind`、`unbind`、`browse`、`point`、`chunk-size` | `tavern_script_manage` 的 `helpers`、`mute` |
| 修改内容 | 用文件工具改工作副本，原版不变 | 代码属于卡片，用 edit-card |

## 调用格式

`tavern_script_manage` 只有一个 `request` 参数。多数动作把 `action` 和字段直接写在 `request` 里，只带该动作自己的字段：

- `tavern_script_manage({request:{action:'info'}})`：当前卡；查别的卡加 `path`。
- `tavern_script_manage({request:{action:'read', query:'关键词'}})`：读取当前卡剧本的片段，`offset`（1 起始块号）和 `limit`（最多 6 块）可选；读别的剧本加 `path`。
- `tavern_script_manage({request:{action:'helpers'}})`：只有 `action`，总是当前卡。
- `tavern_script_manage({request:{action:'mute', id:'脚本 ID', muted:true}})`。

进度和切块大小的写入格式见下文。

## 剧本库里的剧本

- `info` 查看当前卡绑定的剧本、总块数、切块大小和游标。没有绑定剧本时如实告诉用户，不去找别的剧本代替。`read` 按需读取片段或搜索关键词（返回含关键词那一块前后的几块），不要一次读完整本。
- `import {file, title?}` 把工作台里的文件导入为剧本工作副本，导入后出现在「剧本库」。已有同名剧本时会复用已有文本，回执会说明；要导入不同内容，换一个新标题。
- `bind {path}` 把剧本绑定到当前卡（一张卡对应一个剧本）。`unbind` 只解除绑定，不从剧本库删除剧本；宿主会先弹出确认。
- 修改剧本文字时，读取相关片段后用文件工具改工作副本；导入的原版不会被改写。

## 游玩中的进度

`browse {playRef, position}` 查看某个游玩记录在剧本中的位置，只读，不推进游标。要调整进度（`point`）或切块大小（`chunk-size`）时：

1. 先 `browse` 取得最新的 `revision`、`cardPath`、`scriptVersion`；
2. 把这三项原样带进写入请求，不要自己补最新值。宿主会提示这会改变那个游玩记录的进度，用户确认后才写入；
3. 收到版本冲突时重新 `browse` 再决定，不重放旧请求。

这四个共用字段放在 `request` 外层，`action` 和新值放进 `operation`，例如：`tavern_script_manage({request:{playRef:'play-chat:…', revision:<browse 返回的值>, cardPath:'…', scriptVersion:'…', operation:{action:'point', position:12}}})`。其他动作把 `action` 和字段直接写在 `request` 里，层级以工具 schema 为准。

需要的游玩记录必须已经关联到工作台（`play-chat:` 引用）；没有时请用户从对应游玩对话进入，不要猜测记录 ID。

## Helper 脚本静音

`helpers` 列出卡的脚本（名称、是否启用、是否本机静音、是否可能播放声音）。`mute {id, muted:true}` 在本机停止整个脚本，不只是静音：例如停掉卡自带的 BGM 播放器，让舞台配乐独占声音。

- 静音只保存在这台机器上，同一张卡的所有会话共用；不改人物卡，也不会随卡导出。
- 静音和卡片自身的"启用"是两回事：取消静音不会启用卡片原本禁用的脚本。
- "可能播放声音"只是根据代码特征的提示，可能误报或漏报。
- `helpers` 只回答卡片脚本的情况。没有 Helper 时说"这张卡没有 Helper 脚本"，并说明舞台音乐、音效、配音等其他声音来源不在这次检查范围内。
- 用户也可以在右侧栏「卡片脚本」页自己切换。

## 用工具完成，按事实报告

- 剧本和脚本静音只通过本 Skill 的工具读写。报错里的 `example` 是最小合法骨架：占位符换成读到的值，空数组只表示类型、不代表清空。工具做不到的事，说明缺什么或界面位置。
- 报告只描述工具结果里出现的事，分清：计划（还没调用写工具）、已问你（等你回复）、等待宿主批准、未获批准没有改动（照审批错误的 `message` 转述，会话策略自动拒绝不说成用户拒绝）、已保存（回执成功且回读到目标值）。

## 完成标准

导入、绑定、静音没有版本检查，写完后用 `info` 或 `helpers` 重新读取，确认结果。进度和切块改动以回执和随后的 `browse` 为准。静音在下一次会话视图刷新时生效，请用户刷新游玩页确认。
