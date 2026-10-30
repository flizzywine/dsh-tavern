# Asset Pack Service (V2)

`import { createAssetPackService } from 'dsh-asset-library/pack-service'` constructs
`apiVersion: 2`. The pure P0 contracts remain at `dsh-asset-library/asset-packs`.
The complete signatures are in `src/pack-v2/service.d.ts` (generated into `lib/`).

The package root registers this as the sole asset service, with native pack
settings and authenticated Connection transport. V1 is removed. There is no
fallback, migration, startup seed import, automatic card binding or compatibility
reader. Host/client activation and deployment are separate parent integration gates.

## Construction And Ownership

```js
const packs = createAssetPackService({
  assetRoot, // explicit absolute, profile-owned directory; not legacyDataRoot
  decodeMedia, // trusted validator; installed plugin supplies structural parsing (below)
  authorizeLease: async ({ packId, revision, kind, scope, request }) => {
    // Check the authenticated caller/session and its current pack access.
    // request is absent at issuance, the original Request on a media read.
    return authorized;
  },
});
```

One host process owns an assetRoot. Instances in that process share a publication
gate and sorted UUID pack locks. External processes must not write that root; this
is not a distributed filesystem lock. Callbacks must not recursively acquire this
service. The API is an in-process trusted-owner port, not an unauthenticated RPC
surface. The authenticated transport owns caller authorization for all CRUD/import APIs;
leases additionally require a configured authorizer and fail closed without one.
No callback receives arbitrary filesystem read/write access.

All author input uses the P0 schema. DTOs contain portable relative paths, never
absolute host paths. `PackSnapshot` separates `{manifest, figures, sprites}` from
its local `revision`. No local settings, permissions, cache or calibration enters
an export. `globalEnabledPackIds` belongs to the native `asset-library-packs` settings.

## Operations

- `listPacks()` 和 `getPackSnapshot({packId})` 返回完整元数据快照；缺失的单包返回 `null`。
  宿主快照（包括写入结果的 `snapshot`）递归冻结，与现有元数据所有者共享文档，不逐调用者深拷贝。
  并发 `getPackSnapshot` 共用一次发布读门及其结果；后续读取仍检查发布签名，不增加快照缓存。
  调用者需要编辑时只复制所改条目/字段，再经现有 CAS 写入接口提交；旧快照不随新发布变化。
  浏览器 JSON 传输后的对象与宿主对象隔离，冻结不跨 JSON 传输边界。
  读取只解析已在导入/发布时校验的元数据，不重算已存摘要，不扫描媒体/模型目录；
  元数据仍使用原有发布签名与容量上限管理。媒体租约继续使用现有鉴权与文件读取边界。
- `createPack({name, description?, expectedRevision:null})` creates a UUID v4 empty
  pack. `patchPack({packId, expectedRevision, patch?, fileUpdates?})` replaces
  supplied author fields, with exact `Map<relativePath, Uint8Array|null>` updates.
  Null deletes a file. Identity, schema, contentHash and files cannot be patched;
  file inventory and hashes are recomputed. This also supports asset/sprite CRUD
  atomically with the files they reference. Unknown fields remain errors.
- `removePack({packId, expectedRevision})` removes the visible pack. A local
  tombstone retains retired keys; reinstalling an intact removed pack restores
  existing refs. No data is read from cards and no binding is changed.
- `putBlob({...write, bytes, descriptor:{ext,mime,size}})` returns the actual hash;
  same bytes/descriptor are a no-op, MIME lies fail. `removeBlob({...write,hash})`
  fails if any author document still refers to it. Deduplication is per pack.
- `putBundle({...write,bundleKey,descriptor:{kind,entry},files})` replaces the exact
  relative bundle tree. `removeBundle({...write,bundleKey})` fails on surviving
  references. Live2D dependencies remain relative to the model3 file's directory,
  including nested entries; no model resource URL or remote dependency is saved.
