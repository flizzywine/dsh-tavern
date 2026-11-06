import { normalizeResourcePath, resourceKind } from './file-resources.js'
import { scriptChunkLayout } from './script-chunks.js'

// Script contents are immutable inputs; per-game progress lives in scriptState.
// Version checks use the durable store, including not-yet-promoted writes.
export function createScriptReader({ resources, version, maxBytes = 16 * 1024 * 1024 }) {
  const cache = new Map(), pending = new Map()
  let bytes = 0
  return async function readScript(value) {
    let path = value == null ? '' : String(value)
    if (!path) return undefined
    if (path.startsWith('cards/')) path = await resources.scriptForCard(path)
    if (!path) return undefined
    const kind = resourceKind(path)
    if (kind !== 'source' && kind !== 'script') throw new Error('剧本引用必须指向剧本文件')
    path = normalizeResourcePath(path, kind)
    const stamp = await version(path)
    const previous = cache.get(path)
    if (previous?.stamp === stamp) {
      cache.delete(path); cache.set(path, previous)
      return previous.script
    }
    if (previous) { bytes -= previous.bytes; cache.delete(path) }
    const key = JSON.stringify([path, stamp])
    if (pending.has(key)) return pending.get(key)
    const work = (async () => {
      const source = await resources.readText(path)
      if (source === undefined) return undefined
      const layout = scriptChunkLayout(source)
      for (const chunk of layout.chunks) Object.freeze(chunk)
      for (const item of Object.values(layout)) if (Array.isArray(item)) Object.freeze(item)
      const script = Object.freeze({ path, title: path.split('/').pop(), sourceChars: source.length, ...layout })
      const size = source.length * 4 + layout.chunks.length * 256
      if (size <= maxBytes && await version(path) === stamp) {
        if (cache.has(path)) { bytes -= cache.get(path).bytes; cache.delete(path) }
        while (cache.size && (cache.size >= 8 || bytes + size > maxBytes)) {
          const oldest = cache.keys().next().value
          bytes -= cache.get(oldest).bytes; cache.delete(oldest)
        }
        cache.set(path, { stamp, script, bytes: size }); bytes += size
      }
      return script
    })()
    pending.set(key, work)
    try { return await work } finally { if (pending.get(key) === work) pending.delete(key) }
  }
}
