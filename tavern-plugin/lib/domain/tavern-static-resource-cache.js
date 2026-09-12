import { projectTavernHostScript } from './tavern-host-script-projection.js'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_MAX_ENTRY_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024
const CACHE_VERSION = 1

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function cacheKey(url) {
  return createHash('sha256').update(url, 'utf8').digest('hex')
}

export function normalizeCacheableResourceUrl(value) {
  let parsed
  try { parsed = new URL(str(value)) } catch { throw new Error('静态资源 URL 无效') }
  if (parsed.protocol !== 'https:') throw new Error('只缓存 HTTPS 静态资源')
  if (parsed.username !== '' || parsed.password !== '') throw new Error('静态资源 URL 不能包含凭据')
  parsed.hash = ''
  return parsed.href
}

function supportedMediaType(value) {
  const type = str(value).split(';')[0].trim().toLowerCase()
  return /^(text\/|image\/|audio\/|video\/|font\/)/.test(type)
    || /^(application\/(javascript|json|ld\+json|wasm|xml|octet-stream|font-woff|font-woff2|vnd\.ms-fontobject)|application\/.+\+xml)$/.test(type)
}

function fallbackMediaType(url) {
  const extension = path.extname(new URL(url).pathname).toLowerCase()
  return ({
    '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.htm': 'text/html', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm'
  })[extension] || 'application/octet-stream'
}

function localResourceUrl(url) {
  return '/api/dsh-tavern/static-assets?url=' + encodeURIComponent(url)
}

function absoluteCacheUrl(specifier, baseUrl) {
  return localResourceUrl(new URL(specifier, baseUrl).href)
}