- `createFigure({...write,figure})` allocates a UUID v4; `patchFigure({...write,
  figureId,patch})` cannot change it; `removeFigure({...write,figureId})` retires it.
  Voice-only figures work. Outfit, asset, sprite and bundle keys are retired when
  removed; an update cannot assign them to new content later.
- `resolveAssets({refs})` / `resolveFigures({refs})` resolve only the supplied full
  refs, with revision/contentHash and missing/disabled diagnostics. They do not
  bind cards, choose recall candidates, authorize widgets, or fall back by name.
- `subscribe(listener)` returns unsubscribe. Committed changes include packId,
  revision (null on removal), kinds, figure UUIDs, and widget risk data. Observer
  exceptions cannot undo a committed write. `dispose()` revokes leases/previews
  and unregisters this instance's observers.

Writes return `{status, snapshot, widgetRisks}`. Expected revision is mandatory;
CAS conflicts include the latest `revision` and a `diff`. No-op writes keep the
revision and emit no change event. The service serializes publication and reads,
so export cannot combine one manifest with another generation's bytes.

## Standalone ZIP Exchange

1. `inspectImport({bytes})` validates and retains an immutable, bounded preview.
   The result includes `inspectionId`, uploadHash, incoming documents, current
   snapshot, frozen expectedRevision, diff (including removals), UUID conflicts,
   choices, fixed keep-both mapping, expiry and per-decision widget risks. The
   documents let a UI show exact recall/figure changes rather than only counts.
   Affected cards is explicitly `{status:'unknown'}`; Tavern owns that index.
2. `applyImport({inspectionId,expectedRevision,decision})` requires one of the
   preview choices: install/update/keep-both/noop/cancel. Update is never selected
   by default. Apply revalidates bytes, global identities and frozen local CAS.
   Editing after inspection invalidates even a keep-both operation. Keep-both
   assigns a new pack UUID and every figure UUID, preserving short keys and
   remapping typed complete refs in author JSON; existing packs/cards/history
   remain untouched. It returns the mapping for P5's future import-set rewriting.
3. `exportPack({...write})` returns `{bytes,filename,contentHash,revision}`. It
   includes disabled and unused author files and no local files. Transport should
   send those bytes as an authenticated attachment, not a control JSON payload.
4. Library export: `exportPacks({packs:[write,...]})` (two or more)
   returns one pack-set ZIP — `dsh-tavern-pack-set.json` (packs + path/size
   closure) and `packs/<packId>/manifest.json` plus each pack's files. Given such a
   ZIP (bytes or a link download), `inspectImport` returns
   `{kind:'pack-set',inspectionId,uploadHash,expiresAt,packs:[preview,...]}`: one
   ordinary preview per pack, applied one by one with `applyImport`; the transfer
   is hashed once (shared uploadHash); discarding the set id drops packs still
   pending; the set counts as one preview. Capability `pack-set`.

Same UUID/contentHash re-import still validates every transferred file and CRC,
but preserves revision and returns no repeated widget risk. Cross-pack figure
UUID collision disallows direct install/update and offers keep-both. The preview
is process-local and expires; restart requires inspection again.

All packs use this same import flow. There is no seed API, provenance schema,
reserved source UUID, immutable overlay or implicit startup installation.

Widget risks are **data only**, binding the complete ref and executable digest to
bundle bytes, entry, props/options contract, caps and execution protocol version.
Metadata-only changes do not re-prompt; dependency/contract/code changes and new
keep-both identities do. No trust is persisted/exported and no preview executes.
Engine's later authorization owner decides whether to grant a matching digest.

## Safety And Publication

P0 strict JSON/schema/file/bundle hashes are applied to actual bytes. Existing ZIP
reader/writer provide classic ZIP only, CRC, duplicate, traversal, ADS/device,
encryption, ZIP64, ratio/count/byte checks. V2 additionally rejects DOS reparse
attributes, Unix special files and case-colliding directory prefixes. Filesystem
checks include root ancestors and every child; there are no links or remote reads.

