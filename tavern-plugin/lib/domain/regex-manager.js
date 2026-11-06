import { createHash, randomUUID } from 'node:crypto'
import { applyTavernRegexText } from './tavern-regex-display.js'
import { regexScriptsFromImport } from './regex-library.js'

// One manager for every regex layer DSH applies to a Tavern session:
// global rules live in tavern-extension-settings.json, preset rules come from the
// conversation's pinned snapshot, card rules from the card used by that session.
// Preset/card switches are conversation overrides; source files are never rewritten.

const PLACEMENTS = new Set([1, 2, 3, 5, 6])

function str(value) {
  return value === undefined || value === null ? '' : String(value)
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function basename(path) {
  return str(path).split(/[\\/]/).filter(Boolean).pop() || ''
}

export function normalizeRegexScript(value, index = 0) {
  const script = object(value) ? value : {}
  const fallback = 'regex-' + (index + 1)
  const id = str(script.id).trim() || fallback
  return {
    id,
    name: str(script.scriptName || script.name).trim() || id,
    findRegex: str(script.findRegex),
    replaceString: str(script.replaceString),
    trimStrings: Array.isArray(script.trimStrings) ? script.trimStrings.map(str) : [],
    placement: Array.isArray(script.placement)
      ? script.placement.map(Number).filter(number => PLACEMENTS.has(number))
      : [],
    enabled: script.disabled !== true && script.enabled !== false,
    markdownOnly: script.markdownOnly === true,
    promptOnly: script.promptOnly === true,
    runOnEdit: script.runOnEdit === true,
    substituteRegex: script.substituteRegex === undefined ? null : script.substituteRegex,
    minDepth: numberOrNull(script.minDepth),
    maxDepth: numberOrNull(script.maxDepth)
  }
}

/**
 * Stable key for a conversation override. Preset snapshots already carry a
 * unique regexKey; card scripts carry an id (and sometimes a ref).
 */
export function regexScriptKey(source, script, index = 0) {
  const value = object(script) ? script : {}
  if (source === 'preset') return str(value.regexKey).trim() || str(value.id).trim() || 'regex-' + (index + 1)
  return str(value.id).trim() || str(value.ref).trim() || 'regex-' + (index + 1)
}

export function normalizeRegexOverrides(value) {
  const source = object(value) ? value : {}
  function group(key) {
    const items = object(source[key]) ? source[key] : {}
    const result = {}
    for (const [rawKey, rawValue] of Object.entries(items)) {
      const key = str(rawKey).trim()
      if (!key || key.length > 200 || typeof rawValue !== 'boolean') continue
      result[key] = rawValue
    }
    return result
  }
  return { preset: group('preset'), card: group('card') }
}

/** Overlay conversation overrides without mutating the source scripts. */
export function applyRegexOverrides(scripts, overrides, source) {
  const list = Array.isArray(scripts) ? scripts : []
  const map = object(overrides) ? overrides : null
  if (!map || Object.keys(map).length === 0) return list
  return list.map(function (script, index) {
    const key = regexScriptKey(source, script, index)
    if (!Object.prototype.hasOwnProperty.call(map, key)) return script
    return { ...script, enabled: map[key] === true }
  })
}

/** Projection entry for the manager UI. */
export function regexEntry(source, script, index, overrides) {
  const normalized = normalizeRegexScript(script, index)
  const key = regexScriptKey(source, script, index)
  const overridden = object(overrides) && Object.prototype.hasOwnProperty.call(overrides, key)
  return {
    key,
    source,
    id: normalized.id,
    name: normalized.name,
    findRegex: normalized.findRegex,
    replaceString: normalized.replaceString,
    trimStrings: normalized.trimStrings,
    placement: normalized.placement,
    markdownOnly: normalized.markdownOnly,
    promptOnly: normalized.promptOnly,
    runOnEdit: normalized.runOnEdit,
    minDepth: normalized.minDepth,
    maxDepth: normalized.maxDepth,
    sourceEnabled: normalized.enabled,
    overridden: overridden === true,
    enabled: overridden ? overrides[key] === true : normalized.enabled,
    invalid: normalized.findRegex.trim() === ''
  }
}

/** Build the stored SillyTavern-shaped script, keeping fields added by other tools. */
export function storedRegexScript(value, existing, nowId = randomUUID) {
  const script = object(value) ? value : {}
  const base = object(existing) ? clone(existing) : {}
  const findRegex = str(script.findRegex)
  if (findRegex.trim() === '') throw new Error('查找正则不能为空')
  const name = str(script.name !== undefined ? script.name : script.scriptName).trim().slice(0, 120) || '未命名正则'
  const placement = Array.isArray(script.placement)
    ? [...new Set(script.placement.map(Number).filter(number => PLACEMENTS.has(number)))].sort((left, right) => left - right)
    : []
  const trimStrings = Array.isArray(script.trimStrings) ? script.trimStrings.map(str).filter(Boolean) : []
  const minDepth = numberOrNull(script.minDepth)
  const maxDepth = numberOrNull(script.maxDepth)
  const enabled = script.disabled !== true && script.enabled !== false
  const id = str(base.id || script.id).trim() || nowId()
  const next = {
    ...base,
    id,
    scriptName: name,
    findRegex,
    replaceString: str(script.replaceString),
    trimStrings,
    placement,
    disabled: !enabled,
    markdownOnly: script.markdownOnly === true,
    promptOnly: script.promptOnly === true,
    runOnEdit: script.runOnEdit === true
  }
  delete next.enabled
  delete next.minDepth
  delete next.maxDepth
  if (minDepth !== null) next.minDepth = minDepth
  if (maxDepth !== null) next.maxDepth = maxDepth
  return next
}

export function regexRevision(scripts) {
  return createHash('sha256').update(JSON.stringify(Array.isArray(scripts) ? scripts : [])).digest('hex')
}

function presetScriptsOf(chat) {
  const snapshot = object(chat?.runtimePresetSnapshot) ? chat.runtimePresetSnapshot : null
  return Array.isArray(snapshot?.regexScripts) ? snapshot.regexScripts : []
}

/**
 * `regexSettings` owns global persistence, `legacyLibrary` is only used once to
 * move old inert imports into global rules, `readCardSources` returns raw card
 * extensions without applying global/override layers, and `updateChat` writes
 * conversation overrides.
 */
export function createRegexManager({ regexSettings, legacyLibrary, chatForSession, groupOfMode, readCardSources, updateChat }) {
  async function migrateLegacy() {
    const items = await legacyLibrary.legacyForMigration()
    if (!items.length) return 0
    const valid = items.filter(function (item) {
      return object(item) && object(item.script) && str(item.script.findRegex).trim() !== ''
    })
    let added = 0
    await regexSettings.mutate(function (current) {
      const known = new Set(current.map(function (script) { return str(script && script.id) }).filter(Boolean))
      const next = current.slice()
      for (const item of valid) {
        const script = clone(item.script)
        const id = str(script.id).trim() || str(item.id).trim() || randomUUID()
        if (known.has(id)) continue
        known.add(id)
        next.push({
          ...script,
          id,
          scriptName: str(item.name).trim() || str(script.scriptName || script.name).trim() || '未命名正则',
          disabled: true
        })
        added++
      }
      return next
    })
    await legacyLibrary.markMigrated()
    return added
  }

  async function projectSession(chat, overrides) {
    if (!chat) return { mode: '', preset: null, card: null }
    const play = groupOfMode(chat.mode) === 'play'
    if (!play) return { mode: str(chat.mode), preset: null, card: null }
    let preset = null
    const snapshot = object(chat.runtimePresetSnapshot) ? chat.runtimePresetSnapshot : null
    if (snapshot) {
      const path = str(snapshot.presetPath || chat.runtimePresetPath)
      preset = {
        path,
        name: str(snapshot.presetName).trim() || basename(path) || '本局预设',
        scripts: presetScriptsOf(chat).map(function (script, index) { return regexEntry('preset', script, index, overrides.preset) })
      }
    }
    let card = null
    if (str(chat.cardPath) !== '') {
      let sources = null
      try { sources = await readCardSources(chat.cardPath, chat) } catch { sources = null }
      card = {
        path: str(chat.cardPath),
        name: str(chat.cardName).trim() || basename(chat.cardPath) || '本局人物卡',
        scripts: (Array.isArray(sources?.regexScripts) ? sources.regexScripts : []).map(function (script, index) {
          return regexEntry('card', script, index, overrides.card)
        })
      }
    }
    return { mode: str(chat.mode), preset, card }
  }

  async function read(sessionId) {
    let regexes = await regexSettings.read()
    let migrated = 0
    let warning = ''
    try {
      migrated = await migrateLegacy()
      if (migrated > 0) regexes = await regexSettings.read()
    } catch (error) {
      warning = str(error && error.message || error)
    }
    let chat = null
    if (str(sessionId) !== '') {
      try { chat = await chatForSession(sessionId) } catch { chat = null }
    }
    const overrides = normalizeRegexOverrides(chat && chat.regexOverrides)
    const session = await projectSession(chat, overrides)
    return {
      sessionId: str(sessionId),
      mode: session.mode,
      revision: regexRevision(regexes),
      global: regexes.map(function (script, index) { return regexEntry('global', script, index, null) }),
      preset: session.preset,
      card: session.card,
      overrides,
      migrated,
      warning
    }
  }

  async function writeGlobal({ revision, scripts }) {
    const current = await regexSettings.read()
    if (str(revision) !== '' && regexRevision(current) !== str(revision)) throw new Error('正则已被其他窗口修改，请刷新后重试')
    if (!Array.isArray(scripts)) throw new Error('正则列表无效')
    const byId = new Map(current.map(function (script) { return [str(script && script.id), script] }))
    const seen = new Set()
    const next = scripts.map(function (script) {
      const existing = byId.get(str(script && script.id))
      const stored = storedRegexScript(script, existing)
      if (seen.has(stored.id)) stored.id = randomUUID()
      seen.add(stored.id)
      return stored
    })
    const saved = await regexSettings.write(next, current)
    return {
      revision: regexRevision(saved),
      global: saved.map(function (script, index) { return regexEntry('global', script, index, null) })
    }
  }

  async function importGlobal({ text, fileName, revision }) {
    const current = await regexSettings.read()
    if (str(revision) !== '' && regexRevision(current) !== str(revision)) throw new Error('正则已被其他窗口修改，请刷新后重试')
    const imported = regexScriptsFromImport(text, fileName)
    const known = new Set(current.map(function (script) { return str(script && script.id) }).filter(Boolean))
    const next = current.concat(imported.map(function (script) {
      const stored = storedRegexScript(script, null)
      if (known.has(stored.id)) stored.id = randomUUID()
      known.add(stored.id)
      return stored
    }))
    const saved = await regexSettings.write(next, current)
    return {
      imported: imported.length,
      revision: regexRevision(saved),
      global: saved.map(function (script, index) { return regexEntry('global', script, index, null) })
    }
  }

  async function setOverrides({ sessionId, changes }) {
    if (!Array.isArray(changes) || changes.length === 0) throw new Error('没有要修改的正则')
    const normalized = new Map()
    for (const change of changes) {
      const source = change && (change.source === 'preset' || change.source === 'card') ? change.source : ''
      if (!source) throw new Error('未知的正则来源')
      const key = str(change && change.key).trim()
      if (!key) throw new Error('缺少正则标识')
      if (change.enabled !== null && typeof change.enabled !== 'boolean') throw new Error('启用状态无效')
      normalized.set(source + '\u0000' + key, { source, key, enabled: change.enabled })
    }
    if (normalized.size > 200) throw new Error('一次最多修改 200 条正则')
    const chat = await chatForSession(str(sessionId))
    if (!chat) throw new Error('请先打开一局游戏')
    if (groupOfMode(chat.mode) !== 'play') throw new Error('本局覆盖只用于游玩模式')
    const values = [...normalized.values()]
    let presetKeys = null
    let cardKeys = null
    if (values.some(function (change) { return change.source === 'preset' && change.enabled !== null })) {
      presetKeys = new Set(presetScriptsOf(chat).map(function (script, index) { return regexScriptKey('preset', script, index) }))
    }
    if (values.some(function (change) { return change.source === 'card' && change.enabled !== null })) {
      const sources = await readCardSources(chat.cardPath, chat)
      cardKeys = new Set((Array.isArray(sources?.regexScripts) ? sources.regexScripts : []).map(function (script, index) {
        return regexScriptKey('card', script, index)
      }))
    }
    for (const change of values) {
      if (change.enabled === null) continue
      const keys = change.source === 'preset' ? presetKeys : cardKeys
      if (!keys || !keys.has(change.key)) throw new Error('这条正则已不存在，请刷新后重试')
    }
    const saved = await updateChat(chat.id, function (current) {
      const overrides = normalizeRegexOverrides(current.regexOverrides)
      const next = { preset: { ...overrides.preset }, card: { ...overrides.card } }
      for (const change of values) {
        if (change.enabled === null) delete next[change.source][change.key]
        else next[change.source][change.key] = change.enabled
      }
      if (Object.keys(next.preset).length === 0 && Object.keys(next.card).length === 0) delete current.regexOverrides
      else current.regexOverrides = next
      return current
    }, { source: 'regex.override' })
    return { overrides: normalizeRegexOverrides(saved && saved.regexOverrides) }
  }

  async function setOverride({ sessionId, source, key, enabled }) {
    return await setOverrides({ sessionId, changes: [{ source, key, enabled }] })
  }

  async function preview({ text, scripts, placement, depth, isMarkdown, isEdit }) {
    const list = (Array.isArray(scripts) ? scripts : [])
      .map(function (script, index) { return normalizeRegexScript(script, index) })
      .filter(function (script) { return script.findRegex.trim() !== '' })
    const result = applyTavernRegexText(str(text), list, {
      placement: Number(placement) || 2,
      depth: Number(depth) || 0,
      isMarkdown: isMarkdown !== false,
      isEdit: isEdit === true
    })
    return {
      text: result.text,
      changed: result.changed,
      applied: result.applied,
      warnings: result.warnings
    }
  }

  return Object.freeze({ read, writeGlobal, importGlobal, setOverride, setOverrides, preview, migrateLegacy })
}
