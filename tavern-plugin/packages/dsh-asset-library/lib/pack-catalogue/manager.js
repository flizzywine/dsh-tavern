// one network job at a time; publication remains owned by pack-v2.
import { randomUUID, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, unlink, statfs } from 'node:fs/promises'
import { checkedPath } from '../pack-v2/storage.js'
import { check } from '../asset-packs/common.js'
import { CATALOGUE_BYTES, parseCatalogue, digest, httpsUrl, compatibility, compareVersions } from './catalogue.js'
import {isCuratedEntry} from './curated.js'
import { publicNetwork, readBounded } from './network.js'
const errorView = e => ({code:['LIMIT_EXCEEDED','INTEGRITY_MISMATCH','ASSET_UNAVAILABLE','INVALID_INPUT','INVALID_PATH','FILE_CLOSURE_MISMATCH'].includes(e.code)?e.code:'DOWNLOAD_FAILED',message:e.code==='ENOSPC'?'Not enough disk space':e.message?.replace(/https?:\/\/\S+/g,'[URL]') || 'Download failed'})
const terminal = new Set(['completed','cancelled'])
// a link may fetch a 素材包合集 (inspection.kind 'pack-set'): its packs are applied one by one;
// a pack already applied or cancelled is marked `done`, and the job finishes when none is left.
const pending = (j,id) => j.inspection && (j.inspection.inspectionId===id || j.inspection.packs?.some(p=>p.inspectionId===id && !p.done))
export function createCatalogueManager({assetRoot,limits,settings,network=publicNetwork,inspectFile,discardInspection,listInstalled,resourceUsage=()=>0,now=Date.now,maxArchiveBytes=limits.totalSize}) {
  const jobs=new Map(), cache=new Map(), refreshes=new Map(), refreshControllers=new Set()
  const cap=Math.min(limits.totalSize,maxArchiveBytes,limits.spoolBytes)
  check(Number.isSafeInteger(cap) && cap>0,'$.maxArchiveBytes','Positive archive limit required')
  let active=null, disposed=false
  const usage=()=>[...jobs.values()].reduce((n,j)=>n+j.receivedBytes,0)
  const available=size=>check(size+usage()+resourceUsage()<=limits.spoolBytes,'$','Shared spool budget exceeded','LIMIT_EXCEEDED')
  function source(id) { const s=settings?.read().values.sources.find(s=>s.sourceId===id && s.enabled); check(s,'$.sourceId','Catalogue source unavailable','ASSET_UNAVAILABLE'); return s }
  function view(j) { return structuredClone({jobId:j.id,state:j.state,receivedBytes:j.finishedBytes ?? j.receivedBytes,totalBytes:j.totalBytes,speed:j.speed,source:j.source,downloadUrl:j.url,integrity:j.expectedSha256?'sha256':'unverified',...(j.expiresAt?{expiresAt:j.expiresAt}:{}),...(j.error?{error:j.error}:{}),...(j.inspection?{inspection:j.inspection}:{}),...(j.result?{result:j.result}:{})}) }
  function get(id) { const j=jobs.get(id); check(j,'$.jobId','Download job unavailable','ASSET_UNAVAILABLE'); return j }
  async function clear(j) {
    if(j.file) { await unlink(j.file).catch(e=>{if(e.code!=='ENOENT') throw e}); j.file=null }
    j.receivedBytes=0; j.etag=null
  }
  async function expire() {
    for(const j of jobs.values()) if(j.expiresAt && j.expiresAt<=now() && ['ready','paused','failed','queued'].includes(j.state)) {
      j.state='cancelled'; j.controller?.abort(); await j.task
      if(j.inspection) await discardInspection(j.inspection.inspectionId)
      delete j.inspection; await clear(j)
    }
  }
  async function refresh({sourceId}) {
    const s=source(sourceId)
    if(refreshes.has(sourceId)) return refreshes.get(sourceId)
    const controller=new AbortController(); refreshControllers.add(controller)
    const timeout=setTimeout(()=>controller.abort(),30000); timeout.unref?.()
    const task=(async()=>{
      try {
        const bytes=await readBounded(network,s.url,CATALOGUE_BYTES,controller.signal), c=parseCatalogue(bytes)
        check(!disposed,'$','Download service disposed','ASSET_UNAVAILABLE')
        const value={sourceId,official:s.official,catalogueRevision:digest(bytes),fetchedAt:now(),stale:false,catalogue:{id:c.id,title:c.title,updatedAt:c.updatedAt},packs:c.packs.map(p=>({...p,sourceId,official:s.official,compatibility:compatibility(p)}))}
        cache.set(sourceId,value); return structuredClone(value)
      } catch(e) {
        if(!cache.has(sourceId)) throw e
        return {...structuredClone(cache.get(sourceId)),stale:true,error:errorView(e)}
      } finally {clearTimeout(timeout);refreshes.delete(sourceId);refreshControllers.delete(controller)}
    })(); refreshes.set(sourceId,task); return task
  }
  async function download(j) {
    const controller=j.controller=new AbortController(), signal=controller.signal
    j.state='downloading'; delete j.error
    try {
      await mkdir(await checkedPath(assetRoot,'downloads'),{recursive:true})
      const space=await statfs(await checkedPath(assetRoot,'downloads'))
      check(space.bavail*space.bsize > (j.totalBytes || cap)+limits.totalSize*2,'$','Not enough disk space for download and transaction','LIMIT_EXCEEDED')
      if(!j.file) j.file=await checkedPath(assetRoot,'downloads/'+j.id+'.part')
      if(!j.etag && j.receivedBytes) await clear(j)
      if(!j.file) j.file=await checkedPath(assetRoot,'downloads/'+j.id+'.part')
      const offset=j.receivedBytes
      const headers=offset && j.etag ? {Range:`bytes=${offset}-`,'If-Range':j.etag} : {}
      let response=await network(j.url,{signal,headers}), append=false
      if(offset && response.status===206) {
        const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range'] || '')
        append=!!range && Number(range[1])===offset && Number(range[2])===Number(range[3])-1 && Number(range[3])===j.totalBytes && response.headers.etag===j.etag
      }
      if(offset && !append && response.status!==200) { response.body.destroy(); response=await network(j.url,{signal}) }
      try {
        check(response.status===200 || append,'$.response','ZIP HTTP request failed','DOWNLOAD_FAILED')
        if(!append) j.receivedBytes=0
        const declared=response.headers['content-length']
        const total=declared===undefined ? (append ? j.totalBytes : null) : Number(declared)+j.receivedBytes
        check(total===null || Number.isSafeInteger(total) && total>0 && total<=cap,'$.size','Archive download limit exceeded','LIMIT_EXCEEDED')
        if(j.expectedSize && total!==null) check(total===j.expectedSize,'$.size','Catalogue ZIP size mismatch','INTEGRITY_MISMATCH')
        j.totalBytes=j.expectedSize || total
        j.etag=/^"[^\r\n]+"$/.test(response.headers.etag || '') ? response.headers.etag : null
        const handle=await open(j.file,append?'a':'w'), start=now(), initial=j.receivedBytes
        try {
          for await(const chunk of response.body) {
            signal.throwIfAborted()
            check(j.receivedBytes+chunk.length<=cap && (!j.expectedSize || j.receivedBytes+chunk.length<=j.expectedSize),'$.size','Archive download limit exceeded','LIMIT_EXCEEDED')
            available(chunk.length)
            j.receivedBytes+=chunk.length
            try {await handle.writeFile(chunk)} catch(error) {j.etag=null;throw error}
            j.speed=Math.round((j.receivedBytes-initial)*1000/Math.max(1,now()-start))
          }
        } finally {await handle.close()}
      } finally {response.body.destroy()}
      signal.throwIfAborted()
      check(!j.totalBytes || j.receivedBytes===j.totalBytes,'$.size','Incomplete ZIP response','INTEGRITY_MISMATCH')
      j.state='verifying'; j.speed=0
      const hash=createHash('sha256')
      for await(const bytes of createReadStream(j.file,{signal})) hash.update(bytes)
      const archiveSha256=hash.digest('hex')
      check(!j.expectedSha256 || archiveSha256===j.expectedSha256,'$.sha256','ZIP SHA-256 mismatch','INTEGRITY_MISMATCH')
      j.inspection=await inspectFile(j.file,{size:j.receivedBytes,archiveSha256,source:j.source,integrity:j.expectedSha256?'sha256':'unverified',signal})
      signal.throwIfAborted()
      j.state='ready'; j.expiresAt=j.inspection.expiresAt; j.finishedBytes=j.receivedBytes
      await clear(j)
    } catch(e) {
      if(j.state!=='paused' && j.state!=='cancelled') {j.state='failed';j.error=errorView(e);j.expiresAt=now()+limits.previewTtlMs}
      if(j.inspection && j.state!=='ready') {await discardInspection(j.inspection.inspectionId);delete j.inspection}
      if(j.state==='cancelled' || !j.etag || j.error?.code!=='DOWNLOAD_FAILED' && j.state==='failed') await clear(j)
    } finally {j.controller=null;active=null; pump()}
  }
  function pump() {
    if(disposed || active) return
    const next=[...jobs.values()].find(j=>j.state==='queued')
    if(next) {active=next;next.task=download(next)}
  }
  const methods={
    catalogueSettings() {check(settings,'$','Native settings unavailable','SETTINGS_UNAVAILABLE'); return settings.read()},
    async saveCatalogueSettings(input) {
      check(settings,'$','Native settings unavailable','SETTINGS_UNAVAILABLE')
      const result=await settings.save(input), retained=new Set(result.values.sources.map(s=>s.sourceId))
      for(const id of cache.keys()) if(!retained.has(id)) cache.delete(id)
      return result
    },
    async refreshCatalogue(input) {
      const value = await refresh(input)
      return input.curated ? {...value,packs:value.official ? value.packs.filter(isCuratedEntry) : []} : value
    },
    async checkPackUpdates({packIds}={}) {
      check(packIds===undefined || Array.isArray(packIds) && packIds.length<=2000,'$.packIds')
      const installed=(await listInstalled()).filter(p=>p.local.distribution?.sourceId && (!packIds || packIds.includes(p.manifest.id)))
      const updates=[], unavailableSources=[], catalogues=new Map()
      for(const id of new Set(installed.map(p=>p.local.distribution.sourceId))) {
        try {const c=await refresh({sourceId:id}); if(c.stale) throw Error('stale');catalogues.set(id,c)} catch {unavailableSources.push(id)}
      }
      for(const p of installed) {
        const d=p.local.distribution, c=catalogues.get(d.sourceId); if(!c) continue
        const next=c.packs.find(n=>n.id===p.manifest.id), comparison=next?compareVersions(next.version,d.version):0
        updates.push({packId:p.manifest.id,sourceId:d.sourceId,currentVersion:d.version,nextVersion:next?.version || null,status:!next?'missing':comparison>0?'update':comparison<0?'ahead':next.sha256!==d.archiveSha256?'release-changed':'current'})
      }
      return {updates,unavailableSources}
    },
    async startPackDownload(input) {
      check(!disposed,'$','Download service disposed','ASSET_UNAVAILABLE'); await expire()
      let url, expectedSha256, expectedSize=null, provenance=null
      // a link install is just {url}. The user-supplied fingerprint (and the mirror that
      // needed it) is gone; old callers fail loudly. A catalogue entry keeps its published SHA-256 internally.
      for(const key of Object.keys(input || {})) check((input.selection ? ['selection','useMirrorPrefix'] : ['url']).includes(key),'$.'+key,'Unknown field','UNKNOWN_FIELD')
      if(input.selection) {
        const s=source(input.selection.sourceId), c=cache.get(s.sourceId)
        check(c && c.catalogueRevision===input.selection.catalogueRevision,'$.catalogueRevision','Catalogue changed; refresh selection','REVISION_CONFLICT')
        const p=c.packs.find(p=>p.id===input.selection.packId && p.version===input.selection.version)
        check(p && p.compatibility.supported,'$.selection','Pack needs unsupported capabilities','ASSET_UNAVAILABLE')
        const d=p.downloads.find(d=>d.id===input.selection.downloadId); check(d,'$.downloadId')
        url=d.url; expectedSha256=p.sha256; expectedSize=p.size
        provenance={sourceId:s.sourceId,catalogueUrl:s.url,official:s.official,version:p.version,packId:p.id}
        const installed=(await listInstalled()).find(row=>row.manifest.id===p.id)?.local.distribution
        if(installed?.sourceId===s.sourceId) {
          check(compareVersions(p.version,installed.version)>=0,'$.version','Catalogue downgrade rejected','INTEGRITY_MISMATCH')
          check(compareVersions(p.version,installed.version)!==0 || installed.archiveSha256===p.sha256,'$.sha256','Published version changed bytes; publisher must change version','INTEGRITY_MISMATCH')
        }
      } else {
        url=input.url
      }
      url=httpsUrl(url)
      if(input.useMirrorPrefix) {
        const prefix=settings?.read().values.mirrorPrefix
        check(expectedSha256 && prefix,'$.mirrorPrefix','Mirror requires trusted SHA-256 and configured prefix')
        url=httpsUrl(prefix+url)
      }
      check(!expectedSize || expectedSize<=cap,'$.size','Archive download limit exceeded','LIMIT_EXCEEDED'); available(expectedSize || 0)
      for(const [id,j] of jobs) if(terminal.has(j.state) && jobs.size>=32) jobs.delete(id)
      check(jobs.size<32,'$','Download job limit exceeded','LIMIT_EXCEEDED')
      const id=randomUUID(), j={id,state:'queued',url,expectedSha256,expectedSize,source:provenance,receivedBytes:0,totalBytes:expectedSize,speed:0,expiresAt:now()+limits.previewTtlMs}
      jobs.set(id,j);pump();return {jobId:id}
    },
    async getPackDownload({jobId}) {await expire();return view(get(jobId))},
    async controlPackDownload({jobId,action}) {
      const j=get(jobId)
      check(['pause','resume','cancel'].includes(action),'$.action')
      check(j.state!=='installing','$.state','Publication cannot be cancelled','REVISION_CONFLICT')
      if(action==='cancel') {
        if(terminal.has(j.state)) return view(j)
        j.state='cancelled';j.controller?.abort();await j.task
        if(j.inspection) await discardInspection(j.inspection.inspectionId)
        delete j.inspection;await clear(j)
      } else if(action==='pause') {
        check(['queued','downloading'].includes(j.state),'$.state','Only downloads can pause')
        j.state='paused';j.expiresAt=now()+limits.previewTtlMs;j.controller?.abort();await j.task
      } else {
        check(['paused','failed'].includes(j.state),'$.state','Only paused/failed jobs can resume');await j.task
        j.state='queued';j.expiresAt=now()+limits.previewTtlMs;pump()
      }
      return view(j)
    }
  }
  return {methods,usage,
    applying(id) {const j=[...jobs.values()].find(j=>pending(j,id));if(j) j.state='installing'},
    applied(id,result,error) {
      const j=[...jobs.values()].find(j=>pending(j,id));if(!j) return
      if(j.inspection.kind==='pack-set') {
        if(error) {j.state='ready';return}
        const member=j.inspection.packs.find(p=>p.inspectionId===id);member.done=result.status==='cancelled'?'cancelled':'applied'
        if(result.status!=='cancelled') j.result=result
        if(j.inspection.packs.every(p=>p.done)) {j.state=j.result?'completed':'cancelled';delete j.inspection} else j.state='ready'
        return
      }
      j.state=error?'ready':result.status==='cancelled'?'cancelled':'completed';if(result) {j.result=result;delete j.inspection}
    },
    async dispose() {disposed=true;for(const c of refreshControllers)c.abort();for(const j of jobs.values()) {j.controller?.abort();await j.task;await clear(j)}await Promise.allSettled(refreshes.values());jobs.clear();cache.clear()}
  }
}
