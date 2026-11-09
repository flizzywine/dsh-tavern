import { createHash } from 'node:crypto'
import { normalizeResourcePath } from './file-resources.js'
import { inspectPreset, nativeRegexScriptsOf } from './preset-reading.js'
import { previewPresetConversion } from './preset-conversion-preview.js'
import { createPresetEditor } from './preset-editor.js'
import { createRuntimePresetModule } from './runtime-presets.js'
import { createPresetSnapshotPool, snapshotNeedsDocuments, withSnapshotDocuments } from './preset-snapshot-pool.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

const GENERATION_PRESET_MAX_BYTES = 10 * 1024 * 1024
function hasGenerationPresetFormat(document) {
  return Array.isArray(document?.prompts) && document.prompts.length > 0
    && Array.isArray(document.prompt_order) && document.prompt_order.some(group => Array.isArray(group?.order))
}

// Bypass plans were retired on this date; their file is only read for migrations.
const PLANS_RETIRED_AT = Date.parse('2026-08-28T00:00:00+08:00')

/** Own the preset library's reads, source mappings, selection and legacy migrations.
 * Editors/compilers still own their existing formats; raw documents are never rewritten here.
 */

export function createPresetLibrary({ resources: fileResources, state: profileData, prepareImport: prepareTextImport, logger = console, snapshotPoolLimit = 24 }) {
  const readJson = function (path) { return profileData.readJson(path) }
  // Frozen preset snapshots store their two compatibility documents once here instead of
  // inside every save; the key is the snapshot digest, so an edited preset never reuses a
  // copy. Storage adapters are optional: without them the pool degrades to memory.
  const snapshotKey = function (digest) { return 'preset-snapshots/' + digest + '.json' }
  const snapshotPool = createPresetSnapshotPool({
    exists: async function (key) {
      if (typeof profileData?.size !== 'function') return false
      try { return (await profileData.size(key)) > 0 } catch { return false }
    },
    read: async function (key) {
      return typeof profileData?.readJson === 'function' ? await profileData.readJson(key) : null
    },
    write: async function (key, value) {
      if (typeof profileData?.writeJson === 'function') await profileData.writeJson(key, value)
    }
  })
  // Editing a preset mints a new digest, so the pool would grow by ~1 MB per edit. Keep the
  // newest few and drop the rest: a dropped entry only costs the frozen copy, and `generate`
  // then re-reads the preset the save points at.
  const snapshotIndexPath = 'preset-snapshots/index.json'
  // Saves in the same millisecond must still rank: a plain Date.now() leaves ties that
  // keep the OLD entries and prune the new one.
  let lastSnapshotStamp = 0
  function snapshotStamp() {
    const now = Date.now()
    lastSnapshotStamp = now > lastSnapshotStamp ? now : lastSnapshotStamp + 1
    return lastSnapshotStamp
  }
  async function pruneSnapshotPool(digest) {
    if (typeof profileData?.updateJson !== 'function') return
    const dropped = new Set()
    try {
      await profileData.updateJson(snapshotIndexPath, function (current) {
        const index = current !== null && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {}
        index[digest] = snapshotStamp()
        const ranked = Object.entries(index).sort(function (a, b) { return Number(b[1]) - Number(a[1]) })
        const kept = Object.fromEntries(ranked.slice(0, Math.max(1, snapshotPoolLimit)))
        for (const key of Object.keys(index)) if (!Object.hasOwn(kept, key)) dropped.add(key)
        return kept
      })
    } catch { return }
    if (typeof profileData?.remove !== 'function') return
    for (const key of dropped) await profileData.remove(snapshotKey(key)).catch(() => {})
  }
  // `generate` is the only reader of those documents; it reattaches them by reference.
  async function hydratePresetSnapshot(snapshot) {
    if (!snapshotNeedsDocuments(snapshot)) return snapshot
    const documents = await snapshotPool.load(snapshotKey(snapshot.presetSnapshotRef)).catch(() => null)
    return documents ? withSnapshotDocuments(snapshot, documents) : snapshot
  }
  async function readPreset(presetPath) {
    const normalized = normalizeResourcePath(presetPath, 'preset')
    const text = await fileResources.readText(normalized)
    if (text === undefined) return undefined
    const inspected = inspectPreset(text, normalized)
    const conversion = previewPresetConversion(text, normalized)
    return Object.assign({
      revision: createHash('sha256').update(text).digest('hex'),
      path: normalized,
      previewPath: fileResources.absolute(normalized),
      dshPreset: conversion && conversion.dshPreset || null,
      conversionStatus: conversion && conversion.status || 'unrecognized',
      conversionDiagnostics: conversion && conversion.diagnostics || []
    }, inspected)
  }
  async function readPresetDocument(presetPath) {
    const normalized = normalizeResourcePath(presetPath, 'preset')
    const text = await fileResources.readText(normalized)
    if (text === undefined) return undefined
    try { return JSON.parse(text) } catch { return undefined }
  }
  function runtimeRegexScriptsOf(preset, document) {
    const nativeScripts = nativeRegexScriptsOf(document)
    const nativeSource = document && document.extensions && Array.isArray(document.extensions.regex_scripts) ? document.extensions.regex_scripts : []
    const bindingSource = document && document.extensions && document.extensions.SPreset && document.extensions.SPreset.RegexBinding && Array.isArray(document.extensions.SPreset.RegexBinding.regexes) ? document.extensions.SPreset.RegexBinding.regexes : []
    const usingNative = nativeScripts.length > 0
    const source = usingNative ? nativeScripts : (Array.isArray(preset && preset.regexScripts) ? preset.regexScripts : [])
    const sourceIndexes = (usingNative ? nativeSource : bindingSource).map(function (script, index) {
      return script !== null && typeof script === 'object' && !Array.isArray(script) ? index : null
    }).filter(function (index) { return index !== null })
    const sourceBase = usingNative ? '/extensions/regex_scripts/' : '/extensions/SPreset/RegexBinding/regexes/'
    const occurrences = new Map()
    return source.map(function (script, index) {
      const identifier = str(script.id) || 'regex-' + (index + 1)
      const occurrence = (occurrences.get(identifier) || 0) + 1
      occurrences.set(identifier, occurrence)
      const editBase = sourceBase + sourceIndexes[index]
      return Object.assign({}, script, { regexKey: identifier + '#' + occurrence, edit: {
        scriptNamePath: editBase + '/scriptName',
        findRegexPath: editBase + '/findRegex',
        replaceStringPath: editBase + '/replaceString',
        disabledPath: editBase + '/disabled'
      } })
    })
  }
  async function previewPreset(presetPath, orderGroupIndex) {
    const normalized = normalizeResourcePath(presetPath, 'preset')
    const text = await fileResources.readText(normalized)
    if (text === undefined) return undefined
    return Object.assign({ path: normalized }, previewPresetConversion(text, normalized, { orderGroupIndex }))
  }
  const presetEditor = createPresetEditor({
    normalizePath: normalizeResourcePath,
    readText: async function (path) { return await fileResources.readText(path) },
    writeText: async function (path, text) { return await fileResources.writeWorking(path, text) },
    inspectRegexScripts: runtimeRegexScriptsOf
  })
  const runtimePresets = createRuntimePresetModule({
    listPaths: async function () { return await fileResources.list('preset') },
    readPreset,
    readPresetDocument,
    runtimeRegexScripts: runtimeRegexScriptsOf,
    readState: async function () { return await readJson('runtime-presets.json') },
    updateState: async function (updater) { return await profileData.updateJson('runtime-presets.json', updater) },
    saveSnapshotDocuments: async function (digest, documents) {
      if (await snapshotPool.save(snapshotKey(digest), documents)) await pruneSnapshotPool(digest)
    },
    now: Date.now
  })
  async function readRetiredPlans() {
    const value = await readJson('bypass-plans.json')
    const plans = Array.isArray(value?.plans) ? value.plans.filter(function (plan) { return plan && typeof plan.id === 'string' && plan.id !== '' }) : []
    return { plans, activePlanId: str(value?.activePlanId) }
  }
  // An install that last ran with an active plan continues with that plan's source preset.
  async function migrateActivePresetSelection() {
    const legacy = await readRetiredPlans()
    if (legacy.activePlanId === '') return
    const activePlan = legacy.plans.find(function (plan) { return plan.id === legacy.activePlanId })
    const path = str(activePlan && activePlan.source && activePlan.source.presetPath)
    if (path !== '' && await readPreset(path)) await runtimePresets.select(path)
    await profileData.updateJson('bypass-plans.json', function (current) { return Object.assign({}, current, { activePlanId: '' }) })
  }

  // Games started after bypass plans were retired never chose a plan. A startup
  // migration used to bind them to an old plan anyway, freezing them on stale preset
  // text that no longer followed edits (#166); return them to their source preset.
  async function restoreRetiredPlanChat(chat) {
    if (!chat || str(chat.bypassPlanId) === '' || !(Number(chat.createdAt) >= PLANS_RETIRED_AT)) return false
    const plan = (await readRetiredPlans()).plans.find(function (item) { return item.id === chat.bypassPlanId })
    const path = str(plan && plan.source && plan.source.presetPath)
    if (path === '' || !await readPreset(path)) return false
    let snapshot = null
    try { snapshot = await runtimePresets.fullSnapshot(path) } catch (error) { logger.warn('dsh-tavern: 对话预设恢复失败', chat.id, error) }
    if (!snapshot) return false
    chat.bypassPlanId = ''
    chat.runtimePresetSnapshot = snapshot
    chat.runtimePresetPath = str(snapshot.presetPath) || path
    return true
  }
  // Inspecting, converting and parsing a multi-MB preset dominates the catalog; the
  // summary depends only on the file text, so it is reused until the text changes.
  const summaryCache = new Map()
  function summarize(presetPath, text) {
    const conversion = previewPresetConversion(text, presetPath)
    // Same field precedence as readPreset().
    const preset = Object.assign({ path: presetPath, previewPath: fileResources.absolute(presetPath),
      dshPreset: conversion && conversion.dshPreset || null }, inspectPreset(text, presetPath))
    let document
    try { document = JSON.parse(text) } catch { document = undefined }
    const extractableRegexScripts = runtimeRegexScriptsOf(preset, document)
    const phaseCounts = Object.fromEntries(['front', 'middle', 'back'].map(function (phase) {
      return [phase, Array.isArray(preset.dshPreset && preset.dshPreset[phase]) ? preset.dshPreset[phase].length : 0]
    }))
    const phasedEntryKeys = new Set(['front', 'middle', 'back'].flatMap(function (phase) {
      return (Array.isArray(preset.dshPreset && preset.dshPreset[phase]) ? preset.dshPreset[phase] : []).map(function (entry) { return str(entry && entry.id) })
    }))
    return {
      path: preset.path,
      previewPath: preset.previewPath,
      title: preset.title,
      valid: preset.valid,
      recognized: preset.recognized,
      generationCompatible: Buffer.byteLength(text) <= GENERATION_PRESET_MAX_BYTES && hasGenerationPresetFormat(document),
      promptCount: preset.promptCount,
      phaseCounts,
      unassignedPromptCount: (preset.entries || []).filter(function (entry) { return !phasedEntryKeys.has(str(entry && entry.entryKey)) }).length,
      enabledCount: preset.enabledCount || 0,
      regexCount: extractableRegexScripts.length,
      enabledRegexCount: extractableRegexScripts.filter(function (script) { return script.enabled !== false }).length,
      warning: preset.warning,
      error: preset.error
    }
  }
  async function listPresets() {
    const result = []
    const listed = new Set()
    for (const listedPath of await fileResources.list('preset')) {
      const presetPath = normalizeResourcePath(listedPath, 'preset')
      const text = await fileResources.readText(presetPath)
      if (text === undefined) continue // A listed file may disappear before it is read.
      listed.add(presetPath)
      const cached = summaryCache.get(presetPath)
      if (cached && cached.text === text) { result.push(structuredClone(cached.summary)); continue }
      const summary = summarize(presetPath, text)
      summaryCache.set(presetPath, { text, summary })
      result.push(structuredClone(summary))
    }
    for (const cachedPath of summaryCache.keys()) if (!listed.has(cachedPath)) summaryCache.delete(cachedPath)
    return result
  }
  async function importPreset(payload) {
    const prepared = prepareTextImport(payload, '预设文件为空')
    const inspected = inspectPreset(prepared.text, prepared.name)
    if (!inspected.valid) throw new Error(inspected.error)
    const presetPath = await fileResources.importText('preset', prepared)
    return await readPreset(presetPath)
  }

  async function catalog() {
    const presets = await listPresets()
    const state = await runtimePresets.state()
    const active = presets.find(function (preset) { return preset.path === state.activePreset }) || null
    return { presets, activePresetPath: state.activePreset || '', activePresetTitle: active && active.title || '' }
  }
  async function select(value) {
    const path = str(value)
    if (path !== '') {
      const preset = await readPreset(path)
      if (!preset || preset.valid !== true || preset.recognized !== true) throw new Error('该文件不是可运行的 SillyTavern 预设：' + path)
    }
    await runtimePresets.select(path)
    return { activePresetPath: path }
  }
  async function detail(path) {
    const inspected = await readPreset(path)
    if (inspected === undefined) throw new Error('预设不存在: ' + path)
    return Object.assign({}, inspected, { extractableRegexScripts: runtimeRegexScriptsOf(inspected, await readPresetDocument(inspected.path)) })
  }
  async function exportPreset(path) {
    const presetPath = normalizeResourcePath(path, 'preset')
    const text = await fileResources.readText(presetPath)
    if (text === undefined) throw new Error('预设不存在: ' + presetPath)
    return { name: presetPath.split('/').pop() || 'preset.json', text }
  }
  async function listForGeneration() {
    return (await listPresets()).filter(preset => preset.generationCompatible)
      .map(preset => ({ id: preset.path, name: preset.title }))
  }
  async function readForGeneration(id) {
    const path = normalizeResourcePath(id, 'preset')
    const { name, text } = await exportPreset(path)
    if (Buffer.byteLength(text) > GENERATION_PRESET_MAX_BYTES) throw new Error('共享预设最多 10 MiB')
    let document
    try { document = JSON.parse(text) } catch { /* report the same error as an unsupported format */ }
    if (!hasGenerationPresetFormat(document)) throw new Error('此预设缺少 SillyTavern 提示词或顺序数据，请在宿主预设库选择兼容的预设')
    return { id: path, name: name.replace(/\.json$/i, ''), revision: createHash('sha256').update(text).digest('hex'), text }
  }
  async function updateEntry(path, key, patch) {
    await presetEditor.updateEntry(path, key, patch)
    return await readPreset(path)
  }
  async function moveEntry(path, key, phase, beforeKey, revision) {
    await presetEditor.moveEntry(path, key, phase, beforeKey, revision)
    return await detail(path)
  }
  async function updateRegex(path, key, patch) {
    const normalized = normalizeResourcePath(path, 'preset')
    await presetEditor.updateRegex(normalized, key, patch)
    const next = await readPreset(normalized)
    return Object.assign({}, next, { extractableRegexScripts: runtimeRegexScriptsOf(next, await readPresetDocument(normalized)) })
  }
  async function migrate() {
    await migrateActivePresetSelection()
  }
  return Object.freeze({ read: readPreset, readDocument: readPresetDocument, detail,
    catalog, select, import: importPreset, export: exportPreset, preview: previewPreset,
    listForGeneration, readForGeneration,
    updateEntry, updateRegex, moveEntry, migrate, restoreChat: restoreRetiredPlanChat,
    snapshotDocuments: Object.freeze({ hydrate: hydratePresetSnapshot, load: function (digest) { return snapshotPool.load(snapshotKey(digest)) },
      save: async function (digest, documents) {
        if (await snapshotPool.save(snapshotKey(digest), documents)) await pruneSnapshotPool(digest)
      } }),
    editor: presetEditor, runtime: runtimePresets })
}
