import directorCommands from '../../../packages/dsh-presentation-protocol/src/director-commands.cjs'
import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import widgetContract from '../../../src/client/widget-contracts.cjs'
import {ASSET_KINDS} from '../../../packages/dsh-presentation-protocol/src/asset-packs.js'
import {validateModSettingsSchema} from './settings.js'
const {modCheck: check, modShape: shape, modPlacement, modSafeKey: key} = contract
const {stageWidgetSchemaValid} = widgetContract
const modId = value => typeof value === 'string' && value.length <= 128 && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(value)
const version = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
const text = (value, max = 240) => typeof value === 'string' && value.length > 0 && value.length <= max
const path = value => typeof value === 'string' && value.length <= 240 && value.split('/').every(part => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) && !part.endsWith('.'))
function list(value, at, max = 64) { check(Array.isArray(value) && value.length <= max, at, 'Expected bounded list') }
function uniqueStrings(value, at, valid = key, max = 64) {
  list(value, at, max)
  check(value.every(valid) && new Set(value).size === value.length, at, 'Invalid or duplicate identifiers')
}
function declarations(value, at, validate) {
  list(value, at)
  const seen = new Set()
  for (const row of value) {
    check(row && key(row.id) && !seen.has(row.id), at, 'Duplicate or invalid declaration ID')
    seen.add(row.id)
    validate(row, at + '.' + row.id)
  }
}
// A manifest's director declarations: what its commands, director rules, settings page, lamp admission, model slots
// and the capabilities it publishes for core uses (mods/interop.js) are. They are optional; absent means empty.
export function modDeclarations(manifest) {
  return {...manifest, commands:manifest.commands || [], commandPrompts:manifest.commandPrompts || [],
    settingsSchema:manifest.settingsSchema || {fields:[],sections:[]}, admission:manifest.admission || {entryKinds:[]},
    modelSlots:manifest.modelSlots || [], provides:manifest.provides || []}
}

// Runs once with the manifest schema (validateDistributionManifest), when a manifest enters.
export function validateModDeclarations(manifest) {
  const value = modDeclarations(manifest)
  const providedIds = new Set()
  for (const provided of value.provides) {
    const at = '$.provides'
    shape(provided, ['id','version','contract','operations','resource','handler'], ['id','version','contract','operations','handler'], at)
    check(modId(provided.id) && !providedIds.has(provided.id) && version(provided.version), at, 'Invalid or duplicate capability')
    providedIds.add(provided.id)
    check(text(provided.contract,80) && /^[a-z][a-z0-9.-]*\/[1-9][0-9]*$/.test(provided.contract) && key(provided.handler), at)
    uniqueStrings(provided.operations, at + '.operations')
    check(provided.operations.length > 0, at + '.operations')
    if (provided.resource) {
      shape(provided.resource, ['scope','key','policy'], undefined, at + '.resource')
      check(provided.resource.scope === 'chat-branch' && /^[a-z][a-z0-9.-]*\/[a-z][a-z0-9.-]*$/.test(provided.resource.key), at + '.resource')
      check(['exclusive','overlay-with-base','observe'].includes(provided.resource.policy), at + '.resource.policy')
    }
  }
  uniqueStrings(value.admission.entryKinds, '$.admission.entryKinds', kind => ASSET_KINDS.includes(kind) || kind === 'props')
  declarations(value.modelSlots, '$.modelSlots', (slot, at) => {
    shape(slot, ['id','label','purpose','fallback','kind','reasoning'], ['id','label','purpose','fallback'], at)
    check(slot.reasoning === undefined || text(slot.reasoning,32), at + '.reasoning')
    check(text(slot.label,80) && text(slot.purpose) && ['background','foreground'].includes(slot.fallback), at)
    check(slot.kind === undefined || ['chat','scoring'].includes(slot.kind), at + '.kind')
  })
  declarations(value.commandPrompts, '$.commandPrompts', (prompt, at) => {
    shape(prompt, ['id','path','placement'], undefined, at)
    check(path(prompt.path) && prompt.path.endsWith('.txt'), at + '.path', 'Use a relative .txt path inside the mod folder')
    modPlacement(prompt.placement, 'director', at + '.placement')
  })
  const ops = new Set(), verbs = new Set()
  declarations(value.commands, '$.commands', (command, at) => {
    shape(command, ['id','op','dsl','params','persistence','handler','promptId','placement','caps','paramsStyle','replaces','mode','resourceUse'], ['mode','id','op','dsl','params','persistence','handler','promptId','placement','caps'], at)
    if (command.resourceUse !== undefined) {
      shape(command.resourceUse, ['capability','access'], undefined, at + '.resourceUse')
      check(providedIds.has(command.resourceUse.capability) && ['control','observe'].includes(command.resourceUse.access), at + '.resourceUse')
    }
    check(command.paramsStyle === undefined || command.paramsStyle === 'flat', at + '.paramsStyle')
    check(command.mode === 'adds' ? command.replaces === undefined : command.mode === 'replaces' && typeof command.replaces === 'string' && Object.hasOwn(directorCommands.byName,command.replaces), at + '.replaces', 'Use adds without a target, or replaces with one canonical core operation')
    check(typeof command.op === 'string' && /^(?:mod\.)?[a-z][a-z0-9.-]{1,191}$/.test(command.op) && !ops.has(command.op), at + '.op', 'Duplicate or invalid op')
    ops.add(command.op)
    shape(command.dsl, ['verb','syntax','positional','flags'], ['verb','syntax'], at + '.dsl')
    if (command.dsl.positional !== undefined) check(key(command.dsl.positional) && command.params.properties?.[command.dsl.positional], at + '.dsl.positional')
    if (command.dsl.flags !== undefined) uniqueStrings(command.dsl.flags, at + '.dsl.flags', name => key(name) && command.params.properties?.[name]?.type === 'boolean')
    check(key(command.dsl.verb) && !verbs.has(command.dsl.verb) && text(command.dsl.syntax,1024), at + '.dsl', 'Duplicate or invalid DSL verb')
    verbs.add(command.dsl.verb)
    check(stageWidgetSchemaValid(command.params), at + '.params', 'Unsupported parameter schema')
    check(['event','state','marker'].includes(command.persistence) && key(command.handler), at)
    check(value.commandPrompts.some(prompt => prompt.id === command.promptId), at + '.promptId', 'Declare the command rule in commandPrompts')
    modPlacement(command.placement, 'director', at + '.placement')
    shape(command.caps, ['perTurn','bytes','group'], ['perTurn','bytes'], at + '.caps')
    if (command.caps.group !== undefined) check(key(command.caps.group), at + '.caps.group')
    check(Number.isSafeInteger(command.caps.perTurn) && command.caps.perTurn >= 1 && command.caps.perTurn <= 256 && Number.isSafeInteger(command.caps.bytes) && command.caps.bytes >= 1 && command.caps.bytes <= 16384, at + '.caps')
  })
  validateModSettingsSchema(value.settingsSchema, '$.settingsSchema', true, value.id)
  for (const field of value.settingsSchema.fields) check(!['asset-picker','sound-picker'].includes(field.type), '$.settingsSchema.fields.' + field.key + '.type', 'Mod-owned asset kinds are retired; declare an asset setting in config with x-tavern-asset')
  return manifest
}
