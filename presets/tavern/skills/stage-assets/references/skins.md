# 皮肤条目

用户要把一套舞台皮肤放进素材包时读这篇。给卡选用哪个皮肤（本卡皮肤、默认皮肤、内置的经典/显像管/千禧晴空）在 stage-setup。

## 是什么

皮肤条目（`kind:'skins'`）指向包里的一个皮肤资源包（`bundleKey`），入口是一个 `.json` 皮肤文档（`dsh.skin/1`，≤256 KiB，可带 WOFF2 字体和静态 SVG）。皮肤没有灯：所在包对这张卡生效时，它就出现在皮肤选项里。素材库界面没有「添加皮肤」按钮，只能删除；皮肤通常随素材包安装（[安装与导出](transfer.md)）。

## 用工具放进一套皮肤

1. `tavern_assets_read({request:{kind:'skins', operation:{action:'schema'}}})` 看字段；`item {kind:'skins', packId}` 记下包的 `revision`。
2. 先上传资源包：`tavern_media_upload({request:{action:'bundle', packId:'…', expectedRevision:'…', directory:'skins/rain', bundleKey:'skin-rain', kind:'skin', entry:'skin.json'}})`。资源包要先存在，条目才能写（否则报 `Missing skin bundle`）。
3. 用回执的新 revision 写条目（目前皮肤条目也要 3–6 个触发词，否则报 `TRIGGER_LINT`）：`tavern_assets_patch({request:{expectedRevision:'…', operation:{packId:'…', operation:{action:'item', item:{kind:'skins', id:'rain', name:'雨夜', recall:{mode:'constant', keywords:['雨夜', '下雨', '夜雨']}, directorNote:'', bundleKey:'skin-rain', entry:'skin.json'}}}}})`。
4. 回读条目；请用户在 舞台设置 › 皮肤，或舞台齿轮「设置」›「画面」›「本卡皮肤」选它看一次。

## 完成标准

条目回读成功，且用户在皮肤选项里看到并试过它。
