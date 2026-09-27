import {createIndexedArrayApi} from './indexed-array.js'
import {createOrderedNumericIndex} from './ordered-numeric-index.js'

// The legacy rule matcher uses the first assistant message at an explicit turn,
// defaulting missing/zero/NaN turns to 1. Keep duplicate owners in message order.
export function createStatusSourceIndex({visit=()=>{},readRow}={}) {
  const positions=createOrderedNumericIndex({visit,measure:source=>String(source).length*2})
  const turns=createOrderedNumericIndex({visit,measure:rows=>positions.info(rows).bytes})
  const messages=createIndexedArrayApi({visit,measure:row=>row?32+String(row.source).length*2:0})
  function row(message,id){if(readRow)return readRow(message,id);return message?.role==='assistant'?{turn:Number(message.turn)||1,source:String(message.sourceText??message.text??'')}:undefined}
  function update(previous,source,indices){
    if(!previous || !Array.isArray(indices)){
      const owners=new Map(),rows=[]
      for(let id=0;id<source.length;id++){
        const item=row(source[id],id);rows.push(item)
        if(item){if(!owners.has(item.turn))owners.set(item.turn,[]);owners.get(item.turn).push([id,item.source])}
      }
      return {messages:messages.from(rows),turns:turns.from([...owners].map(([turn,entries])=>[turn,positions.from(entries)]))}
    }
    const changes=new Map(),edits=[]
    function change(turn,id,value){
      const old=changes.has(turn)?changes.get(turn):turns.get(previous.turns,turn)
      const next=positions.update(old||positions.from([]),[[id,value]])
      changes.set(turn,next)
    }
    for(const id of indices){
      const before=previous.messages[id],after=row(source[id],id);edits.push([id,after])
      if(before?.turn===after?.turn && before?.source===after?.source)continue
      if(before)change(before.turn,id,undefined)
      if(after)change(after.turn,id,after.source)
    }
    for(let id=source.length;id<previous.messages.length;id++){
      const before=previous.messages[id];if(before)change(before.turn,id,undefined)
    }
    return {messages:messages.update(previous.messages,edits,source.length),turns:turns.update(previous.turns,[...changes].map(([turn,rows])=>[turn,rows.length?rows:undefined]))}
  }
  function get(state,turn){return typeof turn==='number' && !Number.isNaN(turn)?turns.get(state.turns,turn)?.[0]??'':''}
  const bytes=state=>messages.info(state.messages).bytes+turns.info(state.turns).bytes
  const values=(state,turn)=>turns.get(state.turns,turn) || []
  const changed=(before,after)=>turns.changed(before.turns,after.turns).filter(row=>get(before,row.key)!==get(after,row.key)).map(row=>row.key)
  return {update,get,bytes,values,changed}
}
