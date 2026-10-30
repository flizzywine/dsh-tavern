import {phoneDevices} from './logic.js'

export function configure({manifest,catalogue}) {
  if(!phoneDevices(catalogue).length)return {commands:[]}
  return {commands:manifest.commands.map(command=>({...structuredClone(command),admission:command.id==='mark'?{source:'phone.message'}:{phoneGroup:true}}))}
}
export function prepare() {return null}
export async function command({commandId,params},host) {
  if(commandId==='group')return null // Metadata is folded atomically by the director transaction.
  if(commandId!=='mark')throw Object.assign(new Error('Unknown phone command; choose mark or group'),{code:'MOD_API_UNSUPPORTED'})
  const device=phoneDevices(await host.library.snapshot({}))[0]
  if(!device)throw Object.assign(new Error('Phone is not available'),{code:'MOD_DISABLED'})
  return host.stage.place({id:'message',kind:'dsh.phone.message',payload:{device,marker:{op:'phone.message',...params}}})
}
export function settled() {return null}
export function dispose() {}
