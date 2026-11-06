// feature-neutral card variable binding infrastructure.
import YAML from 'yaml'
import {normalizeVariableFormat} from './formats.js'
export {normalizeVariableFormat,variableGuessHints} from './formats.js'
import { check, shape, array, unique, assertJson } from '../../../packages/dsh-presentation-protocol/src/asset-pack-json.js'

const safe = key => !['__proto__','constructor','prototype','*'].includes(key) && !/^(?:\$|__)/.test(key) && !/[\x00-\x1f]|\{\{|\}\}/.test(key)
const pointer = parts => '/' + parts.map(key => key.replace(/~/g,'~0').replace(/\//g,'~1')).join('/')
const dataOf = raw => raw?.data || raw
const typeOf = value => Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
export const emptyCardVariableBindings = () => ({version:1,entries:[]})
export const variableTargetKey = target => JSON.stringify([target.kind,target.kind === 'mods' ? target.modId : target.ref ? [target.ref.packId,target.ref.kind,target.ref.assetId] : null,target.slot])
export function variablePointer(path) {
  check(typeof path === 'string' && path.startsWith('/') && Buffer.byteLength(path) <= 256,'$.variable.path')
  const parts = path.slice(1).split('/').map(part => {
    check(!/~[^01]|~$/.test(part),'$.variable.path')
    return part.replace(/~1/g,'/').replace(/~0/g,'~')
  })
  check(parts.length <= 8 && parts.every(part => safe(part) && part !== '-' && !/[\[\]]/.test(part)),'$.variable.path')
  return parts
}
export function validateVariableTarget(target) {
  shape(target,['kind','ref','slot','modId'],['kind','slot'],'$.target')
  if (target.kind === 'mods') check(typeof target.modId === 'string' && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(target.modId) && target.ref === undefined,'$.target.modId')
  else check(target.modId === undefined,'$.target.modId')
  check(typeof target.kind === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(target.kind),'$.target.kind')
  check(typeof target.slot === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(target.slot),'$.target.slot')
  if (target.ref !== undefined) {
    shape(target.ref,['packId','kind','assetId'],['packId','kind','assetId'],'$.target.ref')
    check(Object.values(target.ref).every(value => typeof value === 'string' && value.length > 0 && value.length <= 128),'$.target.ref')
  }
}
export function validateCardVariableBindings(value) {
  assertJson(value,{maxBytes:32768})
  shape(value,['version','entries'],['version','entries'],'$.variableBindings')
  check(value.version === 1,'$.variableBindings.version')
  array(value.entries,'$.variableBindings.entries',64)
  for (const row of value.entries) {
    shape(row,['target','variable'],['target','variable'],'$.variableBindings.entries[]')
    validateVariableTarget(row.target)
    shape(row.variable,['source','path','fields'],['source','path'],'$.variable')
    check(['mvu','helper-chat'].includes(row.variable.source),'$.variable.source')
    variablePointer(row.variable.path)
    if (row.variable.fields !== undefined) {
      check(row.variable.fields && typeof row.variable.fields === 'object' && !Array.isArray(row.variable.fields),'$.variable.fields')
      check(Object.keys(row.variable.fields).length <= 32,'$.variable.fields')
      for (const [key,path] of Object.entries(row.variable.fields)) { check(safe(key),'$.variable.fields'); variablePointer(path) }
    }
  }
  unique(value.entries.map(row => variableTargetKey(row.target)),'$.variableBindings.entries')
  return value
}
const mvuTuple = value => Array.isArray(value) && value.length === 2 && typeof value[1] === 'string'
export const unwrapMvu = value => mvuTuple(value) ? value[0] : value
const at = (value,path,unwrap = value => value) => {
  for (const part of variablePointer(path)) {
    value = unwrap(value)
    if (!safe(part) || !value || typeof value !== 'object' || !Object.hasOwn(value,part)) return {status:'missing'}
    value = value[part]
  }
  return {status:'ready',value:unwrap(value)}
}
export function resolveVariable(variable,sources) {
  const source = sources[variable.source]
  if (!source?.available) return {status:'unavailable'}
  const result = at(source.value,variable.path,variable.source === 'mvu' ? unwrapMvu : undefined)
  if (result.status !== 'ready') return result
  let nodes = 0
  const bounded = (value,depth=0) => {
    if (++nodes > 2048 || depth > 12) throw Error('too-large')
    if (Array.isArray(value)) return value.map(item => bounded(item,depth+1))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key])=>safe(key)).map(([key,item])=>[key,bounded(item,depth+1)]))
    return value
  }
  try {
    result.value = bounded(result.value)
    if (Buffer.byteLength(JSON.stringify(result.value)) > 8192) return {status:'too-large'}
    if (variable.fields) {
      if (!Array.isArray(result.value)) return {status:'type-mismatch'}
      result.value = result.value.map(row => Object.fromEntries(Object.entries(variable.fields).map(([key,path]) => [key,at(row,path).value])))
    }
    return result
  } catch { return {status:'too-large'} }
}

