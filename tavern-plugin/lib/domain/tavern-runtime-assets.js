import { readFile } from 'node:fs/promises'

export const TAVERN_RUNTIME_ASSET_PREFIX = '/api/dsh-tavern/vendor/runtime-assets/'

const assetRoot = new URL('../vendor/runtime-assets/', import.meta.url)
const mediaTypes = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2'
})

/** Serve only packaged browser runtime files; arbitrary card assets use the separate remote cache. */
export async function readTavernRuntimeAsset(pathname) {
  const value = String(pathname || '')
  if (!value.startsWith(TAVERN_RUNTIME_ASSET_PREFIX)) return undefined
  const relative = value.slice(TAVERN_RUNTIME_ASSET_PREFIX.length)
  if (!/^[a-zA-Z0-9@._/-]+$/.test(relative) || relative.includes('..') || relative.startsWith('/')) throw new Error('运行时资源路径无效')
  const extension = relative.slice(relative.lastIndexOf('.')).toLowerCase()
  const mediaType = mediaTypes[extension]
  if (!mediaType) throw new Error('不支持的运行时资源类型')
  const body = await readFile(new URL(relative, assetRoot))
  return Object.freeze({ body, mediaType })
}
