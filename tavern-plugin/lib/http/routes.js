import { createReadStream } from 'node:fs'
import { FULL_PROMPT_TEMPLATE_ASSET_PREFIX, readFullPromptTemplateAsset } from '../domain/full-prompt-template-assets.js'
import { OFFICIAL_MVU_VERSION, readOfficialMvuBundle } from '../domain/official-mvu-assets.js'
import { TAVERN_CLIENT_ASSET_PREFIX, readTavernClientAsset } from '../domain/tavern-client-assets.js'
import { TAVERN_RUNTIME_ASSET_PREFIX, readTavernRuntimeAsset } from '../domain/tavern-runtime-assets.js'
import { observeHttpRequests } from '../domain/http-performance-diagnostics.js'
import { projectCachedResourceBody } from '../domain/tavern-static-resource-cache.js'
import { redactMvuLoadError } from '../domain/mvu-diagnostics.js'
import { pluginMediaRange, slicePluginMediaStream } from '../domain/plugin-media.js'
import { PLUGIN_ASSET_PREFIX } from '../domain/plugin-assets.js'
import { PACK_LEASE_PATH } from '../asset-library/pack-v2/service.js'
import { STAGE_LEASE_ORIGIN } from '../domain/stage-material.js'

const LEASE_STATUS = Object.freeze({ FORBIDDEN: 403, INVALID_INPUT: 400, LIMIT_EXCEEDED: 413, REVISION_CONFLICT: 409, ASSET_UNAVAILABLE: 503, RECOVERY_REQUIRED: 503, NOT_FOUND: 404 })
const LEASE_HEADERS = ['range', 'if-range', 'if-none-match']

// Asset library media by lease (docs/design/asset-library.md). The page's origin passes Tavern's
// own check here; the service then checks resource, expiry and authorization on every request
// and yields the body in bounded chunks.
export async function respondAssetLease(assetLibrary, req, res) {
  const url = new URL(req.url ?? '/', 'http://x')
  const match = /^([A-Za-z0-9_-]{16,64})\/([^?]+)$/.exec(url.pathname.slice(PACK_LEASE_PATH.length))
  const origin = req.headers.origin, host = req.headers.host
  let response
  try {
    if (!url.pathname.startsWith(PACK_LEASE_PATH) || !match) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' })
    if (typeof origin === 'string' && origin !== '' && origin !== 'null' && origin !== 'http://' + host && origin !== 'https://' + host && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' })
    if (!['same-origin', 'none', undefined].includes(req.headers['sec-fetch-site'])) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' })
    const headers = new Headers()
    for (const name of LEASE_HEADERS) if (typeof req.headers[name] === 'string') headers.set(name, req.headers[name])
    const request = new Request(STAGE_LEASE_ORIGIN + url.pathname + url.search, { method: req.method === 'HEAD' ? 'HEAD' : req.method === 'GET' ? 'GET' : 'POST', headers })
    response = await assetLibrary.respondLease({ ticket: match[1], resource: match[2].split('/').map(decodeURIComponent).join('/'), request })
  } catch (error) {
    res.writeHead(LEASE_STATUS[error?.code] || 400, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end()
    return
  }
  res.writeHead(response.status, Object.fromEntries(response.headers))
  if (!response.body || req.method === 'HEAD') { await response.body?.cancel().catch(() => {}); res.end(); return }
  const reader = response.body.getReader()
  res.on('close', () => { void reader.cancel().catch(() => {}) })
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!res.write(value)) await new Promise(resolve => { res.once('drain', resolve); res.once('close', resolve) })
      if (res.destroyed) return
    }
    res.end()
  } catch { res.destroy() }
}

