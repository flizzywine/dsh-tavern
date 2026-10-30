import {isDeepStrictEqual as equal} from 'node:util'
import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'

// Only explicitly declared display fields may retain runtime authority across a write.
export function modPresentationChanges(before,after) {
  const strip=snapshot=>{
    const {revision,...value}=structuredClone(snapshot)
    for(const [id,mod] of Object.entries(value.mods)) {
      const row=value.global.mods[id] ||= {enabledPackIds:[],settings:{}}
      row.settings ||= {}
      for(const field of mod.manifest.settingsSchema.fields)if(field.presentation)delete row.settings[field.key]
    }
    return value
  }
  if(!equal(strip(before),strip(after)))return null
  const changes={}
  for(const [id,mod] of Object.entries(after.mods)) {
    const values={}
    for(const field of mod.manifest.settingsSchema.fields.filter(field=>field.presentation)) {
      const prior=before.global.mods[id]?.settings?.[field.key] ?? field.default,next=after.global.mods[id]?.settings?.[field.key] ?? field.default
      if(!equal(prior,next))values[field.key]=next
    }
    if(Object.keys(values).length)changes[id]=values
  }
  return changes
}
const {modCheck: check, modShape: shape, modPlain: plain, modSafeKey: key, MOD_FIELD_TYPES} = contract
const text = (value, max = 240) => typeof value === 'string' && value.length > 0 && value.length <= max
export const modHelp = value => value === undefined || (text(value, 240) && !/[\r\n]/.test(value) && !/(?:[!?\u3002\uff01\uff1f]\s*|\.\s+)\S/.test(value))
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)

