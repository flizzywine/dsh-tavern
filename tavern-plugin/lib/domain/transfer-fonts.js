import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readZipEntries, writeZipEntries } from './zip-entries.js'
import { folderHoldsZip } from './transfer-folder-match.js'

// 导出/导入里的字体子模块：一个自装字体族 = fontsDir 下一层文件夹，整目录打成一个 zip。
// 导入只落盘，不启用、不校验 face 明细；真正能不能用交给 font-library 读取时判断。
const MAX_ZIP_BYTES = 40 * 1024 * 1024
const MAX_RENAME_ATTEMPTS = 60
const MAX_ID_LENGTH = 80
// 与 font-library 的 id / 文件命名规则保持一致，导入出来的族必须还能被它扫到。
const FONT_ID = /^[a-z0-9][a-z0-9-]{0,79}$/
const ILLEGAL_ID_CHARS = /[^a-z0-9-]+/g
// 版本库之类的隐藏目录既不进包，也不计字节。
const SKIP_DIRECTORIES = new Set(['.git'])

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function fail(message) {
  throw new Error(message)
}

/** 单层目录名：只认合法 id，绝不是路径片段。 */
function familyDir(fontsDir, id) {
  const name = str(id)
  if (!FONT_ID.test(name)) fail('字体不存在：' + name)
  const dir = path.join(fontsDir, name)
  if (!existsSync(path.join(dir, 'index.json'))) fail('字体不存在：' + name)
  return dir
}

/** index.json 读不到就当没有清单，列表照常显示这一族。 */
async function readManifest(dir) {
  try {
    const value = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'))
    return value && typeof value === 'object' ? value : null
  } catch { return null }
}

function titleOf(manifest, id) {
  return str(manifest && manifest.label).trim() || id
}

function metaOf(manifest) {
  const files = manifest && manifest.files
  return Array.isArray(files) && files.length ? files.length + ' 个字重' : '字体'
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

/** 字体族文件夹的字节数，统计口径与打包一致（跳过 .git）。 */
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

/** key 或标题 → 一个合法的族 id（小写、单层、长度 80 以内）。 */
function idOf(key) {
  const raw = str(key).normalize('NFC').toLowerCase()
  const name = raw
    .replace(ILLEGAL_ID_CHARS, '-')
    .replace(/^-+/, '')
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/, '')
  return FONT_ID.test(name) ? name : 'font'
}

/** 重名时的候选：<id>-2、<id>-3…，补了后缀仍然要匹配 id 规则。 */
function suffixed(base, index) {
  const suffix = '-' + index
  const head = base.replace(/-+$/, '').slice(0, MAX_ID_LENGTH - suffix.length).replace(/-+$/, '')
  return (head || 'font') + suffix
}

/** 解包路径校验：拒绝 ..、绝对路径和反斜杠越界，再交给 path.join 落盘。 */
function safeEntryPath(name) {
  const raw = str(name).replace(/\\/g, '/').normalize('NFC')
  if (!raw || raw.includes('\u0000')) fail('字体包里有非法路径：' + raw)
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) fail('字体包里有绝对路径：' + raw)
  if (raw.split('/').some(part => part === '..')) fail('字体包里有越界路径：' + raw)
  const normalized = path.posix.normalize(raw)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.endsWith('/')) fail('字体包里有非法路径：' + raw)
  return normalized
}

/**
 * fontsDir 是自装字体根目录（真实实现 `<dataRoot>/fonts`），插件内置字体在别的根上，
 * 因此这里的 list/collect 天然只处理用户自己装进来的族。
 */
export function createTransferFonts({ fontsDir } = {}) {
  if (!fontsDir) fail('缺少字体目录')

  async function familyIds() {
    let items
    try { items = await readdir(fontsDir, { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
    return items
      .filter(item => item.isDirectory() && FONT_ID.test(item.name))
      .filter(item => existsSync(path.join(fontsDir, item.name, 'index.json')))
      .map(item => item.name)
      .sort()
  }

  async function list() {
    const rows = []
    for (const id of await familyIds()) {
      const dir = path.join(fontsDir, id)
      const manifest = await readManifest(dir)
      rows.push({ key: id, title: titleOf(manifest, id), meta: metaOf(manifest), bytes: await folderBytes(dir) })
    }
    return rows
  }

  async function collect(ids) {
    const wanted = (Array.isArray(ids) ? ids : [ids]).map(str).filter(Boolean)
    const items = []
    for (const id of wanted) {
      const dir = familyDir(fontsDir, id)
      const title = titleOf(await readManifest(dir), id)
      const entries = await readFolderFiles(dir)
      const sourceBytes = entries.reduce((sum, entry) => sum + entry.content.length, 0)
      if (sourceBytes > MAX_ZIP_BYTES) fail('字体「' + title + '」超过 40 MB，暂不能进包')
      const content = writeZipEntries(entries, { label: '字体包' })
      if (content.length > MAX_ZIP_BYTES) fail('字体「' + title + '」超过 40 MB，暂不能进包')
      items.push({ key: id, title, fileName: id + '.zip', content })
    }
    return items
  }

  async function importOne(payload) {
    const { key, content } = payload || {}
    if (content === undefined || content === null) fail('字体包内容为空')
    const entries = readZipEntries(content, { label: '字体包' })
    const base = idOf(key)
    let id = base
    // 同一个包再来一次：族目录内容一模一样就认它，不再造一个 -2。
    if (existsSync(path.join(fontsDir, id)) && await folderHoldsZip(path.join(fontsDir, id), entries).catch(() => false)) {
      return { id, reused: true }
    }
    if (existsSync(path.join(fontsDir, id))) {
      id = ''
      for (let index = 2; index <= MAX_RENAME_ATTEMPTS; index += 1) {
        const candidate = suffixed(base, index)
        if (!existsSync(path.join(fontsDir, candidate))) { id = candidate; break }
      }
      // 排满 60 个仍然重名：用时间戳续一个，仍然落在 id 规则内。
      if (!id) id = suffixed(base, Date.now())
    }
    // 先校验完所有路径再落盘，越界条目不会留下半个字体族。
    const target = path.join(fontsDir, id)
    const files = []
    for (const [name, data] of entries) {
      const relative = safeEntryPath(name)
      const file = path.join(target, ...relative.split('/'))
      if (!file.startsWith(target + path.sep)) fail('字体包里有越界路径：' + name)
      files.push([file, data])
    }
    // 只写文件：不覆盖已存在的族、不动设置，字体是否可用交给 font-library 扫描。
    for (const [file, data] of files) {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, data)
    }
    return { id }
  }

  return Object.freeze({ list, collect, importOne })
}
