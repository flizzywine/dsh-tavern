import {inspectCardExtensions} from '../card-extension-reading.js'
import {analyzeVariableSchema,analyzeVariableValues,unwrapMvu} from '../variable-bindings/index.js'
import resolution from '../../../packages/dsh-presentation-protocol/src/figure-resolution.cjs'

export const stateSourceSchema={fields:[{key:'source',label:'状态来源',valueType:'string',default:'auto',scope:'global',choices:['auto','mvu','ledger'],ui:{control:'choice',choices:[{value:'auto',label:'自动'},{value:'mvu',label:'MVU'},{value:'ledger',label:'游玩台账'}]}}]}
export const ledgerInventoryBinding=Object.freeze({source:'ledger',path:'/inventory',fields:{name:'/name',count:'/qty',description:'/desc'}})
export const ledgerConfigExports=[['items','array','全部物品'],['inventory','array','随身物品'],['npcs','array','人物'],['scenes','array','地点'],['location','string','记载地点'],['locationPath','array','地点路径'],['consolidatedTurn','number','整理轮次']].map(([name,type,description])=>({path:'/'+name,name,type,description}))

export function ledgerSource(chat) {
  if(!chat?.ledger)return {available:false}
  const value=structuredClone(chat.ledger)
  value.inventory=(value.items || []).filter(row=>row.carried!==false)
  return {available:true,value}
}

// Presence, not inventory shape or readiness, chooses auto. Empty/pending MVU never falls back.
export function resolveStateSource({preference='auto',raw,chat,sources={}}={}) {
  const hasMvu=sources.mvu?.available===true || chat?.mvu?.enabled===true || analyzeVariableSchema(raw).length>0 || inspectCardExtensions(raw).mvuResources.some(row=>row.enabled!==false)
  const source=preference==='auto'?(hasMvu?'mvu':'ledger'):preference
  if(!['mvu','ledger'].includes(source))throw Object.assign(new Error('Unknown state source'),{code:'CONFIG_TYPE'})
  return {source,...(source==='ledger'?(sources.ledger || ledgerSource(chat)):(sources.mvu || {available:false}))}
}

// Facts are hints only: no asset lookup by ledger name, no cast/scene edits, no inventory dump.
export function stateSourceHints(selected,rows,roster={},dimensions={scene:true,actors:true}) {
  if(!selected?.available)return null
  const value=selected.value,ledger=selected.source==='ledger'
  let location,characters=[]
  if(ledger) {
    location=value.locationPath?.length?value.locationPath.join(' / '):value.location
    characters=(value.npcs || []).filter(row=>row.follow===true || row.important===true || row.location && row.location===value.location)
  } else {
    const candidates=analyzeVariableValues(value)
    location=candidates.find(row=>row.valueType==='string' && /^(location|地点|地點|当前位置|當前位置|当前地点)$/i.test(row.parts.at(-1)))?.value
    const list=candidates.find(row=>row.valueType==='array' && /^(characters|npcs|人物|角色)$/i.test(row.parts.at(-1)))?.value
    characters=(list || []).filter(row=>row!=null).map(row=>typeof row==='string'?{name:row}:{name:unwrapMvu(row.name || row.姓名 || row.名称),location:unwrapMvu(row.location || row.地点)})
  }
  const hints={}
  if(dimensions.scene && typeof location==='string' && location.trim())hints.location=location.trim().slice(0,240)
  if(dimensions.actors) {
    const seen=new Set()
    const matches=characters.flatMap(row=>{
      const found=resolution.resolveFigureName(rows,{name:row.name},roster)
      if(found.status!=='resolved' || seen.has(found.actorKey))return []
      seen.add(found.actorKey)
      return [{actor:found.actorKey,...(typeof row.location==='string' && row.location?{location:row.location.slice(0,120)}:{})}]
    }).slice(0,8)
    if(matches.length)hints.characters=matches
  }
  return Object.keys(hints).length?{source:selected.source,...(ledger?{through:value.consolidatedTurn ?? 0}:{}),...hints}:null
}
