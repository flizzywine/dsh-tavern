import { imageKind, pngSize } from './media.js'
import { randomUUID } from 'node:crypto'
import { assertPublicPackChain } from './public-export.js'
import { writeZip } from '../zip.js'
import { check, validateUuid, validateHash } from '../asset-packs/common.js'
import { validatePackIdentities } from '../asset-packs/index.js'
import { jsonBytes, readDocument, budget, sealPack, inspectPackScripts, packDiff } from './validation.js'

const ROOT = 'dsh-tavern-card-bundle.json'
const copy = value => structuredClone(value)
// Runs only within the storage publication gate; adapter callbacks take the card lock last.
export function createCardBundleMethods(host) {
  const {storage, run, load, metadata, all, verify, cas, keys, remapPack, remapValue, readZipFiles, readZipFile, exportArchive, archiveKey, limits, now, nextLocal, emit, cards, globalPackIds = () => []} = host
  const previews = new Map()
  function adapter() { check(cards && ['snapshot','inspectRaw','remapRaw','bindRaw','withPrepared','recover'].every(k => typeof cards[k] === 'function'), '$.card', 'Card Preparation adapter unavailable', 'ASSET_UNAVAILABLE'); return cards }
  function sweep() { for (const [id, value] of previews) if (value.preview.expiresAt <= now()) previews.delete(id) }
  const used = () => [...previews.values()].reduce((sum, value) => sum + value.size, 0)
  async function zip(files) {
    check(budget(files, limits) * 2 <= limits.spoolBytes, '$', 'Bundle export exceeds spool budget', 'LIMIT_EXCEEDED')
    return storage.temporary(async file => { await writeZip(file, [...files].map(([path,data]) => ({path,data,file:data.file}))); return exportArchive(file) })
  }
  function document(files, name, prefix='') {
    const member=prefix+name
    check(files.has(name), member, 'Missing archive member: '+member, 'INVALID_JSON')
    try {return readDocument(files.get(name))} catch(error) {
      error.path=member+':'+(error.path || '$')
      error.message=member+': '+error.message
      throw error
    }
  }
  async function read(bytes, archive) {
    const files = archive ? await readZipFile(archive.file, archive.size, used()) : await readZipFiles(bytes, used()), manifest = document(files, ROOT)
    for(const key of ['format','schemaVersion','files','dependencies'])check(manifest && Object.hasOwn(manifest,key),ROOT+':$.'+key,'Missing field '+key+' in '+ROOT,'INVALID_JSON')
    check(manifest.format === 'dsh-tavern-card-bundle' && manifest.schemaVersion === 1, ROOT+':$.format/schemaVersion', 'Unsupported card bundle')
    check(Object.keys(manifest).every(k => ['format','schemaVersion','files','dependencies','cover'].includes(k)), ROOT+':$', 'Unknown bundle field')
    for(const key of ['files','dependencies'])check(Array.isArray(manifest[key]),ROOT+':$.'+key,'Expected array '+key+' in '+ROOT,'INVALID_JSON')
    files.delete(ROOT)
    check(files.size === manifest.files.length, '$.files', 'Bundle file closure mismatch', 'FILE_CLOSURE_MISMATCH')
    const seen = new Set()
    // the outer list is a path/size closure. ZIP CRC already covers transport corruption and every
    // embedded pack is authenticated by importPack against its own manifest; a per-file sha256 here duplicated that
    // digest inside the same container. Bundles exported before this change still carry it and it is ignored.
    for (const item of manifest.files) {
      check(item && Object.keys(item).every(k => ['path','size','sha256'].includes(k)) && !seen.has(item.path), '$.files', 'Invalid file declaration')
      seen.add(item.path)
      const content = files.get(item.path)
      check(content && content.length === item.size, item.path, 'Bundle file/size mismatch', 'FILE_CLOSURE_MISMATCH')
    }
    let cover
    if (manifest.cover !== undefined) {
      check(manifest.cover?.path === 'card/cover.png' && manifest.cover?.mediaType === 'image/png' && Object.keys(manifest.cover).every(k => ['path','mediaType'].includes(k)), '$.cover', 'Bundle cover must be card/cover.png (image/png)')
      cover = files.get(manifest.cover.path)
      check(cover && cover.length <= 20 * 1024 ** 2, '$.cover', 'Cover missing or larger than 20 MiB; export a smaller PNG', 'LIMIT_EXCEEDED')
      check(imageKind(cover) === 'png', '$.cover', 'Cover must be a PNG image; replace the cover and export again')
      try { pngSize(cover, true) } catch (error) { throw Object.assign(new Error('Invalid bundle cover; replace it with a valid PNG: ' + error.message), {code:error.code || 'INVALID_INPUT'}) }
      files.delete(manifest.cover.path)
    }
    const card = adapter().inspectRaw(document(files,'card/card.json')), packs = [], ids = new Set()
    files.delete('card/card.json')
    for (const dep of manifest.dependencies) {
      check(dep && Object.keys(dep).every(k => ['packId','contentHash','embedded'].includes(k)) && typeof dep.embedded === 'boolean', '$.dependencies')
      validateUuid(dep.packId); if (dep.contentHash !== null) validateHash(dep.contentHash)
      check(!ids.has(dep.packId) && card.boundPackIds.includes(dep.packId), '$.dependencies', 'Unexpected/duplicate dependency')
      ids.add(dep.packId)
      if (!dep.embedded) continue
      const prefix = `packs/${dep.packId}/`, data = new Map()
      for (const [name, content] of files) if (name.startsWith(prefix)) { data.set(name.slice(prefix.length), content); files.delete(name) }
      const author = document(data,'manifest.json',prefix); data.delete('manifest.json')
      check(author.id === dep.packId && author.contentHash === dep.contentHash, '$.dependencies', 'Dependency identity/hash mismatch')
      packs.push(await host.importPack(author, data))
    }
    check(ids.size === card.boundPackIds.length && files.size === 0, '$', 'Undeclared bundle content', 'FILE_CLOSURE_MISMATCH')
    return {raw:card.raw, packs, manifest, cover}
  }
  // card import includes reused/installed dependencies, not just newly embedded packs.
  async function widgetRisks(raw,packs) {
    const bound=adapter().inspectRaw(raw).boundPackIds;
    const available=[...(await all()).filter(p=>!packs.some(n=>n.manifest.id===p.manifest.id)),...packs];
    return available.filter(p=>bound.includes(p.manifest.id)).flatMap(p=>p.manifest.assets.filter(a=>a.kind==='widgets').map(a=>({packId:p.manifest.id,packName:p.manifest.name,widgetId:a.id,widgetName:a.name})));
  }
  async function candidates(entry, decisions) {
    const mappings = entry.preview.packs.filter(p => decisions[p.packId] === 'keep-both').map(p => ({from:p.packId, ...p.mapping}))
    const packs = []
    for (const incoming of entry.data.packs) {
      const mapping = mappings.find(m => m.from === incoming.manifest.id)
      let pack = mapping ? await remapPack(incoming, mapping) : {manifest:copy(incoming.manifest), files:new Map(incoming.files)}
      for (const other of mappings.filter(m => m !== mapping)) {
        pack.manifest = remapValue(pack.manifest, other.from, other.packId, other.figures)
        for (const [name, bytes] of pack.files) if (name.endsWith('.json')) pack.files.set(name, jsonBytes(remapValue(readDocument(bytes), other.from, other.packId, other.figures)))
      }
      await sealPack(pack.manifest, pack.files, incoming)
      packs.push(await verify(pack.manifest, pack.files, incoming, true))
    }
    return {packs, mappings, raw:adapter().remapRaw(entry.data.raw, mappings)}
  }
  return {
    disposeCardBundles() { previews.clear() },
    cardBundleUsage() { sweep(); return {count:previews.size,bytes:used()} },
    exportCardBundle(input) {
      return run([], async () => {
        const card = await adapter().snapshot({path:input.path})
        check(card.revision === input.expectedRevision, '$.expectedRevision', 'Card changed', 'REVISION_CONFLICT')
        // the caller names the packs to embed; there is no implicit selection.
        check(Array.isArray(input.packIds) && new Set(input.packIds).size === input.packIds.length, '$.packIds', 'Explicit list of packs to embed required')
        check(Object.keys(input).every(key => ['path','expectedRevision','packIds'].includes(key)), '$', 'Unknown export field')
        // a card uses its bound packs and the globally enabled ones; either may be embedded.
        // A global pack that is not bound travels as a binding of the exported card, so the bundle stays closed (every
        // dependency is bound) and the card keeps using it wherever it is imported.
        const original = adapter().inspectRaw(card.raw), global = globalPackIds()
        const packIds=[...new Set([...input.packIds,...(original.modConfigPackId?[original.modConfigPackId]:[])])]
        for (const packId of packIds) check(original.boundPackIds.includes(validateUuid(packId)) || global.includes(packId), '$.packIds', 'Only packs this card uses can be embedded', 'UNBOUND_PACK')
        const added = packIds.filter(id => !original.boundPackIds.includes(id))
        const value = added.length ? adapter().inspectRaw(adapter().bindRaw(original.raw, added)) : original
        check(added.every(id => value.boundPackIds.includes(id)), '$.packIds', 'Card cannot carry these packs', 'UNBOUND_PACK')
        const files = new Map([['card/card.json', jsonBytes(value.raw)]]), dependencies = []
        for (const packId of value.boundPackIds) {
          const embedded = packIds.includes(packId), pack = embedded ? await load(packId) : await metadata(packId)
          check(!embedded || pack, '$.packIds', 'Pack to embed is missing', 'ASSET_UNAVAILABLE')
          dependencies.push({packId, contentHash:pack?.manifest.contentHash ?? null, embedded})
          if (embedded) {
            await assertPublicPackChain(pack, metadata)
            files.set(`packs/${packId}/manifest.json`, jsonBytes(pack.manifest))
            for (const [name, bytes] of pack.files) files.set(`packs/${packId}/${name}`, bytes)
          }
        }
        // Raw and every complete pack snapshot are taken under the same gate; recheck card CAS.
        check((await adapter().snapshot({path:input.path})).revision === card.revision, '$.revision', 'Card changed', 'REVISION_CONFLICT')
        const manifest = {format:'dsh-tavern-card-bundle', schemaVersion:1, dependencies, files:[]}
        if (card.cover) { files.set('card/cover.png', card.cover); manifest.cover = {path:'card/cover.png', mediaType:'image/png'} }
        for (const [path, bytes] of files) manifest.files.push({path, size:bytes.length})
        files.set(ROOT, jsonBytes(manifest))
        return {...await zip(files), filename:'card-bundle.zip', dependencies}
      })
    },
    inspectCardBundle(input) {
      const archive = input[archiveKey]
      check(archive || input.bytes instanceof Uint8Array && input.bytes.length <= limits.spoolBytes, '$.bytes', 'Archive exceeds spool budget', 'LIMIT_EXCEEDED')
      const bytes = archive ? null : Buffer.from(input.bytes)
      return run([], async () => {
        sweep(); check(previews.size + host.packPreviewUsage().count < limits.previews, '$', 'Preview limit exceeded', 'LIMIT_EXCEEDED')
        const data = await read(bytes, archive), target = await adapter().snapshot({path:input.path}), installed = await all(), packs = []
        for (const pack of data.packs) {
          const before = installed.find(p => p.manifest.id === pack.manifest.id)
          const conflicts = [...installed, ...data.packs].filter(p => p.manifest.id !== pack.manifest.id && (pack.manifest.figures.some(id => p.manifest.figures.includes(id) || p.manifest.id === id) || p.manifest.figures.includes(pack.manifest.id)))
          const same = before?.manifest.contentHash === pack.manifest.contentHash
          const mapping = {packId:randomUUID(), figures:Object.fromEntries(pack.manifest.figures.map(id => [id, randomUUID()]))}
          packs.push({packId:pack.manifest.id, expectedRevision:before?.local.revision ?? (await storage.local(pack.manifest.id))?.revision ?? null,
            choices:conflicts.length ? ['keep-both','cancel'] : same ? ['noop','cancel'] : before ? ['update','keep-both','cancel'] : ['install','keep-both','cancel'],
            incoming:{manifest:pack.manifest, figures:pack.figures, sprites:pack.sprites}, current:before ? {manifest:before.manifest, figures:before.figures} : null,
            diff:packDiff(before?.manifest, pack.manifest), affectedCards:{available:false,count:null}, mapping,
            scriptRisk:inspectPackScripts(pack)})
        }
        const preview = {inspectionId:randomUUID(), path:input.path, expectedRevision:target.revision, expiresAt:now() + limits.previewTtlMs, packs, dependencies:data.manifest.dependencies, raw:data.raw, currentRaw:target.raw}
        const size = (bytes?.length || 0) + (data.cover?.length || 0) + data.packs.reduce((sum,p) => sum + budget(p.files,limits) + jsonBytes(p.manifest).length, jsonBytes(data.raw).length + jsonBytes(target.raw).length)
        check(used() + host.packPreviewUsage().bytes + size <= limits.spoolBytes, '$', 'Preview spool budget exceeded', 'LIMIT_EXCEEDED')
        previews.set(preview.inspectionId, {preview, data, bytes, size})
        return copy(preview)
      })
    },
    previewCardBundleDecisions(input) {
      return run([], async () => {
        sweep(); const entry = previews.get(input.inspectionId)
        check(entry, '$.inspectionId', 'Preview expired', 'ASSET_UNAVAILABLE')
        check(input.decisions && Object.keys(input.decisions).length === entry.preview.packs.length, '$.decisions')
        for (const p of entry.preview.packs) {
          check(p.choices.includes(input.decisions[p.packId]) && input.decisions[p.packId] !== 'cancel', '$.decisions')
          cas(await metadata(p.packId) || {local:await storage.local(p.packId)}, p.expectedRevision, p.incoming.manifest)
        }
        check((await adapter().snapshot({path:entry.preview.path})).revision === entry.preview.expectedRevision, '$.revision', 'Card changed', 'REVISION_CONFLICT')
        const result = await candidates(entry, input.decisions), risks = []
        for (const pack of entry.preview.packs) if(input.decisions[pack.packId] !== 'noop') risks.push(...pack.scriptRisk)
        return {mappings:copy(result.mappings), scriptRisk:risks, cardWidgetRisks:await widgetRisks(result.raw,result.packs), raw:result.raw}
      })
    },
    applyCardBundle(input) {
      const lockIds = previews.get(input.inspectionId)?.preview.packs.flatMap(p => [p.packId,p.mapping.packId]) || []
      return run(lockIds, async () => {
        sweep(); const entry = previews.get(input.inspectionId)
        check(entry, '$.inspectionId', 'Preview expired', 'ASSET_UNAVAILABLE')
        if (input.cancel === true) { previews.delete(input.inspectionId); return {status:'cancelled'} }
        check(input.expectedRevision === entry.preview.expectedRevision, '$.expectedRevision', 'Card preview changed', 'REVISION_CONFLICT')
        check(input.decisions && Object.keys(input.decisions).length === entry.preview.packs.length, '$.decisions', 'Explicit decision for every pack required')
        for (const p of entry.preview.packs) {
          check(p.choices.includes(input.decisions[p.packId]) && input.decisions[p.packId] !== 'cancel', '$.decisions', 'Explicit install/update/keep-both decision required')
          cas(await metadata(p.packId) || {local:await storage.local(p.packId)}, p.expectedRevision, p.incoming.manifest)
        }
        const {packs, mappings, raw} = await candidates(entry, input.decisions), installed = await all()
        const cardWidgetRisks=await widgetRisks(raw,packs)
        check(!cardWidgetRisks.length || typeof input.disableWidgets === 'boolean','$.disableWidgets','Confirm third-party widgets for this card','WIDGET_CONFIRMATION_REQUIRED')
        for (const mapping of mappings) check(!await storage.local(mapping.packId) && !installed.some(p => p.manifest.id === mapping.packId), '$.mapping', 'Keep-both destination changed', 'REVISION_CONFLICT')
        const incomingIds = new Set(packs.map(p => p.manifest.id))
        const available = [...installed.filter(p => !incomingIds.has(p.manifest.id)), ...packs]
        validatePackIdentities(available.map(p => p.manifest))
        const changes = [], risks = entry.preview.packs.filter(pack=>input.decisions[pack.packId] !== 'noop').flatMap(pack=>pack.scriptRisk)
        for (const pack of packs) {
          const before = installed.find(p => p.manifest.id === pack.manifest.id)
          if (before?.manifest.contentHash === pack.manifest.contentHash) continue
          const prior = before?.local || await storage.local(pack.manifest.id), retired = new Set(prior?.retired || []), nextKeys = keys(pack)
          for (const key of nextKeys) check(!retired.has(key), '$.identity', 'Retired identity cannot be reused', 'DUPLICATE_ID')
          for (const key of before ? keys(before) : []) if (!nextKeys.has(key)) retired.add(key)
          const local=nextLocal(prior,[...retired].sort())
          if(adapter().inspectRaw(raw).modConfigPackId===pack.manifest.id)local.modConfig=true
          changes.push({pack,before,local})
        }
        check(!risks.length || input.acceptScriptRisk === true,'$.acceptScriptRisk','Accept or cancel this import script risk','SCRIPT_CONFIRMATION_REQUIRED')
        // Supply validated post-remap metadata under this gate; the card adapter must
        // not re-enter getPackSnapshot while preparing its managed worldbook entry.
        const boundPackIds = adapter().inspectRaw(raw).boundPackIds
        const globalEnabledPackIds = globalPackIds()
        const packSnapshots = available
          .filter(p => boundPackIds.includes(p.manifest.id) || globalEnabledPackIds.includes(p.manifest.id))
          .map(p => copy({manifest:p.manifest, figures:p.figures, sprites:p.sprites, widgets:p.widgets, skins:p.skins}))
        await adapter().withPrepared({path:entry.preview.path, expectedRevision:entry.preview.expectedRevision, raw, cover:entry.data.cover, packSnapshots, globalEnabledPackIds, disableWidgets:input.disableWidgets === true}, card => {
          host.alive()
          return storage.publishMany(changes.sort((a,b) => a.pack.manifest.id.localeCompare(b.pack.manifest.id)), card)
        })
        for (const change of changes) emit({...change.pack,local:change.local}, change.before)
        previews.delete(input.inspectionId)
        // Presets are additive, optional TTS data, not part of the pack/card transaction.
        return {status:'committed', mappings, widgetRisks:risks, path:entry.preview.path}
      })
    }
  }
}
