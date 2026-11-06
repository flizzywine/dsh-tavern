import {createTemplateHistoryWindow} from './history-window.js'
import {projectTemplateMessage} from '../../../domain/template-message.js'
import { sameTemplateValue as same, applyTemplateStateChanges } from '../../../domain/template-state-patch.js'
import { diffJson } from '../../../domain/json-mutation.js'
const clone = value => value === undefined ? undefined : structuredClone(value)
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key)
const record = value => value !== null && typeof value === 'object'

/** Reconcile receipts without discarding edits made while a save was in flight. */
export function reconcileTemplateReceipt(current, submitted, saved) {
  const unchangedArray = Array.isArray(current) && same(current,submitted)
  for(const key of new Set([...Object.keys(current),...Object.keys(submitted),...Object.keys(saved)])) {
    const unchanged=own(current,key)===own(submitted,key) && same(current[key],submitted[key])
    if(unchanged) {
      if(!own(saved,key)) delete current[key]
      else if(record(current[key]) && record(submitted[key]) && record(saved[key]) && Array.isArray(current[key])===Array.isArray(saved[key])) reconcileTemplateReceipt(current[key],submitted[key],saved[key])
      else Object.defineProperty(current,key,{value:clone(saved[key]),enumerable:true,writable:true,configurable:true})
    } else if(record(current[key]) && record(submitted[key]) && record(saved[key]) && Array.isArray(current[key])===Array.isArray(saved[key])) {
      reconcileTemplateReceipt(current[key],submitted[key],saved[key])
    }
  }
  if(unchangedArray) current.length=saved.length
}

function applyFields(previous, patch) {
  const next = {...previous, ...patch.set}
  for (const key of patch.remove) delete next[key]
  return next
}
export function applyTemplateSync(previous, result) {
  if (!result.delta) return result
  if (!previous?.cursor || result.baseCursor !== previous.cursor) throw new Error('Template sync cursor mismatch')
  const chat = previous.state.chat.slice(0, result.delta.chat.length)
  for (const [index, row] of result.delta.chat.set) chat[index] = row
  return { cursor: result.cursor, state: {...applyFields(previous.state, result.delta.state), chat},
    environment: applyFields(previous.environment, result.delta.environment) }
}

// Upstream may mutate its context. Reconcile from the transport snapshot without
// cloning unchanged historical rows or letting local writes corrupt the cursor.
function restoreSnapshot(target, source, changedRow) {
  for (const key of Object.keys(target)) if (!own(source,key)) delete target[key]
  for (const [key,value] of Object.entries(source)) {
    if (Array.isArray(target[key]) && Array.isArray(value)) {
      value.forEach((row,index) => { if (!same(target[key][index],row)) {target[key][index]=clone(row);if(key==='chat')changedRow(index)} })
      target[key].length=value.length
    } else if (!same(target[key],value)) target[key]=clone(value)
  }
}

