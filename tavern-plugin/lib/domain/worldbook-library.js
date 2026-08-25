import { inspectWorldBookDocument, prepareWorldBookImport, updateWorldBookDocument } from './worldbook-resource.js'

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

  async function readRecord(locator) {
    const source = sourceOf(locator)
    if (source.kind === 'card') {
      const card = await cards.read(source.cardPath)
      if (card === undefined) throw new Error('人物卡不存在: ' + source.cardPath)
      const document = embeddedDocument(card)
      return {
        source: { kind: 'card', cardPath: source.cardPath, cardName: card.name },
        document,
        view: inspectWorldBookDocument(document, { filename: card.name })
      }
    }
    const text = await resources.readText(source.path)
    if (text === undefined) throw new Error('世界书不存在: ' + source.path)
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
    return { source: record.source, view: record.view }
  }

  async function catalog() {
    const standalone = await Promise.all((await resources.list('worldbook')).map(async function (path) {
      const record = await readRecord({ kind: 'standalone', path })
      return {
        kind: 'standalone', path: record.source.path, name: record.view.displayName,
        entryCount: record.view.entryCount, enabledCount: record.view.enabledCount,
        diagnostics: record.view.diagnostics.length
      }
    }))
    const embedded = []
    for (const cardPath of await cards.listPaths()) {
      const card = await cards.read(cardPath)
      if (!card || !card.character_book || typeof card.character_book !== 'object') continue
      const record = await readRecord({ kind: 'card', cardPath })
      embedded.push({
        kind: 'card', cardPath, cardName: card.name, name: record.view.displayName,
        entryCount: record.view.entryCount, enabledCount: record.view.enabledCount,
        diagnostics: record.view.diagnostics.length
      })
    }
    return { standalone, embedded }
  }

  async function binding(cardPath) {
    const normalized = normalizePath(cardPath, 'card')
    const card = await cards.read(normalized)
    if (card === undefined) throw new Error('人物卡不存在: ' + normalized)
    const stored = await resources.bindingForCard(normalized)
    if (stored.kind === 'none') return { kind: 'none', source: null, name: '', available: true }
    if (stored.kind === 'standalone') {
      const source = { kind: 'standalone', path: stored.path }
      if (stored.available !== true) return { kind: 'standalone', source, name: '', available: false }
      try {
        const record = await readRecord(source)
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
        const record = await readRecord(source)
        return { kind: 'embedded', source: record.source, name: record.view.displayName, available: true }
      } catch (error) {
        if (/人物卡不存在/.test(str(error && error.message))) return { kind: 'embedded', source, name: '', available: false }
        throw error
      }
    }
    if (card.character_book && typeof card.character_book === 'object') {
      const record = await readRecord({ kind: 'card', cardPath: normalized })
      return { kind: 'embedded', source: record.source, name: record.view.displayName, available: true }
    }
    return { kind: 'none', source: null, name: '', available: true }
  }

  function bindingMatchesSource(current, source) {
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
    return { source, cards: cardRows, boundCards, conflict: boundCards.length > 1 }
  }

  async function bound(cardPath, card) {
    const current = await binding(cardPath)
    if (current.kind === 'none') return null
    if (current.available !== true) throw new Error('绑定的世界书不存在，请重新绑定或解绑')
    if (current.kind === 'embedded' && card) {
      const document = embeddedDocument(card)
      return { source: current.source, view: inspectWorldBookDocument(document, { filename: card.name }) }
    }
    return await get(current.source)
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
    const relations = await associations(source)
    const occupied = relations.boundCards.filter(function (item) { return item.path !== normalized })
    if (occupied.length) throw new Error('该世界书已绑定人物卡：' + occupied.map(function (item) { return item.name || item.path }).join('、'))
    if (source.kind === 'card' && source.cardPath === normalized) await resources.bind(normalized, null)
    else await resources.bind(normalized, source.kind === 'card' ? { kind: 'embedded', cardPath: source.cardPath } : source)
    return await binding(normalized)
  }

  async function unbind(cardPath) {
    await resources.unbind(cardPath)
    return await binding(cardPath)
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

  async function exportBook(locator) {
    const record = await readRecord(locator)
    return { name: record.view.displayName, document: clone(record.document) }
  }

  async function remove(path) {
    return await removeStandalone(normalizePath(path, 'worldbook'))
  }

  return Object.freeze({ catalog, get, binding, associations, bound, bind, unbind, import: importBook, update, export: exportBook, remove })
}
