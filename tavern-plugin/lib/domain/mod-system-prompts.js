import {createHash} from 'node:crypto'
import {modError,validateModSystem} from './mod-system-contract.js'
import {foregroundCapabilityEpoch} from './foreground-capabilities.js'

export const MOD_PROMPT_LIMITS=Object.freeze({fragmentBytes:8192,modBytes:32768,promptBytes:65536,toolSchemaBytes:65536})
const slots=['rules.after-core','catalogue','task']
const models=['foreground','director','background']
const reserved=new Set(['system','dialogue','dialogue_format','speaker_roster','tools'])
const bytes=text=>Buffer.byteLength(text,'utf8')
const compare=(a,b)=>a<b?-1:a>b?1:0
const xmlText=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
const budget=(actual,limit,details)=>{if(actual>limit)throw modError('MOD_PROMPT_BUDGET','Prompt contribution exceeds its UTF-8 byte budget',{actual,limit,...details})}

export function assembleModPrompts({manifests,snapshot,model,materials={},tools=[],limits={}}) {
  if(!models.includes(model))throw modError('MOD_INVALID','Unknown prompt target model')
  const caps={...MOD_PROMPT_LIMITS,...limits},sections=[],tags=new Map(),owners=new Map()
  for(const manifest of manifests) {
    validateModSystem('manifest',manifest)
    const seen=new Set()
    for(const fragment of manifest.prompts || []) {
      if(seen.has(fragment.id))throw modError('MOD_INVALID','Duplicate prompt fragment identity',{modId:manifest.id,id:fragment.id})
      seen.add(fragment.id)
      for(const key of Object.keys(fragment.when.config || {}))if(!Object.hasOwn(manifest.config.schema.properties || {},key))throw modError('MOD_INVALID','Prompt condition uses an undeclared configuration field',{modId:manifest.id,key})
      if(reserved.has(fragment.tag) || fragment.tag.startsWith('xml'))throw modError('MOD_PROMPT_TAG_CONFLICT','This XML tag belongs to the host',{tag:fragment.tag})
      if(fragment.model!==model || !snapshot.resolution.enabled.includes(manifest.id))continue
      if(!Object.entries(fragment.when.config || {}).every(([key,value])=>snapshot.config[manifest.id]?.values[key]===value))continue
      const material=fragment.when.materials,available=new Set(materials[manifest.id] || [])
      if(material && (!material.kinds.length || !(material.match==='all'?material.kinds.every(kind=>available.has(kind)):material.kinds.some(kind=>available.has(kind)))))continue
      if(tags.has(fragment.tag))throw modError('MOD_PROMPT_TAG_CONFLICT','Two included fragments use the same XML tag',{tag:fragment.tag,owners:[tags.get(fragment.tag),manifest.id]})
      tags.set(fragment.tag,manifest.id)
      const text='<'+fragment.tag+'>\n'+xmlText(fragment.markdown)+'\n</'+fragment.tag+'>',sectionBytes=bytes(text)
      budget(sectionBytes,Math.min(fragment.byteBudget,caps.fragmentBytes),{modId:manifest.id,fragmentId:fragment.id})
      const modBytes=(owners.get(manifest.id) || 0)+sectionBytes;owners.set(manifest.id,modBytes);budget(modBytes,caps.modBytes,{modId:manifest.id})
      sections.push({modId:manifest.id,owner:manifest.packageName,name:manifest.name,fragmentId:fragment.id,model,tag:fragment.tag,slot:fragment.slot,order:fragment.order,text,sectionBytes,
        display:{group:'mods',name:manifest.name,owner:manifest.packageName,fragmentId:fragment.id}})
    }
  }
  // ASCII identity comparison is locale-independent; equal order keys never merge labels or text.
  sections.sort((a,b)=>slots.indexOf(a.slot)-slots.indexOf(b.slot) || a.order-b.order || compare(a.modId,b.modId) || compare(a.fragmentId,b.fragmentId))
  const text=sections.map(section=>section.text).join('\n\n'),promptBytes=bytes(text),toolSchemaJson=JSON.stringify(tools),toolSchemaBytes=bytes(toolSchemaJson)
  const toolSchemaHash=createHash('sha256').update(toolSchemaJson).digest('hex')
  budget(promptBytes,caps.promptBytes,{model});budget(toolSchemaBytes,caps.toolSchemaBytes,{model})
  return {model,sections,text,promptBytes,toolSchemaBytes,toolSchemaHash,sectionBytes:sections.reduce((sum,section)=>sum+section.sectionBytes,0)}
}

// The existing chat/capability snapshot owner persists this value; never create a parallel history store.
export function freezeForegroundModPrompts({previous,sessionId,nativeSession,...input}) {
  if(typeof sessionId!=='string' || !sessionId || !nativeSession)throw modError('MOD_PROMPT_EPOCH','An authoritative native session is required')
  const epoch=foregroundCapabilityEpoch(nativeSession)
  if(previous?.sessionId===sessionId && previous.epoch===epoch)return structuredClone(previous)
  const assembled=assembleModPrompts({...input,model:'foreground'})
  if(previous?.sessionId===sessionId && previous.toolSchemaHash!==assembled.toolSchemaHash)throw modError('MOD_SESSION_REQUIRED','A changed tool schema requires a new model session, not only compaction')
  return {version:1,sessionId,epoch,...assembled}
}
