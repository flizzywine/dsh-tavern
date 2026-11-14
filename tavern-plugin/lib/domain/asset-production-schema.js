// built-in-only validator for the keywords used by our shipped JSON Schema.
import schema from './asset-production.schema.json' with {type:'json'}
import {validateFigureEmotions,validateOutfitEmotions} from '../../packages/dsh-asset-library/lib/asset-packs/figure-emotions.js'
export {schema as projectSchema}
export function validateAgainst(value, schema) {
  const fail = path => {throw Object.assign(new Error('Project schema violation at '+path),{code:'INVALID_ARGUMENT'})}
  function visit(v,s,p) {
    if (s.$ref) return visit(v,s.$ref.slice(2).split('/').reduce((a,k)=>a[k],schema),p)
    if (Object.hasOwn(s,'const') && v !== s.const || s.enum && !s.enum.includes(v)) fail(p)
    if (s.type) {
      const valid = (Array.isArray(s.type)?s.type:[s.type]).some(type=>type === 'array' ? Array.isArray(v) : type === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v) : type === 'integer' ? Number.isInteger(v) : typeof v === type)
      if (!valid) fail(p)
    }
    if (typeof v === 'number' && (!Number.isFinite(v) || s.minimum !== undefined && v < s.minimum)) fail(p)
    if (typeof v === 'string' && (s.pattern && !new RegExp(s.pattern).test(v) || s.minLength !== undefined && v.length < s.minLength || s.maxLength !== undefined && v.length > s.maxLength)) fail(p)
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems || s.maxItems !== undefined && v.length > s.maxItems) fail(p)
      if (s.items) v.forEach((item,i)=>visit(item,s.items,p+'['+i+']'))
    } else if (v && typeof v === 'object') {
      if (s.maxProperties !== undefined && Object.keys(v).length > s.maxProperties) fail(p)
      for (const k of s.required || []) if (!Object.hasOwn(v,k)) fail(p+'.'+k)
      for (const [k,item] of Object.entries(v)) {
        const child = s.properties?.[k] || (typeof s.additionalProperties === 'object' ? s.additionalProperties : null)
        if (child) visit(item,child,p+'.'+k)
        else if (s.additionalProperties === false) fail(p+'.'+k)
      }
    }
  }
  visit(value,schema,'$')
  return value
}
export function validateProjectSchema(value) {
  validateAgainst(value,schema)
  for(const figure of value.characters){validateFigureEmotions(figure.emotions || []);for(const outfit of figure.outfits)validateOutfitEmotions(figure,outfit)}
  const fail = path => {throw Object.assign(new Error('Project schema violation at '+path),{code:'INVALID_ARGUMENT'})}
  if(value.baseline) {
    const b=value.baseline,map=value.characters.map(c=>({key:c.key,id:c.id,outfits:c.outfits.map(o=>o.key)}))
    if(b.packId!==value.id||JSON.stringify(map)!==JSON.stringify(b.uuidMap)||value.assets.length)fail('baseline identity/scope')
    const expected=new Map()
    for(const c of value.characters) {
      if(b.scope==='images') {
        if(c.key!=='f-'+c.id)fail('baseline character')
        for(const o of c.outfits) {
          if(!Array.isArray(o.imageKinds)||!o.imageKinds.length||o.imageKinds.some(k=>!['sprite','avatar'].includes(k)))fail('image kinds')
          for(const {id:emotion} of c.emotions)for(const kind of o.imageKinds)expected.set([c.key,o.key,kind,emotion].join('/'),{kind,character:c.key,outfit:o.key,emotion})
        }
        continue
      }
      if(c.key!=='f-'+c.id)fail('baseline character')
      expected.set(c.key+'/identity-settei',{kind:'identity-settei',character:c.key})
      for(const o of c.outfits){
        const base={character:c.key,outfit:o.key},prefix=c.key+'/'+o.key
        expected.set(prefix+'/settei',{kind:'settei',...base})
        if(c.emotions.length&&!o.mouth)fail('declared sprites require mouth frames')
        for(const {id:emotion} of c.emotions){
          for(const kind of ['sprite','avatar',...(o.eyesClosed?.includes(emotion)?[]:['blink'])])expected.set(prefix+'/'+kind+'/'+emotion,{kind,...base,emotion})
          for(const frame of ['closed','small','mid','open'])expected.set(prefix+'/mouth/'+emotion+'/'+frame,{kind:'mouth',...base,emotion,frame})
        }
      }
    }
    for(const [id,source]of Object.entries(value.mouthSources||{})) {
      const base=value.slots[id]
      if(b.scope!=='images'||source.slot!==id||base?.kind!=='sprite'||!expected.has(id))fail('mouth source identity')
      for(const frame of ['closed','small','mid','open'])expected.set([base.character,base.outfit,'mouth',base.emotion,frame].join('/'),{kind:'mouth',character:base.character,outfit:base.outfit,emotion:base.emotion,frame})
    }
    for(const [id,source]of Object.entries(value.blinkSources||{})) {
      const base=value.slots[id]
      if(b.scope!=='images'||source.slot!==id||base?.kind!=='sprite'||!expected.has(id))fail('blink source identity')
      expected.set([base.character,base.outfit,'blink',base.emotion].join('/'),{kind:'blink',character:base.character,outfit:base.outfit,emotion:base.emotion})
    }
    if(expected.size!==Object.keys(value.slots).length)fail('baseline slots')
    for(const [id,s]of Object.entries(value.slots))if(!expected.has(id)||Object.entries(expected.get(id)).some(([key,v])=>s[key]!==v))fail('baseline slot identity')
    for(const source of b.sources)if(!expected.has(source.slot)&&!(b.scope==='images'&&value.characters.some(c=>source.slot===c.key+'/identity-settei'||c.outfits.some(o=>source.slot===c.key+'/'+o.key+'/settei'))))fail('baseline source identity')
  }
  const addedIds=new Set(),operations=new Set()
  for(const batch of value.addedFigures||[]) {
    if(value.baseline?.scope!=='settei'||batch.revision>value.revision||operations.has(batch.operationId))fail('addedFigures operation')
    operations.add(batch.operationId)
    for(const row of batch.added) {
      const c=value.characters.find(c=>c.id===row.id)
      if(!c||c.key!==row.key||c.authoringKey!==row.authoringKey||row.slot!==c.key+'/identity-settei'||!value.slots[row.slot]||addedIds.has(row.id))fail('addedFigures identity')
      addedIds.add(row.id)
    }
  }
  for(const c of value.characters)for(const o of c.outfits)if(o.status==='excluded'||o.provenance?.delivery_status==='excluded')fail('Run migrate to remove legacy exclusions')
  for (const [key,s] of Object.entries(value.slots)) {
    if(Object.hasOwn(s,'note')||Object.hasOwn(s,'reason')||Object.hasOwn(s,'refusal')||Object.hasOwn(s,'waiting'))fail('Slot notes are not supported; run migrate')
    if(s.provenance?.delivery_status==='excluded')fail('Run migrate to remove legacy exclusions')
    if(value.baseline?.scope==='images'&&['mouth','blink'].includes(s.kind)) {
      const id=[s.character,s.outfit,'sprite',s.emotion].join('/'),source=(s.kind==='mouth'?value.mouthSources:value.blinkSources)?.[id]
      if(!source||s.sourceBinding?.slot!==id||s.sourceBinding.hash!==source.hash||s.sourceBinding.version!==source.version||s.installed)fail('mouth source binding')
    }
    if(s.replacementBase) {
      const b=s.replacementBase
      if(value.baseline?.scope!=='images'||!['sprite','avatar'].includes(s.kind)||s.installed||!Number.isInteger(s.version)||s.version<1||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(b.version)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(b.revision)||!/^[a-f0-9]{64}$/.test(b.hash))fail('native replacement base')
    }
    if(s.installed) {
      if(value.baseline?.scope!=='images'||s.version!==value.baseline.nativeRevision||s.installed.revision!==s.version||s.status!=='baseline-installed'||!Array.isArray(s.installed.hashes)||!s.installed.hashes.length||s.installed.hashes.some(h=>!/^[a-f0-9]{64}$/.test(h)))fail('installed slot')
    } else if(typeof s.version==='string'||s.status==='baseline-installed')fail('installed revision token outside baseline')
    if (key !== s.id) fail('$.slots.'+key+'.id')
    for (const b of s.settei?.blocks || []) {
      const [l,t,r,bottom]=b.crop_ltrb,[, ,w,h]=b.layout_xywh
      if (r <= l || bottom <= t || r > b.native_size[0] || bottom > b.native_size[1] || w <= 0 || h <= 0) fail('$.slots.'+key+'.settei.blocks')
    }
  }
  return value
}
