import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { readZipEntries, writeZipEntries } from './zip-entries.js'

// 导出/导入里的素材包子模块：一个舞台素材包 = assetRoot/packs/<id>/ 下的 manifest.json 与
// media/、bundles/、credits/ 文件。整包打成一个 zip；导入仍交给素材库的 createPack + patchPack，
// 由它自己校验媒体、重新计算 files/contentHash。本模块不解释包内容，只搬运字节。
const PACK_FILE = 'pack.json'
const PACK_SPEC = 'dsh-tavern.transfer.asset-pack'
const PACK_VERSION = 1
const FILES_PREFIX = 'files/'
const MAX_ZIP_BYTES = 512 * 1024 * 1024
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
// 一个素材包是一整项，导入时要能塞进一份 .dshtransfer 里（导入接口按 128 MB 收包）。
// 素材包里的媒体本来就不压缩，再包一层也不会变小，超了就预先挡住，不留一个导不回去的包。
const BUNDLE_ITEM_LIMIT = 96 * 1024 * 1024

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function fail(message) {
  throw new Error(message)
}

/** 包内文件路径：单层相对路径，不许绝对路径、反斜杠、. / .. 段。 */
function relativePathOf(value) {
  const raw = str(value).replace(/\\/g, '/')
  if (!raw || raw.includes('\u0000')) fail('素材包里有非法路径：' + raw.slice(0, 120))
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) fail('素材包里有绝对路径：' + raw.slice(0, 120))
  const parts = raw.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) fail('素材包里有越界路径：' + raw.slice(0, 120))
  return parts.join('/')
}

function entryCount(manifest) {
  const counts = new Map()
  for (const asset of manifest.assets || []) counts.set(asset.kind, (counts.get(asset.kind) || 0) + 1)
  const labels = { backgrounds: '背景', music: '音乐', sfx: '音效', ambience: '环境音', props: '物品', entrances: '入场', skins: '皮肤' }
  return [...counts.entries()].map(([kind, count]) => (labels[kind] || kind) + ' ' + count).join(' · ')
}

/**
 * 素材库的导出/导入：`root` 是 profile 的素材根目录（真实实现 `<profile>/asset-packs`），
 * `library` 是 asset-library/pack-v2 的服务实例。列表只读，导出只读盘上已发布的包目录。
 */
export function createTransferAssets({ root, library } = {}) {
  if (!root) fail('缺少素材根目录')

  function packDir(id) {
    const name = str(id)
    if (!name || name !== path.basename(name) || name === '..' || name === '.') fail('素材包不存在：' + name)
    return path.join(root, 'packs', name)
  }

  async function list() {
    const rows = []
    for (const entry of await library.listPacks()) {
      // 坏掉的单个包在列表里只是一行错误，不影响其他包；这里跳过它。
      if (!entry || entry.error || !entry.manifest) continue
      const files = entry.manifest.files || []
      const bytes = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0) + Buffer.byteLength(JSON.stringify(entry.manifest))
      rows.push({ key: entry.manifest.id, title: str(entry.manifest.name) || entry.manifest.id,
        meta: [entryCount(entry.manifest), files.length + ' 个文件'].filter(Boolean).join(' · '), bytes })
    }
    return rows.sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
  }

  async function collect(ids) {
    const wanted = (Array.isArray(ids) ? ids : [ids]).map(str).filter(Boolean)
    const items = []
    for (const id of wanted) {
      const pack = await library.getPackSnapshot({ packId: id }).catch(() => null)
      if (!pack || !pack.manifest) fail('素材包不存在：' + id)
      const { manifest } = pack
      const document = {
        spec: PACK_SPEC,
        version: PACK_VERSION,
        name: str(manifest.name),
        ...(manifest.description === undefined ? {} : { description: manifest.description }),
        assets: manifest.assets || [],
        figures: manifest.figures || [],
        sprites: manifest.sprites || {},
        bundles: manifest.bundles || {},
        blobs: manifest.blobs || {}
      }
      const dir = packDir(id)
      const title = document.name || id
      const entries = [{ path: PACK_FILE, content: JSON.stringify(document, null, 2) + '\n' }]
      let bytes = 0
      for (const file of manifest.files || []) {
        const relative = relativePathOf(file.path)
        let content
        try { content = await readFile(path.join(dir, ...relative.split('/'))) }
        catch { fail('素材包「' + title + '」缺少文件：' + relative) }
        // 包在导出中途被替换时，字节数会与清单不符：宁可不带，也不产出半份包。
        if (Number(file.size) > 0 && content.length !== Number(file.size)) fail('素材包「' + title + '」的文件在导出过程中变了：' + relative)
        bytes += content.length
        if (bytes > BUNDLE_ITEM_LIMIT) fail('素材包「' + title + '」约 ' + Math.round(bytes / 1048576) + ' MB，超过单个导出项的上限（96 MB）；先移除大文件，或把包拆小再导出')
        entries.push({ path: FILES_PREFIX + relative, content })
      }
      if (entries.length === 1) fail('素材包「' + title + '」是空的')
      const content = writeZipEntries(entries, { label: '素材包', maxArchiveBytes: MAX_ZIP_BYTES, maxExpandedBytes: MAX_EXPANDED_BYTES })
      items.push({ key: id, title, fileName: id + '.zip', content })
    }
    return items
  }

  /** 导入一个包：素材库新建 id，逐字段写回作者数据与文件；失败时删掉刚建的包。 */
  async function importOne(payload) {
    const { content } = payload || {}
    if (content === undefined || content === null) fail('素材包内容为空')
    const entries = readZipEntries(content, { label: '素材包', maxArchiveBytes: MAX_ZIP_BYTES, maxExpandedBytes: MAX_EXPANDED_BYTES })
    const raw = entries.get(PACK_FILE)
    if (raw === undefined) fail('素材包里没有 pack.json，可能不是酒馆的素材包')
    let document
    try { document = JSON.parse(raw.toString('utf8')) } catch { fail('素材包的 pack.json 不是有效的 JSON') }
    if (!document || document.spec !== PACK_SPEC) fail('不是酒馆素材包（spec 不符）')
    if (Number(document.version) !== PACK_VERSION) fail('不支持的素材包版本：' + str(document.version))
    if (!Array.isArray(document.assets)) fail('素材包内容无效')
    const files = new Map()
    for (const [name, data] of entries) {
      if (name === PACK_FILE) continue
      if (!name.startsWith(FILES_PREFIX)) fail('素材包里有意外文件：' + name)
      files.set(relativePathOf(name.slice(FILES_PREFIX.length)), data)
    }
    if (!files.size) fail('素材包里没有文件')
    const name = str(payload && payload.name) || str(document.name) || '导入的素材包'
    const created = await library.createPack({ name, expectedRevision: null })
    const packId = created.snapshot.manifest.id
    const revision = created.snapshot.revision
    const patch = { name, assets: document.assets, figures: document.figures || [], sprites: document.sprites || {}, bundles: document.bundles || {}, blobs: document.blobs || {} }
    if (document.description !== undefined) patch.description = document.description
    try {
      const saved = await library.patchPack({ packId, expectedRevision: revision, patch, fileUpdates: files })
      return { id: saved.snapshot.manifest.id, name: saved.snapshot.manifest.name }
    } catch (error) {
      // 校验失败的包不该留下一个空壳占着列表。
      await library.removePack({ packId, expectedRevision: revision }).catch(() => {})
      throw error
    }
  }

  return Object.freeze({ list, collect, importOne })
}
