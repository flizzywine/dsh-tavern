import { createHash } from 'node:crypto'
import { resolveRuntimeMacroText } from './runtime-content-projection.js'
import { entryRandom, renderWorldbookRandom } from './worldbook-random.js'

function normalizeState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const currentVersion = Number(source.version) === 6
  const entries = currentVersion && source.entries && typeof source.entries === 'object' && !Array.isArray(source.entries) ? source.entries : {}
  const regexes = currentVersion && source.regexes && typeof source.regexes === 'object' && !Array.isArray(source.regexes) ? source.regexes : {}
  const initialized = currentVersion && source.initialized && typeof source.initialized === 'object' && !Array.isArray(source.initialized) ? source.initialized : {}
  return {
    version: 6,
    activePreset: typeof source.activePreset === 'string' ? source.activePreset : '',
    presetOrder: Array.isArray(source.presetOrder) ? source.presetOrder.filter(function (path) { return typeof path === 'string' && path !== '' }) : [],
    entries: Object.fromEntries(Object.entries(entries).map(function ([path, keys]) {
      const enabled = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {}
      return [path, Object.fromEntries(Object.entries(enabled).filter(function ([key, active]) { return key !== '' && active === true }))]
    })),
    regexes: Object.fromEntries(Object.entries(regexes).map(function ([path, keys]) {
      const enabled = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {}
      return [path, Object.fromEntries(Object.entries(enabled).filter(function ([key, active]) { return key !== '' && active === true }))]
    })),
    initialized: Object.fromEntries(Object.entries(initialized).filter(function ([path, ready]) { return path !== '' && ready === true })),
    lastError: source.lastError && typeof source.lastError === 'object' ? source.lastError : null,
    updatedAt: Number(source.updatedAt) || 0
  }
}

function dshEntries(preset) {
  const draft = preset && preset.dshPreset
  if (draft && typeof draft === 'object') {
    return ['front', 'middle', 'back'].flatMap(function (phase) {
      return (Array.isArray(draft[phase]) ? draft[phase] : []).map(function (entry) {
        return {
          entryKey: String(entry.id || ''),
          identifier: String(entry.source && entry.source.identifier || entry.id || ''),
          name: String(entry.name || entry.id || ''),
          role: entry.role === 'user' || entry.role === 'assistant' ? entry.role : 'system',
          content: String(entry.content || ''),
          enabled: entry.enabled !== false,
          injectable: String(entry.content || '').trim() !== '',
          phase
        }
      })
    })
  }
  return (preset && Array.isArray(preset.entries) ? preset.entries : []).filter(function (entry) {
    return entry && entry.injectable === true && entry.marker !== true
  }).map(function (entry) {
    return Object.assign({}, entry, { phase: 'front' })
  })
}

function phaseValue(entries) {
  const value = Array.isArray(entries) ? entries : []
  return {
    entries: value,
    text: value.map(function (entry) { return String(entry.content || '') }).filter(Boolean).join('\n\n')
  }
}

function regexesWithKeys(preset) {
  const occurrences = new Map()
  return (preset.regexScripts || []).map(function (script, index) {
    const identifier = String(script.id || 'regex-' + (index + 1))
    const occurrence = (occurrences.get(identifier) || 0) + 1
    occurrences.set(identifier, occurrence)
    return Object.assign({}, script, { regexKey: identifier + '#' + occurrence })
  })
}

function manageable(preset) {
  return preset && preset.valid === true && (preset.recognized === true || (preset.regexScripts || []).length > 0)
}

function presetPathOf(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') return ''
  if (typeof snapshot.presetPath === 'string' && snapshot.presetPath !== '') return snapshot.presetPath
  for (const source of (snapshot.sources || []).concat(snapshot.regexSources || [])) {
    if (source && typeof source.path === 'string' && source.path !== '') return source.path
  }
  return ''
}

