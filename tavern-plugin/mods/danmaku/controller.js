import {randomUUID} from 'node:crypto'
import {emptyMetricsState,advanceMetrics,metricsBasis} from './metrics.js'
import {compactAudienceInput} from './input.js'
import {CORPUS_EXTENSION} from './corpus.js'
import {createAudiencePresets,paceComments,presetExamples} from './presets.js'
import {createViewerCounter,cadenceForSettings,sourceOf,sourceKey,anchorKey,refKey,parseComments,parseCommentLine,parseMemory,projectView,defaultModel} from './contract.js'

const coolingMs = 30000
// Typing time is right-skewed, with a length-dependent mode. Seed by comment identity so replay is stable.
export const DANMAKU_LATE_MS = 12000
// 「像看录播」 settle: history paged through quickly plays nothing until the reader stays this long.
export const HISTORY_SETTLE_MS = 1000
export function naturalViewerDelay({id,text}) {
  let seed=0
  for(const char of id)seed=(Math.imul(seed,31)+char.codePointAt(0))>>>0
  const draw=()=>{
    seed=(seed+0x6D2B79F5)|0
    let x=Math.imul(seed^seed>>>15,1|seed)
    x=x+Math.imul(x^x>>>7,61|x)^x
    return (((x^x>>>14)>>>0)+0.5)/4294967296
  }
  const length=Array.from(text.trim()).length,mode=length<=4?250+150*length:800+280*length,sigma=0.28
  const normal=Math.sqrt(-2*Math.log(draw()))*Math.cos(2*Math.PI*draw())
  // Bound typing to the freshness window; only actual late arrival/queueing should discard a reaction.
  return Math.min(DANMAKU_LATE_MS-1000,mode*Math.exp(sigma*sigma+sigma*normal))
}
const stimulus = new Map([['stage.entered',80],['text.available',80],['page.changed',80],['performance.presented',100],['player.input',90]])

