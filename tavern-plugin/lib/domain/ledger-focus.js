import { ledgerContext, readLedger } from './story-ledger.js'

const normalize = value => String(value || '').trim().toLowerCase()
const identity = (kind, row) => kind === 'scenes' ? JSON.stringify(row.path.map(normalize)) : normalize(row.name)
const kinds = ['npcs', 'scenes', 'items']

// Only explicit names/aliases count as hits. Pronouns cannot identify an entity.
function names(kind, row, aliases) {
  const name = kind === 'scenes' ? row.path.at(-1) : row.name
  const parts = String(name).split(/[（()）]/).map(normalize).filter(Boolean)
  const extra = aliases[kind]?.[kind === 'scenes' ? row.path.join(' / ') : row.name] || []
  return [...parts, ...(Array.isArray(extra) ? extra : [])].map(normalize).filter(value => value && !['他', '她', '它', '他们', '她们', '它们'].includes(value))
}

/** Pure selection: direct hits, recent fallback, then exactly one relationship hop. */
export function pickLedgerEntities(value, story, { aliases = {}, include = {} } = {}) {
  const ledger = readLedger(value)
  const source = normalize(story)
  const selected = Object.fromEntries(kinds.map(kind => [kind, new Set()]))
  for (const kind of kinds) for (const row of ledger[kind]) {
    if (include[kind]?.includes(identity(kind, row)) || names(kind, row, aliases).some(name => source.includes(name))) selected[kind].add(identity(kind, row))
  }
  const fallback = kinds.every(kind => !selected[kind].size)
  if (fallback) {
    const turns = [...new Set(kinds.flatMap(kind => ledger[kind].map(row => row.updatedTurn)).filter(Number.isFinite))].sort((a, b) => b - a).slice(0, 3)
    for (const kind of kinds) for (const row of ledger[kind]) {
      if (turns.includes(row.updatedTurn)) selected[kind].add(identity(kind, row))
    }
  }
  const direct = ledger.npcs.filter(row => selected.npcs.has(identity('npcs', row)))
  // Match both directions: a related character may be the only row recording the tie.
  const related = ledger.npcs.filter(row => !selected.npcs.has(identity('npcs', row)) && direct.some(hit =>
    names('npcs', row, aliases).some(name => normalize(hit.ties).includes(name)) ||
    names('npcs', hit, aliases).some(name => normalize(row.ties).includes(name))))
  const subset = { ...ledger, itemLog: [], ...Object.fromEntries(kinds.map(kind => [kind, ledger[kind].filter(row => selected[kind].has(identity(kind, row)))])) }
  subset.npcs.push(...related.map(({ name, relation, ties }) => ({ name, relation, ties })))
  return { ledger: subset, related: related.map(row => row.name), fallback,
    primary: Object.fromEntries(kinds.map(kind => [kind, [...selected[kind]]])) }
}

export const LEDGER_LOOKUP_TOOL = Object.freeze({
  name: 'ledger_lookup',
  description: '只读查询本批正文实际涉及但详情未提供的已有条目，用于别称、代词或地点层级调整漏选时补取详情。必须给出正文原文依据，不能仅为扩展人际关系而查询未出场的人。人物/物品用索引中的原名，地点用完整路径，以 / 分隔。查询成功后这些条目可正常提交更新；查询本身不修改台账。',
  parameters: { type: 'object', additionalProperties: false,
    properties: { kind: { type: 'string', enum: kinds }, names: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 }, evidence: { type: 'string', minLength: 2, maxLength: 1000 } },
    required: ['kind', 'names', 'evidence'] }
})

