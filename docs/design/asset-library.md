# 素材库存储

舞台用的素材（背景、音乐）放在**素材包**里。素材包由宿主里唯一的素材库服务存取：`tavern-plugin/lib/asset-library/pack-v2/service.js` 的 `createAssetPackService`。本文说明它怎样存、怎样改、怎样把媒体交给页面。

## 原则

- **一个所有者**：一个 profile 的素材根目录（`assetRoot`，显式传入的绝对路径）只由宿主进程里的这个服务读写。同一进程里的多个服务实例共用同一道发布闸和订阅者。
- **包是数据，不是代码**：素材包只有 JSON 和惰性媒体（PNG/WebP/JPEG、WAV/MP3/Ogg/FLAC/M4A），写入时校验一次，读取时不再重复校验。
- **每次修改都是比较并交换（CAS）**：调用方带上自己读到的 `revision`；别人先改了，这次写入以 `REVISION_CONFLICT` 失败，附上最新 revision 和差异。没有带 revision 的写入同样失败。
- **一次修改 = 一次日志化发布**：要么整份生效，要么回到修改前的字节；中途崩溃由下一次进入时恢复。

## 包的格式

磁盘布局（`assetRoot` 下）：

```text
packs/<packId>/manifest.json   作者数据（可携带）
packs/<packId>/media/<sha256>.<ext>
packs/<packId>/credits/...     署名文本（可选）
local/<packId>.json            本机状态：revision、退役标识、安装/更新时间
blobs/<前两位>/<sha256>        同一份字节只存一次；包内文件是指向它的硬链接（跨卷时复制）
staging/、staging-pending/     发布中的事务目录，不是可选的版本
```

`manifest.json` 是 `dsh-asset-pack` 格式：`id`（UUID）、`name`、`assets`（条目）、`blobs`（hash → 扩展名/MIME/大小）、`files`（路径/大小/sha256）和 `contentHash`。`figures`、`sprites`、`bundles` 是格式的一部分，目前必须为空——人物、立绘和模型随读取它们的 core 一起进入。本机状态（revision、授权、缓存）不进 manifest，导出时不会带走。

### 条目与灯态

目前的条目种类就是内置舞台已经在读的两种：

| 种类 | 内容字段 |
| --- | --- |
| `backgrounds` | `media`（图片 hash）、`tags` |
| `music` | `media`（音频 hash）、`usage`、`tags`、`volume`、`loopStart`/`loopEnd`（秒） |

每个条目都有 `id`、`name`、`directorNote` 和灯态：

- **蓝灯**：`enabled: true`、`recall.mode: 'constant'`，始终提供给导演；
- **绿灯**：`enabled: true`、`recall.mode: 'keyword'`，正文提到关键词时提供；
- **关闭**：`enabled: false`。

其他种类随各自的 core 加入。未知字段一律拒绝，不静默丢弃。

## 读写接口

| 方法 | 作用 |
| --- | --- |
| `listPacks()` / `getPackSnapshot({packId})` | 读整份快照 `{manifest, revision, installedAt, updatedAt}`；读取不会初始化任何数据。列表里坏掉的单个包是一行错误，不影响其他包 |
| `createPack({name, description?, expectedRevision: null})` | 新建空包（UUID v4） |
| `patchPack({packId, expectedRevision, patch?, fileUpdates?})` | 整字段替换作者数据，并按路径精确更新文件（`null` 删除）。身份、格式、hash 和文件清单不能直接改，由服务重新计算 |
| `removePack({packId, expectedRevision})` | 删除包；`local/` 里留墓碑，保留退役标识 |
| `putBlob` / `removeBlob` | 单独放入或移除音频；图片必须和引用它的条目在同一次 `patchPack` 里写入。仍被条目引用的媒体不能移除 |
| `resolveAssets({refs})` | 按完整引用 `{packId, kind, assetId}` 解析，带 revision 和 `asset-missing`/`asset-disabled` 诊断；不按名字猜，不自动绑定 |
| `subscribe(listener)` | 每次提交后通知 `{packId, revision, kinds}`（删除时 revision 为 null）；观察者出错不会撤销已提交的修改 |

所有写入返回 `{status: 'installed' | 'updated' | 'noop', snapshot}`。内容没变时是 `noop`，revision 不变，也不发通知。

- 只改名字、说明、灯态、关键词、标签、音量这类作者字段时走「元数据发布」：只换 manifest，不重新打开媒体。
- 换媒体、加删条目、改循环点时走完整校验：新的或变了的媒体做签名、尺寸、时长的结构校验（不是完整解码），背景单张不超过 4 MiB、图片不超过 6 MiB、音频不超过 60 MiB。
- 删除条目时，不再被任何条目引用的图片在同一次发布里一起移除；条目的 id 退役，不能再指向新内容。

