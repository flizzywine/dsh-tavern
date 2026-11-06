// only pinned, committed MVU projections may supply item facts.
export const normalizeItemName = value => String(value).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
const text = value => typeof value === 'string' && normalizeItemName(value).length > 0
const count = value => Number.isSafeInteger(value) && value >= 0
const refusal = (code, retryable = false, candidates) => ({ok:false, error:{code, message:code, retryable, ...(candidates?.length ? {candidates:candidates.slice(0,3).map(item => item.name)} : {})}})
export const itemBindingRefusal = refusal

/** resolved is the existing variable registry's resolved inventory slot. */
export function projectItems(pinned, resolved, {scopeKey, fixedOwner = null, ownerMapped = false, counted = true} = {}) {
  const base = {revision:pinned?.revision ?? null, previousRevision:pinned?.previousRevision ?? null, mappingKey:pinned?.mappingKey ?? null,
    scopeKey:scopeKey ?? null, ownerMapped:ownerMapped || fixedOwner !== null, complete:false, items:[]}
  if (!pinned?.committed || !pinned.complete || pinned.revision == null || !text(pinned.mappingKey) || !text(scopeKey)
    || !resolved || resolved.status !== 'ready' || resolved.source === 'default'
    || resolved.variable && resolved.variable.source !== 'mvu' || !Array.isArray(resolved.value)) {
    return {...base, reason:'INVENTORY_UNAVAILABLE'}
  }
  const items = [], keys = new Set()
  for (const row of resolved.value) {
    if (!row || !text(row.name) || row.id !== undefined && !text(row.id)) return {...base, reason:'INVALID_INVENTORY'}
    const ownerKey = fixedOwner ?? (ownerMapped ? row.owner : null)
    if (base.ownerMapped && !text(ownerKey)) return {...base, reason:'HOLDER_UNRESOLVED'}
    if (fixedOwner !== null && row.owner !== undefined && row.owner !== fixedOwner) return {...base, reason:'HOLDER_UNRESOLVED'}
    const stableId = row.id ?? null
    const itemKey = JSON.stringify([scopeKey,ownerKey,stableId === null ? ['name',normalizeItemName(row.name)] : ['id',stableId]])
    if (keys.has(itemKey)) return {...base, reason:'AMBIGUOUS_ITEM'}
    keys.add(itemKey)
    items.push({itemKey, ownerKey, stableId, name:row.name, count:counted && count(row.count) ? row.count : null,
      counted, category:typeof row.category === 'string' ? row.category : null})
  }
  return {...base, complete:true, items}
}

export function diffItems(before, after) {
  if (!before?.complete || !after?.complete || before.revision == null || after.revision == null
    || before.revision === after.revision || after.previousRevision !== before.revision
    || before.mappingKey !== after.mappingKey || before.scopeKey !== after.scopeKey || before.ownerMapped !== after.ownerMapped) {
    return refusal('INVENTORY_UNAVAILABLE')
  }
  const old = new Map(before.items.map(item => [item.itemKey,item]))
  const next = new Map(after.items.map(item => [item.itemKey,item]))
  // Without stable IDs, a delete+insert in the same holder could be a rename.
  const renamedOwners = new Set(before.items.filter(item => item.stableId === null && !next.has(item.itemKey))
    .filter(item => after.items.some(other => other.stableId === null && other.ownerKey === item.ownerKey && !old.has(other.itemKey)))
    .map(item => item.ownerKey))
  const changes = []
  for (const key of new Set([...old.keys(),...next.keys()])) {
    const a = old.get(key), b = next.get(key), item = b || a
    if (item.stableId === null && renamedOwners.has(item.ownerKey) && (!a || !b)) continue
    if (a && b && a.counted !== b.counted) return refusal('INVENTORY_UNAVAILABLE')
    if (item.counted) {
      if (a && a.count === null || b && b.count === null) continue
      const delta = (b?.count ?? 0) - (a?.count ?? 0)
      if (!delta) continue
      changes.push({...structuredClone(delta > 0 ? b : a), action:delta > 0 ? 'gain' : 'lose', delta:Math.abs(delta), remaining:b?.count ?? 0})
    } else if (!a || !b) changes.push({...structuredClone(item), action:b ? 'gain' : 'lose', delta:null, remaining:null})
  }
  return {ok:true, beforeRevision:before.revision, afterRevision:after.revision, mappingKey:after.mappingKey,
    scopeKey:after.scopeKey, ownerMapped:after.ownerMapped, changes}
}

