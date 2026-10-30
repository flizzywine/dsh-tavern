import {MOD_EVENTS} from './events.js'
import directorCommands from '../../../packages/dsh-presentation-protocol/src/director-commands.cjs'
import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import widgetContract from '../../../src/client/widget-contracts.cjs'
import {validateAssetRef, ASSET_KINDS} from '../../../packages/dsh-presentation-protocol/src/asset-packs.js'
import {validateModSettingsSchema, modSettingValue, modHelp} from './settings.js'
import {validateModVariableSlots} from './variable-slots.js'
const {modCheck: check, modShape: shape, modJson, modPlacement, modFreeze, modSafeKey: key, MOD_STAGE_CAPABILITIES} = contract
const {stageWidgetSchemaValid, validateStageWidgetVariables} = widgetContract
const validatedManifests = new WeakSet(), validatedPacks = new WeakMap()
const modId = value => typeof value === 'string' && value.length <= 128 && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(value)
const version = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
export {modId as isModId, uuid as isModPackId}
const text = (value, max = 240) => typeof value === 'string' && value.length > 0 && value.length <= max
function list(value, path, max = 64) { check(Array.isArray(value) && value.length <= max, path, 'Expected bounded list') }
function uniqueStrings(value, path, valid = key, max = 64) {
  list(value, path, max)
  check(value.every(valid) && new Set(value).size === value.length, path, 'Invalid or duplicate identifiers')
}
function declarations(value, path, validate, max) {
  list(value, path, max)
  const seen = new Set()
  for (const row of value) {
    check(row && key(row.id) && !seen.has(row.id), path, 'Duplicate or invalid declaration ID')
    seen.add(row.id)
    validate(row, path + '.' + row.id)
  }
}
export function validateModPath(value, at = '$.path') {
  check(typeof value === 'string' && value.length <= 240 && value.split('/').every(part => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) && !part.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), at, 'Unsafe archive path')
  return value
}
export function validateModVersionRange(value, at = '$.range') {
  const matched = typeof value === 'string' && /^>=(\d+\.\d+\.\d+) <(\d+\.\d+\.\d+)$/.exec(value)
  check(matched && version(matched[1]) && version(matched[2]), at, 'Use >=min <nextMajor')
  const [major] = matched[1].split('.').map(Number)
  check(Number.isSafeInteger(major) && matched[2] === `${major + 1}.0.0`, at, 'Upper bound must be next major')
  return value
}
function missingEdge(value, at) {
  check(value.optional === undefined || typeof value.optional === 'boolean', at + '.optional')
  check(value.onMissing === undefined || ['error','silent','notify'].includes(value.onMissing), at + '.onMissing')
}
function files(value, at) {
  list(value, at, 2048)
  const names = new Set()
  let total = 0
  for (const file of value) {
    shape(file, ['path','size'], undefined, at)
    validateModPath(file.path, at + '.path')
    check(!names.has(file.path.toLowerCase()), at, 'Duplicate archive path')
    names.add(file.path.toLowerCase())
    check(Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= 64 * 1024 * 1024, at + '.size')
    total += file.size
  }
  check(total <= 256 * 1024 * 1024, at, 'Archive size limit')
}
function permissions(value, at) {
  shape(value, ['variables','mainAssets','source','stage','judge','models'], ['stage'], at)
  uniqueStrings(value.stage, at + '.stage', v => MOD_STAGE_CAPABILITIES.includes(v))
  if (value.models !== undefined) uniqueStrings(value.models, at + '.models')
  if (value.judge !== undefined) check(typeof value.judge === 'boolean', at + '.judge')
  if (value.source !== undefined) uniqueStrings(value.source, at + '.source', v => ['dialogue','avatar','voice-replay'].includes(v))
  if (value.mainAssets !== undefined) {
    list(value.mainAssets, at + '.mainAssets')
    const slots = new Set()
    for (const read of value.mainAssets) {
      shape(read, ['slot','kinds','refs'], ['slot','kinds'], at + '.mainAssets')
      check(key(read.slot) && !slots.has(read.slot), at, 'Duplicate or invalid asset slot')
      slots.add(read.slot)
      uniqueStrings(read.kinds, at + '.mainAssets.kinds')
      check(read.kinds.length > 0, at)
      if (read.refs !== undefined) {
        list(read.refs, at + '.mainAssets.refs')
        for (const ref of read.refs) {
          validateAssetRef(ref)
          check(read.kinds.includes(ref.kind), at, 'Reference outside declared kinds')
        }
      }
    }
  }
  if (value.variables !== undefined) {
    shape(value.variables, ['reads','writes'], [], at + '.variables')
    const mapped = {reads:{}, writes:{}}
    for (const mode of ['reads','writes']) declarations(value.variables[mode] || [], at + '.variables.' + mode, (row, location) => {
      const {id,...declaration} = row
      if(mode === 'reads' && row.slot !== undefined) {
        shape(row,['id','slot'],undefined,location)
        check(key(row.slot),location + '.slot')
      } else {
        shape(row, mode === 'reads' ? ['id','source','path'] : ['id','source','path','scope','ops'], undefined, location)
        mapped[mode][id] = declaration
      }
    }, mode === 'reads' ? 32 : 16)
    // Reuse the existing pointer/overlap/op capability rules; never a second resolver.
    validateStageWidgetVariables(mapped)
  }
}

