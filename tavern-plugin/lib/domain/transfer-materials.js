import path from 'node:path'

// 导出/导入里的「剧本」子模块：剧本就是 materials/ 下的纯文本，
// 只做列出、读取与回写，不解析内容、不改扩展名规则（交给 fileStorage 决定）。
const MATERIALS_KIND = 'source'
const MATERIAL_LABEL = '资料'
const DEFAULT_NAME = '未命名剧本'
const DEFAULT_EXTENSION = '.txt'
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/g

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function fail(message) {
  throw new Error(message)
}

/** 相对路径 → 文件名去扩展名；materials/第一幕.md → 第一幕。 */
function titleOf(relative) {
  const name = path.posix.basename(str(relative).replace(/\\/g, '/'), path.posix.extname(str(relative)))
  return name || DEFAULT_NAME
}

/** 相对路径 → 打包用的文件名：保留中文，非法字符换 _，没有扩展名补 .txt。 */
function fileNameOf(value) {
  const base = path.posix.basename(str(value).replace(/\\/g, '/')).normalize('NFC')
  let name = base.replace(ILLEGAL_NAME_CHARS, '_').trim()
  if (!name || name === '.' || name === '..') name = DEFAULT_NAME
  if (path.posix.extname(name) === '') name += DEFAULT_EXTENSION
  return name
}

/** content 兼容 Buffer / Uint8Array / string，其余一律当作空内容。 */
function textOf(content) {
  if (typeof content === 'string') return content
  if (Buffer.isBuffer(content)) return content.toString('utf8')
  if (content instanceof Uint8Array) return Buffer.from(content).toString('utf8')
  if (content instanceof ArrayBuffer) return Buffer.from(new Uint8Array(content)).toString('utf8')
  if (content && content.type === 'Buffer' && Array.isArray(content.data)) return Buffer.from(content.data).toString('utf8')
  return ''
}

/**
 * deps.fileResources 是资源库本体（真实实现 fileResources）：
 * list('source') 给相对路径，readText 给文本或 undefined，
 * importText('source', payload, undefined, { unique: true }) 写盘并返回新的相对路径。
 */
export function createTransferMaterials(deps) {
  const { fileResources } = deps || {}
  if (!fileResources) fail('缺少资源库')

  async function paths() {
    let rows
    try { rows = await fileResources.list(MATERIALS_KIND) }
    catch { return [] }
    if (!Array.isArray(rows)) return []
    return rows.map(str).filter(Boolean)
  }

  async function readText(key) {
    let text
    try { text = await fileResources.readText(key) }
    catch { return undefined }
    return typeof text === 'string' ? text : undefined
  }

  async function list() {
    const items = []
    for (const key of await paths()) {
      const text = await readText(key)
      // 读不到就当它不存在：导出清单里不出现点不开的条目。
      if (text === undefined) continue
      items.push({ key, title: titleOf(key), meta: MATERIAL_LABEL, bytes: Buffer.byteLength(text) })
    }
    return items
  }

  async function collect(keys) {
    const wanted = (Array.isArray(keys) ? keys : [keys]).map(str).filter(Boolean)
    const items = []
    for (const key of wanted) {
      const text = await readText(key)
      if (text === undefined) fail('剧本素材不存在：' + key)
      items.push({ key, title: titleOf(key), fileName: fileNameOf(key), content: Buffer.from(text, 'utf8') })
    }
    return items
  }

  async function importOne(payload) {
    const { title, content } = payload || {}
    if (content === undefined || content === null) fail('剧本素材内容为空')
    const name = fileNameOf(title)
    const text = textOf(content)
    if (text.trim() === '') fail('剧本素材内容为空：' + name)
    // unique 保证同名素材不覆盖原文件，由资源库自己换号。
    const imported = await fileResources.importText(MATERIALS_KIND, { name, text }, undefined, { unique: true })
    return { path: str(imported) }
  }

  return Object.freeze({ list, collect, importOne })
}
