import { regexScriptsOf } from './preset-reading.js'

const MATERIAL_MARKERS = Object.freeze({
  charDescription: 'character.description',
  charPersonality: 'character.personality',
  scenario: 'character.scenario',
  personaDescription: 'player.description',
  dialogueExamples: 'character.dialogueExamples',
  worldInfoBefore: 'worldbook.before',
  worldInfoAfter: 'worldbook.after'
})

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function titleOf(filename) {
  const name = str(filename).split(/[\\/]/).pop() || '未命名预设'
  return name.replace(/\.json$/i, '') || '未命名预设'
}

function roleOf(value) {
  const role = str(value).trim().toLowerCase()
  return role === 'user' || role === 'assistant' || role === 'system' ? role : 'system'
}

function numberOrNull(value) {
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
}

function macrosOf(content) {
  const text = str(content)
  return {
    count: (text.match(/{{[\s\S]*?}}/g) || []).length,
    setvar: (text.match(/{{\s*setvar\b/gi) || []).length,
    getvar: (text.match(/{{\s*getvar\b/gi) || []).length
  }
}

function phaseStats(entries) {
  const roles = {}
  let textCharacters = 0
  let enabledTextCharacters = 0
  let materialCount = 0
  for (const entry of entries) {
    roles[entry.role] = (roles[entry.role] || 0) + 1
    if (entry.type === 'material') materialCount += 1
    else {
      textCharacters += entry.content.length
      if (entry.enabled) enabledTextCharacters += entry.content.length
    }
  }
  return {
    count: entries.length,
    enabledCount: entries.filter(function (entry) { return entry.enabled }).length,
    disabledCount: entries.filter(function (entry) { return !entry.enabled }).length,
    textCharacters,
    enabledTextCharacters,
    materialCount,
    roles
  }
}

function diagnostic(severity, code, message, entryKeys = []) {
  return { severity, code, message, entryKeys }
}

function nativeEntry(entry) {
  return {
    id: entry.entryKey,
    name: entry.name,
    order: entry.orderIndex,
    role: entry.role,
    enabled: entry.enabled,
    type: entry.type,
    content: entry.type === 'text' ? entry.content : '',
    material: entry.type === 'material' ? entry.material : null,
    source: {
      identifier: entry.identifier,
      marker: entry.marker,
      injectionPosition: entry.injectionPosition,
      injectionDepth: entry.injectionDepth,
      injectionOrder: entry.injectionOrder
    }
  }
}

export function previewPresetConversion(text, filename = '', options = {}) {
  let document
  try {
    document = JSON.parse(str(text))
  } catch {
    return {
      valid: false,
      recognized: false,
      title: titleOf(filename),
      error: '文件不是有效的 JSON',
      orderGroups: [],
      selectedOrderGroupIndex: null,
      sourceRows: [],
      phases: { front: [], middle: [], back: [] },
      excluded: { unordered: [], nativeMaterials: [] },
      unconverted: { prompts: [], unselectedOrderGroups: [] },
      diagnostics: []
    }
  }

  const object = document !== null && typeof document === 'object' && !Array.isArray(document) ? document : null
  const promptDefinitions = object && Array.isArray(object.prompts)
    ? object.prompts.filter(function (item) { return item !== null && typeof item === 'object' && !Array.isArray(item) })
    : []
  if (object === null || !Array.isArray(object.prompts)) {
    return {
      valid: true,
      recognized: false,
      title: titleOf(filename),
      error: '尚未识别出 SillyTavern prompts 结构',
      orderGroups: [],
      selectedOrderGroupIndex: null,
      sourceRows: [],
      phases: { front: [], middle: [], back: [] },
      excluded: { unordered: [], nativeMaterials: [] },
      unconverted: { prompts: [], unselectedOrderGroups: [] },
      diagnostics: []
    }
  }

  const occurrenceCounts = new Map()
  const records = promptDefinitions.map(function (prompt, sourceIndex) {
    const identifier = str(prompt.identifier).trim() || 'prompt-' + (sourceIndex + 1)
    const occurrence = (occurrenceCounts.get(identifier) || 0) + 1
    occurrenceCounts.set(identifier, occurrence)
    const content = str(prompt.content)
    return {
      identifier,
      entryKey: identifier + '#' + occurrence,
      name: str(prompt.name).trim() || identifier,
      role: roleOf(prompt.role),
      content,
      marker: prompt.marker === true,
      sourceIndex,
      injectionPosition: numberOrNull(prompt.injection_position),
      injectionDepth: numberOrNull(prompt.injection_depth),
      injectionOrder: numberOrNull(prompt.injection_order),
      macros: macrosOf(content)
    }
  })

  const orderGroups = (Array.isArray(object.prompt_order) ? object.prompt_order : []).map(function (group, index) {
    if (group === null || typeof group !== 'object' || !Array.isArray(group.order)) return null
    return {
      index,
      characterId: group.character_id === undefined ? null : group.character_id,
      label: group.character_id === undefined ? '第 ' + (index + 1) + ' 组' : '角色组 ' + group.character_id,
      itemCount: group.order.length,
      enabledCount: group.order.filter(function (item) { return item && item.enabled !== false }).length,
      order: group.order
    }
  }).filter(Boolean)

  let selectedGroup
  if (Number.isInteger(Number(options.orderGroupIndex))) {
    selectedGroup = orderGroups.find(function (group) { return group.index === Number(options.orderGroupIndex) })
  }
  if (selectedGroup === undefined) {
    selectedGroup = orderGroups.find(function (group) { return Number(group.characterId) === 100001 }) || orderGroups[0]
  }

  const queues = new Map()
  for (const record of records) {
    const matches = queues.get(record.identifier) || []
    matches.push(record)
    queues.set(record.identifier, matches)
  }

  const selectedItems = selectedGroup === undefined
    ? records.map(function (record) { return { identifier: record.identifier, enabled: promptDefinitions[record.sourceIndex].enabled !== false } })
    : selectedGroup.order
  const used = new Set()
  const sourceRows = []
  const phases = { front: [], middle: [], back: [] }
  const disabled = []
  const nativeMaterials = []
  const missing = []
  const unknownMarkers = []
  let afterHistory = false

  selectedItems.forEach(function (item, orderIndex) {
    if (item === null || typeof item !== 'object') return
    const identifier = str(item.identifier).trim()
    if (identifier === '') return
    const matches = queues.get(identifier) || []
    const record = matches.find(function (candidate) { return !used.has(candidate) })
    const enabled = item.enabled !== false
    if (record === undefined) {
      const row = {
        entryKey: identifier + '#missing-' + (orderIndex + 1),
        identifier,
        name: identifier,
        role: 'system',
        content: '',
        marker: false,
        enabled,
        orderIndex,
        targetPhase: afterHistory ? 'back' : 'front',
        type: 'missing',
        missing: true,
        macros: { count: 0, setvar: 0, getvar: 0 }
      }
      sourceRows.push(row)
      missing.push(row)
      return
    }
    used.add(record)

    if (identifier === 'chatHistory') {
      const row = Object.assign({}, record, {
        enabled,
        orderIndex,
        targetPhase: 'history',
        type: 'history',
        material: null,
        missing: false
      })
      sourceRows.push(row)
      afterHistory = true
      return
    }

    const targetPhase = record.injectionPosition === 1 ? 'middle' : (afterHistory ? 'back' : 'front')
    const material = record.marker ? MATERIAL_MARKERS[identifier] : undefined
    const row = Object.assign({}, record, {
      enabled,
      orderIndex,
      targetPhase,
      type: record.marker ? 'material' : 'text',
      material: material || null,
      missing: false
    })
    sourceRows.push(row)
    if (record.marker && material !== undefined) {
      nativeMaterials.push(row)
      return
    }
    if (record.marker && material === undefined) {
      row.unconvertedReason = '未知 marker'
      unknownMarkers.push(row)
      return
    }
    phases[targetPhase].push(row)
    if (!enabled) disabled.push(row)
  })

  const unordered = []
  for (const record of records.filter(function (item) { return !used.has(item) })) {
    const row = Object.assign({}, record, {
      enabled: false,
      orderIndex: null,
      targetPhase: null,
      type: record.marker ? 'material' : 'text',
      material: record.marker ? MATERIAL_MARKERS[record.identifier] || null : null,
      missing: false,
      unconvertedReason: '未编排'
    })
    if (record.marker && MATERIAL_MARKERS[record.identifier] !== undefined) nativeMaterials.push(row)
    else unordered.push(row)
  }

  const diagnostics = []
  const macroEntries = phases.front.concat(phases.middle, phases.back).filter(function (entry) { return entry.enabled && entry.macros.count > 0 })
  if (macroEntries.length > 0) {
    const macroCount = macroEntries.reduce(function (total, entry) { return total + entry.macros.count }, 0)
    diagnostics.push(diagnostic('info', 'TAVERN_MACRO_RUNTIME', macroEntries.length + ' 个启用条目含酒馆宏，共 ' + macroCount + ' 处；开始新对话时会按前、中、后顺序解析一次。', macroEntries.map(function (entry) { return entry.entryKey })))
  }
  if (unknownMarkers.length > 0) diagnostics.push(diagnostic('error', 'UNKNOWN_MARKER', unknownMarkers.length + ' 个启用占位符无法识别，需要人工检查。', unknownMarkers.map(function (entry) { return entry.entryKey })))
  if (missing.length > 0) diagnostics.push(diagnostic('error', 'ORDER_ENTRY_MISSING', missing.length + ' 个 order 条目没有对应 prompt 定义。', missing.map(function (entry) { return entry.entryKey })))
  const depthEntries = phases.middle.filter(function (entry) { return entry.injectionPosition === 1 })
  if (depthEntries.length > 0) diagnostics.push(diagnostic('warning', 'TAVERN_DEPTH_COLLAPSED', depthEntries.length + ' 个深度注入条目已归入中段；原深度和顺序仅保留作兼容记录。', depthEntries.map(function (entry) { return entry.entryKey })))
  if (phases.middle.length === 0) diagnostics.push(diagnostic('warning', 'MIDDLE_EMPTY', '所选顺序没有启用的深度注入条目，按当前结构规则转换后中段为空。'))
  if (orderGroups.length > 1) diagnostics.push(diagnostic('info', 'ORDER_GROUP_NOT_SELECTED', '当前只预览 ' + selectedGroup.label + '，其余 ' + (orderGroups.length - 1) + ' 组未参与转换。'))
  if (disabled.length > 0) diagnostics.push(diagnostic('info', 'DISABLED_ENTRIES_PRESERVED', disabled.length + ' 个关闭条目已保留在 DSH 三段中，并保持关闭状态。', disabled.map(function (entry) { return entry.entryKey })))
  if (nativeMaterials.length > 0) diagnostics.push(diagnostic('info', 'NATIVE_MATERIAL_MARKERS_IGNORED', nativeMaterials.length + ' 个人物卡或世界书占位符由系统自动提供，未在预设中重复显示。', nativeMaterials.map(function (entry) { return entry.entryKey })))
  if (unordered.length > 0) diagnostics.push(diagnostic('info', 'UNORDERED_PROMPTS_EXCLUDED', unordered.length + ' 个未编排 prompt 未进入 DSH 三段。', unordered.map(function (entry) { return entry.entryKey })))

  const regexScripts = regexScriptsOf(object)

  const errorCount = diagnostics.filter(function (item) { return item.severity === 'error' }).length
  const dshPreset = {
    schema: 'dsh.preset.draft/v1',
    title: titleOf(filename),
    sourceOrderGroup: selectedGroup === undefined ? null : selectedGroup.index,
    front: phases.front.map(nativeEntry),
    middle: phases.middle.map(nativeEntry),
    back: phases.back.map(nativeEntry),
    regex: regexScripts
  }
  const unselectedOrderGroups = orderGroups.filter(function (group) { return selectedGroup === undefined || group.index !== selectedGroup.index }).map(function (group) {
    return { index: group.index, label: group.label, value: object.prompt_order[group.index] }
  })
  const unconvertedPrompts = missing.concat(unknownMarkers, unordered).map(function (entry) {
    if (entry.missing) return Object.assign({}, entry, { unconvertedReason: '缺失 prompt 定义' })
    return entry
  })
  return {
    valid: true,
    recognized: true,
    title: titleOf(filename),
    error: '',
    status: errorCount > 0 ? 'review-required' : 'ready',
    orderGroups: orderGroups.map(function (group) {
      return { index: group.index, characterId: group.characterId, label: group.label, itemCount: group.itemCount, enabledCount: group.enabledCount }
    }),
    selectedOrderGroupIndex: selectedGroup === undefined ? null : selectedGroup.index,
    selectedOrderGroupLabel: selectedGroup === undefined ? 'prompts 原始顺序' : selectedGroup.label,
    dshPreset,
    sourceRows,
    phases,
    phaseStats: {
      front: phaseStats(phases.front),
      middle: phaseStats(phases.middle),
      back: phaseStats(phases.back)
    },
    excluded: { unordered, nativeMaterials },
    unconverted: {
      prompts: unconvertedPrompts,
      unselectedOrderGroups
    },
    diagnostics,
    regexCount: regexScripts.length,
    summary: {
      promptDefinitions: records.length,
      orderedRows: sourceRows.length,
      convertedRows: phases.front.length + phases.middle.length + phases.back.length,
      enabledRows: phases.front.concat(phases.middle, phases.back).filter(function (entry) { return entry.enabled }).length,
      disabledRows: disabled.length,
      nativeMaterialRows: nativeMaterials.length,
      unorderedRows: unordered.length,
      unconvertedRows: unconvertedPrompts.length,
      regexRows: regexScripts.length,
      enabledRegexRows: regexScripts.filter(function (script) { return script.enabled }).length
    }
  }
}