export function validateModPack(input, manifest) {
  if (validatedPacks.get(input) === manifest) return input
  modJson(input, 1024 * 1024)
  const value = structuredClone(input)
  shape(value, ['format','schemaVersion','id','modId','requiresModVersion','name','fields','entries','files'])
  check(value.format === 'dsh-mod-pack' && value.schemaVersion === 1 && uuid(value.id) && value.modId === manifest.id && text(value.name), '$', 'Invalid pack identity')
  validateModVersionRange(value.requiresModVersion, '$.requiresModVersion')
  files(value.files, '$.files')
  const fileSet = new Set(value.files.map(file => file.path))
  const values = (schema, data, at) => {
    shape(data, schema.fields.map(field => field.key), [], at)
    for (const [id,item] of Object.entries(data)) check(modSettingValue(schema.fields.find(field => field.key === id),item,manifest.id), at + '.' + id, 'Invalid field value')
  }
  values(manifest.packSchema || {fields:[]}, value.fields, '$.fields')
  const references = new Map()
  for (const kind of manifest.assetKinds) for (const field of kind.fields.fields) if (field.type === 'reference' && field.target.library === 'pack') {
    const rows = value.fields[field.target.field]
    check(Array.isArray(rows), '$.fields.' + field.target.field, 'Missing pack reference list')
    check(rows.every(row => key(row.id)) && new Set(rows.map(row => row.id)).size === rows.length, '$.fields.' + field.target.field, 'Pack list IDs must be unique stable keys')
    references.set(field.target.field, new Set(rows.map(row => row.id)))
  }
  declarations(value.entries, '$.entries', (entry, at) => {
    shape(entry, ['id','kind','name','enabled','recall','directorNote','fields','media'], ['id','kind','name','enabled','fields','media'], at)
    const kind = manifest.assetKinds.find(kind => kind.id === entry.kind)
    check(kind && text(entry.name) && typeof entry.enabled === 'boolean', at, 'Unknown asset kind or invalid entry')
    values(kind.fields, entry.fields, at + '.fields')
    for (const field of kind.fields.fields) if (field.type === 'reference' && field.target.library === 'pack' && entry.fields[field.key] != null)
      check(references.get(field.target.field).has(entry.fields[field.key]), at + '.fields.' + field.key, 'Unknown pack list reference')
    shape(entry.media, kind.mediaSlots.map(slot => slot.id), [], at + '.media')
    for (const file of Object.values(entry.media)) check(fileSet.has(file), at + '.media', 'Media must belong to the declared pack files')
    if (entry.directorNote !== undefined) check(kind.directorSelectable && text(entry.directorNote,2000), at + '.directorNote')
    if (entry.recall !== undefined) {
      check(kind.directorSelectable, at + '.recall', 'Utility entries have no director recall lamp')
      shape(entry.recall, ['mode','keywords','synonyms'], ['mode','keywords'], at + '.recall')
      check(['constant','keyword'].includes(entry.recall.mode), at + '.recall.mode')
      uniqueStrings(entry.recall.keywords, at + '.recall.keywords', value => text(value,160))
      if (entry.recall.synonyms !== undefined) {
        shape(entry.recall.synonyms, entry.recall.keywords, [], at + '.recall.synonyms')
        for (const terms of Object.values(entry.recall.synonyms)) uniqueStrings(terms, at + '.recall.synonyms', value => text(value,160))
      }
    }
  }, 1024)
  validatedPacks.set(value,manifest)
  return modFreeze(value)
}

