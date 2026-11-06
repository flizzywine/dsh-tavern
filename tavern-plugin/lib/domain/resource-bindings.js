import { access } from 'node:fs/promises'
import path from 'node:path'

const str = value => value == null ? '' : String(value)
async function exists(target) { try { await access(target); return true } catch { return false } }

// Owns binding persistence and its mutation queue. Filesystem operations join
// through mutate(), so rename/import/delete and binding edits share one lock.
export function createResourceBindings({ dataRoot, durableFiles, absolute, list, normalizeResourcePath }) {
  const bindingsPath = path.join(dataRoot, '.material-bindings.json')
  const worldBookBindingsPath = path.join(dataRoot, '.worldbook-bindings.json')
  async function readBindings() {
    try {
      const source = await durableFiles.read(bindingsPath)
      if (source === undefined) return {}
      const value = JSON.parse(source.toString('utf8'))
      return value !== null && typeof value === 'object' ? value : {}
    } catch (error) {
      if (error && error.code === 'ENOENT') return {}
      throw error
    }
  }

  async function writeBindings(bindings) {
    await durableFiles.write(bindingsPath, JSON.stringify(bindings, null, 2))
  }

  async function readWorldBookBindings() {
    try {
      const source = await durableFiles.read(worldBookBindingsPath)
      if (source === undefined) return {}
      const value = JSON.parse(source.toString('utf8'))
      return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
    } catch (error) {
      if (error && error.code === 'ENOENT') return {}
      throw error
    }
  }

  async function writeWorldBookBindings(bindings) {
    await durableFiles.write(worldBookBindingsPath, JSON.stringify(bindings, null, 2))
  }

  async function globalWorldBookSources() {
    const bindings = await readWorldBookBindings()
    return (bindings.$global?.sources || []).map(source => ({ kind: 'standalone', path: normalizeResourcePath(source.path, 'worldbook') }))
  }

  async function setGlobalWorldBook(relative, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('全局生效开关必须为布尔值')
    const bookPath = normalizeResourcePath(relative, 'worldbook')
    if (enabled && !await exists(absolute(bookPath))) throw new Error('世界书不存在: ' + bookPath)
    const bindings = await readWorldBookBindings()
    if ((bindings.$global?.sources || []).some(source => source.path === bookPath) === enabled) return enabled
    const sources = (bindings.$global?.sources || []).filter(source => source.path !== bookPath)
    if (enabled) sources.push({ kind: 'standalone', path: bookPath })
    bindings.$global = { version: 2, sources }
    await writeWorldBookBindings(bindings)
    return enabled
  }

  async function worldBookBindingForCard(cardPath) {
    const card = normalizeResourcePath(cardPath, 'card')
    const bindings = await readWorldBookBindings()
    if (!Object.prototype.hasOwnProperty.call(bindings, card)) return { kind: 'default' }
    const value = bindings[card]
    if (value?.version === 2 && Array.isArray(value.sources)) {
      const sources = await Promise.all(value.sources.map(async source => source.kind === 'embedded'
        ? { kind: 'embedded', cardPath: normalizeResourcePath(source.cardPath, 'card'), available: await exists(absolute(normalizeResourcePath(source.cardPath, 'card'))) }
        : { kind: 'standalone', path: normalizeResourcePath(source.path, 'worldbook'), available: await exists(absolute(normalizeResourcePath(source.path, 'worldbook'))) }))
      return { kind: 'multiple', sources }
    }
    if (value === null) return { kind: 'none' }
    if (typeof value === 'string') {
      const worldBookPath = normalizeResourcePath(value, 'worldbook')
      return { kind: 'standalone', path: worldBookPath, available: await exists(absolute(worldBookPath)) }
    }
    if (value && value.kind === 'embedded') {
      const ownerCardPath = normalizeResourcePath(value.cardPath, 'card')
      return { kind: 'embedded', cardPath: ownerCardPath, available: await exists(absolute(ownerCardPath)) }
    }
    return { kind: 'none' }
  }

  async function bindWorldBook(cardPath, locator) {
    const card = normalizeResourcePath(cardPath, 'card')
    if (!await exists(absolute(card))) throw new Error('人物卡不存在: ' + card)
    const bindings = await readWorldBookBindings()
    if (locator === undefined || locator === null || str(locator) === '') {
      delete bindings[card]
      await writeWorldBookBindings(bindings)
      return { kind: 'default' }
    }
    if (locator && typeof locator === 'object' && locator.kind === 'embedded') {
      const ownerCardPath = normalizeResourcePath(locator.cardPath, 'card')
      if (!await exists(absolute(ownerCardPath))) throw new Error('人物卡不存在: ' + ownerCardPath)
      bindings[card] = { kind: 'embedded', cardPath: ownerCardPath }
      await writeWorldBookBindings(bindings)
      return { kind: 'embedded', cardPath: ownerCardPath, available: true }
    }
    const worldBookValue = locator && typeof locator === 'object' && locator.kind === 'standalone' ? locator.path : locator
    const worldBook = normalizeResourcePath(worldBookValue, 'worldbook')
    if (!await exists(absolute(worldBook))) throw new Error('世界书不存在: ' + worldBook)
    bindings[card] = worldBook
    await writeWorldBookBindings(bindings)
    return { kind: 'standalone', path: worldBook, available: true }
  }

  async function bindWorldBooks(cardPath, sources) {
    const card = normalizeResourcePath(cardPath, 'card')
    if (!await exists(absolute(card))) throw new Error('人物卡不存在: ' + card)
    if (!Array.isArray(sources)) throw new Error('世界书绑定需要有序列表')
    const normalized = []
    const seen = new Set()
    for (const source of sources) {
      const item = source?.kind === 'embedded'
        ? { kind: 'embedded', cardPath: normalizeResourcePath(source.cardPath, 'card') }
        : { kind: 'standalone', path: normalizeResourcePath(source?.path, 'worldbook') }
      const key = JSON.stringify(item)
      if (seen.has(key)) throw new Error('不能重复绑定同一本世界书')
      if (!await exists(absolute(item.path || item.cardPath))) throw new Error('世界书来源不存在: ' + (item.path || item.cardPath))
      seen.add(key)
      normalized.push(item)
    }
    const bindings = await readWorldBookBindings()
    bindings[card] = { version: 2, sources: normalized }
    await writeWorldBookBindings(bindings)
    return await worldBookBindingForCard(card)
  }

  async function unbindWorldBook(cardPath) {
    const card = normalizeResourcePath(cardPath, 'card')
    const bindings = await readWorldBookBindings()
    bindings[card] = null
    await writeWorldBookBindings(bindings)
    return { kind: 'none' }
  }

  async function legacyScriptForCard(cardPath) {
    const normalized = normalizeResourcePath(cardPath, 'card')
    const stem = path.posix.basename(normalized, path.posix.extname(normalized))
    const prefix = 'scripts/' + stem + '/'
    return (await list('script')).find(function (item) { return item.startsWith(prefix) })
  }

  async function scriptForCard(cardPath) {
    const normalized = normalizeResourcePath(cardPath, 'card')
    const bindings = await readBindings()
    const materialPath = bindings[normalized]
    if (typeof materialPath === 'string' && await exists(absolute(materialPath))) return normalizeResourcePath(materialPath, 'source')
    return await legacyScriptForCard(normalized)
  }

  async function scriptBindingsForCards(cardPaths) {
    const cards = Array.from(new Set((Array.isArray(cardPaths) ? cardPaths : []).map(function (cardPath) {
      return normalizeResourcePath(cardPath, 'card')
    })))
    if (cards.length === 0) return {}
    const [bindings, materialPaths, legacyPaths] = await Promise.all([readBindings(), list('source'), list('script')])
    const availableMaterials = new Set(materialPaths)
    const result = {}
    for (const cardPath of cards) {
      const materialPath = bindings[cardPath]
      if (typeof materialPath === 'string') {
        try {
          const normalizedMaterial = normalizeResourcePath(materialPath, 'source')
          if (availableMaterials.has(normalizedMaterial)) { result[cardPath] = normalizedMaterial; continue }
        } catch {}
      }
      const stem = path.posix.basename(cardPath, path.posix.extname(cardPath))
      const prefix = 'scripts/' + stem + '/'
      const legacyPath = legacyPaths.find(function (candidate) { return candidate.startsWith(prefix) })
      if (legacyPath) result[cardPath] = legacyPath
    }
    return result
  }

  async function bindMaterial(cardPath, materialPath) {
    const card = normalizeResourcePath(cardPath, 'card')
    const material = normalizeResourcePath(materialPath, 'source')
    if (!await exists(absolute(card))) throw new Error('人物卡不存在: ' + card)
    if (!await exists(absolute(material))) throw new Error('剧本不存在: ' + material)
    const bindings = await readBindings()
    const boundCard = Object.keys(bindings).find(function (candidate) { return candidate !== card && bindings[candidate] === material })
    if (boundCard !== undefined) throw new Error('剧本已绑定人物卡：' + boundCard)
    bindings[card] = material
    await writeBindings(bindings)
    return material
  }

  async function unbindMaterial(cardPath) {
    const card = normalizeResourcePath(cardPath, 'card')
    const bindings = await readBindings()
    const materialPath = bindings[card]
    delete bindings[card]
    await writeBindings(bindings)
    return typeof materialPath === 'string' ? materialPath : null
  }

  async function cardsForMaterial(materialPath) {
    const material = normalizeResourcePath(materialPath, 'source')
    const bindings = await readBindings()
    return Object.keys(bindings).filter(function (cardPath) { return bindings[cardPath] === material })
  }

  async function prepareRemove(normalized, kind) {
    let worldBookBindings = null
    let worldBookBindingsChanged = false
    if (kind === 'card' || kind === 'worldbook') {
      worldBookBindings = await readWorldBookBindings()
      if (kind === 'card' && Object.prototype.hasOwnProperty.call(worldBookBindings, normalized)) {
        delete worldBookBindings[normalized]
        worldBookBindingsChanged = true
      }
      for (const [cardPath, value] of Object.entries(worldBookBindings)) {
        if (value?.version !== 2 || !Array.isArray(value.sources)) continue
        const sources = value.sources.filter(source => (kind === 'card' ? source.cardPath : source.path) !== normalized)
        if (sources.length !== value.sources.length) {
          worldBookBindings[cardPath] = { version: 2, sources }
          worldBookBindingsChanged = true
        }
      }
      if (kind === 'card') {
        for (const cardPath of Object.keys(worldBookBindings)) {
          const value = worldBookBindings[cardPath]
          if (value && typeof value === 'object' && value.kind === 'embedded' && value.cardPath === normalized) {
            worldBookBindings[cardPath] = null
            worldBookBindingsChanged = true
          }
        }
      }
      if (kind === 'worldbook') {
        for (const cardPath of Object.keys(worldBookBindings)) {
          if (worldBookBindings[cardPath] === normalized) {
            worldBookBindings[cardPath] = null
            worldBookBindingsChanged = true
          }
        }
      }
    }
    return async plan => {
      if (worldBookBindingsChanged) await plan.write(worldBookBindingsPath, JSON.stringify(worldBookBindings, null, 2))
    }
  }
  async function prepareRename(oldPath, newPath, kind) {
    const bindings = await readBindings()
    let bindingsChanged = false
    if (kind === 'card' && Object.prototype.hasOwnProperty.call(bindings, oldPath)) {
      bindings[newPath] = bindings[oldPath]
      delete bindings[oldPath]
      bindingsChanged = true
    } else if (kind === 'source') {
      for (const cardPath of Object.keys(bindings)) {
        if (bindings[cardPath] === oldPath) { bindings[cardPath] = newPath; bindingsChanged = true }
      }
    }
    const worldBookBindings = await readWorldBookBindings()
    let worldBookBindingsChanged = false
    if (kind === 'card' && Object.prototype.hasOwnProperty.call(worldBookBindings, oldPath)) {
      worldBookBindings[newPath] = worldBookBindings[oldPath]
      delete worldBookBindings[oldPath]
      worldBookBindingsChanged = true
    }
    for (const value of Object.values(worldBookBindings)) {
      if (value?.version !== 2 || !Array.isArray(value.sources)) continue
      for (const source of value.sources) {
        const key = kind === 'card' ? 'cardPath' : kind === 'worldbook' ? 'path' : null
        if (key && source[key] === oldPath) { source[key] = newPath; worldBookBindingsChanged = true }
      }
    }
    if (kind === 'card') {
      for (const cardPath of Object.keys(worldBookBindings)) {
        const value = worldBookBindings[cardPath]
        if (value && typeof value === 'object' && value.kind === 'embedded' && value.cardPath === oldPath) {
          worldBookBindings[cardPath] = { kind: 'embedded', cardPath: newPath }
          worldBookBindingsChanged = true
        }
      }
    } else if (kind === 'worldbook') {
      for (const cardPath of Object.keys(worldBookBindings)) {
        if (worldBookBindings[cardPath] === oldPath) { worldBookBindings[cardPath] = newPath; worldBookBindingsChanged = true }
      }
    }
    return async plan => {
      if (bindingsChanged) await plan.write(bindingsPath, JSON.stringify(bindings, null, 2))
      if (worldBookBindingsChanged) await plan.write(worldBookBindingsPath, JSON.stringify(worldBookBindings, null, 2))
    }
  }
  let tail = Promise.resolve()
  const edit = Object.freeze({ bindMaterial, prepareRemove, prepareRename,
    readMaterials: readBindings, writeMaterials: writeBindings })
  function mutate(work) {
    const operation = tail.catch(() => {}).then(() => work(edit))
    tail = operation
    return operation
  }
  const serialized = work => (...args) => mutate(() => work(...args))
  return Object.freeze({
    mutate, globalWorldBookSources, worldBookBindingForCard, scriptForCard, scriptBindingsForCards,
    cardsForMaterial, legacyScriptForCard,
    setGlobalWorldBook: serialized(setGlobalWorldBook), bindMaterial: serialized(bindMaterial),
    unbindMaterial: serialized(unbindMaterial), bindWorldBook: serialized(bindWorldBook),
    bindWorldBooks: serialized(bindWorldBooks), unbindWorldBook: serialized(unbindWorldBook)
  })
}
