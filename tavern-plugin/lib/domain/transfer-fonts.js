import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { folderBytes, importFolderZip, packFolderZip, readFolderFiles } from './transfer-folder.js'

// 导出/导入里的字体子模块：一个自装字体族 = fontsDir 下一层文件夹，整目录打成一个 zip。
// 导入只落盘，不启用、不校验 face 明细；真正能不能用交给 font-library 读取时判断。
const MAX_ID_LENGTH = 80
// 与 font-library 的 id / 文件命名规则保持一致，导入出来的族必须还能被它扫到。
const FONT_ID = /^[a-z0-9][a-z0-9-]{0,79}$/
const ILLEGAL_ID_CHARS = /[^a-z0-9-]+/g

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
      const content = packFolderZip(entries, { kind: '字体', title, checkSourceBytes: true })
      items.push({ key: id, title, fileName: id + '.zip', content })
    }
    return items
  }

  async function importOne(payload) {
    const { name: id, ...result } = await importFolderZip(fontsDir, payload, {
      label: '字体包', baseName: idOf, suffixed
    })
    return { id, ...result }
  }

  return Object.freeze({ list, collect, importOne })
}
