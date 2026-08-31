function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

const LOGIC = ['and_any', 'not_all', 'not_any', 'and_all']
const ROLE = ['system', 'user', 'assistant']

function strategyType(entry) {
  if (entry.constant === true) return 'constant'
  if (entry.vectorized === true) return 'vectorized'
  return 'selective'
}

function positionType(value) {
  if (value === 'before_char' || Number(value) === 0) return 'before_character_definition'
  if (value === 'after_char' || Number(value) === 1) return 'after_character_definition'
  if (value === 'before_example' || Number(value) === 5) return 'before_example_messages'
  if (value === 'after_example' || Number(value) === 6) return 'after_example_messages'
  if (value === 'before_an' || Number(value) === 2) return 'before_author_note'
  if (value === 'after_an' || Number(value) === 3) return 'after_author_note'
  if (value === 'at_depth' || Number(value) === 4) return 'at_depth'
  if (value === 'outlet' || Number(value) === 7) return 'outlet'
  return 'after_character_definition'
}

function projectEntry(entry) {
  return {
    uid: Number.isFinite(Number(entry.sourceUid)) ? Number(entry.sourceUid) : str(entry.sourceUid),
    name: str(entry.comment ?? entry.title),
    enabled: entry.enabled !== false,
    strategy: {
      type: strategyType(entry),
      keys: clone(entry.primaryKeys || []),
      keys_secondary: { logic: LOGIC[Number(entry.selectiveLogic) || 0] || 'and_any', keys: clone(entry.secondaryKeys || []) },
      scan_depth: entry.scanDepth === null || entry.scanDepth === undefined ? 'same_as_global' : entry.scanDepth
    },
    position: {
      type: positionType(entry.position),
      role: ROLE[Number(entry.role) || 0] || 'system',
      depth: Number.isFinite(Number(entry.depth)) ? Number(entry.depth) : 4,
      order: Number(entry.order) || 0
    },
    content: str(entry.content),
    probability: entry.probabilityEnabled === false ? 100 : (Number.isFinite(Number(entry.probability)) ? Number(entry.probability) : 100),
    recursion: {
      prevent_incoming: entry.excludeRecursion === true,
      prevent_outgoing: entry.preventRecursion === true,
      delay_until: Number(entry.delayUntilRecursion) > 0 ? Number(entry.delayUntilRecursion) : null
    },
    effect: {
      sticky: entry.sticky ?? null,
      cooldown: entry.cooldown ?? null,
      delay: entry.delay ?? null
    },
    extra: Object.assign({}, clone(entry.rawEntry && entry.rawEntry.extensions && entry.rawEntry.extensions.dsh_tavern_helper_extra || {}), { displayIndex: entry.displayIndex ?? 0, caseSensitive: entry.caseSensitive ?? null, matchWholeWords: entry.matchWholeWords ?? null, group: str(entry.group), dsh_tavern_ref: str(entry.ref) })
  }
}

export function projectTavernHelperWorldbook(view) {
  return {
    name: str(view && view.displayName),
    entries: (Array.isArray(view && view.entries) ? view.entries : []).map(projectEntry)
  }
}

const POSITIONS = ['before_character_definition', 'after_character_definition', 'before_author_note', 'after_author_note', 'at_depth', 'before_example_messages', 'after_example_messages', 'outlet']

function enumValue(value, values, label) {
  const index = values.indexOf(value)
  if (index < 0) throw new Error('未知世界书' + label + ': ' + str(value))
  return index
}

function finite(value, label, nullable = false, minimum = 0) {
  if (nullable && value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) throw new Error('无效世界书' + label)
  return value
}

function keys(value) {
  if (!Array.isArray(value) || value.some(key => typeof key !== 'string')) throw new Error('世界书关键词必须是字符串数组')
  return clone(value)
}

function mergedEntry(base, value) {
  const result = Object.assign({}, base, value)
  for (const name of ['strategy', 'position', 'recursion', 'effect', 'extra']) {
    result[name] = Object.assign({}, base[name], value[name])
  }
  result.strategy.keys_secondary = Object.assign({}, base.strategy.keys_secondary, value.strategy && value.strategy.keys_secondary)
  return result
}