Default limits are 20,000 entries, 512 MiB entry and pack total, 1 GiB combined
archive/retained-preview spool, ratio 200, 16 previews and 15-minute preview TTL.
All are explicit constructor `limits`; excess is rejected, never truncated.
Existing per-use caps remain: background 4 MiB, avatar 3 MiB, image/sprite 6 MiB,
audio 60 MiB. Image dimensions are bounded before invoking a decoder.

The built-in validator verifies/decompresses noninterlaced PNG (CRC, scanlines,
filter bytes, dimensions) and PCM/float WAV structure/duration. The package plugin
supplies `decodeMedia(bytes,descriptor)` using signature plus bounded structural
header parsing for WebP/JPEG, interlaced PNG and MP3/Ogg/FLAC/M4A. This supersedes
the earlier full-decoder activation requirement by explicit owner decision: **it
is structural validation, not full decoding**. WebP retains the static chunk and
dimension guard; JPEG requires frame/scan/end structure; interlaced PNG checks
chunks/CRC. Audio checks frame/page/box/metadata lengths and sample-rate/duration
headers. Returned dimensions must match and audio duration must be positive and
finite. No new codec dependency or executable is used. See README for supported
encodings and limits. Live2D JSON/relative closure remains unchanged; neither
moc3 playability, Cubism Core nor GPU/audio playback is certified by these tests.

Publication stages a complete new tree and local state, syncs file contents,
writes a journal, backs up the old tree, promotes pack and local metadata, then
writes a commit marker. Entering the shared gate first recovers pending journals:
uncommitted publication rolls back, committed publication finishes cleanup.
Cleanup preserves its commit marker until the journal and backups are removed.
Rollback failure closes reads/writes with `RECOVERY_REQUIRED`. Staging/backup
folders are not selectable versions. OS power-loss durability still depends on
filesystem rename/directory persistence guarantees; tests inject process-level
publication failures and recovery, not power failures.

P5 adds the **multi-pack + Card Preparation** journal, without looping single-pack
`applyImport`. Construct with `cardTransactions` (see `service.d.ts`); Tavern's
`lib/card-bundle.js` supplies the adapter using Card Preparation import,
authorized existing/reserved resource identities, its existing card queue and
durable workspace writer. No arbitrary card filesystem port or routes are added.

`exportCardBundle({path,expectedRevision,packIds})` returns ZIP bytes. `packIds`
is an explicit subset of the packs the card uses: its bound packs and the globally
enabled ones (`globalEnabledPackIds` service option; no duplicates, unknown input fields
fail). A global pack that is not bound is appended to the exported card's bound packs
through the card adapter's `bindRaw`; the source card is unchanged. `[]` exports
only the card. Each selected pack includes its complete snapshot, disabled entries
and all files; missing selected packs fail. Unselected missing refs are preserved. The outer
manifest declares exact file hashes/sizes and bound dependency content hashes.
Neither native pack enable settings nor Engine permissions/credentials are input
to this export. Global-only packs are never implicitly embedded.

`inspectCardBundle({path,bytes})` freezes the upload and destination card revision,
returns each pack's current/incoming documents, diff, CAS token, choices, fixed
keep-both mapping and risk data. The destination must be an authorized existing
card or an explicitly reserved new card identity; path allocation is the Tavern
owner's responsibility, not an archive-controlled path.
`previewCardBundleDecisions({inspectionId,decisions})` computes the exact combined
remapping and widget digests for UI confirmation, including cross-pack author
JSON references. `applyCardBundle` requires every decision and acknowledgement
of every changed/new widget. `install-only` never creates an execution grant;
`request-authorization` is also only an acknowledgement, not a persisted grant.
Actual grants are separate Engine operations. `{inspectionId,cancel:true}` frees
a preview without publishing. Expiry/disposal also frees frozen bytes. Pack and
card previews share count/spool budgets. `inspectImport({bytes,copy:true})` gives
an explicit copy-only (`keep-both/cancel`) preview, including identical content.

