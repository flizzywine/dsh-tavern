import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modJson,modFreeze}=contract
export const MOD_EVENTS=Object.freeze(['timer.timeup','stage.entered','stage.left','page.changed','text.available','text.revealed','performance.presented','player.input','generation.started','generation.ended','round.committed','settlement.completed','timeline.changed','activity.changed','mod.context.changed','session.disposed'])

// Notifications never join a Timeline commit lock. Each subscriber has one ordered queue.
export function createModEventBus({onError=()=>{},nextSequence}={}) {
  const subscribers=new Set(),seen=new Set()
  let seq=0,active=false,disposed=false
  function publish({eventId,event,context,payload={},modId}) {
    if(disposed || eventId && seen.has(eventId))return
    modJson(payload)
    const sequence=nextSequence?nextSequence():++seq
    eventId ??= context.sessionId+':'+context.authorityEpoch+':'+sequence
    seen.add(eventId);if(seen.size>256)seen.delete(seen.values().next().value)
    for(const row of subscribers) {
      if(modId && row.modId!==modId)continue
      const subscription=row.subscriptions.find(item=>item.event===event)
      if(!subscription || subscription.delivery==='active' && !active)continue
      const message=modFreeze({channel:'dsh-mod',version:2,type:'event',eventId,seq:sequence,event,
        context:{...structuredClone(context),modId:row.modId},payload:structuredClone(payload)})
      const activityEpoch=row.activityEpoch
      row.tail=row.tail.then(async()=>{
        if(!row.live || event!=='session.disposed' && !row.current(message.context) || subscription.delivery==='active' && (!active || activityEpoch!==row.activityEpoch))return
        await row.deliver(message)
      }).catch(onError)
    }
  }
  return Object.freeze({publish,
    subscribe(input) {
      const row={...input,tail:Promise.resolve(),live:true,activityEpoch:0};subscribers.add(row)
      return ()=>{row.live=false;subscribers.delete(row)}
    },
    activity(value,context,snapshot,reason='visibility') {
      active=!!value
      for(const row of subscribers)row.activityEpoch++
      publish({event:'activity.changed',context,payload:{active,reason}})
      if(active)publish({event:'mod.context.changed',context,payload:{reason:'snapshot',snapshot}})
    },
    async idle(){await Promise.all([...subscribers].map(row=>row.tail))},
    dispose(context) {
      if(disposed)return
      publish({event:'session.disposed',context})
      disposed=true;active=false
      for(const row of subscribers)row.activityEpoch++
    },
  })
}