function referenceValue(field, value) {
  if (value === null) return true
  if (field.target.library === 'pack') return key(value)
  if (!plain(value) || !uuid(value.packId) || !field.target.kinds.includes(value.kind)) return false
  if (field.target.library === 'main') return Object.keys(value).every(k => ['packId','kind','assetId'].includes(k)) && key(value.assetId)
  return Object.keys(value).every(k => ['modId','packId','kind','entryId'].includes(k)) && value.modId === field.target.modId && key(value.entryId)
}
export function modSettingValue(field, value, ownerId) {
  switch (field.type) {
    case 'text': return typeof value === 'string' && [...value].length <= field.maxLength
    case 'toggle': return typeof value === 'boolean'
    case 'slider': return Number.isFinite(value) && value >= field.min && value <= field.max && Math.abs((value - field.min) / field.step - Math.round((value - field.min) / field.step)) < 1e-7
    case 'segmented': return field.choices.some(option => option.value === value)
    case 'colour': return (value === 'auto' && !!field.stageToken) || (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
    case 'asset-picker': case 'sound-picker': return referenceValue({target:{library:field.source === 'main' ? 'main' : 'mod',modId:ownerId,kinds:[field.kind]}}, value)
    case 'reference': return referenceValue(field, value)
    case 'object': return plain(value) && field.fields.every(child => Object.hasOwn(value, child.key) && modSettingValue(child, value[child.key], ownerId)) && Object.keys(value).every(k => field.fields.some(child => child.key === k))
    case 'list': return Array.isArray(value) && value.length <= field.maxItems && value.every(item => modSettingValue(field.item, item, ownerId))
    default: return false
  }
}

export function validateModSettingsSchema(schema, path = '$.settingsSchema', settings = false, ownerId) {
  shape(schema, ['fields','sections'], settings ? ['fields','sections'] : ['fields'], path)
  let count = 0
  const definitions = (fields, at, depth) => {
    check(Array.isArray(fields) && fields.length <= 64 && depth <= 4, at, 'Field limit')
    const seen = new Set()
    for (const field of fields) {
      check(plain(field) && ++count <= 128 && key(field.key) && !seen.has(field.key), at, 'Duplicate or invalid field key')
      seen.add(field.key)
      declaration(field, at + '.' + field.key, depth)
    }
  }
  const declaration = (field, at, depth) => {
    check(plain(field) && MOD_FIELD_TYPES.includes(field.type) && depth <= 4, at, 'Unknown field type or nesting limit')
    const extras = {text:['maxLength','placeholder'],toggle:[],slider:['min','max','step','unit'],segmented:['choices'],colour:['stageToken','palette'], 'asset-picker':['kind','source'], 'sound-picker':['kind'],reference:['target'],object:['fields'],list:['item','maxItems']}[field.type]
    shape(field, ['key','type','label','help','default','bindable',...(settings ? ['scope','dependsOn','presentation'] : []),...extras], ['type','label','default',...(settings ? ['scope'] : []),...extras.filter(k => !['unit','placeholder','stageToken','palette'].includes(k))], at)
    if (settings) {
      check(field.scope==='global', at + '.scope', 'Mod settings are global only')
      if(field.presentation!==undefined)check(typeof field.presentation==='boolean',at+'.presentation')
      check(!['object','list','reference'].includes(field.type), at + '.type', 'Structured data belongs to pack fields')
      if (field.type==='asset-picker') check(field.source==='own', at + '.source', 'Mod settings reference owned assets')
      check(field.scope !== 'global' || !field.bindable, at + '.bindable', 'Global settings cannot bind a card variable')
    }
    check(text(field.label,80) && modHelp(field.help), at, 'Invalid label or one-sentence help')
    if (field.placeholder !== undefined) check(text(field.placeholder,160), at + '.placeholder')
    if (field.stageToken !== undefined) check(/^--gal-ui-[a-z-]+$/.test(field.stageToken), at + '.stageToken')
    if (field.palette !== undefined) check(Array.isArray(field.palette) && field.palette.length <= 32 && field.palette.every(value => /^#[0-9a-f]{6}$/i.test(value)), at + '.palette')
    if (field.bindable !== undefined) check(typeof field.bindable === 'boolean', at + '.bindable')
    if (field.type === 'text') check(Number.isSafeInteger(field.maxLength) && field.maxLength > 0 && field.maxLength <= 4096, at)
    if (field.type === 'slider') {
      check([field.min,field.max,field.step].every(Number.isFinite) && field.min < field.max && field.step > 0 && (field.max - field.min) / field.step <= 10000, at)
      if (field.unit !== undefined) check(text(field.unit,24), at + '.unit')
    }
    if (field.type === 'segmented') {
      check(Array.isArray(field.choices) && field.choices.length >= 2 && field.choices.length <= 32, at)
      const values = new Set()
      for (const option of field.choices) {
        shape(option, ['value','label'], undefined, at)
        check(key(option.value) && text(option.label,80) && !values.has(option.value), at, 'Invalid or duplicate option')
        values.add(option.value)
      }
    }
    if (['asset-picker','sound-picker'].includes(field.type)) {
      check(key(field.kind), at + '.kind')
      if (field.type === 'asset-picker') check(['own','main'].includes(field.source), at + '.source')
    }
    if (field.type === 'reference') {
      if (field.target?.library === 'pack') {
        shape(field.target, ['library','field'], undefined, at + '.target')
        check(key(field.target.field), at + '.target.field', 'Pack list field required')
      } else {
        shape(field.target, ['library','modId','kinds'], ['library','kinds'], at + '.target')
        check(['main','mod'].includes(field.target.library), at)
        check(Array.isArray(field.target.kinds) && field.target.kinds.length > 0 && field.target.kinds.every(key) && new Set(field.target.kinds).size === field.target.kinds.length, at)
        check(field.target.library === 'main' ? field.target.modId === undefined : typeof field.target.modId === 'string' && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(field.target.modId), at, 'Reference target required')
      }
    }
    if (field.type === 'object') definitions(field.fields, at + '.fields', depth + 1)
    if (field.type === 'list') {
      check(Number.isSafeInteger(field.maxItems) && field.maxItems >= 1 && field.maxItems <= 256, at)
      declaration(field.item, at + '.item', depth + 1)
    }
    check(modSettingValue(field, field.default, ownerId), at + '.default', 'Invalid field default')
  }
  definitions(schema.fields, path + '.fields', 0)
  if (schema.sections !== undefined) {
    check(Array.isArray(schema.sections) && schema.sections.length <= 32, path + '.sections')
    const ids = new Set(), placed = new Set(), keys = new Set(schema.fields.map(field => field.key))
    const container = (value, at, isSection) => {
      shape(value, ['id','title','help','folded','fields',...(isSection ? ['groups'] : [])], ['id','title',...(!isSection ? ['fields'] : [])], at)
      if (isSection) check((value.fields !== undefined) !== (value.groups !== undefined), at, 'Choose fields or groups, not both')
      check(key(value.id) && !ids.has(value.id) && (!isSection || !['assets','variables','advanced','preview'].includes(value.id)), at + '.id', 'Stable layout IDs must be unique and not shadow host sections')
      ids.add(value.id)
      check(text(value.title,80) && (value.folded === undefined || typeof value.folded === 'boolean') && modHelp(value.help), at)
      if (value.fields !== undefined) {
        check(Array.isArray(value.fields), at + '.fields')
        for (const field of value.fields) {
          check(keys.has(field) && !placed.has(field), at + '.fields', 'Field must occur exactly once in layout')
          placed.add(field)
        }
      }
    }
    for (const section of schema.sections) {
      const at = path + '.sections'
      container(section, at, true)
      if (section.groups !== undefined) {
        check(Array.isArray(section.groups) && section.groups.length <= 32, at + '.groups')
        for (const group of section.groups) container(group, at + '.groups', false)
      }
    }
    check(placed.size === keys.size, path + '.sections', 'Layout must include every field')
  }
  const fields = new Map(schema.fields.map(field => [field.key, field]))
  for (const field of schema.fields) {
    if (field.dependsOn === undefined) continue
    const at = path + '.fields.' + field.key + '.dependsOn'
    shape(field.dependsOn, ['key','equals'], ['key'], at)
    const dependency = fields.get(field.dependsOn.key)
    check(dependency, at + '.key', 'Unknown dependency field')
    if (Object.hasOwn(field.dependsOn, 'equals')) check(modSettingValue(dependency, field.dependsOn.equals, ownerId), at + '.equals', 'Invalid dependency value')
    const seen = new Set([field.key])
    let next = dependency
    while (next) {
      check(!seen.has(next.key), at + '.key', 'Cyclic setting dependency')
      seen.add(next.key)
      next = fields.get(next.dependsOn?.key)
    }
  }
  return schema
}
