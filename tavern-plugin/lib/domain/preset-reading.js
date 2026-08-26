function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function titleOf(filename) {
  const name = str(filename).split(/[\\/]/).pop() || '未命名预设'
  return name.replace(/\.json$/i, '') || '未命名预设'
}

function normalizedRole(value) {
  const role = str(value).trim().toLowerCase()
  return role === 'user' || role === 'assistant' || role === 'system' ? role : 'system'
}

function depth(value) {
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
}

export function regexScriptsOf(object) {
  const binding = object && object.extensions && object.extensions.SPreset && object.extensions.SPreset.RegexBinding
  const regexes = binding && Array.isArray(binding.regexes) ? binding.regexes : []
  return regexes.filter(function (item) { return item !== null && typeof item === 'object' && !Array.isArray(item) }).map(function (item, index) {
    const id = str(item.id).trim() || 'regex-' + (index + 1)
    return {
      id,
      name: str(item.scriptName).trim() || id,
      findRegex: str(item.findRegex),
      replaceString: str(item.replaceString),
      trimStrings: Array.isArray(item.trimStrings) ? item.trimStrings.map(str) : [],
      placement: Array.isArray(item.placement) ? item.placement.slice() : [],
      enabled: item.disabled !== true,
      markdownOnly: item.markdownOnly === true,
      promptOnly: item.promptOnly === true,
      runOnEdit: item.runOnEdit === true,
      substituteRegex: item.substituteRegex === undefined ? null : item.substituteRegex,
      minDepth: depth(item.minDepth),
      maxDepth: depth(item.maxDepth)
    }
  })
}

export function inspectPreset(text, filename = '') {
  let document
  try {
    document = JSON.parse(str(text))
  } catch {
    return {
      valid: false,
      recognized: false,
      title: titleOf(filename),
      promptCount: 0,
      enabledCount: 0,
      entries: [],
      regexCount: 0,
      enabledRegexCount: 0,
      regexScripts: [],
      rootKeys: [],
      warning: '',
      error: '文件不是有效的 JSON'
    }
  }
  const object = document !== null && typeof document === 'object' && !Array.isArray(document) ? document : null
  const rootKeys = object === null ? [] : Object.keys(object)
  const regexScripts = regexScriptsOf(object)
  const prompts = object !== null && Array.isArray(object.prompts) ? object.prompts.map(function (item, sourceIndex) {
    return item !== null && typeof item === 'object' && !Array.isArray(item) ? { source: item, sourceIndex } : null
  }).filter(Boolean) : []
  const recognized = object !== null && Array.isArray(object.prompts)
  if (!recognized) {
    return {
      valid: true,
      recognized: false,
      title: titleOf(filename),
      promptCount: 0,
      enabledCount: 0,
      entries: [],
      regexCount: regexScripts.length,
      enabledRegexCount: regexScripts.filter(function (script) { return script.enabled }).length,
      regexScripts,
      rootKeys,
      warning: '这是有效的 JSON，但尚未识别出 SillyTavern prompts 结构。原文件仍会完整保留。',
      error: ''
    }
  }

  const records = []
  const recordsByIdentifier = new Map()
  prompts.forEach(function (sourceRecord, index) {
    const prompt = sourceRecord.source
    const identifier = str(prompt.identifier).trim() || 'prompt-' + (index + 1)
    const record = {
      identifier,
      name: str(prompt.name).trim() || identifier,
      role: normalizedRole(prompt.role),
      content: str(prompt.content),
      enabled: prompt.enabled !== false,
      marker: prompt.marker === true,
      systemPrompt: prompt.system_prompt === true,
      ordered: false,
      injectionPosition: Number.isFinite(Number(prompt.injection_position)) ? Number(prompt.injection_position) : null,
      injectionDepth: Number.isFinite(Number(prompt.injection_depth)) ? Number(prompt.injection_depth) : null,
      injectionOrder: Number.isFinite(Number(prompt.injection_order)) ? Number(prompt.injection_order) : null,
      sourcePromptIndex: sourceRecord.sourceIndex
    }
    records.push(record)
    const matches = recordsByIdentifier.get(identifier) || []
    matches.push(record)
    recordsByIdentifier.set(identifier, matches)
  })

  const orders = object !== null && Array.isArray(object.prompt_order) ? object.prompt_order : []
  const selectedOrderGroupIndex = orders.findIndex(function (item) { return item && Number(item.character_id) === 100001 && Array.isArray(item.order) })
  const fallbackOrderGroupIndex = orders.findIndex(function (item) { return item && Array.isArray(item.order) })
  const orderGroupIndex = selectedOrderGroupIndex >= 0 ? selectedOrderGroupIndex : fallbackOrderGroupIndex
  const selectedOrder = orderGroupIndex >= 0 ? orders[orderGroupIndex] : undefined
  const entries = []
  const used = new Set()
  for (const [orderItemIndex, item] of ((selectedOrder && selectedOrder.order) || []).entries()) {
    if (item === null || typeof item !== 'object') continue
    const identifier = str(item.identifier).trim()
    if (identifier === '') continue
    const matches = recordsByIdentifier.get(identifier) || []
    const record = matches.find(function (candidate) { return !used.has(candidate) })
    if (record === undefined) {
      entries.push({ identifier, name: identifier, role: 'system', content: '', enabled: item.enabled !== false, marker: true, systemPrompt: true, ordered: true, injectionPosition: null, injectionDepth: null, injectionOrder: null, sourcePromptIndex: null, sourceOrderGroupIndex: orderGroupIndex, sourceOrderItemIndex: orderItemIndex })
    } else {
      entries.push(Object.assign({}, record, { enabled: item.enabled !== false, ordered: true, sourceOrderGroupIndex: orderGroupIndex, sourceOrderItemIndex: orderItemIndex }))
    }
    if (record !== undefined) used.add(record)
  }
  for (const record of records) {
    if (used.has(record)) continue
    entries.push(record)
  }

  const occurrences = new Map()
  for (const entry of entries) {
    const occurrence = (occurrences.get(entry.identifier) || 0) + 1
    occurrences.set(entry.identifier, occurrence)
    entry.entryKey = entry.identifier + '#' + occurrence
    entry.injectable = entry.content.trim() !== ''
    const promptPath = Number.isInteger(entry.sourcePromptIndex) ? '/prompts/' + entry.sourcePromptIndex : null
    const orderPath = Number.isInteger(entry.sourceOrderGroupIndex) && Number.isInteger(entry.sourceOrderItemIndex)
      ? '/prompt_order/' + entry.sourceOrderGroupIndex + '/order/' + entry.sourceOrderItemIndex
      : null
    entry.edit = {
      promptPath,
      enabledPaths: [promptPath, orderPath].filter(Boolean).map(function (path) { return path + '/enabled' })
    }
  }

  return {
    valid: true,
    recognized: true,
    title: titleOf(filename),
    promptCount: entries.length,
    enabledCount: entries.filter(function (entry) { return entry.enabled }).length,
    entries,
    regexCount: regexScripts.length,
    enabledRegexCount: regexScripts.filter(function (script) { return script.enabled }).length,
    regexScripts,
    orderGroupIndex,
    rootKeys,
    warning: selectedOrder === undefined && entries.length > 0 ? '预设没有可用的 prompt_order，当前按 prompts 原始顺序展示。' : '',
    error: ''
  }
}