export function validateModManifest(input) {
  if (validatedManifests.has(input)) return input
  try {
    modJson(input)
    const value = structuredClone(input), at = '$'
    shape(value, ['format','schemaVersion','id','name','summary','relevance','i18n','ui','version','apiVersion','dependencies','permissions','variableSlots','commands','prompts','settingsSchema','packSchema','assetKinds','uiPages','runtime','defaultPacks','files','license','compatibility','builtinAssets','admission','subscriptions','modelSlots','uiLayers','provides','consumes'], ['format','schemaVersion','id','name','summary','relevance','version','apiVersion','dependencies','permissions','commands','prompts','settingsSchema','assetKinds','uiPages','runtime','defaultPacks','files','license','compatibility','builtinAssets','admission'], at)
    if(value.subscriptions!==undefined) {
      list(value.subscriptions,'$.subscriptions',MOD_EVENTS.length)
      const events=new Set()
      for(const row of value.subscriptions) {
        shape(row,['event','delivery'])
        check(MOD_EVENTS.includes(row.event) && !events.has(row.event) && ['active','lifecycle'].includes(row.delivery),'$.subscriptions')
        events.add(row.event)
      }
    }
    check(text(value.relevance,120) && value.relevance.trim() === value.relevance && !/[\r\n]/.test(value.relevance), '$.relevance', 'Expected a single-line relevance description, at most 120 characters')
    check(text(value.summary) && modHelp(value.summary), '$.summary', 'Expected one-sentence summary')
    check(value.format === 'dsh-mod' && value.schemaVersion === 2 && value.apiVersion === 1, at, 'Unsupported mod API or format')
    check(modId(value.id) && text(value.name) && version(value.version), at, 'Invalid mod identity')
    shape(value.dependencies, ['hostApi','capabilities','mods','assets'], ['hostApi','capabilities'], '$.dependencies')
    check(value.dependencies.hostApi === 1, '$.dependencies.hostApi', 'Unsupported host API')
    uniqueStrings(value.dependencies.capabilities, '$.dependencies.capabilities', v => typeof v === 'string' && /^[a-zA-Z][a-zA-Z0-9.-]{0,127}$/.test(v))
    const deps = new Set()
    if (value.dependencies.mods !== undefined) {
      list(value.dependencies.mods, '$.dependencies.mods')
      for (const dependency of value.dependencies.mods) {
        shape(dependency, ['id','range','optional','onMissing'], ['id','range'], '$.dependencies.mods')
        missingEdge(dependency, '$.dependencies.mods')
        check(modId(dependency.id) && dependency.id !== value.id && !deps.has(dependency.id), '$.dependencies.mods', 'Invalid dependency')
        deps.add(dependency.id)
        validateModVersionRange(dependency.range)
      }
    }
    if (value.dependencies.assets !== undefined) {
      list(value.dependencies.assets, '$.dependencies.assets')
      const slots = new Set()
      for (const dependency of value.dependencies.assets) {
        shape(dependency, ['slot','packId','kinds'], undefined, '$.dependencies.assets')
        check(key(dependency.slot) && !slots.has(dependency.slot) && uuid(dependency.packId), '$.dependencies.assets')
        slots.add(dependency.slot)
        uniqueStrings(dependency.kinds, '$.dependencies.assets.kinds')
        check(dependency.kinds.length > 0, '$.dependencies.assets.kinds')
      }
    }
    const providedIds = new Set()
    list(value.provides || [], '$.provides')
    for (const provided of value.provides || []) {
      const location = '$.provides'
      shape(provided, ['id','version','contract','operations','resource','handler'], ['id','version','contract','operations','handler'], location)
      check(modId(provided.id) && !providedIds.has(provided.id) && version(provided.version), location, 'Invalid or duplicate capability')
      providedIds.add(provided.id)
      check(text(provided.contract,80) && /^[a-z][a-z0-9.-]*\/[1-9][0-9]*$/.test(provided.contract) && key(provided.handler), location)
      uniqueStrings(provided.operations, location + '.operations')
      check(provided.operations.length > 0, location + '.operations')
      if (provided.resource) {
        shape(provided.resource, ['scope','key','policy'], undefined, location + '.resource')
        check(provided.resource.scope === 'chat-branch' && /^[a-z][a-z0-9.-]*\/[a-z][a-z0-9.-]*$/.test(provided.resource.key), location + '.resource')
        check(['exclusive','overlay-with-base','observe'].includes(provided.resource.policy), location + '.resource.policy')
      }
    }
    declarations(value.consumes || [], '$.consumes', (edge, location) => {
      shape(edge, ['id','capability','provider','range','operations','optional','onMissing'], ['id','capability','provider','range','operations'], location)
      check(modId(edge.capability) && modId(edge.provider) && edge.provider !== value.id, location)
      validateModVersionRange(edge.range, location + '.range')
      uniqueStrings(edge.operations, location + '.operations')
      check(edge.operations.length > 0, location + '.operations')
      missingEdge(edge, location)
    })
    shape(value.compatibility, ['compatible','incompatible'], [], '$.compatibility')
    for (const relation of ['compatible','incompatible']) {
      const rows=Object.hasOwn(value.compatibility,relation)?value.compatibility[relation]:[], seen=new Set()
      list(rows, '$.compatibility.'+relation)
      for (const row of rows) {
        const at='$.compatibility.'+relation
        shape(row, relation==='incompatible'?['id','range','reason']:['id','range'], relation==='incompatible'?['id','range','reason']:['id','range'], at)
        check(modId(row.id) && row.id!==value.id && !seen.has(row.id), at, 'Invalid compatibility identity')
        seen.add(row.id);validateModVersionRange(row.range, at+'.range')
        if (relation==='incompatible') check(text(row.reason), at+'.reason')
      }
    }
    shape(value.admission, ['entryKinds'], undefined, '$.admission')
    uniqueStrings(value.admission.entryKinds, '$.admission.entryKinds', kind=>ASSET_KINDS.includes(kind) || kind==='props')
    permissions(value.permissions, '$.permissions')
    declarations(value.modelSlots || [], '$.modelSlots', (slot, location) => {
      shape(slot,['id','label','purpose','fallback','kind','reasoning'],['id','label','purpose','fallback'],location)
      check(slot.reasoning === undefined || text(slot.reasoning,32),location+'.reasoning')
      check(text(slot.label,80) && text(slot.purpose) && ['background','foreground'].includes(slot.fallback),location)
      check(slot.kind === undefined || ['chat','scoring'].includes(slot.kind),location+'.kind')
    })
    for(const id of value.permissions.models || [])check(value.modelSlots?.some(slot=>slot.id===id),'$.permissions.models','Unknown model slot')
    validateModVariableSlots(value.variableSlots)
    for(const read of value.permissions.variables?.reads || []) if(read.slot)
      check(value.variableSlots?.some(slot=>slot.id===read.slot),'$.permissions.variables.reads','Unknown variable slot')
    files(value.files, '$.files')
    const fileSet = new Set(value.files.map(file => file.path))
    const entry = (name, location) => { validateModPath(name, location); check(fileSet.has(name), location, 'Entry missing from files') }
    declarations(value.builtinAssets, '$.builtinAssets', (asset, location) => {
      shape(asset, ['id','path','type'], undefined, location)
      check(['image','audio','video','bundle'].includes(asset.type), location+'.type')
      entry(asset.path, location+'.path')
    })
    declarations(value.uiLayers || [], '$.uiLayers', (layer, location) => {
      shape(layer,['id','entry','band','order','input','playback','budget'],undefined,location)
      entry(layer.entry,location+'.entry')
      check(['stage-overlay','presentation','audience'].includes(layer.band) && Number.isSafeInteger(layer.order) && Math.abs(layer.order)<=1000,location)
      check(['passthrough','regions'].includes(layer.input) && ['live-once','state','recorded'].includes(layer.playback),location)
      shape(layer.budget,['maxNodes','maxVisible'],undefined,location+'.budget')
      check(Number.isSafeInteger(layer.budget.maxNodes) && layer.budget.maxNodes>0 && layer.budget.maxNodes<=512 && Number.isSafeInteger(layer.budget.maxVisible) && layer.budget.maxVisible>0 && layer.budget.maxVisible<=32,location+'.budget')
    })
    shape(value.runtime, ['entry'], undefined, '$.runtime')
    entry(value.runtime.entry, '$.runtime.entry')
    check(value.runtime.entry.endsWith('.js'), '$.runtime.entry')
    declarations(value.prompts, '$.prompts', (prompt, location) => {
      shape(prompt, ['id','target','path','placement','modelSlot'], ['id','target','path','placement'], location)
      check(prompt.target==='model' ? value.modelSlots?.some(slot=>slot.id===prompt.modelSlot) : prompt.modelSlot===undefined,location+'.modelSlot','Unknown model slot')
      // Mod prompts never instruct the foreground writer; presentation belongs to director commands.
      check(['director','settlement','model'].includes(prompt.target), location + '.target', 'Body-placement snippets and output markers are not supported; use director commands')
      modPlacement(prompt.placement, prompt.target, location + '.placement')
      entry(prompt.path, location + '.path')
    })
    const ops = new Set(), verbs = new Set()
    declarations(value.commands, '$.commands', (command, location) => {
      shape(command, ['id','op','dsl','params','persistence','handler','promptId','placement','caps','paramsStyle','replaces','mode','resourceUse'], ['mode','id','op','dsl','params','persistence','handler','promptId','placement','caps'], location)
      if (command.resourceUse !== undefined) {
        shape(command.resourceUse, ['capability','access'], undefined, location + '.resourceUse')
        check(providedIds.has(command.resourceUse.capability) && ['control','observe'].includes(command.resourceUse.access), location + '.resourceUse')
      }
      check(command.paramsStyle===undefined || command.paramsStyle==='flat',location + '.paramsStyle')
      check(command.mode==='adds' ? command.replaces===undefined : command.mode==='replaces' && typeof command.replaces==='string' && Object.hasOwn(directorCommands.byName,command.replaces), location+'.replaces', 'Use adds without a target, or replaces with one canonical core operation')
      check(typeof command.op === 'string' && /^(?:mod\.)?[a-z][a-z0-9.-]{1,191}$/.test(command.op) && !ops.has(command.op), location + '.op', 'Duplicate or invalid op')
      ops.add(command.op)
      shape(command.dsl, ['verb','syntax','positional','flags'], ['verb','syntax'], location + '.dsl')
      if(command.dsl.positional!==undefined)check(key(command.dsl.positional) && command.params.properties?.[command.dsl.positional],location + '.dsl.positional')
      if(command.dsl.flags!==undefined)uniqueStrings(command.dsl.flags,location + '.dsl.flags',name=>key(name) && command.params.properties?.[name]?.type==='boolean')
      check(key(command.dsl.verb) && !verbs.has(command.dsl.verb) && text(command.dsl.syntax,1024), location + '.dsl', 'Duplicate or invalid DSL verb')
      verbs.add(command.dsl.verb)
      check(stageWidgetSchemaValid(command.params), location + '.params', 'Unsupported parameter schema')
      check(['event','state','marker'].includes(command.persistence) && key(command.handler), location)
      check(value.prompts.some(prompt => prompt.id === command.promptId && prompt.target === 'director'), location + '.promptId', 'Missing director prompt')
      modPlacement(command.placement, 'director', location + '.placement')
      shape(command.caps, ['perTurn','bytes','group'], ['perTurn','bytes'], location + '.caps')
      if(command.caps.group!==undefined)check(key(command.caps.group),location + '.caps.group')
      check(Number.isSafeInteger(command.caps.perTurn) && command.caps.perTurn >= 1 && command.caps.perTurn <= 256 && Number.isSafeInteger(command.caps.bytes) && command.caps.bytes >= 1 && command.caps.bytes <= 16384, location + '.caps')
    })
    declarations(value.assetKinds, '$.assetKinds', (kind, location) => {
      shape(kind, ['id','label','fields','directorSelectable','mediaSlots'], undefined, location)
      check(text(kind.label,80) && typeof kind.directorSelectable === 'boolean', location)
      validateModSettingsSchema(kind.fields, location + '.fields', false, value.id)
      declarations(kind.mediaSlots, location + '.mediaSlots', (slot, loc) => {
        shape(slot, ['id','type'], undefined, loc)
        check(['image','audio','bundle'].includes(slot.type), loc)
      })
    })
    declarations(value.uiPages, '$.uiPages', (page, location) => {
      shape(page, ['id','title','entry','placement'], undefined, location)
      check(text(page.title,80) && ['settings','assets','stage'].includes(page.placement), location)
      entry(page.entry, location + '.entry')
      check(page.entry.endsWith('.html'), location + '.entry')
    })
    validateModSettingsSchema(value.settingsSchema, '$.settingsSchema', true, value.id)
    for (const field of value.settingsSchema.fields.filter(field => ['asset-picker','sound-picker'].includes(field.type))) {
      check(value.assetKinds.some(kind => kind.id === field.kind && (field.type !== 'sound-picker' || kind.mediaSlots.some(slot => slot.type === 'audio'))), '$.settingsSchema.fields.' + field.key + '.kind', 'Single-choice setting must reference this mod library')
    }
    if (value.packSchema !== undefined) validateModSettingsSchema(value.packSchema, '$.packSchema', false, value.id)
    if (value.ui !== undefined) {
      // `internal` marks a first-party mod kept for tests (the demo); the UI never lists it.
      shape(value.ui, ['layout','preview','internal'], [], '$.ui')
      check(value.ui.internal === undefined || value.ui.internal === true, '$.ui.internal')
      if (value.ui.layout !== undefined) {
        list(value.ui.layout, '$.ui.layout', 64)
        const seen = new Set()
        const hosts = {assets:value.assetKinds.length > 0, variables:!!(value.permissions.variables?.reads?.length || value.permissions.variables?.writes?.length), advanced:true}
        for (const [index, item] of value.ui.layout.entries()) {
          const at = '$.ui.layout.' + index
          shape(item, ['section','host','page','title','help'], [], at)
          const kinds = ['section','host','page'].filter(key => Object.hasOwn(item, key))
          check(kinds.length === 1, at, 'Layout item needs exactly one target')
          const kind = kinds[0], target = item[kind], identity = kind + ':' + target
          check(!seen.has(identity), at, 'Duplicate layout target')
          seen.add(identity)
          if (kind === 'section') check(value.settingsSchema.sections.some(section => section.id === target), at + '.section', 'Unknown settings section')
          if (kind === 'page') check(value.uiPages.some(page => page.id === target && page.placement === 'settings'), at + '.page', 'Unknown settings page')
          if (kind === 'host') check(Object.hasOwn(hosts,target) && hosts[target], at + '.host', 'Host section requires its declared capability')
          else check(item.title === undefined && item.help === undefined, at, 'Only host sections have layout title overrides')
          check((item.title === undefined || text(item.title,80)) && modHelp(item.help), at)
        }
      }
      if (value.ui.preview !== undefined) {
        const preview = value.ui.preview
        shape(preview, ['entry','modes','aspect'], ['entry'], '$.ui.preview')
        entry(preview.entry, '$.ui.preview.entry')
        check(preview.entry.endsWith('.html'), '$.ui.preview.entry')
        if (preview.aspect !== undefined) check(Number.isFinite(preview.aspect) && preview.aspect > 0 && preview.aspect <= 10, '$.ui.preview.aspect')
        if (preview.modes !== undefined) declarations(preview.modes, '$.ui.preview.modes', (mode, at) => {
          shape(mode, ['id','label'], undefined, at)
          check(text(mode.label,80), at + '.label')
        }, 8)
      }
    }
    if (value.i18n !== undefined) {
      shape(value.i18n, ['defaultLocale','messages'], undefined, '$.i18n')
      const {defaultLocale,messages} = value.i18n
      check(messages && typeof messages === 'object' && !Array.isArray(messages), '$.i18n.messages')
      check(Object.keys(messages).length <= 8 && Object.hasOwn(messages,defaultLocale), '$.i18n.defaultLocale')
      for (const [locale, dictionary] of Object.entries(messages)) {
        check(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale), '$.i18n.messages.' + locale)
        check(dictionary && typeof dictionary === 'object' && !Array.isArray(dictionary) && Object.keys(dictionary).length <= 256, '$.i18n.messages.' + locale)
        for (const [id, translation] of Object.entries(dictionary)) check(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(id) && text(translation,240), '$.i18n.messages.' + locale + '.' + id)
      }
      const visit = (item, at) => {
        if (!item || typeof item !== 'object') return
        for (const [id, child] of Object.entries(item)) {
          if (['label','title','help','summary','placeholder'].includes(id) && typeof child === 'string') {
            for (const [locale, dictionary] of Object.entries(messages)) if (Object.hasOwn(dictionary,child) && ['help','summary'].includes(id)) check(modHelp(dictionary[child]), '$.i18n.messages.' + locale + '.' + child, 'Expected one-sentence translation')
          } else visit(child, at + '.' + id)
        }
      }
      visit({summary:value.summary,settingsSchema:value.settingsSchema,packSchema:value.packSchema,assetKinds:value.assetKinds,ui:value.ui,uiPages:value.uiPages}, '$')
    }
    uniqueStrings(value.defaultPacks, '$.defaultPacks', name => typeof name === 'string')
    for (const name of value.defaultPacks) entry(name, '$.defaultPacks')
    shape(value.license, ['privateUse','notes'], ['privateUse'], '$.license')
    check(typeof value.license.privateUse === 'boolean', '$.license.privateUse')
    if (value.license.notes !== undefined) {list(value.license.notes, '$.license.notes'); check(value.license.notes.every(note => text(note,2000)), '$.license.notes')}
    validatedManifests.add(value)
    return modFreeze(value)
  } catch (error) {
    if (error.code === 'UNKNOWN_FIELD' || error.code?.startsWith('MOD_')) throw error
    throw Object.assign(new Error(error.message), {code:'MOD_API_UNSUPPORTED',path:error.path || '$'})
  }
}
