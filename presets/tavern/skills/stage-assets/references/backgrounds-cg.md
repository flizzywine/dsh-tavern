# 背景与 CG

用户要加背景、给背景配白天/黄昏/夜晚版本、加剧情 CG 或物品图时读这篇。生成新背景读[应用内生图](generation.md)。

## 界面

包里「添加文件」→「背景」「CG」「物品」，选 PNG/WebP/JPEG。每个文件建一条，名字取自文件名（建议用正文里会出现的叫法）；一次选多张 CG 会建成一条带多张差分的 CG。新加的条目是关灯的绿灯、没有触发词，填好 3–6 个触发词再开灯（[灯态与触发词](lamps-recall.md)）。

## 用工具加一张背景

图片的上传和绑定一步完成，条目写在上传目标里：

1. `tavern_assets_read({request:{kind:'backgrounds', operation:{action:'schema'}}})` 看字段；`item {kind:'backgrounds', packId}` 确认没有同名条目，记下包的 `revision`。
2. 上传并建条目：

   ```js
   tavern_media_upload({request:{action:'image', packId:'…', expectedRevision:'第 1 步的 revision', file:'images/rooftop.png',
     target:{kind:'asset', slot:'media', asset:{kind:'backgrounds', id:'rooftop', name:'学校天台', enabled:true,
       recall:{mode:'keyword', keywords:['天台', '屋顶', '楼顶']}, directorNote:'学校屋顶，午休和放学后的谈话场景。'}}}})
   ```

   换已有条目的图时，`asset` 写读到的完整条目。白天/黄昏/夜晚版本放在条目的 `variants`（id 为 `day`、`dusk`、`night`），用 `slot:'variant', variant:'night'` 上传那一张。
3. 回执 `attached:true` 后再 `item` 带 `id` 读一次，确认条目和灯态。

## 字段要点

- 背景：`media`，可选时段 `variants`、`tags`。触发词写地名和常见活动，不写纯时间词，时段交给 `variants`。
- CG：`media`、`description`（≤80 字），可选 `focusHints`（镜头焦点，最多 8 个，坐标为 0–1 比例，缩放 1–3）和多张差分（最多 16 张）。
- 物品：`media`、`inventoryId`（界面「库存标识」），存储的种类是 `props`。读取工具目前只接受 `items`，读不到物品；物品请用户在素材库界面里加和改。
- `directorNote` 一两句：是什么、什么时候用，最多 300 字。
- 大小：背景约 4 MiB，其他图片约 6 MiB，以 `schema` 的 `limits` 和报错为准。

## 完成标准

回读到条目、媒体已绑定、灯态和触发词是目标值；请用户在素材库预览图，或在下一轮游玩时看导演是否用上。
