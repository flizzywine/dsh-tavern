import path from 'node:path'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {readFile, readdir, mkdir, writeFile, rename, unlink, stat, utimes} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {check, validateUuid, validateHash} from '../asset-packs/common.js'
import {checkedPath} from './storage.js'

const image = descriptor => ['png','jpeg','webp'].includes(descriptor?.ext)
// Longest-side tiers. The client asks for its measured box/crop times devicePixelRatio.
export const THUMBNAIL_SIZES = [256,512,1024]
const absent = error => { if (error.code !== 'ENOENT') throw error }
async function encode(bytes, size = 256) {
  // A worker thread still shares native DLLs: use a process to isolate host libvips.
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./thumbnail-encoder.js', import.meta.url)),String(size)], {
      windowsHide:true, stdio:['pipe','pipe','pipe'], env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}, timeout:30000
    })
    const output = [], errors = []
    child.stdout.on('data', chunk => output.push(chunk))
    child.stderr.on('data', chunk => errors.push(chunk))
    child.on('error', reject)
    child.stdin.on('error', reject)
    child.on('close', code => code === 0 ? resolve(Buffer.concat(output)) : reject(new Error(Buffer.concat(errors).toString() || 'Thumbnail encoder exited: ' + code)))
    child.stdin.end(bytes)
  })
}

