# 手机 `dsh.phone`

角色用手机收发消息时，舞台上显示成手机画面。导演把正文里的短信、聊天消息、语音和通话对白标记成手机演出，联系人是对话的另一方，可以是群聊；正文原文不变，只是拿出手机却没有收发消息时不标记。例：正文写「手机震了一下，是小澄发来的：‘到家了吗？’」，导演可以把这句显示成小澄的来信。玩家也可以在手机界面里主动发起通话，或设置照片和墙纸。

- 手机外壳和三种提示音是内置的，不需要素材条目，开关生效就可用。素材库里的壁纸、提示音和图片可以拿来做壁纸、来信提示音和联系人头像。
- 外观设置（全局或本卡）：状态栏时间 `clockText`（默认 09:41）、日期 `dateText`、星期 `weekdayText`、是否显示状态栏 `statusBar`、电量 `battery`（默认 80）、信号 `signal`（默认 4 格）、运营商 `carrier`、顶部样式 `cutout`（`island` 默认 / `notch` / `none`）、主题色 `accentColor`、内容底色 `surfaceColor`、机身颜色 `bodyColor`、内置提示音 `sound`（`drop` 默认 / `chime` / `pop`）。
- 素材与文件：
  - `defaultWallpaperRef`「壁纸」、`notificationToneRef`「提示音素材」：素材库条目的引用 `{packId, kind, assetId}`，`{}` 表示不用。
  - `contacts`：按人物覆盖联系人，头像写 `avatarRef`（同样是素材引用）。
  - `wallpaper`「墙纸」：一张上传的图片 `{file}`；`photos`「照片」：最多 30 张上传的图片 `[{file, name?}]`。图片先用 `tavern_media_upload` 的 `mod-file` 上传到对应层，再把返回的文件写进设置；本卡层的值整体替换全局层。
  - `muted`「静音」、`volume`「音量」（默认 1）。
- 电量等要跟随剧情时，引用 MVU 变量（[设置值与变量来源](mod-config.md)），例如本卡层 `battery` 写 `{ref:{source:'mvu', path:'/手机/电量'}}`。
- 不要在正文、世界书或开场白里教模型写手机格式；手机内容由导演从正文对白里识别。
