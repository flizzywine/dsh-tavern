import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {modOrder} from './commands.js'
const {modCheck:check,modFreeze,modPlacement,modJson} = contract

export function compileModPrompts(manifests,readText,target='director',commands) {
  const fragments=[]
  for(const manifest of manifests) {
    for(const prompt of manifest.prompts.filter(prompt=>prompt.target===target && (!commands || !manifest.commands.some(command=>command.promptId===prompt.id) || commands.some(command=>command.modId===manifest.id && command.promptId===prompt.id)))) {
      const text=readText(manifest.id,prompt.path)
      check(typeof text==='string' && Buffer.byteLength(text)<=65536,'$.prompts','Prompt text unavailable','MOD_RESOURCE_UNAVAILABLE')
      fragments.push({modId:manifest.id,id:prompt.id,type:'prompt',source:prompt.path,text,placement:prompt.placement})
    }
    if(target==='director') for(const command of manifest.commands.filter(row=>!commands || commands.some(command=>command.modId===manifest.id && command.id===row.id)))fragments.push({modId:manifest.id,id:command.id,type:'command',source:'manifest.commands.'+command.id,text:command.dsl.syntax,placement:command.placement})
  }
  return modFreeze(fragments.sort(modOrder))
}

// Core text owns its whitespace. No active fragments means exactly the original bytes.
export function assembleModPrompt({segments,fragments=[],target='director'}) {
  const slots=new Set(segments.map(segment=>segment.section)),groups=new Map(),positions=[]
  check(slots.size===segments.length,'$.segments','Duplicate assembly slot')
  for(const fragment of fragments) {
    modPlacement(fragment.placement,target)
    check(slots.has(fragment.placement.section),'$.placement','Section is not exposed by this assembly')
    const rows=groups.get(fragment.placement.section) || []
    rows.push(fragment);groups.set(fragment.placement.section,rows)
  }
  let text='',bytes=0
  const append=value=>{text+=value;bytes+=Buffer.byteLength(value)}
  for(const segment of segments) {
    append(segment.text)
    for(const row of (groups.get(segment.section) || []).sort(modOrder)) {
      append('\n')
      positions.push({...row,offset:bytes,bytes:Buffer.byteLength(row.text)})
      append(row.text)
    }
  }
  return modFreeze({text,bytes,sections:positions})
}

export function replaceModPromptSections({manifest,fragments,target,sections}) {
  modJson(sections)
  const replacements=new Map()
  for(const section of sections) {
    check(section && Object.keys(section).every(key=>['id','text'].includes(key)) && typeof section.text==='string','$.sections')
    check(!replacements.has(section.id) && manifest.prompts.some(prompt=>prompt.id===section.id && prompt.target===target),'$.sections','Undeclared prompt section')
    replacements.set(section.id,section.text)
  }
  return modFreeze(fragments.map(fragment=>fragment.modId===manifest.id && fragment.type==='prompt' && replacements.has(fragment.id)?{...fragment,text:replacements.get(fragment.id)}:fragment))
}
