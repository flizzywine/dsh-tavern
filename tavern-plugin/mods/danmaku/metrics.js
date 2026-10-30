// Host-only, recorded-batch projection. No wall clock, random draws or client counters.
const seedOf = text => {
  let seed=0
  for(const char of text)seed=(Math.imul(seed,31)+char.codePointAt(0))>>>0
  return seed
}
const identity=(sessionId,author)=>{
  const seed=seedOf(JSON.stringify([sessionId,author]))
  return {follows:seed%8===0 || seed%200===0,captain:seed%200===0}
}
const contributorFor=(sessionId,author)=>{
  const revenue=identity(sessionId,author).captain?198:0
  return {author,score:revenue,comments:0,scRevenueCny:0,captainRevenueCny:revenue}
}
const addComment=(contributor,row)=>{
  contributor.comments++;contributor.score++
  if(row.kind==='highlight'){contributor.scRevenueCny+=row.amount;contributor.score+=row.amount}
}
export const emptyMetricsState = () => ({seen:[],contributors:[],recent:[],base:null,lastOffset:null,
  elapsedMs:0,rankHour:0,rankThresholds:[],snapshot:null})

export function advanceMetrics(previous,batch,{sessionId,turn,groups}) {
  const seen=new Set(previous.seen),fresh=batch.comments.filter(row=>!seen.has(row.id) && seen.add(row.id))
  if(!fresh.length)return previous
  const state=structuredClone(previous),prior=state.snapshot
  const elapsedMs=state.elapsedMs+ (state.lastOffset===null?0:Math.max(0,batch.offsetMs-state.lastOffset))
  state.lastOffset=batch.offsetMs;state.elapsedMs=elapsedMs;state.seen=[...seen]
  state.recent=state.recent.filter(at=>at>elapsedMs-60000)
  state.recent.push(...fresh.map(()=>elapsedMs))
  const heat=Math.round(Math.max(0,Math.min(100,batch.heat)))
  const target=40+32*groups+16*state.recent.filter(at=>at>elapsedMs-30000).length+seedOf(sessionId)%17
  state.base=state.base===null?target:state.base+(target-state.base)*(1-Math.exp(-(elapsedMs-(prior?.elapsedMs ?? 0))/15000))
  const online=Math.round(state.base+2.4*heat),sequence=(prior?.sequence ?? 0)+1,hour=Math.floor(elapsedMs/3600000)+1
  const snapshot={version:1,sessionId,turn,sequence,elapsedMs,online,peakOnline:Math.max(prior?.peakOnline ?? 0,online),
    onlineDelta:0,danmakuPerMinute:state.recent.length,commentCount:(prior?.commentCount ?? 0)+fresh.length,
    likes:prior?.likes ?? 0,newFollowers:prior?.newFollowers ?? 0,captains:prior?.captains ?? 0,
    scCount:prior?.scCount ?? 0,scRevenueCny:prior?.scRevenueCny ?? 0,captainRevenueCny:prior?.captainRevenueCny ?? 0,
    revenueCny:0,heat,hourlyRank:Math.max(1,Math.min(99,Math.round(300/(1+(online+14*heat)/150)))),hour,
    onlineSeries:[...(prior?.onlineSeries ?? []),{elapsedMs,online}].slice(-30),danmakuBuckets:[],topContributors:[],events:[]}
  let eventIndex=0
  const events=[...(prior?.events ?? [])]
  const event=(type,author,value)=>events.push({id:sessionId+':'+sequence+':'+eventIndex++,type,turn,elapsedMs,author,value})
  const authors=new Map(state.contributors.map(row=>[row.author,row]))
  for(const row of fresh) {
    let contributor=authors.get(row.author)
    if(!contributor) {
      contributor=contributorFor(sessionId,row.author)
      authors.set(row.author,contributor)
      const {follows,captain}=identity(sessionId,row.author)
      if(follows){snapshot.newFollowers++;event('follow',row.author,1)}
      if(captain){snapshot.captains++;snapshot.captainRevenueCny+=198;event('captain',row.author,198)}
    }
    addComment(contributor,row)
    snapshot.likes+=6+Math.floor(heat/5)
    if(row.kind==='highlight') {
      snapshot.scCount++;snapshot.scRevenueCny+=row.amount
      event('sc',row.author,row.amount)
    }
  }
  const milestone=Math.floor(snapshot.likes/1000)*1000
  if(milestone>Math.floor((prior?.likes ?? 0)/1000)*1000)event('likes-milestone',null,milestone)
  if(state.rankHour!==hour){state.rankHour=hour;state.rankThresholds=[]}
  const crossed=[50,30,20,10,5,3,1].filter(rank=>snapshot.hourlyRank<=rank && !state.rankThresholds.includes(rank))
  if(crossed.length){state.rankThresholds.push(...crossed);event('rank-milestone',null,crossed.at(-1))}
  state.contributors=[...authors.values()]
  snapshot.topContributors=[...state.contributors].sort((a,b)=>b.score-a.score || (a.author<b.author?-1:a.author>b.author?1:0)).slice(0,3)
  snapshot.revenueCny=snapshot.scRevenueCny+snapshot.captainRevenueCny
  snapshot.onlineDelta=online-(snapshot.onlineSeries.findLast(row=>row.elapsedMs<=elapsedMs-10000) || snapshot.onlineSeries[0]).online
  const bucket=Math.floor(elapsedMs/10000)*10000
  snapshot.danmakuBuckets=Array.from({length:6},(_,index)=>({startMs:bucket-(5-index)*10000,count:0})).filter(row=>row.startMs>=0)
  for(const at of state.recent) {
    const own=snapshot.danmakuBuckets.find(row=>row.startMs===Math.floor(at/10000)*10000)
    if(own)own.count++
  }
  snapshot.events=events.slice(-12);state.snapshot=snapshot
  return state
}

export const metricsBasis=state=>Object.fromEntries(['base','lastOffset','elapsedMs','rankHour','rankThresholds'].map(key=>[key,state[key]]))

// Linear hydration from the Timeline owner's admitted lineage. Snapshots are never recomputed.
export function restoreMetrics(records) {
  const state=emptyMetricsState(),seen=new Set(),authors=new Map()
  for(const row of records) {
    const batch=row.record.type==='batch'?row.record.batch:null
    if(!batch?.metrics)continue
    const {sessionId,elapsedMs}=batch.metrics
    state.recent=state.recent.filter(at=>at>elapsedMs-60000)
    for(const comment of batch.comments) {
      if(seen.has(comment.id))continue
      seen.add(comment.id);state.recent.push(elapsedMs)
      if(!authors.has(comment.author))authors.set(comment.author,contributorFor(sessionId,comment.author))
      addComment(authors.get(comment.author),comment)
    }
    Object.assign(state,batch.metricsBasis)
    state.snapshot=batch.metrics
  }
  state.seen=[...seen];state.contributors=[...authors.values()]
  return structuredClone(state)
}