// Disposable derived data only. Identity comes from the catalogue, never a media rehash.
export function createThumbnailCache({assetRoot, service, encodeImage = encode, maxBytes = 256 * 1024 ** 2,
  delayMs = 1000, startupMs = 10000, isBusy = () => false, onError = error => console.warn('[asset-thumbnails]',error.message)}) {
  const root = path.join(assetRoot,'thumbnail-cache','v2'), pending = new Map(), packs = new Set()
  const cache = new Map(), sources = new Map()
  let bytes = 0, tail = Promise.resolve(), timer, stopped = false, scanning = false, entries = [], scanTask, startupTask, initialized
  const keyFor = (hash,size) => hash + ':' + size
  const file = (hash,size = 256) => checkedPath(root,hash + (size === 256 ? '' : '-' + size) + '.png')
  const enqueue = action => {const task=tail.then(action);tail=task.catch(()=>{});return task}
  async function snapshot(packId) { validateUuid(packId); return service.getPackSnapshot({packId}) }
  const hashes = pack => new Set(Object.entries(pack?.manifest.blobs || {}).filter(([,descriptor])=>image(descriptor)).map(([hash])=>hash))
  const used = hash => [...sources.values()].some(set=>set.has(hash))
  async function remove(key) {
    const entry=cache.get(key)
    if (!entry) return
    await unlink(await file(entry.hash,entry.size)).catch(absent)
    cache.delete(key);bytes-=entry.bytes
  }
  async function trim(extra = 0) {
    for (const key of cache.keys()) {if(bytes+extra<=maxBytes)break;await remove(key)}
  }
  async function touch(key) {
    const entry=cache.get(key)
    cache.delete(key);cache.set(key,entry)
    const now=new Date();await utimes(await file(entry.hash,entry.size),now,now).catch(absent)
  }
  function initialize() {
    if (!initialized) initialized=(async()=>{
      // Read only this owned flat cache directory. mtime preserves LRU across restarts.
      const legacy=path.join(assetRoot,'thumbnail-cache','v1')
      for(const row of await readdir(legacy,{withFileTypes:true}).catch(error=>{absent(error);return []})) {
        if(row.isFile() && /^(?:[a-f0-9]{64}(?:-(?:512|1024))?\.webp|[a-f0-9-]{36}\.tmp)$/.test(row.name))await unlink(await checkedPath(legacy,row.name)).catch(absent)
      }
      const rows=await readdir(root,{withFileTypes:true}).catch(error=>{absent(error);return []}), found=[]
      for(const row of rows) {
        if(!row.isFile())continue
        if(/^[a-f0-9-]{36}\.tmp$/.test(row.name)){await unlink(await checkedPath(root,row.name)).catch(absent);continue}
        const match=/^([a-f0-9]{64})(?:-(512|1024))?\.png$/.exec(row.name)
        if(!match)continue
        const hash=match[1],size=Number(match[2]||256),info=await stat(await file(hash,size)).catch(absent)
        if(info)found.push({hash,size,bytes:info.size,at:info.mtimeMs})
      }
      for(const entry of found.sort((a,b)=>a.at-b.at)){cache.set(keyFor(entry.hash,entry.size),entry);bytes+=entry.bytes}
      const summaries=await service.listPackSummaries()
      // A failed catalogue read must never be interpreted as deletion.
      check(!summaries.some(row=>row.error),'$.thumbnail','Cannot reconcile an unavailable pack','ASSET_UNAVAILABLE')
      for(const row of summaries)if(!row.privateConfig)sources.set(row.packId,hashes(await snapshot(row.packId)))
      for(const [key,entry]of cache)if(!used(entry.hash))await remove(key)
      await trim()
    })()
    return initialized
  }
  async function get({packId,hash,size = 256}) {
    validateUuid(packId);validateHash(hash);check(THUMBNAIL_SIZES.includes(size),'$.size','Unsupported thumbnail size')
    await initialize()
    const pack=await snapshot(packId)
    if(!image(pack?.manifest.blobs[hash]))return null
    const key=keyFor(hash,size)
    if(pending.has(key))return pending.get(key)
    const task=enqueue(async()=>{
      check(!stopped,'$.thumbnail','Thumbnail cache stopped','ASSET_UNAVAILABLE')
      const target=await file(hash,size),hit=cache.has(key)?await readFile(target).catch(absent):null
      if(hit?.length){await touch(key);return hit}
      if(cache.has(key)){bytes-=cache.get(key).bytes;cache.delete(key)}
      const {bytes:input}=await service.readMedia({packId,hash,expectedRevision:pack.revision})
      const output=await encodeImage(input,size)
      // Replacement/removal while encoding cannot resurrect an obsolete disk entry.
      const latest=await snapshot(packId)
      if(stopped || !image(latest?.manifest.blobs[hash]))return null
      sources.set(packId,hashes(latest))
      if(output.length>maxBytes)return output
      await trim(output.length);await mkdir(root,{recursive:true})
      const temporary=await checkedPath(root,randomUUID()+'.tmp')
      try {await writeFile(temporary,output,{flag:'wx'});await rename(temporary,target)}
      finally {await unlink(temporary).catch(absent)}
      cache.set(key,{hash,size,bytes:output.length});bytes+=output.length
      return output
    })
    pending.set(key,task)
    try{return await task}finally{pending.delete(key)}
  }
  async function manifest(packId) {
    await initialize()
    const pack=await snapshot(packId)
    return {hashes:[...hashes(pack)].filter(hash=>cache.has(keyFor(hash,256)))}
  }
  function schedule(delay = delayMs) {
    if(stopped || timer || scanning)return
    timer=setTimeout(()=>{timer=null;scanTask=step()},delay);timer.unref?.()
  }
  async function step() {
    if(stopped)return
    if(isBusy() || pending.size){schedule();return}
    scanning=true
    try {
      await initialize()
      if(!entries.length && packs.size){
        const packId=packs.values().next().value;packs.delete(packId)
        entries=[...hashes(await snapshot(packId))].map(hash=>({packId,hash}))
      }
      const entry=entries.shift()
      if(entry && !stopped && !cache.has(keyFor(entry.hash,256)))await get(entry)
    }catch(error){onError(error)}
    finally{scanning=false;if(entries.length || packs.size)schedule()}
  }
  function warm(packId){if(!stopped){packs.add(packId);schedule()}}
  const stopChanges=service.subscribe(event=>{
    if(stopped)return
    void enqueue(async()=>{
      await initialize()
      const previous=sources.get(event.packId)||new Set(),current=hashes(await snapshot(event.packId))
      sources.set(event.packId,current)
      for(const [key,entry]of cache)if(!used(entry.hash))await remove(key)
      if(event.revision && [...current].some(hash=>!previous.has(hash)))warm(event.packId)
    }).catch(onError)
  })
  let startup
  function start() {
    if(startup || stopped)return
    startup=setTimeout(()=>{
      startup=null
      startupTask=initialize().then(()=>{for(const packId of sources.keys())warm(packId)}).catch(error=>{if(!stopped)onError(error)})
    },startupMs);startup.unref?.()
  }
  return {get,manifest,warm,start,debug:()=>({bytes,maxBytes,entries:cache.size,pending:pending.size}),async dispose(){
    stopped=true;clearTimeout(startup);clearTimeout(timer);stopChanges();packs.clear();entries=[]
    await Promise.all([tail,scanTask,startupTask,initialized]);cache.clear();sources.clear();bytes=0
  }}
}
