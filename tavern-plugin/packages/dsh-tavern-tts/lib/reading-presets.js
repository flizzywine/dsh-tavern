// the one pronunciation dictionary — named presets, one active globally.
// Stored apart from settings.yaml in `<dataDir>/readings.json` so a large dictionary never rides along with every settings
// write: {version:1, active, presets:[{id, name, revision, entries}]}. A missing file is one empty 「默认」 preset; nothing is
// written until the first edit. Edits are one row at a time (add / set / remove by index under the preset's revision), so a
// 5,000-entry list is never re-sent. Exports are plain JSON {version:1, kind:'dsh-tts-readings', name, entries}.
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { normalizeReadingEntry, normalizeReadingEntries, validateReadingEntries } from './reading-dictionary.js'

const fail = code => { throw Object.assign(new Error(code), {code}) }
export const READING_PRESET_LIMIT = 64
export const READING_PRESET_KIND = 'dsh-tts-readings'
const NAME_MAX = 40
const PRESET_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const own = (value, keys) => { for (const key of Object.keys(value)) if (!keys.includes(key)) fail('UNKNOWN_FIELD') }
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value)

// Input form of an entry (what the editor sends and an export holds); the store re-derives language and warnings.
export const readingInput = e => ({forms:e.forms, reading:e.reading, ...(e.languageOverride ? {languageOverride:e.languageOverride} : {})})
export function emptyReadingPresets() { return {version:1, active:'default', presets:[{id:'default', name:'默认', revision:0, entries:[]}]} }
export function readingPresetName(value) {
  if (typeof value !== 'string') fail('INVALID_INPUT')
  const name = value.trim()
  if (!name || name.length > NAME_MAX) fail('INVALID_PRESET_NAME')
  return name
}
export function validateReadingPresets(doc) {
  if (!plain(doc) || doc.version !== 1 || !Array.isArray(doc.presets)) fail('INVALID_READINGS')
  own(doc, ['version','active','presets'])
  if (!doc.presets.length || doc.presets.length > READING_PRESET_LIMIT) fail('INVALID_READINGS')
  const ids = new Set(), names = new Set()
  for (const preset of doc.presets) {
    if (!plain(preset)) fail('INVALID_READINGS')
    own(preset, ['id','name','revision','entries'])
    if (!PRESET_ID.test(preset.id) || ids.has(preset.id) || readingPresetName(preset.name) !== preset.name || names.has(preset.name)
      || !Number.isSafeInteger(preset.revision) || preset.revision < 0) fail('INVALID_READINGS')
    validateReadingEntries(preset.entries)
    ids.add(preset.id); names.add(preset.name)
  }
  if (!ids.has(doc.active)) fail('INVALID_READINGS')
  return doc
}
export function readingPresetDocument(preset) {
  return {version:1, kind:READING_PRESET_KIND, name:preset.name, entries:preset.entries.map(readingInput)}
}
export function parseReadingPresetDocument(value) {
  if (!plain(value) || value.version !== 1 || value.kind !== READING_PRESET_KIND || !Array.isArray(value.entries)) fail('INVALID_READINGS')
  own(value, ['version','kind','name','entries'])
  return {name:readingPresetName(value.name), entries:normalizeReadingEntries(value.entries)}
}
// A unique name: 「名字」, then 「名字 2」, 「名字 3」…
export function uniquePresetName(presets, wanted) {
  const base = readingPresetName(wanted), taken = new Set(presets.map(p => p.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) { const name = (base.slice(0, NAME_MAX - String(n).length - 1) + ' ' + n); if (!taken.has(name)) return name }
}

// Windows can refuse a rename onto a file another process (indexer, antivirus) holds for a moment: retry briefly.
async function replaceFile(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { return await rename(from, to) }
    catch (error) { if (attempt >= 8 || !['EPERM','EACCES','EBUSY'].includes(error.code)) throw error; await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1))) }
  }
}
export function createReadingPresetStore({file} = {}) {
  let doc = null, loading = null, writes = Promise.resolve()
  const listeners = new Set()
  async function load() {
    if (!file) return emptyReadingPresets()
    let text
    try { text = await readFile(file, 'utf8') } catch (error) { if (error.code === 'ENOENT') return emptyReadingPresets(); throw error }
    let value
    try { value = JSON.parse(text) } catch { fail('INVALID_READINGS') }
    return validateReadingPresets(value)
  }
  const ensure = () => doc ? Promise.resolve(doc) : (loading ??= load().then(value => { doc = value; return doc }, error => { loading = null; throw error }))
  async function persist(next) {
    if (!file) return
    await mkdir(dirname(file), {recursive:true})
    const temporary = file + '.' + process.pid + '-' + randomBytes(4).toString('hex') + '.tmp'
    try { await writeFile(temporary, JSON.stringify(next) + '\n', {flag:'wx'}); await replaceFile(temporary, file) }
    catch (error) { await rm(temporary, {force:true}).catch(() => {}); throw error }
  }
  // Serialized read-modify-write; `change` returns {next, result, active?} or throws. Only the touched preset is copied.
  function mutate(change) {
    const run = writes.then(async () => {
      const current = await ensure(), {next, result} = change(current)
      if (next !== current) { await persist(next); const before = current.active; doc = next; for (const fn of listeners) fn({activeChanged:before !== next.active || touched(result, next.active)}) }
      return result
    })
    writes = run.catch(() => {})
    return run
  }
  const touched = (result, active) => result?.id === active
  const find = (current, id) => current.presets.find(p => p.id === id) || fail('PRESET_NOT_FOUND')
  const summary = current => ({active:current.active, presets:current.presets.map(p => ({id:p.id, name:p.name, count:p.entries.length, revision:p.revision}))})
  const replace = (current, preset) => ({...current, presets:current.presets.map(p => p.id === preset.id ? preset : p)})
  const newId = current => { for (;;) { const id = 'p-' + randomBytes(5).toString('hex'); if (!current.presets.some(p => p.id === id)) return id } }
  function add(current, name, entries) {
    if (current.presets.length >= READING_PRESET_LIMIT) fail('PRESET_LIMIT')
    const preset = {id:newId(current), name:uniquePresetName(current.presets, name), revision:0, entries}
    validateReadingEntries(entries)
    const next = {...current, presets:[...current.presets, preset]}
    return {next, result:{...summary(next), id:preset.id}}
  }
  return {
    ensure,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    // Synthesis reads this array; it is replaced (never mutated) on every change, so lexicons can be memoized by identity.
    async activeEntries() { const current = await ensure(); return find(current, current.active).entries },
    async list() { return summary(await ensure()) },
    async get({id} = {}) { const current = await ensure(), p = find(current, id ?? current.active); return {id:p.id, name:p.name, revision:p.revision, entries:p.entries} },
    // One row: op 'add' (appends), 'set' (index), 'remove' (index). The response carries only that row.
    edit({id, expectedRevision, op, index, entry} = {}) {
      return mutate(current => {
        const preset = find(current, id)
        if (expectedRevision !== preset.revision) fail('REVISION_CONFLICT')
        if (!['add','set','remove'].includes(op)) fail('INVALID_INPUT')
        if (op !== 'add' && (!Number.isInteger(index) || index < 0 || index >= preset.entries.length)) fail('INVALID_INPUT')
        const entries = preset.entries.slice(), normalized = op === 'remove' ? undefined : normalizeReadingEntry(entry)
        if (op === 'add') entries.push(normalized); else if (op === 'set') entries[index] = normalized; else entries.splice(index, 1)
        validateReadingEntries(entries)
        const next = replace(current, {...preset, revision:preset.revision + 1, entries})
        return {next, result:{id, revision:preset.revision + 1, op, index:op === 'add' ? entries.length - 1 : index, count:entries.length, ...(normalized ? {entry:normalized} : {})}}
      })
    },
    // Entries with the same reading, language and override become one entry holding all their forms, at the first one's
    // place. `dryRun` only counts ({groups, removed} under the current revision); a merge writes once.
    merge({id, expectedRevision, dryRun = false} = {}) {
      return mutate(current => {
        const preset = find(current, id)
        if (expectedRevision !== preset.revision) fail('REVISION_CONFLICT')
        const groups = new Map()
        for (const entry of preset.entries) {
          const key = entry.language + '\0' + (entry.languageOverride || '') + '\0' + entry.reading
          if (groups.has(key)) groups.get(key).push(entry); else groups.set(key, [entry])
        }
        const merged = [...groups.values()].filter(list => list.length > 1), removed = preset.entries.length - groups.size
        const counted = {id, revision:preset.revision, groups:merged.length, removed, count:groups.size}
        if (dryRun || !removed) return {next:current, result:counted}
        const entries = [...groups.values()].map(list => list.length === 1 ? list[0] : normalizeReadingEntry({...readingInput(list[0]), forms:list.flatMap(entry => entry.forms)}))
        validateReadingEntries(entries)
        const next = replace(current, {...preset, revision:preset.revision + 1, entries})
        return {next, result:{...counted, revision:preset.revision + 1}}
      })
    },
    create({name, from} = {}) {
      return mutate(current => add(current, name, from === undefined ? [] : find(current, from).entries))
    },
    rename({id, name} = {}) {
      return mutate(current => {
        const preset = find(current, id), wanted = readingPresetName(name)
        if (wanted === preset.name) return {next:current, result:summary(current)}
        if (current.presets.some(p => p.name === wanted)) fail('DUPLICATE_PRESET_NAME')
        const next = replace(current, {...preset, name:wanted})
        return {next, result:summary(next)}
      })
    },
    remove({id} = {}) {
      return mutate(current => {
        find(current, id)
        if (current.presets.length === 1) fail('LAST_PRESET')
        const presets = current.presets.filter(p => p.id !== id)
        const next = {...current, presets, active:current.active === id ? presets[0].id : current.active}
        return {next, result:summary(next)}
      })
    },
    setActive({id} = {}) {
      return mutate(current => {
        find(current, id)
        if (current.active === id) return {next:current, result:summary(current)}
        const next = {...current, active:id}
        return {next, result:summary(next)}
      })
    },
    async exportPreset({id} = {}) { const current = await ensure(); return readingPresetDocument(find(current, id)) },
    importPreset({document} = {}) {
      const parsed = parseReadingPresetDocument(document)
      return mutate(current => add(current, parsed.name, parsed.entries))
    },
  }
}
