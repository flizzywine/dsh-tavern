import {viewerNickname} from './nicknames.js'
import {SC_AMOUNTS} from './audience.js'
export {SC_AMOUNTS} from './audience.js'

export const MOD_ID = 'dsh.danmaku'
export const CADENCE = Object.freeze({minIntervalMs:3000,maxPerMinute:20,maxInFlight:1})
export const cadenceForSettings = settings => ({...CADENCE,
  minIntervalMs:(settings.minIntervalSeconds ?? CADENCE.minIntervalMs/1000)*1000,
  maxPerMinute:settings.maxCallsPerMinute ?? CADENCE.maxPerMinute})
export const sourceOf = context => Object.fromEntries(['sessionId','branchId','sourceKey','generation','textVersion'].map(key => [key,context[key]]))
export const sourceKey = source => JSON.stringify(['sessionId','branchId','sourceKey','generation','textVersion'].map(key => source[key]))
export const anchorKey = anchor => JSON.stringify([anchor.sourceKey,anchor.part,anchor.paragraph,anchor.charOffset])
export const refKey = ref => JSON.stringify([ref.packId,ref.kind,ref.assetId])
export const shortText = (text,max) => [...text].slice(0,max).join('')
export const defaultModel = () => ({selection:'follow-foreground',provider:null,model:null,label:'Follow foreground',available:false})
const invalid = message => { throw Object.assign(new Error(message),{code:'MOD_RESOURCE_UNAVAILABLE'}) }

// Only validated, produced comments feed the rate. This state belongs to the chat, not its current page.
export function createViewerCounter() {
  let chat,seed=0,base=null,target=0,lastAt=0,recent=[]
  const seen=new Set()
  function select(id) {
    if(chat===id)return
    chat=id;seed=0;base=null;target=0;lastAt=0;recent=[];seen.clear()
    for(const char of id)seed=(Math.imul(seed,31)+char.charCodeAt(0))>>>0
  }
  return {
    record(id,comments,at) {
      select(id)
      for(const comment of comments)if(!seen.has(comment.id)) {
        seen.add(comment.id);recent.push(at)
        if(seen.size>1024)seen.delete(seen.values().next().value)
      }
    },
    value(id,groups,at,heat) {
      select(id);recent=recent.filter(time=>time>at-30000 && time<=at)
      target=40+32*groups+16*recent.length+seed%17
      base=base===null?target:base+(target-base)*(1-Math.exp(-Math.max(0,at-lastAt)/15000))
      lastAt=at
      return groups?Math.round(base+2.4*heat):0
    },
    moving:()=>recent.length>0 || base!==null && Math.abs(target-base)>0.5,
  }
}

export function commentAmount(kind,amount,random=Math.random) {
  if (kind !== 'highlight') return null
  if (amount != null) {
    if (!SC_AMOUNTS.includes(amount)) invalid('SC amount must be an integer CNY tier: 30, 50, 100, 500, 1000 or 2000; correct amount and resubmit')
    return amount
  }
  const draw=random()
  return SC_AMOUNTS[[0.6,0.8,0.92,0.97,0.99,1].findIndex(limit=>draw<limit)]
}

// The mod model bridge returns text, not native tool submissions.
function parseOutput(output) {
  if (typeof output !== 'string') return output
  const text=output.trim(),fence=/^```(?:jsonl|json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(text)
  return JSON.parse(fence ? fence[1] : text)
}

export function parseCommentLine(output,stream) {
  const text=output.trim()
  if(!stream.started && /^```(?:jsonl|json)?$/i.test(text)){stream.started=true;stream.fenced=true;return null}
  if(stream.fenced && !stream.closed && text==='```'){stream.closed=true;return null}
  if(stream.closed)invalid('Expected only one surrounding code fence')
  stream.started=true
  return parseOutput(text)
}

// Model output is untrusted. Persist only the small, typed display projection.
export function parseComments(output, groups, recent, {id,offsetMs,density,random=Math.random,chatId='',limit=12}) {
  let value
  try {value=parseOutput(output)} catch(error) {
    if(typeof output!=='string')throw error
    const text=output.trim().replace(/^```(?:jsonl|json)?\s*\r?\n([\s\S]*?)\r?\n```$/i,'$1'),lines=text.split(/\r?\n/).filter(line=>line.trim())
    if(lines.length<2)throw error
    value={comments:lines.slice(0,limit).map(line=>parseOutput(line))}
  }
  if(value && typeof value.text==='string')value={comments:[value]}
  if (!Array.isArray(value?.comments) || value.comments.length > 12) invalid('Expected a batch of at most twelve comments')
  const admitted = new Map(groups.map(group => [refKey(group.ref),group]))
  const seen = new Set(recent.map(row => row.text))
  let highlighted = false
  const comments = []
  for (const row of value.comments.slice(0,limit)) {
    const group = Number.isInteger(row?.group) ? groups[row.group] : row?.group ? admitted.get(refKey(row.group)) : groups.length===1 ? groups[0] : null
    if (!group || typeof row.text !== 'string' || !row.text.trim() || [...row.text].length > 160 ||
        row.kind!==undefined && !['comment','highlight'].includes(row.kind)) invalid('Use a recalled group, short text and comment/highlight kind')
    if (row.mode !== undefined && !['scroll','top','bottom'].includes(row.mode) ||
        row.color !== undefined && row.color !== null && !/^#[0-9a-f]{6}$/i.test(row.color) ||
        row.size !== undefined && !['small','standard','large'].includes(row.size)) invalid('Invalid comment display hint')
    if (seen.has(row.text)) continue
    seen.add(row.text)
    const kind = row.kind === 'highlight' && !highlighted ? 'highlight' : 'comment'
    highlighted ||= kind === 'highlight'
    comments.push({id:id+':'+comments.length,group:structuredClone(group.ref),author:viewerNickname(chatId,id+':'+comments.length,group),text:row.text,kind,
      amount:commentAmount(kind,row.amount,random),source:'model',depth:0,ruleId:null,replyTo:null,revealId:null,
      ...(Number.isSafeInteger(row.page)?{page:row.page}:{}),
      mode:row.mode || 'scroll',color:row.color || null,size:row.size || 'standard',
      offsetMs:offsetMs+comments.length*(density === 'low' ? 2200 : 1200),durationMs:kind === 'highlight' ? 9000 : 6500})
  }
  return comments
}

