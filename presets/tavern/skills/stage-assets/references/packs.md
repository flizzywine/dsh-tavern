# 包与绑定

用户要让某张卡或所有卡用上一个包、给单张卡复制一份包、新建或删除包时读这篇。

## 界面位置

- 包的范围：舞台设置 ›「素材包」›「管理」，每个包的标签选「全局 / 本卡 / 关闭」，「完成」收起。
- 包的内容：右侧栏「＋」→「舞台素材」，或点舞台设置里的包名；包里「添加文件」加人物、背景、CG、音乐等；包的「⋯」有「复制」「导出」。
- 影响范围：包里的内容影响所有用到这个包的卡；改全局影响所有卡；在本卡与关闭之间切换只影响这张卡。

## 只给这张卡绑定一个包

1. `tavern_assets_read({request:{action:'bindings'}})`：记下卡的 `revision` 和现有 `boundPackIds`。
2. `tavern_assets_patch({request:{expectedRevision:'第 1 步的卡 revision', operation:{action:'bind', boundPackIds:['原有包ID', '新包ID']}}})`。列表整体替换，原有的包要一起带上。只改本卡，不需要全局确认。
3. 再读 `bindings`：新包在 `boundPackIds` 里才报告「已绑定到这张卡」。

## 把包设为全局启用（全局写入）

1. `tavern_assets_read({request:{action:'settings'}})`：记下设置的 `revision` 和 `values.globalEnabledPackIds`。
2. 告诉用户「这是全局设置，会影响所有卡片：把「通用音效」设为全局启用，所有卡的导演都能选用其中的音效」，再调用 `tavern_assets_patch({request:{expectedRevision:'第 1 步的设置 revision', operation:{action:'global-packs', globalEnabledPackIds:['原有包ID', '该包ID']}}})`。宿主在这次调用中请用户确认。
3. 再读 `settings`，包在 `globalEnabledPackIds` 里才报告「已全局启用」。审批没通过就报告没有改动，不换方式重试。

用户只想让这张卡用时绑定到本卡，想让所有卡都用才改全局。

## 只改这张卡的素材

「另存副本」的人物卡和原卡共用同一批包，别的卡也在用的包改了会一起变。用户只想改这张卡时：

1. `tavern_assets_read({request:{action:'dependencies', packId}})` 看还有哪些卡在用。
2. 复制：`copy {sourcePackId, itemRefs:[{kind:'figures', id:'…'}, …], target:{newPackName:'…'}}` 把选中的人物和条目复制进一个新包（`target` 也可以是已有包 `{packId, expectedRevision}`）；回执给出 `packId` 和新旧 ID 对照 `copied`。整个包可以在界面用包的「⋯」→「复制」。复制出的人物是新 ID，开场等引用要改指副本。
3. 当前卡绑定副本、不再绑定原包，再改副本。原包是全局启用的，关掉它会影响所有卡，先说明。

复制和改绑是两步，分别报告结果。设置向导创建的「本卡素材包」本来就是副本，可以直接改。

## 新建与删除

- 新建包：`tavern_assets_patch({request:{action:'create-pack', name:'…', description:'…', expectedRevision:null}})`，回执给出 `packId` 和第一个 revision；新包要绑定或全局启用才对卡生效。
- 删除条目用 `remove-item {packId, expectedRevision, kind, id}`，删人物用 `remove-figure`；删整个包只能由用户在界面里操作。删除前用 `dependencies` 说明会影响哪些卡，宿主也会确认。删除包不改写卡的绑定和历史记录，缺失的引用保留并显示诊断。

## 完成标准

回读（`bindings`、`settings` 或 `pack`）显示目标值；报告改了哪个包、影响哪些卡。
