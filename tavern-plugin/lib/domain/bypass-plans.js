import { createHash } from 'node:crypto'

const BYPASS_PLAN_SCHEMA = 'dsh-tavern/bypass-plan'
const BYPASS_PLAN_FILE_VERSION = 1

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeCompatibleModels(value) {
  const values = Array.isArray(value) ? value : []
  return values.map(function (item) { return str(item).trim().slice(0, 160) }).filter(Boolean).filter(function (item, index, all) {
    return all.findIndex(function (candidate) { return candidate.toLocaleLowerCase() === item.toLocaleLowerCase() }) === index
  }).slice(0, 32)
}

function emptyState() {
  return { version: 1, activePlanId: '', plans: [], lastError: null, updatedAt: 0 }
}

function normalizedRole(value) {
  return value === 'user' || value === 'assistant' ? value : 'system'
}

function normalizeEntry(value) {
  const entry = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    entryKey: str(entry.entryKey),
    identifier: str(entry.identifier),
    name: str(entry.name || entry.identifier || entry.entryKey),
    role: normalizedRole(entry.role),
    content: str(entry.content),
    enabled: entry.enabled === true,
    marker: entry.marker === true,
    systemManaged: entry.systemManaged === true,
    ordered: entry.ordered !== false,
    injectable: entry.injectable === true || str(entry.content).trim() !== '',
    phase: entry.phase === 'middle' || entry.phase === 'back' ? entry.phase : 'front',
    injectionPosition: Number.isFinite(Number(entry.injectionPosition)) ? Number(entry.injectionPosition) : null,
    injectionDepth: Number.isFinite(Number(entry.injectionDepth)) ? Number(entry.injectionDepth) : null,
    injectionOrder: Number.isFinite(Number(entry.injectionOrder)) ? Number(entry.injectionOrder) : null,
    forbidOverrides: entry.forbidOverrides === true
  }
}

function normalizeRegex(value, index) {
  const script = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return Object.assign({}, clone(script), {
    regexKey: str(script.regexKey || script.id || 'regex-' + (index + 1)),
    id: str(script.id || script.regexKey || 'regex-' + (index + 1)),
    name: str(script.name || script.id || script.regexKey || '正则 ' + (index + 1)),
    findRegex: str(script.findRegex),
    replaceString: str(script.replaceString),
    enabled: script.enabled !== false
  })
}

function normalizePlan(value) {
  const plan = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const source = plan.source && typeof plan.source === 'object' && !Array.isArray(plan.source) ? plan.source : {}
  return {
    id: str(plan.id),
    name: str(plan.name).trim(),
    source: {
      presetName: str(source.presetName),
      presetPath: str(source.presetPath),
      presetDigest: str(source.presetDigest)
    },
    entries: (Array.isArray(plan.entries) ? plan.entries : []).map(normalizeEntry).filter(function (entry) { return entry.entryKey !== '' }),
    regexScripts: (Array.isArray(plan.regexScripts) ? plan.regexScripts : []).map(normalizeRegex).filter(function (script) { return script.regexKey !== '' }),
    compatibleModels: normalizeCompatibleModels(plan.compatibleModels),
    compatibilitySettings: plan.compatibilitySettings && typeof plan.compatibilitySettings === 'object' && !Array.isArray(plan.compatibilitySettings) ? clone(plan.compatibilitySettings) : {},
    createdAt: Number(plan.createdAt) || 0,
    updatedAt: Number(plan.updatedAt) || 0
  }
}

function normalizeState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const plans = (Array.isArray(source.plans) ? source.plans : []).map(normalizePlan).filter(function (plan) {
    return plan.id !== '' && plan.name !== ''
  })
  const activePlanId = plans.some(function (plan) { return plan.id === source.activePlanId }) ? str(source.activePlanId) : ''
  return {
    version: 1,
    activePlanId,
    plans,
    lastError: source.lastError && typeof source.lastError === 'object' ? clone(source.lastError) : null,
    updatedAt: Number(source.updatedAt) || 0
  }
}

function phaseValue(entries) {
  return {
    entries,
    text: entries.map(function (entry) { return str(entry.content) }).filter(Boolean).join('\n\n')
  }
}

