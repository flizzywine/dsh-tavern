import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { renderPngThumbnail } from './png-thumbnail.js'

const CARD_EXTENSIONS = new Set(['.json', '.png', '.charx'])
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024
const DEFAULT_THUMBNAIL_CACHE = 240

function defaultRoots() {
  return [
    { id: 'download', label: '手机 Download', path: '/sdcard/Download' },
    { id: 'dsha-download', label: 'DSHA 下载', path: '/sdcard/Download/DSHA/下载' }
  ]
}

function encodeName(name) {
  return Buffer.from(name, 'utf8').toString('base64url')
}

function decodeName(value) {
  try { return Buffer.from(value, 'base64url').toString('utf8') } catch { throw new Error('无效的手机文件标识') }
}

function pngPayload(buffer, name) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length <= signature.length || !buffer.subarray(0, signature.length).equals(signature)) throw new Error('无法识别的角色卡 PNG')
  let offset = signature.length
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buffer.length) throw new Error('人物卡 PNG 数据损坏')
    if (type === 'tEXt') {
      const separator = buffer.indexOf(0, dataStart)
      if (separator >= dataStart && separator < dataEnd) {
        const keyword = buffer.toString('ascii', dataStart, separator)
        if (keyword === 'chara' || keyword === 'ccv3') {
          return { kind: 'png', name, b64: buffer.toString('latin1', separator + 1, dataEnd), fileB64: buffer.toString('base64') }
        }
      }
    }
    if (type === 'IEND') break
    offset = dataEnd + 4
  }
  throw new Error('PNG 中未找到角色卡数据（chara/ccv3 文本块）')
}

export function createMobileCardImport(options = {}) {
  const enabled = options.runtimeHost === 'android'
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : DEFAULT_MAX_BYTES
  const roots = (options.roots || defaultRoots()).map(function (root) {
    return { id: String(root.id), label: String(root.label), path: path.resolve(String(root.path)) }
  })
  const rootById = new Map(roots.map(function (root) { return [root.id, root] }))
  const thumbnailCacheLimit = Number.isFinite(options.thumbnailCache) && options.thumbnailCache > 0 ? Math.floor(options.thumbnailCache) : DEFAULT_THUMBNAIL_CACHE
  const thumbnailCache = new Map()

  async function inspect(root, name) {
    if (path.basename(name) !== name || !CARD_EXTENSIONS.has(path.extname(name).toLowerCase())) return null
    const target = path.join(root.path, name)
    let info
    try { info = await lstat(target) } catch { return null }
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maxBytes) return null
    return { id: root.id + ':' + encodeName(name), name, directory: root.label, size: info.size, modifiedAt: info.mtimeMs }
  }

  async function list() {
    if (!enabled) return { available: false, files: [] }
    const files = []
    const seen = new Set()
    let readableRoots = 0
    for (const root of roots) {
      let names
      try { names = await readdir(root.path) } catch { continue }
      readableRoots += 1
      for (const name of names) {
        const item = await inspect(root, name)
        if (item && !seen.has(item.id)) { seen.add(item.id); files.push(item) }
      }
    }
    files.sort(function (left, right) { return right.modifiedAt - left.modifiedAt || left.name.localeCompare(right.name, 'zh-CN') })
    // No cap: the dialog lists the whole download folder and loads thumbnails lazily.
    return { available: true, storageAccessible: readableRoots > 0, total: files.length, files }
  }

  async function read(id) {
    if (!enabled) throw new Error('当前宿主不允许从手机下载目录导入')
    const entry = await resolve(id)
    const buffer = await readFile(path.join(entry.root.path, entry.item.name))
    const extension = path.extname(entry.item.name).toLowerCase()
    if (extension === '.charx') return { kind: 'charx', name: entry.item.name, fileB64: buffer.toString('base64') }
    return extension === '.json'
      ? { kind: 'text', name: entry.item.name, text: buffer.toString('utf8') }
      : pngPayload(buffer, entry.item.name)
  }

  async function resolve(id) {
    const separator = typeof id === 'string' ? id.indexOf(':') : -1
    if (separator <= 0) throw new Error('无效的手机文件标识')
    const root = rootById.get(id.slice(0, separator))
    const name = decodeName(id.slice(separator + 1))
    if (!root || path.basename(name) !== name || !CARD_EXTENSIONS.has(path.extname(name).toLowerCase())) throw new Error('不允许读取这个手机文件')
    const item = await inspect(root, name)
    if (!item || item.id !== id) throw new Error('手机文件不存在、过大或不允许读取')
    return { root, item }
  }

  /**
   * 生成下载目录里某个 PNG 的小尺寸预览图。
   * 返回 undefined 表示这张卡没有可用缩略图（JSON、图片无法识别或超出处理范围），调用方按占位处理。
   */
  async function thumbnail(id) {
    if (!enabled) throw new Error('当前宿主不允许从手机下载目录导入')
    const entry = await resolve(id)
    if (path.extname(entry.item.name).toLowerCase() !== '.png') return undefined
    const key = entry.item.id + ':' + entry.item.size + ':' + entry.item.modifiedAt
    if (thumbnailCache.has(key)) return thumbnailCache.get(key)
    let thumb
    try {
      const buffer = await readFile(path.join(entry.root.path, entry.item.name))
      thumb = renderPngThumbnail(buffer)
    } catch {
      thumb = undefined
    }
    thumbnailCache.set(key, thumb)
    while (thumbnailCache.size > thumbnailCacheLimit) thumbnailCache.delete(thumbnailCache.keys().next().value)
    return thumb
  }

  return Object.freeze({ list, read, thumbnail })
}
