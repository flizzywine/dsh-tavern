import fs from 'node:fs/promises'
import path from 'node:path'
import { createWorldbookFileStore, worldbookFileDigest, worldbookFileLabel } from './worldbook-file-store.js'
import { worldbookEntryTitle } from './worldbook-entry-title.js'
import { classifyWorldbookEntry } from './worldbook-entry-classification.js'
import { currentVirtualState, eligibleVirtualSourceEntries } from './worldbook-virtual-state.js'

const sourceIdentity = source => source?.kind === 'merged'
  ? ['merged', (source.sources || []).map(sourceIdentity)]
  : [source?.kind || '', source?.cardPath || source?.path || '']
function entryIdentity(state, entry) {
  if (entry.plugin) return entry.ref
  const origin = state.worldBook?.mergedSources?.find(book => book.entries.some(item => String(item.uid) === String(entry.sourceUid)))
  const uid = origin?.entries.find(item => String(item.uid) === String(entry.sourceUid))?.originalUid ?? entry.sourceUid ?? entry.ref
  return JSON.stringify([sourceIdentity(origin?.source || state.worldBook?.source), uid])
}

const lookupId = row => worldbookFileDigest(row.path)
const normalizeKeyword = value => String(value).normalize('NFKC').trim().toLowerCase()

/** New receipts travel outside model-facing text; old traces stored JSON. */
export function readLorebookReceipt(text, meta) {
  const receipt = meta?.worldbookRead
  if (typeof receipt?.id === 'string' && text.trim()) return { ...receipt, text }
  if (!text.startsWith('{')) return undefined
  let legacy
  try { legacy = JSON.parse(text) } catch { return undefined }
  if (legacy?.status === 'found' && typeof legacy.id === 'string' && typeof legacy.text === 'string' && legacy.text.trim()) {
    return { id: legacy.id, title: legacy.title, text: legacy.text }
  }
}

function titleMatchRank(row, keys, keyword) {
  const title = normalizeKeyword(row.title)
  if (title === keyword) return 0
  if (keys.some(key => key === keyword)) return 1
  if (title.includes(keyword) || keys.some(key => key.includes(keyword))) return 2
  return Infinity
}

