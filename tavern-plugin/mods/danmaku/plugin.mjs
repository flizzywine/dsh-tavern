import manifest from './mod.json' with {type:'json'}
import * as runtime from './runtime.js'

export const name='dsh-tavern-mod-danmaku'
export const inject=['tavern']
export function apply(ctx) {
  ctx.tavern.registerMod(manifest,{execution:runtime,commands:[],event:runtime.event,dispose:runtime.dispose})
}
