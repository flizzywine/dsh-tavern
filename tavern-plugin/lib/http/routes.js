import { createReadStream } from 'node:fs'
import { FULL_PROMPT_TEMPLATE_ASSET_PREFIX, readFullPromptTemplateAsset } from '../domain/full-prompt-template-assets.js'
import { OFFICIAL_MVU_VERSION, readOfficialMvuBundle } from '../domain/official-mvu-assets.js'
import { TAVERN_CLIENT_ASSET_PREFIX, readTavernClientAsset } from '../domain/tavern-client-assets.js'
import { serveAssetFile } from '../http-file.js'
import { TAVERN_RUNTIME_ASSET_PREFIX, resolveTavernRuntimeAsset } from '../domain/tavern-runtime-assets.js'
import { observeHttpRequests } from '../domain/http-performance-diagnostics.js'
import { projectCachedResourceBody } from '../domain/tavern-static-resource-cache.js'
import { redactMvuLoadError } from '../domain/mvu-diagnostics.js'
import { pluginMediaRange, slicePluginMediaStream } from '../domain/plugin-media.js'
import { PLUGIN_ASSET_PREFIX } from '../domain/plugin-assets.js'
import { isTrustedHostRequest } from './host-fence.js'

// A 50 MiB save/skill ZIP expands to 69,905,068 base64 bytes, plus its JSON envelope.
export const DEFAULT_RPC_BODY_LIMIT = 80 * 1024 * 1024

function waitForWritable(res) {
  return new Promise(resolve => {
    const settle = () => {
      res.off('drain', settle)
      res.off('close', settle)
      resolve()
    }
    res.once('drain', settle)
    res.once('close', settle)
  })
}

