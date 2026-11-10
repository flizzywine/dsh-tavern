import path from 'node:path'
import { existingTransferFolder, folderBytes, folderZipName, importFolderZip, namedFolderBase, packFolderZip, readFolderFiles } from './transfer-folder.js'

// 导出/导入里的插件子模块：只负责 zip 与文件读写，manifest 由调用方自己管。
function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function fail(message) {
  throw new Error(message)
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
      const dir = existingTransferFolder(pluginsDir, folder, '插件')
      const known = plugins.find(plugin => str(plugin && plugin.folder) === folder)
      const title = str(known && known.name) || folder
      const content = packFolderZip(await readFolderFiles(dir), { kind: '插件', title })
      items.push({ key: folder, title, fileName: folderZipName(folder), content })
    }
    return items
  }

  async function importOne(payload) {
    const { name: folder, ...result } = await importFolderZip(pluginsDir, payload, {
      label: '插件包', baseName: (key, title) => namedFolderBase(str(key) || str(title), '插件'), suffixed: (base, index) => base + ' (' + index + ')'
    })
    return { folder, ...result }
  }

  return Object.freeze({ list, collect, importOne })
}
