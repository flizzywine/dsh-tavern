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
  const asset = assets[name]
  if (asset === undefined) return undefined
  return Object.freeze({ body: await readFile(asset.url), mediaType: asset.mediaType })
}