export function registerTavernHttpRoutes({
  ctx,
  clientAssets,
  widgetService,
  dispatch,
  fileResources,
  helperHistoryAccess,
  mobileCardImport,
  performanceDiagnostics,
  requestPerformance,
  runtimeGeneration,
  runtimeReadiness,
  readPluginMediaFile,
  pluginAssets,
  sessionResources,
  str,
  tavernRemoteAssets,
  tavernStaticResources,
  castAssets,
  speech,
  exportCardFile,
  assetPacks,
  uploads,
  transferExports,
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
      handler: (req, res) => handleTavernRequest(req, res, true)
    }), 'dsh-tavern: web route')
  }
  // In-process callers (the server script runtime) share these exact routes.
  exposeHandler?.(handleTavernRequest)

  async function handleTavernRequest(req, res, external = false) {
      {
        let pathname
        try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname) }
        catch { res.writeHead(400); res.end('invalid URL'); return }
        const cachedAssetMatch = /^\/api\/dsh-tavern\/remote-assets\/([0-9a-f]{64})(?:\/[^/]*)?$/i.exec(pathname)
        const readsStaticAsset = req.method === 'GET' && pathname === '/api/dsh-tavern/static-assets'
        const readsFullTemplate = req.method === 'GET' && pathname.startsWith(FULL_PROMPT_TEMPLATE_ASSET_PREFIX)
        const readsOfficialMvu = req.method === 'GET' && pathname === OFFICIAL_MVU_VERSION.assetUrl
        const readsRuntimeAsset = ['GET', 'HEAD'].includes(req.method) && pathname.startsWith(TAVERN_RUNTIME_ASSET_PREFIX)
        const readsClientAsset = req.method === 'GET' && pathname.startsWith(TAVERN_CLIENT_ASSET_PREFIX)
        const readsPluginAsset = (req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith(PLUGIN_ASSET_PREFIX)
        const readsCachedAsset = req.method === 'GET' && cachedAssetMatch
        const readsCapability = req.method === 'GET' && ['/api/dsh-tavern/session-resource', '/api/dsh-tavern/helper-history'].includes(pathname)
        const cookieFree = req.method === 'GET' && (readsCapability || readsCachedAsset || readsStaticAsset || readsOfficialMvu || readsFullTemplate || readsRuntimeAsset || readsClientAsset || readsPluginAsset)
        if (cookieFree) {
          if (!isTrustedHostRequest(req, ctx.get('connection')?.trustedHosts)) {
            res.writeHead(403); res.end('forbidden'); return
          }
        } else {
          const connection = ctx.get('connection')
          const rejection = connection ? connection.requestRejection(req) : 503
          if (rejection) { res.writeHead(rejection); res.end('forbidden'); return }
        }
        const origin = req.headers.origin
        const sameOrigin = origin === 'http://' + req.headers.host || origin === 'https://' + req.headers.host
        if (origin && !sameOrigin && !(cookieFree && origin === 'null')) {
          res.writeHead(403); res.end('forbidden'); return
        }
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
        // Voice grants and paid asset generation still require an explicit same-origin carrier.
        const figureVoiceRoute = /^\/api\/dsh-tavern\/(?:getFigureVoiceEditor|listFigureVoiceChoices|assignFigureVoice|previewFigureVoice|openFigureVoicePreview|closeFigureVoicePreview)$/.test(pathname)
        const assetGenerationRoute = /^\/api\/dsh-tavern\/(?:prepareAssetGeneration|generateAssetCandidate|getAssetGenerationJob|cancelAssetGenerationJob|listAssetCandidates|readAssetCandidate|rejectAssetCandidate|retryAssetCandidateSave|acceptAssetCandidate|getAssetGenPrompts|setAssetGenPrompt)$/.test(pathname)
        if ((figureVoiceRoute || assetGenerationRoute) && (!sameOrigin || req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
          res.writeHead(403); res.end('forbidden'); return
        }
        const gameplayRoute = pathname.startsWith('/api/dsh-tavern/gameplay.')
        // The gallery: listing and deleting the pictures plugins attached.
        const sceneImageRoute = /^\/api\/dsh-tavern\/(?:listSceneImageHistory|removeSceneImageHistory)$/.test(pathname)
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
            const asset = await (clientAssets ? clientAssets.read(pathname) : readTavernClientAsset(pathname))
            if (asset === undefined) {
              res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' })
              res.end('not found')
              return
            }
            res.writeHead(200, {
              'Content-Type': asset.mediaType,
              'Content-Length': asset.body.length,
              'Cache-Control': 'no-cache',
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
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
            const asset = await resolveTavernRuntimeAsset(pathname)
            // The stage kit is unversioned fork code; pinned vendor files stay immutable.
            await serveAssetFile(req, res, asset.file, asset.mediaType,
              pathname.includes('/stage-kit/') || pathname.endsWith('/pixi-spine.js') ? 'no-cache' : 'public, max-age=31536000, immutable',
              { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' })
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
          if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/api/dsh-tavern/transfer-export' || pathname.startsWith('/api/dsh-tavern/transfer-export/'))) {
            const token = new URL(req.url, 'http://x').searchParams.get('token') || ''
            const found = transferExports ? await transferExports.take(token) : null
            if (!found) {
              res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
              res.end('export expired')
              return
            }
            // 名字优先取服务端记录；URL 路径段只是给下载器的兜底（见 rpc 里 downloadUrl 的注释）。
            const requested = pathname.slice('/api/dsh-tavern/transfer-export/'.length)
            const name = String(found.filename || requested || 'DSH酒馆备份.dshtransfer').replace(/[\/:*?"<>|\r\n]/g, '_')
            res.writeHead(200, {
              'Content-Type': 'application/zip',
              'Content-Length': found.bytes,
              'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff',
              // ASCII 名给只认 filename= 的下载器，filename* 给浏览器，路径段给 Android WebView。
              'Content-Disposition': 'attachment; filename="tavern-backup.dshtransfer"; filename*=UTF-8\'\'' + encodeURIComponent(name)
            })
            if (req.method === 'HEAD' || found.bytes === 0) { res.end(); return }
            const stream = found.stream()
            // 下载完不删：内嵌 WebView 或浏览器可能中途放弃第一次请求，用户刷新后还会再点。
            // 文件按 token 有效期由 sweep 收掉，这里只中断本次流。
            res.on('close', () => { stream.destroy(); void transferExports.sweep() })
            stream.on('error', () => res.destroy()).pipe(res)
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
                if (!res.write(chunk)) await waitForWritable(res)
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
            if (bodyBytes > DEFAULT_RPC_BODY_LIMIT) throw new Error('RPC request exceeds 80 MiB')
            if (assetGenerationRoute && bodyBytes > (method === 'prepareAssetGeneration' ? 45 * 1024 * 1024 : method === 'setAssetGenPrompt' ? 64 * 1024 : 16384)) throw new Error('素材生成请求过大')
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
          const host = req.headers.host
          const origin = req.headers.origin
          const trustedOrigin = typeof origin === 'string' && [`http://${host}`, `https://${host}`].includes(origin) ? origin : undefined
          const result = await dispatch(method, args, {origin:trustedOrigin})
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          const reply = Object.assign({ ok: true }, result, { runtimeGeneration })
          res.end(requestPerformance ? requestPerformance.serialize(method, args?.sessionId, reply) : JSON.stringify(reply))
        } catch (err) {
          if (readsOfficialMvu || readsFullTemplate || readsRuntimeAsset) {
            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' })
            res.end(JSON.stringify({ ok: false, error: redactMvuLoadError(err && err.message || err) }))
            return
          }
          const voiceCode = figureVoiceRoute ? (/^[A-Z_]+$/.test(err?.code || '') ? err.code : 'REQUEST_FAILED') : undefined
          if (voiceCode) ctx.logger?.warn(`[voice-rpc] ${pathname.split('/').at(-1)} ${voiceCode}`)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: voiceCode ? '声音暂时不可用' : str(err && err.message || err),
            errorCode: voiceCode || (typeof err?.code === 'string' ? err.code : undefined),
            ...(pathname.split('/').at(-1).startsWith('managedMod') && err?.details ? {errorDetails:err.details} : {}) }))
        }
      }
  }
}
