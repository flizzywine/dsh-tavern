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
        category: type.dynamic ? '动态快照' : type.constant ? '常驻资料' : '静态资料' }] : []
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
      directories: groups.map(group => group.root), rows: groups.flatMap(group => group.rows) }
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
    async searchFiles(args, lookup) {
      if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 500) throw Error('query 需要 1–500 字符的非空搜索文本')
      const { offset, limit } = page(args), view = await viewFor(args, lookup)
      const needle = args.caseSensitive ? args.query : args.query.toLowerCase()
      const matches = []; let total = 0
      for (const row of view.rows) {
        lookup?.signal?.throwIfAborted()
        await files.verify(row.path, row.content)
        const lines = (await fs.readFile(row.path, 'utf8')).split('\n')
        for (let i = 0; i < lines.length; i++) {
          const position = (args.caseSensitive ? lines[i] : lines[i].toLowerCase()).indexOf(needle)
          if (position < 0) continue
          if (total >= offset && matches.length < limit) {
            const start = Math.max(0, position - 120), end = Math.min(lines[i].length, start + 800)
            matches.push({ path: row.path, category: row.category, line: i + 1, text: lines[i].slice(start, end), truncated: start > 0 || end < lines[i].length })
          }
          total++
        }
      }
      return { directory: view.root, directories: view.directories, version: view.key, total, offset, nextOffset: offset + limit < total ? offset + limit : null, matches }
    },
    async refresh(scope, { signal } = {}) {
      const view = await current({ scope, signal })
      const snapshot = view ? { directory: view.root, entries: view.rows.map(row => ({ ref: row.identity, title: row.title, category: row.category, hash: worldbookFileDigest(row.content) })) } : { directory: '', entries: [] }
      snapshot.version = worldbookFileDigest(JSON.stringify(snapshot))
      const changed = snapshots.get(scope)?.version !== snapshot.version
      snapshots.set(scope, snapshot)
      return changed
    },
    changeSnapshot(scope) { return snapshots.get(scope) },
    async removeChat() {}, // Other games and saved versions may still use these derived files.
    async inspect(lookup) {
      const view = await current(lookup)
      return view ? { directory: view.root, directories: view.directories, version: view.key, files: view.rows.map(({ path, title, ref, category }) => ({ path, title, ref, category })), clusters: [] } : null
    },
    async readEntry(ref, lookup) { const view = await current(lookup); return view?.rows.find(row => row.ref === ref)?.content },
    async readResource(requested, lookup) { const row = await resource(requested, lookup); return row ? fs.readFile(row.path, 'utf8') : undefined },
    dispose(scope) { if (scope) snapshots.delete(scope) }
  }
}
