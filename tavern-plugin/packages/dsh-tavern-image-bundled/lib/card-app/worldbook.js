import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat, writeFile, lstat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite, readJson, safeDirectory, serialQueue } from './storage.js'

const MODES = ['always', 'nsfw', 'gore', 'lookup', 'manual', 'prescan']
const hash = value => createHash('sha256').update(value).digest('hex')
const invalid = message => Object.assign(new Error(message), { code: 'INVALID_ARGUMENT' })

function normalize(value) {
  if (!value || !Array.isArray(value.buckets) || value.buckets.length > 30) throw invalid('世界书必须包含最多 30 个分册')
  const ids = new Set()
  return { version: 3, buckets: value.buckets.map(bucket => {
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(bucket?.id) || ids.has(bucket.id)) throw invalid('分册 ID 必须唯一且只包含小写字母、数字与连字符')
    ids.add(bucket.id)
    const entries = new Set()
    if (!Array.isArray(bucket.entries) || bucket.entries.length > 300) throw invalid('每册最多 300 个条目')
    return { id: bucket.id, label: String(bucket.label || bucket.id).slice(0, 100), intro: String(bucket.intro || '').slice(0, 2000), entries: bucket.entries.map(entry => {
      const id = String(entry.id || randomUUID()), title = String(entry.title || '').trim(), content = String(entry.content || '')
      if (!title || title.length > 200 || id.length > 128 || entries.has(id) || content.length > 100000) throw invalid('条目需唯一 ID、1–200 字标题和最多 100000 字正文')
      entries.add(id)
      return { id, title, content, mode: MODES.includes(entry.mode) ? entry.mode : 'always', enabled: entry.enabled !== false }
    }) }
  }) }
}

/** The JSON is authoritative; generated references are repairable and excluded from distribution. */
export function createCardWorldbook(root) {
  const file = join(root, 'card-worldbook.json'), references = join(root, 'skills/image-prompt/references')
  const serial = serialQueue()
  let cached, stamp, initializing
  const snapshot = book => ({ ...structuredClone(book), revision: hash(JSON.stringify(book)) })
  async function project(book) {
    const dir = join(references, 'generated')
    await safeDirectory(root, dir)
    const names = [], lines = ['# 卡片生图规则索引', '', '按当前渠道的提示词格式与本张画面选择规则。always 在编写前读，prescan 在提交前读，manual 在改库前读；lookup 用 find_prompt 查询。', '']
    const writeChanged = async (path, text) => { if (await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error }) !== text) await atomicWrite(path, text) }
    for (const bucket of book.buckets) for (const entry of bucket.entries) {
      if (!entry.enabled) continue
      const name = 'rule-' + hash(JSON.stringify([bucket.id, entry.id])).slice(0, 24) + '.md'
      names.push(name)
      if (entry.mode !== 'lookup') {
        await writeChanged(join(dir, name), '# ' + entry.title + '\n\n' + entry.content + '\n')
        lines.push('- ' + entry.mode + ' · ' + bucket.label + ' · ' + entry.title.replace(/[\r\n]/g, ' ') + ' · `references/generated/' + name + '`')
      }
    }
    await writeChanged(join(references, 'INDEX.md'), lines.join('\n') + '\n')
    // Delete only files recorded in our previous manifest, never arbitrary user reference folders.
    const manifest = join(dir, 'files.json'), previous = await readJson(manifest, [])
    for (const name of Array.isArray(previous) ? previous : []) if (/^rule-[a-f0-9]{24}\.md$/.test(name) && !names.includes(name)) await rm(join(dir, name), { force: true })
    await writeChanged(manifest, JSON.stringify(names) + '\n')
  }
  async function load() {
    if (initializing) return initializing
    initializing = (async () => {
      let info
      try { info = await stat(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (cached && info?.mtimeMs === stamp) return snapshot(cached)
      if (!info) {
        const defaults = normalize(await readJson(join(root, 'card-worldbook.default.json'), { version: 3, buckets: [] }))
        try { await writeFile(file, JSON.stringify(defaults, null, 2) + '\n', { flag: 'wx' }) } catch (error) { if (error.code !== 'EEXIST') throw error }
      }
      const link = await lstat(file)
      if (!link.isFile() || link.isSymbolicLink()) throw invalid('卡片世界书必须是普通 JSON 文件')
      const book = normalize(await readJson(file))
      await project(book)
      cached = book
      stamp = (await stat(file)).mtimeMs
      return snapshot(book)
    })().finally(() => { initializing = null })
    return initializing
  }
  /** 结构定位：分册和条目都必须出现在当前磁盘版本里，找不到按参数错误报给面板。 */
  const bucketOf = (book, bucketId) => {
    const bucket = (book.buckets || []).find(item => item.id === bucketId)
    if (!bucket) throw invalid('分册不存在，请刷新后重试')
    return bucket
  }
  const entryOf = (book, bucketId, id) => {
    const bucket = bucketOf(book, bucketId)
    const at = bucket.entries.findIndex(entry => entry.id === id)
    if (at < 0) throw invalid('条目不存在，可能已在别处删除，请刷新')
    return { bucket, at }
  }
  /** 全量落盘：投影失败就回滚投影；写完同步缓存与 mtime，让下一次 load 直接命中。 */
  async function commit(next) {
    const book = normalize(next)
    try { await project(book); await atomicWrite(file, book) }
    catch (error) { await project(cached).catch(() => {}); throw error }
    cached = book
    stamp = (await stat(file)).mtimeMs
    return snapshot(book)
  }
  return {
    load: () => serial(load),
    save(value) {
      return serial(async () => {
        const current = await load()
        if (value?.revision !== current.revision) throw Object.assign(new Error('卡片世界书已在别处修改，请重新载入后再保存；当前草稿仍保留'), { code: 'REVISION_CONFLICT' })
        return commit(value)
      })
    },
    /** 面板逐条编辑：一次只显式改给定字段，写完把最新整本还回去，面板直接换掉本地副本。 */
    updateEntry(bucketId, id, patch = {}) {
      return serial(async () => {
        const current = await load()
        const { bucket, at } = entryOf(current, bucketId, id)
        const entry = bucket.entries[at]
        if (patch.title !== undefined) entry.title = String(patch.title)
        if (patch.content !== undefined) entry.content = String(patch.content)
        if (patch.mode !== undefined) {
          if (!MODES.includes(patch.mode)) throw invalid('档位只能选 ' + MODES.join('、'))
          entry.mode = patch.mode
        }
        if (patch.enabled !== undefined) entry.enabled = patch.enabled !== false
        const book = await commit(current)
        const { bucket: after, at: index } = entryOf(book, bucketId, id)
        return { book, entry: after.entries[index] }
      })
    },
    addEntry(bucketId, value = {}) {
      return serial(async () => {
        const current = await load()
        const bucket = bucketOf(current, bucketId)
        const draft = {
          id: randomUUID(),
          title: String(value.title || '新条目'),
          content: String(value.content || ''),
          mode: MODES.includes(value.mode) ? value.mode : 'always',
          enabled: value.enabled !== false,
        }
        bucket.entries.push(draft)
        const book = await commit(current)
        const { bucket: next, at } = entryOf(book, bucketId, draft.id)
        return { book, entry: next.entries[at] }
      })
    },
    removeEntry(bucketId, id) {
      return serial(async () => {
        const current = await load()
        const { bucket, at } = entryOf(current, bucketId, id)
        bucket.entries.splice(at, 1)
        return { book: await commit(current) }
      })
    },
  }
}
