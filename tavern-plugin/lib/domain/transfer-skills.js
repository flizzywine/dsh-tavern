import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readZipEntries, writeZipEntries } from './zip-entries.js'
import { folderHoldsZip } from './transfer-folder-match.js'

// 导出/导入里的写作 Skill 子模块：只负责 zip 与文件读写，Skill 目录本身仍归 tavern-skills 管。
const MAX_ZIP_BYTES = 40 * 1024 * 1024
const MAX_RENAME_ATTEMPTS = 60
const ILLEGAL_FILE_CHARS = /[\\/:*?"<>|]/g
const ILLEGAL_FOLDER_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g
// 版本库目录不算 Skill 内容：不统计字节，也不进包。
const SKIP_DIRECTORIES = new Set(['.git'])

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function fail(message) {
  throw new Error(message)
}

/** Skill 目录只允许落在 skillsDir 下一层；不存在则报「Skill 不存在」。 */
function skillDir(skillsDir, name) {
  const folder = str(name)
  if (!folder || folder !== path.basename(folder) || folder === '..' || folder === '.' || folder.startsWith('.')) fail('Skill 不存在：' + folder)
  const dir = path.join(skillsDir, folder)
  if (!existsSync(dir)) fail('Skill 不存在：' + folder)
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

/** 文件名里不允许出现 /\:*?"<>|，出现就换掉。 */
function fileNameOf(name) {
  return str(name).replace(ILLEGAL_FILE_CHARS, '_') + '.zip'
}

/** key 或标题 → 一个可用的 Skill 目录名（单层，不带路径）。 */
function skillNameOf(key, title) {
  const raw = str(key) || str(title)
  const base = path.posix.basename(raw.replace(/\\/g, '/')).normalize('NFC')
  const name = base
    .replace(ILLEGAL_FOLDER_CHARS, '-')
    .replace(/^[-.\s]+|[-.\s]+$/g, '')
    .slice(0, 80)
  return name || 'skill'
}

/** 解包路径校验：拒绝 NUL、绝对路径、盘符、任一 .. 段和反斜杠越界，再交给 path.join 落盘。 */
function safeEntryPath(name) {
  const raw = str(name).replace(/\\/g, '/').normalize('NFC')
  if (!raw || raw.includes('\u0000')) fail('Skill 包里有非法路径：' + raw)
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) fail('Skill 包里有绝对路径：' + raw)
  if (raw.split('/').some(part => part === '..')) fail('Skill 包里有越界路径：' + raw)
  const normalized = path.posix.normalize(raw)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.endsWith('/')) fail('Skill 包里有非法路径：' + raw)
  return normalized
}

/** 「写作 Skill」后面的用途后缀，有 agents 就拼上去。 */
function metaOf(skill) {
  const agents = Array.isArray(skill && skill.agents) ? skill.agents.map(str).filter(Boolean) : []
  return agents.length ? '写作 Skill · ' + agents.join('/') : '写作 Skill'
}

/**
 * deps.skillsDir 是用户 Skill 根目录（真实实现 <dataRoot>/skills），
 * deps.listSkills() 返回 Skill 列表（真实实现 tavernSkills.list()）。
 */
export function createTransferSkills(deps) {
  const { skillsDir, listSkills } = deps
  if (!skillsDir) fail('缺少 Skill 目录')

  async function installed() {
    try {
      const rows = await listSkills()
      return Array.isArray(rows) ? rows : []
    } catch { return [] }
  }

  async function list() {
    const skills = await installed()
    const rows = []
    for (const skill of skills) {
      const name = str(skill && skill.name)
      if (!name) continue
      const files = await readFolderFiles(path.join(skillsDir, name))
      // 目录不存在或没有可打包的文件就当没有这个 Skill。
      if (!files.length) continue
      rows.push({
        key: name,
        title: name,
        meta: metaOf(skill),
        bytes: files.reduce((total, file) => total + file.content.length, 0)
      })
    }
    return rows
  }

  async function collect(names) {
    const wanted = (Array.isArray(names) ? names : [names]).map(str).filter(Boolean)
    const items = []
    for (const name of wanted) {
      const dir = skillDir(skillsDir, name)
      const entries = await readFolderFiles(dir)
      if (!entries.length) fail('Skill 不存在：' + name)
      const content = writeZipEntries(entries, { label: '写作 Skill 包' })
      if (content.length > MAX_ZIP_BYTES) fail('Skill「' + name + '」超过 40 MB，暂不能进包')
      items.push({ key: name, title: name, fileName: fileNameOf(name), content })
    }
    return items
  }

  async function importOne(payload) {
    const { key, title, content } = payload || {}
    if (content === undefined || content === null) fail('Skill 包内容为空')
    const entries = readZipEntries(content, { label: '写作 Skill 包' })
    const base = skillNameOf(key, title)
    let name = base
    // 同一个包再来一次：目录内容一模一样就认它，不再造 skill-2。
    if (existsSync(path.join(skillsDir, base)) && await folderHoldsZip(path.join(skillsDir, base), entries).catch(() => false)) {
      return { name: base, reused: true }
    }
    if (existsSync(path.join(skillsDir, base))) {
      name = ''
      for (let index = 2; index <= MAX_RENAME_ATTEMPTS; index += 1) {
        const candidate = base + '-' + index
        if (!existsSync(path.join(skillsDir, candidate))) { name = candidate; break }
      }
      if (!name) name = base + '-' + Date.now()
    }
    // 先校验完所有路径再落盘，越界条目不会留下半个 Skill。
    const target = path.join(skillsDir, name)
    const files = []
    for (const [entryName, data] of entries) {
      const relative = safeEntryPath(entryName)
      const file = path.join(target, ...relative.split('/'))
      if (!file.startsWith(target + path.sep)) fail('Skill 包里有越界路径：' + entryName)
      files.push([file, data])
    }
    // 只写文件：不动 .assignments.json，也不覆盖同名的已有 Skill。
    for (const [file, data] of files) {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, data)
    }
    return { name }
  }

  return Object.freeze({ list, collect, importOne })
}
