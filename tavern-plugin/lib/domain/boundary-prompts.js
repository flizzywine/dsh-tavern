import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

async function exists(target) {
  try { await access(target); return true } catch { return false }
}

export function normalizeBoundaryPromptFilename(value) {
  let filename = str(value).trim().normalize('NFC')
  if (filename === '') throw new Error('破甲文件名不能为空')
  if (path.basename(filename) !== filename || filename === '.' || filename === '..' || /[<>:"/\\|?*\u0000-\u001F]/.test(filename) || /[. ]$/.test(filename) || WINDOWS_RESERVED.test(filename)) {
    throw new Error('破甲文件名不合法: ' + filename)
  }
  if (path.extname(filename) === '') filename += '.md'
  if (path.extname(filename).toLowerCase() !== '.md') throw new Error('破甲提示词只能保存为 Markdown 文件')
  if (filename.length > 120) throw new Error('破甲文件名不能超过 120 个字符')
  return filename
}

export function createBoundaryPromptModule(options = {}) {
  const directory = path.resolve(str(options.directory))
  if (str(options.directory) === '') throw new Error('Boundary Prompt Module 缺少文件目录')
  if (typeof options.readChat !== 'function' || typeof options.writeChat !== 'function') throw new Error('Boundary Prompt Module 缺少会话存储 Adapter')
  const defaults = Array.isArray(options.defaults) ? options.defaults : []
  const defaultsVersion = Math.max(1, Number(options.defaultsVersion) || 1)
  const marker = path.join(directory, '.defaults-v' + defaultsVersion + '.json')
  const now = typeof options.now === 'function' ? options.now : Date.now

  function target(filename) {
    return path.join(directory, normalizeBoundaryPromptFilename(filename))
  }

  async function ensure() {
    await mkdir(directory, { recursive: true })
    if (await exists(marker)) return
    for (const item of defaults) {
      const filename = normalizeBoundaryPromptFilename(item && item.filename)
      const text = str(item && item.text)
      if (text.trim() === '' || await exists(target(filename))) continue
      await writeFile(target(filename), text, { flag: 'wx' })
    }
    await writeFile(marker, JSON.stringify({ version: defaultsVersion, installedAt: now() }, null, 2), { flag: 'wx' }).catch(async function (error) {
      if (!error || error.code !== 'EEXIST') throw error
    })
  }

  async function read(filename) {
    await ensure()
    const safe = normalizeBoundaryPromptFilename(filename)
    try {
      const text = await readFile(target(safe), 'utf8')
      return { filename: safe, name: path.basename(safe, '.md'), text, chars: text.length }
    } catch (error) {
      if (error && error.code === 'ENOENT') return null
      throw error
    }
  }

  async function list() {
    await ensure()
    const names = (await readdir(directory, { withFileTypes: true }))
      .filter(function (entry) { return entry.isFile() && path.extname(entry.name).toLowerCase() === '.md' })
      .map(function (entry) { return entry.name.normalize('NFC') })
      .sort(function (left, right) { return left.localeCompare(right, 'zh-CN') })
    return await Promise.all(names.map(read))
  }

  async function write(input = {}) {
    await ensure()
    const filename = normalizeBoundaryPromptFilename(input.filename || input.name)
    const text = str(input.text)
    if (text.trim() === '') throw new Error('破甲提示词不能为空')
    if (text.length > 100000) throw new Error('破甲提示词不能超过 100000 个字符')
    const destination = target(filename)
    const present = await exists(destination)
    if (present && input.overwrite !== true) throw new Error('破甲文件已存在；确认修改后请明确覆盖: ' + filename)
    const temporary = destination + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
    const backup = destination + '.bak-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
    await writeFile(temporary, text)
    try {
      if (present) await rename(destination, backup)
      await rename(temporary, destination)
      if (present) await rm(backup, { force: true })
    } catch (error) {
      await rm(temporary, { force: true })
      if (present && await exists(backup) && !await exists(destination)) await rename(backup, destination)
      throw error
    }
    return await read(filename)
  }

  async function remove(filename) {
    await ensure()
    const safe = normalizeBoundaryPromptFilename(filename)
    if (!await exists(target(safe))) throw new Error('破甲文件不存在: ' + safe)
    await rm(target(safe))
    return { removed: safe }
  }

  async function selection(sessionId) {
    const chat = await options.readChat(str(sessionId))
    if (chat === undefined) throw new Error('当前会话没有绑定 Tavern 对话')
    const selected = object(chat.boundaryPrompt)
    const file = str(selected.filename) === '' ? null : await read(selected.filename)
    const enabled = selected.enabled === true && file !== null
    return {
      enabled,
      filename: file === null ? '' : file.filename,
      file: file === null ? null : clone(file),
      lastInjection: enabled && selected.lastInjection && selected.lastInjection.filename === file.filename ? clone(selected.lastInjection) : null
    }
  }

  async function select(input = {}) {
    const chat = await options.readChat(str(input.sessionId))
    if (chat === undefined) throw new Error('当前会话没有绑定 Tavern 对话')
    const enabled = input.enabled === true
    const filename = str(input.filename) === '' ? '' : normalizeBoundaryPromptFilename(input.filename)
    if (enabled && (filename === '' || await read(filename) === null)) throw new Error('请先选择一个有效的破甲文件')
    const previous = object(chat.boundaryPrompt)
    chat.boundaryPrompt = {
      enabled,
      filename,
      ...(previous.lastInjection && typeof previous.lastInjection === 'object' ? { lastInjection: previous.lastInjection } : {})
    }
    chat.updatedAt = now()
    await options.writeChat(chat)
    return await selection(input.sessionId)
  }

  async function resolve(input = {}) {
    const chat = await options.readChat(str(input.sessionId))
    if (chat === undefined) return null
    const selected = object(chat.boundaryPrompt)
    if (selected.enabled !== true || str(selected.filename) === '') return null
    const file = await read(selected.filename)
    if (file === null || file.text.trim() === '') return null
    return { filename: file.filename, text: file.text }
  }

  async function recordInjection(input = {}) {
    const chat = await options.readChat(str(input.sessionId))
    if (chat === undefined) return
    const selected = object(chat.boundaryPrompt)
    if (selected.enabled !== true || selected.filename !== str(input.filename)) return
    selected.lastInjection = {
      filename: selected.filename,
      operation: str(input.operation) || 'model-task',
      turn: Math.max(0, Number(input.turn) || 0),
      at: now()
    }
    chat.boundaryPrompt = selected
    chat.updatedAt = now()
    await options.writeChat(chat)
  }

  return Object.freeze({ list, read, write, remove, selection, select, resolve, recordInjection })
}
