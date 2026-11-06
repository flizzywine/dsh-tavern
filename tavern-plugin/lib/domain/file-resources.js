import { createResourceBindings } from './resource-bindings.js'
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createDurableFilePromotion } from '../durable-file-promotion.js'
import { createResourceMutationJournal } from './resource-mutation-journal.js'
import { inspectPreset } from './preset-reading.js'
import { isPng, pngCardTextChunk, pngRawTextChunks, pngWithTextChunks } from './card-assets.js'

const KIND_DIR = Object.freeze({ card: 'cards', preset: 'presets', source: 'materials', script: 'scripts', worldbook: 'worldbooks' })
const INTERNAL_FILE_PATTERNS = Object.freeze([/\.write-lock$/i, /\.pending-\d+-[0-9a-f-]+$/i, /\.staging-[0-9a-f-]+$/i])
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function isInternalFile(name) {
  return INTERNAL_FILE_PATTERNS.some(function (pattern) { return pattern.test(name) })
}

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

async function exists(target) {
  try { await access(target); return true } catch { return false }
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

// Card PNGs embed the whole card (often several MB of worldbook/scripts) in text
// chunks. Thumbnails only need the pixels, so drop tEXt/zTXt/iTXt.
export function stripPngTextChunks(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!Buffer.isBuffer(buffer) || buffer.length <= signature.length || !buffer.subarray(0, signature.length).equals(signature)) return buffer
  const parts = [signature]
  let offset = signature.length
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const end = offset + 12 + length
    if (end > buffer.length) return buffer
    if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') parts.push(buffer.subarray(offset, end))
    offset = end
    if (type === 'IEND') return Buffer.concat(parts)
  }
  return buffer
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
  const durableFiles = options.files || createDurableFilePromotion(options.filePromotion)
  const mutations = options.mutations || createResourceMutationJournal({
    dataRoot,
    files: durableFiles,
    fault: options.mutationFault
  })

  const bindings = createResourceBindings({ dataRoot, durableFiles, absolute, list, normalizeResourcePath })
  const { globalWorldBookSources, setGlobalWorldBook, bindMaterial, unbindMaterial, bindWorldBook, bindWorldBooks,
    unbindWorldBook, worldBookBindingForCard, scriptForCard, scriptBindingsForCards, cardsForMaterial, legacyScriptForCard } = bindings

  function absolute(relative, original = false) {
    const normalized = normalizeResourcePath(relative)
    return path.join(original ? originalsRoot : resourcesRoot, ...normalized.split('/'))
  }

  async function ensure() {
    await mutations.recover()
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

  // Pure judgement step shared by single and batch lookups: pick the original file for `normalized`
  // out of one directory listing. `entries === null` means the original directory does not exist.
  function pickOriginalCardName(normalized, entries) {
    if (entries === null) return null
    const stem = path.posix.basename(normalized, path.posix.extname(normalized))
    const candidates = entries.filter(function (entry) {
      if (!entry.isFile() || path.basename(entry.name, path.extname(entry.name)) !== stem) return false
      const extension = path.extname(entry.name).toLowerCase()
      return extension === '.json' || extension === '.png'
    })
    if (candidates.length === 0) return null
    if (candidates.length > 1) throw new Error('人物卡存在多个原版，无法确定来源: ' + candidates.map(function (entry) { return entry.name }).join('、'))
    return candidates[0].name
  }

  async function readOriginalEntries(originalDir) {
    try { return await readdir(originalDir, { withFileTypes: true }) } catch (error) {
      if (error && error.code === 'ENOENT') return null
      throw error
    }
  }

  async function originalCardName(normalized) {
    return pickOriginalCardName(normalized, await readOriginalEntries(path.dirname(absolute(normalized, true))))
  }

  // Batch form of `originalCardName`: one readdir per distinct original directory, not per card.
  // Returns Map<relativePath (as passed in), originalName|null>.
  async function originalCardNames(relatives) {
    const wanted = []
    for (const relative of relatives || []) {
      wanted.push([relative, normalizeResourcePath(relative, 'card')])
    }
    const dirs = new Set()
    for (const [, normalized] of wanted) dirs.add(path.dirname(absolute(normalized, true)))
    const entriesByDir = new Map()
    await Promise.all(Array.from(dirs).map(async function (dir) {
      entriesByDir.set(dir, await readOriginalEntries(dir))
    }))
    const result = new Map()
    for (const [relative, normalized] of wanted) {
      result.set(relative, pickOriginalCardName(normalized, entriesByDir.get(path.dirname(absolute(normalized, true)))))
    }
    return result
  }

  async function originalCardPayload(normalized) {
    const originalName = await originalCardName(normalized)
    if (originalName === null) return null
    const originalDir = path.dirname(absolute(normalized, true))
    const originalData = await readFile(path.join(originalDir, originalName))
    return path.extname(originalName).toLowerCase() === '.png'
      ? pngCardPayload(originalData, originalName)
      : { kind: 'text', name: originalName, text: originalData.toString('utf8') }
  }

  async function hasCardImage(relative, prefetched) {
    const normalized = normalizeResourcePath(relative, 'card')
    let originalName
    if (prefetched instanceof Map && prefetched.has(relative)) originalName = prefetched.get(relative)
    else if (prefetched instanceof Map && prefetched.has(normalized)) originalName = prefetched.get(normalized)
    else originalName = await originalCardName(normalized)
    return originalName !== null && originalName !== undefined && path.extname(originalName).toLowerCase() === '.png'
  }

  async function readCardImage(relative) {
    const normalized = normalizeResourcePath(relative, 'card')
    const originalName = await originalCardName(normalized)
    if (originalName === null || path.extname(originalName).toLowerCase() !== '.png') return undefined
    return await readFile(path.join(path.dirname(absolute(normalized, true)), originalName))
  }

  // Gives a card a cover by making its original a card PNG: the new pixels, carrying the
  // original's own card data (a JSON original's text, or a PNG original's text chunks).
  // A card with no original at all embeds `fallbackCardText()`. The working copy is untouched.
  async function setCardCover(relative, image, fallbackCardText) {
    const normalized = normalizeResourcePath(relative, 'card')
    if (!await exists(absolute(normalized))) throw new Error('人物卡不存在: ' + normalized)
    if (!isPng(image)) throw new Error('封面必须是 PNG 图片')
    const originalDir = path.dirname(absolute(normalized, true))
    const stem = path.posix.basename(normalized, path.posix.extname(normalized))
    const originalName = await originalCardName(normalized)
    const original = originalName === null ? null : path.join(originalDir, originalName)
    const wasPng = originalName !== null && path.extname(originalName).toLowerCase() === '.png'
    let chunks
    if (wasPng) chunks = pngRawTextChunks(await readFile(original))
    else {
      const text = original ? (await readFile(original)).toString('utf8') : String(await fallbackCardText())
      let spec = ''
      try { spec = String(JSON.parse(text)?.spec || '') } catch (_) {}
      chunks = [pngCardTextChunk('chara', text)]
      if (spec === 'chara_card_v3') chunks.push(pngCardTextChunk('ccv3', text))
    }
    const bytes = pngWithTextChunks(image, chunks)
    await mkdir(originalDir, { recursive: true })
    const target = path.join(originalDir, stem + '.png')
    const temp = target + '.' + randomUUID() + '.tmp'
    await writeFile(temp, bytes)
    try {
      if (original && !wasPng) await rm(original, { force: true })
      await rename(temp, target)
    } catch (error) { await rm(temp, { force: true }); throw error }
    return { path: normalized }
  }

  async function cardImagePreview(relative) {
    const normalized = normalizeResourcePath(relative, 'card')
    const originalName = await originalCardName(normalized)
    if (originalName === null || path.extname(originalName).toLowerCase() !== '.png') return undefined
    const file = path.join(path.dirname(absolute(normalized, true)), originalName)
    const info = await stat(file)
    return {
      revision: '"' + info.size.toString(36) + '-' + Math.trunc(info.mtimeMs).toString(36) + '"',
      read: async function () { return stripPngTextChunks(await readFile(file)) }
    }
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

  async function metadata(relative) {
    const normalized = normalizeResourcePath(relative)
    const workingPath = absolute(normalized)
    let originalPath = absolute(normalized, true)
    if (resourceKind(normalized) === 'card') {
      const originalName = await originalCardName(normalized)
      if (originalName !== null) originalPath = path.join(path.dirname(originalPath), originalName)
    }
    const readStat = async function (target) {
      try { return await stat(target) } catch (error) { if (error && error.code === 'ENOENT') return null; throw error }
    }
    const [working, original] = await Promise.all([readStat(workingPath), readStat(originalPath)])
    return {
      importedAt: Number(original && original.mtimeMs) || Number(working && working.mtimeMs) || 0,
      updatedAt: Number(working && working.mtimeMs) || 0
    }
  }

  async function readCard(relative) {
    const normalized = normalizeResourcePath(relative, 'card')
    const text = await readText(normalized)
    if (text === undefined) return undefined
    try { return JSON.parse(text) } catch {
      throw new Error('人物卡 JSON 格式无效：' + normalized)
    }
  }

  async function scanFiles(folder, prefix) {
    const result = []
    if (!await exists(folder)) return result
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const nextPrefix = prefix === '' ? entry.name : prefix + '/' + entry.name
      const target = path.join(folder, entry.name)
      if (entry.isDirectory()) result.push.apply(result, await scanFiles(target, nextPrefix))
      else if (entry.isFile() && !isInternalFile(entry.name)) result.push(nextPrefix.normalize('NFC'))
    }
    return result.sort(function (a, b) { return a.localeCompare(b, 'zh-CN') })
  }

  async function list(kind) {
    const dir = KIND_DIR[kind]
    if (dir === undefined) throw new Error('未知资源类型: ' + kind)
    return (await scanFiles(path.join(resourcesRoot, dir), '')).map(function (name) { return dir + '/' + name })
  }

  let copyTail = Promise.resolve()
  // options.keepName keeps the character's own name (the library's 「另存副本」); only the
  // file name differs. The agent tool keeps renaming the character to the copy's name.
  function copyCard(sourcePath, name, options = {}) {
    const keepName = options && options.keepName === true
    const operation = copyTail.then(async () => {
      await ensure()
      const source = normalizeResourcePath(sourcePath, 'card')
      let stem = safeResourceName(name).replace(/\.json$/i, '')
      if (options.numbered) {
        const base = source.split('/').pop().replace(/\.json$/i, '')
        let n = 1
        while (await exists(absolute('cards/' + base + ' (' + n + ').json')) || await originalCardName('cards/' + base + ' (' + n + ').json') !== null) n++
        stem = base + ' (' + n + ')'
      }
      const target = normalizeResourcePath('cards/' + stem + '.json', 'card')
      if (source === target || await exists(absolute(target)) || await originalCardName(target) !== null) throw new Error('副本名称已存在，请使用新名称: ' + stem)
      const card = await readCard(source)
      if (!card) throw new Error('人物卡不存在: ' + source)
      const image = await readCardImage(source)
      const saved = clone(card)
      delete saved.id
      delete saved.path
      if (saved.raw && saved.meta) {
        saved.meta.id = randomUUID()
        if (!keepName && saved.raw.data && typeof saved.raw.data === 'object') saved.raw.data.name = stem
        if (!keepName && (Object.hasOwn(saved.raw, 'name') || !saved.raw.data)) saved.raw.name = stem
      } else {
        if (!keepName && saved.data && typeof saved.data === 'object') saved.data.name = stem
        if (!keepName && (Object.hasOwn(saved, 'name') || !saved.data)) saved.name = stem
        if (saved.meta && typeof saved.meta === 'object') saved.meta.id = randomUUID()
      }
      const text = JSON.stringify(saved, null, 2)
      const original = absolute('cards/' + stem + (image ? '.png' : '.json'), true)
      await writeFile(original, image || text, { flag: 'wx' })
      try { await writeFile(absolute(target), text, { flag: 'wx' }) }
      catch (error) { await rm(original, { force: true }); throw error }
      return { path: target, sourcePath: source, imageCopied: !!image }
    })
    copyTail = operation.catch(() => {})
    return operation
  }

  let importCardTail = Promise.resolve()
  function importCard(payload, card, options = {}) {
    const operation = importCardTail.catch(() => {}).then(() => writeImportedCard(payload, card, options))
    importCardTail = operation
    return operation
  }

  async function writeImportedCard(payload, card, options) {
    await ensure()
    if (options.replacePath) {
      const relative = normalizeResourcePath(options.replacePath, 'card')
      const previous = await readCard(relative)
      if (!previous) throw new Error('要更新的人物卡不存在: ' + relative)
      const saved = clone(card)
      if (saved.meta && previous.meta) saved.meta.id = previous.meta.id
      const oldName = await originalCardName(relative)
      const originalDir = path.dirname(absolute(relative, true))
      const stem = path.basename(relative, '.json')
      const original = path.join(originalDir, stem + (payload.kind === 'png' ? '.png' : '.json'))
      const bytes = payload.kind === 'png' ? Buffer.from(payload.fileB64, 'base64') : payload.text || JSON.stringify(card)
      await mutations.run('replace-card:' + relative, async plan => {
        if (oldName && path.join(originalDir, oldName) !== original) await plan.remove(path.join(originalDir, oldName))
        await plan.write(original, bytes)
        await plan.write(absolute(relative), JSON.stringify(saved, null, 2))
      })
      return relative
    }
    let rawName = safeResourceName(payload && payload.name || '未命名人物卡.json')
    if (options.unique) {
      const parsed = path.parse(rawName)
      for (let suffix = 1; ; suffix += 1) {
        const candidate = 'cards/' + path.parse(rawName).name + '.json'
        if (!await exists(absolute(candidate)) && await originalCardName(candidate) === null) break
        rawName = parsed.name + ' (' + suffix + ')' + parsed.ext
      }
    }
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

  async function importText(kind, payload, cardPath, options = {}) {
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
    if (kind === 'source') {
      relative = 'materials/' + name
      if (options.unique) {
        const parsed = path.parse(name)
        for (let suffix = 1; await exists(absolute(relative)) || await exists(absolute(relative, true)); suffix++) {
          relative = 'materials/' + parsed.name + ' (' + suffix + ')' + parsed.ext
        }
      }
    }
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

  async function importBoundScript(edit, cardPath, payload) {
    const card = normalizeResourcePath(cardPath, 'card')
    const name = extensionForText(payload?.name || '未命名剧本.txt')
    const text = str(payload?.text).replace(/\r\n?/g, '\n').trim()
    const existing = 'materials/' + name
    const matches = await readText(existing) === text
    const owners = matches ? await cardsForMaterial(existing) : []
    if (matches && owners.every(owner => owner === card)) {
      await edit.bindMaterial(card, existing)
      return existing
    }
    const imported = await importText('source', payload, undefined, { unique: true })
    try { await edit.bindMaterial(card, imported) }
    catch (error) { await remove(edit, imported); throw error }
    return imported
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
    await mutations.run('replace-script:' + current, async function (plan) {
      if (nextWorking !== oldWorking) await plan.remove(oldWorking)
      if (nextOriginal !== oldOriginal) await plan.remove(oldOriginal)
      await plan.write(nextWorking, text)
      await plan.write(nextOriginal, originalData)
    })
    return next
  }

  async function remove(edit, relative) {
    const normalized = normalizeResourcePath(relative)
    const kind = resourceKind(normalized)
    if (kind === 'source') {
      const boundCards = await cardsForMaterial(normalized)
      if (boundCards.length) throw Object.assign(new Error('剧本仍被人物卡绑定，请先解绑: ' + boundCards.join(', ')), { code: 'DSH_TAVERN_RESOURCE_BOUND' })
    }
    const originalDir = path.dirname(absolute(normalized, true))
    const stem = path.basename(normalized, path.extname(normalized))
    const originals = await exists(originalDir) ? (await readdir(originalDir)).filter(function (name) {
      return path.basename(name, path.extname(name)) === stem
    }).map(function (name) { return path.join(originalDir, name) }) : []
    const recoveryDir = path.join(dataRoot, 'recovery', 'cards')
    const recoveries = kind === 'card' && await exists(recoveryDir) ? (await readdir(recoveryDir)).filter(function (name) {
      return name.startsWith(stem + '-before-') && path.extname(name) === '.json'
    }).map(function (name) { return path.join(recoveryDir, name) }) : []
    const writeBindings = await edit.prepareRemove(normalized, kind)
    await mutations.run('remove-resource:' + normalized, async function (plan) {
      await plan.remove(absolute(normalized))
      for (const target of originals.concat(recoveries)) await plan.remove(target)
      await writeBindings(plan)
    })
  }

  async function renameResource(edit, relative, requestedName) {
    await mutations.recover()
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
    const oldWorkingExists = await exists(oldWorking)
    const newWorkingExists = await exists(newWorking)
    if (!oldWorkingExists && newWorkingExists) {
      let scriptOldPath
      let scriptPath
      if (kind === 'card') {
        const newStem = path.parse(newName).name
        const newScriptDir = path.join(resourcesRoot, 'scripts', newStem)
        if (await exists(newScriptDir)) {
          const names = await readdir(newScriptDir)
          if (names.length === 1) {
            scriptOldPath = 'scripts/' + oldStem + '/' + names[0]
            scriptPath = 'scripts/' + newStem + '/' + names[0]
          }
        }
      }
      return { oldPath, path: newPath, scriptOldPath, scriptPath }
    }
    if (newWorkingExists) throw new Error('文件已存在: ' + newPath)

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
    const writeBindings = await edit.prepareRename(oldPath, newPath, kind)
    await mutations.run('rename-resource:' + oldPath, async function (plan) {
      for (const move of moves) {
        if (move.from !== move.to) await plan.move(move.from, move.to)
      }
      await writeBindings(plan)
    })
    return { oldPath, path: newPath, scriptOldPath, scriptPath }
  }

  async function migrateScriptBindings(edit, index, readChat, writeChat) {
    const bindings = await edit.readMaterials()
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
      await edit.writeMaterials(bindings)
      replacements.set(legacyPath, materialPath)
      await rm(path.dirname(oldWorking), { recursive: true, force: true })
      await rm(path.dirname(oldOriginal), { recursive: true, force: true })
    }
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

  async function migrateLegacy(edit, index, readLegacyJson, writeIndex, readChat, writeChat) {
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
        marker.materialBindings = await migrateScriptBindings(edit, index, readChat, writeChat)
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
    result.materialBindings = await migrateScriptBindings(edit, nextIndex, readChat, writeChat)
    result.schemaVersion = 3
    result.materialBindingsMigratedAt = Date.now()
    result.presetMaterials = await migratePresetMaterials(nextIndex, readChat, writeChat)
    result.schemaVersion = 4
    result.presetMaterialsMigratedAt = Date.now()
    await durableFiles.write(markerPath, JSON.stringify(result, null, 2))
    return result
  }

  return Object.freeze({
    globalWorldBookSources, setGlobalWorldBook, absolute, copyCard, bindMaterial, bindWorldBook, bindWorldBooks,
    cardsForMaterial, cardImagePreview, ensure, ensureCardWorkspace,
    originalCardPayload: relative => originalCardPayload(normalizeResourcePath(relative, 'card')),
    originalCardNames, hasCardImage, importCard,
    importText: (...args) => bindings.mutate(() => importText(...args)),
    importBoundScript: (...args) => bindings.mutate(edit => importBoundScript(edit, ...args)),
    importWorldBook, list, metadata,
    migrateLegacy: (...args) => bindings.mutate(edit => migrateLegacy(edit, ...args)),
    readCard, readCardImage, readText,
    remove: (...args) => bindings.mutate(edit => remove(edit, ...args)),
    rename: (...args) => bindings.mutate(edit => renameResource(edit, ...args)),
    replaceScript, restoreCard, scriptBindingsForCards, setCardCover, scriptForCard,
    unbindMaterial, unbindWorldBook, worldBookBindingForCard, writeWorking
  })
}
