import * as runtime from './runtime.js'
import manifest from './mod.json' with {type:'json'}
import grammar from './manifest.json' with {type:'json'}
import {reduceCountdown,countdownWithProgress} from './countdown.cjs'
import {advanceTimer,timerCheckpoint} from './state.cjs'

export const name='dsh-tavern-mod-timer'
export const inject=['tavern']
export function reduceClock(state,action,boundary) {
  if(action.operation==='advance') {
    const value=advanceTimer(state.timer,state.checkpoint,action.elapsedMs,action.activity)
    return {...state,checkpoint:value.checkpoint}
  }
  if(action.operation==='phase')return {...state,phase:action.phase}
  if(action.operation==='read')return state
  const progressed={...state,timer:countdownWithProgress(state.timer,state.checkpoint)}
  const params=action.operation==='start'?{sec:boundary.config?.defaultSeconds,mode:boundary.config?.defaultMode,...action.params}:action.params
  const next=reduceCountdown(progressed,{operation:action.operation,budgetKey:action.budgetKey,params,policy:action.policy || action.releasePolicy || 'freeze'},
    {...boundary,sourceKey:JSON.stringify([boundary.sourceKey,action.instanceId])},state.checkpoint)
  return {...next,phase:action.operation==='release'?'released':'entry',checkpoint:timerCheckpoint(next.timer,state.checkpoint)}
}
export function apply(ctx) {
  ctx.tavern.registerMod(manifest,{execution:runtime,commands:grammar.commands,api:reduceClock})
}