export function resolveRuntimePresetMacros(snapshot, options = {}) {
  const macroState = {
    userName: typeof options.macroState?.userName === 'string' && options.macroState.userName !== '' ? options.macroState.userName : '你',
    local: Object.assign({}, options.macroState?.local && typeof options.macroState.local === 'object' ? options.macroState.local : {}),
    global: Object.assign({}, options.macroState?.global && typeof options.macroState.global === 'object' ? options.macroState.global : {})
  }
  if (snapshot === null || typeof snapshot !== 'object') return { snapshot: null, macroState, diagnostics: [] }
  const rawPhases = snapshot.front || snapshot.middle || snapshot.back
    ? {
        front: phaseValue(snapshot.front && snapshot.front.entries),
        middle: phaseValue(snapshot.middle && snapshot.middle.entries),
        back: phaseValue(snapshot.back && snapshot.back.entries)
      }
    : { front: phaseValue([{ id: 'legacy', role: 'system', content: String(snapshot.text || '') }]), middle: phaseValue([]), back: phaseValue([]) }
  let state = macroState
  const diagnostics = []
  const resolvedPhases = {}
  for (const phase of ['front', 'middle', 'back']) {
    const entries = []
    for (const entry of rawPhases[phase].entries) {
      const rendered = resolveRuntimeMacroText(entry.content, {
        charName: typeof options.charName === 'string' ? options.charName : '',
        macroState: state
      })
      state = rendered.macroState
      // The front is the fixed system prefix and keeps its macros literal; the middle and
      // back are rebuilt every turn, so dice/random roll there from the turn's seed.
      const text = phase !== 'front' && typeof options.randomSeed === 'string' && options.randomSeed !== ''
        ? renderWorldbookRandom(rendered.text, entryRandom(options.randomSeed, phase + ':' + entries.length + ':' + (entry.id || entry.entryKey || '')))
        : rendered.text
      diagnostics.push.apply(diagnostics, rendered.diagnostics.map(function (item) {
        return Object.assign({ phase, entryId: entry.id || entry.entryKey || '' }, item)
      }))
      entries.push(Object.assign({}, entry, { content: text }))
    }
    resolvedPhases[phase] = phaseValue(entries)
  }
  const text = ['front', 'middle', 'back'].map(function (phase) { return resolvedPhases[phase].text }).filter(Boolean).join('\n\n')
  const resolved = Object.assign({}, snapshot, {
    front: resolvedPhases.front,
    middle: resolvedPhases.middle,
    back: resolvedPhases.back,
    text,
    digest: createHash('sha256').update(JSON.stringify({ front: resolvedPhases.front, middle: resolvedPhases.middle, back: resolvedPhases.back, regexScripts: snapshot.regexScripts || [] })).digest('hex')
  })
  return {
    snapshot: resolved,
    macroState: {
      userName: state.userName,
      local: state.local,
      global: state.global
    },
    diagnostics
  }
}

