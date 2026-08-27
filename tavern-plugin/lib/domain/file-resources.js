import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createDurableFilePromotion } from '../durable-file-promotion.js'
import { inspectPreset } from './preset-reading.js'

const KIND_DIR = Object.freeze({ card: 'cards', preset: 'presets', source: 'materials', script: 'scripts', worldbook: 'worldbooks' })
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

async function exists(target) {
  try { await access(target); return true } catch { return false }
}

function comparableJson(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort())
}

export function safeResourceName(value, fallback = '未命名') {
  const name = path.basename(str(value).trim() || fallback).normalize('NFC')
  if (name === '.' || name === '..' || /[<>:"/\\|?*\u0000-\u001F]/.test(name) || /[. ]$/.test(name) || WINDOWS_RESERVED.test(name)) {
    throw new Error('文件名不合法: ' + name)
  }
  return name
}

export function normalizeResourcePath(value, expectedKind) {
  const input = str(value).replace(/\\/g, '/').normalize('NFC')
  if (input === '' || input.startsWith('/') || input.includes('\u0000')) throw new Error('资源路径不合法: ' + input)
  const normalized = path.posix.normalize(input)
  if (normalized === '..' || normalized.startsWith('../') || normalized !== input) throw new Error('资源路径不合法: ' + input)
  const first = normalized.split('/')[0]
  const actualKind = Object.entries(KIND_DIR).find(function (entry) { return entry[1] === first })?.[0]
  if (actualKind === undefined || (expectedKind !== undefined && actualKind !== expectedKind)) throw new Error('资源路径类型不匹配: ' + input)
  return normalized
}

export function resourceKind(value) {
  const normalized = normalizeResourcePath(value)
  return Object.entries(KIND_DIR).find(function (entry) { return normalized.startsWith(entry[1] + '/') })[0]
}

export function resourceUri(value) {
  return 'tavern-file:' + encodeURIComponent(normalizeResourcePath(value))
}

function extensionForText(name, fallback = '.txt') {
  const safe = safeResourceName(name)
  const ext = path.extname(safe).toLowerCase()
  return ext === '.txt' || ext === '.md' || ext === '.json' || ext === '.epub' ? safe : safe + fallback
}

function rawText(record) {
  if (record && record.rawImport && typeof record.rawImport.text === 'string') return record.rawImport.text
  const snapshot = record && record.snapshot
  if (snapshot && Array.isArray(snapshot.chunks)) return snapshot.chunks.map(function (chunk) { return str(chunk && chunk.text) }).join('\n')
  return ''
}

function originalCard(record, card, workingName) {
  const raw = record && record.rawImport
  if (raw && raw.kind === 'png' && typeof raw.fileB64 === 'string' && raw.fileB64 !== '') {
    return { name: path.parse(workingName).name + '.png', data: Buffer.from(raw.fileB64, 'base64') }
  }
  if (raw && typeof raw.text === 'string') return { name: workingName, data: raw.text }
  const snapshot = clone((record && record.snapshot) || card)
  if (snapshot && typeof snapshot === 'object') delete snapshot.id
  return { name: workingName, data: JSON.stringify(snapshot, null, 2) }
}

function pngCardPayload(buffer, name) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!Buffer.isBuffer(buffer) || buffer.length <= signature.length || !buffer.subarray(0, signature.length).equals(signature)) {
    throw new Error('原版人物卡不是有效的 PNG: ' + name)
  }
  let offset = signature.length
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buffer.length) throw new Error('原版人物卡 PNG 数据损坏: ' + name)
    if (type === 'tEXt') {
      const separator = buffer.indexOf(0, dataStart)
      if (separator >= dataStart && separator < dataEnd) {
        const keyword = buffer.toString('ascii', dataStart, separator)
        if (keyword === 'chara' || keyword === 'ccv3') {
          return {
            kind: 'png',
            name,
            b64: buffer.toString('latin1', separator + 1, dataEnd),
            fileB64: buffer.toString('base64')
          }
        }
      }
    }
    if (type === 'IEND') break
    offset = dataEnd + 4
  }
  throw new Error('原版人物卡 PNG 中没有 chara/ccv3 数据: ' + name)
}

