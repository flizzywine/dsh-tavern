import { normalizeResourcePath } from './file-resources.js'
import { inspectPreset, nativeRegexScriptsOf } from './preset-reading.js'
import { previewPresetConversion } from './preset-conversion-preview.js'
import { createPresetEditor } from './preset-editor.js'
import { createRuntimePresetModule } from './runtime-presets.js'
import { createBypassPlanModule } from './bypass-plans.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

/** Own the preset library's reads, source mappings, selection and legacy migrations.
 * Editors/compilers still own their existing formats; raw documents are never rewritten here.
 */
export function createPresetLibrary({ resources: fileResources, state: profileData, prepareImport: prepareTextImport, logger = console }) {
  const readJson = function (path) { return profileData.readJson(path) }
  async function readPreset(presetPath) {
    const normalized = normalizeResourcePath(presetPath, 'preset')
    const text = await fileResources.readText(normalized)
    if (text === undefined) return undefined
    const inspected = inspectPreset(text, normalized)
    const conversion = previewPresetConversion(text, normalized)
    return Object.assign({
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
    now: Date.now
  })
  const bypassPlans = createBypassPlanModule({
    readPreset,
    readPresetDocument,
    runtimeRegexScripts: runtimeRegexScriptsOf,
    readState: async function () { return await readJson('bypass-plans.json') },
    updateState: async function (updater) { return await profileData.updateJson('bypass-plans.json', updater) },
    now: Date.now
  })
  async function migrateLegacyPresetPlans() {
    const target = await bypassPlans.state()
    if (target.plans.length > 0) return
    const legacy = await runtimePresets.state()
    const candidates = (legacy.plans || []).map(function (plan) {
      return { name: plan.name, path: plan.presetPath, entryKeys: plan.entryKeys || [], regexKeys: plan.regexKeys || [] }
    })
    if (legacy.activePreset && !candidates.some(function (item) { return item.path === legacy.activePreset })) {
      candidates.push({
        name: (legacy.activePreset.split('/').pop() || '外部预设').replace(/\.json$/i, '') + ' · 迁移方案',
        path: legacy.activePreset,
        entryKeys: Object.keys(legacy.entries[legacy.activePreset] || {}),
        regexKeys: Object.keys(legacy.regexes[legacy.activePreset] || {})
      })
    }
    for (const candidate of candidates) {
      try {
        const preset = await readPreset(candidate.path)
        const document = await readPresetDocument(candidate.path)
        if (!preset || !document) continue
        const availableRegexes = new Set(runtimeRegexScriptsOf(preset, document).map(function (script) { return script.regexKey }))
        const regexKeys = candidate.regexKeys.filter(function (key) { return availableRegexes.has(key) })
        await bypassPlans.extract({
          name: candidate.name,
          sourcePresetPath: candidate.path,
          entryKeys: candidate.entryKeys,
          regexKeys
        })
      } catch (error) {
        logger.warn('dsh-tavern: 旧预设方案迁移失败', candidate.path, error)
      }
    }
  }
  async function migrateActivePresetSelection() {
    const legacy = await bypassPlans.state()
    const activePlan = legacy.plans.find(function (plan) { return plan.id === legacy.activePlanId })
    if (!activePlan) return
    const path = str(activePlan.source && activePlan.source.presetPath)
    if (path !== '' && await readPreset(path)) await runtimePresets.select(path)
    await bypassPlans.activate('')
  }

  async function migrateLegacyChatPreset(chat) {
    if (!chat || str(chat.bypassPlanId) !== '') return false
    const path = str(chat.runtimePresetPath) || str(chat.runtimePresetSnapshot && chat.runtimePresetSnapshot.presetPath)
    if (path === '') return false
    const snapshot = chat.runtimePresetSnapshot && typeof chat.runtimePresetSnapshot === 'object' ? chat.runtimePresetSnapshot : {}
    const selectedKeys = Array.from(new Set((snapshot.sources || []).map(function (source) { return str(source && source.entryKey) }).filter(Boolean)))
    let plan = null
    const existingPlans = await bypassPlans.list()
    plan = existingPlans.find(function (item) {
      if (str(item.source && item.source.presetPath) !== path) return false
      const keys = item.entries.filter(function (entry) { return entry.enabled && !entry.systemManaged }).map(function (entry) { return entry.entryKey })
      return JSON.stringify(keys.slice().sort()) === JSON.stringify(selectedKeys.slice().sort())
    }) || null
    if (plan === null) {
      const name = '旧对话 · ' + (str(chat.cardName) || '未命名') + ' · ' + str(chat.id).slice(-6)
      const preset = await readPreset(path)
      const document = await readPresetDocument(path)
      if (preset && document) {
        const selectedRegexKeys = Array.from(new Set((snapshot.regexSources || []).map(function (source) { return str(source && source.regexKey) }).filter(Boolean)))
        plan = await bypassPlans.extract({ name, sourcePresetPath: path, entryKeys: selectedKeys, regexKeys: selectedRegexKeys })
      } else {
        const entries = []
        for (const phase of ['front', 'middle', 'back']) {
          for (const entry of (snapshot[phase] && snapshot[phase].entries || [])) {
            entries.push(Object.assign({}, entry, {
              entryKey: str(entry.id || entry.entryKey), identifier: str(entry.source && entry.source.identifier),
              enabled: true, injectable: str(entry.content).trim() !== '', phase
            }))
          }
        }
        plan = await bypassPlans.importPlan({
          name,
          source: { presetName: (path.split('/').pop() || path).replace(/\.json$/i, ''), presetPath: path, presetDigest: '' },
          entries,
          regexScripts: snapshot.regexScripts || [],
          compatibilitySettings: {}
        })
      }
    }
    chat.bypassPlanId = plan.id
    chat.runtimePresetPath = ''
    chat.runtimePresetSnapshot = await bypassPlans.snapshot(plan.id)
    return true
  }
  async function listPresets() {
    const result = []
    const inspectedPresets = []
    for (const presetPath of await fileResources.list('preset')) {
      const inspected = await readPreset(presetPath)
      inspectedPresets.push({ path: presetPath, inspected })
    }
    for (const record of inspectedPresets) {
      const presetPath = record.path
      const inspected = record.inspected
      const preset = inspected
      const extractableRegexScripts = runtimeRegexScriptsOf(preset, await readPresetDocument(preset.path))
      result.push({
        path: preset.path,
        previewPath: preset.previewPath,
        title: preset.title,
        valid: preset.valid,
        recognized: preset.recognized,
        promptCount: preset.promptCount,
        enabledCount: preset.enabledCount || 0,
        regexCount: extractableRegexScripts.length,
        enabledRegexCount: extractableRegexScripts.filter(function (script) { return script.enabled !== false }).length,
        warning: preset.warning,
        error: preset.error
      })
    }
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
    await bypassPlans.activate('')
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
  async function updateEntry(path, key, patch) {
    await presetEditor.updateEntry(path, key, patch)
    return await readPreset(path)
  }
  async function updateRegex(path, key, patch) {
    const normalized = normalizeResourcePath(path, 'preset')
    await presetEditor.updateRegex(normalized, key, patch)
    const next = await readPreset(normalized)
    return Object.assign({}, next, { extractableRegexScripts: runtimeRegexScriptsOf(next, await readPresetDocument(normalized)) })
  }
  async function migrate() {
    await migrateLegacyPresetPlans()
    await migrateActivePresetSelection()
  }
  return Object.freeze({ read: readPreset, readDocument: readPresetDocument, detail,
    catalog, select, import: importPreset, export: exportPreset, preview: previewPreset,
    updateEntry, updateRegex, migrate, migrateChat: migrateLegacyChatPreset,
    editor: presetEditor, runtime: runtimePresets, plans: bypassPlans })
}
