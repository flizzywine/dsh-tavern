import {validateTimerCommand} from './state.cjs'

// Enum members already imply their JSON type; only the frozen provider view omits it.
export function commandSchema({manifest}) {
  const commands=structuredClone(manifest.commands)
  for(const schema of Object.values(commands[0].params.properties))if(schema.enum)delete schema.type
  return commands
}
export function configure({manifest,catalogue}) {
  const choices=catalogue.packs.flatMap(pack=>pack.entries.map(entry=>({ref:entry.ref,look:entry.look || 'default',seconds:entry.seconds ?? 60,mode:entry.mode || 'story',label:entry.label || '',onTimeout:entry.onTimeout || '',onTimeup:entry.onTimeup || null,pauseOnChoices:entry.pauseOnChoices === true})))
  return {commands:manifest.commands.map(command=>({...command,admission:{timer:{choices}}}))}
}
export function validateCommand(_id,params) { validateTimerCommand(params.set ?? 'start',params) }
export function prepare() { return null }
export async function command(_input,host) { return {accepted:true,state:await host.stage.state.get()} }
export function settled() { return null }
export function dispose() {}
