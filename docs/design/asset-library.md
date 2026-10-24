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

目前的条目种类就是内置舞台已经在读的这几种：

| 种类 | 内容字段 |
| --- | --- |
| `backgrounds` | `media`（图片 hash）、`tags` |
| `music` | `media`（音频 hash）、`usage`、`tags`、`volume`、`loopStart`/`loopEnd`（秒） |
| `sfx` | `media`（音频 hash）、`tags`、`volume`；导演按页播放的音效（cast-presentation.md「音效」） |
| `ambience` | `media`（音频 hash）、`tags`、`volume`；导演设定、持续循环的环境音（cast-presentation.md「环境音」） |
| `props` | `media`（图片 hash）、`tags`；导演按页展示的物品（cast-presentation.md「物品」） |
| `entrances` | `entrance`（一份 `dsh.entrance/1` 文档，没有文件）；打开舞台时的入场演出，只有蓝灯和关闭（cast-presentation.md「入场演出」） |

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
- **导演目录**：背景和音乐都含蓝灯和绿灯条目（带各自的召回设置，绿灯条目带导演说明）；都只有名称和引用，不含租约；`castStage` 在回复时才签发租约。租约按媒体复用，有效期 24 小时，最后四分之一寿命内才换新，所以正在播放的页面拿到的是同一个 URL。
- **一次性搬迁**：此前存在 `cast-assets` 里的图片背景和音乐保留文件，在宿主启动后后台搬进本卡素材包；读取这张卡的舞台、导出时也会先完成它。搬完的文件从卡里删掉（仍被人物引用的不删）；放不下的留作保留文件。搬过的卡带 `boundPackIds`，不会再搬。同一张卡的导入和搬迁串行。
- **绿灯**：绿灯背景和音乐在这一轮已有正文出现条目名、关键词或其同义词时才提供给导演（`lib/domain/asset-pack-lexical.js`）；配置了判断模型时，没被提到的绿灯再由判断模型补位（`lib/domain/stage-judge-recall.js`，见 cast-presentation.md「舞台 core（13/N）：判断模型与绿灯召回」）。导入和搬迁写进来的条目都是蓝灯；灯态、触发词由下面的编辑界面改。

卡随带的不透明素材包（`lib/domain/asset-packs.js`，插件的 `saveCardPack`/`readCardPackFile`）是另一件事：酒馆不解释它的内容，继续并存。

## 编辑界面（舞台 core 11/N）

玩家在两处管理素材包，界面在 `src/client/features/stage-assets.js`，宿主接口在 `lib/rpc/asset-library.js`。页面不保存任何素材状态，每次修改都是素材库的一次 CAS 发布。

