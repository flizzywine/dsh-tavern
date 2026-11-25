import path from 'node:path'
import { existingTransferFolder, folderBytes, folderZipName, importFolderZip, namedFolderBase, packFolderZip, readFolderFiles } from './transfer-folder.js'
import { PLUGIN_ZIP_LIMITS } from './user-plugin-install.js'
import { readZipEntries } from './zip-entries.js'

// 内置插件随酒馆安装和更新：不进导出列表，导入包里遇到也跳过，免得每导一次多一份删不掉的「名字 (2)」。
const BUILTIN_IMAGE_PACKAGE = 'dsh-tavern-image'
const isBuiltinRow = plugin => plugin?.source?.kind === 'builtin'

function builtinPackageName(content) {
  let entries
  try { entries = readZipEntries(content, { label: '插件包', ...PLUGIN_ZIP_LIMITS }) } catch { return '' }
  const json = name => { try { return JSON.parse(entries.get(name).toString('utf8')) } catch { return null } }
  const name = str(json('package.json')?.name)
  return name && (json('.tavern-source.json')?.kind === 'builtin' || name === BUILTIN_IMAGE_PACKAGE) ? name : ''
}

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
      if (!folder || isBuiltinRow(plugin)) continue
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
      if (await folderBytes(dir) > PLUGIN_ZIP_LIMITS.maxExpandedBytes) {
        fail('插件「' + title + '」超过 ' + PLUGIN_ZIP_LIMITS.maxExpandedBytes / 1024 ** 2 + ' MiB')
      }
      const content = packFolderZip(await readFolderFiles(dir), { kind: '插件', title, limits: PLUGIN_ZIP_LIMITS })
      items.push({ key: folder, title, fileName: folderZipName(folder), content })
    }
    return items
  }

  async function importOne(payload) {
    const builtin = builtinPackageName(payload && payload.content)
    if (builtin) return { folder: builtin, reused: true, builtin: true }
    const { name: folder, ...result } = await importFolderZip(pluginsDir, payload, {
      label: '插件包', limits: PLUGIN_ZIP_LIMITS, baseName: (key, title) => namedFolderBase(str(key) || str(title), '插件'), suffixed: (base, index) => base + ' (' + index + ')'
    })
    return { folder, ...result }
  }

  return Object.freeze({ list, collect, importOne })
}
