import { FULL_PROMPT_TEMPLATE_ASSET_PREFIX, readFullPromptTemplateAsset } from '../domain/full-prompt-template-assets.js'
import { OFFICIAL_MVU_VERSION, readOfficialMvuBundle } from '../domain/official-mvu-assets.js'
import { TAVERN_CLIENT_ASSET_PREFIX, readTavernClientAsset } from '../domain/tavern-client-assets.js'
import { TAVERN_RELEASE_CAPABILITIES } from '../domain/release-capabilities.js'
import { TAVERN_RUNTIME_ASSET_PREFIX, readTavernRuntimeAsset } from '../domain/tavern-runtime-assets.js'
import { observeHttpRequests } from '../domain/http-performance-diagnostics.js'
import { projectCachedResourceBody } from '../domain/tavern-static-resource-cache.js'
import { redactMvuLoadError } from '../domain/mvu-diagnostics.js'
import { pluginMediaRange, slicePluginMediaStream } from '../domain/plugin-media.js'

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
  sessionResources,
  str,
  tavernRemoteAssets,
  tavernStaticResources,
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
      handler: async (req, res) => {
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
        const cachedAssetMatch = /^\/api\/dsh-tavern\/remote-assets\/([0-9a-f]{64})(?:\/[^/]*)?$/i.exec(pathname)
        const readsStaticAsset = req.method === 'GET' && pathname === '/api/dsh-tavern/static-assets'
        const readsFullTemplate = req.method === 'GET' && pathname.startsWith(FULL_PROMPT_TEMPLATE_ASSET_PREFIX)
        const readsOfficialMvu = req.method === 'GET' && pathname === OFFICIAL_MVU_VERSION.assetUrl
        const readsRuntimeAsset = req.method === 'GET' && pathname.startsWith(TAVERN_RUNTIME_ASSET_PREFIX)
        const readsClientAsset = req.method === 'GET' && pathname.startsWith(TAVERN_CLIENT_ASSET_PREFIX)
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
        const sceneImageRoute = TAVERN_RELEASE_CAPABILITIES.sceneImages && /^\/api\/dsh-tavern\/(?:scene-image|scene-image-artist-preview|getSceneImageSettings|saveSceneImageSettings|testSceneImageConnection|listSceneImageModels|listSceneImages|removeSceneImages|testSceneImageGeneration|sceneImageStatus|recordSceneImageInteraction|generateSceneImage|retrySceneImageSave|cancelSceneImage|removeSceneImage|setSceneImageReference)$/.test(pathname)
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
        if (!readsCachedAsset && !readsStaticAsset && !readsOfficialMvu && !readsFullTemplate && !readsRuntimeAsset && !readsClientAsset && !sceneSameOrigin && typeof origin === 'string' && origin !== '' && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
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
            res.writeHead(200, { 'Content-Type': asset.mediaType, 'Content-Length': asset.body.length,
              'ETag': asset.etag, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff' })
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
          if (TAVERN_RELEASE_CAPABILITIES.sceneImages && req.method === 'GET' && pathname === '/api/dsh-tavern/scene-image-artist-preview') {
            const image = await sceneIllustrations.readArtistPreview(new URL(req.url, 'http://x').searchParams.get('id'))
            // The URL carries the preview revision, so a replaced image gets a new URL.
            res.writeHead(200, { 'Content-Type': image.mediaType, 'Content-Length': image.data.byteLength, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' })
            res.end(image.data)
            return
          }
          if (TAVERN_RELEASE_CAPABILITIES.sceneImages && req.method === 'GET' && pathname === '/api/dsh-tavern/scene-image') {
            const query = new URL(req.url, 'http://x').searchParams
            const image = await sceneIllustrations.readImage(query.get('sessionId'), Number(query.get('turn')), query.get('key'), query.get('versionId'), query.get('chatId'))
            res.writeHead(200, { 'Content-Type': image.ref.mediaType, 'Content-Length': image.data.byteLength, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
            res.end(image.data)
            return
          }
          if (req.method === 'GET' && pathname === '/api/dsh-tavern/plugin-media') {
            const query = new URL(req.url, 'http://x').searchParams
            const file = await readPluginMediaFile(query.get('sessionId'), query.get('id'))
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
          const sceneImageBodyLimit = method === 'saveSceneImageSettings' ? 2 * 1024 * 1024 : 16384
          const bodyChunks = []
          let bodyBytes = 0
          for await (const chunk of req) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            bodyBytes += bytes.length
            if (gameplayRoute && bodyBytes > 2 * 1024 * 1024) throw new Error('游戏 API 请求超过 2 MB')
            if (sceneImageRoute && bodyBytes > sceneImageBodyLimit) {
              throw new Error(method === 'saveSceneImageSettings'
                ? '无法保存生图配置：工作流与配置数据超过当前 2 MB 请求大小限制。请精简工作流后重试；这不是图片尺寸或显存不足。'
                : '生图请求数据超过当前 16 KB 大小限制，请减少输入数据后重试；这不是图片尺寸或显存不足。')
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
    }), 'dsh-tavern: web route')
  }
}