/** Expand only explicit lookup targets; relations still extend exactly one hop. */
export function lookupLedgerEntities(current, focus, args, story, evidenceText = story) {
  if (!args || !kinds.includes(args.kind) || !Array.isArray(args.names) || !args.names.length || args.names.length > 20 || args.names.some(name => typeof name !== 'string' || !name.trim())) throw new Error('查询须提供有效分类和 1–20 个已登记名称')
  if (typeof args.evidence !== 'string' || args.evidence.trim().length < 2 || args.evidence.length > 1000 || !evidenceText.includes(args.evidence)) throw new Error('查询依据须逐字引用本批正文；不能使用玩家打算或账外推测')
  const ledger = readLedger(current), kind = args.kind
  const requested = args.names.map(name => {
    const matches = ledger[kind].filter(row => kind === 'scenes'
      ? row.path.map(normalize).join('/') === name.split('/').map(normalize).join('/')
      : normalize(row.name) === normalize(name))
    if (matches.length !== 1) throw new Error('未找到唯一的已登记条目，请复用名称索引中的原名或完整地点路径：' + name)
    return identity(kind, matches[0])
  })
  const include = { ...focus.primary, [kind]: [...new Set([...focus.primary[kind], ...requested])] }
  return pickLedgerEntities(ledger, story, { include })
}

export function focusedLedgerContext(current, focus) {
  const ledger = readLedger(current)
  const index = Object.fromEntries(kinds.map(kind => [kind, ledger[kind].map(row => kind === 'scenes' ? row.path : row.name)]))
  return ledgerContext(focus.ledger) + '\n\n【更新范围】\n' + JSON.stringify({ relationOnly: focus.related, recentFallback: focus.fallback }) +
    '\nrelationOnly 中的人仅为一跳关系参考，只允许 update.ties / update.relation，禁止新增、删除或修改其状态、位置等其他字段。其余已登记条目仅可更新本次提供的条目；未涉及的旧条目保持原样。若正文通过别称、代词涉及索引中的旧条目但详情缺失，先用 ledger_lookup 引用正文依据补取，不能另建同义条目。recentFallback 表示未命中名称，所给近期条目仅供消解指代，仍须有剧情依据才更新。\n' +
    '【已登记名称索引（仅用于复用名称，不能据此推断出场）】\n' + JSON.stringify(index) +
    '\n【新增实体检查】\n逐一检查待整理剧情中新出现的关键人物、具名地点和有意义物品：索引中没有的用 add；别称复用已有名称。不要只顾旧条目而漏掉新增实体。'
}

/** Validate before projection so a bad submission is retryable and never partially saved. */
export function assertLedgerFocus(current, focus, delta) {
  const ledger = readLedger(current)
  if (!delta || typeof delta !== 'object') return // The schema validator reports malformed deltas.
  const related = new Set(focus.related.map(normalize))
  for (const kind of kinds) {
    const ops = delta[kind]
    if (!ops || typeof ops !== 'object') continue
    for (const action of ['add', 'update', 'remove']) {
      if (!Array.isArray(ops[action])) continue
      for (const patch of ops[action]) {
        if (!patch || (kind === 'scenes' && !Array.isArray(action === 'remove' ? patch : patch.path))) continue
        const id = identity(kind, action === 'remove' ? (kind === 'scenes' ? { path: patch } : { name: patch }) : patch)
        if (kind === 'npcs' && related.has(id)) {
          if (action !== 'update' || Object.keys(patch).some(field => !['name', 'ties', 'relation'].includes(field))) throw new Error('一跳关联人物只允许更新 ties/relation：' + patch.name)
        } else if (ledger[kind].some(row => identity(kind, row) === id) && !focus.ledger[kind].some(row => identity(kind, row) === id)) {
          throw new Error('不能修改本批剧情范围外的台账条目：' + id)
        }
      }
    }
    // Removing/reparenting a scene also affects descendants; protect unseen rows.
    const roots = [...(Array.isArray(ops.remove) ? ops.remove : []), ...(Array.isArray(ops.reparent) ? ops.reparent.map(move => move?.node) : [])]
    if (kind === 'scenes') for (const root of roots) {
      if (!Array.isArray(root)) continue
      for (const row of ledger.scenes) if (root.length <= row.path.length && root.every((part, i) => normalize(part) === normalize(row.path[i])) && !focus.ledger.scenes.some(selected => identity(kind, selected) === identity(kind, row))) {
        throw new Error('地点操作会影响本批范围外的子地点，请仅更新本批涉及的地点')
      }
    }
  }
}
