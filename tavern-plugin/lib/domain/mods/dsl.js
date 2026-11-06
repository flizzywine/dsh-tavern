import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {validateModCommand} from './commands.js'
const {modCheck:check,modSafeKey}=contract

// Named JSON values share the exact command schema used by the JSON tool form.
export function parseModDsl(text,commands,{validate=true}={}) {
  check(typeof text==='string' && text.length<=16384,'$.dsl','Invalid mod DSL','ARG_INVALID')
  const tokens=[];let start=0,quote=false,escape=false,depth=0
  for(let at=0;at<=text.length;at++) {
    const char=text[at]
    if(quote) {if(escape)escape=false;else if(char==='\\')escape=true;else if(char==='"')quote=false}
    else if(char==='"')quote=true
    else if(char==='{' || char==='[')depth++
    else if(char==='}' || char===']') {depth--;check(depth>=0,'$.dsl','Unbalanced JSON value','ARG_INVALID')}
    if(!quote && !depth && (at===text.length || /\s/.test(char))) {if(at>start)tokens.push(text.slice(start,at));start=at+1}
  }
  check(!quote && !depth,'$.dsl','Unclosed JSON value','ARG_INVALID')
  const [verb,id,...values]=tokens,command=commands.find(row=>row.dsl.verb===verb && (row.dsl.positional || row.id===id))
  check(command,'$.dsl','Unregistered mod DSL command','ARG_INVALID')
  const params=Object.create(null)
  if(command.dsl.positional)params[command.dsl.positional]=id
  for(const flag of command.dsl.flags || [])params[flag]=false
  for(const token of values) {
    if(token.startsWith('--') && command.dsl.flags?.includes(token.slice(2))) {
      check(params[token.slice(2)]===false,'$.dsl','Duplicate flag','ARG_INVALID')
      params[token.slice(2)]=true;continue
    }
    const at=token.indexOf('='),key=token.slice(0,at),raw=token.slice(at+1)
    check(at>0 && modSafeKey(key) && raw && !Object.hasOwn(params,key),'$.dsl','Expected unique key=value arguments','ARG_INVALID')
    try {params[key]=JSON.parse(raw)} catch {check(!/^[\[{"]/.test(raw),'$.dsl','Invalid JSON value','ARG_INVALID');params[key]=raw}
  }
  const value=validate ? validateModCommand(command,{...params}) : {...params}
  return command.paramsStyle==='flat'?{op:command.op,...value}:{op:command.op,params:value}
}
