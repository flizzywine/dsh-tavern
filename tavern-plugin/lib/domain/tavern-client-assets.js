import { readFile } from 'node:fs/promises'

export const TAVERN_CLIENT_ASSET_PREFIX = '/api/dsh-tavern/client-assets/'

const assets = Object.freeze({
  'tavern.css': Object.freeze({
    url: new URL('../client-assets/tavern.css', import.meta.url),
    mediaType: 'text/css; charset=utf-8'
  })
})

export async function readTavernClientAsset(pathname) {
  const value = String(pathname || '')
  if (!value.startsWith(TAVERN_CLIENT_ASSET_PREFIX)) return undefined
  const name = value.slice(TAVERN_CLIENT_ASSET_PREFIX.length)
  const asset = Object.hasOwn(assets, name) ? assets[name] : undefined
  if (asset === undefined) return undefined
  return Object.freeze({ body: await readFile(asset.url), mediaType: asset.mediaType })
}

// First-party executable chunks are registered by their owning plugin lifetime.
// Registrations name exact resources; a request never supplies a filesystem path.
export function createTavernClientAssets() {
  const registered = new Map()
  return Object.freeze({
    register(name, {read, mediaType}) {
      if (!/^[a-zA-Z0-9_-]+\.(?:mjs|js|css)$/.test(name) || Object.hasOwn(assets, name)) throw new Error('Invalid client asset name')
      if (registered.has(name)) throw new Error('Client asset already registered: ' + name)
      if (typeof read !== 'function' || !['text/javascript; charset=utf-8', 'text/css; charset=utf-8'].includes(mediaType)) throw new TypeError('Invalid client asset')
      const entry = {read, mediaType}
      registered.set(name, entry)
      return () => { if (registered.get(name) === entry) registered.delete(name) }
    },
    async read(pathname) {
      const value = String(pathname || '')
      if (!value.startsWith(TAVERN_CLIENT_ASSET_PREFIX)) return undefined
      const name = value.slice(TAVERN_CLIENT_ASSET_PREFIX.length)
      const entry = registered.get(name)
      if (!entry) return readTavernClientAsset(value)
      const body = await entry.read()
      if (registered.get(name) !== entry) return undefined
      return {body, mediaType:entry.mediaType}
    }
  })
}
