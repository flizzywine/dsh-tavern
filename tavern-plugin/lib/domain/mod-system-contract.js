import { fromJSONSchema } from 'zod'

const object = (properties, required = Object.keys(properties)) => ({type:'object',properties,required,additionalProperties:false})
const text = {type:'string',minLength:1,maxLength:240}
const id = {type:'string',pattern:'^[a-z][a-z0-9-]*(?:[.][a-z][a-z0-9-]*)+$',maxLength:128}
const version = {type:'string',pattern:'^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$'}
const stableVersion='(?:0|[1-9][0-9]*)[.](?:0|[1-9][0-9]*)[.](?:0|[1-9][0-9]*)'
export const MOD_RANGE_PATTERN='^(?:[~^]?'+stableVersion+'|>='+stableVersion+' <'+stableVersion+')$'
const range = {type:'string',pattern:MOD_RANGE_PATTERN}
const list = items => ({type:'array',items,maxItems:256})
const map = additionalProperties => ({type:'object',additionalProperties})
const policy = {enum:['error','silent','notify'],default:'notify'}
const binding = {oneOf:[object({auto:{const:true}}),object({fixed:{}}),object({ref:object({source:text,path:text})}),object({formula:{type:'string',maxLength:4096}})]}
const configValue = object({version:{type:'integer',minimum:1},values:map(binding)})
const path = {type:'string',pattern:'^[a-zA-Z0-9][a-zA-Z0-9._/-]*$',maxLength:240}
const hash = {type:'string',pattern:'^[0-9a-f]{64}$'}
const file = object({path,sha256:hash,size:{type:'integer',minimum:0}})
const schema = {type:'object'}
const promptContribution=object({
  id:{type:'string',pattern:'^[a-z][a-z0-9-]*$',maxLength:64},
  model:{enum:['foreground','director','background']},tag:{type:'string',pattern:'^[a-z][a-z0-9_-]*$',maxLength:64},
  slot:{enum:['rules.after-core','catalogue','task']},order:{type:'integer',minimum:-10000,maximum:10000},
  markdown:{type:'string',minLength:1,maxLength:16384},byteBudget:{type:'integer',minimum:1,maximum:16384},
  when:object({config:map({type:['string','number','boolean','null']}),materials:object({kinds:list(text),match:{enum:['any','all']}})},[]),
},['id','model','tag','slot','order','markdown','byteBudget','when'])
export const MOD_HOST_API = '1.0.0'
export const modSystemSchemas = {
  manifest: object({
    format:{const:'dsh-mod'},schemaVersion:{const:4},id,name:text,summary:text,experimental:{type:'boolean'},packageName:text,version,hostApi:range,
    dependencies:list(object({id,range,optional:{type:'boolean',default:false},onMissing:policy,operations:list(text)},['id','range'])),
    api:object({operations:list(text),resource:{const:'instance-exclusive'}}),
    config:object({version:{type:'integer',minimum:1},schema,defaults:map({})}),
    preferences:object({schema,defaults:map({})}),dataVersion:{type:'integer',minimum:1},
    assetKinds:list(object({id:text,label:text,schemaVersion:{type:'integer',minimum:1},directorSelectable:{type:'boolean'},schema},['id','schemaVersion','directorSelectable','schema'])),
    coreAssets:list(object({id:text,path})),permissions:list({enum:['stage.state','stage.presentation','source.dialogue','models.audience','models.memory']}),
    conflicts:list(object({id,range})),entry:path,prompts:list(promptContribution),
    // every stage performance kind the mod places, each with its required hold, regions, backlog and replay
    // declarations; [] when it places none. The field rules live in stage-performance-kinds.cjs (one validator, run first).
    performances:list({type:'object',properties:{kind:text,autoHold:{type:'object'},regions:{type:'array'},backlog:{type:'object'},replay:{type:'object'},blocking:{type:'boolean'}},required:['kind','autoHold','regions','backlog','replay'],additionalProperties:false}),
    // a call view the mod draws over the stage - how each party's
    // head sits in its box ([centre x, top, height] as fractions of the box) and what stands behind the remote party.
    callVideo:object({backdrop:{enum:['stage','avatar','none']},
      remote:object({head:{type:'array',items:{type:'number',minimum:0,maximum:1},minItems:3,maxItems:3}}),
      self:object({head:{type:'array',items:{type:'number',minimum:0,maximum:1},minItems:3,maxItems:3}})}),
  },['format','schemaVersion','id','name','packageName','version','hostApi','dependencies','config','preferences','dataVersion','coreAssets','permissions','entry','performances']),
  card:object({version:{const:2},mods:map({enum:['on','off']}),packs:map({enum:['on','off']}),config:map(configValue)}),
  global:object({version:{const:1},mods:map({type:'boolean'}),packs:map({type:'boolean'}),config:map(configValue),preferences:map(map({}))}),
  package:object({format:{const:'dsh-mod-package'},formatVersion:{const:1},manifest:path,files:list(file)}),
  lock:object({lockVersion:{const:2},hostApi:version,
    mods:map(object({packageName:text,version,sha256:hash,files:list(file),dependencies:list(id)})),
    packs:map(object({contentHash:hash,files:{type:'array',items:file,maxItems:50000}}))}),
  archive:object({format:{const:'dshcard'},formatVersion:{const:2},card:object({title:text,version:text},['title']),
    requires:object({modHostApi:range,features:{type:'array',items:{enum:['managed-mods/1','mod-lock/2','mod-dependencies/1']},minItems:3,maxItems:3,uniqueItems:true}}),lock:{const:'dsh-lock.json'},
    plugins:list(object({name:text,path,purpose:text},['name','path'])),
    packs:list(object({id:text,path,contentHash:hash,format:text},['id','path','contentHash']))}),
}
for (const [name, value] of Object.entries(modSystemSchemas)) {
  value.$schema = 'https://json-schema.org/draft/2020-12/schema'
  value.$id = `https://dsh-tavern.org/schemas/mod-system/${name}-${name==='manifest'?4:['card','lock'].includes(name)?2:1}.json`
}
const validators = new Map()
export function assertSchema(schema, value) {
  let validator = validators.get(schema)
  if (!validator) { validator = fromJSONSchema(schema); validators.set(schema,validator) }
  const result = validator.safeParse(value)
  if (!result.success) throw Object.assign(new Error(result.error.message),{code:'MOD_INVALID'})
  return value
}
export const validateModSystem = (type, value) => assertSchema(modSystemSchemas[type], value)
export const emptyCardMods = () => ({version:2,mods:{},packs:{},config:{}})
export const emptyGlobalMods = () => ({version:1,mods:{},packs:{},config:{},preferences:{}})
export function modError(code, message, details) { return Object.assign(new Error(message),{code,details}) }
