# 大肥鱼 · DSH 人物卡样板

[DSH Tavern Galgame](https://github.com/jerryzmtz/dsh-tavern-galgame) 分支的示例卡「大肥鱼」做成的 DSH 人物卡（`.dshcard`，见[格式设计](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Adsh-card-format)）。它是 DSH 人物卡格式的样板：一个文件里有人物卡、4 个素材包、推荐预设和开局设置，导入后不用装插件就能玩到 Galgame 式的舞台：舞台由 Tavern 按卡绑定的素材包来导演和绘制，卡里不带插件代码。已取得原作者同意，作为演示卡分发。

- `presets/`：推荐预设，开新局时默认使用。
- `build.mjs`：从分支发布的卡包生成原料卡 `大肥鱼.source.dshcard`（约 270 MB，原始素材，含 Live2D）。只用来生成分发版，不直接导入。
- `compress.mjs`：从原料卡生成压缩后的 `大肥鱼.dshcard`（约 90 MB）。PNG 转 WebP、音乐和音效转 Ogg Opus，`--drop-live2d` 去掉 Live2D 模型，并去掉旧版卡里的卡内插件；每个素材包里写一份 `credits/DSH-CARD-CHANGES.md` 说明改动。
- `RELEASE.md`：发布说明。

- `../dshcard-png.mjs`：把 `大肥鱼.dshcard` 接在封面后面，生成带封面的 `大肥鱼.dshcard.png`：系统和聊天软件显示封面，Tavern 导入整张卡。Release 里放的就是它。有封面的卡都这样分发，没有封面的保持 `.dshcard`。

这些卡文件都太大，不进仓库（`.gitignore`）。改了预设或打包脚本后重新生成：

```sh
node examples/dafeiyu-card/build.mjs dafeiyu.card-bundle.zip examples/dafeiyu-card/大肥鱼.source.dshcard
node examples/dafeiyu-card/compress.mjs examples/dafeiyu-card/大肥鱼.source.dshcard examples/dafeiyu-card/大肥鱼.dshcard --drop-live2d
node examples/dshcard-png.mjs examples/dafeiyu-card/大肥鱼.dshcard examples/dafeiyu-card/大肥鱼.dshcard.png
```

`compress.mjs` 需要 `cwebp` 和带 libopus 的 `ffmpeg`。

使用：在 Tavern 的人物卡库导入 `.dshcard.png`（或 `.dshcard`），刷新页面；在「舞台设置 › 基础设置」打开「对话气泡」和「舞台」，开一局，点聊天顶部的「舞台」。

`--cast` e2e 在 `大肥鱼.dshcard.png` 存在时会导入它玩一轮（也可以用 `TAVERN_E2E_DSHCARD` 指定别的路径）。

第一版是样板，不复刻分支的全部功能：没有 Live2D、眨眼、口型、镜头、天气和模组。素材的署名与许可见卡内各素材包的 `credits/`。
