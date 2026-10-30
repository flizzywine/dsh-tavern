import {CORPUS_EXTENSION,corpusBrowseView,createCorpusSearch} from '../mods/danmaku/corpus.js'

// readAudienceCorpus (素材库 › 观众群 › 真实弹幕, read-only): the same-origin app UI reads one audience entry's own attached
// corpus. Only {packId, assetId} come in; the file is the entry's declared extension path, read by the entry-bound reader
// (credits/ + the manifest's own file list), so no request names a path.
export async function readAudienceCorpus({library,origin,packId,assetId}) {
  if(typeof origin!=='string')throw Object.assign(new Error('Same-origin app authority required'),{code:'PERMISSION_DENIED'})
  const pack=await library.getPackSnapshot({packId})
  const reference=pack?.manifest.assets.find(a=>a.kind==='audience'&&a.id===assetId)?.extensions?.[CORPUS_EXTENSION]
  if(typeof reference?.path!=='string')throw Object.assign(new Error('This audience entry has no corpus'),{code:'ASSET_UNAVAILABLE'})
  const file=await library.readAssetText({ref:{packId,kind:'audience',assetId},path:reference.path})
  return corpusBrowseView(JSON.parse(file.text))
}

// Only recalled audience entries reach this reader; large reference text never enters event/model payloads.
export function createDanmakuRetrieval({read}) {
  const cache=new Map()
  return async (groups,{pages,budget,recent=[]})=>{
    const result=[],used=new Set(recent)
    let remaining=budget
    for(const group of groups) {
      const reference=group.extensions?.[CORPUS_EXTENSION]
      if(!reference || !remaining)continue
      const key=JSON.stringify(group.ref),previous=cache.get(key)
      const file=await read({ref:group.ref,path:reference.path,knownIdentity:previous?.identity})
      let entry=previous
      if(!entry||entry.identity!==file.identity){entry={identity:file.identity,search:createCorpusSearch(JSON.parse(file.text))};cache.set(key,entry);while(cache.size>4)cache.delete(cache.keys().next().value)}
      const plan=entry.search.plan(pages,{budget:remaining,recent:[...used]})
      for(const p of plan)for(const c of p.comments){used.add(c.text);result.push({...c,group:group.ref,page:p.index??p.page});remaining--}
    }
    return {comments:result}
  }
}
