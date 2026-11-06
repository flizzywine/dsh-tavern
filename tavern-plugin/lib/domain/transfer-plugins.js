import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readZipEntries, writeZipEntries } from './zip-entries.js'
import { folderHoldsZip } from './transfer-folder-match.js'

// 导出/导入里的插件子模块：只负责 zip 与文件读写，manifest 由调用方自己管。
const MAX_ZIP_BYTES = 40 * 1024 * 1024
const MAX_RENAME_ATTEMPTS = 60
const ILLEGAL_FILE_CHARS = /[\\/:*?"<>|]/g
const ILLEGAL_FOLDER_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g
// 插件依赖（node_modules）是插件的一部分，要带进包里；版本库目录不打包。
const SKIP_DIRECTORIES = new Set(['.git'])

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

/** 打包用的相对路径：统一 `/`，顺序稳定。 */
async function readFolderFiles(dir, prefix = '') {
  const entries = []
  let items
  try { items = await readdir(dir, { withFileTypes: true }) }
  catch (error) { if (error.code === 'ENOENT') return entries; throw error }
  for (const item of items.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    const relative = prefix ? prefix + '/' + item.name : item.name
    const absolute = path.join(dir, item.name)
    if (item.isDirectory()) {
      if (SKIP_DIRECTORIES.has(item.name)) continue
      entries.push(...await readFolderFiles(absolute, relative))
      continue
    }
    let content
    try { content = await readFile(absolute) } catch { continue }
    entries.push({ path: relative, content })
  }
  return entries
}

/** 插件文件夹的字节数，统计口径与打包一致（跳过 .git）。 */
async function folderBytes(dir) {
  let total = 0
  let items
  try { items = await readdir(dir, { withFileTypes: true }) }
  catch { return 0 }
  for (const item of items) {
    if (item.isDirectory()) {
      if (SKIP_DIRECTORIES.has(item.name)) continue
      total += await folderBytes(path.join(dir, item.name))
      continue
    }
    try { total += (await stat(path.join(dir, item.name))).size } catch {}
  }
  return total
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

/** 解包路径校验：拒绝 ..、绝对路径和反斜杠越界，再交给 path.join 落盘。 */
function safeEntryPath(name) {
  const raw = str(name).replace(/\\/g, '/').normalize('NFC')
  if (!raw || raw.includes('\u0000')) fail('插件包里有非法路径：' + raw)
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) fail('插件包里有绝对路径：' + raw)
  if (raw.split('/').some(part => part === '..')) fail('插件包里有越界路径：' + raw)
  const normalized = path.posix.normalize(raw)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.endsWith('/')) fail('插件包里有非法路径：' + raw)
  return normalized
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
      const content = writeZipEntries(await readFolderFiles(dir), { label: '插件包' })
      if (content.length > MAX_ZIP_BYTES) fail('插件「' + title + '」超过 40 MB，暂不能进包')
      items.push({ key: folder, title, fileName: fileNameOf(folder), content })
    }
    return items
  }

  async function importOne(payload) {
    const { key, title, content } = payload || {}
    if (content === undefined || content === null) fail('插件包内容为空')
    const entries = readZipEntries(content, { label: '插件包' })
    const base = folderNameOf(key, title)
    let folder = base
    // 同一个包再来一次：目录里已经就是这份内容，直接认它，不再造一个 (2)。
    if (existsSync(path.join(pluginsDir, folder)) && await folderHoldsZip(path.join(pluginsDir, folder), entries).catch(() => false)) {
      return { folder, reused: true }
    }
    if (existsSync(path.join(pluginsDir, folder))) {
      folder = ''
      for (let index = 2; index <= MAX_RENAME_ATTEMPTS; index += 1) {
        const candidate = base + ' (' + index + ')'
        if (!existsSync(path.join(pluginsDir, candidate))) { folder = candidate; break }
      }
      if (!folder) folder = base + ' (' + Date.now() + ')'
    }
    // 先校验完所有路径再落盘，越界条目不会留下半个插件。
    const target = path.join(pluginsDir, folder)
    const files = []
    for (const [name, data] of entries) {
      const relative = safeEntryPath(name)
      const file = path.join(target, ...relative.split('/'))
      if (!file.startsWith(target + path.sep)) fail('插件包里有越界路径：' + name)
      files.push([file, data])
    }
    // 只写文件：不写启用标记、不执行插件脚本，加载仍交给 plugins/ 目录同步。
    for (const [file, data] of files) {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, data)
    }
    return { folder }
  }

  return Object.freeze({ list, collect, importOne })
}
