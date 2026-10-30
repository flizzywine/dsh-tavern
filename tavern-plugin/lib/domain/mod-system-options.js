import {assertSchema,modError} from './mod-system-contract.js'
import {resolveSwitch} from './mod-system.js'

// The existing config declaration owns option types and presets. Preferences are
// deliberately separate; migrating a preference into an option is a data cutover.
export function modOptionSchema(manifest) {
  return manifest.config.schema.properties || {}
}

export function resolveModOptionSwitch({installed,authorized,globalOn,cardValue,skinEnabled}) {
  return installed===true && authorized===true && resolveSwitch(globalOn,cardValue,skinEnabled)
}

// Inputs are accepted option values, not bindings. Resolve ref/formula bindings at
// the existing config boundary before calling this projection. No validation here.
export function resolveModOptions({manifest,skin={},global={},card={},assetAvailable=()=>true}) {
  const values={},options={}
  for(const [key,schema] of Object.entries(modOptionSchema(manifest))) {
    let value=manifest.config.defaults[key],source='preset',locked=false
    const hasSkin=Object.hasOwn(skin.options || {},key)
    if(hasSkin) {value=skin.options[key];source='skin'}
    if(schema.userAdjustable!==false) {
      if(Object.hasOwn(global,key)){value=global[key];source='global'}
      if(Object.hasOwn(card,key)){value=card[key];source='card'}
    }
    if(hasSkin && skin.locks?.includes(key)) {value=skin.options[key];source='skin';locked=true}
    // Availability is not schema validation: installed skin media can disappear.
    if(schema['x-skin-asset'] && value!=='' && !assetAvailable(value)) {
      value=manifest.config.defaults[key];source='preset'
    }
    values[key]=structuredClone(value)
    options[key]={value:values[key],source,locked,userAdjustable:schema.userAdjustable!==false}
  }
  return {values,options}
}

// Only install/write callers invoke this. Unknown mods/options and unavailable
// media are dropped individually, so optional presentation never blocks a skin.
export function validateSkinModOptions(mods,{manifests,assets={}}) {
  if(mods==null)return {mods:{},notices:[]}
  if(typeof mods!=='object' || Array.isArray(mods))throw modError('MOD_INVALID','Skin mods must be an object')
  const installed=new Map(manifests.map(manifest=>[manifest.id,manifest])),result={},notices=[]
  const skip=(modId,key,reason)=>notices.push({modId,...(key?{key}:{}),reason})
  for(const [modId,input] of Object.entries(mods)) {
    const manifest=installed.get(modId)
    if(!manifest){skip(modId,null,'missing-mod');continue}
    if(!input || typeof input!=='object' || Array.isArray(input))throw modError('MOD_INVALID','Skin mod settings must be an object',{modId})
    if(input.enabled!==undefined && typeof input.enabled!=='boolean')throw modError('MOD_INVALID','Skin mod enabled must be boolean',{modId})
    if(input.options!==undefined && (!input.options || typeof input.options!=='object' || Array.isArray(input.options)))throw modError('MOD_INVALID','Skin mod options must be an object',{modId})
    if(input.locks!==undefined && (!Array.isArray(input.locks) || input.locks.some(key=>typeof key!=='string')))throw modError('MOD_INVALID','Skin mod locks must be option names',{modId})
    const options={},schemas=modOptionSchema(manifest)
    for(const [key,value] of Object.entries(input.options || {})) {
      const schema=Object.hasOwn(schemas,key)?schemas[key]:null
      if(!schema){skip(modId,key,'unknown-option');continue}
      try {assertSchema(schema,value)} catch {skip(modId,key,'invalid-value');continue}
      if(schema['x-skin-asset'] && value!=='' && !Object.hasOwn(assets,value)){skip(modId,key,'missing-asset');continue}
      Object.defineProperty(options,key,{value:structuredClone(value),enumerable:true,writable:true,configurable:true})
    }
    const locks=[...new Set(input.locks || [])].filter(key=>Object.hasOwn(options,key))
    Object.defineProperty(result,modId,{value:{...(input.enabled!==undefined?{enabled:input.enabled}:{}),options,locks},enumerable:true,writable:true,configurable:true})
  }
  return {mods:result,notices}
}

export function validateUserModOptions(manifest,values) {
  const schemas=modOptionSchema(manifest)
  for(const [key,value] of Object.entries(values)) {
    const schema=Object.hasOwn(schemas,key)?schemas[key]:null
    if(!schema || schema.userAdjustable===false)throw modError('MOD_INVALID','This mod option is not player-adjustable',{modId:manifest.id,key})
    assertSchema(schema,value)
  }
  return values
}
