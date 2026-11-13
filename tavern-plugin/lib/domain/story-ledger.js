import { promptSection } from './prompt-section.js'

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
export const LEDGER_RULES = `## Ledger upkeep
In this background agent, keep the items, characters and places ledgers and submit with ledger_submit. Record only facts the latest story text confirms; the player's plans, choices and hidden reasoning are not facts. Write entries in the story's language. Submit {} if nothing changed. Work within this agent.
The current ledger is settled. Submit only this batch's new item quantities and movements; review the current personality and relationships of characters appearing in this batch. Unmentioned old entries stay, so don't record them twice. add/update/remove reuse existing names and places reuse the full path; aliases of one thing share one entry.
- Items: only things deliberately obtained and kept, with story use or emotional meaning; ordinary surroundings, everyday food and worn clothes stay off. add.qty for new quantities, update.qty for the remaining total after partial use, remove when used up; add nothing unshown. carried=true by default; carried=false with location only when explicitly stored. Update fields on retrieval or transfer.
- Characters: only key characters with meaningful interaction or repeated mentions; no one-off staff or passers-by, and never the player in npcs. title is their role. For characters appearing in this batch, review and rewrite personality, relation and ties against established facts and this batch, rather than appending a change to an obsolete conclusion. Unchanged facts may stay; invent nothing to fill space. personality is usually 60-120 Chinese characters: stable traits, supporting behavior and known vulnerabilities or boundaries; keep it shorter when evidence is scarce, without guessing hidden feelings. relation records the current relationship, trust or caution, affection and boundaries with the player; cite the turn and event for a qualitative change. Neither infer love from one friendly moment nor preserve an early debt after explicit love over several turns. ties describes each known relationship with other characters, attitudes and evidence for changes; leave unknown relations empty and do not force symmetry. Keep appearance desc and personality apart from current outfit and condition. Record outfit on first entry when the story establishes it, then update changes. Main leads important=true; companions follow=true, otherwise record location. Temporary departures stay listed.
- Places: named places actually reached and concretely described; path runs largest to smallest, and the map grows only with the story. Give desc on add; updates keep old key points. Hierarchy changes use reparent with node (old path) and newPath (new path); child places move along. location is the current position; locationPath points to a recorded place; with no fitting place, update only location.
Keep items.desc within about 25 Chinese characters and scenes.desc within about 60 when possible: distinguishing features, uses or environmental state, not a plot log. Preserve essential information and compact only entries touched by this batch.
No full rewrite needed. Invent no numbers, relationships or post-departure changes. MVU variables and character design files keep their own tasks; the ledger never edits them.`
export function ledgerContext(value) { return promptSection('current_ledger', 'Current ledger (settled):\n' + JSON.stringify(readLedger(value))) }

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
    text: promptSection('story_ledger', 'Play ledger, updated through turn ' + chat.ledgerInjection.through + " (this turn only, for checking items, characters and places; the story text wins on conflict; omitted counts entries left out for space, not deleted):\n" + text) }]
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
