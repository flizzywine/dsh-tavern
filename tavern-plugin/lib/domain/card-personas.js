import { cardPersonas as shippedPersonas } from '../prompt-catalog.js'

// 卡片工作台性格: one global library whose active entry is the card Agent's
// custom system text ('' = blank). Stored as
//   cardPersonas: { activeId, custom: [{ id, name, text }], builtins: { [id]: { name?, text?, deleted? } } }
// Built-ins keep only the user's edits, so untouched ones follow shipped updates
// and newly shipped ones appear on their own.

const NAME_LIMIT = 80
const TEXT_LIMIT = 100000

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function personaName(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name === '' || name.length > NAME_LIMIT) throw new Error('性格名称需为 1–80 字')
  return name
}

function personaText(value) {
  if (typeof value !== 'string') throw new Error('性格内容必须是文本')
  if (value.length > TEXT_LIMIT) throw new Error('性格内容不能超过 100000 字符')
  return value.trim()
}

function uniqueName(names, base) {
  if (!names.includes(base)) return base
  for (let index = 2; ; index += 1) if (!names.includes(base + ' (' + index + ')')) return base + ' (' + index + ')'
}

// Before the library existed the text lived in each prompt set's
// promptOverrides['card-system']; those become custom entries on first read.
function migrated(document) {
  const custom = []
  const add = (value, name) => {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text === '') return ''
    const existing = custom.find(item => item.text === text)
    if (existing) return existing.id
    const id = 'migrated-' + (custom.length + 1)
    custom.push({ id, name: uniqueName(custom.map(item => item.name), name), text })
    return id
  }
  const activeId = add(object(document.promptOverrides)['card-system'], '我的性格')
  for (const set of Array.isArray(document.promptSets) ? document.promptSets : []) add(object(object(set).promptOverrides)['card-system'], String(object(set).name || '方案') + '的性格')
  return { activeId, custom, builtins: {} }
}

function stored(document) {
  const source = object(document).cardPersonas
  if (source === undefined) return migrated(object(document))
  const value = object(source)
  const custom = []
  for (const item of Array.isArray(value.custom) ? value.custom : []) {
    const entry = object(item)
    if (typeof entry.id !== 'string' || entry.id === '' || typeof entry.name !== 'string' || typeof entry.text !== 'string' || custom.some(other => other.id === entry.id)) continue
    custom.push({ id: entry.id, name: entry.name, text: entry.text })
  }
  const builtins = {}
  for (const [id, edit] of Object.entries(object(value.builtins))) {
    const entry = object(edit)
    const kept = {}
    if (typeof entry.name === 'string') kept.name = entry.name
    if (typeof entry.text === 'string') kept.text = entry.text
    if (entry.deleted === true) kept.deleted = true
    if (Object.keys(kept).length > 0) builtins[id] = kept
  }
  return { activeId: typeof value.activeId === 'string' ? value.activeId : '', custom, builtins }
}

function entries(library, builtins) {
  const list = []
  for (const shipped of builtins) {
    const edit = library.builtins[shipped.id] || {}
    if (edit.deleted) continue
    const name = edit.name ?? shipped.label
    const text = edit.text ?? shipped.text
    list.push({ id: 'builtin:' + shipped.id, name, text, builtin: true, modified: name !== shipped.label || text !== shipped.text })
  }
  for (const item of library.custom) list.push({ id: item.id, name: item.name, text: item.text, builtin: false, modified: false })
  return list
}

export function presentCardPersonas(document, builtins = shippedPersonas()) {
  const library = stored(document)
  const items = entries(library, builtins)
  return { activeId: items.some(item => item.id === library.activeId) ? library.activeId : '', items }
}

export function activeCardPersonaText(document, builtins = shippedPersonas()) {
  const { activeId, items } = presentCardPersonas(document, builtins)
  return items.find(item => item.id === activeId)?.text || ''
}

// Applies one library action to a settings document in place.
export function applyCardPersonaChange(next, change, builtins = shippedPersonas()) {
  const library = stored(next)
  const items = entries(library, builtins)
  const target = items.find(item => item.id === change.id)
  const shippedId = id => String(id).slice('builtin:'.length)
  const editBuiltin = (id, patch) => { library.builtins[shippedId(id)] = { ...library.builtins[shippedId(id)], ...patch } }
  const newId = () => 'persona-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  const names = items.map(item => item.name)
  const action = change.action
  if (action !== 'create' && !(action === 'select' && change.id === '') && !target) throw new Error('性格不存在')
  if (action === 'select') library.activeId = change.id
  else if (action === 'save') {
    const text = personaText(change.text)
    if (target.builtin) editBuiltin(target.id, { text })
    else library.custom.find(item => item.id === target.id).text = text
  } else if (action === 'rename') {
    const name = uniqueName(names.filter(value => value !== target.name), personaName(change.name))
    if (target.builtin) editBuiltin(target.id, { name })
    else library.custom.find(item => item.id === target.id).name = name
  } else if (action === 'restore') {
    if (!target.builtin) throw new Error('只有内置性格可以恢复默认')
    delete library.builtins[shippedId(target.id)]
  } else if (action === 'delete') {
    if (target.builtin) library.builtins[shippedId(target.id)] = { deleted: true }
    else library.custom = library.custom.filter(item => item.id !== target.id)
    if (library.activeId === target.id) library.activeId = ''
  } else if (action === 'create' || action === 'duplicate') {
    const id = newId()
    library.custom.push({ id, name: uniqueName(names, personaName(change.name)), text: action === 'duplicate' ? target.text : '' })
    library.activeId = id
  } else throw new Error('未知的性格操作')
  next.cardPersonas = library
  return next
}