// JSON remains authoritative. Immutable content generations can be shared by games;
// every operation resolves the calling game's CURRENT generation before granting access.
export function createWorldbookFiles({ directory, load, resourcesAvailable = () => true }) {
  const files = createWorldbookFileStore(directory), snapshots = new WeakMap()
  async function current(lookup) {
    lookup?.signal?.throwIfAborted()
    const scope = lookup?.scope
    if (!scope?.session?.id || !resourcesAvailable(scope)) return null
    const state = await load(scope)
    if (!state || (state.authorizedSessionId || state.chat?.sessionId) !== scope.session.id) return null
    const visible = eligibleVirtualSourceEntries(state.worldBook, state.chat)
    const snapshots = currentVirtualState(state.chat, visible)
    const entries = visible.flatMap(entry => {
      const type = classifyWorldbookEntry(entry)
      const content = type.dynamic ? snapshots.entries[entry.ref]?.text : entry.content
      return String(content || '').trim() ? [{ ...entry, content,
        category: type.dynamic ? '动态快照' : type.kind === 'static-constant' ? '常驻资料' : '静态资料' }] : []
    }).sort((a, b) => String(a.ref).localeCompare(String(b.ref)))
    const used = new Set()
    const rows = entries.map(entry => {
      let base = worldbookFileLabel(worldbookEntryTitle(entry))
      if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(base)) base = '_' + base
      let name = base, n = 2
      while (used.has(entry.category + '/' + name.toLowerCase())) name = base + '--' + n++
      used.add(entry.category + '/' + name.toLowerCase())
      return { ref: entry.ref, identity: entryIdentity(state, entry), title: worldbookEntryTitle(entry), category: entry.category, filename: entry.category === '常驻资料' ? path.join(entry.category, name + '.md') : name + '.md', content: '# ' + worldbookEntryTitle(entry) + '\n\n' + String(entry.content) + '\n' }
    })
    // Keep dynamic generations separate: a weather/relationship change must not
    // rewrite hundreds of static files or invalidate their already-known paths.
    const label = state.chat.cardPath ? path.parse(state.chat.cardPath).name : state.worldBook?.view?.displayName || '世界书'
    const groups = []
    for (const dynamic of [false, true]) {
      const group = rows.filter(row => (row.category === '动态快照') === dynamic)
      const key = worldbookFileDigest(JSON.stringify([state.chat.cardPath, group]))
      await files.assign(key, label + (dynamic ? '·动态快照' : ''), { versioned: true })
      await files.sync(key, new Map(group.map(row => [row.filename, row.content])))
      lookup?.signal?.throwIfAborted()
      const root = files.directory(key)
      groups.push({ key, root, rows: group.map(row => ({ ...row, path: path.join(root, row.filename) })) })
    }
    return { key: worldbookFileDigest(JSON.stringify(groups.map(group => group.key))), root: groups[0].root,
      directories: groups.map(group => group.root), rows: groups.flatMap(group => group.rows),
      keys: new Map(entries.map(entry => [entry.ref, Array.isArray(entry.primaryKeys) ? entry.primaryKeys.map(normalizeKeyword).filter(Boolean) : []])) }
  }
  async function resource(requested, lookup) {
    const view = await current(lookup)
    const row = view?.rows.find(row => row.path === path.resolve(String(requested || '')))
    if (!row) return null
    await files.verify(row.path, row.content)
    return row
  }
  function page(args) {
    const offset = args.offset ?? 0, limit = args.limit ?? 30
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Error('offset 必须为非负整数，limit 必须为 1–100')
    return { offset, limit }
  }
  async function viewFor(args, lookup) {
    const view = await current(lookup)
    if (!view) throw Error('当前任务没有可访问的世界书文件')
    if (args.version && args.version !== view.key) throw Error('世界书资料版本已变化，请从第一页重新搜索或浏览')
    return view
  }
  return {
    directory: files.root,
    ownsPath(requested) {
      const relative = path.relative(files.root, path.resolve(String(requested || '')))
      return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    },
    async authorizeRead(requested, lookup) { return Boolean(await resource(requested, lookup)) },
    async listFiles(args, lookup) {
      const { offset, limit } = page(args), view = await viewFor(args, lookup)
      return { directory: view.root, directories: view.directories, version: view.key, total: view.rows.length, offset,
        nextOffset: offset + limit < view.rows.length ? offset + limit : null,
        files: view.rows.slice(offset, offset + limit).map(({ path, title, category }) => ({ path, title, category })) }
    },
    async readByKeyword({ keyword, offset = 0 }, lookup) {
      if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 500) throw Error('keyword 需要 1–500 字符的标题或搜索词')
      if (!Number.isSafeInteger(offset) || offset < 0) throw Error('offset 必须为非负整数')
      const view = await viewFor({}, lookup), query = normalizeKeyword(keyword)
      const selected = /^[a-f0-9]{20}$/.test(query) ? view.rows.find(row => lookupId(row) === query) : undefined
      let matches = selected ? [selected] : []
      let best = Infinity
      if (!selected) for (const row of view.rows) {
        lookup?.signal?.throwIfAborted()
        const rank = titleMatchRank(row, view.keys.get(row.ref), query)
        if (!Number.isFinite(rank) || rank > best) continue
        if (rank < best) { matches = []; best = rank }
        matches.push(row)
      }
      if (!matches.length) matches = view.rows.filter(row => {
        lookup?.signal?.throwIfAborted()
        return normalizeKeyword(row.content).includes(query)
      })
      if (!matches.length) return { status: 'not_found' }
      if (matches.length > 1) return { status: 'multiple', total: matches.length,
        candidates: matches.slice(0, 10).map(row => ({ id: lookupId(row), title: row.title, category: row.category })) }
      const [row] = matches
      const heading = '# ' + row.title + '\n\n'
      const characters = Array.from(row.content.slice(heading.length, -1))
      const end = Math.min(offset + 8000, characters.length)
      lookup?.signal?.throwIfAborted()
      return { status: 'found', id: lookupId(row), title: row.title, category: row.category,
        text: characters.slice(offset, end).join(''), nextOffset: end < characters.length ? end : null }
    },
    async searchFiles(args, lookup) {
      if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 500) throw Error('query 需要 1–500 字符的非空搜索文本')
      const { offset, limit } = page(args), view = await viewFor(args, lookup)
      const needle = args.caseSensitive ? args.query : args.query.toLowerCase()
      const matches = []
      let skipped = 0
      for (const row of view.rows) {
        lookup?.signal?.throwIfAborted()
        await files.verify(row.path, row.content)
        const lines = (await fs.readFile(row.path, 'utf8')).split('\n')
        for (let i = 0; i < lines.length; i++) {
          const position = (args.caseSensitive ? lines[i] : lines[i].toLowerCase()).indexOf(needle)
          if (position < 0) continue
          if (skipped < offset) {
            skipped++
            continue
          }
          const start = Math.max(0, position - 120), end = Math.min(lines[i].length, start + 800)
          matches.push({ id: lookupId(row), title: row.title, line: i + 1, text: lines[i].slice(start, end) })
          if (matches.length === limit) return matches
        }
      }
      return matches
    },
    async refresh(scope, { signal } = {}) {
      const view = await current({ scope, signal })
      const snapshot = view ? { directory: view.root, entries: view.rows.map(row => ({ ref: row.identity, title: row.title, category: row.category, hash: worldbookFileDigest(row.content) })) } : { directory: '', entries: [] }
      snapshot.version = worldbookFileDigest(JSON.stringify(snapshot))
      const changed = snapshots.get(scope)?.snapshot.version !== snapshot.version
      const rows = view?.rows || []
      snapshots.set(scope, { snapshot, refsByPath: new Map(rows.map(row => [row.path, row.ref])),
        refsById: new Map(rows.map(row => [lookupId(row), row.ref])) })
      return changed
    },
    changeSnapshot(scope) { return snapshots.get(scope)?.snapshot },
    refsForLookups(scope, { paths, ids }) {
      const indexed = snapshots.get(scope)
      return indexed ? [...new Set([...paths].map(file => indexed.refsByPath.get(file))
        .concat([...ids].map(id => indexed.refsById.get(id))).filter(Boolean))] : []
    },
    // A deleted card's derived files (named after its file, as current() labels them); a game that reads them again regenerates them.
    removeCard: cardPath => files.removeLabelled(path.parse(String(cardPath)).name),
    async removeChat() {}, // Other games and saved versions may still use these derived files.
    async inspect(lookup) {
      const view = await current(lookup)
      return view ? { directory: view.root, directories: view.directories, version: view.key,
        files: view.rows.map(row => ({ path: row.path, title: row.title, ref: row.ref, category: row.category, lookupId: lookupId(row) })), clusters: [] } : null
    },
    async readEntry(ref, lookup) { const view = await current(lookup); return view?.rows.find(row => row.ref === ref)?.content },
    async readResource(requested, lookup) { const row = await resource(requested, lookup); return row ? fs.readFile(row.path, 'utf8') : undefined },
    dispose(scope) { if (scope) snapshots.delete(scope) }
  }
}