// Host calls exist only during handle(); timers must re-enter through a fresh event lease.
export function createDanmakuController({now=Date.now,id=randomUUID,random=Math.random,viewerDelay=naturalViewerDelay}={}) {
  const presets=createAudiencePresets({now,id,random,chatId:()=>context?.sessionId ?? ''})
  let context,anchor=null,groups=[],settings={},model=defaultModel(),active=false,disposed=false
  let clock=0,heatPeak=0,heatAt=0,revision='0',records=[],memory='',hydrated=false
  let pending=null,memoryDue=null,memoryDone=false,waiting=false,error=null,lastBatchEnd=0,generating=false
  let reactionVersion=0,textReady=true,page=null,pagePlan=[],ready=[],planned=new Set(),stimulusAt=0
  const shown=new Map() // anchorKey -> activeTimeMs the page was last shown (this source)
  const backfilled=new Set() // history pages already matched against the corpus by this controller
  let starts=[],lastStart=-Infinity,lastInput=null,presented=[],viewport={width:0,height:0},safeRegions=[]
  let aiCredit=0,entryReaction=true
  const prepared=new Map() // Local reactions and quota accrual survive a rejected model admission.
  const aiRatio=()=>settings.aiRatio ?? 25
  const hasCorpus=()=>groups.some(group=>group.extensions?.[CORPUS_EXTENSION])
  const seen=new Set()
  const heat=()=>Math.round(heatPeak*Math.max(0,1-(clock-heatAt)/coolingMs))
  const viewers=createViewerCounter()
  let metricsState=emptyMetricsState()
  const online=()=>viewers.value(context?.sessionId ?? '',groups.length,now(),heat())
  const displayEnabled=()=>active && !disposed && settings.view!=='off' && context?.mode==='live' && groups.length>0 && hydrated
  const enabled=()=>displayEnabled() && model.available && textReady && aiRatio()>0
  const comments=()=>records.filter(row=>row.record.type==='batch').flatMap(row=>row.record.batch.comments)
  const targets=()=>pagePlan.filter(row=>row.index>=page.index && !planned.has(anchorKey(row.anchor))).slice(0,Math.min(4,settings.commentsPerRequest ?? 6))
  const late=(row,at)=>Number.isFinite(row.sourcePage?.shownAtMs) && at-row.sourcePage.shownAtMs>DANMAKU_LATE_MS
  function tag(rows,sourcePage,timing) {
    return rows.map(row=>({...row,sourcePage:structuredClone(sourcePage),timing}))
  }
  async function release(host,rows,operationId,timing) {
    ready.push(...rows.filter(row=>row.sourcePage.index>page.index))
    // A shown page's reaction trails its own show time; a page skipped unseen gets none.
    rows=rows.filter(row=>row.sourcePage.index<=page.index && shown.has(anchorKey(row.sourcePage.anchor))).map(row=>{
      const shownAtMs=shown.get(anchorKey(row.sourcePage.anchor))
      return {...row,sourcePage:{...row.sourcePage,shownAtMs},offsetMs:Math.max(clock,shownAtMs+Math.round(viewerDelay(row)))}
    }).sort((a,b)=>a.offsetMs-b.offsetMs)
    rows=paceComments(rows,comments(),clock,settings.density).filter(row=>!late(row,row.offsetMs))
    if(!rows.length)return
    for(let start=0;start<rows.length;start+=12) {
      const batchId=start?operationId+':'+start:operationId
      const record={type:'batch',batch:{...batch(batchId,rows.slice(start,start+12)),timing}}
      await call(host,'host.presentation.publish',{view:result([{operationId:batchId,anchor,offsetMs:clock,record}]).view})
      await append(host,record,batchId)
    }
    lastBatchEnd=rows.at(-1).offsetMs+(settings.density==='low'?2200:1200)
  }
  async function call(host,method,args) {
    const reply=await host.request({requestId:id(),method,args})
    if(!reply.result.ok)throw Object.assign(new Error(reply.result.error.message),reply.result.error)
    return reply.result.value
  }
  async function cancel(host,keepMemory=true) {
    const old=pending;pending=null
    if(old?.purpose==='memory' && keepMemory)memoryDue={source:old.source,turn:old.turn}
    if(old?.operationId)await call(host,'host.models.cancel',{operationId:old.operationId})
  }
  async function hydrate(host,hostClock) {
    const saved=await call(host,'host.presentation.read',{anchor})
    revision=saved.revision;records=structuredClone(saved.records);hydrated=true
    metricsState=saved.metricsState || emptyMetricsState()
    presets.restore(comments())
    const memories=records.filter(row=>row.record.type==='memory')
    memory=memories.at(-1)?.record.memory || ''
    memoryDone=memories.some(row=>sourceKey(row.record.source)===sourceKey(sourceOf(context)))
    const batches=records.filter(row=>row.record.type==='batch' && anchorKey(row.anchor)===anchorKey(anchor) && sourceKey(row.record.batch.source)===sourceKey(sourceOf(context))).map(row=>row.record.batch)
    const last=batches.at(-1)
    if(last) {
      // Only without a host clock: saved offsets come from earlier app sessions' clocks, and jumping to them scheduled
      // new reactions (and their carry) far behind or ahead of what the reader sees.
      if(context.mode==='live' && !hostClock)clock=Math.max(clock,last.offsetMs)
      // A restored batch carries its own remaining cooling duration, not a new stimulus.
      heatAt=last.heatExpiresAtMs-coolingMs
      heatPeak=last.heatExpiresAtMs>last.offsetMs ? last.heat*coolingMs/(last.heatExpiresAtMs-last.offsetMs) : 0
      lastBatchEnd=Math.max(0,...batches.flatMap(batch=>batch.comments.map(row=>row.offsetMs+1200)))
    }
  }
  async function append(host,record,operationId,at=clock) {
    let nextMetrics=metricsState
    if(record.type==='batch' && context.mode==='live' && !context.sourceKey.startsWith('presentation:') && record.batch.comments.length) {
      nextMetrics=advanceMetrics(metricsState,record.batch,{sessionId:context.sessionId,turn:context.settledTurn,groups:groups.length})
      record={...record,batch:{...record.batch,metricsBasis:metricsBasis(nextMetrics),metrics:nextMetrics.snapshot}}
    }
    const input={operationId,anchor,offsetMs:at,records:[record],expectedRevision:revision}
    const saved=await call(host,'host.presentation.append',input)
    metricsState=nextMetrics
    revision=saved.revision
    records.push({id:saved.recordIds[0],operationId,anchor:structuredClone(anchor),offsetMs:at,record})
  }
  const batch=(batchId,comments=[])=>{
    viewers.record(context.sessionId,comments,now())
    return {id:batchId,source:sourceOf(context),anchor:structuredClone(anchor),offsetMs:clock,
      comments,heat:heat(),online:online(),heatExpiresAtMs:heatAt+coolingMs}
  }
  function modelWakeAfterMs() {
    if(!displayEnabled() || pending || error || !textReady)return null
    if(!enabled())return targets().length && hasCorpus()?1:null
    const ahead=targets().length>0
    if(!ahead && !memoryDue && aiRatio()<100)return null
    if(pagePlan.length && !ahead && !memoryDue)return null
    if(!ahead && (!memoryDue && (!generating || !heat()) || !generating && !comments().some(row=>row.source==='model')))return null
    const at=now(),recent=starts.filter(time=>time>at-60000),cadence=cadenceForSettings(settings)
    const rate=Math.max(0,lastStart+cadence.minIntervalMs-at,recent.length>=cadence.maxPerMinute?recent[0]+60000-at:0)
    return Math.max(1,rate,ahead || memoryDue?0:lastBatchEnd-clock)
  }
  function wakeAfterMs() {
    // A history page reached while paging quickly is matched once the reader has settled on it.
    if(backfillTarget())return Math.max(1,page.shownAtMs-clock)
    if(!displayEnabled())return null
    const times=[modelWakeAfterMs(),presets.next(comments(),clock),!error && viewers.moving()?3000:null].filter(value=>value!==null)
    return times.length?Math.min(...times):null
  }
  async function playPresets(host,revealed) {
    if(!displayEnabled() || aiRatio()<100)return
    const recent=comments().slice(-40)
    if(revealed)presets.trigger(revealed,groups,clock,recent)
    presets.observe(comments(),groups,clock,recent)
    const due=presets.take(groups,clock,recent)
    if(due.length) {
      const rows=tag(paceComments(due,comments(),clock,settings.density),page,{parsedAt:now()}),batchId=id()
      await append(host,{type:'batch',batch:batch(batchId,rows)},batchId)
      lastBatchEnd=Math.max(lastBatchEnd,rows.at(-1).offsetMs+(settings.density==='low'?1100:600))
      presets.observe(comments(),groups,clock,comments().slice(-40))
    }
  }
  // 「像看录播」: a history page (also in a clip export's replay) that has no recorded comments gets real-corpus comments
  // once, by the same keyword match as live and with its spoiler rules — free, never a model, also in MIXED mode — saved
  // like a live batch, so every later visit and replay shows the same ones. No corpus: the page stays empty.
  // The page to match: shown, readable, not matched yet by this controller, without a record.
  function backfillTarget() {
    if(!active || disposed || settings.view==='off' || context?.mode!=='history' || !hydrated || !hasCorpus() || !page)return null
    const target=pagePlan[0]
    if(!target || anchorKey(target.anchor)!==anchorKey(anchor) || backfilled.has(sourceKey(sourceOf(context))+anchorKey(anchor)) ||
      records.some(row=>row.record.type==='batch' && anchorKey(row.anchor)===anchorKey(anchor) && sourceKey(row.record.batch.source)===sourceKey(sourceOf(context))))return null
    return target
  }
  // Same settle rule as playback: a page reached by quick paging waits until its reactions are due to start.
  async function backfill(host) {
    const target=backfillTarget()
    if(!target || clock<page.shownAtMs)return
    backfilled.add(sourceKey(sourceOf(context))+anchorKey(anchor))
    // One page's share of a request, as live gives each newly prepared page.
    const recent=comments().slice(-80)
    const retrieved=await call(host,'host.danmaku.retrieve',{pages:[target],budget:Math.ceil((settings.commentsPerRequest ?? 6)/4),recent:recent.map(c=>c.text)})
    const operationId=id(),timing={backfilledAt:now()}
    const rows=parseComments(retrieved,groups,recent,{id:operationId,offsetMs:clock,density:settings.density,random,chatId:context.sessionId}).map(row=>{
      const origin=retrieved.comments.find(c=>c.text===row.text)
      return tag([{...row,source:'real',origin:{window:origin.window,tier:origin.tier}}],{index:target.index,anchor:target.anchor},timing)[0]
    })
    if(!rows.length)return
    heatPeak=Math.max(heat(),stimulus.get('page.changed'));heatAt=clock
    await release(host,rows,operationId,timing)
  }
  function result(preview=[]) {
    const value={view:projectView({context,anchor,records:[...records,...preview],activeTimeMs:clock,heat:heat(),online:online(),
      active:active&&!disposed,silent:!groups.length,waiting,error,settings,model,corpus:hasCorpus(),viewport,safeRegions,shownAtMs:page?.shownAtMs}),wakeAfterMs:wakeAfterMs()}
    value.view.page=page
    return structuredClone(value)
  }
  async function request(host) {
    let pages=targets(),ahead=pages.length>0
    if(!displayEnabled() || !textReady || pending || error || !enabled() && !(ahead && hasCorpus()) || !ahead && !memoryDue && (!generating || !heat() || clock<lastBatchEnd))return
    const at=now(),cadence=cadenceForSettings(settings);starts=starts.filter(time=>time>at-60000)
    if(at-lastStart<cadence.minIntervalMs || starts.length>=cadence.maxPerMinute)return
    // The first visible reaction takes priority over the private round summary.
    const firstReaction=!comments().some(row=>row.source==='model')
    if(firstReaction && !generating && !ahead)return
    // A page already covered by prefetch does not need another model batch on reveal.
    if(pagePlan.length && !ahead && !memoryDue)return
    const purpose=ahead || generating && heat()>0 && !pagePlan.length?'comments':'memory',requestId=id()
    if(purpose==='comments' && !ahead && aiRatio()<100)return
    const recent=records.filter(row=>row.record.type==='batch').flatMap(row=>row.record.batch.comments).slice(-24)
    // A rolling four-page window shares one batch budget; refilling one new page must not buy a whole batch.
    const configuredLimit=settings.commentsPerRequest ?? 6
    let limit=pages.length?Math.ceil(configuredLimit*pages.length/4):configuredLimit
    let realExamples=[]
    const reservedPages=pages
    let spentCredit=0
    const restorePlan=()=>{
      aiCredit+=spentCredit
      for(const target of reservedPages)planned.delete(anchorKey(target.anchor))
    }
    const hasVisibleReaction=()=>comments().some(row=>row.sourcePage && anchorKey(row.sourcePage.anchor)===anchorKey(page.anchor) && !late(row,clock))
    if(ahead && aiRatio()<100) {
      const freshPages=pages.filter(target=>!prepared.has(anchorKey(target.anchor)))
      const freshLimit=Math.ceil(configuredLimit*freshPages.length/4)
      aiCredit=Math.min(configuredLimit,aiCredit+freshLimit*aiRatio()/100)
      let aiLimit=enabled() && aiCredit>=Math.min(3,configuredLimit)?Math.min(limit,Math.floor(aiCredit)):0
      const realLimit=Math.min(freshLimit,limit-aiLimit)
      const retrieved=hasCorpus() && realLimit?await call(host,'host.danmaku.retrieve',{pages:freshPages,budget:realLimit,recent:[...comments(),...ready].slice(-80).map(c=>c.text)}):{comments:[]}
      for(const target of freshPages)prepared.set(anchorKey(target.anchor),retrieved.comments.filter(row=>row.page===target.index))
      realExamples=pages.flatMap(target=>prepared.get(anchorKey(target.anchor)) || [])
      const operationId=id(),timing={requestedAt:at,parsedAt:now()}
      let parsed=parseComments(retrieved,groups,[...comments(),...ready].slice(-80),{id:operationId,offsetMs:clock,density:settings.density,random,chatId:context.sessionId})
      if(entryReaction && enabled() && pages.some(target=>target.index===page.index) && !hasVisibleReaction() && !parsed.some(row=>row.page===page.index)) {
        // Advance one AI reaction on entry, repaid by later quota; a short or empty corpus must not wait for a page turn.
        aiLimit=Math.max(1,aiLimit)
        parsed=parsed.slice(0,limit-aiLimit)
      }
      if(parsed.length) {
        const rows=parsed.map(row=>{const target=pages.find(p=>p.index===row.page),origin=realExamples.find(c=>c.text===row.text);return tag([{...row,source:'real',origin:{window:origin.window,tier:origin.tier}}],{index:target.index,anchor:target.anchor},timing)[0]})
        await release(host,rows,operationId,timing)
      }
      if(hasVisibleReaction())entryReaction=false
      for(const target of pages)planned.add(anchorKey(target.anchor))
      spentCredit=aiLimit;aiCredit-=aiLimit;limit=aiLimit
      if(!limit){generating=false;return}
      pages=pages.slice(0,Math.min(pages.length,limit))
    }
    if(!enabled())return
    const own={requestId,purpose,reactionVersion,groups,limit,source:sourceOf(context),turn:context.settledTurn,anchor:structuredClone(anchor),page:structuredClone(page),pages:structuredClone(pages),requestedAt:at,stimulusAt,operationId:null,stream:{},lineCount:0,highlighted:false}
    const previousStart=lastStart,previousMemoryDue=memoryDue
    pending=own;starts.push(at);if(purpose==='comments')lastStart=at
    if(purpose==='memory')memoryDue=null
    const input={task:purpose,commentCount:own.limit,groups:groups.map(({ref,name,content})=>{
      const {persona,tone,catchphrases,examples}=content,samples=presetExamples(content)
      return {ref,name,...(persona?{persona}:{}),...(tone?{tone}:{}),
        ...(catchphrases.length?{catchphrases}:{}),...(examples.length?{examples}:{}),...(samples.length?{presetExamples:samples}:{})}
    }),memory,
      recent:recent.slice(-8).map(({text})=>({text})),waiting,acceptedInput:lastInput,presented,heat:heat(),
      ...(purpose==='comments' && pages.length?{pages:pages.map(({index,text})=>({page:index,text,...(realExamples.some(c=>c.page===index)?{realExamples:realExamples.filter(c=>c.page===index).map(c=>c.text)}:{})}))}:{})}
    try {
      const reply=await call(host,'host.models.request',{requestId,slotId:purpose==='memory'?'memory':'audience',purpose,
        input:compactAudienceInput(input),maxOutputTokens:purpose==='memory'?1024:1536+256*own.limit})
      own.operationId=reply.operationId
      if(purpose==='comments') {
        for(const target of pages)planned.add(anchorKey(target.anchor))
        if(pages.some(target=>target.index===page.index))entryReaction=false
      }
    } catch(cause) {
      pending=null
      if(cause.code==='MOD_SOURCE_STALE') {
        // A rejected lease made no provider call; retry through a fresh event without burning cadence.
        starts.pop();lastStart=previousStart;memoryDue=previousMemoryDue;restorePlan()
        return
      }
      if(cause.code==='MOD_RESOURCE_UNAVAILABLE' && cause.path==='$.requestId') {
        // The host's admission (one request in flight, 3 s apart) outlives a room reopened at once (mod switched off and on):
        // wait out its interval and ask again, rather than failing the room until the next page.
        starts.pop();lastStart=at;memoryDue=previousMemoryDue;restorePlan()
        return
      }
      throw cause
    }
  }
  async function streamComment(host,payload) {
    const own=pending
    if(!own || payload.operationId!==own.operationId || own.purpose!=='comments' || error || !displayEnabled() ||
      sourceKey(own.source)!==sourceKey(sourceOf(context)) || own.lineCount>=own.limit)return
    const row=parseCommentLine(payload.output,own.stream)
    if(!row)return
    own.lineCount++
    if(own.highlighted && row.kind==='highlight')row.kind='comment'
    const batchId=own.requestId+':line:'+own.lineCount
    const parsed=parseComments({comments:[row]},own.groups,comments().slice(-40),{id:batchId,offsetMs:clock,density:settings.density,random,chatId:context.sessionId}).filter(row=>groups.some(group=>refKey(group.ref)===refKey(row.group)))
    own.highlighted ||= parsed.some(row=>row.kind==='highlight')
    const target=own.pages.length?own.pages.find(target=>target.index===row.page):own.page
    if(!target)throw Object.assign(new Error('Each comment needs a supplied page number'),{code:'MOD_RESOURCE_UNAVAILABLE'})
    const timing={operationId:own.operationId,requestedAt:own.requestedAt,stimulusAt:own.stimulusAt,parsedAt:now()}
    await release(host,tag(parsed,{index:target.index,anchor:target.anchor},timing),batchId,timing)
  }
  async function complete(host,payload) {
    if(!pending || payload.operationId!==pending.operationId)return
    const own=pending;pending=null
    if(!displayEnabled() || sourceKey(own.source)!==sourceKey(sourceOf(context)))return
    if(payload.status!=='completed') {
      error=payload.error || {code:'MOD_RUNTIME_FAILED',message:'Audience model request failed'}
      return
    }
    if(own.purpose==='memory') {
      const next=parseMemory(payload.output)
      await append(host,{type:'memory',source:own.source,turn:own.turn,memory:next},own.requestId)
      memory=next;memoryDone=true
    } else if(!own.stream.started && (generating && heat()>0 || own.pages.length)) {
      const recent=records.filter(row=>row.record.type==='batch').flatMap(row=>row.record.batch.comments).slice(-40)
      const parsed=parseComments(payload.output,own.groups,recent,{limit:own.limit,id:own.requestId,offsetMs:clock,density:settings.density,random,chatId:context.sessionId}).filter(row=>groups.some(group=>refKey(group.ref)===refKey(row.group)))
      const timing={operationId:own.operationId,requestedAt:own.requestedAt,stimulusAt:own.stimulusAt,parsedAt:now()}
      const rows=parsed.map(row=>{
        const target=own.pages.length?own.pages.find(target=>target.index===row.page):own.page
        if(!target)throw Object.assign(new Error('Each comment needs a supplied page number'),{code:'MOD_RESOURCE_UNAVAILABLE'})
        return tag([row],{index:target.index,anchor:target.anchor},timing)[0]
      })
      await release(host,rows,own.requestId,timing)
      if(!rows.length)lastBatchEnd=clock+3000
    }
    // One model batch per stimulus; idle repeats otherwise occupy the next page's first-reaction slot.
    if(own.purpose==='comments')generating=own.reactionVersion!==reactionVersion
  }
  return Object.freeze({
    async handle(event,host) {
      if(seen.has(event.eventId))return context?result():null
      seen.add(event.eventId);if(seen.size>256)seen.delete(seen.values().next().value)
      const wasOff=settings.view==='off'
      const oldContext=context,previousAnchor=anchor,payload=event.payload || {}
      context=event.context
      textReady=payload.pageReady ?? true
      const changed=oldContext && (sourceKey(sourceOf(oldContext))!==sourceKey(sourceOf(context)) || oldContext.authorityEpoch!==context.authorityEpoch || oldContext.mode!==context.mode)
      const nextAnchor=payload.anchor || payload.to
      if(nextAnchor)anchor={sourceKey:context.sourceKey,part:'body',...nextAnchor}
      if(changed && !nextAnchor)anchor=null
      clock=payload.activeTimeMs ?? (changed?0:clock)
      // visit: the stage's replay visit (a clip export); starting a replay shows the page again even when it is the page already shown.
      const visit=payload.visit ?? null,samePage=page && !changed && anchor && anchorKey(page.anchor)===anchorKey(anchor)
      const movedPage=anchor && (!samePage || (page.visit ?? null)!==visit)
      if(changed){pagePlan=[];ready=[];planned.clear();prepared.clear();shown.clear()}
      if(movedPage) {
        const key=anchorKey(anchor)
        // A page read again is shown again. History paged through quickly (payload.rapid: the stage's previous page turn
        // was under a second ago) starts its reactions only once the reader has settled on it; a jump, opening the stage
        // and a replay start at once.
        shown.set(key,clock+(context.mode==='history' && payload.rapid===true && visit===null?HISTORY_SETTLE_MS:0))
        page={index:payload.pages?.[0]?.index ?? (samePage?page.index:changed || !page?0:page.index+1),anchor:structuredClone(anchor),shownAtMs:shown.get(key),visit}
        // A page shown without a plan (older client, page not yet readable) reacts on its own, not via a stale plan.
        if(!payload.pages?.length)pagePlan=[]
      }
      if(payload.pages?.length) {
        pagePlan=payload.pages.map(row=>({...row,anchor:{...anchor,...row.anchor}}))
        page={...page,index:pagePlan[0].index}
      }
      if(payload.danmaku) {
        const wasAvailable=model.available
        groups=payload.danmaku.groups;settings=payload.danmaku.settings || {};model=payload.danmaku.model || defaultModel()
        if(!model.available && !hasCorpus() && aiRatio()>0)error={code:'MOD_RESOURCE_UNAVAILABLE',message:'Choose an available audience model in global model settings'}
        else if(!wasAvailable)error=null
      }
      if(payload.viewport)viewport=payload.viewport
      if(payload.safeRegions)safeRegions=payload.safeRegions
      if(typeof payload.active==='boolean')active=payload.active
      if(['stage.left','session.disposed'].includes(event.event))active=false
      if(event.event==='session.disposed')disposed=true
      try {
        const moved=anchor && previousAnchor && anchorKey(anchor)!==anchorKey(previousAnchor)
        const carry=moved && !changed && context.mode==='live'?records.filter(row=>row.record.type==='batch').map(row=>({...row,anchor:structuredClone(anchor),record:{...row.record,batch:{...row.record.batch,anchor:structuredClone(anchor),comments:row.record.batch.comments.filter(comment=>comment.offsetMs>clock && comment.offsetMs<=clock+DANMAKU_LATE_MS && !late(comment,comment.offsetMs))}}})).filter(row=>row.record.batch.comments.length):[]
        if(changed || moved) {
          if(changed || pending?.purpose==='memory')await cancel(host,!changed)
          presets.reset();hydrated=false;records=[];heatPeak=0;lastBatchEnd=0;error=null;generating=false
          if(changed){memory='';memoryDone=false;memoryDue=null;lastInput=null;presented=[];waiting=false}
        }
        if(!active || settings.view==='off' || context.mode==='history' || !groups.length) {
          await cancel(host)
          ready=[];planned.clear();prepared.clear()
          heatPeak=0;lastBatchEnd=clock;generating=false
          if(!groups.length)memoryDue=null
        }
        if(anchor && !hydrated && groups.length)await hydrate(host,payload.activeTimeMs!==undefined)
        await backfill(host)
        // Keep not-yet-shown placements when reading faster than the pacing queue.
        for(const row of carry)if(!records.some(saved=>saved.operationId===row.operationId))records.push(row)
        if(carry.length)lastBatchEnd=Math.max(lastBatchEnd,...carry.flatMap(row=>row.record.batch.comments).map(row=>row.offsetMs+(settings.density==='low'?2200:1200)))
        const opened=wasOff && displayEnabled()
        if(event.event==='stage.entered' || opened)entryReaction=true
        if(opened && page) {
          shown.set(anchorKey(anchor),clock);page={...page,shownAtMs:clock}
        }
        if(displayEnabled()) {
          const due=ready.filter(row=>row.sourcePage.index<=page.index);ready=ready.filter(row=>row.sourcePage.index>page.index)
          if(due.length)await release(host,due,id()+':reveal',{releasedAt:now()})
        }
        if(!displayEnabled())presets.pause(comments())
        if(event.event==='player.input')lastInput={inputId:payload.inputId || payload.operationId,text:payload.text || payload.input || ''}
        if(event.event==='performance.presented' && active) {
          presented.push(Object.fromEntries(['performanceId','phase','text','visualType'].filter(key=>payload[key]!==undefined).map(key=>[key,payload[key]])))
          presented=presented.slice(-6)
        }
        if(event.event==='generation.started')waiting=true
        if(event.event==='generation.ended')waiting=false
        if((event.event==='generation.ended' && payload.status==='completed' || event.event==='round.committed' ||
            event.event==='mod.context.changed' && payload.reason==='snapshot' && context.mode==='live') &&
            groups.length>0 && context.settledTurn>0 && !memoryDone && pending?.purpose!=='memory')memoryDue={source:sourceOf(context),turn:context.settledTurn,awaitReaction:event.event==='mod.context.changed'}
        if(payload.provisional || aiRatio()===0)memoryDue=null
        if(aiRatio()===0) {
          if(pending)await cancel(host,false)
          ready=ready.filter(row=>row.source==='real')
        }
        if(event.event==='model.output')await streamComment(host,payload)
        if(event.event==='model.completed')await complete(host,payload)
        const resumed=event.event==='stage.entered' && records.some(row=>row.record.type==='batch' && anchorKey(row.anchor)===anchorKey(anchor) && sourceKey(row.record.batch.source)===sourceKey(sourceOf(context)))
        const newRound=oldContext?.mode==='live' && context.mode==='live' && context.settledTurn>oldContext.settledTurn
        const rise=opened?80:resumed?0:stimulus.get(event.event) || (newRound?80:0),heatId='heat:'+event.eventId
        if(rise && displayEnabled() && !records.some(row=>row.operationId===heatId)) {
          if(pending?.purpose==='memory')await cancel(host)
          reactionVersion++;stimulusAt=now()
          heatPeak=Math.max(heat(),rise);heatAt=clock;generating=true
          // Heat is display state; the first real comment persists it without a pre-request write.
          records.push({operationId:heatId,anchor:structuredClone(anchor),offsetMs:clock,record:{type:'batch',batch:batch(heatId)}})
        }
        if(event.event==='mod.context.changed' && payload.reason!=='cadence' && payload.reason!=='snapshot' && model.available)error=null
        await request(host)
        await playPresets(host,event.event==='text.revealed'?payload.revealed:null)
      } catch(cause) {
        error={code:cause.code || 'MOD_RUNTIME_FAILED',message:cause.message}
      }
      return result()
    },
  })
}
