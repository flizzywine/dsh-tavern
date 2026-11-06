import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'

export const FULL_PROMPT_TEMPLATE_ASSET_PREFIX = '/api/dsh-tavern/vendor/st-prompt-template/'
const root = new URL('../vendor/st-prompt-template/host-build/artifact/', import.meta.url)
const commit = 'd6f520d149aba146305b0b781ddd691d449c28d2'

async function fileVersion(url) {
  const value = await stat(url, { bigint: true })
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':')
}

export function createFullPromptTemplateAssetReader({ directory = root, read = readFile,
  version = read === readFile ? fileVersion : null, maxBytes = 32 * 1024 * 1024 } = {}) {
  let manifestCache
  const assets = new Map()
  let bytes = 0
  async function manifestAt(url) {
    const stamp = version ? await version(url) : null
    if (stamp !== null && manifestCache?.stamp === stamp) return manifestCache.value
    const value = JSON.parse(await read(url, 'utf8'))
    if (version && await version(url) === stamp) manifestCache = { stamp, value }
    return value
  }
  return async function readAsset(pathname) {
    if (!String(pathname).startsWith(FULL_PROMPT_TEMPLATE_ASSET_PREFIX)) return undefined
    const name = pathname.slice(FULL_PROMPT_TEMPLATE_ASSET_PREFIX.length)
    if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(name) || name.includes('..')) return undefined
    const manifest = await manifestAt(new URL('manifest.json', directory))
    if (manifest.upstreamCommit !== commit) throw new Error('模板运行时版本与宿主不一致')
    if (!Object.prototype.hasOwnProperty.call(manifest.files, name)) return undefined
    const mediaType = name.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.ttf') ? 'font/ttf' : name.endsWith('.txt') ? 'text/plain; charset=utf-8' : undefined
    if (!mediaType) return undefined
    const url = new URL(name, directory)
    const stamp = version ? await version(url) : null
    const expected = manifest.files[name]
    const cached = assets.get(name)
    if (stamp !== null && cached?.stamp === stamp && cached.sha === expected.sha256 && cached.asset.body.length === expected.bytes) {
      assets.delete(name); assets.set(name, cached)
      return cached.asset
    }
    if (cached) { bytes -= cached.asset.body.length; assets.delete(name) }
    const body = await read(url)
    const sha = createHash('sha256').update(body).digest('hex')
    if (sha !== manifest.files[name].sha256 || body.length !== manifest.files[name].bytes) throw new Error('模板运行时资源校验失败')
    const asset = { body, mediaType, etag: '"sha256-' + sha + '"' }
    if (version && body.length <= maxBytes && await version(url) === stamp) {
      if (assets.has(name)) { bytes -= assets.get(name).asset.body.length; assets.delete(name) }
      while (assets.size && bytes + body.length > maxBytes) {
        const key = assets.keys().next().value
        bytes -= assets.get(key).asset.body.length; assets.delete(key)
      }
      assets.set(name, { stamp, sha, asset }); bytes += body.length
    }
    return asset
  }
}
export const readFullPromptTemplateAsset = createFullPromptTemplateAssetReader()
