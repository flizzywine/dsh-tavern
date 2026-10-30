import {randomUUID} from 'node:crypto'
import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck:check,modShape:shape,modJson}=contract

export function createModelStreamTiming(now=Date.now) {
  let firstTokenAt=null,firstJsonLineAt=null,buffer=''
  const line=value=>{if(firstJsonLineAt===null){try{const parsed=JSON.parse(value);if(parsed && typeof parsed==='object')firstJsonLineAt=now()}catch{}}}
  return {
    text(value){if(!value)return;firstTokenAt??=now();if(firstJsonLineAt!==null)return;buffer+=value;let end;while((end=buffer.indexOf('\n'))!==-1){line(buffer.slice(0,end));buffer=buffer.slice(end+1)}},
    finish(){line(buffer);return {firstTokenAt,firstJsonLineAt}},
  }
}

// Ephemeral display work never enters the shared Background Session or owns story state.
export function createModModelTasks({select,run,busy=()=>false,now=Date.now,concurrency=2,intervalMs=3000,perMinute=20}) {
  const tasks=new Map(),recent=new Map()
  let timer=null,disposed=false,running=0,pumping=false
  function cancelTask(task) {task.controller.abort();tasks.delete(task.id)}
  function schedule() {if(!timer && !pumping && tasks.size && !disposed)timer=setTimeout(pump,100)}
  async function pump() {
    timer=null;pumping=true
    try {
    for(const task of tasks.values()) {
      if(!task.current()){cancelTask(task);continue}
      if(!task.input || task.started || running>=concurrency)continue
      let blocked
      try {blocked=await busy(task.sessionId,task.input.purpose)}catch(error){cancelTask(task);task.deliver({operationId:task.id,status:'failed',error:{code:'MOD_RUNTIME_FAILED',message:'Model scheduling failed; inspect host diagnostics'}});continue}
      if(blocked)continue
      if(task.controller.signal.aborted || !task.current()){cancelTask(task);continue}
      task.started=true;running++
      let buffer=''
      const line=output=>{if(output.trim() && !task.controller.signal.aborted && task.current())task.deliver({operationId:task.id,status:'streaming',output})}
      const onText=text=>{
        buffer+=text
        let end
        while((end=buffer.indexOf('\n'))!==-1){line(buffer.slice(0,end));buffer=buffer.slice(end+1)}
      }
      void Promise.resolve().then(()=>run({...task.input,signal:task.controller.signal,onText})).then(output=>{
        if(!task.controller.signal.aborted && task.current()){line(buffer);task.deliver({operationId:task.id,status:'completed',...output})}
      },error=>{
        if(!task.controller.signal.aborted && task.current())task.deliver({operationId:task.id,status:'failed',error:{code:'MOD_RUNTIME_FAILED',message:'Model request failed; inspect global model settings and request diagnostics'}})
      }).finally(()=>{running--;tasks.delete(task.id);schedule()})
    }
    } finally {pumping=false;schedule()}
  }
  return Object.freeze({
    async request({manifest,owner,sessionId,current,window,prompts,deliver},args) {
      shape(args,['requestId','slotId','purpose','input','maxOutputTokens'])
      check(typeof args.requestId==='string' && args.requestId.length>0 && args.requestId.length<=128,'$.requestId')
      check(typeof args.purpose==='string' && args.purpose.length>0 && args.purpose.length<=240,'$.purpose')
      modJson(args.input,16384)
      check(Number.isSafeInteger(args.maxOutputTokens) && args.maxOutputTokens>0 && args.maxOutputTokens<=8192,'$.maxOutputTokens')
      const slot=manifest.modelSlots?.find(row=>row.id===args.slotId)
      check(slot && manifest.permissions.models?.includes(slot.id),'$.slotId','Model slot is not authorized','MOD_PERMISSION_DENIED')
      check(!disposed && current(),'$.source','Model source is inactive','MOD_SOURCE_STALE')
      check(![...tasks.values()].some(task=>task.modId===manifest.id),'$.requestId','A mod request is already pending','MOD_RESOURCE_UNAVAILABLE')
      const at=now(),history=(recent.get(manifest.id)||[]).filter(row=>row.at>at-60000),last=history.findLast(row=>row.purpose===(args.purpose==='memory'?'memory':'reaction'))
      check(!last || at-last.at>=intervalMs,'$.requestId','Wait before requesting another batch','MOD_RESOURCE_UNAVAILABLE')
      check(history.length<perMinute,'$.requestId','Model request rate exceeded','MOD_RESOURCE_UNAVAILABLE')
      // Reserve before awaiting the provider selection, so concurrent callbacks cannot bypass admission.
      const id=randomUUID(),task={id,modId:manifest.id,owner,sessionId,current,deliver,controller:new AbortController(),started:false,input:null}
      const reservation={at,purpose:args.purpose==='memory'?'memory':'reaction'}
      tasks.set(id,task);recent.set(manifest.id,[...history,reservation])
      try {
        const selection=structuredClone(await select({modId:manifest.id,slotId:slot.id,sessionId,slot}))
        check(selection?.provider && selection?.model,'$.model','Choose an available model in global model settings','MOD_RESOURCE_UNAVAILABLE')
        const visible=await window(),sections=await prompts(slot.id)
        check(!task.controller.signal.aborted && current(),'$.source','Model source changed','MOD_SOURCE_STALE')
        task.input={selection,sessionId,modId:manifest.id,slotId:slot.id,purpose:args.purpose,maxTokens:args.maxOutputTokens,sections,
          system:sections.map(row=>row.text).join('\n'),messages:[{role:'user',content:[{type:'text',text:JSON.stringify({purpose:args.purpose,input:structuredClone(args.input),window:visible})}]}]}
        schedule()
        return {operationId:id,status:'queued'}
      } catch(error) {
        // A source rejected before provider dispatch must not exhaust the fresh page's call budget.
        if(error.code==='MOD_SOURCE_STALE')recent.set(manifest.id,(recent.get(manifest.id)||[]).filter(row=>row!==reservation))
        cancelTask(task);throw error
      }
    },
    cancel(owner,{operationId}) {const task=tasks.get(operationId);check(!task || task.owner===owner,'$.operationId','Request belongs to another instance','MOD_PERMISSION_DENIED');if(task)cancelTask(task);return {cancelled:!!task}},
    cancelOwner(owner) {for(const task of tasks.values())if(task.owner===owner)cancelTask(task)},
    invalidate() {for(const task of tasks.values())if(!task.current())cancelTask(task)},
    dispose(){disposed=true;clearTimeout(timer);timer=null;for(const task of tasks.values())cancelTask(task);recent.clear()},
  })
}
