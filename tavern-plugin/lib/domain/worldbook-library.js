import { mergeWorldBooks } from './worldbook-merge.js'
import { exportCharacterBook, exportSillyTavernWorldBook, inspectWorldBookDocument, prepareWorldBookImport, updateWorldBookDocument, worldBookDisplayName } from './worldbook-resource.js'
import { freezeJsonProjection, createJsonProjectionCache } from './immutable-json-projection.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function embeddedDocument(card) {
  return card && card.character_book && typeof card.character_book === 'object'
    ? card.character_book
    : { name: str(card && card.name) + '世界书', entries: [], extensions: {} }
}

/**
 * Owns world-book identity, storage adapters and card binding semantics.
 * Callers never branch on embedded versus standalone persistence.
 */
export function createWorldBookLibrary(options = {}) {
  const resources = options.resources
  const cards = options.cards
  const normalizePath = options.normalizePath
  const removeStandalone = options.removeStandalone
  // Catalog rows are pure functions of one file; the host may memoize them by file revision.
  const summaries = options.summaries || { standalone: (path, compute) => compute(path), card: (cardPath, compute) => compute(cardPath) }
  const templateRecords = createJsonProjectionCache(), templateSnapshots = new WeakMap()
  const emptyTemplateSnapshot = freezeJsonProjection({ worldName: '', worldbooks: {} })
  if (!resources || !cards || typeof normalizePath !== 'function' || typeof removeStandalone !== 'function') {
    throw new Error('World Book Library 缺少资源、人物卡或路径 adapter')
  }

  function sourceOf(locator) {
    const source = locator && typeof locator === 'object' ? locator : {}
    if (source.kind === 'card') {
      return { kind: 'card', cardPath: normalizePath(source.cardPath, 'card') }
    }
    return { kind: 'standalone', path: normalizePath(source.path, 'worldbook') }
  }

  const mutations = new Map()
  function serializeMutation(work) {
    return (locator, ...args) => {
      const source = sourceOf(typeof locator === 'string' ? { kind: 'standalone', path: locator } : locator)
      const key = source.cardPath || source.path
      const operation = (mutations.get(key) || Promise.resolve()).catch(() => {}).then(() => work(locator, ...args))
      mutations.set(key, operation)
      const release = () => { if (mutations.get(key) === operation) mutations.delete(key) }
      operation.then(release, release)
      return operation
    }
  }

  function templateRecord(text, source, filename) {
    const key = JSON.stringify([source, filename])
    return templateRecords(key, text, () => {
      let document
      try { document = JSON.parse(text) } catch (error) { throw new Error('世界书工作版 JSON 损坏: ' + error.message) }
      return { source: clone(source), document: exportSillyTavernWorldBook(document),
        view: { displayName: worldBookDisplayName(document, { filename }) } }
    })
  }

  async function readRecord(locator, suppliedCard, templateOnly = false) {
    const source = sourceOf(locator)
    if (source.kind === 'card') {
      const card = suppliedCard ?? await cards.read(source.cardPath)
      if (card === undefined) throw new Error('人物卡不存在: ' + source.cardPath)
      const document = embeddedDocument(card)
      if (templateOnly) return templateRecord(JSON.stringify(document),
        { kind: 'card', cardPath: source.cardPath, cardName: card.name }, card.name)
      return {
        source: { kind: 'card', cardPath: source.cardPath, cardName: card.name },
        document,
        view: inspectWorldBookDocument(document, { filename: card.name })
      }
    }
    const text = await resources.readText(source.path)
    if (text === undefined) throw new Error('世界书不存在: ' + source.path)
    if (templateOnly) return templateRecord(text, source, source.path.split('/').pop())
    let document
    try { document = JSON.parse(text) } catch (error) { throw new Error('世界书工作版 JSON 损坏: ' + error.message) }
    return {
      source,
      document,
      view: inspectWorldBookDocument(document, { filename: source.path.split('/').pop() })
    }
  }

  async function get(locator) {
    const record = await readRecord(locator)
    return { source: record.source, view: record.view, globalEnabled: record.source.kind === 'standalone' && (await globalSources()).some(source => source.path === record.source.path) }
  }

  async function globalSources() { return resources.globalSources ? await resources.globalSources() : [] }

  async function setGlobal(locator, enabled) {
    const source = sourceOf(locator)
    if (source.kind !== 'standalone') throw new Error('只有独立世界书支持全局生效')
    if (typeof enabled !== 'boolean') throw new Error('全局生效开关必须为布尔值')
    if (!resources.setGlobal) throw new Error('全局世界书存储不可用')
    if (enabled) await readRecord(source)
    await resources.setGlobal(source.path, enabled)
    return await get(source)
  }

  async function standaloneSummary(path) {
    const record = await readRecord({ kind: 'standalone', path })
    return { path: record.source.path, name: record.view.displayName, entryCount: record.view.entryCount,
      enabledCount: record.view.enabledCount, diagnostics: record.view.diagnostics.length }
  }
  async function cardSummary(cardPath) {
    const card = await cards.read(cardPath)
    if (!card || !card.character_book || typeof card.character_book !== 'object') return { hasBook: false }
    const view = inspectWorldBookDocument(card.character_book, { filename: card.name })
    return { hasBook: true, cardName: card.name, name: view.displayName, entryCount: view.entryCount,
      enabledCount: view.enabledCount, diagnostics: view.diagnostics.length }
  }
  async function catalog() {
    const globals = new Set((await globalSources()).map(source => source.path))
    const standaloneResults = await Promise.all((await resources.list('worldbook')).map(async function (path) {
      try {
        const [summary, metadata] = await Promise.all([
          summaries.standalone(path, standaloneSummary),
          typeof resources.metadata === 'function' ? resources.metadata(path) : null
        ])
        return { row: {
          kind: 'standalone', path: summary.path, name: summary.name, globalEnabled: globals.has(summary.path),
          entryCount: summary.entryCount, enabledCount: summary.enabledCount, diagnostics: summary.diagnostics,
          importedAt: Math.max(0, Number(metadata && metadata.importedAt) || 0),
          updatedAt: Math.max(0, Number(metadata && metadata.updatedAt) || 0)
        } }
      } catch (error) {
        return { diagnostic: { kind: 'standalone', path, message: str(error && error.message || error) } }
      }
    }))
    const embeddedResults = await Promise.all((await cards.listPaths()).map(async function (cardPath) {
      try {
        const [summary, metadata] = await Promise.all([
          summaries.card(cardPath, cardSummary),
          typeof cards.metadata === 'function' ? cards.metadata(cardPath) : null
        ])
        if (!summary.hasBook) return {}
        return { row: {
          kind: 'card', cardPath, cardName: summary.cardName, name: summary.name,
          entryCount: summary.entryCount, enabledCount: summary.enabledCount, diagnostics: summary.diagnostics,
          importedAt: Math.max(0, Number(metadata && metadata.importedAt) || 0),
          updatedAt: Math.max(0, Number(metadata && metadata.updatedAt) || 0)
        } }
      } catch (error) {
        return { diagnostic: { kind: 'card', path: cardPath, message: str(error && error.message || error) } }
      }
    }))
    const standalone = standaloneResults.map(function (result) { return result.row }).filter(Boolean)
    const embedded = embeddedResults.map(function (result) { return result.row }).filter(Boolean)
    const diagnostics = standaloneResults.concat(embeddedResults).map(function (result) { return result.diagnostic }).filter(Boolean)
    return { standalone, embedded, diagnostics }
  }

  async function binding(cardPath, { card: suppliedCard, read = readRecord } = {}) {
    const normalized = normalizePath(cardPath, 'card')
    const card = suppliedCard ?? await cards.read(normalized)
    if (card === undefined) throw new Error('人物卡不存在: ' + normalized)
    const stored = await resources.bindingForCard(normalized)
    if (stored.kind === 'multiple') {
      const books = await Promise.all(stored.sources.map(async item => {
        const source = sourceOf(item.kind === 'embedded' ? { kind: 'card', cardPath: item.cardPath } : item)
        const kind = source.kind === 'card' ? 'embedded' : 'standalone'
        if (!item.available) return { kind, source, name: '', available: false }
        const record = await read(source)
        return { kind, source: record.source, name: record.view.displayName, available: true }
      }))
      if (books.length === 0) return { kind: 'none', source: null, name: '', available: true }
      if (books.length === 1) return books[0]
      return { kind: 'multiple', books, source: books[0].source, name: books.map(book => book.name || '世界书不可用').join('、'), available: books.every(book => book.available) }
    }
    if (stored.kind === 'none') return { kind: 'none', source: null, name: '', available: true }
    if (stored.kind === 'standalone') {
      const source = { kind: 'standalone', path: stored.path }
      if (stored.available !== true) return { kind: 'standalone', source, name: '', available: false }
      try {
        const record = await read(source)
        return { kind: 'standalone', source, name: record.view.displayName, available: true }
      } catch (error) {
        if (/世界书不存在/.test(str(error && error.message))) return { kind: 'standalone', source, name: '', available: false }
        throw error
      }
    }
    if (stored.kind === 'embedded') {
      const source = { kind: 'card', cardPath: stored.cardPath }
      if (stored.available !== true) return { kind: 'embedded', source, name: '', available: false }
      try {
        const record = await read(source)
        return { kind: 'embedded', source: record.source, name: record.view.displayName, available: true }
      } catch (error) {
        if (/人物卡不存在/.test(str(error && error.message))) return { kind: 'embedded', source, name: '', available: false }
        throw error
      }
    }
    if (card.character_book && typeof card.character_book === 'object') {
      const record = await read({ kind: 'card', cardPath: normalized })
      return { kind: 'embedded', source: record.source, name: record.view.displayName, available: true }
    }
    return { kind: 'none', source: null, name: '', available: true }
  }

  function bindingMatchesSource(current, source) {
    if (current?.kind === 'multiple') return current.books.some(book => bindingMatchesSource(book, source))
    if (!current || !current.source) return false
    if (source.kind === 'card') {
      return current.kind === 'embedded' && current.source.cardPath === source.cardPath
    }
    return current.kind === 'standalone' && current.source.path === source.path
  }

  async function associations(locator) {
    const source = sourceOf(locator)
    const cardPaths = await cards.listPaths()
    const cardRows = []
    for (const cardPath of cardPaths) {
      const card = await cards.read(cardPath)
      if (card === undefined) continue
      const current = await binding(cardPath)
      cardRows.push({
        path: cardPath,
        name: str(card.name),
        bound: bindingMatchesSource(current, source),
        binding: current
      })
    }
    const boundCards = cardRows.filter(function (card) { return card.bound }).map(function (card) {
      return { path: card.path, name: card.name }
    })
    return { source, cards: cardRows, boundCards, conflict: false }
  }

  async function resolveBound(cardPath, card, chat, templateOnly = false, includeGlobals = true) {
    if (chat?.openingWorldbookSnapshot?.version === 1) {
      const snapshot = chat.openingWorldbookSnapshot
      if (snapshot.document === null) return null
      if (templateOnly) return templateRecord(JSON.stringify(snapshot.document), snapshot.source)
      return { source: clone(snapshot.source), document: clone(snapshot.document),
        localChatId: chat.id, view: inspectWorldBookDocument(snapshot.document) }
    }
    // This resolver lives for one bound read only. Binding metadata, the view
    // and the exported document must describe the same resource observation.
    const records = new Map()
    const normalizedCardPath = normalizePath(cardPath, 'card')
    card ??= await cards.read(normalizedCardPath)
    if (card === undefined) throw new Error('人物卡不存在: ' + normalizedCardPath)
    function read(locator) {
      const source = sourceOf(locator)
      const key = JSON.stringify(source)
      if (!records.has(key)) records.set(key, readRecord(source,
        source.kind === 'card' && source.cardPath === normalizedCardPath ? card : undefined, templateOnly))
      return records.get(key)
    }
    const current = await binding(cardPath, { card, read })
    if (current.available !== true) throw new Error('绑定的世界书不存在，请重新绑定或解绑')
    const localSources = current.kind === 'multiple' ? current.books.map(book => book.source) : current.source ? [current.source] : []
    const sources = [], identities = new Set()
    for (const locator of localSources.concat(includeGlobals ? await globalSources() : [])) {
      const source = sourceOf(locator), identity = JSON.stringify(source)
      if (!identities.has(identity)) { identities.add(identity); sources.push(source) }
    }
    if (!sources.length) return null
    if (sources.length === 1) return await read(sources[0])
    const resolved = await Promise.all(sources.map(read))
    const merged = mergeWorldBooks(resolved)
    const source = { kind: 'merged', sources: resolved.map(record => record.source) }
    if (templateOnly) return templateRecord(JSON.stringify(merged.document), source)
    return { source: resolved[0].source, document: merged.document, localChatId: chat?.id, mergedSources: merged.sources, view: inspectWorldBookDocument(merged.document) }
  }

  async function bound(cardPath, card, chat) { return await resolveBound(cardPath, card, chat) }

  async function templateSnapshot(cardPath, card, chat) {
    const record = await resolveBound(cardPath, card, chat, true)
    if (!record) return emptyTemplateSnapshot
    let snapshot = templateSnapshots.get(record)
    if (!snapshot) {
      const worldName = record.view.displayName
      snapshot = freezeJsonProjection({ worldName, worldbooks: { [worldName]: record.document } })
      templateSnapshots.set(record, snapshot)
    }
    return snapshot
  }

  async function bind(cardPath, locator) {
    const normalized = normalizePath(cardPath, 'card')
    const card = await cards.read(normalized)
    if (card === undefined) throw new Error('人物卡不存在: ' + normalized)
    const source = sourceOf(locator)
    if (source.kind === 'card') {
      const owner = await cards.read(source.cardPath)
      if (owner === undefined) throw new Error('人物卡不存在: ' + source.cardPath)
      if (!owner.character_book || typeof owner.character_book !== 'object') throw new Error('该人物卡没有自带世界书')
    }
    const current = await binding(normalized)
    if (bindingMatchesSource(current, source)) return current
    const books = current.kind === 'multiple' ? current.books : current.source ? [current] : []
    return await setBindings(normalized, books.map(book => book.source).concat([source]))
  }

  async function setBindings(cardPath, locators) {
    const normalized = normalizePath(cardPath, 'card')
    if (!Array.isArray(locators)) throw new Error('世界书绑定需要有序列表')
    const sources = locators.map(sourceOf)
    const identities = sources.map(source => JSON.stringify(source))
    if (new Set(identities).size !== identities.length) throw new Error('不能重复绑定同一本世界书')
    for (const source of sources) {
      await readRecord(source)
      if (source.kind === 'card') {
        const owner = await cards.read(source.cardPath)
        if (!owner?.character_book) throw new Error('该人物卡没有自带世界书')
      }
    }
    await resources.bindMany(normalized, sources.map(source => source.kind === 'card' ? { kind: 'embedded', cardPath: source.cardPath } : source))
    return await binding(normalized)
  }

  async function unbind(cardPath, locator) {
    if (!locator) { await resources.unbind(cardPath); return await binding(cardPath) }
    const current = await binding(cardPath)
    const books = current.kind === 'multiple' ? current.books : current.source ? [current] : []
    const source = sourceOf(locator)
    return await setBindings(cardPath, books.filter(book => !bindingMatchesSource(book, source)).map(book => book.source))
  }

  async function importBook(payload) {
    const prepared = prepareWorldBookImport(payload)
    const path = await resources.import(prepared, prepared.working)
    const record = await readRecord({ kind: 'standalone', path })
    return { kind: 'standalone', path, name: record.view.displayName, entryCount: record.view.entryCount }
  }

  async function update(locator, request) {
    const record = await readRecord(locator)
    const changed = updateWorldBookDocument(record.document, request)
    if (record.source.kind === 'card') {
      await cards.update(record.source.cardPath, { character_book: changed.document })
    } else {
      await resources.write(record.source.path, JSON.stringify(changed.document, null, 2))
    }
    return await get(record.source)
  }

  /** Replace through the native ST API, preserving unknown plugin fields. */
  async function replaceNative(locator, document) {
    if (!document || typeof document !== 'object' || Array.isArray(document)
      || !document.entries || typeof document.entries !== 'object' || Array.isArray(document.entries)) {
      throw new Error('原生世界书需要 entries 对象')
    }
    const ids = new Set()
    for (const [key, entry] of Object.entries(document.entries)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Number.isSafeInteger(entry.uid)
        || entry.uid < 0 || String(entry.uid) !== key || ids.has(entry.uid)) throw new Error('世界书条目编号无效或重复')
      ids.add(entry.uid)
    }
    const record = await readRecord(locator)
    const native = clone(document)
    // originalData is conversion provenance, never a second writable authority.
    delete native.originalData
    if (record.source.kind === 'card') {
      await cards.update(record.source.cardPath, { character_book: exportCharacterBook(native, { replace: true }) })
    } else {
      await resources.write(record.source.path, JSON.stringify(native, null, 2))
    }
    return await get(record.source)
  }

  async function exportBook(locator) {
    const record = await readRecord(locator)
    return { name: record.view.displayName, document: exportSillyTavernWorldBook(record.document) }
  }

  async function characterBookForCard(cardPath) {
    const current = await binding(cardPath)
    if (current.kind === 'none') return null
    if (current.available !== true) throw new Error('绑定的世界书不存在，请重新绑定或解绑')
    const record = await resolveBound(cardPath, undefined, undefined, false, false)
    return exportCharacterBook(record.document || record.view.raw)
  }

  async function remove(locator) {
    const source = sourceOf(typeof locator === 'string' ? { kind: 'standalone', path: locator } : locator)
    if (source.kind === 'standalone') return await removeStandalone(source.path)
    await readRecord(source)
    const relations = await associations(source)
    for (const card of relations.boundCards) await unbind(card.path, source)
    await cards.update(source.cardPath, { character_book: null })
    return { removed: source.cardPath, kind: 'embedded' }
  }

  return Object.freeze({ catalog, get, setGlobal, binding, associations, bound, templateSnapshot, bind, setBindings, unbind, import: importBook, update: serializeMutation(update), replaceNative: serializeMutation(replaceNative), export: exportBook, characterBookForCard, remove: serializeMutation(remove) })
}