export function parseMemory(output) {
  const value = parseOutput(output)
  if (typeof value?.memory !== 'string') invalid('Expected a short audience memory')
  return shortText(value.memory.trim(),300)
}

// A history page plays its recording: its saved
// offsets come from the clock of the session that recorded them, so the page's records move as one block — the time the
// page was first shown then maps to shownAtMs, the time it is shown now — and every comment keeps its original delay.
// The view carries the whole page (also what is still ahead); the renderer places each comment when it is due.
export function historyBatches(batches,anchor,shownAtMs) {
  const own=batches.flatMap(batch=>batch.comments).filter(row=>row.sourcePage?.anchor && anchorKey(row.sourcePage.anchor)===anchorKey(anchor) && Number.isFinite(row.sourcePage.shownAtMs))
  const start=own.length ? Math.min(...own.map(row=>row.sourcePage.shownAtMs)) : Math.min(...batches.map(batch=>batch.offsetMs))
  const shift=Number.isFinite(shownAtMs) && Number.isFinite(start) ? shownAtMs-start : 0
  if(!shift)return batches
  const page=row=>Number.isFinite(row.sourcePage?.shownAtMs) ? {sourcePage:{...row.sourcePage,shownAtMs:row.sourcePage.shownAtMs+shift}} : {}
  return batches.map(batch=>({...batch,offsetMs:batch.offsetMs+shift,heatExpiresAtMs:batch.heatExpiresAtMs+shift,
    comments:batch.comments.map(row=>({...row,offsetMs:row.offsetMs+shift,...page(row)}))}))
}

export function projectView({context,anchor,records=[],activeTimeMs=0,heat=0,online=0,active=false,silent=true,
  waiting=false,error=null,settings={},model=defaultModel(),corpus=false,viewport={width:0,height:0},safeRegions=[],shownAtMs}) {
  const view = ['sidebar','off'].includes(settings.view) ? settings.view : 'overlay'
  if(view==='off')active=false
  const page = silent || view==='off' || !anchor ? [] : records.filter(row => row.record.type === 'batch' &&
    sourceKey(row.record.batch.source) === sourceKey(sourceOf(context)) && anchorKey(row.anchor) === anchorKey(anchor))
    .map(row => row.record.batch)
  const batches = context.mode === 'history' ? historyBatches(page,anchor,shownAtMs).slice(-20) : page.filter(batch => batch.offsetMs <= activeTimeMs).slice(-20)
  const items = batches.flatMap(batch => batch.comments).filter(row => row.offsetMs <= activeTimeMs)
    .sort((a,b) => a.offsetMs-b.offsetMs || a.id.localeCompare(b.id)).slice(-32)
  const last = batches.filter(batch => batch.offsetMs <= activeTimeMs).at(-1)
  if (!last) {heat=0;online=0}
  if (context.mode === 'history') {
    const remaining=last ? last.heatExpiresAtMs-last.offsetMs : 0
    heat=remaining>0 ? Math.round(last.heat*Math.max(0,(last.heatExpiresAtMs-activeTimeMs)/remaining)) : 0
    online=last ? Math.max(12,Math.round(last.online-(last.heat-heat)*2.4)) : 0
  } else if(last) {
    // Live batch counters project the current baseline; persisted replay history stays unchanged.
    batches[batches.length-1]={...last,online:Math.round(online+(last.heat-heat)*2.4)}
  }
  return {version:1,modId:MOD_ID,mode:context.mode,active,silent,view,anchor,activeTimeMs,batches,
    metrics:silent || view==='off'?null:(batches.findLast(batch=>batch.offsetMs<=activeTimeMs && batch.metrics)?.metrics ?? null),
    highlights:items.filter(row => row.kind === 'highlight'),
    heat:silent?0:heat,online:silent?0:online,viewport,safeRegions,
    // 弹幕来源 (stage CONFIG): what this round can draw on - recalled groups with a real corpus, an available audience model.
    sources:{real:!!corpus,ai:!!model.available},
    sidebar:{title:'模拟观众',items,limit:32},
    settings:{view,density:settings.density === 'low' ? 'low' : 'standard',
      area:settings.area ?? 'three-quarter',opacity:settings.opacity ?? 90,fontScale:settings.fontScale ?? 100,reducedMotion:!!settings.reducedMotion,
      model,commentsPerRequest:settings.commentsPerRequest ?? 6,cadence:cadenceForSettings(settings),modelSettingsTarget:{modId:MOD_ID,slotId:'audience'}},
    status:silent?'silent':context.mode === 'history'?'history':!active?'paused':error?'error':waiting?'waiting':'ready',error}
}
