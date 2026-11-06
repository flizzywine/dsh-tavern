import {normalizeGameSettings,coerceSetting} from './plugin-game-settings.js'
import {createModConfigService,validateConfigValue} from './mods/config.js'
import {modError} from './mod-system-contract.js'
import {parseFormula} from './mods/config-formula.js'

// One portable declaration projects onto upstream gameSettings and the existing binding resolver.
export function managedConfigFields(manifest) {
  const fields=Object.entries(manifest.config.schema.properties || {}).map(([key,schema])=>({
    key,type:schema.enum?'select':schema.type==='string'?'text':schema.type==='integer'?'number':Array.isArray(schema.type)?schema.type.find(type=>type!=='null'):schema.type,label:key,nullable:Array.isArray(schema.type) && schema.type.includes('null'),
    ...(schema.enum?{options:schema.enum}:{}),...(schema.minimum!==undefined?{min:schema.minimum}:{}),
    ...(schema.maximum!==undefined?{max:schema.maximum}:{}),...(schema.maxLength?{maxLength:schema.maxLength}:{}),default:manifest.config.defaults[key],
  }))
  if(!fields.length)return {title:manifest.name,fields:[]}
  // Structured references/mappings use the existing config owner's object/array editors, not text coercion.
  const structured=field=>['object','array'].includes(field.type)
  try {
    const normalized=normalizeGameSettings({title:manifest.name,fields:fields.map(field=>structured(field)?{...field,type:'text',default:''}:field)})
    return {title:normalized.title,fields:fields.map((field,index)=>structured(field)?field:normalized.fields[index])}
  } catch(error){throw modError('MOD_INVALID',error.message,{id:manifest.id,fieldTypes:fields.map(f=>({key:f.key,type:f.type}))})}
}
function bindingField(field) {
  return {key:field.key,label:field.label,valueType:field.type==='text'||field.type==='select'?'string':field.type,
    default:field.default,nullable:field.nullable,scope:'default+card',min:field.min,max:field.max,maxLength:field.maxLength,
    ...(field.options?{choices:field.options.map(o=>o.value)}:{})}
}
export function fixedConfigValues(manifest,shared={},local={}) {
  const declaration=managedConfigFields(manifest),known=new Map(declaration.fields.map(f=>[f.key,f])),selected={...shared,...local},values={...manifest.config.defaults}
  for(const [key,entry] of Object.entries(selected)) {
    const field=known.get(key)
    if(!field)throw modError('MOD_INVALID','Unknown portable configuration key: '+key)
    validateConfigValue(entry,bindingField(field))
    if(entry.auto===true)values[key]=field.default
    else if(Object.hasOwn(entry,'fixed')) {
      const value=['object','array'].includes(field.type)?structuredClone(entry.fixed):coerceSetting(field,entry.fixed)
      if(value===undefined)throw modError('MOD_INVALID','Invalid configuration value: '+key)
      values[key]=value
    } else throw modError('MOD_CONFIG_SNAPSHOT','Resolve variable/formula bindings before beginning the request',{id:manifest.id,key})
  }
  return values
}
export function validateManagedConfigValues(manifest,values) {
  const fields=new Map(managedConfigFields(manifest).fields.map(field=>[field.key,bindingField(field)]))
  for(const [key,entry] of Object.entries(values)) {
    if(!fields.has(key))throw modError('MOD_INVALID','Unknown configuration key: '+key)
    validateConfigValue(entry,fields.get(key))
    const refs=[]
    const collect=node=>{if(!node || typeof node!=='object')return;if(node.type==='ref')refs.push(node);for(const value of Object.values(node))if(value && typeof value==='object')Array.isArray(value)?value.forEach(collect):collect(value)}
    if(entry.ref)refs.push(entry.ref)
    if(entry.formula)collect(parseFormula(entry.formula).ast)
    for(const ref of refs)if(ref.source.startsWith('mod:') && ref.source.slice(4)!==manifest.id && !manifest.dependencies.some(d=>d.id===ref.source.slice(4)))throw modError('MOD_PERMISSION','Cross-module config sources require a declared dependency')
  }
  return values
}
export async function boundConfigValues(manifest,shared,local,{sources,context={},manifests=[manifest],globalValues={},cardValues={}}) {
  const declaration=managedConfigFields(manifest),schema={fields:declaration.fields.map(bindingField)},notices=[]
  validateManagedConfigValues(manifest,{...shared,...local})
  const schemas=Object.fromEntries(manifests.map(m=>[m.id,{fields:managedConfigFields(m).fields.map(bindingField)}]))
  const service=createModConfigService({schemas,store:{read:async({modId})=>({revision:'snapshot',global:modId===manifest.id?shared:globalValues[modId]?.values || {},card:modId===manifest.id?local:cardValues[modId]?.values || {}})},sources})
  const result=await service.get({...context,modId:manifest.id}),values={}
  for(const field of schema.fields) {
    const resolved=result.resolved[field.key]
    values[field.key]=resolved.error?field.default:resolved.value
    if(resolved.error)notices.push({key:field.key,...resolved.error,fallback:field.default})
  }
  return {values,notices}
}
