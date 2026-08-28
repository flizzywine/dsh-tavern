function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

const LOGIC = ['and_any', 'not_all', 'not_any', 'and_all']
const ROLE = ['system', 'user', 'assistant']

function strategyType(entry) {
  if (entry.vectorized === true) return 'vectorized'
  if (entry.constant === true || entry.selective !== true) return 'constant'
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
    name: str(entry.comment || entry.title),
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
      depth: Number(entry.depth) || 4,
      order: Number(entry.order) || 0
    },
    content: str(entry.content),
    probability: Number.isFinite(Number(entry.probability)) ? Number(entry.probability) : 100,
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
    extra: { dsh_tavern_ref: str(entry.ref) }
  }
}

export function projectTavernHelperWorldbook(view) {
  return {
    name: str(view && view.displayName),
    entries: (Array.isArray(view && view.entries) ? view.entries : []).map(projectEntry)
  }
}

export function replaceTavernHelperWorldbookOperations(view, requested) {
  const source = projectTavernHelperWorldbook(view).entries
  if (!Array.isArray(requested) || requested.length !== source.length) {
    throw new Error('当前兼容层不能新增或删除世界书条目')
  }
  const operations = []
  for (let index = 0; index < source.length; index += 1) {
    const before = source[index]
    const after = requested[index]
    if (!after || String(after.uid) !== String(before.uid)) throw new Error('世界书条目编号不匹配')
    const patch = {}
    if (str(after.name) !== before.name) patch.comment = str(after.name)
    if (str(after.content) !== before.content) patch.content = str(after.content)
    if (Boolean(after.enabled) !== before.enabled) patch.enabled = Boolean(after.enabled)
    if (Object.keys(patch).length > 0) operations.push({ op: 'update', ref: before.extra.dsh_tavern_ref, patch })
  }
  return operations
}
