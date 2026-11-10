import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readZipEntries, writeZipEntries } from './zip-entries.js'

const MAX_EXPORT_MB = 40
const MAX_EXPORT_BYTES = MAX_EXPORT_MB * 1024 * 1024
const LAST_NUMBERED_SUFFIX = 60

// 插件的 node_modules 也是内容；只有版本库目录不进包、不计字节。
const SKIP_DIRECTORIES = new Set(['.git'])

/** 打包用的相对路径：统一 `/`，顺序稳定。 */
export async function readFolderFiles(dir, prefix = '') {
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

export async function folderBytes(dir) {
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

export function packFolderZip(entries, { kind, title, checkSourceBytes = false }) {
  const checkSize = bytes => {
    if (bytes > MAX_EXPORT_BYTES) throw new Error(kind + '「' + title + '」超过 ' + MAX_EXPORT_MB + ' MB，暂不能进包')
  }
  if (checkSourceBytes) checkSize(entries.reduce((sum, entry) => sum + entry.content.length, 0))
  const content = writeZipEntries(entries)
  checkSize(content.length)
  return content
}

// 导入是「加一份新的」：同一个包再进来一次，不该多出一个 (2)。判断依据是内容而不是名字——
// 目录里的文件逐字节等于包里的条目、也没有包外的文件，才算同一个东西。隐藏文件（.tavern-status.json
// 这类装载标记）不算内容，插件管理器写它们不该让比较失败。
async function listFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const out = []
  for (const entry of entries) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isDirectory()) out.push(...await listFiles(path.join(dir, entry.name), relative))
    else out.push(relative)
  }
  return out
}

async function folderHoldsZip(dir, zipEntries) {
  if (!zipEntries.size) return false
  const root = path.resolve(dir)
  for (const [relative, data] of zipEntries) {
    const file = path.resolve(root, relative)
    if (file !== root && !file.startsWith(root + path.sep)) return false
    let bytes
    try { bytes = await readFile(file) } catch { return false }
    if (!data.equals(bytes)) return false
  }
  for (const relative of await listFiles(dir)) {
    if (zipEntries.has(relative)) continue
    if (path.posix.basename(relative).startsWith('.')) continue
    return false
  }
  return true
}

function safeEntryPath(name, label) {
  const raw = name.replace(/\\/g, '/').normalize('NFC')
  if (!raw || raw.includes('\u0000')) throw new Error(label + '里有非法路径：' + raw)
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) throw new Error(label + '里有绝对路径：' + raw)
  if (raw.split('/').some(part => part === '..')) throw new Error(label + '里有越界路径：' + raw)
  const normalized = path.posix.normalize(raw)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.endsWith('/')) {
    throw new Error(label + '里有非法路径：' + raw)
  }
  return normalized
}

/** 资源类型决定目录命名；迁移只落盘，启用和加载仍归各资源管理器。 */
export async function importFolderZip(root, payload, { label, zipLabel = label, baseName, suffixed }) {
  const { key, title, content } = payload || {}
  if (content === undefined || content === null) throw new Error(label + '内容为空')
  const entries = readZipEntries(content, { label: zipLabel })
  const base = baseName(key, title)
  const baseDir = path.join(root, base)
  if (existsSync(baseDir) && await folderHoldsZip(baseDir, entries).catch(() => false)) {
    return { name: base, reused: true }
  }
  let name = base
  if (existsSync(baseDir)) {
    name = ''
    for (let index = 2; index <= LAST_NUMBERED_SUFFIX; index += 1) {
      const candidate = suffixed(base, index)
      if (!existsSync(path.join(root, candidate))) { name = candidate; break }
    }
    if (!name) name = suffixed(base, Date.now())
  }
  // 校验全部路径后再写，越界条目不会留下半个目录。
  const target = path.join(root, name)
  const files = []
  for (const [entryName, data] of entries) {
    const relative = safeEntryPath(entryName, label)
    const file = path.join(target, ...relative.split('/'))
    if (!file.startsWith(target + path.sep)) throw new Error(label + '里有越界路径：' + entryName)
    files.push([file, data])
  }
  for (const [file, data] of files) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, data)
  }
  return { name }
}
