import {randomUUID} from 'node:crypto'
import {createDanmakuRetrieval} from './danmaku-corpus.js'
import {corpusPageSignals} from './danmaku-signals.js'
import {isDeepStrictEqual as equal} from 'node:util'
import contract from '../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {createModEventBus} from './domain/mods/events.js'
import {createModRuntime} from './domain/mods/runtime.js'
import {createModMessageTransport} from './domain/mods/message-transport.js'
import {modCatalogue,modTurnActive} from './domain/mods/catalogue.js'
import {createModVariables} from './domain/mods/variables.js'
import {createSettledModSource} from './mod-source.js'
import {captureStageTarget} from './domain/stage-incremental.js'
import {latestSettledModTurn} from './domain/mods/settled-source.js'
const {modCheck:check,modShape:shape}=contract
const unwrap=async value=>{const result=await value;if(!result.ok)throw Object.assign(new Error(result.error.message),result.error);return result.value}
const publicContext=(value,epoch)=>({modId:'',sessionId:value.head.sessionId,branchId:value.source.branchId,revision:String(value.head._storageRevision),
  sourceKey:value.source.sourceKey,generation:value.source.generation,textVersion:value.source.textVersion,authorityEpoch:epoch,settledTurn:value.turn,mode:value.mode || 'live'})

