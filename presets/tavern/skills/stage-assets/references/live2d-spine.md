# Live2D 与 Spine

用户要给人物导入 Live2D 或 Spine 模型、替换模型，或舞台上提示「Live2D 未安装」时读这篇。

## 用户自己导入（最简单）

- 已有人物：人物编辑页选中服装 › 切到「模型」视图 ›「导入模型」（已有模型时即替换）。
- 新建人物：包里「添加文件」→「导入模型…」，在对话框里选「新人物」并填名称。
- 选模型文件夹或 ZIP：Live2D 要 Cubism 3 及以上的 `.model3.json`；Spine 要 `.skel` 或 `.json`，加同文件夹的 `.atlas`。对话框里给每个差分选表情或动作。

## 用工具导入 Live2D

1. 用 `tavern_media_upload` 的 `bundle` 上传模型目录：`{action:'bundle', packId, expectedRevision, directory:'models/xiaocheng', bundleKey:'…', kind:'live2d', entry:'xiaocheng.model3.json'}`。
2. 用 `patch-figure` 在服装里写模型引用和 `emotionMap`：每个差分对应 `{expression?, motion?}`，至少一项，名称取自模型自带的表情和动作组（见[人物字段](figure-fields.md)）。数组整体替换，先读出现有服装。
3. 回读人物，请用户在素材库或舞台上看一次模型和表情。

Spine 只能在界面导入，工具上传不了。

## 运行库

Live2D 的 Cubism Core、pixi-live2d-display 显示库和 Spine 的 pixi-spine 不随应用分发，也不属于素材包。

- Live2D：用户在「设置」›「舞台」›「运行库」点「下载并安装…」，同意许可后应用从官方下载 Cubism Core 与 `pixi-live2d-display`（下载失败时可把官网下载的文件拖进来；Core 适用 [Live2D 专有软件许可](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)，显示库适用 [Live2D 开放软件许可](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html)）。舞台上的「Live2D 未安装 · 安装」提示打开同一入口。
- Spine：用户打开官方页下载后导入 `pixi-spine.umd.js`，需要自己的 Spine 授权。

许可要用户本人同意，工具不替用户下载。没装时舞台改用同服装的静态立绘，再退到头像。

## 完成标准

回读人物看到服装里的模型引用和差分对应；用户在舞台上看到模型而不是静态图（没装运行库时先装运行库）。
