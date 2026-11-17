const defaults = {
  story: ['让对手戏角色更主动', '多点暧昧动作', '增加突发插曲', '场景换到白天户外'],
  script: ['侧重角色行动', '直接开新场景']
}

function validateShortcuts(value) {
  if (!Array.isArray(value)) throw new Error('快捷提示列表无效')
  const items = []
  for (const item of value) {
    const text = typeof item === 'string' ? item.trim() : ''
    if (!text) throw new Error('快捷提示不能为空')
    items.push(text)
  }
  if (new Set(items).size !== items.length) throw new Error('已有相同的快捷提示')
  return items
}

function readMode(value, mode) {
  // An explicit empty list is the player's choice. Missing or invalid data uses the built-ins.
  if (Array.isArray(value?.[mode])) {
    try { return validateShortcuts(value[mode]) } catch (_) {}
  }
  return [...defaults[mode]]
}

export function readCandidateGuidanceShortcuts(value) {
  return { story: readMode(value, 'story'), script: readMode(value, 'script') }
}

function sameShortcuts(a, b) {
  return a.length === b.length && a.every((text, index) => text === b[index])
}

export function patchCandidateGuidanceShortcuts(value, change) {
  const { mode, items, expected } = change ?? {}
  if (mode !== 'story' && mode !== 'script') throw new Error('快捷提示模式无效')
  const nextItems = items === null ? defaults[mode] : validateShortcuts(items)
  const previous = validateShortcuts(expected)
  const current = readMode(value, mode)
  // Compare this mode only. A repeated write of the same list is safe after a lost response.
  if (!sameShortcuts(current, previous) && !sameShortcuts(current, nextItems)) {
    const error = new Error('快捷提示已在别处更新，请检查列表后重试。')
    error.code = 'CANDIDATE_SHORTCUTS_CHANGED'
    throw error
  }
  const next = { ...value }
  if (items === null) delete next[mode]
  else next[mode] = nextItems
  return next
}
