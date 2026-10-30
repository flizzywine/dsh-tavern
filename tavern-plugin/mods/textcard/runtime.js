import {INTENSITIES,intensityOf} from './presets.js'
import {compileTextcard,TEXTCARD_COMPOUND_KIND} from './templates.js'
export {assertTextcardSemantics as validateCommand} from './templates.js'

export function commandSchema({manifest}) { return structuredClone(manifest.commands) }
export function configure({manifest,settings}) {
  const commands=commandSchema({manifest}),intensity=intensityOf(settings)
  for(const command of commands)command.caps.perTurn=INTENSITIES[intensity].cap
  return {commands}
}
export async function prepare(_input,host) {
  const intensity=intensityOf(await host.settings.get({}))
  return {sections:[{id:'text-rule',text:"<mod_textcard>\n- Share 8 performances per turn; one template is one performance. Safe colours, automatic layout/timing; live-once.\n- beat.at is the source paragraph; after follows its last page, before precedes its first. Default after; title before.\n- show: word/name/marker/vertical/punct; one-glyph word is enlarged. title: chapters. sequence: echoes or colour signals.\n- count: seconds to zero; relate: people and directed links; compare: viewpoints; reveal: clues to an answer; repeat: obsession; read: a dossier.\n- People IDs are local keys, names are display text. Link endpoints use those IDs. All strings are nonblank.\n- Example: {\"op\":\"mod.dsh.textcard.count\",\"from\":3,\"label\":\"Door closes\"}.\n</mod_textcard>\n".replace('Share 8 performances','Share '+INTENSITIES[intensity].cap+' performances')}]}
}
export async function command({commandId,params},host) {
  const payload=compileTextcard(commandId,params,intensityOf(await host.settings.get({})))
  return host.stage.place({id:'text',kind:TEXTCARD_COMPOUND_KIND,payload})
}
export function settled() { return null }
export function dispose() {}
