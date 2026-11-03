---
name: stage-setup
description: "galgame 舞台模式入门：给卡开舞台、设置向导、看不到立绘的排查、四态开关、皮肤、开场画面，以及配立绘与声音、本卡开模组、导入 Live2D、带素材分享卡的最短路线。开场白文字用 edit-card。"
---

# 舞台设置

这里的舞台指 galgame 舞台。先读对应参考再回答，界面路径原样引用：

- 开舞台、看不到立绘：[开舞台](references/quickstart.md)
- 立绘与声音、皮肤、本卡模组、Live2D、分享：[常见任务](references/tasks.md)
- 四态开关、全局写入、调用格式：[开关与皮肤](references/settings.md)
- 开场画面：[开场画面](references/openings.md)
- 字体与阅读控制：[本机显示与阅读](references/local-ui.md)

对用户说皮肤、素材包和人物时用显示名（说「雨夜街道」，不说 `rainy-street-02`），id 只写进工具调用。

`tavern_stage_patch` 写开场画面、本卡皮肤和全局开关；本卡开关只能由用户在界面里选。报告分清计划、待批准、未改动和已保存（回读到目标值）。