function entryPatch(entry) {
  const strategy = entry.strategy, position = entry.position
  enumValue(strategy.type, ['constant', 'selective', 'vectorized'], '激活策略')
  const probability = finite(entry.probability, '概率')
  if (probability > 100) throw new Error('世界书概率不能超过 100')
  const extra = clone(entry.extra || {})
  delete extra.dsh_tavern_ref
  const legacy = { displayIndex: extra.displayIndex ?? 0, caseSensitive: extra.caseSensitive ?? null, matchWholeWords: extra.matchWholeWords ?? null, group: str(extra.group) }
  for (const key of Object.keys(legacy)) delete extra[key]
  return {
    ...legacy,
    comment: str(entry.name), content: str(entry.content), enabled: entry.enabled === true,
    constant: strategy.type === 'constant', selective: strategy.type === 'selective', vectorized: strategy.type === 'vectorized',
    primaryKeys: keys(strategy.keys), secondaryKeys: keys(strategy.keys_secondary.keys),
    selectiveLogic: enumValue(strategy.keys_secondary.logic, LOGIC, '关键词逻辑'),
    scanDepth: strategy.scan_depth === 'same_as_global' ? null : finite(strategy.scan_depth, '扫描深度'),
    position: enumValue(position.type, POSITIONS, '插入位置'), role: enumValue(position.role, ROLE, '消息角色'),
    depth: finite(position.depth, '插入深度'), order: finite(position.order, '插入顺序', false, -Infinity),
    probability, probabilityEnabled: true,
    excludeRecursion: entry.recursion.prevent_incoming === true,
    preventRecursion: entry.recursion.prevent_outgoing === true,
    delayUntilRecursion: finite(entry.recursion.delay_until, '递归延迟', true),
    sticky: finite(entry.effect.sticky, '黏性', true), cooldown: finite(entry.effect.cooldown, '冷却', true), delay: finite(entry.effect.delay, '延迟', true),
    helperExtra: extra
  }
}

/** Replace by stable uid, preserving untouched raw fields and resolving embedded refs before deletion. */
export function replaceTavernHelperWorldbookOperations(view, requested) {
  if (!Array.isArray(requested)) throw new Error('世界书条目必须是数组')
  const source = projectTavernHelperWorldbook(view).entries
  const byUid = new Map(source.map(entry => [String(entry.uid), entry]))
  if (byUid.size !== source.length) throw new Error('世界书条目编号重复')
  const seen = new Set()
  const used = new Set(source.map(entry => Number(entry.uid)))
  for (const entry of requested) if (entry && entry.uid !== undefined) used.add(Number(entry.uid))
  let nextUid = Math.max(-1, ...Array.from(used).filter(Number.isSafeInteger)) + 1
  const operations = []
  for (const value of requested) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('世界书条目必须是对象')
    const uid = value.uid === undefined ? nextUid++ : value.uid
    if (!Number.isSafeInteger(uid) || uid < 0 || seen.has(String(uid))) throw new Error('世界书条目编号无效或重复')
    seen.add(String(uid))
    const before = byUid.get(String(uid))
    const defaults = projectEntry({ comment: '', order: 100, position: 0, depth: 4 })
    const after = mergedEntry(before || defaults, value)
    const full = entryPatch(after)
    if (!before) {
      operations.push({ op: 'add', uid, entry: full })
      continue
    }
    const previous = entryPatch(before), patch = {}
    for (const key of Object.keys(full)) if (JSON.stringify(full[key]) !== JSON.stringify(previous[key])) patch[key] = full[key]
    // A changed numeric probability must also enable probability checks in the source document.
    if (before.strategy.type !== after.strategy.type) Object.assign(patch, { constant: full.constant, selective: full.selective, vectorized: full.vectorized })
    if (Object.hasOwn(patch, 'probability')) patch.probabilityEnabled = true
    if (Object.keys(patch).length) operations.push({ op: 'update', ref: before.extra.dsh_tavern_ref, patch })
  }
  for (const entry of source) if (!seen.has(String(entry.uid))) operations.push({ op: 'delete', ref: entry.extra.dsh_tavern_ref })
  return operations
}
