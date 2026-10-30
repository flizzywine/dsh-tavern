import {modVersionMatches} from './permissions.js'
import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import widgetContract from '../../../src/client/widget-contracts.cjs'
import directorCommands from '../../../packages/dsh-presentation-protocol/src/director-commands.cjs'
const {modCheck: check, modFreeze, modJson} = contract
export const modOrder = (a,b) => a.placement.order-b.placement.order || compare(a.modId,b.modId) || compare(a.id,b.id)
const compare = (a,b) => a<b?-1:a>b?1:0

export function assertModCommandAdmission(operation,context) {
  const op=operation?.op,active=context.modCommands || [],installed=context.schemaModCommands?.find(command=>command.op===op)
  if (installed ? active.some(command=>command.op===op) : !active.some(command=>command.replaces && command.replaces===op))return
  const target=installed?.replaces || op,admitted=directorCommands.selected(context)
  const replacements=admitted.filter(row=>row.name===target || row.command?.replaces===target)
  const candidates=(replacements.length?replacements:admitted).map(row=>row.name)
  throw Object.assign(new Error(op+' is not admitted this turn. '+(candidates.length?'Choose an available command: '+candidates.join(', ')+'.':'Omit this effect.')),
    {code:'REF_UNAVAILABLE',path:'$.op',modError:{candidates},canonicalOperation:operation})
}

export function registerModCommands(manifests, core = [], {checkVerbs = true} = {}) {
  const ops = new Map(), verbs = new Map(), rows = []
  const commands=manifests.flatMap(manifest=>manifest.commands.map(command=>({...command,modId:manifest.id})))
  const replaced=commands.map(command=>command.replaces).filter(Boolean)
  // Core noun reservations are not wire operations. A replacement may retain its existing short verb.
  const native=checkVerbs?core.map(command=>command.dsl?.verb && core.some(row=>replaced.includes(row.op) && row.op.split('.')[0]===command.dsl.verb) && !core.some(row=>row.op?.split('.')[0]===command.dsl.verb && !replaced.includes(row.op))?{op:command.op}:command):core
  for (const row of [...native.map(command=>({...command,modId:'core'})), ...commands]) {
    for (const [index,key] of [[ops,row.op],[verbs,row.dsl?.verb]]) {
      if (!key || index===verbs && !checkVerbs) continue
      const previous=index.get(key)
      check(!previous, '$.commands', `Command ${key} conflicts: ${previous?.modId} / ${row.modId}`, 'MOD_COMMAND_CONFLICT')
      index.set(key,row)
    }
    if (row.modId!=='core') rows.push(row)
  }
  return modFreeze(rows.sort(modOrder))
}

export function checkModCompatibility(manifests, nameOf) {
  const declares=(a,b,kind)=>(a.compatibility?.[kind] || []).some(row=>row.id===b.id && modVersionMatches(b.version,row.range))
  for(let i=0;i<manifests.length;i++) for(let j=i+1;j<manifests.length;j++) {
    const a=manifests[i],b=manifests[j]
    check(!declares(a,b,'incompatible') && !declares(b,a,'incompatible'), '$.scope', a.id+' / '+b.id+': explicitly incompatible', 'MOD_COMMAND_CONFLICT')
    const shared=a.commands.map(command=>command.replaces).filter(target=>target && b.commands.some(command=>command.replaces===target))
    for(const target of shared) check(declares(a,b,'compatible') || declares(b,a,'compatible'), '$.scope', nameOf(a)+' ('+a.id+') 与 '+nameOf(b)+' ('+b.id+') 都替换了 '+target+'，只能开一个', 'MOD_COMMAND_CONFLICT')
  }
}

export function validateModCommand(command, params) {
  modJson(params,command.caps.bytes)
  function validate(schema,value,path) {
    if(widgetContract.stageWidgetSchemaValue(schema,value))return
    if(schema.type==='object' && value && typeof value==='object' && !Array.isArray(value)) {
      for(const key of schema.required)check(Object.hasOwn(value,key),path+'.'+key,'Provide this required field','MOD_API_UNSUPPORTED')
      for(const [key,item] of Object.entries(value)) {
        check(Object.hasOwn(schema.properties,key),path+'.'+key,'Remove unknown field from parameters; allowed: '+Object.keys(schema.properties).join(', '),'MOD_API_UNSUPPORTED')
        validate(schema.properties[key],item,path+'.'+key)
      }
    }
    const hint=schema.enum?'Choose: '+schema.enum.join(', '):schema.type==='array'?`Provide an array of ${schema.minItems || 0}-${schema.maxItems} entries`:schema.type==='string'?`Provide a string of ${schema.minLength || 0}-${schema.maxLength || 1600} characters`:'Provide '+schema.type
    if(schema.type==='array' && Array.isArray(value) && value.length>=(schema.minItems || 0) && value.length<=schema.maxItems)value.forEach((item,index)=>validate(schema.items,item,path+'['+index+']'))
    check(false,path,hint,'MOD_API_UNSUPPORTED')
  }
  validate(command.params,params,'$.params')
  directorCommands.checkModAdmission(command,params,check)
  return modFreeze(structuredClone(params))
}