function scoped(items, inventory, scope) {
  if (inventory.scopeKey !== scope?.scopeKey) return refusal('HOLDER_UNRESOLVED')
  if (inventory.ownerMapped && !text(scope.ownerKey)) return refusal('HOLDER_UNRESOLVED')
  return {ok:true, items:items.filter(item => !inventory.ownerMapped || item.ownerKey === scope.ownerKey)}
}
function choose(name, items, single, missing) {
  const normalized = normalizeItemName(name)
  const exact = items.filter(item => normalizeItemName(item.name) === normalized)
  if (exact.length > 1) return refusal('AMBIGUOUS_ITEM',true,exact)
  if (exact.length === 1) return {ok:true,item:exact[0],strategy:'S2-exact'}
  const partial = items.filter(item => {
    const other = normalizeItemName(item.name)
    return normalized.includes(other) || other.includes(normalized)
  })
  if (partial.length > 1) return refusal('AMBIGUOUS_ITEM',true,partial)
  if (partial.length === 1) return {ok:true,item:partial[0],strategy:'S2-substring'}
  if (single && items.length === 1) return {ok:true,item:items[0],strategy:'S3-single'}
  return refusal(single && items.length > 1 ? 'AMBIGUOUS_ITEM' : missing,true,items)
}
export function bindChange(intent, diff, scope) {
  if (!['gain','lose'].includes(intent?.action) || !text(intent.name)) return refusal('INVALID_OP',true)
  if (!diff?.ok) return diff || refusal('INVENTORY_UNAVAILABLE')
  const candidates = scoped(diff.changes.filter(item => item.action === intent.action),diff,scope)
  if (!candidates.ok) return candidates
  const bound = choose(intent.name,candidates.items,true,'NO_CHANGE_MATCH')
  if (!bound.ok) return bound
  return {...structuredClone(bound), beforeRevision:diff.beforeRevision, afterRevision:diff.afterRevision, mappingKey:diff.mappingKey}
}
export function bindShow(intent, inventory, scope) {
  if (intent?.action !== 'show' || !text(intent.name)) return refusal('INVALID_OP',true)
  if (!inventory?.complete) return refusal('INVENTORY_UNAVAILABLE')
  const candidates = scoped(inventory.items.filter(item => !item.counted || item.count > 0),inventory,scope)
  if (!candidates.ok) return candidates
  const bound = choose(intent.name,candidates.items,false,'ITEM_NOT_FOUND')
  if (!bound.ok) return bound
  return {...structuredClone(bound), revision:inventory.revision, mappingKey:inventory.mappingKey}
}

// reply.at is the current compact director's canonical, 1-based paragraph ID.
export const itemPlaySchema = {
  type:'object', properties:{op:{const:'item.play'}, action:{enum:['gain','lose','show']},
    name:{type:'string',minLength:1}, at:{type:'integer',minimum:1}},
  required:['op','action','name','at'], additionalProperties:false,
}
export function validateItemPlay(op, anchors) {
  if (!op || Array.isArray(op) || Object.keys(op).length !== 4 || !Object.keys(op).every(key => ['op','action','name','at'].includes(key))
    || op.op !== 'item.play' || !['gain','lose','show'].includes(op.action) || !text(op.name)
    || Buffer.byteLength(op.name) > 192 || Buffer.byteLength(JSON.stringify(op)) > 512) return refusal('INVALID_OP',true)
  if (!Number.isSafeInteger(op.at) || op.at < 1 || !anchors.includes(op.at)) return refusal('INVALID_ANCHOR',true)
  return {ok:true}
}

export function itemInventoryPrompt(inventory, scope, {enabled = false, s4 = false} = {}) {
  if (!enabled || !s4 || !inventory?.complete) return ''
  const candidates = scoped(inventory.items.filter(item => !item.counted || item.count > 0),inventory,scope)
  if (!candidates.ok) return ''
  const names = [], seen = new Set()
  for (const item of candidates.items) {
    const normalized = normalizeItemName(item.name)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    if (names.length === 12) break
    if (Buffer.byteLength(JSON.stringify({inventory:[...names,item.name]})) > 1024) continue
    names.push(item.name)
  }
  return names.length ? JSON.stringify({inventory:names}) : ''
}