export function analyzeVariableSchema(raw) {
  const data = dataOf(raw), candidates = new Map()
  let nodes = 0
  function walk(value,parts=[]) {
    if (++nodes > 8192 || parts.length >= 8 || !value || typeof value !== 'object' || Array.isArray(value)) return
    const schema = value.properties && typeof value.properties === 'object'
    for (const [key,child] of Object.entries(schema ? value.properties : value)) {
      if (!safe(key)) continue
      const next = [...parts,key], path = pointer(next)
      if (Buffer.byteLength(path) > 256 || /[\[\]]/.test(path)) continue
      const item=unwrapMvu(child)
      candidates.set(path,{path,parts:next,valueType:schema ? child?.type : typeOf(item),...(!schema?{value:item}:child?.items?.properties?{recordFields:Object.fromEntries(Object.entries(child.items.properties).map(([key,value])=>[key,value.type]))}:{})})
      walk(item,next)
    }
  }
  function parse(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 262144 || /<%|\$\{|\b(?:eval|function|z\.object)\s*\(/.test(text)) return
    const source = text.trim().replace(/^```(?:json|yaml|yml)?\s*\n/i,'').replace(/\n```\s*$/,'')
    try { const value = YAML.parse(source,{maxAliasCount:0}); walk(value?.stat_data || value) } catch { /* Only static data is eligible. */ }
  }
  for (const entry of Object.values(data?.character_book?.entries || {}).slice(0,512)) {
    const content = entry.content || '', blocks = [...content.matchAll(/<initvar>\s*([\s\S]*?)\s*<\/initvar>/gi)]
    for (const match of blocks) parse(match[1])
    if (!blocks.length && /initvar|初始变量|变量初始化/i.test(entry.comment || entry.name || '')) parse(content)
    if (/"properties"\s*:/.test(content)) parse(content)
  }
  for (const text of [data?.first_mes,...(data?.alternate_greetings || [])]) if (typeof text === 'string') {
    for (const match of text.matchAll(/<initvar>\s*([\s\S]*?)\s*<\/initvar>/gi)) parse(match[1])
  }
  return [...candidates.values()]
}
export function analyzeVariableValues(value,source='mvu') {
  const candidates=[];let nodes=0
  function walk(item,parts=[]) {
    if (++nodes>8192 || parts.length>8)return
    const description=source==='mvu' && mvuTuple(item)?item[1]:undefined
    if(source==='mvu')item=unwrapMvu(item)
    if(parts.length) {
      const path=pointer(parts)
      if(Buffer.byteLength(path)>256)return
      candidates.push({source,path,parts,valueType:typeOf(item),value:item,...(description===undefined?{}:{description})})
    }
    if(item && typeof item==='object')for(const [key,child] of Object.entries(item)) {
      if(nodes>8192)break
      if(safe(key) && !/[\[\]]/.test(key))walk(child,[...parts,key])
    }
  }
  walk(value);return candidates
}
export function guessVariables(schema,slot,sources={},recent=[]) {
  const hints=slot.guessHints || {}, keywords=(hints.keywords || []).map(word=>word.toLowerCase())
  const live=sources.mvu?.available?analyzeVariableValues(sources.mvu.value):[]
  const candidates=live.length?live:schema
  return candidates.flatMap(candidate=>{
    const leaf=candidate.parts.at(-1).toLowerCase(), parents=candidate.parts.slice(0,-1)
    const exact=keywords.includes(leaf), partial=keywords.some(word=>word.length>1 && leaf.includes(word))
    const parentMatch=parents.some(part=>keywords.includes(part.toLowerCase()))
    if(!exact && !partial && !parentMatch)return []
    const shape=hints.format?normalizeVariableFormat(candidate.value,hints.format):null
    if(candidate.valueType!==slot.valueType && !shape)return []
    if(live.length && resolveVariable({source:'mvu',path:candidate.path},sources).status!=='ready')return []
    const preferred=parents.some(part=>hints.preferredParents?.some(parent=>parent.toLowerCase()===part.toLowerCase()))
    const reasons=[], add=(reason,points)=>{reasons.push({reason,points});return points}
    let score=add(exact?'key-exact':partial?'key-partial':'parent-key',exact?45:partial?28:12)
    if(preferred)score+=add('context',12)
    score+=add('depth',Math.max(0,10-(candidate.parts.length-1)*2))
    if(hints.format)score+=add(shape?'value-shape':'value-shape-mismatch',shape?30:-45)
    else score+=add('value-type',15)
    if(/出生|誕生|birthday|cooldown|冷却|冷卻|duration|持续|持續|上次|previous/i.test(candidate.path))score+=add('historical-or-duration',-35)
    if(shape && recent.length) {
      const samples=recent.slice(-6).map(value=>resolveVariable({source:'mvu',path:candidate.path},{mvu:{available:true,value}})).map(row=>normalizeVariableFormat(row.value,hints.format))
      samples.push(shape)
      const present=samples.filter(Boolean)
      let plausible=0,total=0
      for(let i=1;i<present.length;i++) {
        let delta=present[i].ordinal-present[i-1].ordinal
        if(hints.format==='time' && delta<0 && present[i-1].ordinal>=1080 && present[i].ordinal<=360)delta+=1440
        if(hints.format==='weekday' && delta<0)delta+=7
        total++;if(delta>=0 && delta<=(hints.format==='time'?360:7))plausible++
      }
      if(total)score+=add('recent-stability',Math.round(8*(plausible/total)-12*(1-plausible/total)))
      if(present.length<samples.length)score+=add('recent-missing',-8)
    }
    return [{variable:{source:candidate.source || 'mvu',path:candidate.path},...(Object.hasOwn(candidate,'value')?{value:shape?shape.value:candidate.value}:{}),score:Math.max(0,Math.min(100,score)),reasons}]
  }).sort((a,b)=>b.score-a.score || a.variable.path.split('/').length-b.variable.path.split('/').length || (a.variable.path<b.variable.path?-1:1)).slice(0,16)
}
export function resolveSlot(slot,bindings,schema,sources) {
  const candidates = slot.candidates ? slot.candidates(schema) : guessVariables(schema,slot,sources,sources.mvu?.recent || [])
  const author = bindings?.entries.find(row => variableTargetKey(row.target) === variableTargetKey(slot.target))
  const guessed=(!slot.uniqueAuto || candidates.length===1) && candidates[0]?.score >= (slot.guessHints?.threshold ?? 65) ? candidates[0] : null
  const variable = author?.variable || guessed?.variable || null
  const result = variable ? resolveVariable(variable,sources) : {status:'ready',value:slot.default}
  let status = result.status, value = slot.default
  if (status === 'ready') {
    if (slot.guessHints?.format && variable) {
      const normalized=normalizeVariableFormat(result.value,slot.guessHints.format)
      if(normalized)value=normalized.value
      else status='type-mismatch'
    }
    else if (slot.normalize) ({value,status} = slot.normalize(result.value))
    else if (typeOf(result.value) !== slot.valueType) status = 'type-mismatch'
    else if (slot.fieldMapping && variable?.fields && result.value.some(row => Object.entries(slot.fieldMapping).some(([key,field]) => row[key] === undefined ? field.required : typeOf(row[key]) !== field.valueType))) status = 'type-mismatch'
    else value = result.value
  }
  return {target:slot.target,label:slot.label,instanceLabel:slot.instanceLabel || '',active:slot.active === true,valueType:slot.valueType,default:slot.default,fieldMapping:slot.fieldMapping || null,guessHints:slot.guessHints || null,
    value,status,source:author?'author':variable?'auto':'default',variable,candidates}
}
export function createVariableBindingRegistry() {
  const providers = new Map()
  return {
    register(provider) {
      check(!providers.has(provider.id) && /^[a-z][a-z0-9-]{0,47}$/.test(provider.id) && typeof provider.slots === 'function','$.provider')
      providers.set(provider.id,provider)
      return () => providers.delete(provider.id)
    },
    slots(context) { return [...providers.values()].flatMap(provider => provider.slots(context)) },
    validateSlots(bindings,context,previous) {
      const slots = this.slots(context)
      for (const row of bindings.entries) {
        if (previous?.entries.some(old => variableTargetKey(old.target) === variableTargetKey(row.target) && JSON.stringify(old.variable) === JSON.stringify(row.variable))) continue
        const slot = slots.find(slot => variableTargetKey(slot.target) === variableTargetKey(row.target))
        check(!!slot,'$.target','Slot unavailable','ASSET_UNAVAILABLE')
        if (row.variable.fields) {
          check(!!slot.fieldMapping,'$.variable.fields')
          for (const key of Object.keys(row.variable.fields)) check(Object.hasOwn(slot.fieldMapping,key),'$.variable.fields')
          for (const [key,field] of Object.entries(slot.fieldMapping)) check(!field.required || Object.hasOwn(row.variable.fields,key),'$.variable.fields')
        }
      }
    },
    list({raw,context,sources={}}) {
      const schema = analyzeVariableSchema(raw), bindings = dataOf(raw)?.extensions?.dsh_tavern?.variableBindings
      return [...providers.values()].filter(provider=>!context?.modConfig || provider.id !== 'mods').map(provider => ({id:provider.id,label:provider.label,slots:provider.slots(context).map(slot => resolveSlot(slot,bindings,schema,sources))})).filter(provider => provider.slots.length)
    },
  }
}
