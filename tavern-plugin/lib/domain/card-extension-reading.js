function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function rawOf(value) {
  return object(value) && value.kind === 'dsh-tavern-character-workspace' && object(value.raw) ? value.raw : value
}

function dataOf(value) {
  const raw = rawOf(value)
  if (!object(raw)) return {}
  if ((raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3') && object(raw.data)) return raw.data
  return raw
}

function pretty(value) {
  if (typeof value === 'string') return value
  const text = JSON.stringify(value, null, 2)
  return text === undefined ? str(value) : text
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function depth(value) {
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
}

function regexScriptsOf(extensions) {
  const scripts = Array.isArray(extensions.regex_scripts) ? extensions.regex_scripts : []
  return scripts.filter(object).map(function (script, index) {
    const id = str(script.id).trim() || 'regex-' + (index + 1)
    return {
      ref: 'regex:' + index,
      id,
      name: str(script.scriptName || script.name).trim() || id,
      findRegex: str(script.findRegex),
      replaceString: str(script.replaceString),
      trimStrings: Array.isArray(script.trimStrings) ? script.trimStrings.map(str) : [],
      placement: Array.isArray(script.placement) ? script.placement.slice() : [],
      enabled: script.disabled !== true && script.enabled !== false,
      markdownOnly: script.markdownOnly === true,
      promptOnly: script.promptOnly === true,
      runOnEdit: script.runOnEdit === true,
      substituteRegex: script.substituteRegex === undefined ? null : script.substituteRegex,
      minDepth: depth(script.minDepth),
      maxDepth: depth(script.maxDepth)
    }
  })
}

function buttonCount(value) {
  if (Array.isArray(value)) return value.length
  if (object(value)) return Object.keys(value).length
  return value === undefined || value === null ? 0 : 1
}

function helperScriptsOf(extensions) {
  const helper = object(extensions.tavern_helper) ? extensions.tavern_helper : {}
  const scripts = Array.isArray(helper.scripts) ? helper.scripts : []
  return scripts.filter(object).map(function (script, index) {
    const id = str(script.id).trim() || 'helper-' + (index + 1)
    const content = str(script.content)
    const dataText = script.data === undefined ? '' : pretty(script.data)
    const info = script.info === undefined ? '' : pretty(script.info)
    return {
      ref: 'helper:' + index,
      id,
      name: str(script.name).trim() || id,
      type: str(script.type).trim() || 'script',
      enabled: script.enabled !== false && script.disabled !== true,
      content,
      data: object(script.data) ? clone(script.data) : {},
      dataText,
      info,
      buttons: object(script.button) && Array.isArray(script.button.buttons) ? clone(script.button.buttons) : [],
      buttonCount: buttonCount(script.button),
      exportWith: script.export_with === undefined ? null : script.export_with,
      chars: content.length + dataText.length
    }
  })
}

const MVU_PATTERN = /(?:\bmvu\b|magvarupdate|initvar|stat[_ -]?data|变量(?:更新|结构|列表|守卫))/i

function mvuMatch(parts) {
  return MVU_PATTERN.test(parts.map(str).join('\n'))
}

function worldBookEntriesOf(data) {
  const book = object(data.character_book) ? data.character_book : {}
  return Array.isArray(book.entries) ? book.entries : []
}

function mvuResourcesOf(data, extensions, regexScripts, helperScripts) {
  const result = []
  for (const key of Object.keys(extensions)) {
    if (/^(?:mvu|mvu_data|stat_data)$/i.test(key)) {
      result.push({ ref: 'extension:' + key, kind: 'extension', kindLabel: '扩展配置', name: key, enabled: true })
    }
  }
  for (const script of helperScripts) {
    if (mvuMatch([script.name, script.content, script.dataText])) result.push({ ref: script.ref, kind: 'helper', kindLabel: 'Helper 脚本', name: script.name, enabled: script.enabled })
  }
  for (const script of regexScripts) {
    if (mvuMatch([script.name, script.findRegex, script.replaceString])) result.push({ ref: script.ref, kind: 'regex', kindLabel: '正则脚本', name: script.name, enabled: script.enabled })
  }
  worldBookEntriesOf(data).forEach(function (entry, index) {
    if (!object(entry)) return
    const name = str(entry.comment || entry.name).trim() || '世界书条目 ' + (index + 1)
    const keys = Array.isArray(entry.keys) ? entry.keys.join(' ') : str(entry.keys)
    if (mvuMatch([name, keys, entry.content])) result.push({ ref: 'world-book:' + index, kind: 'world-book', kindLabel: '世界书', name, enabled: entry.enabled !== false })
  })
  return result
}

function extensionType(value) {
  if (Array.isArray(value)) return '数组'
  if (value === null) return 'null'
  if (object(value)) return '对象'
  if (typeof value === 'boolean') return '布尔值'
  if (typeof value === 'number') return '数字'
  if (typeof value === 'string') return '文本'
  return typeof value
}

function otherExtensionsOf(extensions) {
  const known = new Set(['regex_scripts', 'tavern_helper', 'mvu', 'mvu_data', 'stat_data'])
  return Object.keys(extensions).filter(function (key) { return !known.has(key.toLowerCase()) }).map(function (key) {
    const text = pretty(extensions[key])
    return { ref: 'extension:' + key, name: key, type: extensionType(extensions[key]), chars: text.length, text }
  })
}

export function inspectCardExtensions(value) {
  const data = dataOf(value)
  const extensions = object(data.extensions) ? data.extensions : {}
  const regexScripts = regexScriptsOf(extensions)
  const helperScripts = helperScriptsOf(extensions)
  const mvuResources = mvuResourcesOf(data, extensions, regexScripts, helperScripts)
  const otherExtensions = otherExtensionsOf(extensions)
  return {
    extensionCount: regexScripts.length + helperScripts.length + otherExtensions.length + mvuResources.filter(function (item) { return item.kind === 'extension' }).length,
    regexScripts,
    helperScripts,
    mvuResources,
    otherExtensions
  }
}
