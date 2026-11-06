import * as runtime from './runtime.js'
import manifest from './mod.json' with {type:'json'}
export const name='dsh-tavern-mod-dice'
export const inject=['tavern']
export function apply(ctx) {
  // The existing foreground tool remains its execution owner; this example contributes its prompt only.
  ctx.tavern.registerMod(manifest,{execution:runtime,commands:[]})
}
