import {modError} from './mod-system-contract.js'

// Task checkpoints need only prompt inputs, not the user's global preferences, card choices or host session.
export function captureModPromptContext({manifests,snapshot,materials={},limits}) {
  return structuredClone({manifests,materials,...(limits?{limits}:{}),snapshot:{
    resolution:{enabled:snapshot.resolution.enabled},
    config:Object.fromEntries(snapshot.resolution.enabled.map(id=>[id,{values:snapshot.config[id]?.values || {}}])),
  }})
}

// Adapters consume the assembler's owned, ordered sections; never infer identity from placement.
export function managedPromptSections(assembly, model, slot) {
  if(!assembly)return []
  if(assembly.model!==model)throw modError('MOD_INVALID','Prompt contribution belongs to another model',{expected:model,actual:assembly.model})
  return assembly.sections.filter(section=>!slot || section.slot===slot)
}

export function managedPromptText(assembly, model, slot) {
  return managedPromptSections(assembly,model,slot).map(section=>section.text).join('\n\n')
}

export function managedPromptDisplay(assembly, model) {
  return managedPromptSections(assembly,model).map(section=>({
    key:'mod.'+section.modId+'.'+section.fragmentId,title:section.name,text:section.text,bytes:section.sectionBytes,
    source:{kind:'mod',modId:section.modId,id:section.fragmentId,name:section.name,owner:section.owner,
      model:section.model,tag:section.tag,slot:section.slot,role:section.slot==='catalogue'?'candidates':'rules',placement:model==='foreground'?'constant':'turn'},
  }))
}

export function managedForegroundEntries(assembly) {
  return managedPromptSections(assembly,'foreground').map(section=>({
    ref:'foreground-capabilities:mod:'+section.modId+':'+section.fragmentId,enabled:true,constant:true,
    primaryKeys:[],secondaryKeys:[],comment:section.name,content:section.text,foregroundCapability:true,
    capabilityPart:{key:'mod.'+section.modId+'.'+section.fragmentId,name:section.name,owners:section.owner,
      modId:section.modId,owner:section.owner,fragmentId:section.fragmentId,model:section.model,tag:section.tag,
      slot:section.slot,bytes:section.sectionBytes,group:'mods'},
  }))
}
