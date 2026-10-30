import {createHash} from 'node:crypto'
import {bubbleInjection,bubbleRosterAddendum} from './dialogue-bubbles.js'
import {judgeEnabled} from './engine-judge.js'
import {recallFigures} from './figure-recall.js'
import {figureJudgeId,selectJudgeRecall} from './stage-judge-recall.js'
import {sessionEvents} from './session-events.js'
import {estimateDirectorTokens} from './stage-director-tokens.js'
import {managedForegroundEntries} from './mod-system-prompt-adapter.js'

const managed = entry => !!entry.rawEntry?.extensions?.dsh_tavern_helper_extra?.forkDialogueBubbles || entry.foregroundCapability === true
const replace = (book, entries) => ({...book,view:{...book?.view,entries:[...(book?.view?.entries || []).filter(entry=>!managed(entry)),...structuredClone(entries)]}})

// Only a completed native replacement before this turn can change its prefix.
export function foregroundCapabilityEpoch(session) {
  const events=sessionEvents(session),start=events.findLastIndex(event=>event.type==='turn/start')
  const prior=start<0?events:events.slice(0,start)
  const completed=new Set(prior.filter(event=>event.type==='compaction/end' && !event.data?.error).map(event=>event.data.compactionId))
  const replaced=new Set(prior.filter(event=>event.type==='user/message' && event.surfaceOp?.op==='replace').map(event=>event.data?.source?.compactionId))
  return prior.findLast(event=>event.type==='compaction/summary' && completed.has(event.data.compactionId) && replaced.has(event.data.compactionId))?.data.compactionId || ''
}

// The one recall for the foreground roster: the latest reply, this turn's input and the saved judge.
export function foregroundRecalledFigures(config,chat,{userText='',judge}={}) {
  const message=(chat.messages || []).findLast(row=>row.role==='assistant')
  const probabilities=message?.stageDirectionAssetPacks?.stats?.judge?.probabilities
  const rows=config.characters.map(character=>({...character,actorKey:character.alias,enabled:true}))
  const judgeRecall=probabilities && judgeEnabled(judge) ? selectJudgeRecall(rows.map(row=>({id:figureJudgeId(row.ref),kind:'figures'})),new Map(probabilities),judge) : undefined
  const user = userText || (chat.messages || []).findLast(row=>row.role==='user')?.text || ''
  const selected=recallFigures({rows,units:[message?.sourceText ?? message?.text ?? chat.openingText ?? '',user],judgeRecall}).rows
  return new Set(selected.map(row=>row.actorKey))
}

export function foregroundCapabilityEntries(config,chat,{userText='',judge,aliases=foregroundRecalledFigures(config,chat,{userText,judge})}={}) {
  // The built-in dialogue grammar needs no recalled material; only the figure roster does.
  const current={...config,characters:config.characters.filter(row=>aliases.has(row.alias))}
  return bubbleInjection(current,{userName:chat.macroState?.userName,speakerRows:config.characters}).map(part=>({
    ref:'foreground-capabilities:'+part.key,enabled:true,constant:true,
    primaryKeys:[],secondaryKeys:[],position:0,...config.injection?.placement,
    order:Number(config.injection?.placement?.order ?? 100),
    comment:part.name || 'Dialogue format',content:part.text,foregroundCapability:true,
    capabilityPart:{key:part.key,name:part.name,owners:'全局',...(part.packs?{packs:part.packs}:{}),...(part.voice?{voice:part.voice}:{})},
  }))
}

export function foregroundCapabilityInjection(snapshot) {
  return snapshot.entries.map(entry=>({...entry.capabilityPart,text:entry.content,tokens:estimateDirectorTokens(entry.content)}))
}

// Authored voice/availability changes invalidate the roster, not provider health or visual media.
export function foregroundVoiceConfigurationKey(config) {
  return createHash('sha256').update(JSON.stringify({enabled:config.enabled,voice:config.voice,
    characters:config.characters.map(row=>({alias:row.alias,ref:row.ref,
      name:row.name,aliases:row.aliases,recall:row.recall,voice:row.voice,language:row.voiceLang,
      voiceDirection:row.voiceDirection}))})).digest('hex')
}

