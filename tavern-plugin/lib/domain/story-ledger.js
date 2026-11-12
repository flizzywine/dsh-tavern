/** Generic ledger fields and selection rules informed by ST-BaiBai-Book.
 * Reference: docs/research/baibai-book-ledger-2026-09-09.md.
 * Persistence and rollback belong to Tavern's Story Timeline, not ST message extras.
 */
const fields = {
  items: { name: 'string', desc: 'string', qty: 'number', carried: 'boolean', location: 'string' },
  npcs: { name: 'string', gender: 'string', age: 'string', title: 'string', relation: 'string', ties: 'string', desc: 'string', personality: 'string', outfit: 'string', condition: 'string', important: 'boolean', follow: 'boolean', location: 'string' },
  scenes: { path: 'path', desc: 'string' }
}
const key = value => value.trim().toLowerCase()
const sceneKey = value => JSON.stringify(value.map(key))
const samePath = (a, b) => sceneKey(a) === sceneKey(b)
const within = (path, parent) => path.length >= parent.length && samePath(path.slice(0, parent.length), parent)
const copy = value => structuredClone(value)
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function text(value) {
  if (typeof value !== 'string' || value.length > 2000) throw new Error('台账文字须为不超过 2000 字符的文本')
  return value.trim()
}
function path(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) throw new Error('地点 path 须为 1 至 12 层地名数组')
  return value.map(part => { const name = text(part); if (!name || name.includes('/')) throw new Error('地名不能为空或包含 /'); return name })
}
function row(value, kind) {
  if (!object(value)) throw new Error('台账条目须为对象')
  const result = {}
  for (const [field, val] of Object.entries(value)) {
    const type = fields[kind][field]
    if (!type) throw new Error('未知台账字段：' + field)
    if (type === 'string') result[field] = text(val)
    else if (type === 'path') result[field] = path(val)
    else if (typeof val !== type || (type === 'number' && (!Number.isFinite(val) || val < 0))) throw new Error('台账字段类型或数值无效：' + field)
    else result[field] = val
  }
  if (kind === 'scenes' ? !result.path : !result.name) throw new Error('台账缺少名称或路径')
  return result
}
function array(value) {
  if (!Array.isArray(value) || value.length > 80) throw new Error('每组台账操作须为数组，最多 80 条')
  return value
}
export function emptyLedger() { return { version: 1, location: '', locationPath: [], items: [], npcs: [], scenes: [], itemLog: [], updatedTurn: null } }
export function readLedger(value) { return object(value) && value.version === 1 ? copy(value) : emptyLedger() }

