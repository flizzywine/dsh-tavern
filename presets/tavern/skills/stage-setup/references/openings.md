# 开场画面

字段以 `tavern_stage_read schema {section:'openings'}` 为准，下面说明含义和容易出错的地方。

## 结构

```json
{
  "lead": {"packId": "…", "figureId": "…"},
  "scenes": {
    "alternate:0": {
      "greeting": "读取结果里这条开场白的指纹",
      "background": {"packId": "…", "kind": "backgrounds", "assetId": "rooftop"},
      "timeOfDay": "dusk",
      "music": null,
      "cg": {"ref": {"packId": "…", "kind": "cg", "assetId": "…"}},
      "cast": [
        {"figure": {"packId": "…", "figureId": "…"}, "outfitKey": "basin", "emotion": "<差分 ID>"}
      ]
    }
  }
}
```

- 开场白 ID：`primary`（第一条开场白）或 `alternate:N`（第 N 条备选，从 0 开始）。`greeting` 指纹从读取结果原样抄写，不要自己计算。备选开场白重新排序后，画面靠指纹跟随原文。
- `background`、`music` 为 `null` 表示没有；`timeOfDay` 为 `day`/`dusk`/`night`，`null` 表示自动（不加时段滤镜）。`cg` 可省略。
- `cast` 最多 3 人，顺序就是站位（左到右，单人居中），同一人物不能出现两次。`outfitKey` 为 `null` 时使用人物的默认服装；`emotion` 填人物已声明的差分 ID。
- `lead` 是卡的主角，只用于概要显示和默认判断；它不会让主角自动出现在开场里。

## 整体写回

`openings` 作为一个整体保存。修改一条开场白时，读出现有的 `lead` 和全部 `scenes`，只改目标那条，其余原样带回；漏掉的开场白会变回默认。要让某条开场白"使用默认"，就从 `scenes` 里删除那一项。

## 没有设置时的默认

没有设置画面的开场白：无背景（显示随舞台主题变化的渐变）、时段自动、不放人物、BGM 取当前卡绑定包里第一首可用音乐（没有就无）。它不会借用其他开场白的人物或背景。第一段正文之后由导演照常安排。

## 改开场白原文之后

开场白文字被改写后，画面先按指纹找，找不到时按同一个开场白 ID 匹配。改完文字后重新读取一次，确认画面仍挂在想要的开场白上。

## 例子

用户："第二个开场白让大肥鱼头戴铁盆站在天台，黄昏，放《放学后》。"
→ `tavern_stage_read card` 找到 `alternate:0` 及指纹；在当前卡能用的包里用 `item` 找到大肥鱼、天台背景和这首音乐的引用（不在已绑定的包里就先绑定）；在 `scenes["alternate:0"]` 写入背景、`timeOfDay:"dusk"`、音乐和一人 `cast`，其他开场白原样保留；用 `tavern_stage_patch card` 保存后回读。请用户在游玩页选这条开场白查看画面。