## 发布与恢复

一次发布在 `staging/<事务>` 里准备好新文件，写日志，把旧文件挪进事务目录作备份，换上新文件和本机状态，最后写提交标记。

- 失败或进程崩溃时，下一次进入闸门先恢复：没提交的回滚到原字节，已提交的完成清理。
- 回滚失败则读写都以 `RECOVERY_REQUIRED` 关闭，不会读到半个包。
- 每个事务目录记录所属进程；别的活进程的事务不动，无主目录过 24 小时才回收。
- 这不是跨进程或断电保证：测试注入的是进程级失败和恢复。

**发布闸**：读和写都要进同一道先进先出的闸。连续的读一起进行；排队的写会挡住后来的读，等前面的读结束后独占执行。所以读不到替换中途的状态，导出、列表和媒体读取看到的都是同一代发布。

## 媒体租约

页面不直接拿文件路径。宿主为当前会话签一张租约：

- `leaseMedia({packId, hash, origin, scope})` → `{ticket, url, expiresAt, revision}`，默认 15 分钟，最多 2048 个资源；
- `respondLease({ticket, resource, request})` 返回标准 `Response`，支持 GET/HEAD、Range、ETag，带 `nosniff` 和同源资源策略；
- `releaseLease(ticket)` 和 `dispose()` 吊销租约。

签发和每次读取都要经过 `authorizeLease`（必须配置，缺省即拒绝），并核对同源、请求的资源、到期和吊销。

**有界分段读取**：304、HEAD、416 只读 manifest 里的大小，不读字节。响应体按需分块读取，每块最多 1 MiB，每块都单独通过发布闸、读完即关文件句柄。所以暂停的音频不会占住内存，也不会挡住 Windows 上发布时的目录改名。媒体被删除或换掉后，正在播放的流在下一块以 `REVISION_CONFLICT` 结束；只改名字或灯态的发布不会打断它。

`PACK_LEASE_PATH` 是租约 URL 的前缀；宿主的认证路由负责把这个路径上的请求连同原始 `Request` 交给 `respondLease`。

## 宿主接线

- **一个服务**：宿主在 profile 下构造唯一的素材库，`assetRoot` 是 `<DSH_HOME>/profile-data/tavern/asset-packs`（和酒馆数据目录 `tavern/data` 并列），插件卸载时 `dispose`。
- **租约路由**：`PACK_LEASE_PATH` 上的请求先过酒馆路由同样的来源检查（页面可能来自自定义协议，如 `dsh-app://`），再以固定的宿主内部 origin 交给 `respondLease`，由服务核对资源、到期和授权；只转发 Range/If-Range/If-None-Match。响应体按段写出、遵守背压，页面关闭即取消。授权只接受宿主自己的两个 scope：舞台页面 `dsh-tavern-stage` 和卡导出读取 `dsh-tavern-host`。
- **本卡素材包**：每张卡的舞台素材是「<卡名> · 本卡素材包」里的条目，卡的 `cast-assets` 清单用 `boundPackIds` 绑定它。包是普通的素材包，删卡不删包。
- **导入**：卡文件里的 `background` 和 `type: "music"` 素材逐个进本卡素材包，默认蓝灯；同一份字节就是同一个条目。素材包放不下的（GIF、超限、结构不对）留在卡的保留文件里，导出时原样写回。
- **导出**：本卡素材包的条目（不论灯态）写回 CCv3 的原位置，字节经宿主读取租约分段读出。
- **导演目录**：只含亮蓝灯条目的名称和引用，不含租约；`castStage` 在回复时才签发租约。租约按媒体复用，有效期 24 小时，最后四分之一寿命内才换新，所以正在播放的页面拿到的是同一个 URL。
- **一次性搬迁**：此前存在 `cast-assets` 里的图片背景和音乐保留文件，在宿主启动后后台搬进本卡素材包；读取这张卡的舞台、导出时也会先完成它。搬完的文件从卡里删掉（仍被人物引用的不删）；放不下的留作保留文件。搬过的卡带 `boundPackIds`，不会再搬。同一张卡的导入和搬迁串行。
- **绿灯**：条目可以存成绿灯，但导演目录暂不提供绿灯条目；按正文关键词召回随导演的召回一起进入。现在能写进素材包的只有导入和搬迁，它们都是蓝灯。

卡随带的不透明素材包（`lib/domain/asset-packs.js`，插件的 `saveCardPack`/`readCardPackFile`）是另一件事：酒馆不解释它的内容，继续并存。

## 不在本步

- 人物/立绘/模型（仍在 `cast-assets`）、素材包 ZIP 导入导出、卡片随附素材包的多包事务、跨 profile 的共享媒体与回收（GC）。
- 条目编辑与绑定界面、全局启用的素材包。
