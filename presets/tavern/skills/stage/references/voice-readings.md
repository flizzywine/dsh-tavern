# 读音词典

用户说某个名字或词读错了（「把林澄读成 chéng」）时读这篇。读音词典是全局设置，影响所有卡和所有声音；它和声音预设（`presets`，调音用）无关。界面在「配音后端」页的读音一节。

## 改一个读音

1. `tavern_voice_read({request:{action:'readings'}})`：看现有预设和当前使用的一套；`readings {id}` 读一套的条目和整数 `revision`。
2. 先说明「这是全局设置，会影响所有卡片」，再写入：
   - 加一行：`tavern_voice_patch({request:{id:'预设 ID', expectedRevision:3, operation:{action:'reading-edit', op:'add', entry:{forms:['林澄'], reading:'lín chéng'}}}})`。中文读音写带调拼音，日语写假名。改一行用 `op:'set', index`，删一行用 `op:'remove', index`。
   - 新建一套：`reading-create {name, from?}`；新的一套要用 `reading-active {id}` 切换后才生效。改名、删除用 `reading-rename`、`reading-remove`。
3. 再读 `readings {id}`，看到新行（或新预设已是当前使用的一套）才报告「已保存」。

`reading-edit` 有版本检查；新建、改名、删除、切换没有，写之前重新读取，避免覆盖用户刚做的修改。

## 完成标准

回读看到目标条目在当前使用的那套里；请用户在人物「声音」页用含这个词的台词试听。已生成的音频不重新合成，之后的台词才用新读音。
