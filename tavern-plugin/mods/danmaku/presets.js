import {normalizeCatalogueText,triggerEvidence} from '../../lib/domain/asset-pack-lexical.js'
import {refKey,commentAmount} from './contract.js'

import {viewerNickname} from './nicknames.js'

const matches=(keywords,text)=>triggerEvidence({keywords},[normalizeCatalogueText(text)]).matched
export const presetExamples=content=>[...(content.triggers || []).flatMap(row=>row.lines),
  ...(content.chains || []).flatMap(row=>row.replies)].slice(0,3).map(line=>typeof line==='string'?line:line.text)

// Both sources reserve slots in the same recorded stream. Model batches leave gaps for presets.
export function paceComments(comments,existing,clock,density) {
  const gap=density==='low'?1100:600,occupied=existing.map(row=>row.offsetMs).sort((a,b)=>a-b)
  return comments.map(row=>{
    let offset=Math.max(clock,row.offsetMs)
    for(const used of occupied) {
      if(used+gap<=offset)continue
      if(offset+gap<=used)break
      offset=used+gap
    }
    occupied.push(offset);occupied.sort((a,b)=>a-b)
    return {...row,offsetMs:offset}
  })
}

export function createAudiencePresets({now=Date.now,random=Math.random,id,chatId=()=>''}) {
  const cooldowns=new Map(),reveals=new Set(),posted=new Set(),lineages=new Map()
  let queue=[]
  const starts=new Map()
  const trim=()=>{for(const [key,at] of starts)if(at<=now()-60000)starts.delete(key)}
  function enqueue(group,rule,lines,source,depth,replyTo,revealId,due,recent,lineage={rules:[],texts:[]},parentAuthor=null) {
    trim()
    if(starts.size>=12 || queue.length>=12 || random()>=(rule.probability ?? 1))return false
    const candidate=lines[Math.floor(random()*lines.length)]
    const {text,kind='comment',amount}=typeof candidate==='string'?{text:candidate}:candidate
    const normalized=normalizeCatalogueText(text)
    if(lineage.texts.includes(normalized))return false
    if(recent.some(row=>row.text===text) || queue.some(row=>row.text===text))return false
    const commentId=id(),at=now()
    queue.push({id:commentId,group:structuredClone(group.ref),author:viewerNickname(chatId(),commentId,group,parentAuthor),text,kind,amount:commentAmount(kind,amount,random),source,depth,
      ruleId:rule.id,replyTo,revealId,mode:'scroll',color:null,size:'standard',offsetMs:due,durationMs:kind==='highlight'?9000:6500,
      presetTiming:{createdAtMs:at,cooldownUntilMs:source==='preset'?at+(rule.cooldown ?? 30)*1000:null}})
    lineages.set(commentId,{rules:[...lineage.rules,source==='chain'?rule.id:null].filter(Boolean),texts:[...lineage.texts,normalized]})
    starts.set(commentId,at)
    return true
  }
  return Object.freeze({
    restore(comments) {
      queue=[];lineages.clear()
      for(const row of comments) {
        posted.add(row.id);if(row.revealId)reveals.add(row.revealId)
        if(row.presetTiming) {
          starts.set(row.id,row.presetTiming.createdAtMs)
          if(row.presetTiming.cooldownUntilMs!==null) {
            const key=refKey(row.group)+'\0'+row.ruleId
            cooldowns.set(key,Math.max(cooldowns.get(key) || 0,row.presetTiming.cooldownUntilMs))
          }
        }
      }
      trim()
    },
    reset(){queue=[];reveals.clear();posted.clear();lineages.clear()},
    pause(comments){queue=[];lineages.clear();for(const row of comments)posted.add(row.id)},
    trigger(revealed,groups,clock,recent) {
      if(!revealed || reveals.has(revealed.id))return
      reveals.add(revealed.id)
      if(reveals.size>256)reveals.delete(reveals.values().next().value)
      for(const group of groups)for(const rule of group.content.triggers || []) {
        const key=refKey(group.ref)+'\0'+rule.id
        if(now()<(cooldowns.get(key) ?? -Infinity) || !matches(rule.keywords,revealed.text))continue
        if(enqueue(group,rule,rule.lines,'preset',0,null,revealed.id,clock,recent))
          cooldowns.set(key,now()+(rule.cooldown ?? 30)*1000)
      }
    },
    observe(comments,groups,clock,recent) {
      for(const parent of comments) {
        if(parent.offsetMs>clock || posted.has(parent.id))continue
        posted.add(parent.id)
        if((parent.depth || 0)>=5){lineages.delete(parent.id);continue}
        const lineage=lineages.get(parent.id) || {rules:[],texts:[normalizeCatalogueText(parent.text)]}
        let replied=false
        for(const group of groups) {
          for(const rule of group.content.chains || [])if(!lineage.rules.includes(rule.id) && matches([rule.match],parent.text) &&
              enqueue(group,rule,rule.replies,'chain',(parent.depth || 0)+1,parent.id,null,clock+600,recent,lineage,parent.author)) {
            replied=true;break
          }
          if(replied)break
        }
        lineages.delete(parent.id)
      }
    },
    take(groups,clock,recent) {
      const admitted=new Set(groups.map(group=>refKey(group.ref))),texts=new Set(recent.map(row=>row.text)),due=[]
      queue=queue.filter(row=>{
        if(!admitted.has(refKey(row.group)) || texts.has(row.text)){lineages.delete(row.id);return false}
        if(row.offsetMs>clock || due.length>=6)return true
        texts.add(row.text);due.push(row);return false
      })
      return due
    },
    next(comments,clock) {
      const times=[...queue.map(row=>row.offsetMs),...comments.filter(row=>!posted.has(row.id) && row.offsetMs>clock).map(row=>row.offsetMs)]
      return times.length?Math.max(1,Math.min(...times)-clock):null
    },
  })
}
