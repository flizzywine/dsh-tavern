import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const CARD_EXTENSIONS = new Set(['.json', '.png'])
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024

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
    return { available: true, storageAccessible: readableRoots > 0, files: files.slice(0, 100) }
  }

  async function read(id) {
    if (!enabled) throw new Error('当前宿主不允许从手机下载目录导入')
    const separator = typeof id === 'string' ? id.indexOf(':') : -1
    if (separator <= 0) throw new Error('无效的手机文件标识')
    const root = rootById.get(id.slice(0, separator))
    const name = decodeName(id.slice(separator + 1))
    if (!root || path.basename(name) !== name || !CARD_EXTENSIONS.has(path.extname(name).toLowerCase())) throw new Error('不允许读取这个手机文件')
    const item = await inspect(root, name)
    if (!item || item.id !== id) throw new Error('手机文件不存在、过大或不允许读取')
    const buffer = await readFile(path.join(root.path, name))
    return path.extname(name).toLowerCase() === '.json'
      ? { kind: 'text', name, text: buffer.toString('utf8') }
      : pngPayload(buffer, name)
  }

  return Object.freeze({ list, read })
}