function rowSchema(kind) {
  const properties = Object.fromEntries(Object.entries(fields[kind]).map(([name, type]) => [name, type === 'path' ? { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 } : { type, ...(type === 'number' ? { minimum: 0 } : {}) }]))
  return { type: 'object', additionalProperties: false, properties, required: [kind === 'scenes' ? 'path' : 'name'] }
}
const groups = Object.fromEntries(Object.keys(fields).map(kind => [kind, {
  type: 'object', additionalProperties: false,
  properties: {
    add: { type: 'array', items: rowSchema(kind), maxItems: 80 },
    update: { type: 'array', items: rowSchema(kind), maxItems: 80 },
    remove: { type: 'array', items: kind === 'scenes' ? { type: 'array', items: { type: 'string' }, minItems: 1 } : { type: 'string' }, maxItems: 80 },
    ...(kind === 'scenes' ? { reparent: { type: 'array', maxItems: 80, items: { type: 'object', additionalProperties: false, properties: { node: { type: 'array', items: { type: 'string' } }, newPath: { type: 'array', items: { type: 'string' } } }, required: ['node', 'newPath'] } } } : {})
  }
}]))
export const LEDGER_SUBMIT_TOOL = Object.freeze({
  name: 'ledger_submit',
  description: '提交本批正文确认的物品、角色和地点更新。只输出涉及的条目；出场人物的性格和关系按当前事实核对重写，无变化也须提交 {}。物品 add.qty 为新增数量，update.qty 为变更后的总数。只记账，不改变剧情或人物卡变量。',
  parameters: { type: 'object', additionalProperties: false, properties: { location: { type: 'string' }, locationPath: { type: 'array', items: { type: 'string' }, minItems: 1 }, ...groups } }
})
export const LEDGER_RULES = `【台账维护】
在当前后台 Agent 内维护物品、角色、地点三类台账，调用 ledger_submit 提交。只整理最新正文确认发生的事实；玩家的打算、候选项和隐藏思考不算事实。无变化提交 {}。先完成台账，再提交姿势或变量；不要创建其他 Agent。
当前台账是已经结算的状态。物品数量、移动等事实只提交本批新变化，不重复记账；人物的性格和关系按下述规则核对当前状态。只输出本批剧情涉及的条目，未提及的旧条目保留，不要为了保持完整而重抄全表。add/update/remove 均复用已有名称，地点复用完整 path；同一实体的别称不要另建条目。
物品：只收录主动获得并保留、有剧情用途或情感意义的东西。普通环境摆设、日常食品和当前穿着不进入物品清单。新增数量用 add.qty，部分消耗用 update.qty 写剩余总数，用尽用 remove；不要凭空补充。默认 carried=true；明确寄存才 carried=false 并给 location。取回或转移时更新相应字段。
角色：只登记有重要互动或反复提及的关键人物，不登记一次性服务人员和路人，也不将玩家本人写入 npcs。title 是身份。对本批实际出场的人，结合已有事实与本批经历，按“现在”核对并重写 personality、relation、ties，不要只追加一句变化而留下过时结论；事实未变可保留，不得为凑字数编造。
personality 通常 60–120 字：稳定底色、能作证的行为、已知的软肋或雷区，不能仅写三五个形容词；证据不足时如实简写，不推测未知心理。relation 写与玩家当前的关系、信任或戒备、情感与边界；有质变时写明第几轮、什么事件使其改变，既不能因一次友善推断相爱，也不能在多轮明确相爱后仍沿用早期欠情。ties 按对象逐一写与其他人物的关系、态度和变化依据；有已知关系就记，无证据时可空，不凭空补亲友或强行双向对称。
外貌 desc、性格 personality 与当前 outfit、condition 分开。首次登记时，正文有衣着依据就写 outfit，后续有变化再更新。核心主演 important=true；同行 follow=true，否则记录 location。暂时离场不删除。
地点：记录有名字、实际到达、具有具体描述的地方，path 从大到小，不凭空扩充地图；add 时给出 desc。更新描述保留旧要点。层级变化用 reparent 的 node（原路径）和 newPath（新路径），子地点一起迁移。location 为当前位置，locationPath 指向已记录地点；没有合适地点时只更新 location。
描述压缩：items.desc 尽量不超过 25 字，scenes.desc 尽量不超过 60 字，只写辨识特征、用途或环境状态，不写剧情流水账；必要的关键信息优先保留。只在本批涉及该条目时整理，不为压缩而重写无关旧账。
不要求重写完整台账，不编造数值、关系或人物离场后的变化。MVU 变量与人物设计档案各自继续原任务，不从台账直接改它们。`
export function ledgerContext(value) { return '【当前台账（已结算）】\n' + JSON.stringify(readLedger(value)) }

const MAX_INJECTED_LEDGER = 12000
function frameLedgerText(ledger) {
  const full = JSON.stringify(ledger)
  if (full.length <= MAX_INJECTED_LEDGER) return full
  // Keep complete JSON and complete rows. Character detail must not disappear
  // simply because a large item inventory happens to serialize before npcs.
  const kinds = ['npcs', 'items', 'scenes']
  const compact = { location: ledger.location, locationPath: ledger.locationPath,
    npcs: [], items: [], scenes: [], omitted: Object.fromEntries(kinds.map(kind => [kind, ledger[kind].length])) }
  if (JSON.stringify(compact).length > MAX_INJECTED_LEDGER) {
    compact.locationPath = []
    compact.omittedLocationPath = true
  }
  const rank = (a, b) => (Number(b.updatedTurn) || 0) - (Number(a.updatedTurn) || 0) || Number(Boolean(b.important)) - Number(Boolean(a.important))
  const sorted = Object.fromEntries(kinds.map(kind => [kind, [...ledger[kind]].sort(rank)]))
  const take = (kind, row) => {
    compact[kind].push(row)
    compact.omitted[kind]--
    if (JSON.stringify(compact).length > MAX_INJECTED_LEDGER) { compact[kind].pop(); compact.omitted[kind]++ }
  }
  // Give all three categories a chance before filling the rest by recency.
  for (const kind of kinds) if (sorted[kind].length) take(kind, sorted[kind][0])
  const remaining = kinds.flatMap(kind => sorted[kind].slice(1).map(row => ({ kind, row }))).sort((a, b) => rank(a.row, b.row))
  for (const { kind, row } of remaining) take(kind, row)
  return JSON.stringify(compact)
}
/** The one-time foreground input after a manual consolidation; [] when nothing is pending. */
export function ledgerFrameInputs(chat) {
  if (!object(chat?.ledgerInjection)) return []
  const { consolidatedTurn, version, updatedTurn, ...ledger } = readLedger(chat.ledger)
  if (!ledger.location && !['items', 'npcs', 'scenes'].some(kind => ledger[kind]?.length)) return []
  const text = frameLedgerText(ledger)
  return [{ kind: 'foreground.current-state', required: false, source: { stage: 'ledger', through: chat.ledgerInjection.through },
    text: '【游玩台账 · 整理至第 ' + chat.ledgerInjection.through + ' 轮（只在这一轮提供，用来核对物品、人物与地点；与正文冲突时以正文为准；omitted 如有值表示因篇幅省略的条目数，不代表删除）】\n' + text }]
}

