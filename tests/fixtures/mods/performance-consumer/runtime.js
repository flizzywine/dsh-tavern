export function configure({manifest,catalogue}) {
  const choices=catalogue.packs.flatMap(pack=>pack.entries.map(entry=>({ref:entry.ref,levels:entry.performanceLevels,default:entry.performanceDefault})))
  return {commands:manifest.commands.map(command=>({...command,admission:{performance:{choices,permissions:manifest.permissions.stage}}}))}
}
export function prepare() { return null }
// The director transaction already accepted the boundary; this callback does not replay it.
export async function command(_input,host) { return {accepted:true,state:await host.stage.state.get()} }
export function settled() { return null }
export function dispose() {}