Apply acquires publication gate, sorted source/destination UUID locks, then the
existing card lock. It revalidates bytes, all revisions, identities/retired keys,
stages all new pack/local trees and a version-2 journal, publishes the complete
pack set, and commits the prepared card workspace last. Readers cannot pass the
pack gate mid-publication. A journal records only the authorized card identity
and before/after workspace hashes, not card raw or credentials. A failed card
write rolls back only this transaction's staged versions while still holding the
gate; an acknowledgement lost after a durable card write rolls forward. Recovery
rechecks the card under its existing lock: exact before => rollback, exact after
=> committed cleanup, anything else => `RECOVERY_REQUIRED`. No ambiguous recovery
overwrites later card edits. All pack reads/writes stay closed until resolved;
constructing without the required recovery adapter also fails closed. There is
no claim of cross-process coordination or filesystem power-loss durability.
The workspace writer must commit one complete workspace atomically and durably;
it must not acquire a pack lock/gate or perform unrelated fallible writes.

`inspectWidgetPermissions()` returns current complete refs/digests, never local
authorization. `dsh-asset-library/pack-settings` separately exports explicit native
SettingsProvider installation for `globalEnabledPackIds`, with CAS, bounded UUIDs
and observer cleanup. It is not composed/installed automatically by the v2 service.

## packs-v3：独立包与复制

卡片没有拥有包的概念。内嵌包通过上文多包事务独立安装/同 UUID 更新，导入的卡保留其普通绑定；没有 owner 注册表或删除卡时的包清理。`ensureCardOwnedPack`、`setCardOwnedPack`、`copyFigureToCard`、`setCardFigureAvatarCrop` 已删除，不提供兼容别名。Tavern 自己保存卡绑定并提供 `getPackBindingCounts({}) -> {counts}`；素材服务不读取卡归属。

`copyItems({sourcePackId,itemRefs:[{kind,id}],target:{packId,expectedRevision}|{newPackName}})` 返回 `{packId,revision,copied:[{kind,fromId,toId}]}`。支持全部 asset kinds 与 `figures`；请求条目加同包依赖闭包去重，源包不写入，跨包引用不改。现存/退休 ID 冲突生成新 ID，形象总是新 UUID。条目、媒体、bundle 与署名通过原有验证后一次发布；新目标也在这一提交内创建。组件不继承授权，风险由变更事件和 `inspectWidgetPermissions()` 提供，执行仍要求现有 Engine 授权。

`setFigureAvatarCrop({packId,expectedRevision,figureId,outfitKey,scope,stateId?,crop})` 返回 `PackMutation`，允许编辑形象所在的任意包。`scope` 为 `outfit` 或 `state`；`crop:null` 清除该层手动裁切。新上传同样必须显式传 `packId`，不自动创建卡包。


## Leases And Future Transport

`leaseMedia({packId,hash,origin,scope})` and
`leaseBundle({packId,bundleKey,origin,scope})` issue finite opaque tickets (default
15 minutes; max 2,048 leased resources). The latter only accepts Live2D, never
widget code, and returns entry/relative-resource URLs under the same ticket.

`respondLease({ticket,resource,request})` returns a WHATWG Response after checking
exact resource URL, origin/fetch metadata, current authorization, expiry,
revocation, pack revision and file hashes. It supports GET/HEAD, Range and ETag.
Read access never extends TTL. `releaseLease(ticket)` and `dispose()` revoke.
Responses use nosniff and same-origin resource policy. HTML/JS cannot enter this
endpoint; P5/P6 must provide a separate isolated widget endpoint.

`pack-v2/transport.js` mounts through the authenticated Connection owner and
registers exact issued resources with **`requestBody:'buffered'` for GET/HEAD**.
It validates retained Host/Origin before reconstructing the public URL for
`respondLease`; `dsh.internal` is not accepted as same-origin evidence. Routes
are revoked on expiry/release/change/detach. Control is a fixed allowlist with
1 MiB bounded strict JSON; binary bodies use bounded upload/download tickets.
`/v2/changes` provides the bounded invalidation feed. Package disposal revokes
captured handlers, tickets and leases. This transport is the sole package surface.