export function createRuntimePresetModule(options = {}) {
  const listPaths = options.listPaths
  const readPreset = options.readPreset
  const readPresetDocument = typeof options.readPresetDocument === 'function' ? options.readPresetDocument : async function () { return {} }
  const runtimeRegexScripts = typeof options.runtimeRegexScripts === 'function' ? options.runtimeRegexScripts : function (preset) { return regexesWithKeys(preset) }
  const readState = options.readState
  const updateState = options.updateState
  const now = typeof options.now === 'function' ? options.now : Date.now
  const pendingFullSnapshots = new Map()
  let preparedFullSnapshot = null
  if ([listPaths, readPreset, readState, updateState].some(function (fn) { return typeof fn !== 'function' })) {
    throw new TypeError('运行时预设模块缺少存储适配器')
  }

  async function mutate(updater) {
    preparedFullSnapshot = null
    return updateState(async function (value) {
      const state = normalizeState(value)
      const next = await updater(state)
      if (next === undefined) return undefined
      next.updatedAt = now()
      return next
    })
  }

  async function register(path) {
    const preset = await readPreset(path)
    if (!manageable(preset)) throw new Error('无法注册无效的运行时预设：' + path)
    return mutate(function (state) {
      if (state.presetOrder.includes(path) && state.entries[path] && state.regexes[path] && state.initialized[path] === true) return undefined
      if (!state.presetOrder.includes(path)) state.presetOrder.push(path)
      if (state.initialized[path] !== true) {
        state.entries[path] = Object.fromEntries(dshEntries(preset).filter(function (entry) {
          return entry.enabled !== false && entry.injectable === true
        }).map(function (entry) { return [entry.entryKey, true] }))
        state.regexes[path] = Object.fromEntries(regexesWithKeys(preset).filter(function (script) {
          return script.enabled !== false && String(script.findRegex || '') !== ''
        }).map(function (script) { return [script.regexKey, true] }))
        state.initialized[path] = true
      }
      return state
    })
  }

  async function state() {
    return normalizeState(await readState())
  }

  async function view(path) {
    const preset = await readPreset(path)
    if (!preset) throw new Error('预设不存在：' + path)
    const current = await state()
    const enabled = current.entries[path] || {}
    const enabledRegexes = current.regexes[path] || {}
    const projectedEntries = dshEntries(preset)
    const projectedKeys = new Set(projectedEntries.map(function (entry) { return entry.entryKey }))
    const entries = (preset.entries || []).map(function (entry) {
      const runtimeIncluded = projectedKeys.has(entry.entryKey) && enabled[entry.entryKey] === true
      return Object.assign({}, entry, {
        runtimeEligible: projectedKeys.has(entry.entryKey),
        runtimeIncluded,
        runtimeEnabled: runtimeIncluded
      })
    })
    const regexScripts = regexesWithKeys(preset).map(function (script) {
      return Object.assign({}, script, { runtimeEnabled: enabledRegexes[script.regexKey] === true })
    })
    return Object.assign({}, preset, {
      runtimeManaged: true,
      runtimeActive: current.activePreset === path,
      entries,
      regexScripts,
      includedCount: projectedEntries.filter(function (entry) { return enabled[entry.entryKey] === true }).length,
      enabledCount: projectedEntries.filter(function (entry) { return enabled[entry.entryKey] === true }).length,
      enabledCharacters: projectedEntries.reduce(function (total, entry) { return total + (enabled[entry.entryKey] === true ? entry.content.length : 0) }, 0),
      enabledRegexCount: regexScripts.filter(function (script) { return script.runtimeEnabled }).length
    })
  }

  async function select(path) {
    const selected = typeof path === 'string' ? path : ''
    if (selected !== '') {
      const preset = await readPreset(selected)
      if (!manageable(preset)) throw new Error('预设不可用：' + selected)
    }
    return mutate(function (current) {
      if (selected !== '' && !current.presetOrder.includes(selected)) current.presetOrder.push(selected)
      current.activePreset = selected
      current.lastError = null
      return current
    })
  }

  async function toggle({ path, entryKey, enabled }) {
    const preset = await readPreset(path)
    if (!manageable(preset)) throw new Error('预设不可用：' + path)
    const entry = dshEntries(preset).find(function (item) { return item.entryKey === entryKey })
    if (!entry) throw new Error('预设条目不存在：' + entryKey)
    if (enabled === true && entry.injectable !== true) throw new Error('该预设条目没有可注入内容，不可注入')
    return mutate(function (current) {
      if (!current.presetOrder.includes(path)) current.presetOrder.push(path)
      if (!current.entries[path]) current.entries[path] = {}
      if (enabled === true) current.entries[path][entryKey] = true
      else delete current.entries[path][entryKey]
      current.lastError = null
      return current
    })
  }

  async function toggleRegex({ path, regexKey, enabled }) {
    const preset = await readPreset(path)
    if (!manageable(preset)) throw new Error('预设不可用：' + path)
    const script = regexesWithKeys(preset).find(function (item) { return item.regexKey === regexKey })
    if (!script) throw new Error('预设正则不存在：' + regexKey)
    if (enabled === true && String(script.findRegex || '') === '') throw new Error('该预设正则没有查找规则，不可开启')
    return mutate(function (current) {
      if (!current.presetOrder.includes(path)) current.presetOrder.push(path)
      if (!current.regexes[path]) current.regexes[path] = {}
      if (enabled === true) current.regexes[path][regexKey] = true
      else delete current.regexes[path][regexKey]
      current.lastError = null
      return current
    })
  }

  async function disablePreset(path) {
    return mutate(function (current) {
      current.entries[path] = {}
      current.regexes[path] = {}
      current.lastError = null
      return current
    })
  }

  async function disableAll() {
    return mutate(function (current) {
      current.entries = Object.fromEntries(current.presetOrder.map(function (path) { return [path, {}] }))
      current.regexes = Object.fromEntries(current.presetOrder.map(function (path) { return [path, {}] }))
      current.lastError = null
      return current
    })
  }

  async function persistError(message) {
    await mutate(function (current) {
      current.lastError = { message, at: now() }
      return current
    })
  }

  async function snapshot(requestedPath) {
    const current = await state()
    const activePath = typeof requestedPath === 'string' && requestedPath !== '' ? requestedPath : current.activePreset
    if (activePath === '') return null
    const active = Object.keys(current.entries[activePath] || {}).length > 0 || Object.keys(current.regexes[activePath] || {}).length > 0
    if (!active) return null
    const phaseEntries = { front: [], middle: [], back: [] }
    const sources = []
    const regexScripts = []
    const regexSources = []
    try {
      const available = new Set(await listPaths())
      for (const path of [activePath]) {
        const enabled = current.entries[path] || {}
        const enabledRegexes = current.regexes[path] || {}
        if (Object.keys(enabled).length === 0 && Object.keys(enabledRegexes).length === 0) continue
        if (!available.has(path)) throw new Error('预设已不存在：' + path)
        const preset = await readPreset(path)
        if (!manageable(preset)) throw new Error('预设无法读取：' + path)
        const projectedEntries = dshEntries(preset)
        for (const entry of projectedEntries) {
          if (enabled[entry.entryKey] !== true) continue
          if (entry.injectable !== true) throw new Error('预设条目已失效：' + path + ' / ' + entry.entryKey)
          phaseEntries[entry.phase].push({
            id: entry.entryKey,
            role: entry.role,
            content: entry.content,
            name: entry.name,
            source: { path, entryKey: entry.entryKey, identifier: entry.identifier, name: entry.name }
          })
          sources.push({ path, entryKey: entry.entryKey, identifier: entry.identifier, name: entry.name, phase: entry.phase })
        }
        const present = new Set(projectedEntries.map(function (entry) { return entry.entryKey }))
        for (const entryKey of Object.keys(enabled)) {
          if (!present.has(entryKey)) throw new Error('预设条目已不存在：' + path + ' / ' + entryKey)
        }
        const keyedRegexes = regexesWithKeys(preset)
        for (const script of keyedRegexes) {
          if (enabledRegexes[script.regexKey] !== true) continue
          if (String(script.findRegex || '') === '') throw new Error('预设正则已失效：' + path + ' / ' + script.regexKey)
          regexScripts.push(Object.assign({}, script, { enabled: true }))
          regexSources.push({ path, regexKey: script.regexKey, id: script.id, name: script.name })
        }
        const presentRegexes = new Set(keyedRegexes.map(function (script) { return script.regexKey }))
        for (const regexKey of Object.keys(enabledRegexes)) {
          if (!presentRegexes.has(regexKey)) throw new Error('预设正则已不存在：' + path + ' / ' + regexKey)
        }
      }
      const front = phaseValue(phaseEntries.front)
      const middle = phaseValue(phaseEntries.middle)
      const back = phaseValue(phaseEntries.back)
      const text = [front.text, middle.text, back.text].filter(Boolean).join('\n\n')
      if (current.lastError !== null) {
        await mutate(function (latest) {
          latest.lastError = null
          return latest
        })
      }
      const digestInput = JSON.stringify({ front, middle, back, regexScripts })
      return { presetPath: activePath, front, middle, back, text, sources, regexScripts, regexSources, digest: createHash('sha256').update(digestInput).digest('hex'), createdAt: now() }
    } catch (error) {
      const message = '预设注入失败：' + (error instanceof Error ? error.message : String(error))
      await persistError(message)
      throw new Error(message)
    }
  }

  async function buildFullSnapshot(activePath, current) {
    if (activePath === '') return null
    try {
      const available = new Set(await listPaths())
      if (!available.has(activePath)) throw new Error('预设已不存在：' + activePath)
      const preset = await readPreset(activePath)
      if (!preset || preset.valid !== true || preset.recognized !== true) throw new Error('预设无法读取：' + activePath)
      const draft = preset.dshPreset && typeof preset.dshPreset === 'object' ? preset.dshPreset : null
      const entries = Array.isArray(preset.entries) ? preset.entries : []
      const ordered = draft ? ['front', 'middle', 'back'].flatMap(phase =>
        (draft[phase] || []).map(item => ({ phase, entry: Number.isInteger(item.source?.sourcePromptIndex)
          ? entries.find(entry => entry.sourcePromptIndex === item.source.sourcePromptIndex)
          : entries.find(entry => entry.entryKey === item.id) })))
        : entries.filter(entry => entry.ordered === true).map(entry => ({ entry, phase: Number(entry.injectionPosition) === 1 ? 'middle' : 'front' }))
      const phaseEntries = { front: [], middle: [], back: [] }
      const sources = []
      for (const { entry, phase } of ordered) {
        if (!entry || entry.enabled === false || entry.marker === true || entry.injectable !== true) continue
        const projected = {
          id: entry.entryKey,
          role: entry.role,
          content: entry.content,
          name: entry.name,
          source: { path: activePath, entryKey: entry.entryKey, identifier: entry.identifier, name: entry.name }
        }
        phaseEntries[phase].push(projected)
        sources.push(Object.assign({ phase }, projected.source))
      }
      const document = await readPresetDocument(activePath)
      const regexScripts = runtimeRegexScripts(preset, document).filter(function (script) {
        return script.enabled !== false && String(script.findRegex || '') !== ''
      }).map(function (script) { return Object.assign({}, script, { enabled: true }) })
      const front = phaseValue(phaseEntries.front)
      const middle = phaseValue(phaseEntries.middle)
      const back = phaseValue(phaseEntries.back)
      const result = {
        presetPath: activePath,
        presetName: preset.title,
        compatibilityPreset: preset,
        compatibilityPresetDocument: document,
        front,
        middle,
        back,
        text: [front.text, middle.text, back.text].filter(Boolean).join('\n\n'),
        sources,
        regexScripts,
        regexSources: regexScripts.map(function (script) { return { path: activePath, regexKey: script.regexKey, id: script.id, name: script.name } }),
        createdAt: now()
      }
      result.digest = createHash('sha256').update(JSON.stringify({ front, middle, back, regexScripts, compatibilityPreset: preset, compatibilityPresetDocument: document })).digest('hex')
      if (current.lastError !== null) await mutate(function (latest) { latest.lastError = null; return latest })
      return result
    } catch (error) {
      const message = '预设加载失败：' + (error instanceof Error ? error.message : String(error))
      await persistError(message)
      throw new Error(message)
    }
  }

  async function fullSnapshot(requestedPath) {
    const current = await state()
    const activePath = typeof requestedPath === 'string' && requestedPath !== '' ? requestedPath : current.activePreset
    if (pendingFullSnapshots.has(activePath)) return await pendingFullSnapshots.get(activePath)
    const operation = buildFullSnapshot(activePath, current)
    pendingFullSnapshots.set(activePath, operation)
    try { return await operation }
    finally { if (pendingFullSnapshots.get(activePath) === operation) pendingFullSnapshots.delete(activePath) }
  }

  async function prepareFullSnapshot() {
    const current = await state()
    const snapshot = await fullSnapshot(current.activePreset)
    preparedFullSnapshot = {
      preparedAt: now(),
      snapshot
    }
    return snapshot
  }

  async function claimPreparedFullSnapshot() {
    const prepared = preparedFullSnapshot
    preparedFullSnapshot = null
    if (prepared === null || now() - prepared.preparedAt > 60_000) return undefined
    return prepared.snapshot
  }

  async function regexScriptsFor(snapshot) {
    const path = presetPathOf(snapshot)
    if (path === '') return []
    const current = await state()
    const enabled = current.regexes[path] || {}
    if (Object.keys(enabled).length === 0) return []
    const preset = await readPreset(path)
    if (!manageable(preset)) throw new Error('预设正则无法读取：' + path)
    const keyed = regexesWithKeys(preset)
    const result = []
    for (const script of keyed) {
      if (enabled[script.regexKey] !== true) continue
      if (String(script.findRegex || '') === '') throw new Error('预设正则已失效：' + path + ' / ' + script.regexKey)
      result.push(Object.assign({}, script, { enabled: true }))
    }
    const present = new Set(keyed.map(function (script) { return script.regexKey }))
    for (const regexKey of Object.keys(enabled)) {
      if (!present.has(regexKey)) throw new Error('预设正则已不存在：' + path + ' / ' + regexKey)
    }
    return result
  }

  async function rename(from, to) {
    return mutate(function (current) {
      current.presetOrder = current.presetOrder.map(function (path) { return path === from ? to : path })
      if (current.activePreset === from) current.activePreset = to
      if (current.entries[from]) {
        current.entries[to] = current.entries[from]
        delete current.entries[from]
      }
      if (current.regexes[from]) {
        current.regexes[to] = current.regexes[from]
        delete current.regexes[from]
      }
      if (current.initialized[from]) {
        current.initialized[to] = current.initialized[from]
        delete current.initialized[from]
      }
      current.lastError = null
      return current
    })
  }

  async function remove(path) {
    return mutate(function (current) {
      current.presetOrder = current.presetOrder.filter(function (item) { return item !== path })
      if (current.activePreset === path) current.activePreset = ''
      delete current.entries[path]
      delete current.regexes[path]
      delete current.initialized[path]
      current.lastError = null
      return current
    })
  }

  return { register, state, view, select, toggle, toggleRegex, disablePreset, disableAll, snapshot, fullSnapshot, prepareFullSnapshot, claimPreparedFullSnapshot, regexScriptsFor, rename, remove }
}
