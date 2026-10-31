import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, rename, stat, unlink, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { checkedPath } from './storage.js'
import { createAssetPackService } from './service.js'
import { createThumbnailCache } from './thumbnails.js'
import { PACK_LEASE_PATH } from './leases.js'
import { PACK_LIMITS } from './validation.js'
import { check, parseJson } from '../asset-packs/common.js'

export const PACK_CONTROL_PATH = '/api/dsh-asset-library/v2/control'
export const PACK_UPLOAD_PATH = '/api/dsh-asset-library/v2/upload'
export const PACK_DOWNLOAD_PATH = '/api/dsh-asset-library/v2/download'
export const PACK_CHANGES_PATH = '/api/dsh-asset-library/v2/changes'
export const PACK_THUMBNAIL_PATH = '/api/dsh-asset-library/v2/thumbnail'
export const PACK_THUMBNAILS_PATH = '/api/dsh-asset-library/v2/thumbnails'
const PRINCIPAL = 'dsh-browser'
const fields = Object.freeze({
  capabilities:[], settings:[], saveSettings:['expectedRevision','globalEnabledPackIds'],
  catalogueSettings:[], saveCatalogueSettings:['expectedRevision','sources','preferredDownloadId','mirrorPrefix'],
  refreshCatalogue:['sourceId','curated'], checkPackUpdates:['packIds'],
  startPackDownload:['selection','url','useMirrorPrefix'], getPackDownload:['jobId'], controlPackDownload:['jobId','action'],
  getStageSetupStatus:['path','autoOpened'], mergeStageSetupPack:['path','expectedCardRevision','expectedLibraryRevision','selections','name','figure'],
  listPackSummaries:[], getPackSnapshot:['packId'],
  savePackVoice:['figureId','packId','expectedRevision','voiceId','voiceSpec','confirmShared'], saveFigureVoiceBinding:['packId','figureId','expectedRevision','binding'], createAndAssignPackVoice:['packId','figureId','expectedRevision','voiceSpec'],
  savePackVoiceVariant:['figureId','packId','expectedRevision','voiceId','variantId','variant','confirmShared'],
  deletePackVoiceVariant:['figureId','packId','expectedRevision','voiceId','variantId','confirmShared'],
  listVoiceTemplates:[], saveVoiceTemplate:['templateId','expectedRevision','packId','packRevision','voiceId','binding'],
  deleteVoiceTemplate:['templateId','expectedRevision'], assignVoiceTemplate:['templateId','templateRevision','packId','figureId','expectedRevision'],
  createPack:['name','description','expectedRevision'], patchPack:['packId','expectedRevision','patch','fileUpdates','force'], removePack:['packId','expectedRevision'],
  putBlob:['packId','expectedRevision','bytes','descriptor'], removeBlob:['packId','expectedRevision','hash'],
  putBundle:['packId','expectedRevision','bundleKey','descriptor','files'], removeBundle:['packId','expectedRevision','bundleKey'],
  copyFigure:['source','target'], copyItems:['sourcePackId','itemRefs','target'],
  createSimpleSprite:['packId','expectedRevision','spriteKey','images','name'],
  setFigureAvatarCrop:['packId','expectedRevision','figureId','outfitKey','scope','stateId','crop'],
  createFigure:['packId','expectedRevision','figure'], patchFigure:['packId','expectedRevision','figureId','patch'], removeFigure:['packId','expectedRevision','figureId'],
  setFigureEmotionFallback:['packId','expectedRevision','figureId','outfitKey','emotionId','enabled','use'],
  removeFigureEmotion:['packId','expectedRevision','figureId','emotionId'],
  migrateFigureVariants:['packId','expectedRevision','dryRun'],
  resolveAssets:['refs'], resolveFigures:['refs'], inspectImport:['bytes','copy'],
  applyImport:['inspectionId','expectedRevision','decision','acceptScriptRisk'], exportPack:['packId','expectedRevision'], exportPacks:['packs'],
  exportCardBundle:['path','expectedRevision','packIds'], inspectCardBundle:['path','bytes'], inspectCardBundleUrl:['path','url'], previewCardBundleDecisions:['inspectionId','decisions'],
  applyCardBundle:['inspectionId','expectedRevision','cancel','decisions','acceptScriptRisk','disableWidgets'],
  leaseMedia:['packId','hash'], leaseBundle:['packId','bundleKey'], releaseLease:['ticket'], discardUpload:['ticket']
})
const status = {FORBIDDEN:403, INVALID_INPUT:400, LIMIT_EXCEEDED:413, REVISION_CONFLICT:409, ASSET_UNAVAILABLE:503, SETTINGS_UNAVAILABLE:503, RECOVERY_REQUIRED:503}
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const json = (value, code = 200) => Response.json(value, {status:code, headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
function errorResponse(error) {
  const code = /^[A-Z_]+$/.test(error?.code || '') ? error.code : 'INVALID_INPUT'
  return json({error:code, ...(['DOWNLOAD_FAILED','INTEGRITY_MISMATCH','SCRIPT_CONFIRMATION_REQUIRED'].includes(code) ? {message:error.message?.replace(/https?:\/\/\S+/g,'[URL]')} : {}), ...(code === 'REVISION_CONFLICT' && typeof error.revision === 'string' ? {revision:error.revision} : {})}, status[code] || 400)
}
// Connection authenticates the single browser administrator before invoking us.
// Its HTTP bridge retains Host but replaces the Request URL with dsh.internal.
export function packRequestOrigin(request, expected, widget = false) {
  const host = request.headers.get('host'), origin = request.headers.get('origin'), site = request.headers.get('sec-fetch-site')
  // Only exact authorized widget resource routes accept opaque-frame subresources.
  if (widget && expected && host === new URL(expected).host && (!origin || origin === 'null') && ['script','style','image','font'].includes(request.headers.get('sec-fetch-dest'))) return expected
  check(host && (!site || site === 'same-origin'), '$.origin', 'Same-origin request required', 'FORBIDDEN')
  check(origin ? origin === 'http://' + host || origin === 'https://' + host : site === 'same-origin', '$.origin', 'Same-origin request required', 'FORBIDDEN')
  if (expected) {
    check(new URL(expected).host === host && (!origin || origin === expected), '$.origin', 'Lease origin changed', 'FORBIDDEN')
    return expected
  }
  // Issuance/control POSTs require Origin; never infer a public scheme from dsh.internal.
  check(origin || ['GET','HEAD'].includes(request.method), '$.origin', 'Origin required', 'FORBIDDEN')
  return origin
}
async function readBytes(request, maximum, reserve = () => {}, unreserve = () => {}) {
  const declared = request.headers.get('content-length')
  check(declared === null || /^\d+$/.test(declared) && Number(declared) <= maximum, '$.body', 'Body limit', 'LIMIT_EXCEEDED')
  const reader = request.body?.getReader(), chunks = []
  check(reader, '$.body')
  let size = 0
  const abort = () => { void reader.cancel().catch(() => {}) }
  request.signal.addEventListener('abort',abort,{once:true})
  try {
    request.signal.throwIfAborted()
    for (;;) {
      const {done,value} = await reader.read()
      if (done) break
      check(size + value.byteLength <= maximum, '$.body', 'Body limit', 'LIMIT_EXCEEDED')
      reserve(value.byteLength); size += value.byteLength; chunks.push(Buffer.from(value))
    }
    request.signal.throwIfAborted()
    return Buffer.concat(chunks, size)
  } finally { request.signal.removeEventListener('abort',abort); unreserve(size); await reader.cancel().catch(() => {}); reader.releaseLock() }
}

/** Owns one v2 service and its exact authenticated routes. No v1 adapter or disk reader. */
export function createAssetPackTransport({settings, ...options}) {
  const now = options.now || Date.now, limits = {...PACK_LIMITS, ...options.limits}
  const uploads = new Map(), downloads = new Map(), leases = new Map(), changes = [], outbox = new Set(), cleanup = new Set()
  const outboxBytes = () => [...outbox].reduce((sum,item) => sum + item.size,0)
  function removeArchive(item) {
    for (const owned of outbox) if (owned.file === item.file) outbox.delete(owned)
    const task = item.dispose().catch(() => {}).finally(() => cleanup.delete(task))
    cleanup.add(task)
  }
  async function exportArchive(source) {
    alive(); sweep()
    const epoch = generation, folder = await checkedPath(options.assetRoot, 'export-outbox')
    await mkdir(folder, {recursive:true})
    const directory = await mkdtemp(path.join(folder, 'archive-')), file = path.join(directory, 'archive.zip')
    const item = {file, size:0, expiresAt:now() + limits.previewTtlMs, async dispose() { outbox.delete(item); await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error }); await rmdir(directory).catch(error => { if (error.code !== 'ENOENT') throw error }) }}
    try {
      await rename(source, file)
      item.size = (await stat(file)).size
      alive(); check(epoch === generation, '$', 'Transport detached', 'ASSET_UNAVAILABLE')
      check(item.size <= limits.totalSize && pendingBytes + storedBytes + outboxBytes() + core.spoolUsage() + item.size <= limits.spoolBytes, '$', 'Export archive spool budget exceeded', 'LIMIT_EXCEEDED')
      outbox.add(item)
      return item
    } catch (error) { await item.dispose(); throw error }
  }
  let active = true, connection = null, pendingBytes = 0, storedBytes = 0, sequence = 0, generation = 0, routeStops = [], carrierLife = null
  const alive = () => check(active, '$', 'Transport disposed', 'ASSET_UNAVAILABLE')
  // card export may embed globally enabled packs; the service reads them from these settings.
  const core = createAssetPackService({...options, exportArchive, globalEnabledPackIds:() => settings ? settings.read().values.globalEnabledPackIds : [], externalSpoolUsage:() => pendingBytes + storedBytes + outboxBytes(), authorizeLease:async input => {
    if (!active || !connection || input.scope !== PRINCIPAL) return false
    return options.authorizeLease ? await options.authorizeLease(input) === true : true
  }})
  const thumbnails = createThumbnailCache({assetRoot:options.assetRoot,service:core,...options.thumbnails})
  thumbnails.start()
  function release(ticket) {
    const lease = leases.get(ticket)
    if (lease) { leases.delete(ticket); for (const stop of lease.stops) stop() }
    return core.releaseLease(ticket)
  }
  function drop(pool, ticket) {
    const item = pool.get(ticket)
    if (!item) return false
    if (item.file) removeArchive(item)
    else storedBytes -= item.bytes.length
    pool.delete(ticket); return true
  }
  function sweep() {
    for (const [ticket,item] of leases) if (item.expiresAt <= now()) release(ticket)
    for (const pool of [uploads,downloads]) for (const [ticket,item] of pool) if (item.expiresAt <= now()) drop(pool,ticket)
    for (const item of outbox) if (item.expiresAt <= now()) removeArchive(item)
  }
  function reserve(size) {
    alive(); sweep()
    check(pendingBytes + storedBytes + outboxBytes() + core.spoolUsage() + size <= limits.spoolBytes, '$.body', 'Transport spool limit', 'LIMIT_EXCEEDED')
    pendingBytes += size
  }
  function store(pool, bytes, extra = {}) {
    alive(); sweep()
    // A single atomic multipart registration can exceed the import-preview count.
    const countLimit=pool===uploads?Math.min(limits.uploads,limits.entries):limits.previews
    check(pool.size < countLimit && pendingBytes + storedBytes + outboxBytes() + core.spoolUsage() + bytes.length <= limits.spoolBytes, '$.body', 'Transport spool limit', 'LIMIT_EXCEEDED')
    const ticket = randomBytes(24).toString('base64url'), expiresAt = now() + limits.previewTtlMs
    pool.set(ticket,{bytes,expiresAt,...extra}); storedBytes += bytes.length
    return {ticket,expiresAt}
  }
  const changeStreams = new Set()
  function changed(event) {
    changes.push({sequence:++sequence,...event})
    if (changes.length > 256) changes.shift()
    for (const stream of changeStreams) stream.send()
  }
  const stopChanges = core.subscribe(event => {
    for (const [ticket,lease] of leases) if (lease.packId === event.packId && (event.revision === null || lease.kind === 'widget')) release(ticket)
    changed({type:'pack',...event})
  })
  const stopSettings = settings?.subscribe(() => changed({type:'settings'}))
  async function issue(method,input) {
    alive(); sweep()
    check(connection, '$', 'Authenticated transport unavailable', 'ASSET_UNAVAILABLE')
    const carrier = connection, epoch = generation, lease = await core[method](input)
    const stops = []
    try {
      alive(); check(connection === carrier && generation === epoch, '$', 'Transport detached', 'ASSET_UNAVAILABLE')
      for (const path of lease.resources) {
        check(path.startsWith(PACK_LEASE_PATH + lease.ticket + '/'), '$.resource')
        const resource = path.slice((PACK_LEASE_PATH + lease.ticket + '/').length).split('/').map(decodeURIComponent).join('/')
        stops.push(carrier.fetch.register({path, methods:['GET','HEAD'], requestBody:'buffered', fetch:request => guarded(request, async () => {
          packRequestOrigin(request,input.origin,method === 'leaseWidget')
          // Reconstruct only after validating the retained authority against this lease.
          const external = new Request(new URL(new URL(request.url).pathname + new URL(request.url).search,input.origin), request)
          if (method === 'leaseBundle' && path === lease.url && request.method === 'GET' && new URL(request.url).searchParams.get('bundle') === '1') {
            return core.respondLease({ticket:lease.ticket,resource,request:external,bundle:true,deferFonts:new URL(request.url).searchParams.get('deferFonts') === '1'})
          }
          return core.respondLease({ticket:lease.ticket,resource,request:external})
        }, input.origin, method === 'leaseWidget')}))
      }
      leases.set(lease.ticket,{...lease,packId:input.packId || input.ref?.packId,kind:method === 'leaseWidget' ? 'widget' : 'inert',stops})
      return lease
    } catch (error) { for (const stop of stops) stop(); core.releaseLease(lease.ticket); throw error }
  }
  async function guarded(request, action, expected, widget = false) {
    try { alive(); sweep(); packRequestOrigin(request,expected,widget); return await action() }
    catch (error) { await request.body?.cancel().catch(() => {}); return errorResponse(error) }
  }
  function uploadBytes(ticket, consumed) {
    check(typeof ticket === 'string' && uploads.has(ticket), '$.upload', 'Upload missing or expired', 'ASSET_UNAVAILABLE')
    consumed.add(ticket); return uploads.get(ticket).bytes
  }
  function fileMap(value, consumed, deletes) {
    check(Array.isArray(value) && value.length <= limits.entries, '$.files')
    const result = new Map()
    for (const row of value) {
      check(Array.isArray(row) && row.length === 2 && typeof row[0] === 'string' && !result.has(row[0]), '$.files')
      result.set(row[0],row[1] === null && deletes ? null : uploadBytes(row[1],consumed))
    }
    return result
  }
  const routes = [
    {path:PACK_THUMBNAIL_PATH,methods:['GET'],requestBody:'buffered',fetch:request => guarded(request,async () => {
      const params = new URL(request.url).searchParams
      let bytes
      try { bytes = await thumbnails.get({packId:params.get('packId'),hash:params.get('hash'),size:params.has('size') ? Number(params.get('size')) : 256}) }
      catch (error) { if (error.code) throw error; options.thumbnails?.onError?.(error); return json({error:'ASSET_UNAVAILABLE'},503) }
      if (!bytes) return json({error:'NOT_FOUND'},404)
      return new Response(bytes,{headers:{'Content-Type':'image/png','Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}})
    })},
    {path:PACK_THUMBNAILS_PATH,methods:['GET'],requestBody:'buffered',fetch:request => guarded(request,async () => json(await thumbnails.manifest(new URL(request.url).searchParams.get('packId'))))}, 
    {path:PACK_CONTROL_PATH,methods:['POST'],requestBody:'streaming',fetch:request => guarded(request,async () => {
      check(request.method === 'POST' && /^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || ''), '$.request')
      const input = parseJson(new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(request,1024 * 1024)))
      check(plain(input) && Object.keys(input).every(key => ['method','args'].includes(key)) && Object.hasOwn(fields,input.method), '$.method')
      const args = input.args === undefined ? {} : input.args
      check(plain(args), '$.args')
      // a removed argument (e.g. startPackDownload.expectedSha256) is named, never ignored.
      for (const key of Object.keys(args)) check(fields[input.method].includes(key), '$.args.' + key, 'Unknown field', 'UNKNOWN_FIELD')
      const consumed = new Set()
      try {
        if (Object.hasOwn(args,'bytes')) args.bytes = uploadBytes(args.bytes,consumed)
        if (Object.hasOwn(args,'fileUpdates')) args.fileUpdates = fileMap(args.fileUpdates,consumed,true)
        if (Object.hasOwn(args,'files')) args.files = fileMap(args.files,consumed,false)
        let result
        if(args.packId && !['exportPack'].includes(input.method))check(!await core.isPrivatePack({packId:args.packId}),'$.packId','Mod config storage is not an editable asset pack','UNKNOWN_FIELD')
        if(input.method==='saveSettings')for(const packId of args.globalEnabledPackIds || [])check(!await core.isPrivatePack({packId}),'$.globalEnabledPackIds','Mod config packs have no lamp state','UNKNOWN_FIELD')
        // the browser lists summaries only; full documents are per pack.
        if (input.method === 'listPackSummaries') result=(await core.listPackSummaries()).filter(pack=>!pack.privateConfig)
        else if (input.method === 'capabilities') result = {apiVersion:core.apiVersion,capabilities:core.capabilities}
        else if (input.method === 'settings' || input.method === 'saveSettings') {
          check(settings, '$.settings', 'Native settings unavailable', 'SETTINGS_UNAVAILABLE')
          result = input.method === 'settings' ? settings.read() : await settings.save(args)
        } else if (input.method === 'discardUpload') result = {released:drop(uploads,args.ticket)}
        else if (input.method === 'releaseLease') result = {released:release(args.ticket)}
        else if (input.method === 'leaseMedia' || input.method === 'leaseBundle') result = await issue(input.method,{...args,scope:PRINCIPAL,origin:packRequestOrigin(request)})
        else result = await core[input.method](args)
        alive()
        function transfer(result) {
          if (result?.archives) return {...result, archives:result.archives.map(transfer)}
          if (result?.file) {
            const {file, size, dispose, expiresAt, ...metadata} = result
            const ticket = randomBytes(24).toString('base64url')
            result.filename = metadata.filename; result.origin = packRequestOrigin(request)
            downloads.set(ticket, result)
            return {...metadata, download:{ticket,expiresAt,url:PACK_DOWNLOAD_PATH + '?ticket=' + ticket}}
          }
          return result
        }
        return json(transfer(result))
      } finally { for (const ticket of consumed) drop(uploads,ticket) }
    })},
    {path:PACK_UPLOAD_PATH,methods:['POST'],requestBody:'streaming',fetch:request => guarded(request,async () => {
      check(request.method === 'POST' && request.headers.get('content-type') === 'application/octet-stream', '$.request')
      const epoch = generation
      const bytes = await readBytes(request,limits.totalSize,reserve,size => {pendingBytes -= size})
      alive(); check(epoch === generation, '$', 'Transport detached', 'ASSET_UNAVAILABLE')
      return json(store(uploads,bytes))
    })},
    {path:PACK_DOWNLOAD_PATH,methods:['GET','HEAD'],requestBody:'buffered',fetch:request => guarded(request,async () => {
      const item = downloads.get(new URL(request.url).searchParams.get('ticket'))
      check(item, '$.ticket', 'Download expired', 'ASSET_UNAVAILABLE'); packRequestOrigin(request,item.origin)
      return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(item.file)),{headers:{'Content-Type':'application/zip','Content-Length':String(item.size),'Content-Disposition':"attachment; filename*=UTF-8''" + encodeURIComponent(item.filename),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
    }, null)},
    {path:PACK_CHANGES_PATH,methods:['GET'],requestBody:'buffered',fetch:request => guarded(request,async () => {
      const since = Number(new URL(request.url).searchParams.get('since'))
      check(Number.isSafeInteger(since) && since >= 0, '$.since')
      if (new URL(request.url).searchParams.get('stream') === '1') {
        let cursor = since, stop
        const body = new ReadableStream({
          start(controller) {
            const lifetime = carrierLife?.signal
            let closed = false
            const stream = {send() {
              if (closed) return
              const feed = {sequence,reset:cursor > sequence || cursor < (changes[0]?.sequence || 1)-1,changes:changes.filter(event => event.sequence > cursor)}
              controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(feed) + '\n\n'))
              cursor = sequence
            }}
            stop = () => { if (closed) return; closed = true; changeStreams.delete(stream); request.signal.removeEventListener('abort',stop); lifetime?.removeEventListener('abort',stop); try { controller.close() } catch {} }
            changeStreams.add(stream)
            request.signal.addEventListener('abort',stop,{once:true}); lifetime?.addEventListener('abort',stop,{once:true})
            if (request.signal.aborted || lifetime?.aborted) stop(); else stream.send()
          },
          cancel() { stop?.() }
        })
        return new Response(body,{headers:{'content-type':'text/event-stream','cache-control':'no-cache','x-accel-buffering':'no'}})
      }
      return json({sequence,reset:since > sequence || since < (changes[0]?.sequence || 1) - 1,changes:changes.filter(event => event.sequence > since)})
    })}
  ]
  function detach() {
    generation++; connection = null
    carrierLife?.abort(); carrierLife = null
    for (const stop of routeStops) stop()
    routeStops = []
    for (const ticket of [...leases.keys()]) release(ticket)
    for (const pool of [uploads,downloads]) for (const ticket of [...pool.keys()]) drop(pool,ticket)
    for (const item of [...outbox]) removeArchive(item)
  }
  const service = Object.freeze({...core,
    leaseMedia:input => issue('leaseMedia',input), leaseBundle:input => issue('leaseBundle',input), leaseWidget:input => issue('leaseWidget',input), releaseLease:release,
    async dispose() { if (!active) return; active = false; detach(); stopChanges(); stopSettings?.(); clearInterval(timer); await thumbnails.dispose(); await core.dispose(); await Promise.all(cleanup) }
  })
  const timer = setInterval(sweep,30000); timer.unref?.()
  return Object.freeze({service,
    attach(carrier) {
      alive(); check(!connection && carrier?.fetch?.register, '$.connection', 'Transport already attached or invalid')
      connection = carrier
      carrierLife = new AbortController()
      const epoch = generation, signal = carrierLife.signal
      try { for (const route of routes) routeStops.push(carrier.fetch.register({...route, fetch:request => {
        if (!active || connection !== carrier || generation !== epoch) return errorResponse({code:'ASSET_UNAVAILABLE'})
        return route.fetch(new Request(request,{signal:AbortSignal.any([request.signal,signal])}))
      }})) }
      catch (error) { detach(); throw error }
      let attached = true
      return () => { if (!attached) return; attached = false; if (generation === epoch) detach() }
    }
  })
}

export function registerAssetPackTransport(ctx, transport) {
  ctx.inject(['connection'], child => child.effect(() => transport.attach(child.get('connection'))))
}
