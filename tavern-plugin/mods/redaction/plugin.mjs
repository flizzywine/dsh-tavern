import * as runtime from './runtime.js'
import manifest from './mod.json' with {type:'json'}

export const name='dsh-tavern-mod-redaction'
export const inject=['tavern']
export function apply(ctx) {
  ctx.tavern.registerMod(manifest,{execution:runtime,commands:manifest.commands})
}