// Persist only capability text and its authored configuration identity; never rewrite history.
export function createForegroundCapabilities({session,readConfig,render,save,modPrompts,judge=()=>undefined}) {
  const pending=new Map(),accepted=new Map()
  const roundKey = (chat,epoch,native) => JSON.stringify([chat.id,chat.sessionId,epoch,
    sessionEvents(native).findLast(event=>event.type==='turn/start')?.data?.turn ?? chat.messages?.at(-1)?.turn ?? 0])
  async function capture(chat,epoch,userText,config,configurationKey) {
    config ||= await readConfig(chat.cardPath)
    const aliases=foregroundRecalledFigures(config,chat,{userText,judge:judge()})
    const builtin=foregroundCapabilityEntries(config,chat,{aliases})
    const previous=chat.foregroundCapabilities?.modPrompts
    // Core voice corrections may refresh the roster, never the managed text in the same native epoch.
    const contributions=modPrompts ? previous?.sessionId===chat.sessionId && previous.epoch===epoch ? previous :
      await modPrompts(chat,{previous,nativeSession:session(chat.sessionId),sessionId:chat.sessionId}) : undefined
    const parts=contributions ? managedForegroundEntries(contributions) : []
    const extras=parts.map((entry,index)=>({...entry,
      position:0,...config.injection?.placement,order:Number(config.injection?.placement?.order ?? 100)+2+index}))
    const entries=[...builtin,...extras]
    // Author macros resolve once; managed Markdown is literal even on its first projection.
    const rendered=await render(chat,replace(null,entries.map(entry=>entry.capabilityPart?.modId ? entry :
      (({foregroundCapability,...value})=>value)(entry))))
    if(rendered.diagnostics?.length)throw new Error('Foreground capability template projection failed')
    return {version:1,sessionId:chat.sessionId,epoch,configurationKey:configurationKey || foregroundVoiceConfigurationKey(config),
      figures:config.enabled ? [...aliases] : [],...(contributions?{modPrompts:structuredClone(contributions)}:{}),entries:entries.flatMap(entry=>{
      const output=rendered.renderedEntries.find(row=>row.ref===entry.ref)
      return output?[{...entry,content:output.text}]:[]
    })}
  }
  async function preview(chat,{userText='',nextRound=false,readConfig:previewConfig=readConfig}={}) {
    if(!chat.sessionId || !['story','script'].includes(chat.mode || 'story'))return []
    const native=session(chat.sessionId),old=chat.foregroundCapabilities
    const epoch=native ? foregroundCapabilityEpoch(native) : old?.epoch || ''
    const key=roundKey(chat,epoch,native)
    const config=nextRound ? await previewConfig(chat.cardPath) : null
    const configurationKey=nextRound ? foregroundVoiceConfigurationKey(config) : null
    const matches=old?.sessionId===chat.sessionId && old.epoch===epoch && !!old.figures && (!nextRound || old.configurationKey===configurationKey)
    const saved=matches ? old : nextRound ? undefined : accepted.get(key) || (pending.has(key) ? await pending.get(key) : undefined)
    const snapshot=saved ?? await capture(chat,epoch,userText,config ?? await previewConfig(chat.cardPath),configurationKey)
    // Preview never accepts/persists a new epoch. Frozen entries render in the actual body order.
    const rendered=await render(chat,replace(null,snapshot.entries))
    if(rendered.diagnostics?.length)throw new Error('Foreground capability template projection failed')
    const entries=new Map(snapshot.entries.map(entry=>[entry.ref,entry]))
    const parts=rendered.renderedEntries.filter(row=>entries.has(row.ref)).map(row=>({
      ...entries.get(row.ref).capabilityPart,text:row.text,tokens:estimateDirectorTokens(row.text),
    }))
    // A freshly captured roster already holds every figure recalled for this text, so only a saved snapshot can lag.
    const late=saved ? await rosterAddendum(chat,{userText,snapshot,read:previewConfig}) : ''
    return late ? [...parts,{key:'roster-addendum',name:'说话人名单补录',owners:'全局',text:late,tokens:estimateDirectorTokens(late)}] : parts
  }
  async function project(chat,book,{persist=true,userText=''}={}) {
    if(!chat.sessionId || !['story','script'].includes(chat.mode || 'story'))return book
    const native=session(chat.sessionId),old=chat.foregroundCapabilities
    const epoch=native ? foregroundCapabilityEpoch(native) : old?.epoch || ''
    const key=roundKey(chat,epoch,native)
    if(accepted.has(key)) {chat.foregroundCapabilities=structuredClone(accepted.get(key));return replace(book,accepted.get(key).entries)}
    if(!pending.has(key))pending.set(key,(async()=>{
      const config=await readConfig(chat.cardPath)
      const configurationKey=foregroundVoiceConfigurationKey(config)
      const unchanged=old?.sessionId===chat.sessionId && old.epoch===epoch && old.configurationKey===configurationKey && !!old.figures
      const snapshot=unchanged ? old : await capture(chat,epoch,userText,config,configurationKey)
      if(persist && !unchanged)await save(chat,snapshot)
      accepted.set(key,snapshot)
      while(accepted.size>128)accepted.delete(accepted.keys().next().value)
      return snapshot
    })())
    try {
      chat.foregroundCapabilities=structuredClone(await pending.get(key))
      return replace(book,chat.foregroundCapabilities.entries)
    } finally {pending.delete(key)}
  }
  async function refresh(chat, expectedInjection) {
    const before=structuredClone(chat.foregroundCapabilities)
    if(!before || JSON.stringify(await preview(chat))!==JSON.stringify(expectedInjection))
      throw Object.assign(new Error('Foreground prompt changed; read it again before refreshing'),{code:'REVISION_CONFLICT'})
    const native=session(chat.sessionId),epoch=native ? foregroundCapabilityEpoch(native) : before.epoch
    const snapshot=await capture(chat,epoch,'')
    if(JSON.stringify(snapshot)===JSON.stringify(before))return preview(chat)
    // Explicit author correction only: ordinary turns still retain their frozen prefix.
    await save(chat,snapshot,{expected:before})
    chat.foregroundCapabilities=structuredClone(snapshot)
    accepted.set(roundKey(chat,epoch,native),snapshot)
    return preview(chat)
  }
  // A figure recalled after the roster froze goes to this turn's tail instead of rewriting the cached prefix;
  // the next recompute (session start, compaction, configuration change, or a snapshot saved without figures) moves it into the roster.
  async function rosterAddendum(chat,{userText='',snapshot=chat.foregroundCapabilities,read=readConfig}={}) {
    if(!snapshot?.figures || snapshot.sessionId!==chat.sessionId)return ''
    const config=await read(chat.cardPath)
    if(foregroundVoiceConfigurationKey(config)!==snapshot.configurationKey)return ''
    const frozenAliases=new Set(snapshot.figures)
    const aliases=new Set([...foregroundRecalledFigures(config,chat,{userText,judge:judge()})].filter(alias=>!frozenAliases.has(alias)))
    return aliases.size ? bubbleRosterAddendum(config,{speakerRows:config.characters,aliases,frozenAliases}) : ''
  }
  return {project,preview,refresh,rosterAddendum}
}
