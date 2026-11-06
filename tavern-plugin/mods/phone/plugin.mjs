import manifest from './mod.json' with {type:'json'}
import grammar from './manifest.json' with {type:'json'}
import * as runtime from './runtime.js'
import {withBuiltinPhoneDevice} from './logic.js'
import {renderPhone} from './presentation.js'

export const name='dsh-tavern-mod-phone'
export const inject=['tavern']
export function apply(ctx) {
  ctx.tavern.registerMod(manifest,{execution:runtime,
    commands:grammar.commands,
    prepare:({catalogue={}})=>runtime.configure({manifest:grammar,catalogue:withBuiltinPhoneDevice(catalogue)}),
    command:(input,host)=>runtime.command(input,{...host,library:{snapshot:async()=>withBuiltinPhoneDevice(input.catalogue || {})}}),
    render:renderPhone,
    dispose:runtime.dispose,
  })
}
