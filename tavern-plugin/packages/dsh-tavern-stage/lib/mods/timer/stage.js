import contract from '../../../../dsh-presentation-protocol/src/mod-contract.cjs'
import {assetRefKey} from '../../../../dsh-presentation-protocol/src/asset-packs.js'
import {reduceTimerCommand,TIMER_MOD_ID} from '../../../../../mods/timer/state.cjs'
import {reduceCountdown,countdownBudget} from '../../../../../mods/timer/countdown.cjs'
import {stageTimerFacts,stageTimerProgress} from './stage-service.js'
const {modCheck:check}=contract

// The timer's part of the director transaction (tavern-plugin/lib/domain/mods/stage-contributions.js).
export default {
  // A compiled state choice is folded in the native director transaction, not a late callback.
  applyStageState(state,command,params,metadata) {
    if(!command.admission?.timer)return undefined
    const action=params.set ?? 'start'
    let input=params
    if(action==='start') {
      const choices=command.admission.timer.choices || []
      const selected=params.ref === undefined ? choices[0] : choices.find(row=>assetRefKey(row.ref)===params.ref)
      check(selected,'$.ref','Timer entry is not recalled; choose a listed full ref','MOD_PERMISSION_DENIED')
      input={...selected,sec:selected.seconds,...params,ref:selected.ref}
      for(const key of ['label','onTimeout'])if(!input[key])delete input[key]
    }
    const own=state.modState?.[TIMER_MOD_ID] || {},before=own.timer
    const timer=reduceTimerCommand(before,action,input,metadata)
    const budgets=before?.budgetKey && ['start','stop'].includes(action) ? [...(own.budgets || []),before] : own.budgets
    return {...state,modState:{...state.modState,[TIMER_MOD_ID]:{...own,timer,...(budgets?{budgets}:{})}}}
  },
  promptState(own,command) {
    return own.timer && command.admission?.timer ? {timer:{mode:own.timer.mode,status:own.timer.status,label:own.timer.label}} : undefined
  },
  // Trusted static handlers produce drafts only. No callback, IO or plugin code runs in the stage transaction.
  stageControls:{countdown:{
    apply:reduceCountdown,
    operation:(state,key)=>countdownBudget(state,key)?'resume':'start',
    admission:command=>command.admission?.timer,
    instanceId:state=>state.timer.instanceId,
  }},
  performanceUses:[{id:'clock',capability:'dsh.timer.countdown',provider:TIMER_MOD_ID,range:'>=1.0.0 <2.0.0',operations:['start','resume','release','read'],optional:true}],
  // One real event adds one fact on the following story turn; the measured balance carries into the next draft.
  directorTurn(chat,turn) {
    const facts=stageTimerFacts(chat,turn),progress=stageTimerProgress(chat,turn)
    return facts.length || progress ? {...(facts.length?{facts}:{}),...(progress?{progress}:{})} : undefined
  },
  applyProgress(state,progress) {
    const timer=state.modState?.[TIMER_MOD_ID]?.timer
    if(timer && progress.instanceId===timer.instanceId) {
      timer.remainingMs=progress.remainingMs
      if(progress.status==='expired' || progress.commandRevision===timer.revision)timer.status=progress.status
    }
    return state
  },
  facts:{section:'timer_events',id:'timeup',field:'timeup'},
}