/** Pure, atomic delta projection. A failed call leaves the authoritative ledger untouched. */
export function applyLedgerDelta(current, delta, turn) {
  if (!object(delta)) throw new Error('ledger_submit 参数须为对象')
  for (const name of Object.keys(delta)) if (!['location', 'locationPath', ...Object.keys(fields)].includes(name)) throw new Error('未知台账分类：' + name)
  const next = readLedger(current)
  if (Object.hasOwn(delta, 'location')) {
    next.location = text(delta.location)
    if (!Object.hasOwn(delta, 'locationPath')) next.locationPath = []
  }
  if (Object.hasOwn(delta, 'locationPath')) next.locationPath = path(delta.locationPath)
  for (const kind of Object.keys(fields)) {
    if (!Object.hasOwn(delta, kind)) continue
    const ops = delta[kind]
    if (!object(ops)) throw new Error('台账分类须为操作对象')
    for (const name of Object.keys(ops)) if (!['add', 'update', 'remove', ...(kind === 'scenes' ? ['reparent'] : [])].includes(name)) throw new Error('未知台账操作：' + name)
    const id = r => kind === 'scenes' ? sceneKey(r.path) : key(r.name)
    for (const action of ['add', 'update']) {
      for (const raw of array(ops[action] || [])) {
        const patch = row(raw, kind)
        let existing = next[kind].find(r => id(r) === id(patch))
        if (!existing && action === 'update') throw new Error('不能更新尚未登记的条目：' + (patch.name || patch.path.join(' / ')))
        if (kind === 'scenes' && !existing && !patch.desc) throw new Error('新地点须有具体描述')
        const before = existing?.qty
        if (!existing) { existing = kind === 'scenes' ? {} : { name: patch.name }; next[kind].push(existing) }
        const quantity = kind === 'items' && action === 'add' && typeof patch.qty === 'number' ? (before || 0) + patch.qty : patch.qty
        Object.assign(existing, patch, { updatedTurn: turn })
        if (quantity !== undefined) existing.qty = quantity
        if (kind === 'items') {
          next.itemLog.push({ name: existing.name, kind: action, from: before, to: existing.qty, turn })
          if (existing.qty === 0) next.items = next.items.filter(r => r !== existing)
        }
      }
    }
    if (kind === 'scenes') {
      for (const move of array(ops.reparent || [])) {
        if (!object(move) || Object.keys(move).some(k => !['node', 'newPath'].includes(k))) throw new Error('地点迁移参数无效')
        const from = path(move.node), to = path(move.newPath)
        if (!next.scenes.some(r => samePath(r.path, from))) throw new Error('原地点不存在')
        if (samePath(from, to)) continue
        if (within(to, from)) throw new Error('不能把地点移到自身下方')
        const moving = next.scenes.filter(r => within(r.path, from))
        const moved = moving.map(r => ({ ...r, path: [...to, ...r.path.slice(from.length)], updatedTurn: turn }))
        if (moved.some(r => next.scenes.some(other => !moving.includes(other) && samePath(other.path, r.path)))) throw new Error('目标地点已存在，不能覆盖')
        next.scenes = next.scenes.filter(r => !moving.includes(r)).concat(moved)
        if (within(next.locationPath, from)) next.locationPath = [...to, ...next.locationPath.slice(from.length)]
      }
    }
    for (const raw of array(ops.remove || [])) {
      const target = kind === 'scenes' ? path(raw) : text(raw)
      const removed = next[kind].filter(r => kind === 'scenes' ? within(r.path, target) : key(r.name) === key(target))
      if (kind === 'items') for (const r of removed) next.itemLog.push({ name: r.name, kind: 'remove', from: r.qty, to: 0, turn })
      next[kind] = next[kind].filter(r => !removed.includes(r))
      if (kind === 'scenes' && within(next.locationPath, target)) next.locationPath = []
    }
    if (next[kind].length > 500) throw new Error('单类台账最多 500 条，请整理后重试')
  }
  if (next.locationPath.length && !next.scenes.some(r => samePath(r.path, next.locationPath))) throw new Error('locationPath 须指向已登记地点')
  next.itemLog = next.itemLog.slice(-8)
  next.updatedTurn = turn
  return next
}

/** One submission per model task. Retrying the accepted call cannot double-add quantities. */
export function createLedgerSubmission({ enabled, current, turn }) {
  let result = null
  return {
    get result() { return result },
    get complete() { return !enabled || result !== null },
    execute(call) {
      if (!enabled) return JSON.stringify({ ok: false, error: '台账维护已关闭' })
      if (result !== null) return JSON.stringify({ ok: true, alreadySubmitted: true })
      try { result = applyLedgerDelta(current, call.arguments, turn); return JSON.stringify({ ok: true }) }
      catch (error) { return JSON.stringify({ ok: false, retryable: true, error: error.message }) }
    }
  }
}
