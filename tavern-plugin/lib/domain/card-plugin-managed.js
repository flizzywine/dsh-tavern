import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {isDeepStrictEqual as equal} from 'node:util'
import {modError} from './mod-system-contract.js'
import {validateDependencyGraph,validateDistributionManifest} from './mod-system.js'
import {inspectModPackage,MOD_PACKAGE_LIMIT} from './mod-system-package.js'

const clone=structuredClone
const empty=()=>({revision:0,value:{releases:[],locks:[]}})
const identity=row=>row.manifest.packageName+'\0'+row.digest
const folder=row=>'card-'+row.manifest.packageName.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^[^a-z0-9]+/,'').slice(0,64)+'-'+row.digest.slice(0,12)
const fail=(code,message,details)=>{throw modError(code,message,details)}
async function readJson(file,fallback) {
  try{return JSON.parse(await fs.readFile(file,'utf8'))}catch(error){if(error.code==='ENOENT')return fallback;throw error}
}
async function atomicJson(file,value) {
  await fs.mkdir(path.dirname(file),{recursive:true})
  const temporary=file+'.'+randomUUID()+'.tmp',handle=await fs.open(temporary,'wx')
  try{await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync()}finally{await handle.close()}
  await fs.rename(temporary,file)
}

// Owned by createCardPlugins: its serial lane covers both ordinary card packages and managed
// installation roots. The journal and cached bundles live beside the original staged packages.
export function createCardPluginManagedOwner({stagingRoot,pluginsDir,serial,invalidate,distributions,cardRoots,retiredIds=[]}) {
  const root=path.join(stagingRoot,'.managed'),stateFile=path.join(root,'state.json'),journalFile=path.join(root,'journal.json')
  let catalogue
  const local=()=>catalogue ||= Promise.resolve().then(distributions).then(rows=>{
    for(const row of rows)validateDistributionManifest(row.manifest)
    return rows
  })
  async function frame() {
    const state=await readJson(stateFile,empty()),value=clone(state.value),bundles=await local()
    value.releases=value.releases.filter(row=>!retiredIds.includes(row.manifest.id))
    value.locks=value.locks.filter(row=>!retiredIds.includes(row.modId))
    for(const bundle of bundles)if(!value.releases.some(row=>identity(row)===bundle.manifest.packageName+'\0'+bundle.sha256))value.releases.push({manifest:clone(bundle.manifest),digest:bundle.sha256,files:clone(bundle.files),installed:false,active:false,authorized:false,globalRoot:false})
    const roots=cardRoots?await cardRoots():null
    if(roots) {
      const previous=value.locks
      value.locks=roots.flatMap(card=>card.mods.flatMap(modId=>{
        const lock=previous.find(row=>row.cardId===card.cardId && row.modId===modId)
        if(lock)return [lock]
        const release=value.releases.find(row=>row.manifest.id===modId && row.active && row.installed)
        return release?[{cardId:card.cardId,modId,digest:release.digest,range:'^'+release.manifest.version}]:[]
      }))
    }
    return {revision:JSON.stringify([state.revision,bundles.map(row=>row.sha256),roots]),value,stateRevision:state.revision,persisted:state.value}
  }
  function validate(previous,next) {
    if(!next || !Array.isArray(next.releases) || !Array.isArray(next.locks) || next.releases.length!==previous.releases.length)fail('MOD_INVALID','Invalid installation transaction')
    const keys=new Set(),activeIds=new Set(),activePackages=new Set()
    for(const row of next.releases) {
      const prior=previous.releases.find(item=>identity(item)===identity(row))
      if(!prior || !equal(prior.manifest,row.manifest) || !equal(prior.files,row.files) || keys.has(identity(row)) || !/^[a-f0-9]{64}$/.test(row.digest))fail('MOD_INVALID','Installation must use an exact known release')
      keys.add(identity(row))
      if(['installed','active','authorized','globalRoot'].some(key=>typeof row[key]!=='boolean') || row.active && !row.installed || row.globalRoot && !row.installed)fail('MOD_INVALID','Invalid installation root')
      if(row.active) {
        if(activeIds.has(row.manifest.id) || activePackages.has(row.manifest.packageName))fail('MOD_VERSION_CONFLICT','The profile can run only one release per mod and package')
        activeIds.add(row.manifest.id);activePackages.add(row.manifest.packageName)
      }
    }
    const lockKeys=new Set()
    for(const lock of next.locks) {
      const row=next.releases.find(row=>row.manifest.id===lock.modId && row.digest===lock.digest),key=lock.cardId+'\0'+lock.modId
      if(!row || !row.installed || typeof lock.cardId!=='string' || !lock.cardId || typeof lock.range!=='string' || lockKeys.has(key))fail('MOD_INVALID','Invalid managed card lock')
      lockKeys.add(key)
    }
    validateDependencyGraph(next.releases.filter(row=>row.active && row.installed).map(row=>row.manifest))
  }
  async function cache(row,supplied) {
    const directory=path.join(root,'releases',row.digest)
    if(await readJson(path.join(directory,'.release.json'),null))return directory
    const bundle=supplied || (await local()).find(item=>item.sha256===row.digest && item.manifest.packageName===row.manifest.packageName)
    if(!bundle)fail('MOD_MISSING','Cached release is unavailable',{id:row.manifest.id,digest:row.digest})
    const temporary=directory+'.'+randomUUID()+'.tmp'
    await fs.mkdir(temporary,{recursive:true})
    try {
      const prefix='plugins/'+bundle.folder+'/'
      for(const entry of bundle.entries) {
        const relative=entry.path.slice(prefix.length)
        if(!entry.path.startsWith(prefix) || !relative || relative.split('/').some(part=>part==='..' || part==='') || path.isAbsolute(relative) || relative.includes('\\'))fail('MOD_INVALID','Invalid distribution member')
        const target=path.join(temporary,relative)
        await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,entry.data)
      }
      await atomicJson(path.join(temporary,'.release.json'),{digest:row.digest,files:row.files})
      await fs.rename(temporary,directory)
    } catch(error){await fs.rm(temporary,{recursive:true,force:true});throw error}
    return directory
  }
  async function installed() {
    let entries
    try{entries=await fs.readdir(pluginsDir,{withFileTypes:true})}catch(error){if(error.code==='ENOENT')return [];throw error}
    const rows=[]
    for(const entry of entries.filter(row=>row.isDirectory() && !row.name.startsWith('.'))) {
      const pkg=await readJson(path.join(pluginsDir,entry.name,'package.json'),null)
      if(!pkg?.name)continue
      const marker=await readJson(path.join(pluginsDir,entry.name,'.dsh-card.json'),null)
      rows.push({name:pkg.name,folder:entry.name,managed:marker?.managed===true})
    }
    return rows
  }
  async function publish(transaction) {
    const desired=transaction.after.value.releases.filter(row=>row.active && row.installed && row.authorized)
    const current=await installed()
    // Never replace an ordinary user/card plugin merely because its package name matches.
    for(const row of desired) {
      const holder=current.find(item=>item.name===row.manifest.packageName && !item.managed)
      if(holder)fail('MOD_CODE_CONFLICT','An unmanaged plugin owns this package name',{mods:[row.manifest.id],packageName:row.manifest.packageName})
    }
    for(const row of desired) {
      const name=folder(row),target=path.join(pluginsDir,name),holder=current.find(item=>item.folder===name)
      const marker={managed:true,modId:row.manifest.id,sha256:row.digest,globalRoot:row.globalRoot,cards:transaction.after.value.locks.filter(lock=>lock.modId===row.manifest.id && lock.digest===row.digest).map(lock=>lock.cardId)}
      if(holder?.folder===name) {await atomicJson(path.join(target,'.dsh-card.json'),marker);continue}
      const source=await cache(row),temporary=path.join(pluginsDir,'.managed-'+randomUUID())
      await fs.mkdir(pluginsDir,{recursive:true});await fs.cp(source,temporary,{recursive:true})
      await atomicJson(path.join(temporary,'.dsh-card.json'),marker)
      await fs.rename(temporary,target)
    }
    for(const holder of current)if(holder.managed && !desired.some(row=>row.manifest.packageName===holder.name && folder(row)===holder.folder))await fs.rm(path.join(pluginsDir,holder.folder),{recursive:true,force:true})
    await atomicJson(stateFile,transaction.after)
    await fs.rm(journalFile,{force:true})
    invalidate()
    // Wake the existing plugin watcher after the transaction gate is clear.
    await fs.mkdir(pluginsDir,{recursive:true});await fs.writeFile(path.join(pluginsDir,'.managed-published'),String(transaction.after.revision))
  }
  async function recover() {
    const transaction=await readJson(journalFile,null)
    if(transaction)await publish(transaction)
  }
  return Object.freeze({
    inspect:bytes=>serial(async()=>{
      if(!Buffer.isBuffer(bytes) || !bytes.length || bytes.length>MOD_PACKAGE_LIMIT)fail('MOD_INVALID','Package must be a nonempty ZIP of at most 64 MiB')
      await recover()
      const directory=path.join(root,'uploads');await fs.mkdir(directory,{recursive:true})
      const file=path.join(directory,randomUUID()+'.dshmod')
      let bundle
      try {
        await fs.writeFile(file,bytes,{flag:'wx'})
        const inspected=await inspectModPackage(file)
        if(retiredIds.includes(inspected.manifest.id))fail('MOD_INVALID','This capability is now built into the host, not an installable mod')
        bundle={manifest:inspected.manifest,files:inspected.files,sha256:inspected.sha256,folder:'local',entries:[...inspected.code].map(([path,data])=>({path,data}))}
      } finally {await fs.rm(file,{force:true})}
      const current=await frame(),value=clone(current.value)
      const row={manifest:clone(bundle.manifest),digest:bundle.sha256,files:clone(bundle.files),installed:false,active:false,authorized:false,globalRoot:false}
      if(value.releases.some(item=>item.manifest.id===row.manifest.id && item.manifest.packageName!==row.manifest.packageName || item.manifest.id!==row.manifest.id && item.manifest.packageName===row.manifest.packageName))fail('MOD_CODE_CONFLICT','Package and mod identities must remain one-to-one',{mods:[row.manifest.id]})
      if(!value.releases.some(item=>identity(item)===identity(row))) {
        await cache(row,bundle)
        value.releases.push(row)
        await atomicJson(stateFile,{revision:current.stateRevision+1,value})
      }
      return {modId:row.manifest.id,version:row.manifest.version,digest:row.digest}
    }),
    read:()=>serial(async()=>{await recover();const {revision,value}=await frame();return {revision,value}}),
    compareAndSwap:input=>serial(async()=>{
      await recover()
      const current=await frame()
      if(current.revision!==input.expectedRevision || !equal(current.value,input.expectedValue))fail('MOD_REVISION_CONFLICT','Installed releases changed; preview again')
      const value=clone(input.value);validate(current.value,value)
      if(equal(value,current.value) && equal(value,current.persisted))return {revision:current.revision,value}
      const present=await installed()
      for(const row of value.releases.filter(row=>row.active && row.installed && row.authorized)) {
        if(present.some(item=>item.name===row.manifest.packageName && !item.managed))fail('MOD_CODE_CONFLICT','An unmanaged plugin owns this package name',{mods:[row.manifest.id],packageName:row.manifest.packageName})
        await cache(row)
      }
      const transaction={before:{revision:current.stateRevision,value:current.value},after:{revision:current.stateRevision+1,value}}
      await atomicJson(journalFile,transaction)
      await publish(transaction)
      const next=await frame();return {revision:next.revision,value:next.value}
    }),
  })
}
