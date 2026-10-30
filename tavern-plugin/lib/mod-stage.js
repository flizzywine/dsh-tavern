import {isDeepStrictEqual as equal} from 'node:util'
import {captureStageTarget} from './domain/stage-incremental.js'
import {MOD_CORRECTIONS_FIELD} from './domain/mods/stage-corrections.js'

// Only the existing serialized Chat Persistence writer may publish the derived layer.
// readChat reads the whole chat (presentation history spans every floor); readTurn(sessionId, turn) the round view through
// one turn, which carries that floor's corrections and the source prefix.
export function createModStagePort({readChat,readTurn=readChat,readSource=readChat,updateChat,readCard,publish}) {
  let revision=Date.now()
  function message(chat,context) {
    const index=chat?.messages.findLastIndex(row=>row.role==='assistant' && Number(row.turn || (row.greeting?1:0))===context.turn)
    if(index===undefined || index<0 || chat.timeline.branchId!==context.source.branchId || chat.regenInProgress)throw stale()
    const row=chat.messages[index]
    if((row.stageDirectionGeneration || 0)!==context.source.generation || captureStageTarget(chat,index).sourceKey!==context.source.sourceKey)throw stale()
    return row
  }
  const stale=()=>Object.assign(new Error('Mod stage source changed'),{code:'MOD_SOURCE_STALE'})
  return {
    presentation:{
      async read(context,adapter,{anchor}) {
        const chat=await readChat(context.gameId),row=message(chat,context)
        const current=row.modPresentations?.[context.modId] || adapter.empty(),rows=[],sources=[]
        for(const [index,item] of chat.messages.entries()) {
          if(item.role!=='assistant' || Number(item.turn || (item.greeting?1:0))>context.turn)continue
          const target=captureStageTarget(chat,index)
          sources.push({sessionId:context.gameId,branchId:target.branchId,sourceKey:target.sourceKey,generation:item.stageDirectionGeneration || 0,textVersion:target.sourceKey})
          rows.push(...(item.modPresentations?.[context.modId]?.rows || []))
        }
        return adapter.read({...current,rows},{anchor,sources})
      },
      async append(context,adapter,args,current) {
        const chat=await readTurn(context.gameId,context.turn)
        if(!chat)throw stale()
        let receipt
        await updateChat(chat.id,async draft=>{
          const row=message(draft,context),card=await readCard(draft.cardPath)
          if(!current() || card?.meta.id!==context.cardId)throw stale()
          const result=adapter.append(row.modPresentations?.[context.modId] || adapter.empty(),args,{
            source:{sessionId:context.gameId,...context.source},turn:context.turn,active:true,mode:context.mode,
            anchorAllowed:anchor=>equal(anchor,context.anchor)})
          receipt=result.receipt
          if(!result.changed)return undefined
          row.modPresentations={...row.modPresentations,[context.modId]:result.state}
          return draft
        },{source:'mod-presentation',touchUpdatedAt:false})
        return receipt
      },
    },
    async source(sessionId,turn,expected) {
      // Source identity needs the complete text prefix, not variables or presentation history.
      const chat=await readSource(sessionId,turn),index=chat?.messages.findLastIndex(row=>row.role==='assistant' && Number(row.turn || (row.greeting?1:0))===turn)
      if(index===undefined || index<0 || chat.timeline.branchId!==expected.branchId)throw stale()
      const row=chat.messages[index]
      if(!equal([row.swipeId || 0,row.stageDirectionGeneration || 0,row.sourceText ?? row.text],expected.value))throw stale()
      const target=captureStageTarget(chat,index)
      return {branchId:target.branchId,sourceKey:target.sourceKey,generation:row.stageDirectionGeneration || 0,textVersion:target.sourceKey}
    },
    async read(context) {return message(await readTurn(context.gameId,context.turn),context)[MOD_CORRECTIONS_FIELD]},
    async readPresentation(context) {
      const chat=await readTurn(context.gameId,context.turn),row=message(chat,context),card=await readCard(chat.cardPath)
      return {cardId:card?.meta.id,store:row[MOD_CORRECTIONS_FIELD]}
    },
    async update(context,mutate,current) {
      const chat=await readTurn(context.gameId,context.turn)
      if(!chat)throw stale()
      await updateChat(chat.id,async draft=>{
        const row=message(draft,context),card=await readCard(draft.cardPath)
        if(!current() || card?.meta.id!==context.cardId)throw stale()
        const next=mutate(row[MOD_CORRECTIONS_FIELD])
        if(!next)return undefined
        row[MOD_CORRECTIONS_FIELD]=next
        return draft
      },{source:'mod-corrections',touchUpdatedAt:false})
    },
    publish:context=>publish({kind:'stage-direction',sessionId:context.gameId,turn:context.turn,version:'mod:'+(++revision)}),
  }
}