function digestOf(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function presetPhases(preset) {
  const phases = new Map()
  const draft = preset && preset.dshPreset && typeof preset.dshPreset === 'object' ? preset.dshPreset : null
  if (draft) {
    for (const phase of ['front', 'middle', 'back']) {
      for (const entry of (Array.isArray(draft[phase]) ? draft[phase] : [])) phases.set(str(entry.id), phase)
    }
  }
  return phases
}

function compatibilitySettings(document) {
  const source = document && typeof document === 'object' && !Array.isArray(document) ? document : {}
  const result = {}
  for (const key of ['personality_format', 'scenario_format', 'new_example_chat_prompt']) {
    if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = clone(source[key])
  }
  return result
}

function planView(plan, activePlanId) {
  const enabledEntries = plan.entries.filter(function (entry) { return entry.enabled && !entry.marker && entry.injectable })
  const enabledRegexes = plan.regexScripts.filter(function (script) { return script.enabled && script.findRegex !== '' })
  return Object.assign(clone(plan), {
    active: plan.id === activePlanId,
    valid: plan.entries.every(function (entry) { return entry.entryKey !== '' }) && plan.regexScripts.every(function (script) { return script.regexKey !== '' }),
    enabledCount: enabledEntries.length,
    enabledCharacters: enabledEntries.reduce(function (total, entry) { return total + entry.content.length }, 0),
    enabledRegexCount: enabledRegexes.length
  })
}

export function createBypassPlanModule(options = {}) {
  const readPreset = options.readPreset
  const readPresetDocument = options.readPresetDocument
  const readState = options.readState
  const updateState = options.updateState
  const runtimeRegexScripts = typeof options.runtimeRegexScripts === 'function'
    ? options.runtimeRegexScripts
    : function (preset) { return Array.isArray(preset && preset.regexScripts) ? preset.regexScripts : [] }
  const now = typeof options.now === 'function' ? options.now : Date.now
  if ([readPreset, readPresetDocument, readState, updateState].some(function (fn) { return typeof fn !== 'function' })) {
    throw new TypeError('破限方案模块缺少存储适配器')
  }

  async function mutate(updater) {
    return updateState(async function (value) {
      const current = normalizeState(value)
      const next = await updater(current)
      if (next === undefined) return undefined
      next.updatedAt = now()
      return next
    })
  }

  async function state() {
    return normalizeState(await readState())
  }

  async function list() {
    const current = await state()
    return current.plans.map(function (plan) { return planView(plan, current.activePlanId) })
  }

  async function get(id) {
    const current = await state()
    const plan = current.plans.find(function (item) { return item.id === id })
    if (!plan) throw new Error('破限方案不存在：' + id)
    return planView(plan, current.activePlanId)
  }

  async function extract(input = {}) {
    const path = str(input.sourcePresetPath)
    const name = str(input.name).trim()
    if (path === '') throw new Error('请选择外部预设')
    if (name === '') throw new Error('破限方案名称不能为空')
    const preset = await readPreset(path)
    const document = await readPresetDocument(path)
    if (!preset || preset.valid !== true || preset.recognized !== true) throw new Error('外部预设不存在或无法识别：' + path)
    const selectedKeys = new Set((Array.isArray(input.entryKeys) ? input.entryKeys : []).map(str).filter(Boolean))
    const available = new Map((preset.entries || []).map(function (entry) { return [str(entry.entryKey), entry] }))
    for (const key of selectedKeys) {
      const entry = available.get(key)
      if (!entry || entry.marker === true || str(entry.content).trim() === '') throw new Error('外部预设条目不可抽取：' + key)
    }
    const phases = presetPhases(preset)
    const entries = []
    for (const source of (preset.entries || [])) {
      const key = str(source.entryKey)
      const systemManaged = source.marker === true && source.ordered === true
      if (!systemManaged && !selectedKeys.has(key)) continue
      entries.push(normalizeEntry(Object.assign({}, source, {
        enabled: systemManaged ? source.enabled !== false : true,
        systemManaged,
        phase: phases.get(key) || (Number(source.injectionPosition) === 1 ? 'middle' : 'front')
      })))
    }
    const availableRegexes = runtimeRegexScripts(preset, document).map(normalizeRegex)
    const requestedRegexKeys = Array.isArray(input.regexKeys) ? new Set(input.regexKeys.map(str)) : null
    const regexScripts = availableRegexes.filter(function (script) {
      return requestedRegexKeys === null || requestedRegexKeys.has(script.regexKey)
    })
    if (requestedRegexKeys !== null) {
      const present = new Set(availableRegexes.map(function (script) { return script.regexKey }))
      for (const key of requestedRegexKeys) if (!present.has(key)) throw new Error('外部预设正则不可抽取：' + key)
    }
    const current = await state()
    const existing = str(input.id) === '' ? null : current.plans.find(function (item) { return item.id === str(input.id) })
    if (input.id && !existing) throw new Error('破限方案不存在：' + input.id)
    if (current.plans.some(function (item) { return item.name === name && (!existing || item.id !== existing.id) })) throw new Error('破限方案名称已存在：' + name)
    const stamp = now()
    const id = existing ? existing.id : 'bypass-' + digestOf(name + '\n' + path + '\n' + stamp).slice(0, 12)
    const plan = normalizePlan({
      id,
      name,
      source: { presetName: str(preset.title), presetPath: path, presetDigest: digestOf(document) },
      entries,
      regexScripts,
      compatibleModels: input.compatibleModels,
      compatibilitySettings: compatibilitySettings(document),
      createdAt: existing ? existing.createdAt : stamp,
      updatedAt: stamp
    })
    await mutate(function (latest) {
      const index = latest.plans.findIndex(function (item) { return item.id === id })
      if (index === -1) latest.plans.push(plan)
      else latest.plans[index] = plan
      latest.lastError = null
      return latest
    })
    return planView(plan, (await state()).activePlanId)
  }

  async function importPlan(input = {}) {
    const name = str(input.name).trim()
    if (name === '') throw new Error('破限方案名称不能为空')
    const current = await state()
    const requestedId = str(input.id)
    const existing = requestedId === '' ? null : current.plans.find(function (item) { return item.id === requestedId })
    if (requestedId !== '' && !existing && input.allowCreateWithId !== true) throw new Error('破限方案不存在：' + requestedId)
    if (current.plans.some(function (item) { return item.name === name && (!existing || item.id !== existing.id) })) throw new Error('破限方案名称已存在：' + name)
    const stamp = now()
    const id = existing ? existing.id : (requestedId || 'bypass-' + digestOf(name + '\n' + stamp).slice(0, 12))
    const plan = normalizePlan({
      id,
      name,
      source: input.source,
      entries: input.entries,
      regexScripts: input.regexScripts,
      compatibleModels: input.compatibleModels,
      compatibilitySettings: input.compatibilitySettings,
      createdAt: existing ? existing.createdAt : stamp,
      updatedAt: stamp
    })
    if (plan.entries.length === 0 && plan.regexScripts.length === 0) throw new Error('破限方案没有可保存的提示词或正则')
    await mutate(function (latest) {
      const index = latest.plans.findIndex(function (item) { return item.id === id })
      if (index === -1) latest.plans.push(plan)
      else latest.plans[index] = plan
      return latest
    })
    return planView(plan, (await state()).activePlanId)
  }

  async function exportPlan(id) {
    const plan = await get(id)
    return {
      schema: BYPASS_PLAN_SCHEMA,
      version: BYPASS_PLAN_FILE_VERSION,
      exportedAt: now(),
      plan: {
        name: plan.name,
        source: clone(plan.source),
        entries: clone(plan.entries),
        regexScripts: clone(plan.regexScripts),
        compatibleModels: clone(plan.compatibleModels),
        compatibilitySettings: clone(plan.compatibilitySettings)
      }
    }
  }

  async function importPackage(value) {
    const document = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    if (document.schema !== BYPASS_PLAN_SCHEMA) throw new Error('文件不是 DSH Tavern 破限方案文件')
    if (document.version !== BYPASS_PLAN_FILE_VERSION) throw new Error('破限方案文件版本暂不支持：' + str(document.version))
    const plan = document.plan && typeof document.plan === 'object' && !Array.isArray(document.plan) ? document.plan : null
    if (plan === null) throw new Error('破限方案文件缺少方案内容')
    if (!Array.isArray(plan.entries) || !Array.isArray(plan.regexScripts)) throw new Error('破限方案文件内容不完整')
    return await importPlan({
      name: plan.name,
      source: plan.source,
      entries: plan.entries,
      regexScripts: plan.regexScripts,
      compatibleModels: plan.compatibleModels,
      compatibilitySettings: plan.compatibilitySettings
    })
  }

  async function activate(id) {
    const selected = str(id)
    return mutate(function (current) {
      if (selected !== '' && !current.plans.some(function (plan) { return plan.id === selected })) throw new Error('破限方案不存在：' + selected)
      current.activePlanId = selected
      current.lastError = null
      return current
    })
  }

  async function toggleEntry({ id, entryKey, enabled }) {
    return mutate(function (current) {
      const plan = current.plans.find(function (item) { return item.id === id })
      if (!plan) throw new Error('破限方案不存在：' + id)
      const entry = plan.entries.find(function (item) { return item.entryKey === entryKey })
      if (!entry || entry.systemManaged) throw new Error('破限方案条目不可调整：' + entryKey)
      entry.enabled = enabled === true
      plan.updatedAt = now()
      return current
    })
  }

  async function toggleRegex({ id, regexKey, enabled }) {
    return mutate(function (current) {
      const plan = current.plans.find(function (item) { return item.id === id })
      if (!plan) throw new Error('破限方案不存在：' + id)
      const script = plan.regexScripts.find(function (item) { return item.regexKey === regexKey })
      if (!script) throw new Error('破限方案正则不存在：' + regexKey)
      script.enabled = enabled === true
      plan.updatedAt = now()
      return current
    })
  }

  async function setCompatibleModels({ id, compatibleModels }) {
    await mutate(function (current) {
      const plan = current.plans.find(function (item) { return item.id === id })
      if (!plan) throw new Error('破限方案不存在：' + id)
      plan.compatibleModels = normalizeCompatibleModels(compatibleModels)
      plan.updatedAt = now()
      return current
    })
    return await get(id)
  }

  async function rename(id, name) {
    const nextName = str(name).trim()
    if (nextName === '') throw new Error('破限方案名称不能为空')
    await mutate(function (current) {
      const plan = current.plans.find(function (item) { return item.id === id })
      if (!plan) throw new Error('破限方案不存在：' + id)
      if (current.plans.some(function (item) { return item.id !== id && item.name === nextName })) throw new Error('破限方案名称已存在：' + nextName)
      plan.name = nextName
      plan.updatedAt = now()
      return current
    })
    return await get(id)
  }

  async function copy(id, name) {
    const current = await state()
    const source = current.plans.find(function (item) { return item.id === id })
    if (!source) throw new Error('破限方案不存在：' + id)
    const nextName = str(name).trim() || source.name + ' 副本'
    if (current.plans.some(function (item) { return item.name === nextName })) throw new Error('破限方案名称已存在：' + nextName)
    const stamp = now()
    const next = normalizePlan(Object.assign({}, clone(source), {
      id: 'bypass-' + digestOf(nextName + '\n' + stamp).slice(0, 12),
      name: nextName,
      createdAt: stamp,
      updatedAt: stamp
    }))
    await mutate(function (latest) {
      latest.plans.push(next)
      return latest
    })
    return planView(next, (await state()).activePlanId)
  }

  async function remove(id) {
    await mutate(function (current) {
      if (!current.plans.some(function (plan) { return plan.id === id })) throw new Error('破限方案不存在：' + id)
      current.plans = current.plans.filter(function (plan) { return plan.id !== id })
      if (current.activePlanId === id) current.activePlanId = ''
      return current
    })
  }

  async function snapshot(requestedId) {
    const current = await state()
    const id = str(requestedId) || current.activePlanId
    if (id === '') return null
    const plan = current.plans.find(function (item) { return item.id === id })
    if (!plan) throw new Error('破限方案不存在：' + id)
    const phases = { front: [], middle: [], back: [] }
    const sources = []
    for (const entry of plan.entries) {
      if (!entry.enabled || entry.marker || !entry.injectable) continue
      const phase = entry.phase === 'middle' || entry.phase === 'back' ? entry.phase : 'front'
      const projected = {
        id: entry.entryKey,
        role: entry.role,
        content: entry.content,
        name: entry.name,
        source: { planId: plan.id, entryKey: entry.entryKey, identifier: entry.identifier, name: entry.name }
      }
      phases[phase].push(projected)
      sources.push(Object.assign({ phase }, projected.source))
    }
    const front = phaseValue(phases.front)
    const middle = phaseValue(phases.middle)
    const back = phaseValue(phases.back)
    const regexScripts = plan.regexScripts.filter(function (script) { return script.enabled && script.findRegex !== '' }).map(clone)
    const result = {
      planId: plan.id,
      planName: plan.name,
      compatibleModels: clone(plan.compatibleModels),
      front,
      middle,
      back,
      text: [front.text, middle.text, back.text].filter(Boolean).join('\n\n'),
      sources,
      regexScripts,
      regexSources: regexScripts.map(function (script) { return { planId: plan.id, regexKey: script.regexKey, id: script.id, name: script.name } }),
      createdAt: now()
    }
    result.digest = digestOf({ front, middle, back, regexScripts })
    return result
  }

  async function regexScriptsFor(planId) {
    const plan = await get(planId)
    return plan.regexScripts.filter(function (script) { return script.enabled && script.findRegex !== '' }).map(clone)
  }

  return { state, list, get, extract, importPlan, exportPlan, importPackage, activate, toggleEntry, toggleRegex, setCompatibleModels, rename, copy, remove, snapshot, regexScriptsFor }
}