- **「舞台素材」面板顶部是素材库**：列出所有素材包，工具栏有搜索、按种类筛选（全部 / 背景 / 音乐）、排序（名称 / 数量 / 时间，记在本机）和「＋ 新建素材包」。每行是包名和状态标签。在游玩对话里时，状态是这张卡的「全局 / 本卡 / 关闭」；不在对话里时只有「全局 / 关闭」。列表按全局、本卡、关闭分三段，每段内按所选方式排序；分段在载入时固定，改状态时行不会跳动。下面仍是这张卡的角色素材。
- **状态立即生效，不需要确认**：「本卡」把包加进这张卡的 `boundPackIds`；「全局」把包加进酒馆设置的 `globalEnabledPackIds`，所有卡都能用；「关闭」把包从两处都去掉。一个包对一张卡只有一种状态。导演目录先列卡绑定的包（按绑定顺序），再列全局包（按 id 顺序），同一个包只列一次。导出卡时只写本卡绑定的包，不写全局包。
- **素材包窗口**：点一行打开这个包的窗口。左边是条目列表，有种类标签（包里有两种时才出现）、搜索、按灯态筛选和「添加文件」；右边是选中的条目。宽度 720px 及以下时变成单栏，选中条目后整页显示条目，「‹」返回列表。空包只显示「还没有内容」和「添加文件」。
- **条目页**：可以直接改名字；背景有大图预览，可以点开查看；音乐有试听播放器，带进度和「音量」滑块（拖动时就能听到效果，松手才保存，←→ 每次调 5%）。下面每行是一个字段：「触发策略」（蓝灯 / 绿灯 / 关闭）、「触发词」、「导演说明」（最多 300 字，和名称一起发给导演）、「备注」（导演看不到）。音乐带 `usage` 时多一行「用途」。空的可选字段先不显示，排在最后作「＋ 名称」按钮，点了才展开。条目列表上的灯也可以直接改，改灯不会切换选中的条目。
- **上传**：「添加文件」先选种类，再选多个文件，一个文件一个条目，以文件名命名，默认蓝灯，没有触发词；同样的字节就是同一个条目。放不下的文件逐个报告，不影响其他文件。「⋯ › 替换媒体…」只换图片或音频，名字、灯态、触发词和说明都保留。文件经宿主已有的 `card-upload` 原始上传路由写到磁盘，读一次就删掉。
- **删除**：条目和素材包都要先确认。删掉条目时，没有其他条目再用的音频一起删掉（图片由存储层处理）。删掉素材包时，同时把它从每张绑定它的卡和全局列表里去掉，不会留下指向已删除包的卡。卡上绑定的包已经不存在时，那一行显示「未安装」和「移除」。
- **「舞台设置 › 素材包」**：列出这张卡在用的包（先全局，再本卡），每行同样带状态标签，点开是同一个窗口。「管理」在原地展开成全部素材包，可以给这张卡开启其他包；「完成」收起。
- **「BGM ›」**：「舞台设置 › 基础设置」的 BGM 行有一个「›」，只在这张卡在用的包里有音乐时出现。只有一个包时直接打开它的音乐，有多个包时先列出包名；窗口左上角的「‹」回到舞台设置。
- **改完立即生效**：每次写入都会唤醒用到这个包的对局，让它重读舞台。只影响本卡的修改唤醒这张卡的对局，全局包的修改唤醒所有卡的对局。
- **错误**：已知的错误码会换成一句玩家看得懂的话，例如修订冲突是「内容已被修改，请重新载入」，原始信息写到控制台。连续几次修改在页面上按顺序排队，每次都基于最新的 revision；遇到冲突时重读一次再写。

| RPC | 作用 |
| --- | --- |
| `listAssetPacks` / `getAssetPack` / `createAssetPack` / `removeAssetPack` | 包的列表、快照、新建、删除（删除时同时解除所有绑定） |
| `updateAssetPackEntries({packId, expectedRevision, assets})` | 改条目的作者字段（名称、灯态、触发词、说明、备注、音量），触发词先检查 |
| `addAssetPackFiles({packId, kind, files})` / `replaceAssetPackMedia` / `removeAssetPackEntry` | 上传条目、替换媒体、删除条目 |
| `getCardAssetPacks({path})` / `setAssetPackState({path, packId, state})` | 一张卡看到的本卡包和全局包，以及修改状态（`global` / `card` / `off`） |
| `previewAssetPackMedia({packId, hash})` | 编辑器预览用的媒体租约，和舞台复用同一张租约 |

### 触发词

玩家写触发词时检查一次（`lib/asset-library/asset-packs/trigger-lint.js`），检查只放在编辑入口 `updateAssetPackEntries`。存储层本身不检查：导入和搬迁写入的条目没有触发词，已经存下来的包也不重新判定。

- **只检查改过的**：新条目，或触发词、同义词有变化的条目才检查。只改名字或灯态不算改了触发词，所以已经装好的包不会因为无关的修改突然报错。关闭的条目不检查。
- **规则**：可以不填，这时按名称召回；填的话要 3–6 个，不重复（同义词是同一个词的其他叫法，不另占名额）；每个词至少 2 个字；一般的汉字词不超过 4 个字（曲名、假名或带「·」的名字、以「房间」「学校」等结尾的地名可以更长）；不在动作或情境后面拼「声」「氛围」「场景」；音乐不用乐队或组合名召回；同一种类有 5 条以上共用「音乐」「背景」这类类别词时拒绝。
- **拒绝时**：以 `TRIGGER_LINT` 失败，这次修改不发布，revision 不变。报错是一句话，包括条目、词、违反的规则和一个正例；编辑器把第一条显示在触发词旁边，被拒绝的词留在屏幕上，改掉或删掉之前一直显示。
- **客户端只查格式**：最多 16 个词，每个 2–40 字；其余都交给宿主判断。

## 不在本步

- 人物/立绘/模型（仍在 `cast-assets`）、素材包 ZIP 导入导出与素材目录、卡片随附素材包的多包事务、跨 profile 的共享媒体与回收（GC）。
- 编辑同义词、标签和循环点（编辑时会原样保留）。