export function createFileResourceStore(options = {}) {
  const dataRoot = path.resolve(str(options.dataRoot))
  const resourcesRoot = path.join(dataRoot, 'resources')
  const originalsRoot = path.join(dataRoot, 'originals')
  const legacyRoot = path.join(dataRoot, 'legacy-id-storage')
  const markerPath = path.join(dataRoot, '.file-resources-v1.json')
  const bindingsPath = path.join(dataRoot, '.material-bindings.json')
  const worldBookBindingsPath = path.join(dataRoot, '.worldbook-bindings.json')
  const durableFiles = options.files || createDurableFilePromotion(options.filePromotion)

  function absolute(relative, original = false) {
    const normalized = normalizeResourcePath(relative)
    return path.join(original ? originalsRoot : resourcesRoot, ...normalized.split('/'))
  }

  async function ensure() {
    for (const root of [resourcesRoot, originalsRoot]) {
      for (const folder of Object.values(KIND_DIR)) await mkdir(path.join(root, folder), { recursive: true })
    }
  }

  async function writeNew(target, data) {
    await mkdir(path.dirname(target), { recursive: true })
    if (await exists(target)) throw new Error('文件已存在: ' + path.relative(dataRoot, target))
    await writeFile(target, data)
  }

  async function writeWorking(relative, data) {
    const normalized = normalizeResourcePath(relative)
    const target = absolute(normalized)
    await durableFiles.write(target, data)
  }

  async function originalCardPayload(normalized) {
    const stem = path.posix.basename(normalized, path.posix.extname(normalized))
    const originalDir = path.dirname(absolute(normalized, true))
    let entries
    try { entries = await readdir(originalDir, { withFileTypes: true }) } catch (error) {
      if (error && error.code === 'ENOENT') return null
      throw error
    }
    const candidates = entries.filter(function (entry) {
      if (!entry.isFile() || path.basename(entry.name, path.extname(entry.name)) !== stem) return false
      const extension = path.extname(entry.name).toLowerCase()
      return extension === '.json' || extension === '.png'
    })
    if (candidates.length === 0) return null
    if (candidates.length > 1) throw new Error('人物卡存在多个原版，无法确定来源: ' + candidates.map(function (entry) { return entry.name }).join('、'))
    const originalName = candidates[0].name
    const originalData = await readFile(path.join(originalDir, originalName))
    return path.extname(originalName).toLowerCase() === '.png'
      ? pngCardPayload(originalData, originalName)
      : { kind: 'text', name: originalName, text: originalData.toString('utf8') }
  }

  async function ensureCardWorkspace(relative, migrate) {
    const normalized = normalizeResourcePath(relative, 'card')
    if (typeof migrate !== 'function') throw new Error('缺少人物卡工作区迁移器')
    const workingPath = absolute(normalized)
    const currentText = (await durableFiles.read(workingPath)).toString('utf8')
    const current = JSON.parse(currentText)
    const next = await migrate(current, await originalCardPayload(normalized))
    if (JSON.stringify(next) === JSON.stringify(current)) return current
    const stem = path.posix.basename(normalized, path.posix.extname(normalized))
    const backupName = stem + '-before-workspace-migration-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.json'
    await writeNew(path.join(dataRoot, 'recovery', 'cards', backupName), currentText)
    await durableFiles.write(workingPath, JSON.stringify(next, null, 2))
    return next
  }

  async function restoreCard(relative, prepare) {
    const normalized = normalizeResourcePath(relative, 'card')
    if (typeof prepare !== 'function') throw new Error('缺少原版人物卡解析器')
    const workingPath = absolute(normalized)
    let current
    current = await durableFiles.read(workingPath)
    if (current === undefined) throw new Error('人物卡工作版不存在: ' + normalized)

    const stem = path.posix.basename(normalized, path.posix.extname(normalized))
    const payload = await originalCardPayload(normalized)
    if (payload === null) throw new Error('找不到人物卡原版: ' + normalized)
    const restored = await prepare(payload)
    if (restored === null || typeof restored !== 'object' || Array.isArray(restored)) throw new Error('原版人物卡解析结果无效')
    const saved = clone(restored)
    delete saved.id
    delete saved.path

    const backupName = stem + '-before-original-restore-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.json'
    const backupRelative = 'recovery/cards/' + backupName
    await writeNew(path.join(dataRoot, ...backupRelative.split('/')), current)
    await durableFiles.write(workingPath, JSON.stringify(saved, null, 2))
    return { card: saved, originalPath: 'originals/cards/' + payload.name, backupPath: backupRelative }
  }

  async function readText(relative) {
    const target = absolute(relative)
    const value = await durableFiles.read(target)
    return value === undefined ? undefined : value.toString('utf8')
  }

  async function readCard(relative) {
    const normalized = normalizeResourcePath(relative, 'card')
    const text = await readText(normalized)
    if (text === undefined) return undefined
    return JSON.parse(text)
  }

  async function scanFiles(folder, prefix) {
    const result = []
    if (!await exists(folder)) return result
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const nextPrefix = prefix === '' ? entry.name : prefix + '/' + entry.name
      const target = path.join(folder, entry.name)
      if (entry.isDirectory()) result.push.apply(result, await scanFiles(target, nextPrefix))
      else if (entry.isFile()) result.push(nextPrefix.normalize('NFC'))
    }
    return result.sort(function (a, b) { return a.localeCompare(b, 'zh-CN') })
  }

  async function list(kind) {
    const dir = KIND_DIR[kind]
    if (dir === undefined) throw new Error('未知资源类型: ' + kind)
    return (await scanFiles(path.join(resourcesRoot, dir), '')).map(function (name) { return dir + '/' + name })
  }

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

  async function worldBookBindingForCard(cardPath) {
    const card = normalizeResourcePath(cardPath, 'card')
    const bindings = await readWorldBookBindings()
    if (!Object.prototype.hasOwnProperty.call(bindings, card)) return { kind: 'default' }
    const value = bindings[card]
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

  async function importCard(payload, card) {
    await ensure()
    const rawName = safeResourceName(payload && payload.name || '未命名人物卡.json')
    const workingName = path.parse(rawName).name + '.json'
    const relative = 'cards/' + workingName
    const originalName = payload && payload.kind === 'png' ? path.parse(rawName).name + '.png' : workingName
    const originalData = payload && payload.kind === 'png' && payload.fileB64
      ? Buffer.from(payload.fileB64, 'base64')
      : (typeof (payload && payload.text) === 'string' ? payload.text : JSON.stringify(card, null, 2))
    const saved = clone(card)
    delete saved.id
    await writeNew(absolute('cards/' + originalName, true), originalData)
    try { await writeNew(absolute(relative), JSON.stringify(saved, null, 2)) } catch (error) { await rm(absolute('cards/' + originalName, true), { force: true }); throw error }
    return relative
  }

  async function importText(kind, payload, cardPath) {
    await ensure()
    if (kind !== 'source' && kind !== 'preset' && kind !== 'script') throw new Error('文本资源类型不合法: ' + kind)
    const text = str(payload && payload.text).replace(/\r\n?/g, '\n').trim()
    if (text === '') throw new Error(kind === 'source' ? '剧本文件为空' : (kind === 'preset' ? '预设文件为空' : '剧本文件为空'))
    let name = extensionForText(payload && payload.name || (kind === 'source' ? '未命名剧本.txt' : (kind === 'preset' ? '未命名预设.json' : '未命名剧本.txt')))
    if (kind === 'preset' && path.extname(name).toLowerCase() !== '.json') name = path.parse(name).name + '.json'
    const originalData = typeof (payload && payload.fileB64) === 'string' && payload.fileB64 !== ''
      ? Buffer.from(payload.fileB64, 'base64')
      : (typeof (payload && payload.originalText) === 'string' ? payload.originalText : text)
    let relative
    if (kind === 'source') relative = 'materials/' + name
    else if (kind === 'preset') relative = 'presets/' + name
    else {
      const normalizedCard = normalizeResourcePath(cardPath, 'card')
      const stem = path.posix.basename(normalizedCard, path.posix.extname(normalizedCard))
      if (await scriptForCard(normalizedCard)) throw new Error('人物卡已经绑定剧本，请先删除原剧本')
      relative = 'scripts/' + stem + '/' + name
    }
    await writeNew(absolute(relative, true), originalData)
    try { await writeNew(absolute(relative), text) } catch (error) { await rm(absolute(relative, true), { force: true }); throw error }
    return relative
  }

  async function importWorldBook(payload, working) {
    await ensure()
    const rawName = safeResourceName(payload && payload.name || '未命名世界书.json')
    const name = path.parse(rawName).name + '.json'
    const relative = 'worldbooks/' + name
    const originalData = typeof (payload && payload.originalText) === 'string'
      ? payload.originalText
      : (typeof (payload && payload.text) === 'string' ? payload.text : JSON.stringify(working, null, 2))
    await writeNew(absolute(relative, true), originalData)
    try { await writeNew(absolute(relative), JSON.stringify(working, null, 2)) } catch (error) { await rm(absolute(relative, true), { force: true }); throw error }
    return relative
  }

  async function replaceScript(cardPath, payload) {
    const current = await scriptForCard(cardPath)
    if (!current) return await importText('script', payload, cardPath)
    const text = str(payload && payload.text).replace(/\r\n?/g, '\n').trim()
    if (text === '') throw new Error('剧本文件为空')
    const originalData = typeof (payload && payload.fileB64) === 'string' && payload.fileB64 !== ''
      ? Buffer.from(payload.fileB64, 'base64')
      : text
    const normalizedCard = normalizeResourcePath(cardPath, 'card')
    const stem = path.posix.basename(normalizedCard, path.posix.extname(normalizedCard))
    const name = extensionForText(payload && payload.name || '未命名剧本.txt')
    const next = 'scripts/' + stem + '/' + name
    const oldWorking = absolute(current)
    const oldOriginal = absolute(current, true)
    const nextWorking = absolute(next)
    const nextOriginal = absolute(next, true)
    if (next !== current && (await exists(nextWorking) || await exists(nextOriginal))) throw new Error('文件已存在: ' + next)
    const suffix = '.replace-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    const tempWorking = nextWorking + suffix
    const tempOriginal = nextOriginal + suffix
    const backupWorking = oldWorking + suffix + '.bak'
    const backupOriginal = oldOriginal + suffix + '.bak'
    await mkdir(path.dirname(nextWorking), { recursive: true })
    await mkdir(path.dirname(nextOriginal), { recursive: true })
    await writeFile(tempWorking, text)
    await writeFile(tempOriginal, originalData)
    let workingBackedUp = false
    let originalBackedUp = false
    try {
      await rename(oldWorking, backupWorking); workingBackedUp = true
      if (await exists(oldOriginal)) { await rename(oldOriginal, backupOriginal); originalBackedUp = true }
      await rename(tempWorking, nextWorking)
      await rename(tempOriginal, nextOriginal)
      await rm(backupWorking, { force: true })
      await rm(backupOriginal, { force: true })
      return next
    } catch (error) {
      await rm(tempWorking, { force: true }); await rm(tempOriginal, { force: true })
      if (workingBackedUp && await exists(backupWorking)) { await rm(oldWorking, { force: true }); await rename(backupWorking, oldWorking) }
      else if (nextWorking !== oldWorking) await rm(nextWorking, { force: true })
      if (originalBackedUp && await exists(backupOriginal)) { await rm(oldOriginal, { force: true }); await rename(backupOriginal, oldOriginal) }
      else if (nextOriginal !== oldOriginal) await rm(nextOriginal, { force: true })
      throw error
    }
  }

  async function remove(relative) {
    const normalized = normalizeResourcePath(relative)
    const kind = resourceKind(normalized)
    if (kind === 'source') {
      const boundCards = await cardsForMaterial(normalized)
      if (boundCards.length) throw new Error('剧本仍被人物卡绑定，请先解绑: ' + boundCards.join(', '))
    }
    await rm(absolute(normalized), { force: true })
    const originalDir = path.dirname(absolute(normalized, true))
    const stem = path.basename(normalized, path.extname(normalized))
    if (await exists(originalDir)) {
      for (const name of await readdir(originalDir)) {
        if (path.basename(name, path.extname(name)) === stem) await rm(path.join(originalDir, name), { force: true })
      }
    }
    if (kind === 'card') {
      const recoveryDir = path.join(dataRoot, 'recovery', 'cards')
      if (await exists(recoveryDir)) {
        const prefix = stem + '-before-'
        for (const name of await readdir(recoveryDir)) {
          if (name.startsWith(prefix) && path.extname(name) === '.json') {
            await rm(path.join(recoveryDir, name), { force: true })
          }
        }
      }
    }
    if (kind === 'card' || kind === 'worldbook') {
      const worldBookBindings = await readWorldBookBindings()
      let changed = false
      if (kind === 'card' && Object.prototype.hasOwnProperty.call(worldBookBindings, normalized)) {
        delete worldBookBindings[normalized]
        changed = true
      }
      if (kind === 'card') {
        for (const cardPath of Object.keys(worldBookBindings)) {
          const value = worldBookBindings[cardPath]
          if (value && typeof value === 'object' && value.kind === 'embedded' && value.cardPath === normalized) {
            worldBookBindings[cardPath] = null
            changed = true
          }
        }
      }
      if (kind === 'worldbook') {
        for (const cardPath of Object.keys(worldBookBindings)) {
          if (worldBookBindings[cardPath] === normalized) {
            worldBookBindings[cardPath] = null
            changed = true
          }
        }
      }
      if (changed) await writeWorldBookBindings(worldBookBindings)
    }
  }

  async function renameResource(relative, requestedName) {
    const oldPath = normalizeResourcePath(relative)
    const kind = resourceKind(oldPath)
    const oldName = path.posix.basename(oldPath)
    const oldStem = path.posix.basename(oldName, path.posix.extname(oldName))
    let newName = safeResourceName(requestedName)
    if (kind === 'card') newName = path.parse(newName).name + '.json'
    else if (path.extname(newName) === '') newName += path.extname(oldName)
    const parent = path.posix.dirname(oldPath)
    const newPath = parent + '/' + newName
    if (newPath === oldPath) return { oldPath, path: newPath }
    const oldWorking = absolute(oldPath)
    const newWorking = absolute(newPath)
    if (await exists(newWorking)) throw new Error('文件已存在: ' + newPath)

    const moves = [{ from: oldWorking, to: newWorking }]
    const originalParent = path.dirname(absolute(oldPath, true))
    if (await exists(originalParent)) {
      for (const name of await readdir(originalParent)) {
        if (path.basename(name, path.extname(name)) !== oldStem) continue
        const originalName = path.parse(newName).name + path.extname(name)
        moves.push({ from: path.join(originalParent, name), to: path.join(originalParent, originalName) })
      }
    }
    let scriptOldPath
    let scriptPath
    if (kind === 'card') {
      scriptOldPath = await scriptForCard(oldPath)
      const oldScriptDir = path.join(resourcesRoot, 'scripts', oldStem)
      if (await exists(oldScriptDir)) {
        const newStem = path.parse(newName).name
        const newScriptDir = path.join(resourcesRoot, 'scripts', newStem)
        const newOriginalScriptDir = path.join(originalsRoot, 'scripts', newStem)
        if (await exists(newScriptDir) || await exists(newOriginalScriptDir)) throw new Error('同名人物卡的剧本目录已存在: scripts/' + newStem)
        moves.push({ from: oldScriptDir, to: newScriptDir })
        const oldOriginalScriptDir = path.join(originalsRoot, 'scripts', oldStem)
        if (await exists(oldOriginalScriptDir)) moves.push({ from: oldOriginalScriptDir, to: newOriginalScriptDir })
        if (scriptOldPath) scriptPath = 'scripts/' + newStem + '/' + path.posix.basename(scriptOldPath)
      }
    }
    for (const move of moves) {
      if (move.from !== move.to && await exists(move.to)) throw new Error('文件已存在: ' + path.relative(dataRoot, move.to))
    }
    const completed = []
    try {
      for (const move of moves) {
        if (move.from === move.to) continue
        await mkdir(path.dirname(move.to), { recursive: true })
        await rename(move.from, move.to)
        completed.push(move)
      }
    } catch (error) {
      for (const move of completed.reverse()) {
        try { await rename(move.to, move.from) } catch {}
      }
      throw error
    }
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
    if (bindingsChanged) await writeBindings(bindings)
    const worldBookBindings = await readWorldBookBindings()
    let worldBookBindingsChanged = false
    if (kind === 'card' && Object.prototype.hasOwnProperty.call(worldBookBindings, oldPath)) {
      worldBookBindings[newPath] = worldBookBindings[oldPath]
      delete worldBookBindings[oldPath]
      worldBookBindingsChanged = true
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
    if (worldBookBindingsChanged) await writeWorldBookBindings(worldBookBindings)
    return { oldPath, path: newPath, scriptOldPath, scriptPath }
  }

  async function migrateScriptBindings(index, readChat, writeChat) {
    const bindings = await readBindings()
    const replacements = new Map()
    for (const cardPath of await list('card')) {
      if (typeof bindings[cardPath] === 'string' && await exists(absolute(bindings[cardPath]))) continue
      const legacyPath = await legacyScriptForCard(cardPath)
      if (!legacyPath) continue
      const materialPath = 'materials/' + path.posix.basename(legacyPath)
      const oldWorking = absolute(legacyPath)
      const oldOriginal = absolute(legacyPath, true)
      const materialWorking = absolute(materialPath)
      const materialOriginal = absolute(materialPath, true)
      if (!await exists(materialWorking)) {
        await mkdir(path.dirname(materialWorking), { recursive: true })
        await rename(oldWorking, materialWorking)
        if (await exists(oldOriginal)) {
          await mkdir(path.dirname(materialOriginal), { recursive: true })
          await rename(oldOriginal, materialOriginal)
        }
      } else {
        const cardStem = path.posix.basename(cardPath, path.posix.extname(cardPath))
        const archiveWorking = path.join(legacyRoot, 'script-copies', cardStem, path.posix.basename(legacyPath))
        const archiveOriginal = path.join(legacyRoot, 'script-copies-originals', cardStem, path.posix.basename(legacyPath))
        await mkdir(path.dirname(archiveWorking), { recursive: true })
        await rename(oldWorking, archiveWorking)
        if (await exists(oldOriginal)) {
          await mkdir(path.dirname(archiveOriginal), { recursive: true })
          await rename(oldOriginal, archiveOriginal)
        }
      }
      bindings[cardPath] = materialPath
      await writeBindings(bindings)
      replacements.set(legacyPath, materialPath)
      await rm(path.dirname(oldWorking), { recursive: true, force: true })
      await rm(path.dirname(oldOriginal), { recursive: true, force: true })
    }
    await writeBindings(bindings)
    if (replacements.size) {
      for (const row of index.chats || []) {
        const chat = await readChat(row.id)
        if (!chat || !chat.workspace || !Array.isArray(chat.workspace.mountedResources)) continue
        let changed = false
        chat.workspace.mountedResources = chat.workspace.mountedResources.map(function (item) {
          if (!item || !replacements.has(item.path)) return item
          changed = true
          const nextPath = replacements.get(item.path)
          return Object.assign({}, item, { kind: 'source', path: nextPath, label: path.posix.basename(nextPath) })
        })
        if (changed) await writeChat(chat)
      }
    }
    return Object.fromEntries(replacements)
  }

  async function migratePresetMaterials(index, readChat, writeChat) {
    const replacements = new Map()
    for (const materialPath of await list('source')) {
      if (path.posix.extname(materialPath).toLowerCase() !== '.json') continue
      const text = await readText(materialPath)
      if (text === undefined || !inspectPreset(text, materialPath).recognized) continue
      const presetPath = 'presets/' + path.posix.basename(materialPath)
      if (await exists(absolute(presetPath)) || await exists(absolute(presetPath, true))) continue
      const moves = [{ from: absolute(materialPath), to: absolute(presetPath) }]
      if (await exists(absolute(materialPath, true))) moves.push({ from: absolute(materialPath, true), to: absolute(presetPath, true) })
      for (const move of moves) {
        await mkdir(path.dirname(move.to), { recursive: true })
        await rename(move.from, move.to)
      }
      replacements.set(materialPath, presetPath)
    }
    if (replacements.size > 0) {
      for (const row of index.chats || []) {
        const chat = await readChat(row.id)
        if (!chat || !chat.workspace || typeof chat.workspace !== 'object') continue
        let changed = false
        const nextSources = (chat.workspace.sourcePaths || []).filter(function (item) { return !replacements.has(item) })
        if (JSON.stringify(nextSources) !== JSON.stringify(chat.workspace.sourcePaths || [])) { chat.workspace.sourcePaths = nextSources; changed = true }
        const nextMounted = (chat.workspace.mountedResources || []).map(function (item) {
          if (!item || !replacements.has(item.path)) return item
          changed = true
          const nextPath = replacements.get(item.path)
          return Object.assign({}, item, { kind: 'preset', path: nextPath })
        })
        chat.workspace.mountedResources = nextMounted
        if (changed) await writeChat(chat)
      }
    }
    return Object.fromEntries(replacements)
  }

  async function migrateLegacy(index, readLegacyJson, writeIndex, readChat, writeChat) {
    await ensure()
    if (await exists(markerPath)) {
      const marker = JSON.parse(await readFile(markerPath, 'utf8'))
      if (Number(marker.schemaVersion) < 2) {
        for (const [legacyId, cardPath] of Object.entries(marker.cardMap || {})) {
          const initialPath = path.join(legacyRoot, 'initial', 'cards', legacyId + '.json')
          if (!await exists(initialPath)) continue
          const initial = JSON.parse(await readFile(initialPath, 'utf8'))
          if (initial && initial.rawImport) continue
          const originalPath = absolute(cardPath, true)
          if (!await exists(originalPath)) continue
          const card = JSON.parse(await readFile(originalPath, 'utf8'))
          if (card && Object.prototype.hasOwnProperty.call(card, 'id')) {
            delete card.id
            await durableFiles.write(originalPath, JSON.stringify(card, null, 2))
          }
        }
        marker.schemaVersion = 2
      }
      if (Number(marker.schemaVersion) < 3) {
        marker.materialBindings = await migrateScriptBindings(index, readChat, writeChat)
        marker.schemaVersion = 3
        marker.materialBindingsMigratedAt = Date.now()
      }
      if (Number(marker.schemaVersion) < 4) {
        marker.presetMaterials = await migratePresetMaterials(index, readChat, writeChat)
        marker.schemaVersion = 4
        marker.presetMaterialsMigratedAt = Date.now()
      }
      await durableFiles.write(markerPath, JSON.stringify(marker, null, 2))
      return marker
    }
    const cardMap = {}
    const sourceMap = {}
    const scriptMap = {}
    for (const item of index.cards || []) {
      const card = await readLegacyJson('cards/' + item.id + '.json')
      if (!card) continue
      const name = safeResourceName(str(card.name).trim() || item.id) + '.json'
      const relative = 'cards/' + name
      const saved = clone(card); delete saved.id
      await writeNew(absolute(relative), JSON.stringify(saved, null, 2))
      const initial = await readLegacyJson('initial/cards/' + item.id + '.json')
      const original = originalCard(initial, saved, name)
      await writeNew(absolute('cards/' + original.name, true), original.data)
      cardMap[item.id] = relative
      const legacyScript = await readLegacyJson('scripts/' + item.id + '.json')
      if (legacyScript) {
        const scriptName = extensionForText(legacyScript.title || '剧本.txt')
        const scriptPath = 'scripts/' + path.parse(name).name + '/' + scriptName
        const initialScript = await readLegacyJson('initial/scripts/' + item.id + '.json')
        const text = rawText(initialScript) || (legacyScript.chunks || []).map(function (chunk) { return str(chunk.text) }).join('\n')
        await writeNew(absolute(scriptPath), text)
        await writeNew(absolute(scriptPath, true), text)
        scriptMap[item.id] = scriptPath
      }
    }
    for (const item of index.sources || []) {
      const source = await readLegacyJson('sources/' + item.id + '.json')
      if (!source) continue
      const name = extensionForText(source.title || item.title || item.id + '.txt')
      const relative = 'materials/' + name
      const text = (source.chunks || []).map(function (chunk) { return str(chunk.text) }).join('\n')
      const initial = await readLegacyJson('initial/sources/' + item.id + '.json')
      await writeNew(absolute(relative), text)
      await writeNew(absolute(relative, true), rawText(initial) || text)
      sourceMap[item.id] = relative
    }
    const convertMounted = function (items) {
      return (Array.isArray(items) ? items : []).map(function (item) {
        const mapped = item.kind === 'card' ? cardMap[item.id] : (item.kind === 'source' ? sourceMap[item.id] : scriptMap[item.id])
        return mapped ? { kind: item.kind, path: mapped, label: item.label } : null
      }).filter(Boolean)
    }
    for (const row of index.chats || []) {
      const chat = await readChat(row.id)
      if (!chat) continue
      chat.cardPath = cardMap[chat.cardId] || str(chat.cardPath)
      delete chat.cardId
      if (chat.workspace && typeof chat.workspace === 'object') {
        chat.workspace.sourcePaths = (chat.workspace.sourceIds || []).map(function (id) { return sourceMap[id] }).filter(Boolean)
        delete chat.workspace.sourceIds
        chat.workspace.mountedResources = convertMounted(chat.workspace.mountedResources)
      }
      await writeChat(chat)
      row.cardPath = chat.cardPath
      delete row.cardId
    }
    const nextIndex = { schemaVersion: 2, chats: index.chats || [] }
    await writeIndex(nextIndex)
    await mkdir(legacyRoot, { recursive: true })
    for (const folder of ['cards', 'sources', 'scripts', 'initial']) {
      const from = path.join(dataRoot, folder)
      const to = path.join(legacyRoot, folder)
      if (await exists(from) && !await exists(to)) await rename(from, to)
    }
    const result = { schemaVersion: 2, migratedAt: Date.now(), cardMap, sourceMap, scriptMap }
    result.materialBindings = await migrateScriptBindings(nextIndex, readChat, writeChat)
    result.schemaVersion = 3
    result.materialBindingsMigratedAt = Date.now()
    result.presetMaterials = await migratePresetMaterials(nextIndex, readChat, writeChat)
    result.schemaVersion = 4
    result.presetMaterialsMigratedAt = Date.now()
    await durableFiles.write(markerPath, JSON.stringify(result, null, 2))
    return result
  }

  return Object.freeze({ absolute, bindMaterial, bindWorldBook, cardsForMaterial, ensure, ensureCardWorkspace, importCard, importText, importWorldBook, list, migrateLegacy, readCard, readText, remove, rename: renameResource, replaceScript, restoreCard, scriptForCard, unbindMaterial, unbindWorldBook, worldBookBindingForCard, writeWorking })
}
