// 更新人物卡 (card-files.js replaceCard): the player's own changes to a card carried onto its new version.
// base is the raw of the card file the card was last imported or updated from, local the card's working raw now,
// incoming the new file's raw. Whatever differs between local and base is the player's (DSH settings, stage
// adaptation, disabled scripts, edited entries, added greetings…); everything else follows the new file.
//
// - A value the player left as it was takes the new file's; one the author left as it was keeps the player's.
// - Both changed it: objects are compared key by key, lists item by item (below); anything else keeps the player's.
// - Lists of objects that each carry a unique `id` (world book entries, regex scripts, helper scripts) are matched
//   by id: what the player removed stays out, what they added stays (an added number id another new item took gets
//   the next free number), the rest is merged item by item in the new file's order. Lists of plain values (tags,
//   bound pack ids) merge as sets the same way.
// - Greetings are used by position (an opening scene names alternate:N), so they merge greeting by greeting: each
//   position as one value, then the greetings the player appended, then the ones the author appended.
// - A block under `extensions` the new file does not have at all says nothing about it: a tool that wrote the file
//   (SillyTavern, a card's update script) keeps only the blocks it knows, so the card's own block stays.
// Without a base (no original file: a card copied in, made here, or whose original is gone) nothing can be told apart
// as the player's, so the update takes the new file, keeping only the extension blocks it does not have. Counting every
// value as the player's instead made such an update report success and change nothing.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const plain = value => value === null || ['string', 'number', 'boolean'].includes(typeof value)

function equal(a, b) {
  if (a === b) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, index) => equal(item, b[index]))
  if (!object(a) || !object(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]))
}

// The items of a list by id, or null when the list is not one of objects with unique plain ids.
function byId(list) {
  if (!Array.isArray(list)) return list === undefined ? new Map() : null
  const items = new Map()
  for (const item of list) {
    if (!object(item) || !plain(item.id) || item.id === null || items.has(item.id)) return null
    items.set(item.id, item)
  }
  return items
}

const POSITIONAL = new Set(['alternate_greetings', 'group_only_greetings'])

function mergePositions(base, local, incoming) {
  // without a base every position is compared as one the player set
  const had = Array.isArray(base) ? base : [], span = Array.isArray(base) ? base.length : Math.max(local.length, incoming.length), result = []
  for (let index = 0; index < span; index++) {
    const value = merge(had[index], local[index], incoming[index])
    if (value !== undefined) result.push(value)
  }
  return [...result, ...local.slice(span), ...incoming.slice(span)]
}

function mergeLists(base, local, incoming) {
  const b = byId(base), l = byId(local), i = byId(incoming)
  if (b && l && i) {
    const result = [], taken = new Set()
    for (const [id, item] of i) {
      if (b.has(id) && !l.has(id)) continue
      // the same new number id on both sides is two items (the player's is renumbered below)
      result.push(!b.has(id) && typeof id === 'number' ? item : merge(b.get(id), l.get(id), item)); taken.add(id)
    }
    let free = Math.max(-1, ...[...taken, ...l.keys()].filter(id => typeof id === 'number')) + 1
    for (const [id, item] of l) {
      if (taken.has(id) && b.has(id)) continue
      if (b.has(id) && equal(item, b.get(id))) continue
      if (!taken.has(id)) { result.push(item); continue }
      // a number id the player and the author each gave a new item: both stay, the player's under a new number
      if (typeof id === 'number' && !equal(item, i.get(id))) result.push({ ...item, id: free++ })
    }
    return result
  }
  if ([base ?? [], local, incoming].every(list => Array.isArray(list) && list.every(plain))) {
    const had = base ?? [], removed = had.filter(item => !local.includes(item)), added = local.filter(item => !had.includes(item))
    return [...incoming.filter(item => !removed.includes(item)), ...added.filter(item => !incoming.includes(item))]
  }
  return local
}

function merge(base, local, incoming) {
  if (equal(local, base)) return incoming
  if (equal(incoming, base)) return local
  if (object(local) && object(incoming)) {
    const b = object(base) ? base : {}, next = {}
    for (const key of new Set([...Object.keys(local), ...Object.keys(incoming)])) {
      const value = POSITIONAL.has(key) && Array.isArray(local[key]) && Array.isArray(incoming[key]) ? mergePositions(b[key], local[key], incoming[key])
        : merge(b[key], local[key], incoming[key])
      if (value !== undefined) next[key] = value
    }
    return next
  }
  if (Array.isArray(local) && Array.isArray(incoming)) return mergeLists(base, local, incoming)
  return local
}

const cardData = raw => object(raw.data) ? raw.data : raw

export function rebaseCardEdits({ base, local, incoming }) {
  // the extensions blocks the new file leaves out read as the card's own, unchanged
  const next = structuredClone(incoming), own = cardData(local).extensions
  if (object(own)) {
    const data = cardData(next), extensions = object(data.extensions) ? data.extensions : (data.extensions = {})
    for (const [key, value] of Object.entries(own)) if (!Object.hasOwn(extensions, key)) extensions[key] = structuredClone(value)
  }
  return structuredClone(base === undefined ? next : merge(base, local, next))
}
