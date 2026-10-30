import {analyzeVariableSchema,resolveSlot,resolveVariable,variablePointer} from '../variable-bindings/index.js'
import {parseFormula,evaluateFormula} from './config-formula.js'
import {assertJson} from '../../../packages/dsh-presentation-protocol/src/asset-pack-json.js'
import {validateFigureRef} from '../../../packages/dsh-presentation-protocol/src/asset-packs.js'
import {normalizeCatalogueText} from '../asset-pack-lexical.js'
export const CONFIG_FILE_PATH=/^files\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|webp|jpg|mp3|ogg|wav)$/
const own=(value,key)=>Object.hasOwn(value || {},key)
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})}
const problem=error=>({code:error.code || 'CONFIG_TYPE',message:error.message,...(error.position===undefined?{}:{position:error.position})})
const type=value=>Array.isArray(value)?'array':value===null?'null':typeof value
const safe=key=>typeof key==='string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) && !['constructor','prototype','__proto__'].includes(key)
export function validateConfigValue(value,field) {
  assertJson(value,{maxBytes:32768})
  if(!value || type(value)!=='object' || Object.keys(value).length!==1)fail('UNKNOWN_FIELD','Choose exactly one of auto, fixed, ref or formula')
  const kind=Object.keys(value)[0]
  if(field.fixedOnly && !['auto','fixed'].includes(kind))fail('CONFIG_TYPE','This field accepts a fixed value or its default')
  if(field.figureRef && kind==='fixed' && value.fixed!==null)validateFigureRef(value.fixed)
  if(kind==='auto') {if(value.auto!==true)fail('CONFIG_TYPE','auto must be true')}
  else if(kind==='fixed')checkValue(value.fixed,field)
  else if(kind==='ref') {
    const ref=value.ref
    if(!ref || Object.keys(ref).some(key=>!['source','path','fields'].includes(key)))fail('UNKNOWN_FIELD','Unknown reference field')
    if(!/^(mvu|ledger|helper-chat|stage|mod:[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)$/.test(ref.source))fail('UNKNOWN_FIELD','Unknown reference source')
    variablePointer(ref.path)
    if(ref.fields) {
      if(!field.fieldMapping || type(ref.fields)!=='object')fail('CONFIG_TYPE','This field does not accept record mapping')
      for(const [key,path] of Object.entries(ref.fields)){if(!own(field.fieldMapping,key))fail('UNKNOWN_FIELD','Unknown record field: '+key);variablePointer(path)}
      for(const [key,child] of Object.entries(field.fieldMapping))if(child.required && !own(ref.fields,key))fail('CONFIG_TYPE','Missing record field: '+key)
    }
  } else if(kind==='formula') {const result=parseFormula(value.formula);if(result.error)throw Object.assign(new Error(result.error.message),result.error)}
  else fail('UNKNOWN_FIELD','Unknown value kind: '+kind)
  return value
}
// An image set is [{file, name?, default?:true, anchor?:{chatId,branchId,turn,para?}}]; only story captures carry an anchor.
// of one layer, at most one marked default. A single image stored before the set ({file} or {}) still reads as a set.
export const CONFIG_IMAGES_MAX=8
const image=file=>CONFIG_FILE_PATH.test(file) && /\.(png|webp|jpg)$/.test(file)
function checkValue(value,field,clamp=false) {
  if(value===null && field.nullable===true)return value
  if(field.ui?.control==='images' && type(value)==='object' && Object.keys(value).every(key=>key==='file') && (!own(value,'file') || image(value.file)))value=own(value,'file')?[{file:value.file}]:[]
  if(value===null && field.nullable===true)return value
  if(type(value)!==field.valueType || typeof value==='number' && !Number.isFinite(value))fail('CONFIG_TYPE','Expected '+field.valueType+' for '+field.key)
  if(typeof value==='number') {
    if(clamp)value=Math.max(field.min ?? -Infinity,Math.min(field.max ?? Infinity,value))
    if(value<(field.min ?? -Infinity) || value>(field.max ?? Infinity))fail('CONFIG_TYPE','Value outside field range')
  }
  if(field.choices && !field.choices.includes(value))fail('CONFIG_TYPE','Unknown choice for '+field.key)
  if(field.maxLength && value.length>field.maxLength)fail('CONFIG_TYPE','Value too long for '+field.key)
  if(field.ui?.control==='colour' && !/^#[0-9a-f]{6}$/i.test(value))fail('CONFIG_TYPE','Expected a six-digit colour')
  if(field.ui?.control==='image' && (Object.keys(value).some(key=>key!=='file') || own(value,'file') && (!CONFIG_FILE_PATH.test(value.file) || !/\.(png|webp|jpg)$/.test(value.file))))fail('CONFIG_TYPE','Expected an uploaded image {file: path}, or {} for no image')
  if(field.ui?.choices && !field.ui.choices.some(row=>row.value===value))fail('CONFIG_TYPE','Unknown choice for '+field.key)
  if(field.ui?.control==='images') {
    const max=field.ui.maxItems ?? CONFIG_IMAGES_MAX
    if(value.length>max)fail('CONFIG_TYPE','At most '+max+' images for '+field.key)
    for(const row of value)if(type(row)!=='object' || Object.keys(row).some(key=>!['file','name','default','anchor'].includes(key)) || !image(row.file) || own(row,'name') && (typeof row.name!=='string' || row.name.length>64) || own(row,'default') && row.default!==true)fail('CONFIG_TYPE','Expected uploaded images [{file, name?, default?: true}] for '+field.key)
    for(const row of value)if(own(row,'anchor')) {
      const a=row.anchor
      if(type(a)!=='object' || Object.keys(a).some(key=>!['chatId','branchId','turn','para'].includes(key)) || own(a,'chatId') && (typeof a.chatId!=='string' || !a.chatId.trim()) || typeof a.branchId!=='string' || !a.branchId.trim() || !Number.isSafeInteger(a.turn) || a.turn<0 || own(a,'para') && (!Number.isSafeInteger(a.para) || a.para<1))fail('CONFIG_TYPE','Expected story anchor {branchId, turn, para?} for '+field.key)
    }
    if(new Set(value.map(row=>row.file)).size!==value.length || value.filter(row=>row.default).length>1)fail('CONFIG_TYPE','Images must be distinct with at most one default for '+field.key)
  }
  // A record map (phone contacts): {[id]:{<declared key>:text|image}}, each image an uploaded file of the same layer.
  if(field.records) {
    if(Object.keys(value).length>64)fail('CONFIG_TYPE','Too many records for '+field.key)
    for(const [id,row] of Object.entries(value)) {
      if(!id || id.length>128 || type(row)!=='object' || Object.keys(row).some(key=>!own(field.records,key)))fail('CONFIG_TYPE','Invalid record for '+field.key)
      for(const [key,item] of Object.entries(row)) {
        if(field.records[key]==='text' && (typeof item!=='string' || item.length>64))fail('CONFIG_TYPE','Expected a short text for '+field.key+'.'+key)
        if(field.records[key]==='image' && (type(item)!=='object' || Object.keys(item).some(name=>name!=='file') || !CONFIG_FILE_PATH.test(item.file) || !/\.(png|webp|jpg)$/.test(item.file)))fail('CONFIG_TYPE','Expected an uploaded image for '+field.key+'.'+key)
      }
    }
  }
  return value
}
export function validateConfigSchema(schema) {
  if(!schema || !Array.isArray(schema.fields) || schema.fields.length>64)fail('UNKNOWN_FIELD','Invalid config schema')
  const keys=new Set()
  for(const field of schema.fields) {
    if(!safe(field.key) || keys.has(field.key) || !['string','number','boolean','array','object'].includes(field.valueType) || !['global','card','default+card',undefined].includes(field.scope))fail('UNKNOWN_FIELD','Invalid or duplicate config key')
    if(field.ui!==undefined) {
      const ui=field.ui
      if(type(ui)!=='object' || Object.keys(ui).some(key=>!['control','choices','unit','integer','round','maxLength','maxItems'].includes(key)))fail('UNKNOWN_FIELD','Unknown UI hint')
      if(ui.control!==undefined && !['text','time','colour','choice','image','images','asset'].includes(ui.control))fail('UNKNOWN_FIELD','Unknown UI control')
      if(['image','asset'].includes(ui.control) && field.valueType!=='object' || ui.control==='images' && field.valueType!=='array' || ['text','time','colour','choice'].includes(ui.control) && field.valueType!=='string')fail('CONFIG_TYPE','Control does not match field value type')
      if(ui.control==='choice' || ui.choices!==undefined) {
        if(!Array.isArray(ui.choices) || !ui.choices.length || ui.choices.length>64 || new Set(ui.choices.map(row=>row?.value)).size!==ui.choices.length || ui.choices.some(row=>!row || typeof row.value!=='string' || typeof row.label!=='string'))fail('CONFIG_TYPE','Choices need distinct values and labels')
      }
      if(ui.unit!==undefined && (typeof ui.unit!=='string' || ui.unit.length>32) || ['integer','round'].some(key=>ui[key]!==undefined && typeof ui[key]!=='boolean'))fail('CONFIG_TYPE','Invalid UI hint')
    }
    keys.add(field.key);checkValue(field.default,field)
  }
  return schema
}

// Layer selection is separate from the single variable-binding path/type/ranking service.
export function createModConfigService({schemas,store,sources}) {
  for(const schema of Object.values(schemas))validateConfigSchema(schema)
  const guesses=new Map(),identityGuesses=new WeakMap()
  const schemaFor=id=>{if(!own(schemas,id))fail('UNKNOWN_FIELD','Unknown mod: '+id);return schemas[id]}
  const fieldFor=(id,key)=>{const field=schemaFor(id).fields.find(field=>field.key===key);if(!field)fail('UNKNOWN_FIELD','Unknown config key: '+key);return field}
  async function frame(ctx) {return {ctx,snapshots:new Map(),sources:await sources.snapshot(ctx,{deferMods:true}),stack:[]}}
  async function snapshot(id,state) {if(!state.snapshots.has(id))state.snapshots.set(id,await store.read({modId:id,cardId:state.ctx.cardId,sessionId:state.ctx.sessionId}));return state.snapshots.get(id)}
  async function reference(ref,state) {
    const provider=sources.declaration(ref.source)
    if(ref.source.startsWith('mod:')) {
      const declaration=provider?.exports.find(row=>row.path===ref.path || ref.path.startsWith(row.path+'/'))
      if(!declaration)fail('SOURCE_MISSING','Undeclared export: '+ref.source+':'+ref.path)
      if(declaration.settingKey) {
        const result=await resolveIn(ref.source.slice(4),declaration.settingKey,state)
        if(result.error)throw Object.assign(new Error(result.error.message),result.error)
        const suffix=ref.path.slice(declaration.path.length)
        if(!suffix)return result.value
        const found=resolveVariable({source:'value',path:suffix},{value:{available:true,value:result.value}})
        if(found.status!=='ready')fail('SOURCE_MISSING','Missing published setting path: '+ref.path)
        return found.value
      }
      const own=state.ctx.mods?.[ref.source.slice(4)] || {},settings={}
      for(const key of declaration.settingsKeys || []) {
        const result=await resolveIn(ref.source.slice(4),key,state)
        if(result.error)throw Object.assign(new Error(result.error.message),result.error)
        settings[key]=result.value
      }
      const value=await sources.publish(ref.source,{state:own.state,settings})
      const result=resolveVariable(ref,{[ref.source]:{available:true,value}})
      if(result.status!=='ready')fail('SOURCE_MISSING','Missing published value: '+ref.source+':'+ref.path)
      return result.value
    } else if(ref.source==='stage' && !provider?.exports.some(row=>ref.path===row.path || ref.path.startsWith(row.path+'/')))fail('SOURCE_MISSING','Undeclared stage export: '+ref.path)
    const result=resolveVariable({source:ref.source,path:ref.path},state.sources)
    if(result.status!=='ready')fail(result.status==='unavailable'?'SOURCE_UNAVAILABLE':'SOURCE_MISSING',ref.source+':'+ref.path+' ('+result.status+')')
    return result.value
  }
  async function resolveIn(id,key,state) {
    let layer='auto',kind='auto'
    const token=id+':'+key
    try {
      const field=fieldFor(id,key),data=await snapshot(id,state)
      if(state.stack.includes(token))fail('CONFIG_CYCLE','Cyclic reference: '+[...state.stack,token].join(' -> '))
      state.stack.push(token)
      try {
        let entry={auto:true}
        if(field.scope!=='global' && own(data.card,key)){layer='card';entry=data.card[key]}
        else if(field.scope!=='card' && own(data.global,key)){layer='global';entry=data.global[key]}
        kind=Object.keys(entry)[0]
        let value,autoCandidates,autoSource
        if(kind==='auto' && field.fixedOnly)value=structuredClone(field.default)
        else if(kind==='auto') {
          const selected=state.ctx.stateSource
          if(selected?.source==='ledger' && field.guessHints) {
            // The ledger has no phone clock/date fields; do not invent them or read MVU.
            return {value:structuredClone(field.default),layer,kind,autoSource:{label:'默认值（台账未记录）'}}
          }
          const source=state.sources.mvu?.available?state.sources.mvu.value:undefined
          const stateKey=state.ctx.revision===undefined?null:JSON.stringify([state.ctx.cardId,state.ctx.sessionId,state.ctx.revision])
          const cache=stateKey ? guesses.get(stateKey) || new Map() : source && typeof source==='object' ? identityGuesses.get(source) || new Map() : null
          const cacheKey=id+':'+key
          const cached=cache?.get(cacheKey)
          // MVU initialization can arrive after a revision's first config read.
          let result=field.autoRef || cached?.source!==source?null:cached?.result
          if(!result) {
            const slot={...field,target:{kind:'mods',modId:id,slot:key}}
            result=resolveSlot(slot,null,analyzeVariableSchema(state.ctx.raw),state.sources)
            if(field.autoRef) {
              const found=resolveSlot({...slot,guessHints:null},{entries:[{target:slot.target,variable:field.autoRef}]},[],state.sources)
              result.value=found.value
              result.autoSource={label:found.status==='ready' ? state.sources[field.autoRef.source]?.labels?.[field.autoRef.path] || field.autoLabel || sources.declaration(field.autoRef.source)?.exports.find(row=>row.path===field.autoRef.path)?.name || field.autoRef.source : '默认值'}
            }
            cache?.set(cacheKey,{source,result})
            if(cache && !field.autoRef) {
              if(stateKey){guesses.set(stateKey,cache);if(guesses.size>32)guesses.delete(guesses.keys().next().value)}
              else identityGuesses.set(source,cache)
            }
          }
          value=result.value;autoCandidates=result.candidates
          autoSource=result.autoSource || (result.status==='ready' && result.source==='auto'?undefined:{label:'默认值'})
        } else if(kind==='fixed')value=entry.fixed
        else if(kind==='ref') {
          value=await reference(entry.ref,state)
          const result=resolveSlot({...field,guessHints:field.guessHints?.format?{format:field.guessHints.format}:null,target:{kind:'mods',modId:id,slot:key}},{entries:[{target:{kind:'mods',modId:id,slot:key},variable:{source:'resolved',path:'/value',...(entry.ref.fields?{fields:entry.ref.fields}:{})}}]},[],{resolved:{available:true,value:{value}}})
          if(result.status!=='ready')fail('CONFIG_TYPE',key+': '+result.status)
          value=result.value
        } else if(kind==='formula') {
          const result=await evaluateFormula(entry.formula,ref=>reference(ref,state))
          if(result.error)throw Object.assign(new Error(result.error.message),result.error)
          value=result.value
        } else fail('UNKNOWN_FIELD','Unknown value kind: '+kind)
        return {value:checkValue(value,field,kind==='formula'),layer,kind,...(autoCandidates?{autoCandidates}: {}),...(autoSource?{autoSource}:{})}
      } finally {state.stack.pop()}
    } catch(error) {return {value:null,layer,kind,error:problem(error)}}
  }
  const api={
    async resolve(id,key,ctx={}) {return resolveIn(id,key,await frame(ctx))},
    async get(args) {
      const state=await frame(args),data=await snapshot(args.modId,state),schema=schemaFor(args.modId),resolved={}
      for(const field of schema.fields)resolved[field.key]=await resolveIn(args.modId,field.key,state)
      return {modId:args.modId,revision:data.revision,schema,global:data.global,card:data.card,resolved}
    },
    async set(args) {return write(args,false)},
    async clear(args) {return write(args,true)},
    async listSources(ctx={}) {
      const state=await frame(ctx),values={...state.sources}
      for(const id of Object.keys(values).filter(id=>id.startsWith('mod:'))) {
        const provider=sources.declaration(id),value={},errors={}
        if(!provider)continue
        for(const declaration of provider.exports) {
          try {
            const resolved=await reference({source:id,path:declaration.path},state),parts=variablePointer(declaration.path)
            let target=value
            for(const part of parts.slice(0,-1))target=target[part] ||= {}
            target[parts.at(-1)]=structuredClone(resolved)
          }catch(error){errors[declaration.path]=problem(error)}
        }
        values[id]={available:true,value,errors}
      }
      return sources.list(ctx,values)
    },
    async evaluate(formula,ctx={}) {const state=await frame(ctx);return evaluateFormula(formula,ref=>reference(ref,state))},
  }
  async function write(args,clear) {
    const field=fieldFor(args.modId,args.key)
    if(!['global','card'].includes(args.layer))fail('UNKNOWN_FIELD','Unknown config layer')
    if(args.layer==='card' && (!args.cardId || field.scope==='global') || field.scope==='card' && args.layer!=='card')fail('UNKNOWN_FIELD','Field does not accept this config layer')
    if(!clear) {
      validateConfigValue(args.value,field)
      if(field.ui?.integer && own(args.value,'fixed') && !Number.isInteger(args.value.fixed))fail('CONFIG_TYPE','Expected an integer for '+field.key)
    }
    const before=await store.read(args)
    if(!clear) {
      // An uploaded file is checked once, when a value first names it in this layer.
      const stored=JSON.stringify(before[args.layer]?.[args.key]?.fixed ?? null),fresh=file=>!stored.includes(JSON.stringify(file))
      const check=file=>fresh(file) ? store.readFile({...args,path:file}) : null
      if(field.ui?.control==='image' && args.value.fixed?.file)await check(args.value.fixed.file)
      if(field.ui?.control==='images' && Array.isArray(args.value.fixed))for(const row of args.value.fixed)await check(row.file)
      if(field.records && args.value.fixed)for(const row of Object.values(args.value.fixed))for(const [key,item] of Object.entries(row))if(field.records[key]==='image')await check(item.file)
    }
    if(typeof args.expectedRevision!=='string' || args.expectedRevision!==before.revision)fail('REVISION_CONFLICT','Config changed; reload before saving')
    const values={...before[args.layer]}
    if(clear)delete values[args.key];else values[args.key]=structuredClone(args.value)
    await store.write({...args,values})
    return api.get(args)
  }
  return Object.freeze(api)
}
