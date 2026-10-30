import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveTavernDataRoot } from './tavern-data.js'
import { fileURLToPath } from 'node:url'
import { validateRuntimeImport, publishRuntimeFile } from '../runtime-import.js'

export const TAVERN_RUNTIME_ASSET_PREFIX = '/api/dsh-tavern/vendor/runtime-assets/'

const assetRoot = new URL('../vendor/runtime-assets/', import.meta.url)
const mediaTypes = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ogg': 'audio/ogg', // built-in stage sound effects
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp' // galgame stage ornaments
})

/** Serve only packaged browser runtime files; arbitrary card assets use the separate remote cache. */
export function locateTavernRuntimeAsset(pathname, root = assetRoot) {
  const value = String(pathname || '')
  if (!value.startsWith(TAVERN_RUNTIME_ASSET_PREFIX)) return undefined
  const relative = decodeURIComponent(value.slice(TAVERN_RUNTIME_ASSET_PREFIX.length))
  if (!/^[a-zA-Z0-9@._/-]+$/.test(relative) || relative.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw new Error('运行时资源路径无效')
  const extension = relative.slice(relative.lastIndexOf('.')).toLowerCase()
  const mediaType = mediaTypes[extension]
  if (!mediaType) throw new Error('不支持的运行时资源类型')
  return Object.freeze({ file: new URL(relative, root), mediaType })
}
// the Spine runtime is not redistributable, so public builds ship without it.
// Its presence is a capability (like the Cubism Core); Spine outfits then fall down the appearance ladder.
const spineTarget = new URL('spine/pixi-spine.js', assetRoot)
const exists = target => stat(target).then(info => info.isFile(), () => false)
const spineImportTarget = () => path.join(resolveTavernDataRoot(), 'runtime-imports/spine/pixi-spine.js')
export async function spineRuntimeAvailable(target) {
  return target ? exists(target) : await exists(spineTarget) || await exists(spineImportTarget())
}
export async function spineRuntimeStatus(target) {
  const installed = await spineRuntimeAvailable(target)
  return { installed, runtime: installed ? TAVERN_RUNTIME_ASSET_PREFIX + 'spine/pixi-spine.js' : '',
    downloadUrl: 'https://www.npmjs.com/package/pixi-spine/v/3.1.2',
    licenseUrl: 'https://esotericsoftware.com/spine-runtimes-license',
    purchaseUrl: 'https://esotericsoftware.com/spine-purchase',
    importSupported: true }
}
export async function importSpineRuntime(input, target) {
  const body = validateRuntimeImport(input, { names: ['pixi-spine.umd.js', 'pixi-spine.js'],
    markers: ['PIXI.spine', 'SpineParser', 'TextureAtlas', 'SkeletonBinary', 'AnimationState', 'Spine'], label: 'pixi-spine UMD' })
  if (!await spineRuntimeAvailable(target)) {
    const destination = target || spineImportTarget()
    await publishRuntimeFile(destination instanceof URL ? fileURLToPath(destination) : destination, body)
  }
  return spineRuntimeStatus(target)
}
// Keep stable script URLs for old clients; private vendor files win, imports live only in data.
export async function resolveTavernRuntimeAsset(pathname, dataRoot = resolveTavernDataRoot(), vendorRoot = assetRoot) {
  const asset = locateTavernRuntimeAsset(pathname, vendorRoot)
  if (!asset) return asset
  const relative = pathname.slice(TAVERN_RUNTIME_ASSET_PREFIX.length)
  const imports = {
    'spine/pixi-spine.js': 'runtime-imports/spine/pixi-spine.js'
  }
  if (!imports[relative] || await exists(asset.file)) return asset
  return { ...asset, file: path.join(dataRoot, imports[relative]) }
}
export async function readTavernRuntimeAsset(pathname) {
  const asset = await resolveTavernRuntimeAsset(pathname)
  if (!asset) return undefined
  return Object.freeze({ body: await readFile(asset.file), mediaType: asset.mediaType })
}