export function createModSessionEvents({library,builtins,readCard,config,index,readWindow,readRevision,source,variables,epoch,connected=()=>true,onError=()=>{},modelTasks,readAssetText,presentation,catalogues,modelStatus,publishView=()=>{}}) {
  const settled=createSettledModSource({index,readWindow,readRevision,source}),sessions=new Map(),presentations=new Map(),observedRevisions=new Map()
  const retrieve=readAssetText?createDanmakuRetrieval({read:readAssetText}):null
  let live=true,sequence=0
  const clock=row=>row.elapsed+(row.active?Date.now()-row.started:0)
  function clearViews(row) {
    for(const timer of row.timers.values())clearTimeout(timer)
    row.timers.clear();row.views.clear();row.failures?.clear();publishView(row.context.sessionId,{views:[]})
  }
  function presentationView(manifest,view) {
    const values=library.getMod({modId:manifest.id}).settings.values
    const display=Object.fromEntries(manifest.settingsSchema.fields.filter(field=>field.presentation).map(field=>[field.key,values[field.key]]))
    return builtins.presentation?.(manifest.id)?.settings?.(view,display) || view
  }
  function accept(row,manifest,context,result,valid) {
    clearTimeout(row.timers.get(manifest.id));row.timers.delete(manifest.id)
    if(!valid() || !result?.view || !row.active)return
    if(Number.isFinite(result.view.activeTimeMs)){row.elapsed=Math.max(clock(row),result.view.activeTimeMs);row.started=Date.now()}
    if(row.failures?.has(manifest.id))result={...result,view:{...result.view,status:'error',error:row.failures.get(manifest.id)}}
    const view=manifest.id==='dsh.danmaku'?{...result.view,streamer:row.streamer,provisional:!!row.provisional,...(row.display.displayToken?{displayToken:row.display.displayToken}:{}),displayTurn:row.provisional?row.display.turn:context.settledTurn}:result.view
    row.views.set(manifest.id,{modId:manifest.id,manifest,context,view:presentationView(manifest,view)})
    publishView(context.sessionId,{views:[...row.views.values()]})
    // History wakes only the audience's settle-delayed page backfill (「像看录播」).
    if(context.mode!=='live' && manifest.id!=='dsh.danmaku' || result.wakeAfterMs===null || !Number.isFinite(result.wakeAfterMs))return
    const timer=setTimeout(()=>{row.timers.delete(manifest.id);void enqueue(async()=>{
      if(!valid() || !row.active)return
      const fresh=await prepare(context.sessionId)
      if(fresh!==row || !valid())return
      row.bus.publish({modId:manifest.id,event:'mod.context.changed',context:row.context,payload:{reason:'cadence'}})
    })},Math.max(1,result.wakeAfterMs))
    timer.unref?.();row.timers.set(manifest.id,timer)
  }
  const enabled=()=>[undefined,...Object.keys(library.snapshot().cards)].some(cardId=>library.active(cardId).some(manifest=>manifest.subscriptions?.length))
  function current(context) {
    return live && context.authorityEpoch===epoch() && library.authority(context.modId,context.cardId)===context.authority
  }
  async function sourceCurrent(context,head) {
    if(!current(context) || head?.timeline.branchId!==context.source.branchId)return false
    const value=await settled.snapshot(context.gameId,{turn:context.turn,mode:context.mode})
    return value.turn===context.turn && equal(value.source,context.source)
  }
  async function deliver(row,manifest,event) {
    const activityVersion=row.activityVersion,value=row.snapshot,card=row.card,mod=library.snapshot().mods[manifest.id]
    const display=presentations.get(event.context.sessionId)
    const modelEvent=event.event==='model.output' || event.event==='model.completed'
    // Page preparation may lag the display notification. Never lose a terminal model event in that gap.
    if(!modelEvent && display?.anchor && (!equal(row.display?.anchor,display.anchor) || event.payload.anchor && !equal(event.payload.anchor,display.anchor)))return
    const context={modId:manifest.id,modRevision:mod.releaseRevision,cardId:card.meta.id,gameId:value.head.sessionId,turn:value.turn,
      source:value.source,mode:event.context.mode,authorityEpoch:event.context.authorityEpoch,authority:library.authority(manifest.id,card.meta.id),sessionEvent:true}
    const owner=JSON.stringify([context.gameId,manifest.id,context.authorityEpoch])
    const cleanup=event.event==='session.disposed'
    const sourceValid=()=>cleanup || activityVersion===row.activityVersion && !row.closed && row.admitted.has(manifest.id) && current(context) && row.context.branchId===event.context.branchId && row.context.sourceKey===event.context.sourceKey && row.context.generation===event.context.generation && row.context.mode===event.context.mode && row.context.textVersion===event.context.textVersion
    const commentCurrent=()=>{const latest=presentations.get(event.context.sessionId);return sourceValid() && latest?.active && latest.mode===display?.mode && latest.turn===display?.turn && latest.displayToken===display?.displayToken}
    const valid=()=>modelEvent?commentCurrent():display===presentations.get(event.context.sessionId) && sourceValid()
    if(config && manifest.variableSlots?.length && value.turn && !cleanup) {
      const turn=await variables().readTurn(context,value.turn)
      context.variableBindings=await config.bindings(manifest,card,value.head,turn.sources)
    }
    const catalogue=row.catalogues?.[manifest.id]
    const settings={...library.getMod({modId:manifest.id,cardId:card.meta.id}).settings.values,...(manifest.id==='dsh.danmaku'?row.danmakuSettings:{})}
    const models=await modelStatus?.(manifest,context.gameId) || {}
    const shown=modelEvent?presentations.get(event.context.sessionId):row.display
    const anchor={sourceKey:event.context.sourceKey,part:'body',paragraph:1,charOffset:0,...shown?.anchor}
    context.anchor=anchor
    const payload={...event.payload,provisional:!!row.provisional,pageReady:!row.provisional || !!shown?.pageText,...(shown?.visit?{visit:shown.visit}:{}),...(shown?.rapid?{rapid:true}:{}),
      ...(manifest.id==='dsh.danmaku' && shown?.pages?.length?{pages:shown.pages}:{}),active:row.active,anchor,activeTimeMs:clock(row),host:{
      entries:catalogue?.packs.flatMap(pack=>pack.entries) || [],settings,models}}
    const adapter=builtins.presentation?.(manifest.id)
    let transport
    const hostCalls=new Set()
    const runtime=createModRuntime({builtins,current:valid,resolveBuiltin:()=>mod.origin?.builtinId || manifest.id,
      createHost(_context,callCurrent) {
        const host=createModVariables({...variables(),manifest,context,current:callCurrent}),token=randomUUID()
        transport=createModMessageTransport({context:event.context,token,current:()=>!cleanup && callCurrent(),methods:{
          'host.danmaku.retrieve':async args=>{
            // Free keyword matching: live pages and the history-page backfill (「像看录播」) alike.
            check(manifest.id==='dsh.danmaku' && row.active,'$.activity','Retrieval requires the active audience mod','MOD_PERMISSION_DENIED')
            shape(args,['pages','budget','recent'])
            check(Array.isArray(args.pages) && args.pages.length<=4 && Number.isInteger(args.budget) && args.budget>=0 && args.budget<=12,'$.pages')
            const supplied=shown?.pages || []
            check(args.pages.every(p=>supplied.some(s=>s.index===p.index && s.text===p.text)),'$.pages','Reading source changed','MOD_SOURCE_STALE')
            const canonical=args.pages.map(p=>supplied.find(s=>s.index===p.index && s.text===p.text))
            const result=retrieve?await retrieve(payload.host.entries,{...args,pages:corpusPageSignals(canonical,value.units,value.turn)}):{comments:[]}
            check(valid(),'$.source','Retrieval source changed','MOD_SOURCE_STALE')
            return result
          },
          'host.models.request':async args=>{
            check(modelTasks,'$.models','Model service unavailable','MOD_RESOURCE_UNAVAILABLE')
            check(row.active && context.mode==='live','$.activity','Model requests need an active live stage','MOD_SOURCE_STALE')
            check(!row.failures?.has(manifest.id),'$.source','Reopen the stage after a mod callback failure','MOD_RUNTIME_FAILED')
            return modelTasks.request({manifest,owner,sessionId:context.gameId,
              current:()=>(args.purpose==='comments'?commentCurrent():display===presentations.get(event.context.sessionId) && sourceValid()) && row.active && context.mode==='live' && connected(context.gameId),
              window:async()=>{check(valid() && display===presentations.get(event.context.sessionId),'$.source','Model source changed','MOD_SOURCE_STALE');return manifest.id==='dsh.danmaku' && args.purpose==='comments' && args.input.pages?.length?{units:[],inputs:[]}:{units:structuredClone(value.units),inputs:structuredClone(value.inputs)};},
              prompts:async slotId=>manifest.prompts.filter(prompt=>prompt.target==='model' && prompt.modelSlot===slotId)
                .sort((a,b)=>a.placement.order-b.placement.order || a.id.localeCompare(b.id)).map(prompt=>({key:'mod.'+manifest.id+'.'+prompt.id,text:builtins.file(mod.origin?.builtinId || manifest.id,prompt.path).toString('utf8')})),
              deliver:payload=>row.bus.publish({event:payload.status==='streaming'?'model.output':'model.completed',modId:manifest.id,context:event.context,payload})},args)
          },
          'host.models.cancel':args=>{shape(args,['operationId']);return modelTasks?.cancel(owner,args) || {cancelled:false}},
          ...(adapter && presentation?{
            'host.presentation.publish':args=>{shape(args,['view']);accept(row,manifest,event.context,{view:args.view,wakeAfterMs:null},valid);return {}},
            'host.presentation.read':args=>row.provisional?adapter.read(row.transient || adapter.empty(),{anchor:args.anchor,sources:[{...context.source,sessionId:context.gameId}]}):presentation.read(context,adapter,args),
            'host.presentation.append':(args,{isCurrent})=>{
              // History writes are the page's one corpus backfill (the adapter enforces it).
              check(row.active,'$.activity','Presentation needs an active stage','MOD_SOURCE_STALE')
              if(row.provisional) {
                const next=adapter.append(row.transient || adapter.empty(),args,{source:{...context.source,sessionId:context.gameId},turn:context.turn,active:row.active,mode:context.mode,anchorAllowed:anchor=>equal(anchor,context.anchor)})
                row.transient=next.state;return next.receipt
              }
              return presentation.append(context,adapter,args,()=>valid() && isCurrent() && row.active && connected(context.gameId))
            },
          }:{}),
          'host.source.window':async args=>{
            check(manifest.permissions.source?.includes('dialogue'),'$.source','Source permission required','MOD_PERMISSION_DENIED')
            return {context:event.context,...await settled.window(context,args)}
          },
          'host.variables.getTurn':args=>unwrap(host.getTurn(args)),
          'host.variables.patch':args=>unwrap(host.patch(args)),
          'host.variables.setVariables':args=>unwrap(host.setVariables(args)),
        }})
        return {request:async input=>{
          shape(input,['requestId','method','args'])
          const call={method:input.method,started:Date.now()};hostCalls.add(call)
          try {return await transport.dispatch({channel:'dsh-mod',version:2,token,...input})}
          finally {hostCalls.delete(call)}
        }}
      }})
    try {
      const result=await runtime.invoke(event.context,'event',{...event,payload})
      if(result.ok && !cleanup)accept(row,manifest,event.context,result.value,valid)
      if(!result.ok && result.error.code!=='MOD_SOURCE_STALE') {
        // A deadline alone cannot distinguish a blocked write from model selection or source reads.
        const pending=[...hostCalls.values()].map(call=>call.method+' ('+Math.max(0,Date.now()-call.started)+'ms)')
        const error=pending.length?{...result.error,message:result.error.message+'; pending: '+pending.join(', ')}:result.error
        const previous=row.views.get(manifest.id)
        const view=adapter?.failure?.(event.context,payload,error) || (previous?{...previous.view,status:'error',error}:null)
        if(view && valid()) {
          row.failures ||= new Map();row.failures.set(manifest.id,error)
          accept(row,manifest,event.context,{view,wakeAfterMs:null},valid)
        }
        onError(error)
      }
    } finally {transport?.revoke();runtime.dispose()}
  }
  async function prepare(sessionId,display) {
    display=presentations.get(sessionId) || display || sessions.get(sessionId)?.display
    let value=await settled.snapshot(sessionId,display)
    const prior=sessions.get(sessionId),operations=Object.values(value.head.timeline?.operations || {}).filter(op=>op.kind==='body' && op.turn===display?.turn && op.basedOn?.branchId===value.head.timeline.branchId)
    // Committing this same displayed body is not a page replacement. Keep its transient
    // reaction lease across page advances; failed/cancelled bodies and new operations still revoke it.
    const samePage=prior?.display.turn===display?.turn && prior?.display.displayToken===display?.displayToken
    const provisional=display?.active && display.mode==='live' && (operations.find(op=>op.status==='running') ||
      samePage && operations.find(op=>op.id===prior?.provisional?.id && op.status==='completed'))
    if(provisional)value={...value,source:{...value.source,sourceKey:'presentation:'+provisional.id,textVersion:provisional.id,generation:0},units:display.pageText?[...value.units,{turn:display.turn,text:display.pageText.text,provisional:true}]:value.units}
    const card=await readCard(value.head.cardPath)
    if(!live || !card)return null
    const manifests=library.active(card.meta.id).filter(manifest=>manifest.subscriptions?.length)
    const views=await catalogues?.(value,manifests)
    const admitted=new Set(manifests.filter(manifest=>modTurnActive(manifest,views?.[manifest.id] || modCatalogue(manifest,library.getMod({modId:manifest.id,cardId:card.meta.id}).packs,library.listModPacks({modId:manifest.id,cardId:card.meta.id}).packs,value.units.map(row=>row.text).join('\n')))).map(row=>row.id))
    if(!manifests.length)return null
    let row=sessions.get(sessionId)
    if(!row || row.closed || row.epoch!==epoch()) {
      row?.bus.dispose(row.context)
      row={bus:createModEventBus({onError,nextSequence:()=>++sequence}),epoch:epoch(),observed:null,active:false,activityVersion:0,elapsed:0,started:Date.now(),timers:new Map(),views:new Map()};sessions.set(sessionId,row)
      for(const manifest of manifests)row.bus.subscribe({modId:manifest.id,subscriptions:[...manifest.subscriptions,...(manifest.modelSlots?.length?['model.output','model.completed'].map(event=>({event,delivery:'active'})):[])],
        current:dto=>live && !row.closed && row.admitted.has(manifest.id) && row.epoch===epoch() && !!library.authority(manifest.id,card.meta.id) && row.context.branchId===dto.branchId && row.context.sourceKey===dto.sourceKey && row.context.generation===dto.generation && row.context.mode===dto.mode,
        deliver:event=>deliver(row,manifest,event)})
    }
    if(row.context && (row.context.sourceKey!==value.source.sourceKey || row.context.mode!==(display?.mode || 'live') || [...row.admitted].some(id=>!admitted.has(id))))clearViews(row)
    if(row.admitted)for(const id of row.admitted)if(!admitted.has(id))row.bus.publish({modId:id,event:'session.disposed',context:row.context})
    row.provisional=provisional
    if(!provisional)row.transient=null
    // Config writes invalidate the session owner; do not reread card settings for every streamed line.
    // A host face that could not be read yet (transient) is read again after a short wait, not kept neutral all session.
    if(!row.streamer || row.card?.meta.id!==card.meta.id || row.streamerRetryAt && Date.now()>=row.streamerRetryAt) {
      row.streamer=await config?.readStreamer?.(card.meta.id,{sessionId}) || {name:'',avatarRef:null}
      row.streamerRetryAt=row.streamer.transient?Date.now()+5000:0
      row.danmakuSettings=await config?.readDanmakuSettings?.(card.meta.id) || {}
    }
    row.catalogues=views
    row.display={...row.display,...display}
    row.admitted=admitted
    row.snapshot={...value,mode:display?.mode || 'live'};row.card=card;row.context=publicContext(row.snapshot,row.epoch)
    modelTasks?.invalidate()
    return row
  }
  let queue=Promise.resolve()
  const enqueue=fn=>{queue=queue.then(()=>live && fn()).catch(onError);return queue}
  return Object.freeze({sourceCurrent,
    stageEvent(sessionId,event) {
      const row=sessions.get(sessionId)
      if(row && !row.closed && row.active && row.context.mode==='live' && event.source?.sourceKey===row.context.sourceKey && event.source.branchId===row.context.branchId && event.source.generation===row.context.generation)
        row.bus.publish({eventId:event.id,event:event.type,context:row.context,payload:event})
    },
    presentationSettings(changes) {
      for(const row of sessions.values()) {
        let changed=false
        for(const [id,entry] of row.views)if(changes[id]) {
          const view=presentationView(entry.manifest,entry.view)
          row.views.set(id,{...entry,view});changed=true
          // Off/on changes scheduling as well as appearance; wake the controller without revoking its source.
          if((entry.view.settings?.view==='off')!==(view.settings?.view==='off'))row.bus.publish({modId:id,event:'mod.context.changed',context:row.context,payload:{reason:'settings'}})
        }
        if(changed)publishView(row.context.sessionId,{views:[...row.views.values()]})
      }
    },
    views(sessionId){return {views:[...(sessions.get(sessionId)?.views.values() || [])]}},
    refresh() {
      for(const row of sessions.values()){row.activityVersion++;row.streamer=null;clearViews(row)}
      modelTasks?.invalidate()
      void enqueue(async()=>{for(const id of sessions.keys()){
        const row=await prepare(id)
        if(row)row.bus.activity(row.active,row.context,{},'assets')
      }})
    },
    observe(head) {
      if(!enabled())return
      // The host reports the same stored Chat revision many times a second while a stage reads (「翻历史没有
      // 弹幕」: ~300 identical observations a minute). Each queued a full session prepare (~1 s) on the one
      // serial queue, so a history page's only display event waited behind them and never showed. An unchanged revision
      // carries no new fact.
      const seenKey=Number.isSafeInteger(head._storageRevision) ? JSON.stringify([head._storageRevision,head.timeline?.branchId,head.messages?.length,
        Object.values(head.timeline?.operations || {}).map(op=>[op.id,op.status])]) : null
      if(seenKey && observedRevisions.get(head.sessionId)===seenKey)return
      observedRevisions.set(head.sessionId,seenKey)
      while(observedRevisions.size>64)observedRevisions.delete(observedRevisions.keys().next().value)
      const prior=sessions.get(head.sessionId)
      if(prior) {
        const turn=prior.context.mode==='history'?prior.snapshot.turn:latestSettledModTurn(head)
        const index=head.messages.findLastIndex(row=>row.role==='assistant' && Number(row.turn || (row.greeting?1:0))===turn)
        const replaced=prior.provisional ? !Object.values(head.timeline?.operations || {}).some(op=>op.id===prior.provisional.id && ['running','completed'].includes(op.status) && op.basedOn?.branchId===head.timeline.branchId) : prior.context.branchId!==head.timeline?.branchId || turn!==prior.snapshot.turn ||
          index>=0 && typeof head.messages[index].text==='string' && captureStageTarget(head,index).sourceKey!==prior.context.sourceKey
        if(replaced){prior.activityVersion++;clearViews(prior);modelTasks?.invalidate()}
      }
      // Capture only committed operation facts. No raw Chat is queued or sent to a mod.
      const fact={sessionId:head.sessionId,branchId:head.timeline?.branchId,revision:head._storageRevision,
        operations:Object.values(head.timeline?.operations || {}).filter(op=>op.kind==='body').map(op=>({id:op.id,status:op.status,turn:op.turn,userText:op.userText || ''}))}
      void enqueue(async()=>{
        const priorContext=sessions.get(fact.sessionId)?.context
        const row=await prepare(fact.sessionId)
        if(!row)return
        const previous=row.observed;row.observed=fact
        const publish=(event,op,payload)=>row.bus.publish({eventId:op.id+':'+event+':'+op.status,event,context:row.context,payload})
        if(priorContext && ['branchId','sourceKey','generation'].some(key=>priorContext[key]!==row.context[key]))
          row.bus.publish({eventId:'timeline:'+fact.revision,event:'timeline.changed',context:row.context,payload:{revision:String(fact.revision)}})
        for(const op of fact.operations) {
          const old=previous?.operations.find(item=>item.id===op.id)
          if(old?.status===op.status)continue
          if(op.status==='running' && !old) {
            publish('player.input',op,{operationId:op.id,turn:op.turn,text:op.userText})
            publish('generation.started',op,{operationId:op.id,turn:op.turn})
          } else if(old && ['completed','failed','cancelled'].includes(op.status)) {
            publish('generation.ended',op,{operationId:op.id,turn:op.turn,status:op.status})
            if(op.status==='completed')publish('round.committed',op,{operationId:op.id,turn:op.turn})
          }
        }
      })
    },
    settlement(sessionId,payload) {
      if(!enabled())return
      void enqueue(async()=>{const row=await prepare(sessionId);if(row)row.bus.publish({eventId:'settlement:'+payload.revision,event:'settlement.completed',context:row.context,payload})})
    },
    presentation(sessionId,input) {
      if(!enabled())return {accepted:true}
      shape(input,['event','active','mode','turn','anchor','performanceId','phase','revealed','displayToken','pages','visit','rapid'],['event','active','mode','turn'])
      if(input.rapid!==undefined)check(input.rapid===true && input.mode==='history','$.rapid')
      check(['stage.entered','stage.left','page.changed','text.available','text.revealed','performance.presented','activity.changed','session.disposed'].includes(input.event),'$.event')
      if(input.displayToken!==undefined)check(typeof input.displayToken==='string' && input.displayToken.length<=4096,'$.displayToken')
      if(input.anchor!==undefined) {shape(input.anchor,['paragraph','charOffset']);check(Number.isSafeInteger(input.anchor.paragraph) && input.anchor.paragraph>=1 && Number.isSafeInteger(input.anchor.charOffset) && input.anchor.charOffset>=0,'$.anchor')}
      if(input.pages!==undefined) {
        check(Array.isArray(input.pages) && input.pages.length>0 && input.pages.length<=4,'$.pages')
        for(const [index,page] of input.pages.entries()) {
          shape(page,['index','anchor','text'])
          shape(page.anchor,['paragraph','charOffset'])
          check(Number.isSafeInteger(page.index) && page.index>=0 && (!index || page.index===input.pages[index-1].index+1) &&
            Number.isSafeInteger(page.anchor.paragraph) && page.anchor.paragraph>=1 && Number.isSafeInteger(page.anchor.charOffset) && page.anchor.charOffset>=0 &&
            typeof page.text==='string' && page.text.length>0 && page.text.length<=2000,'$.pages['+index+']')
        }
        check(equal(input.pages[0].anchor,input.anchor),'$.pages[0].anchor','First page must be the visible page')
      }
      if(input.revealed!==undefined) {
        shape(input.revealed,['id','text'])
        check(['text.available','text.revealed'].includes(input.event) && typeof input.revealed.id==='string' && input.revealed.id.length<=1024 && typeof input.revealed.text==='string' && input.revealed.text.length<=8000,'$.revealed')
      }
      for(const key of ['performanceId','phase','visit'])if(input[key]!==undefined)check(typeof input[key]==='string' && input[key].length<=512,'$.'+key)
      check(typeof input.active==='boolean' && ['live','history'].includes(input.mode) && Number.isSafeInteger(input.turn) && input.turn>=0,'$.context')
      const previous=presentations.get(sessionId)
      const next={active:input.active,mode:input.mode,turn:input.turn,anchor:input.anchor || previous?.anchor || {paragraph:1,charOffset:0},disposed:input.event==='session.disposed',visit:input.visit ?? null,rapid:input.rapid===true,
        displayToken:input.displayToken ?? (previous?.turn===input.turn?previous.displayToken:undefined),
        pageText:input.event==='text.available'?input.revealed:previous?.turn===input.turn && (!input.anchor || equal(input.anchor,previous?.anchor))?previous?.pageText:undefined,
        pages:input.pages ?? (previous?.turn===input.turn && (!input.anchor || equal(input.anchor,previous?.anchor))?previous?.pages:undefined)}
      // Growing visible text enriches the same page; it must not revoke its pending reaction.
      const samePage=previous && equal({...previous,pageText:undefined,pages:undefined},{...next,pageText:undefined,pages:undefined})
      const display=samePage?previous:structuredClone(next)
      if(samePage){display.pageText=next.pageText;display.pages=next.pages}
      presentations.set(sessionId,display)
      if(display!==previous) {
        // Revoke obsolete page work on receipt, not after slow source reads drain the queue.
        const row=sessions.get(sessionId)
        const activityOnly=previous && equal({...previous,active:undefined},{...next,active:undefined}) && input.event==='activity.changed'
        if(row && !activityOnly)clearViews(row)
        modelTasks?.invalidate()
      }
      void enqueue(async()=>{
        if(presentations.get(sessionId)!==display)return
        // Opening a history round loads its packs, which can bump the asset generation while this page's catalogue is
        // read (REVISION_CONFLICT). Live recovers on its cadence wake; a history page has no wake, so its one display
        // event would be lost and the page stay blank. Read again while still shown.
        let row
        for(let attempt=0;;attempt++) {
          try {row=await prepare(sessionId,input);break}
          catch(error) {
            if(error?.code!=='REVISION_CONFLICT' || attempt>=3 || presentations.get(sessionId)!==display)throw error
            await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)))
          }
        }
        if(!row || presentations.get(sessionId)!==display)return
        if(input.event==='text.revealed' && input.revealed && !row.snapshot.units.some(unit=>unit.turn===row.snapshot.turn && unit.text.includes(input.revealed.text)))return
        const active=input.active && connected(sessionId)
        // Mount/connect can report the same activity several times; only a transition revokes active work.
        if(row.active!==active) {
          row.elapsed=clock(row);row.started=Date.now();row.active=active;row.activityVersion++;
          // Text stays in the source window; copying it into lifecycle events can exceed the envelope budget.
          if(!row.active) {
            if(input.event==='activity.changed') {
              // Visibility pauses generation and the clock, not the user's selected room layout.
              for(const [id,entry] of row.views)row.views.set(id,{...entry,view:{...entry.view,active:false,activeTimeMs:row.elapsed,status:'paused'}})
              for(const timer of row.timers.values())clearTimeout(timer)
              row.timers.clear();publishView(sessionId,{views:[...row.views.values()]})
            } else clearViews(row)
          }
          row.bus.activity(row.active,row.context,{},'presentation');modelTasks?.invalidate()
        } else if(input.event==='activity.changed')row.bus.publish({event:'mod.context.changed',context:row.context,payload:{reason:'snapshot'}})
        if(input.event==='session.disposed'){
          row.closed=true;clearViews(row);row.bus.dispose(row.context);observedRevisions.delete(sessionId)
          void row.bus.idle().then(()=>{if(sessions.get(sessionId)===row)sessions.delete(sessionId)})
          return
        }
        if(input.event!=='activity.changed')row.bus.publish({eventId:randomUUID(),event:input.event,context:row.context,payload:input})
      })
      return {accepted:true}
    },
    disconnected(ids) {
      for(const id of ids) {
        const row=sessions.get(id)
        if(!row || connected(id))continue
        row.elapsed=clock(row);row.active=false;row.activityVersion++;clearViews(row)
        row.bus.activity(false,row.context,{},'transport');modelTasks?.invalidate()
      }
    },
    async idle(){await queue;await Promise.all([...sessions.values()].map(row=>row.bus.idle()))},
    dispose(){live=false;for(const row of sessions.values()){clearViews(row);row.bus.dispose(row.context)}sessions.clear();presentations.clear();observedRevisions.clear();modelTasks?.invalidate()},
  })
}