export async function createNativeTemplateConnection({ sessionId, rpc, services = {}, settingsHtml }) {
  const windowed=typeof rpc.readHistory==='function'
  let initial=await rpc('getFullPromptTemplateState',{sessionId,...(windowed?{openingWindow:1}:{})})
  function openHistory(result){
    if(!result.historyWindow)return null
    return createTemplateHistoryWindow({window:result.historyWindow,rows:result.state.chat,read:(id,window)=>{
      const value=rpc.readHistory({token:window.token,messageId:id})
      if(value.revision!==window.revision || value.messages?.length!==1 || value.messages[0].message_id!==id)throw Error('Template history revision mismatch')
      return projectTemplateMessage(value.messages[0])
    }})
  }
  let history=openHistory(initial)
  const supportsPatches=initial.capabilities?.statePatch === 1
  let pendingRows=null
  const changedRow=index=>pendingRows?.add(index)
  let baseline=history?{...initial.state,chat:history.baseline()}:initial.state, settingsBaseline=clone(initial.environment.extension_settings.EjsTemplate)
  let globalBaseline=clone(initial.environment.extension_settings.variables?.global)
  const snapshot=clone({...initial.state,...initial.environment})
  if(history)snapshot.chat=history.chat
  let saves=Promise.resolve(), latest=saves
  function enqueue(operation) { const next=saves.then(operation); latest=next; saves=next.catch(error=>{ if(services.onPersistenceError) services.onPersistenceError(error); else console.error('Template persistence failed',error) }); return next }
  async function saveGlobals(settings) {
    const submitted=clone(settings.variables?.global || {})
    if(same(submitted,globalBaseline)) return
    const result=await rpc('saveFullPromptTemplateGlobals',{sessionId,variables:submitted,expectedVariables:globalBaseline})
    if(result.updated!==true || !result.variables) throw new Error('Template global save was not acknowledged')
    reconcileTemplateReceipt(settings.variables.global,submitted,result.variables)
    globalBaseline=clone(result.variables)
  }
  const callbacks={...services,
    renderExtensionTemplateAsync:async(name,template)=>{
      if(name!=='third-party/ST-Prompt-Template' || template!=='settings') throw new Error('Unknown template UI resource')
      return settingsHtml
    },
    loadWorldInfo:async name=>clone(initial.environment.worldbooks[name] || null),
    saveChatConditional: data=>enqueue(async()=>{
      await saveGlobals(data.extension_settings)
      if(history)baseline={...baseline,chat:history.baseline()}
      const changes=history
        ? [...history.changes(),...diffJson({chat_metadata:baseline.chat_metadata},{chat_metadata:data.chat_metadata})]
        : diffJson({chat:baseline.chat,chat_metadata:baseline.chat_metadata},{chat:data.chat,chat_metadata:data.chat_metadata})
      if(!changes.length)return {updated:false}
      const submitted=applyTemplateStateChanges(baseline,changes)
      const {chat:_chat,chat_metadata:_metadata,...header}=baseline
      const result=await rpc('saveFullPromptTemplateState',{sessionId,state:supportsPatches?{...header,changes}:submitted})
      if(result.updated!==true || (!result.state && !Array.isArray(result.statePatch))) throw new Error('Template state save was not acknowledged')
      const saved=result.state || applyTemplateStateChanges(submitted,result.statePatch)
      if(history)history.acknowledge(submitted.chat,saved.chat,reconcileTemplateReceipt)
      else reconcileTemplateReceipt(data.chat,submitted.chat,saved.chat)
      reconcileTemplateReceipt(data.chat_metadata,submitted.chat_metadata,saved.chat_metadata)
      baseline=saved
      return result
    }),
    saveSettingsDebounced:settings=>enqueue(async()=>{
      await saveGlobals(settings)
      const submitted=clone(settings.EjsTemplate)
      const result=await rpc('saveFullPromptTemplateSettings',{sessionId,settings:submitted,expectedSettings:settingsBaseline})
      if(result.updated!==true) throw new Error('Template settings save was not acknowledged')
      reconcileTemplateReceipt(settings.EjsTemplate,submitted,result.settings)
      settingsBaseline=clone(result.settings)
      return result
    })
  }
  return {snapshot,callbacks,flush:()=>latest,displayChanges:()=>pendingRows,acknowledgeDisplay:()=>{pendingRows=new Set()},async refresh() {
    const previousSave = latest
    // flush still reports the failed operation. A new explicit refresh must
    // drain the queue and reload authoritative state instead of replaying that
    // same rejection forever. Never retry the template's side effects.
    await saves
    const response=await rpc('getFullPromptTemplateState',{sessionId,cursor:initial.cursor,...(windowed?{openingWindow:1}:{})})
    if (!response.delta) pendingRows=null
    else for(const [index] of response.delta.chat.set) changedRow(index)
    initial=applyTemplateSync(initial,response)
    const previousHistory=history
    history=openHistory(initial)
    baseline=history?{...initial.state,chat:history.baseline()}:initial.state
    settingsBaseline=clone(initial.environment.extension_settings.EjsTemplate)
    globalBaseline=clone(initial.environment.extension_settings.variables?.global)
    if(history){
      const {chat,...rest}=initial.state
      const {chat:previousChat,...previous}=snapshot
      restoreSnapshot(previous,{...rest,...initial.environment},changedRow)
      for(const key of Object.keys(snapshot))if(key!=='chat' && !Object.hasOwn(previous,key))delete snapshot[key]
      Object.assign(snapshot,previous,{chat:history.chat})
      pendingRows=new Set(history.loaded())
    } else {
      if(previousHistory)snapshot.chat=clone(initial.state.chat)
      restoreSnapshot(snapshot,{...initial.state,...initial.environment},changedRow)
    }
    if (latest === previousSave) latest = saves
    return snapshot
  }}
}
