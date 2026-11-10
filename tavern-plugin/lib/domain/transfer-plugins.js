import { existsSync } from 'node:fs'
import path from 'node:path'
import { folderBytes, importFolderZip, packFolderZip, readFolderFiles } from './transfer-folder.js'

// 导出/导入里的插件子模块：只负责 zip 与文件读写，manifest 由调用方自己管。
const ILLEGAL_FILE_CHARS = /[\\/:*?"<>|]/g
const ILLEGAL_FOLDER_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function fail(message) {
  throw new Error(message)
}

/** 文件夹名只允许落在 pluginsDir 下一层；不存在则按插件管理里的说法报错。 */
function folderDir(pluginsDir, folder) {
  const name = str(folder)
  if (!name || name !== path.basename(name) || name === '..' || name === '.' || name.startsWith('.')) fail('插件不存在：' + name)
  const dir = path.join(pluginsDir, name)
  if (!existsSync(dir)) fail('插件不存在：' + name)
  return dir
}

/** 文件名里不允许出现 /\:*?"<>|，出现就换掉。 */
function fileNameOf(folder) {
  return str(folder).replace(ILLEGAL_FILE_CHARS, '_') + '.zip'
}

/** key 或标题 → 一个可用的文件夹名（单层，不带路径）。 */
function folderNameOf(key, title) {
  const raw = str(key) || str(title)
  const base = path.posix.basename(raw.replace(/\\/g, '/')).normalize('NFC')
  const name = base
    .replace(ILLEGAL_FOLDER_CHARS, '-')
    .replace(/^[-.\s]+|[-.\s]+$/g, '')
    .slice(0, 80)
  return name || '插件'
}

/**
 * deps.pluginsDir 是插件根目录（真实实现 userPluginInstaller.pluginsDir），
 * deps.listPlugins() 返回插件列表（真实实现 userPluginInstaller.list()）。
 */
export function createTransferPlugins(deps) {
  const { pluginsDir, listPlugins } = deps
  if (!pluginsDir) fail('缺少插件目录')

  async function installed() {
    try {
      const rows = await listPlugins()
      return Array.isArray(rows) ? rows : []
    } catch { return [] }
  }

  async function list() {
    const plugins = await installed()
    const rows = []
    for (const plugin of plugins) {
      const folder = str(plugin && plugin.folder)
      if (!folder) continue
      const title = str(plugin && plugin.name) || folder
      const version = str(plugin && plugin.version)
      const enabled = !(plugin && plugin.enabled === false)
      rows.push({
        key: folder,
        title,
        meta: [version, enabled ? '启用' : '停用'].filter(Boolean).join(' · '),
        bytes: await folderBytes(path.join(pluginsDir, folder))
      })
    }
    return rows
  }

  async function collect(folders) {
    const wanted = (Array.isArray(folders) ? folders : [folders]).map(str).filter(Boolean)
    const plugins = await installed()
    const items = []
    for (const folder of wanted) {
      const dir = folderDir(pluginsDir, folder)
      const known = plugins.find(plugin => str(plugin && plugin.folder) === folder)
      const title = str(known && known.name) || folder
      const content = packFolderZip(await readFolderFiles(dir), { kind: '插件', title })
      items.push({ key: folder, title, fileName: fileNameOf(folder), content })
    }
    return items
  }

  async function importOne(payload) {
    const { name: folder, ...result } = await importFolderZip(pluginsDir, payload, {
      label: '插件包', baseName: folderNameOf, suffixed: (base, index) => base + ' (' + index + ')'
    })
    return { folder, ...result }
  }

  return Object.freeze({ list, collect, importOne })
}
