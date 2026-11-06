import {createIndexedArrayApi} from './indexed-array.js'
import {freezeJson,createImmutableOrderedJsonIndex} from './freeze-json.js'
import {createOrderedNumericIndex} from './ordered-numeric-index.js'
import {copyJsonTree} from './copy-json-tree.js'
const notable = new Set(['pending','error','interrupted','partial','stale'])
function rowOf(message) {
  const assistant = message?.role === 'assistant'
  const turn = Math.max(0,Number(message?.turn) || (message?.greeting === true ? 1 : 0))
  if (!assistant || !turn || !message.mvu) return {assistant}
  const stored = message.mvu.receipt, diagnostics = Array.isArray(message.mvu.diagnostics) ? message.mvu.diagnostics : []
  const receipt = stored && typeof stored === 'object' ? structuredClone(stored) : {
    version:1,status:message.mvu.pending === true ? 'pending' : diagnostics.length ? 'error' : message.mvu.modified === true ? 'updated' : 'unchanged',
    summary:'',changes:[],failures:diagnostics.map(item=>({command:String(item.command ?? ''),message:String(item.message ?? '')}))
  }
  return freezeJson({assistant,turn,receipt})
}
// Public reads detach receipts; internal views may share branded immutable output.
export function createMvuReceiptIndex({maxBytes = 8*1024*1024, shared = false, onVisit} = {}) {
  const outputIndex=createImmutableOrderedJsonIndex({visit:onVisit,measure:row=>JSON.stringify(row).length*2})
  const cache = new Map()
  let retainedBytes = 0
  const all = createIndexedArrayApi({visit:onVisit,eligible:row=>row.assistant,measure:row=>JSON.stringify(row).length*2})
  const quiet = createIndexedArrayApi({visit:onVisit,eligible:row=>row.receipt && !notable.has(String(row.receipt.status ?? ''))})
  const owners=createIndexedArrayApi({visit:onVisit})
  const groups=createOrderedNumericIndex({visit:onVisit,measure:group=>96+(group.rows?owners.info(group.rows).bytes:0)})
  function ownerChange(group,id,row) {
    if(group?.rows){
      const rows=owners.update(group.rows,[[id,row]],Math.max(group.rows.length,id+1))
      const count=owners.info(rows).eligible
      if(count>1)return {rows}
      if(count===1){const last=owners.previous(rows,rows.length);return {id:last,row:rows[last]}}
      return undefined
    }
    if(row===undefined)return group?.id===id?undefined:group
    return group && group.id!==id ? {rows:owners.update([],[[group.id,group.row],[id,row]],Math.max(group.id,id)+1)} : {id,row}
  }
  const alert=(row,id,interrupted)=>Boolean(row?.receipt && (id===interrupted || notable.has(String(row.receipt.status ?? ''))))
  return function project(chat,activity,changes) {
    const messages = Array.isArray(chat.messages) ? chat.messages : []
    const previous = cache.get(chat.id), revision = chat._storageRevision
    const reuse = previous && changes && Number.isSafeInteger(revision) && previous.lifecycle === chat.tavernHelperLifecycleRevision
      && (previous.revision === revision || previous.revision === changes.baseRevision)
      && Array.isArray(changes.indices)
    let state, pointEntries
    if (reuse) {
      const indices = new Set(previous.revision === revision ? [] : changes.indices)
      for(let id=previous.length;id<messages.length;id++)indices.add(id)
      const entries = [...indices].filter(id=>id>=0 && id<messages.length).map(id=>[id,rowOf(messages[id])])
        .filter(([id,row])=>id>=previous.length || JSON.stringify(row)!==JSON.stringify(previous.all[id]))
      pointEntries=entries
      const unchanged = entries.length===0 && previous.length===messages.length
      state = {...previous,revision,length:messages.length,all:unchanged ? previous.all : all.update(previous.all,entries,messages.length),
        quiet:unchanged ? previous.quiet : quiet.update(previous.quiet,entries,messages.length)}
    } else {
      const rows = messages.map(rowOf)
      state = {revision,lifecycle:chat.tavernHelperLifecycleRevision,length:messages.length,all:all.from(rows),quiet:quiet.from(rows)}
    }
    const latest = all.previous(state.all,messages.length)
    const interrupted = activity.reason === 'interrupted' && activity.role === 'settlement' && state.all[latest]?.receipt ? latest : -1
    const unchangedOutput = reuse && state.all===previous.all && previous.interrupted===interrupted && previous.output
    if (unchangedOutput) {
      state.output=previous.output;state.outputBytes=previous.outputBytes
    } else {
      const ordinary=[]
      for(let id=quiet.previous(state.quiet,messages.length);id>=0 && ordinary.length<3;id=quiet.previous(state.quiet,id))if(id!==interrupted)ordinary.push(id)
      state.ordinary=ordinary
      const changedTurns=new Set()
      if(reuse){
        state.groups=previous.groups
        const ids=new Set(pointEntries.map(([id])=>id))
        for(let id=messages.length;id<previous.length;id++)ids.add(id)
        if(interrupted!==previous.interrupted){if(interrupted>=0)ids.add(interrupted);if(previous.interrupted>=0)ids.add(previous.interrupted)}
        const changedGroups=new Map()
        function change(row,id,remove){
          if(!row?.receipt)return
          changedTurns.add(row.turn)
          if(!alert(row,id,remove?previous.interrupted:interrupted))return
          const group=changedGroups.has(row.turn)?changedGroups.get(row.turn):groups.get(previous.groups,row.turn)
          changedGroups.set(row.turn,ownerChange(group,id,remove?undefined:row))
        }
        for(const id of ids)if(id<previous.length)change(previous.all[id],id,true)
        for(const id of ids)if(id<messages.length)change(state.all[id],id,false)
        state.groups=groups.update(previous.groups,[...changedGroups])
        for(const id of previous.ordinary)changedTurns.add(previous.all[id].turn)
        for(const id of ordinary)changedTurns.add(state.all[id].turn)
      } else {
        const initial=new Map()
        for(let id=0;id<messages.length;id++){
          const row=state.all[id]
          if(alert(row,id,interrupted))initial.set(row.turn,ownerChange(initial.get(row.turn),id,row))
        }
        state.groups=groups.from([...initial])
        for(const turn of initial.keys())changedTurns.add(turn)
        for(const id of ordinary)changedTurns.add(state.all[id].turn)
      }
      const ordinaryRows=ordinary.map(id=>({id,row:state.all[id]}))
      const entries=[]
      for(const turn of changedTurns){
        let winner=ordinaryRows.find(item=>item.row.turn===turn)
        if(!winner){
          const group=groups.get(state.groups,turn)
          if(group?.rows){const id=owners.previous(group.rows,group.rows.length);winner={id,row:group.rows[id]}}
          else winner=group
        }
        const value=winner?freezeJson({turn,receipt:displayReceipt(winner.row,winner.id,interrupted)}):undefined
        const old=reuse?outputIndex.get(previous.output,turn):undefined
        if(old?.receipt===value?.receipt && Boolean(old)===Boolean(value))continue
        entries.push([turn,value])
      }
      state.output=reuse?outputIndex.update(previous.output,entries):outputIndex.from(entries)
      state.outputBytes=outputIndex.info(state.output).bytes
    }
    state.interrupted=interrupted
    state.bytes = all.info(state.all).bytes + quiet.info(state.quiet).bytes + groups.info(state.groups).bytes + state.outputBytes
    if (chat.id && Number.isSafeInteger(revision) && state.bytes <= maxBytes && !(previous?.revision > revision)) {
      if(previous) { retainedBytes -= previous.bytes; cache.delete(chat.id) }
      while(cache.size && (cache.size>=8 || retainedBytes+state.bytes>maxBytes)) {
        const key=cache.keys().next().value;retainedBytes-=cache.get(key).bytes;cache.delete(key)
      }
      cache.set(chat.id,state);retainedBytes+=state.bytes
    }
    return shared ? state.output : copyJsonTree(state.output)
  }
}

function displayReceipt(row,id,interrupted) {
  if(id!==interrupted)return row.receipt
  return {...row.receipt,status:'interrupted',summary:'后台结算因服务重启或异常退出而中断，请重试结算；正文和已保存变量保留。'}
}
