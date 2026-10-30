import contract from '../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {projectDisplayParts} from './domain/display-source.js'
import {latestSettledModTurn,settledModTurns} from './domain/mods/settled-source.js'
const {modCheck:check,modShape:shape}=contract
const text=message=>projectDisplayParts(message.displayText ?? message.text).parts.filter(part=>part.kind==='markdown').map(part=>part.text).join('\n')

// Read the existing revision-pinned message window, not a director seal or a second history store.
export function createSettledModSource({index,readWindow,readRevision,source}) {
  // A journal-format Chat (older chats, the referenced debug fixture) has no native window (readWindow: null): read
  // its pinned revision whole, as other legacy readers do.
  async function legacyWindow(head) {
    const chat=await readRevision?.(head.id,head._storageRevision)
    return chat?.messages ? {revision:chat._storageRevision,from:0,chat} : null
  }
  async function snapshot(sessionId,{turn,mode='live'}={}) {
    const head=await index(sessionId)
    check(head,'$.context','Session is unavailable','MOD_RESOURCE_UNAVAILABLE')
    const settled=settledModTurns(head),latest=latestSettledModTurn(head)
    turn=mode==='history'?Math.min(turn || 0,latest):latest
    const selected=head.messages.findLastIndex(row=>row.role==='assistant' && settled.has(Number(row.turn || (row.greeting?1:0))) && Number(row.turn || 1)<=turn)
    if(selected<0)return {head,turn:0,source:{branchId:head.timeline.branchId,sourceKey:'',generation:0,textVersion:''},units:[],inputs:[]}
    const turnIds=[...new Set(head.messages.slice(0,selected+1).filter(row=>row.role==='assistant' && settled.has(Number(row.turn || (row.greeting?1:0)))).map(row=>Number(row.turn || 1)))].slice(-20)
    let first=head.messages.findIndex(row=>turnIds.includes(Number(row.turn || (row.greeting?1:0))))
    if(first>0 && head.messages[first-1].role==='user')first--
    // Event disclosure consumes dialogue and source identity, not settled variable payloads.
    const window=await readWindow(head.id,{limit:Math.min(80,selected-first+1),before:selected+1,revision:head._storageRevision,fields:[],
      messageFields:['role','turn','greeting','swipeId','stageDirectionGeneration','sourceText','text','displayText']}) ?? await legacyWindow(head)
    check(window,'$.context','Timeline revision changed','MOD_SOURCE_STALE')
    check(window.revision===head._storageRevision,'$.context','Timeline revision changed','MOD_SOURCE_STALE')
    const message=window.chat.messages[selected-window.from]
    check(message,'$.context','Settled reply is unavailable','MOD_SOURCE_STALE')
    const target=await source(sessionId,Number(message.turn || 1),{branchId:head.timeline.branchId,value:[message.swipeId || 0,message.stageDirectionGeneration || 0,message.sourceText ?? message.text]})
    const rows=window.chat.messages,units=[],inputs=[]
    let following=0
    for(let at=rows.length-1;at>=0;at--) {
      const row=rows[at]
      if(row.role==='assistant')following=Number(row.turn || (row.greeting?1:0))
      if(!turnIds.includes(following))continue
      if(row.role==='assistant')units.unshift({turn:following,text:text(row)})
      if(row.role==='user')inputs.unshift({turn:following,text:text(row)})
    }
    return {head,turn:Number(message.turn || 1),source:target,units,inputs}
  }
  return Object.freeze({snapshot,
    async window(context,input={}) {
      shape(input,['limit'],[])
      const limit=input.limit ?? 80
      check(Number.isSafeInteger(limit) && limit>=1 && limit<=80,'$.limit')
      const value=await snapshot(context.gameId,{turn:context.turn,mode:context.mode})
      check(value.turn===context.turn && value.source.sourceKey===context.source.sourceKey && value.source.generation===context.source.generation && value.source.branchId===context.source.branchId,
        '$.context','Settled Timeline source changed','MOD_SOURCE_STALE')
      return {units:value.units.slice(-limit),inputs:value.inputs.slice(-limit)}
    },
  })
}
