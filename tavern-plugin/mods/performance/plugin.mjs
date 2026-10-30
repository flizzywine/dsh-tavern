import * as runtime from './runtime.js'
import manifest from './mod.json' with {type:'json'}
import grammar from './manifest.json' with {type:'json'}
import {performanceBoundary} from '../../packages/dsh-presentation-protocol/src/performance-state.cjs'

export const name='dsh-tavern-mod-performance'
export const inject=['tavern']
export function planPerformance({state,instanceId,operation,input,config,configuredKeys=[],boundary}) {
  const instances={...state.instances},previous=instances[instanceId],actions=[]
  let nextLease=state.nextLease || 0
  if(operation==='off') {
    if(!previous)return {state,actions}
    if(previous.clock)actions.push({...previous.clock,operation:'phase',phase:'exit'})
    instances[instanceId]={...previous,phase:'exit'}
  } else if(operation==='exited') {
    if(!previous)return {state,actions}
    if(previous.phase!=='exit')throw new Error('Complete the exit phase before releasing its clock')
    if(previous.clock)actions.push({...previous.clock,operation:'release',policy:previous.clock.releasePolicy})
    delete instances[instanceId]
  } else if(operation==='phase') {
    if(!previous)throw new Error('Start the performance before reporting its phase')
    if(!['entry','rest','exit'].includes(input.phase))throw new Error('Unknown playback phase')
    if(previous.clock)actions.push({...previous.clock,operation:'phase',phase:input.phase})
    instances[instanceId]={...previous,phase:input.phase}
  } else if(['start','resume'].includes(operation)) {
    if(previous) {
      if(previous.phase!=='exit' && previous.performance.topic===input.topic && previous.clock?.instanceId===input.clock?.instanceId)return {state,actions}
      throw new Error('Finish this performance instance before starting another topic')
    }
    const document=input.document || {timeline:{}}
    const performance=performanceBoundary(null,{ref:input.ref,topic:input.topic,level:input.level || 1},boundary,document)
    let clock=null
    if(input.clock) {
      clock={modId:'dsh.timer',instanceId:input.clock.instanceId,budgetKey:input.topic,token:JSON.stringify([instanceId,boundary.sourceKey,boundary.turn,input.topic,++nextLease]),releasePolicy:input.clock.release || 'freeze',label:input.label || manifest.name}
      const seconds=input.sec ?? document.defaultTopicSeconds ?? (configuredKeys.includes('defaultTopicSeconds')?config.defaultTopicSeconds:undefined)
      actions.push({...clock,operation,params:{...input.clock.params,...(operation==='start' && seconds!==undefined?{sec:seconds}:{} )}})
    }
    instances[instanceId]={performance,clock,phase:'entry'}
  } else return null
  return {state:{...state,instances,nextLease},actions}
}
export function apply(ctx) {
  ctx.tavern.registerMod(manifest,{execution:runtime,commands:grammar.commands,plan:planPerformance})
}