export function rewriteCachedModuleImports(source, baseUrl) {
  const rewrite = function (_match, prefix, quote, specifier) {
    if (!specifier.startsWith('/') && !/^https:\/\//i.test(specifier)) return _match
    const absolute = new URL(specifier, baseUrl).href
    return prefix + quote + localResourceUrl(absolute) + quote
  }
  return projectTavernHostScript(str(source))
    .replace(/(\bfrom\s*|\bimport\s*)(["'])(\/[^"']+|https:\/\/[^"']+)\2/g, rewrite)
    .replace(/(\bimport\s*\(\s*)(["'])(\/[^"']+|https:\/\/[^"']+)\2/g, rewrite)
}

function rewriteStylesheetUrls(source, baseUrl) {
  const urls = str(source).replace(/(url\(\s*)(["']?)([^"')\s]+)\2(\s*\))/gi, function (_match, prefix, quote, specifier, suffix) {
    if (/^(?:data:|blob:|#|var\()/i.test(specifier) || /^https?:/i.test(specifier) && !/^https:/i.test(specifier)) return _match
    return prefix + quote + absoluteCacheUrl(specifier, baseUrl) + quote + suffix
  })
  return urls.replace(/(@import\s+)(["'])([^"']+)\2/gi, function (_match, prefix, quote, specifier) {
    if (/^(?:data:|blob:|#)/i.test(specifier) || /^https?:/i.test(specifier) && !/^https:/i.test(specifier)) return _match
    return prefix + quote + absoluteCacheUrl(specifier, baseUrl) + quote
  })
}

function rewriteHtmlResourceAttributes(source, baseUrl) {
  const rewritten = str(source)
    .replace(/(\b(?:src|poster)\s*=\s*)(["'])(\/[^"']+|https:\/\/[^"']+)\2/gi, function (_match, prefix, quote, specifier) {
      return prefix + quote + absoluteCacheUrl(specifier, baseUrl) + quote
    })
    .replace(/(<link\b[^>]*\bhref\s*=\s*)(["'])(\/[^"']+|https:\/\/[^"']+)\2/gi, function (_match, prefix, quote, specifier) {
      return prefix + quote + absoluteCacheUrl(specifier, baseUrl) + quote
    })
    .replace(/(\s(?:src|poster)\s*=\s*)(\/[^\s"'`<>]+|https:\/\/[^\s"'`<>]+)/gi, function (_match, prefix, specifier) {
      return prefix + '"' + absoluteCacheUrl(specifier, baseUrl) + '"'
    })
    .replace(/(<link\b[^>]*\shref\s*=\s*)(\/[^\s"'`<>]+|https:\/\/[^\s"'`<>]+)/gi, function (_match, prefix, specifier) {
      return prefix + '"' + absoluteCacheUrl(specifier, baseUrl) + '"'
    })
  return rewritten.replace(/<(?:video|audio|source)\b[^>]*>/gi, function (tag) {
    return tag.replace(/(\ssrc\s*=\s*)(["'])(\/api\/dsh-tavern\/static-assets\?url=([^"']+))\2/gi, function (_match, prefix, quote, proxy, url) {
      return prefix + quote + decodeURIComponent(url) + quote
    })
  })
}

function rewriteHtmlStyles(source, baseUrl) {
  return str(source)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, function (_match, opening, css, closing) {
      return opening + rewriteStylesheetUrls(css, baseUrl) + closing
    })
    .replace(/(\bstyle\s*=\s*)(["'])([^"']*)\2/gi, function (_match, prefix, quote, css) {
      return prefix + quote + rewriteStylesheetUrls(css, baseUrl) + quote
    })
}

function rewriteHtmlDocumentResources(source, baseUrl) {
  const scripts = []
  let marker = '__DSH_TAVERN_SCRIPT_'
  while (str(source).includes(marker)) marker = '_' + marker
  const markup = str(source).replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, function (_match, opening, javascript, closing) {
    const index = scripts.length
    scripts.push(rewriteHtmlResourceAttributes(opening, baseUrl) + rewriteCachedModuleImports(javascript, baseUrl) + closing)
    return marker + index + '__'
  })
  const rewritten = rewriteHtmlStyles(rewriteHtmlResourceAttributes(markup, baseUrl), baseUrl)
  return rewritten.replace(new RegExp(marker + '(\\d+)__', 'g'), function (_match, index) {
    return scripts[Number(index)] || ''
  })
}

export function projectCachedResourceBody(asset) {
  let mediaType = str(asset && asset.mediaType).toLowerCase()
  let extension = ''
  try { extension = path.extname(new URL(asset.finalUrl || asset.url).pathname).toLowerCase() } catch {}
  if (mediaType === 'text/plain' && (extension === '.js' || extension === '.mjs')) mediaType = 'application/javascript'
  if (mediaType === 'text/plain' && extension === '.css') mediaType = 'text/css'
  if (mediaType === 'text/plain' && (extension === '.html' || extension === '.htm')) mediaType = 'text/html'
  const body = Buffer.isBuffer(asset && asset.body) ? asset.body : Buffer.from(asset && asset.body || '')
  if (mediaType === 'application/javascript' || mediaType === 'text/javascript') {
    return Buffer.from(rewriteCachedModuleImports(body.toString('utf8'), asset.finalUrl || asset.url), 'utf8')
  }
  if (mediaType === 'text/css') {
    return Buffer.from(rewriteStylesheetUrls(body.toString('utf8'), asset.finalUrl || asset.url), 'utf8')
  }
  if (mediaType === 'text/html' || mediaType === 'image/svg+xml') {
    const baseUrl = asset.finalUrl || asset.url
    return Buffer.from(rewriteHtmlDocumentResources(body.toString('utf8'), baseUrl), 'utf8')
  }
  return body
}

async function quietlyDelete(file) {
  try { await unlink(file) } catch {}
}

export function createTavernStaticResourceCache(options = {}) {
  const rootDir = path.resolve(str(options.rootDir) || '.dsh-tavern-static-assets')
  const request = options.fetch || globalThis.fetch
  const maxEntryBytes = Math.max(1, Number(options.maxEntryBytes) || DEFAULT_MAX_ENTRY_BYTES)
  const maxTotalBytes = Math.max(maxEntryBytes, Number(options.maxTotalBytes) || DEFAULT_MAX_TOTAL_BYTES)
  const verifyHostname = typeof options.verifyHostname === 'function' ? options.verifyHostname : async function () {}
  const inflight = new Map()

  function paths(url) {
    const key = cacheKey(url)
    return { key, body: path.join(rootDir, key + '.body'), metadata: path.join(rootDir, key + '.json') }
  }

  async function read(url) {
    const files = paths(url)
    try {
      const metadata = JSON.parse(await readFile(files.metadata, 'utf8'))
      if (metadata.version !== CACHE_VERSION || metadata.url !== url) return null
      const body = await readFile(files.body)
      if (body.length !== metadata.bytes || createHash('sha256').update(body).digest('hex') !== metadata.contentHash) return null
      const now = new Date()
      void Promise.allSettled([utimes(files.body, now, now), utimes(files.metadata, now, now)])
      return { url, finalUrl: metadata.finalUrl || url, body, mediaType: metadata.mediaType, bytes: body.length, cachedAt: metadata.cachedAt, cache: 'hit' }
    } catch {
      return null
    }
  }

  async function trim() {
    let entries
    try { entries = (await readdir(rootDir)).filter(function (name) { return name.endsWith('.body') }) } catch { return }
    const rows = []
    let total = 0
    for (const name of entries) {
      try {
        const info = await stat(path.join(rootDir, name))
        rows.push({ name, size: info.size, mtimeMs: info.mtimeMs })
        total += info.size
      } catch {}
    }
    rows.sort(function (left, right) { return left.mtimeMs - right.mtimeMs })
    for (const row of rows) {
      if (total <= maxTotalBytes) break
      const key = row.name.slice(0, -'.body'.length)
      await Promise.all([quietlyDelete(path.join(rootDir, row.name)), quietlyDelete(path.join(rootDir, key + '.json'))])
      total -= row.size
    }
  }

  async function download(url) {
    if (typeof request !== 'function') throw new Error('当前运行环境不能下载静态资源')
    let currentUrl = url
    let response
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      await verifyHostname(currentUrl)
      response = await request(currentUrl, {
        headers: { Accept: '*/*', 'User-Agent': 'dsh-tavern-static-cache' },
        redirect: 'manual',
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(30000) : undefined
      })
      if (!response || ![301, 302, 303, 307, 308].includes(Number(response.status))) break
      const location = str(response.headers && response.headers.get && response.headers.get('location'))
      if (location === '') throw new Error('静态资源重定向缺少目标地址')
      currentUrl = normalizeCacheableResourceUrl(new URL(location, currentUrl).href)
      if (redirectCount === 5) throw new Error('静态资源重定向次数过多')
    }
    if (!response || response.ok !== true) throw new Error('静态资源下载失败（HTTP ' + str(response && response.status) + '）')
    const finalUrl = normalizeCacheableResourceUrl(response.url || currentUrl)
    const declaredBytes = Number(response.headers && response.headers.get && response.headers.get('content-length')) || 0
    if (declaredBytes > maxEntryBytes) throw new Error('静态资源超过单文件缓存上限')
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length > maxEntryBytes) throw new Error('静态资源超过单文件缓存上限')
    const mediaType = str(response.headers && response.headers.get && response.headers.get('content-type')).split(';')[0].trim().toLowerCase() || fallbackMediaType(finalUrl)
    if (!supportedMediaType(mediaType)) throw new Error('不支持缓存的静态资源类型: ' + mediaType)
    await mkdir(rootDir, { recursive: true })
    const files = paths(url)
    const suffix = '.' + process.pid + '.' + Date.now()
    const metadata = {
      version: CACHE_VERSION,
      url,
      finalUrl,
      mediaType,
      bytes: body.length,
      contentHash: createHash('sha256').update(body).digest('hex'),
      cachedAt: Date.now()
    }
    await writeFile(files.body + suffix, body)
    await writeFile(files.metadata + suffix, JSON.stringify(metadata), 'utf8')
    await rename(files.body + suffix, files.body)
    await rename(files.metadata + suffix, files.metadata)
    await trim()
    return { url, finalUrl, body, mediaType, bytes: body.length, cachedAt: metadata.cachedAt, cache: 'miss' }
  }

  async function get(value) {
    const url = normalizeCacheableResourceUrl(value)
    const cached = await read(url)
    if (cached) return cached
    if (inflight.has(url)) return await inflight.get(url)
    const pending = download(url).finally(function () { inflight.delete(url) })
    inflight.set(url, pending)
    return await pending
  }

  async function warm(urls) {
    return await Promise.allSettled(Array.from(new Set(urls || [])).map(get))
  }

  return Object.freeze({ get, read, warm, rootDir })
}
