import manifest from './mod.json' with {type:'json'}
import grammar from './manifest.json' with {type:'json'}
import * as runtime from './runtime.js'

export const name='dsh-tavern-mod-textcard'
export const inject=['tavern']
export function apply(ctx) {
  ctx.tavern.registerMod(manifest,{execution:runtime,
    commands:grammar.commands,
    prepare:(_input,_host,config)=>runtime.configure({manifest:grammar,settings:{values:config.values}}),
    command:(input,host,config)=>runtime.command(input,{...host,settings:{get:async()=>({values:config.values})}}),
    dispose:runtime.dispose,
  })
}
