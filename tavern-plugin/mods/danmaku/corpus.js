import figures from '../../packages/dsh-presentation-protocol/src/figure-resolution.cjs'
import {createReactionPool,pageReactionClasses,reactionFitsPage,moodText} from './reactions.js'

export const CORPUS_EXTENSION='dsh.danmaku.corpus'
const {normalizeCatalogueText:normalize,resolveFigureName}=figures
const moments={conflict:/争吵|吵架|反驳|生气|责怪|吼|凶|质问|抱怨/,repair:/和好|和解|原谅|道歉|对不起|抱歉|谢谢|重新开始|松了口气/,music:/演奏|演出|唱歌|弹琴|乐谱|琴谱|键盘|吉他|鼓棒|排练|和弦|合奏|低音|旋律|编曲/,affection:/告白|喜欢|害羞|耳尖|脸红|心动|邀请|期待|认真|心意/,departure:/离开|退出|解散|告别|出门|回去|逃避|缺人|空着/,communication:/消息|手机|已读|回复|通话|电话|群聊|信息|联系|回答|回应/,loneliness:/孤独|一个人|寂寞|迷路|不需要|需要我|比我强|没有归宿|只有我|自卑/,practice:/练习|努力|加油|尝试|成功|进步/}
const emotions={joy:/高兴|开心|笑|喜悦|太好了|快乐|哈哈|好耶/,sad:/眼泪|哭|难受|痛苦|悲伤|泪|失落|孤独|低头|没人回|叹/,angry:/生气|怒|吵|凶|反驳|责怪|怼/,shy:/脸红|耳尖|害羞|不好意思|别开脸|扭向|红得|傲娇/,tense:/紧张|犹豫|担心|颤|小心|攥着|不敢|发愁|盯|发烫/,warm:/温柔|谢谢|感谢|陪|认真|等你|期待|关心|需要我|松了口气|可爱|抱抱|甜/,surprise:/惊讶|愣|没准备|没想到|突然|诧异|惊呼/}
const tags=(text,rules)=>Object.entries(rules).filter(([,rule])=>rule.test(text)).map(([key])=>key)
const overlap=(a,b)=>a.some(x=>b.includes(x))
const spoilers=/剧透|后面几集|下一集|最后一集|结局|二刷|三刷|重刷|前方高能|后来会|后面会|最终会|原来是伏笔/
const incidents=/春日影|crychic|mujica|退团|解散|主唱|口罩|芭菲|抹茶|上课|学校|和弦|键盘|贝斯|吉他|姐姐|妹妹|伦敦|甜甜圈|卡拉ok|天文|课表|下雨|晴天/g
export const cleanReaction=text=>normalize(text).replace(/(.)\1{5,}/gu,'$1$1$1$1').trim()
export function tokens(text) {
  const out=[]
  for(const part of normalize(text).match(/[\p{Script=Han}]+|[a-z0-9]+/gu)||[]) {
    if(/\p{Script=Han}/u.test(part)){out.push(...part);for(let i=0;i<part.length-1;i++)out.push(part.slice(i,i+2))}
    else out.push(part)
  }
  return out
}
export function createBM25(texts) {
  const lengths=[],postings=new Map()
  texts.forEach((text,i)=>{const ts=tokens(text),counts=new Map();lengths.push(ts.length);for(const t of ts)counts.set(t,(counts.get(t)||0)+1);for(const [t,n]of counts){if(!postings.has(t))postings.set(t,[]);postings.get(t).push([i,n])}})
  const average=lengths.reduce((a,b)=>a+b,0)/Math.max(1,texts.length)||1
  return query=>{
    const scores=new Float64Array(texts.length)
    for(const term of new Set(tokens(query))) {
      const rows=postings.get(term);if(!rows)continue
      const idf=Math.log(1+(texts.length-rows.length+.5)/(rows.length+.5))
      for(const [i,tf]of rows)scores[i]+=idf*tf*2.2/(tf+1.2*(.25+.75*lengths[i]/average))
    }
    return [...scores].map((score,index)=>({index,score})).sort((a,b)=>b.score-a.score||a.index-b.index)
  }
}
// Aliases come only from the work pack. Identity resolution remains the shared resolver's job.
export function mentionedCharacters(text,cast=[]) {
  const found=new Set(),value=normalize(text)
  for(const row of cast)for(const word of [row.name,...(row.aliases||[])]) {
    const key=normalize(word)
    if(!key || !value.includes(key))continue
    const hit=resolveFigureName(cast,word)
    found.add(hit.status==='resolved'?hit.actorKey:'ambiguous:'+key)
  }
  return [...found]
}
// Off-canon pools admit independent reactions, not statements about an source scene.
const reactionWords=/^(?:可爱|温柔|紧张|难受|尴尬|厉害|开心|高兴|好看|害羞|感动|心疼|伤心|悲伤|难过|寂寞|孤独|生气|愤怒|震惊|惊讶|意外|期待|担心|羡慕|喜欢|感谢|谢谢|对不起|抱歉|加油|努力|成功|抱抱|好耶|太好了|哭|笑|甜|帅|美|萌|啊|呀|哇|呜|哈|嘿|嘻|欸|诶|哦|喔|噢|唉|哎|好|太|很|真|超|最|有点|超级|真的|特别|捏|呢|了|耶|死|爆|救命|[\s\p{P}\p{S}])+$/u
function portableReaction(text,names) {
  if(text.length>18)return false
  let value=text
  for(const name of names)if(name)value=value.replaceAll(name,'')
  return reactionWords.test(value)
}
const features=(text,cast)=>({characters:mentionedCharacters(text,cast),moments:tags(normalize(text),moments),emotions:tags(moodText(normalize(text)),emotions)})
// Content alone supplies retrieval features; source metadata never enters this text.
export const windowText=w=>[w.lines.join('\n'),w.summary,w.mood.join('、')].filter(Boolean).join('\n')
export function compileCorpus({id,title,origin,groupLabel,cast=[],segments}) {
  const compiled=segments.map(w=>{
    const parts={lines:w.lines,summary:w.summary,mood:w.mood},f=features(windowText(parts),cast),unique=new Map()
    for(const c of w.comments||[]) {
      const text=cleanReaction(c.text)
      if(text.length<2||text.length>48||spoilers.test(text)||/[\u3040-\u30ff]/u.test(text))continue
      if(unique.has(text)){unique.get(text).count+=c.count||1;continue}
      unique.set(text,{text,count:c.count||1,...features(text,cast),provenance:c.provenance||[{segment:w.id}]})
    }
    return {id:w.id,...parts,...f,...Object.fromEntries(['source','position','group'].filter(k=>w[k]!==undefined).map(k=>[k,w[k]])),density:w.density??unique.size,comments:[...unique.values()]}
  })
  const corpus={version:2,id,title,origin,...(groupLabel?{groupLabel}:{}),cast,segments:compiled}
  return {...corpus,reactionPool:createReactionPool(corpus)}
}
export function corpusBrowseView(corpus) {
  const peak=Math.max(0,...corpus.segments.map(w=>w.density)),groups=new Set(),said=new Map()
  const byCount=(a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:a[0]>b[0]?1:0)
  let comments=0
  const segments=corpus.segments.map(w=>{
    for(const c of w.comments)said.set(c.text,(said.get(c.text)||0)+(c.count||1))
    comments+=w.comments.length
    if(w.group)groups.add(w.group)
    return {id:w.id,source:w.source,position:w.position,group:w.group,lines:w.lines,summary:w.summary,mood:w.mood.join('、'),
      density:peak?Math.round(100*w.density/peak):0,comments:w.comments.map(c=>[c.text,c.count||1]).sort(byCount)}
  })
  const pool=new Map()
  for(const r of createReactionPool(corpus)){if(!pool.has(r.reactionClass))pool.set(r.reactionClass,[]);pool.get(r.reactionClass).push([r.text,said.get(r.text)||r.count||1])}
  return {title:corpus.title,origin:corpus.origin,totals:{groups:groups.size,groupLabel:corpus.groupLabel,segments:segments.length,comments},segments,groups:[...groups],
    reactions:[...pool].map(([reactionClass,rows])=>({reactionClass,rows:rows.sort(byCount)}))}
}
export function validateCorpus(corpus) {
  if(!corpus||corpus.version!==2||typeof corpus.id!=='string'||typeof corpus.title!=='string'||typeof corpus.origin!=='string'||(corpus.groupLabel!==undefined&&typeof corpus.groupLabel!=='string')||!Array.isArray(corpus.cast)||!Array.isArray(corpus.segments)||corpus.segments.length>10000)throw Error('Invalid danmaku corpus')
  for(const w of corpus.segments) {
    if(['source','position','group'].some(k=>w[k]!==undefined&&typeof w[k]!=='string')||typeof w.id!=='string'||!Array.isArray(w.lines)||!w.lines.every(s=>typeof s==='string')||typeof w.summary!=='string'||!Array.isArray(w.mood)||!w.mood.every(s=>typeof s==='string')||!Number.isFinite(w.density)||!Array.isArray(w.comments)||!['characters','moments','emotions'].every(k=>Array.isArray(w[k])))throw Error('Invalid corpus window')
    for(const c of w.comments)if(typeof c.text!=='string'||!c.text||c.text.length>48||!['characters','moments','emotions'].every(k=>Array.isArray(c[k]))||!Array.isArray(c.provenance))throw Error('Invalid corpus reaction')
  }
  return corpus
}
export function createCorpusSearch(corpus) {
  const windows=corpus.segments,search=createBM25(windows.map(windowText)),character=[],emotion=[]
  const names=[...new Set(corpus.cast.flatMap(c=>[c.name,...(c.aliases||[])]).map(normalize))].sort((a,b)=>b.length-a.length)
  const portable=new Set(windows.flatMap(w=>w.comments.map(c=>c.text)).filter(text=>portableReaction(text,names)))
  for(const w of windows)for(const c of w.comments){if(c.characters.length&&c.emotions.length)character.push([w,c]);if(!c.characters.length&&c.emotions.length&&c.text.length<=12)emotion.push([w,c])}
  // Reclassify persisted pools from source comments; index metadata never grants admission.
  const reactionPool=createReactionPool(corpus)
  function page(text,presentText=text,signals={}) {
    const f=features(text,corpus.cast),present=mentionedCharacters(presentText,corpus.cast),query=normalize(text),qt=new Set(tokens(text)),ranking=search(text),candidates=[]
    const allowed=c=>!spoilers.test(c.text)&&c.characters.every(x=>!x.startsWith('ambiguous:')&&present.includes(x))&&[...c.text.matchAll(incidents)].every(m=>query.includes(m[0]))&&!c.moments.some(x=>!f.moments.includes(x))
    function add(w,c,tier,score) {
      if(!allowed(c) || tier!=='canon'&&!portable.has(c.text))return
      const lexical=tokens(c.text).filter(t=>t.length>1&&qt.has(t)).length
      const related=overlap(c.emotions,f.emotions)||overlap(c.moments,f.moments)
      if(c.emotions.length && !overlap(c.emotions,f.emotions))return
      if(!related)return
      candidates.push({text:c.text,tier,window:w.id,provenance:c.provenance,score:score+lexical*2+(overlap(c.emotions,f.emotions)?2:0)+Math.log1p(c.count)*.1})
    }
    // Reading text has no trusted source-progress cursor; lexical resemblance never grants canon facts.
    const matched=ranking.filter(({index})=>overlap(windows[index].moments,f.moments)||overlap(windows[index].emotions,f.emotions)).slice(0,8)
    for(const {index,score}of matched)for(const c of windows[index].comments)add(windows[index],c,'moment',score/10)
    for(const [w,c]of character)if(overlap(c.characters,present))add(w,c,'character',0)
    for(const [w,c]of emotion)if(overlap(c.emotions,f.emotions))add(w,c,'emotion',0)
    const order={canon:0,moment:1,character:2,emotion:3}
    candidates.sort((a,b)=>order[a.tier]-order[b.tier]||b.score-a.score||a.text.localeCompare(b.text))
    let fallbackClasses=[]
    if(!candidates.length && text.trim()) {
      fallbackClasses=pageReactionClasses(text,signals)
      let pool=reactionPool.filter(c=>fallbackClasses.includes(c.reactionClass)&&reactionFitsPage(c,text,signals))
      if(!fallbackClasses.length)pool=reactionPool.filter(c=>c.reactionClass==='neutral')
      // Quiet listening fits uneasy exposition; shouting "help" does not. Never backfill panic with cheering.
      if(!pool.length && fallbackClasses.length===1 && fallbackClasses[0]==='tense' && !reactionFitsPage({reactionClass:'tense',text:'救命'},text,signals))pool=reactionPool.filter(c=>c.reactionClass==='neutral'&&c.text!=='围观')
      // Stable page-dependent rotation avoids always choosing the most repeated source reaction.
      let seed=2166136261;for(const char of text)seed=Math.imul(seed^char.codePointAt(0),16777619)>>>0
      if(pool.length)pool=[...pool.slice(seed%pool.length),...pool.slice(0,seed%pool.length)]
      for(const c of pool)candidates.push({...c,tier:'fallback',score:0})
    }
    const best=candidates[0]?.window,density=windows.find(w=>w.id===best)?.density||0
    return {text,features:f,density,candidates,fallbackClasses}
  }
  return {search,page,plan(pages,{budget=6,recent=[],presentText}={}) {
    const rows=pages.map(p=>({...p,...page(p.text,presentText||p.text,p.signals||{})})),sum=rows.reduce((n,r)=>n+r.density,0),used=new Set(recent),counts=rows.map(r=>sum?budget*r.density/sum:budget/Math.max(1,rows.length)),budgets=counts.map(Math.floor)
    for(const i of counts.map((v,i)=>i).sort((a,b)=>(counts[b]-budgets[b])-(counts[a]-budgets[a])).slice(0,budget-budgets.reduce((a,b)=>a+b,0)))budgets[i]++
    const emitted=new Set()
    return rows.map((r,i)=>{
      const comments=[]
      for(const c of r.candidates){if(comments.length>=budgets[i])break;if(used.has(c.text))continue;used.add(c.text);emitted.add(c.text);comments.push(c)}
      // Small generic pools must not stay silent forever once every reaction is in the 80-entry history.
      // Reuse only fallback entries, never within this batch or immediately after the previous two reactions.
      if(!comments.length && budgets[i]>0){
        const adjacent=new Set([...recent,...emitted].slice(-2))
        const reusable=r.candidates.filter(c=>c.tier==='fallback'&&!emitted.has(c.text)&&!adjacent.has(c.text)).sort((a,b)=>recent.lastIndexOf(a.text)-recent.lastIndexOf(b.text))
        for(const c of reusable.slice(0,budgets[i])){emitted.add(c.text);used.add(c.text);comments.push(c)}
      }
      return {...r,candidates:undefined,budget:budgets[i],comments}
    })
  }}
}