export function registerTavernHttpRoutes({
  ctx,
  dispatch,
  fileResources,
  helperHistoryAccess,
  mobileCardImport,
  performanceDiagnostics,
  runtimeGeneration,
  runtimeReadiness,
  sceneIllustrations,
  readPluginMediaFile,
  pluginAssets,
  sessionResources,
  str,
  tavernRemoteAssets,
  tavernStaticResources,
  castAssets,
  assetLibrary,
  speech,
  exportCardFile,
  assetPacks,
  uploads,
  exposeHandler,
}) {
  const webServer = ctx.get('webServer')
  if (webServer !== undefined) {
    ctx.effect(() => observeHttpRequests(webServer.server, snapshot => performanceDiagnostics.http(snapshot)))
    // Fixed SillyTavern compatibility version for card-script feature probes.
    ctx.effect(() => {
      return webServer.register({
        kind: 'prefix',
        path: '/version',
        handler: async (req, res) => {
          const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
          if (pathname !== '/version') { res.writeHead(404); res.end('not found'); return }
          if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ pkgVersion: '1.12.14' }))
        }
      })
    })
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/api/dsh-tavern',
      handler: handleTavernRequest
    }), 'dsh-tavern: web route')
    if (assetLibrary) ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: PACK_LEASE_PATH.replace(/\/$/, ''),
      handler: (req, res) => respondAssetLease(assetLibrary, req, res)
    }), 'dsh-tavern: asset lease route')
  }
  // In-process callers (the server script runtime) share these exact routes.
  exposeHandler?.(handleTavernRequest)

  async function handleTavernRequest(req, res) {
      {
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
        const cachedAssetMatch = /^\/api\/dsh-tavern\/remote-assets\/([0-9a-f]{64})(?:\/[^/]*)?$/i.exec(pathname)
        const readsStaticAsset = req.method === 'GET' && pathname === '/api/dsh-tavern/static-assets'
        const readsFullTemplate = req.method === 'GET' && pathname.startsWith(FULL_PROMPT_TEMPLATE_ASSET_PREFIX)
        const readsOfficialMvu = req.method === 'GET' && pathname === OFFICIAL_MVU_VERSION.assetUrl
        const readsRuntimeAsset = req.method === 'GET' && pathname.startsWith(TAVERN_RUNTIME_ASSET_PREFIX)
        const readsClientAsset = req.method === 'GET' && pathname.startsWith(TAVERN_CLIENT_ASSET_PREFIX)
        const readsPluginAsset = (req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith(PLUGIN_ASSET_PREFIX)
        const origin = req.headers.origin
        if (pathname === '/api/dsh-tavern/session-resource' && req.method === 'GET') {
          const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, max-age=600',
            'Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}
          try {
            const json = await sessionResources.read(new URL(req.url, 'http://localhost').searchParams.get('cap'))
            res.writeHead(200, headers); res.end(json)
          } catch (_) {
            res.writeHead(403, {...headers, 'Cache-Control':'no-store'})
            res.end(JSON.stringify({error:'Resource unavailable; refresh the session'}))
          }
          return
        }
        if (pathname === '/api/dsh-tavern/helper-history' && req.method === 'GET') {
          const target = new URL(req.url, 'http://localhost')
          const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'}
          try {
            const result = await helperHistoryAccess.read(target.searchParams.get('cap'), Number(target.searchParams.get('from')), Number(target.searchParams.get('to')))
            res.writeHead(200,headers); res.end(JSON.stringify(result))
          } catch (_) { res.writeHead(403,headers); res.end(JSON.stringify({error:'History unavailable; refresh the session'})) }
          return
        }
        const gameplayRoute = pathname.startsWith('/api/dsh-tavern/gameplay.')
        if (gameplayRoute && origin && origin !== 'http://' + req.headers.host && origin !== 'https://' + req.headers.host) {
          res.writeHead(403); res.end('forbidden'); return
        }
        // Old pictures Tavern drew: shown, listed in the gallery and deleted there.
        const sceneImageRoute = /^\/api\/dsh-tavern\/(?:scene-image|scene-image-stored|listSceneImageHistory|removeSceneImageHistory|sceneImageStatus)$/.test(pathname)
        const pluginMediaRoute = /^\/api\/dsh-tavern\/(?:plugin-media|pluginMediaForTurn|pluginMediaTurns)$/.test(pathname)
        if (pluginMediaRoute && origin && origin !== 'http://' + req.headers.host && origin !== 'https://' + req.headers.host && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        const sceneSameOrigin = (sceneImageRoute || pluginMediaRoute) && (origin === 'http://' + req.headers.host || origin === 'https://' + req.headers.host)
        if (sceneImageRoute && origin && !sceneSameOrigin) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        const readsCachedAsset = req.method === 'GET' && cachedAssetMatch
        const localOrOpaqueOrigin = origin === undefined || origin === '' || origin === 'null' || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
        if (readsStaticAsset && !localOrOpaqueOrigin) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        if (!readsCachedAsset && !readsStaticAsset && !readsOfficialMvu && !readsFullTemplate && !readsRuntimeAsset && !readsClientAsset && !readsPluginAsset && !sceneSameOrigin && typeof origin === 'string' && origin !== '' && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        if (req.method === 'GET' && pathname === '/api/dsh-tavern/runtime-generation') {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0'
          })
          res.end(JSON.stringify({ ok: true, runtimeGeneration }))
          return
        }
        try {
          if (readsFullTemplate) {
            const asset = await readFullPromptTemplateAsset(pathname)
            if (!asset) { res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' }); res.end('not found'); return }
            const headers = { 'Content-Type': asset.mediaType,
              'ETag': asset.etag, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff' }
            if (String(req.headers['if-none-match'] || '').split(',').some(tag => tag.trim().replace(/^W\//, '') === asset.etag || tag.trim() === '*')) {
              res.writeHead(304, headers); res.end(); return
            }
            res.writeHead(200, { ...headers, 'Content-Length': asset.body.length })
            res.end(asset.body)
            return
          }
          if (readsClientAsset) {
            const asset = await readTavernClientAsset(pathname)
            if (asset === undefined) {
              res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' })
              res.end('not found')
              return
            }
            res.writeHead(200, {
              'Content-Type': asset.mediaType,
              'Content-Length': asset.body.length,
              'Cache-Control': 'no-cache',
              'X-Content-Type-Options': 'nosniff'
            })
            res.end(asset.body)
            return
          }
          if (readsPluginAsset) {
            const asset = pluginAssets ? await pluginAssets.read(pathname) : undefined
            if (asset === undefined) { res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' }); res.end('not found'); return }
            // Opened directly (an SVG, say), an asset runs no script with the page's rights.
            const headers = { 'Content-Type': asset.mediaType, 'Accept-Ranges': 'bytes', ETag: asset.etag, 'Cache-Control': 'no-cache',
              'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox' }
            if (req.headers['if-none-match'] === asset.etag) { res.writeHead(304, headers); res.end(); return }
            const range = pluginMediaRange(req.headers.range, asset.length)
            if (range && range.invalid) { res.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + asset.length }); res.end(); return }
            const start = range ? range.start : 0, end = range ? range.end : asset.length - 1
            res.writeHead(range ? 206 : 200, { ...headers, 'Content-Length': Math.max(0, end - start + 1), ...(range ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + asset.length } : {}) })
            if (req.method === 'HEAD' || end < start) { res.end(); return }
            const stream = asset.stream(start, end)
            res.on('close', () => stream.destroy())
            stream.on('error', () => res.destroy())
            stream.pipe(res)
            return
          }
          if (readsRuntimeAsset) {
            const asset = await readTavernRuntimeAsset(pathname)
            res.writeHead(200, {
              'Content-Type': asset.mediaType,
              'Content-Length': asset.body.length,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff'
            })
            res.end(asset.body)
            return
          }
          const readiness = await runtimeReadiness
          if (!readiness.ok) throw readiness.error
          if (req.method === 'GET' && pathname === '/api/dsh-tavern/cast-asset') {
            const query = new URL(req.url, 'http://x').searchParams
            const image = castAssets ? await castAssets.readImage(query.get('card'), query.get('file')) : undefined
            if (image === undefined) { res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' }); res.end('not found'); return }
            // Content-addressed file names: a URL never changes what it serves.
            res.writeHead(200, { 'Content-Type': image.mediaType, 'Content-Length': image.bytes.byteLength, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' })
            res.end(image.bytes)
            return
          }
          if (req.method === 'GET' && pathname === '/api/dsh-tavern/speech-audio') {
            const audio = speech ? await speech.readAudio(new URL(req.url, 'http://x').searchParams.get('id')) : undefined
            if (audio === undefined) { res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' }); res.end('not found'); return }
            res.writeHead(200, { 'Content-Type': audio.mediaType, 'Content-Length': audio.bytes.byteLength, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' })
            res.end(audio.bytes)
            return
          }
          // Big files (DSH cards) arrive as a raw body and wait on disk for the call that uses them.
          if (req.method === 'POST' && pathname === '/api/dsh-tavern/card-upload') {
            let reply
            try { const upload = await uploads.receive(req); reply = { ok: true, uploadId: upload.id, size: upload.size } }
            catch (error) { reply = { ok: false, error: String(error?.message || error) } }
            res.writeHead(reply.ok ? 200 : 413, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
            res.end(JSON.stringify(reply))
            return
          }
          if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/dsh-tavern/pack-file') {
            const query = new URL(req.url, 'http://x').searchParams
            const found = assetPacks ? await assetPacks.file(query.get('pack'), query.get('v'), query.get('path')) : undefined
            if (found === undefined) { res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' }); res.end('not found'); return }
            // Files are addressed by content; anything not on the inline list is an inert download.
            const headers = { 'Content-Type': found.mediaType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
              ...(found.inline ? {} : { 'Content-Disposition': 'attachment', 'Content-Security-Policy': "sandbox; default-src 'none'" }) }
            const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''))
            let start = 0, end = found.size - 1
            if (range && (range[1] || range[2])) {
              if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])) } else start = Math.max(0, found.size - Number(range[2]))
              if (start > end || start >= found.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + found.size }); res.end(); return }
              res.writeHead(206, { ...headers, 'Content-Range': 'bytes ' + start + '-' + end + '/' + found.size, 'Content-Length': end - start + 1 })
            } else res.writeHead(200, { ...headers, 'Content-Length': found.size })
            if (req.method === 'HEAD' || found.size === 0) { res.end(); return }
            createReadStream(found.path, { start, end }).on('error', () => res.destroy()).pipe(res)
            return
          }
          if (req.method === 'GET' && pathname === '/api/dsh-tavern/card-export') {
            let file
            try { file = await exportCardFile(new URL(req.url, 'http://x').searchParams.get('path')) }
            catch (error) { res.writeHead(error?.code === 'TAVERN_NOT_FOUND' || /路径|不存在/.test(String(error?.message)) ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }); res.end(String(error?.message || error)); return }
            const name = file.name.replace(/[\\/:*?"<>|\r\n]/g, '_') + '.' + file.extension
            res.writeHead(200, { 'Content-Type': file.contentType, 'Content-Length': file.bytes.byteLength, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
              'Content-Disposition': 'attachment; filename="card.' + file.extension + '"; filename*=UTF-8\'\'' + encodeURIComponent(name) })
            res.end(file.bytes)
            return
          }
          if (req.method === 'GET' && pathname === '/api/dsh-tavern/card-image') {
            const query = new URL(req.url, 'http://x').searchParams
            const image = await fileResources.cardImagePreview(query.get('path'))
            if (image === undefined) {
              res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' })
              res.end('not found')
              return
            }
            // Revalidate instead of re-sending: the list mounts every thumbnail on each visit.
            if (req.headers['if-none-match'] === image.revision) {
              res.writeHead(304, { ETag: image.revision, 'Cache-Control': 'private, no-cache' })
              res.end()
              return
            }
            const body = await image.read()
            res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': body.byteLength, 'Cache-Control': 'private, no-cache', ETag: image.revision, 'X-Content-Type-Options': 'nosniff' })
            res.end(body)
            return
          }
          if (req.method === 'GET' && pathname === '/api/dsh-tavern/mobile-card-thumbnail') {
            const query = new URL(req.url, 'http://x').searchParams
            let thumbnail
            try { thumbnail = await mobileCardImport.thumbnail(query.get('id')) } catch { thumbnail = undefined }
            // JSON cards, unreadable images and unusual PNG variants fall back to a text placeholder.
            if (thumbnail === undefined) {
              res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' })
              res.end('not found')
              return
            }
            res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': thumbnail.body.byteLength, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' })
            res.end(thumbnail.body)
            return
          }
          if (req.method === 'GET' && pathname === '/api/dsh-tavern/scene-image') {
            const query = new URL(req.url, 'http://x').searchParams
            const image = await sceneIllustrations.readImage(query.get('sessionId'), Number(query.get('turn')), query.get('key'), query.get('versionId'))
            res.writeHead(200, { 'Content-Type': image.ref.mediaType, 'Content-Length': image.data.byteLength, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
            res.end(image.data)
            return
          }
          if (req.method === 'GET' && pathname === '/api/dsh-tavern/scene-image-stored') {
            const query = new URL(req.url, 'http://x').searchParams
            const image = await sceneIllustrations.readStoredImage(query.get('chatId'), query.get('key'), query.get('versionId'))
            res.writeHead(200, { 'Content-Type': image.ref.mediaType, 'Content-Length': image.data.byteLength, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
            res.end(image.data)
            return
          }
          if (req.method === 'GET' && pathname === '/api/dsh-tavern/plugin-media') {
            const query = new URL(req.url, 'http://x').searchParams
            const file = await readPluginMediaFile(query.get('sessionId'), query.get('id'), query.get('version'))
            const headers = { 'Content-Type': file.mediaType, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }
            if (file.mediaType === 'application/octet-stream') headers['Content-Disposition'] = 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(file.name || 'file')
            if (file.data) {
              res.writeHead(200, { ...headers, 'Content-Length': file.length })
              res.end(file.data)
              return
            }
            const range = pluginMediaRange(req.headers.range, file.length)
            if (range && range.invalid) {
              res.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + file.length })
              res.end()
              return
            }
            const aborter = new AbortController()
            res.on('close', () => aborter.abort())
            const start = range ? range.start : 0, end = range ? range.end : file.length - 1
            res.writeHead(range ? 206 : 200, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Length': Math.max(0, end - start + 1), ...(range ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + file.length } : {}) })
            try {
              for await (const chunk of slicePluginMediaStream(file.stream(aborter.signal), start, end)) {
                if (!res.write(chunk)) await new Promise(resolve => { res.once('drain', resolve); res.once('close', resolve) })
                if (aborter.signal.aborted) return
              }
              res.end()
            } catch { res.destroy() }
            return
          }
          if (readsOfficialMvu) {
            const asset = await readOfficialMvuBundle()
            res.writeHead(200, {
              'Content-Type': asset.mediaType,
              'Content-Length': asset.body.length,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'ETag': asset.etag,
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff',
              'X-DSH-Tavern-MVU-Commit': asset.commit
            })
            res.end(asset.body)
            return
          }
          if (readsCachedAsset) {
            const asset = await tavernRemoteAssets.readCached(cachedAssetMatch[1])
            if (!asset) {
              res.writeHead(404, { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' })
              res.end('not found')
              return
            }
            const body = projectCachedResourceBody({ url: asset.url, mediaType: asset.mediaType, body: Buffer.from(asset.content, 'utf8') })
            res.writeHead(200, {
              'Content-Type': str(asset.mediaType) + '; charset=utf-8',
              'Content-Length': body.length,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff'
            })
            res.end(body)
            return
          }
          if (readsStaticAsset) {
            const target = new URL(req.url ?? '/', 'http://x')
            const asset = await tavernStaticResources.get(target.searchParams.get('url'))
            const body = projectCachedResourceBody(asset)
            res.writeHead(200, {
              'Content-Type': str(asset.mediaType),
              'Content-Length': body.length,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff',
              'X-DSH-Tavern-Cache': asset.cache
            })
            res.end(body)
            return
          }
          const method = pathname.slice('/api/dsh-tavern'.length + 1)
          if (req.method !== 'POST') {
            res.writeHead(405)
            res.end()
            return
          }
          // Scene-image calls carry ids only: a gallery batch delete of 500 items fits easily.
          const sceneImageBodyLimit = 256 * 1024
          const bodyChunks = []
          let bodyBytes = 0
          for await (const chunk of req) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            bodyBytes += bytes.length
            if (gameplayRoute && bodyBytes > 2 * 1024 * 1024) throw new Error('游戏 API 请求超过 2 MB')
            if (sceneImageRoute && bodyBytes > sceneImageBodyLimit) {
              throw new Error('图片请求数据超过 256 KB 大小限制，请减少一次批量删除的图片后重试。')
            }
            bodyChunks.push(bytes)
          }
          // HTTP chunks may split a UTF-8 code point. Decode only after joining bytes;
          // decoding each chunk corrupts Chinese snapshots and causes false conflicts.
          const body = Buffer.concat(bodyChunks, bodyBytes).toString('utf8')
          let args = {}
          try {
            args = body.trim() === '' ? {} : JSON.parse(body)
          } catch (err) {
            res.writeHead(400)
            res.end('bad json')
            return
          }
          const result = await dispatch(method, args)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(Object.assign({ ok: true }, result, { runtimeGeneration })))
        } catch (err) {
          if (readsOfficialMvu || readsFullTemplate || readsRuntimeAsset) {
            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' })
            res.end(JSON.stringify({ ok: false, error: redactMvuLoadError(err && err.message || err) }))
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: str(err && err.message || err),
            errorCode: typeof err?.code === 'string' ? err.code : undefined }))
        }
      }
  }
}
