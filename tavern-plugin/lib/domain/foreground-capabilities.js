import {createHash} from 'node:crypto'
import {bubbleInjection,bubbleInstructionPreview,bubbleRosterAddendum,bubbleRosterLines,importedBubbleFormat} from './dialogue-bubbles.js'
import {judgeEnabled} from './engine-judge.js'
import {recallFigures} from './figure-recall.js'
import {figureJudgeId,selectJudgeRecall} from '../../packages/dsh-tavern-stage/lib/domain/stage-judge-recall.js'
import {completedCompactionEpoch,sessionEvents} from './session-events.js'
import {estimateDirectorTokens} from './stage-director-tokens.js'
import {managedForegroundEntries,managedPromptSections} from './mod-system-prompt-adapter.js'
import {promptSection} from './prompt-section.js'
import {liveContextUpdate} from './card-system-prompt.js'

const managed = entry => !!entry.rawEntry?.extensions?.dsh_tavern_helper_extra?.forkDialogueBubbles || entry.foregroundCapability === true
const replace = (book, entries) => ({...book,view:{...book?.view,entries:[...(book?.view?.entries || []).filter(entry=>!managed(entry)),...structuredClone(entries)]}})

export const foregroundCapabilityEpoch = session => completedCompactionEpoch(session, { beforeTurn: true })

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
  return bubbleInjection(current,{userName:chat.macroState?.userName,includePlayerName:false,speakerRows:config.characters}).map(part=>({
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

const digest=value=>createHash('sha256').update(typeof value==='string' ? value : JSON.stringify(value)).digest('hex').slice(0,16)
// The trace field of the session message that carries a turn's update (foreground-frame-session-adapter.js).
export const FOREGROUND_CAPABILITY_UPDATE='foregroundCapabilityUpdate'
// What the model was told after a prefix: the latest update record to that prefix the live context still holds (a rewound
// or compacted update is told again), or, with live false, the latest one in the whole session.
function toldRecord(native,prefix,live) {
  const record=live ? liveContextUpdate(native,FOREGROUND_CAPABILITY_UPDATE)
    : sessionEvents(native).filter(event=>event.type==='user/message').map(event=>event.data?.source?.trace?.[FOREGROUND_CAPABILITY_UPDATE]).findLast(row=>row?.prefix===prefix)
  return record?.schemaVersion===1 && record.prefix===prefix ? record : undefined
}

// What the foreground prompt offers, unit by unit: each dialogue-format part, each roster speaker, each mod rule and each
// tool the model may call. The frozen prefix and every turn's update are read from these same units, so a change of any
// kind (a speaker joins, the format is edited, a mod or tool is switched) is one difference between two unit lists.
export function foregroundCapabilityUnits({config,chat,aliases,contributions,tools=[]}) {
  const units=new Map()
  if(config.enabled) {
    const current={...config,characters:config.characters.filter(row=>aliases.has(row.alias))}
    const options={userName:chat.macroState?.userName,speakerRows:config.characters}
    for(const segment of bubbleInstructionPreview(current,{...options,table:false}).segments)
      units.set('format:'+segment.key,{kind:'format',name:segment.title,text:segment.text})
    for(const line of bubbleRosterLines(current,options))units.set('figure:'+line.alias,{kind:'figure',name:line.name,text:line.text})
  }
  for(const section of contributions ? managedPromptSections(contributions,'foreground') : [])
    units.set('mod:'+section.modId+'.'+section.fragmentId,{kind:'mod',name:section.name,text:section.text})
  for(const name of tools)units.set('tool:'+name,{kind:'tool',name,text:name})
  return units
}
// The persisted form of a unit list: what each unit is and a digest of its text.
const unitState=units=>Object.fromEntries([...units].map(([key,unit])=>[key,{kind:unit.kind,name:unit.name,digest:digest(unit.text)}]))
const stateFigures=state=>Object.keys(state).filter(key=>key.startsWith('figure:')).map(key=>key.slice('figure:'.length))

const REMOVED={
  format:unit=>`- the dialogue format part "${unit.name}"`,
  figure:unit=>`- the speaker ${unit.name}`,
  mod:unit=>`- the mod rules "${unit.name}"`,
  tool:unit=>`- the tool \`${unit.name}\`; calls to it are refused`,
}
// The update a turn appends: only what differs from what the model was told (base), stated as removed, changed or added.
// Its template part renders like the prefix's built-in entries; mod rules stay literal, as in the prefix.
function capabilityUpdate({base,units,config}) {
  const removed=Object.entries(base).filter(([key])=>!units.has(key)).map(([,unit])=>unit)
  const fresh=[...units].filter(([key,unit])=>base[key]?.digest!==digest(unit.text))
  if(!removed.length && !fresh.length)return null
  const of=kind=>fresh.filter(([,unit])=>unit.kind===kind)
  const figures=new Set(of('figure').map(([key])=>key.slice('figure:'.length)))
  const kept=new Set(stateFigures(base).filter(alias=>units.has('figure:'+alias) && !figures.has(alias)))
  const tools=of('tool').map(([,unit])=>'`'+unit.name+'`')
  const template=[
    'The foreground capabilities described in the system prompt changed. Where this update and the system prompt differ, follow this update.',
    removed.length ? 'No longer in effect:\n'+[...new Set(removed.map(unit=>REMOVED[unit.kind](unit)))].join('\n') : '',
    of('format').length ? promptSection('dialogue_format_update','These dialogue format parts are new or replace the earlier part of the same name.\n'+of('format').map(([,unit])=>unit.text).join('\n')) : '',
    figures.size ? bubbleRosterAddendum(config,{speakerRows:config.characters,aliases:figures,frozenAliases:kept}) : '',
    tools.length ? 'Tools now available: '+tools.join(', ')+'.' : '',
  ].filter(Boolean).join('\n')
  const mods=of('mod').map(([,unit])=>unit.text)
  return {template,literal:mods.length ? promptSection('mod_rules_update','These mod rules are new or replace the earlier rules of the same name.\n'+mods.join('\n')) : ''}
}

// Persist only capability text and its authored configuration identity; never rewrite history.
// The prefix (snapshot) is captured at session start and after each completed compaction and keeps its bytes in between.
// Every change in between reaches the turn tail as an update (update()); the next capture takes in everything the model was told.
export function createForegroundCapabilities({session,readConfig,render,save,modPrompts,tools=async()=>[],judge=()=>undefined}) {
  let active=true
  const assertCurrent=()=>{if(!active)throw Object.assign(new Error('Stage presentation unavailable'),{code:'STAGE_UNAVAILABLE'})}
  const pending=new Map(),accepted=new Map()
  const roundKey = (chat,epoch,native) => JSON.stringify([chat.id,chat.sessionId,epoch,
    sessionEvents(native).findLast(event=>event.type==='turn/start')?.data?.turn ?? chat.messages?.at(-1)?.turn ?? 0])
  // Speakers a recompute keeps: every speaker this session's model was told about that the card still has.
  const carried=(chat,old,config)=>{
    if(old?.sessionId!==chat.sessionId)return []
    const told=old.state && toldRecord(session(chat.sessionId),digest(old.state),false)
    const aliases=told ? stateFigures(told.state) : old.state ? stateFigures(old.state) : old.figures || []
    return aliases.filter(alias=>config.characters.some(row=>row.alias===alias))
  }
  async function renderText(chat,text) {
    const entry={ref:'foreground-capabilities:update',enabled:true,constant:true,primaryKeys:[],secondaryKeys:[],position:0,order:100,content:text}
    const rendered=await render(chat,replace(null,[entry]))
    assertCurrent()
    if(rendered.diagnostics?.length)throw new Error('Foreground capability template projection failed')
    return rendered.renderedEntries.find(row=>row.ref===entry.ref)?.text ?? ''
  }
  async function capture(chat,epoch,userText,config,carry=[]) {
    assertCurrent()
    config ||= await readConfig(chat.cardPath)
    assertCurrent()
    const aliases=new Set([...foregroundRecalledFigures(config,chat,{userText,judge:judge()}),...carry])
    const builtin=foregroundCapabilityEntries(config,chat,{aliases})
    const previous=chat.foregroundCapabilities?.modPrompts
    // An explicit correction refreshes the roster, never the managed text in the same native epoch.
    const contributions=modPrompts ? previous?.sessionId===chat.sessionId && previous.epoch===epoch ? previous :
      await modPrompts(chat,{previous,nativeSession:session(chat.sessionId),sessionId:chat.sessionId}) : undefined
    const toolNames=await tools(chat)
    assertCurrent()
    const parts=contributions ? managedForegroundEntries(contributions) : []
    const extras=parts.map((entry,index)=>({...entry,
      position:0,...config.injection?.placement,order:Number(config.injection?.placement?.order ?? 100)+2+index}))
    const entries=[...builtin,...extras]
    // Author macros resolve once; managed Markdown is literal even on its first projection.
    const rendered=await render(chat,replace(null,entries.map(entry=>entry.capabilityPart?.modId ? entry :
      (({foregroundCapability,...value})=>value)(entry))))
    assertCurrent()
    if(rendered.diagnostics?.length)throw new Error('Foreground capability template projection failed')
    const figures=config.enabled ? [...aliases] : []
    return {version:2,sessionId:chat.sessionId,epoch,figures,
      state:unitState(foregroundCapabilityUnits({config,chat,aliases,contributions,tools:toolNames})),
      ...(contributions?{modPrompts:structuredClone(contributions)}:{}),entries:entries.flatMap(entry=>{
      const output=rendered.renderedEntries.find(row=>row.ref===entry.ref)
      return output?[{...entry,content:output.text}]:[]
    })}
  }
  // This turn's update against what the live context already tells the model (the prefix and the updates since). record
  // rides the turn's frame; the session adapter writes it as its own message, which later turns read back.
  async function updateFor(chat,{userText='',snapshot=chat.foregroundCapabilities,read=readConfig}={}) {
    if(!active || !snapshot?.state || snapshot.sessionId!==chat.sessionId)return {text:''}
    const prefix=digest(snapshot.state)
    const base=toldRecord(session(chat.sessionId),prefix,true)?.state ?? snapshot.state
    const config=await read(chat.cardPath)
    assertCurrent()
    const aliases=new Set([...stateFigures(base).filter(alias=>config.characters.some(row=>row.alias===alias)),
      ...foregroundRecalledFigures(config,chat,{userText,judge:judge()})])
    const contributions=modPrompts ? await modPrompts(chat,{nativeSession:session(chat.sessionId),sessionId:chat.sessionId}) : undefined
    const units=foregroundCapabilityUnits({config,chat,aliases,contributions,tools:await tools(chat)})
    assertCurrent()
    const update=capabilityUpdate({base,units,config})
    if(!update)return {text:''}
    const text=promptSection('foreground_capability_update',[await renderText(chat,update.template),update.literal].filter(Boolean).join('\n'))
    return {text,record:{schemaVersion:1,prefix,state:unitState(units),rendered:text}}
  }
  async function preview(chat,{userText='',readConfig:previewConfig=readConfig}={}) {
    if(!active || !chat.sessionId || !['story','script'].includes(chat.mode || 'story'))return []
    const native=session(chat.sessionId),old=chat.foregroundCapabilities
    const epoch=native ? foregroundCapabilityEpoch(native) : old?.epoch || ''
    const key=roundKey(chat,epoch,native)
    const matches=old?.sessionId===chat.sessionId && old.epoch===epoch && !!old.state
    const saved=matches ? old : accepted.get(key) || (pending.has(key) ? await pending.get(key) : undefined)
    let snapshot=saved
    if(!snapshot) {const config=await previewConfig(chat.cardPath);snapshot=await capture(chat,epoch,userText,config,carried(chat,old,config))}
    // Preview never accepts/persists a new epoch. Frozen entries render in the actual body order.
    const rendered=await render(chat,replace(null,snapshot.entries))
    assertCurrent()
    if(rendered.diagnostics?.length)throw new Error('Foreground capability template projection failed')
    const entries=new Map(snapshot.entries.map(entry=>[entry.ref,entry]))
    const parts=rendered.renderedEntries.filter(row=>entries.has(row.ref)).map(row=>({
      ...entries.get(row.ref).capabilityPart,text:row.text,tokens:estimateDirectorTokens(row.text),
    }))
    // A freshly captured prefix already holds everything current, so only a saved one can have an update pending.
    const {text}=saved ? await updateFor(chat,{userText,snapshot,read:previewConfig}) : {text:''}
    assertCurrent()
    return text ? [...parts,{key:'capability-update',name:'前台能力追加说明',owners:'全局',text,tokens:estimateDirectorTokens(text)}] : parts
  }
  async function projectBook(chat,book,entries) {
    const projected=replace(book,entries)
    if(entries.some(entry=>entry.ref==='foreground-capabilities:format'))return projected
    // A worldbook imported on its own can carry the format but not the source card's bubble settings.
    const imported=(book?.view?.entries || []).filter(entry=>importedBubbleFormat(entry,chat.cardPath))
    if(!imported.length)return projected
    const rendered=await render(chat,{view:{entries:imported}})
    assertCurrent()
    const texts=new Map(rendered.renderedEntries.map(entry=>[entry.ref,entry.text]))
    projected.view.entries.push(...imported.filter(entry=>texts.has(entry.ref)).map(entry=>({
      ...entry,content:texts.get(entry.ref),foregroundCapability:true
    })))
    return projected
  }
  async function projectActive(chat,book,{persist=true,userText=''}={}) {
    if(!chat.sessionId || !['story','script'].includes(chat.mode || 'story'))return book
    const native=session(chat.sessionId),old=chat.foregroundCapabilities
    const epoch=native ? foregroundCapabilityEpoch(native) : old?.epoch || ''
    const key=roundKey(chat,epoch,native)
    if(accepted.has(key)) {chat.foregroundCapabilities=structuredClone(accepted.get(key));return await projectBook(chat,book,accepted.get(key).entries)}
    if(!pending.has(key))pending.set(key,(async()=>{
      // A snapshot from before the unit state (version 1) is captured again once, without rewriting old rounds.
      const unchanged=old?.sessionId===chat.sessionId && old.epoch===epoch && !!old.state
      let snapshot=old
      if(!unchanged) {const config=await readConfig(chat.cardPath);assertCurrent();snapshot=await capture(chat,epoch,userText,config,carried(chat,old,config))}
      assertCurrent()
      if(persist && !unchanged)await save(chat,snapshot,{assertCurrent})
      assertCurrent()
      accepted.set(key,snapshot)
      while(accepted.size>128)accepted.delete(accepted.keys().next().value)
      return snapshot
    })())
    try {
      const snapshot=await pending.get(key)
      assertCurrent()
      chat.foregroundCapabilities=structuredClone(snapshot)
      return await projectBook(chat,book,chat.foregroundCapabilities.entries)
    } finally {pending.delete(key)}
  }
  async function project(chat,book,options) {
    if(!active)return replace(book,[])
    try {return await projectActive(chat,book,options)} catch(error) {if(!active)return replace(book,[]);throw error}
  }
  async function refresh(chat, expectedInjection) {
    assertCurrent()
    const before=structuredClone(chat.foregroundCapabilities)
    if(!before || JSON.stringify(await preview(chat))!==JSON.stringify(expectedInjection))
      throw Object.assign(new Error('Foreground prompt changed; read it again before refreshing'),{code:'REVISION_CONFLICT'})
    const native=session(chat.sessionId),epoch=native ? foregroundCapabilityEpoch(native) : before.epoch
    const config=await readConfig(chat.cardPath)
    const snapshot=await capture(chat,epoch,'',config,carried(chat,before,config))
    if(JSON.stringify(snapshot)===JSON.stringify(before))return preview(chat)
    // Explicit author correction only: ordinary turns keep their frozen prefix and take changes as updates.
    await save(chat,snapshot,{expected:before,assertCurrent})
    assertCurrent()
    chat.foregroundCapabilities=structuredClone(snapshot)
    accepted.set(roundKey(chat,epoch,native),snapshot)
    return preview(chat)
  }
  return {project,preview:async(...args)=>{try{return await preview(...args)}catch(error){if(!active)return [];throw error}},refresh,
    update:(chat,options)=>updateFor(chat,options),dispose(){active=false;accepted.clear()}}
}

// Authored voice/availability identity of a configuration (the roster figures as written); tools compare installs by it.
const rosterRow=row=>({alias:row.alias,ref:row.ref,name:row.name,aliases:row.aliases,recall:row.recall,voice:row.voice,language:row.voiceLang,voiceDirection:row.voiceDirection})
export function foregroundVoiceConfigurationKey(config,figures) {
  const frozen=figures && new Set(figures)
  return digest({enabled:config.enabled,voice:config.voice,characters:config.characters.filter(row=>!frozen || frozen.has(row.alias)).map(rosterRow)})
}
