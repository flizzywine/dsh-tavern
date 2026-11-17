import {createHash} from 'node:crypto'
import {Readable} from 'node:stream'
import {openPackZip as openZip, packZipPath as zipPath} from '../../packages/dsh-asset-library/lib/pack-v2/service.js'
import {computeContentHash} from '../../packages/dsh-asset-library/lib/asset-packs/index.js'
import {modPackageIdentity as packageHash} from '../mod-system-distributions.js'
import {modVersionMatches} from './mod-system-semver.js'
import {validateDistributionManifest,validateDependencyGraph} from './mod-system.js'
import {validateModSystem,emptyCardMods,MOD_HOST_API,modError} from './mod-system-contract.js'
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n')
const rawChoices=card=>card.data?.extensions?.dsh_tavern?.modSystem || emptyCardMods()
export async function inspectManagedArchive(file,installed={packages:{},packs:{}},trusted=[]) {
  const zip=await openZip(file),entries=new Map(zip.entries.map(e=>[e.path,e]))
  async function readJson(name) {const entry=entries.get(name);if(!entry || entry.size>8*1024*1024)throw modError('MOD_INVALID','Missing or oversized JSON: '+name);return JSON.parse((await zip.read(entry)).toString('utf8'))}
  const archive=await readJson('dsh.json'),card=await readJson('card.json'),lock=await readJson('dsh-lock.json')
  validateModSystem('archive',archive);validateModSystem('lock',lock);validateModSystem('card',rawChoices(card))
  if(!['managed-mods/1','mod-lock/2','mod-dependencies/1'].every(feature=>archive.requires.features.includes(feature)))throw modError('MOD_HOST_API','Archive lacks the current direct mod dependency feature gate')
  if(!modVersionMatches(MOD_HOST_API,archive.requires.modHostApi))throw modError('MOD_HOST_API','This archive requires a different mod host API')
  if(Object.values(lock.mods).flatMap(mod=>mod.files).reduce((sum,file)=>sum+file.size,0)>64*1024**2)throw modError('MOD_INVALID','Archive executable code budget exceeds 64 MiB')
  const expected=new Map([['dsh.json',null],['card.json',null],['dsh-lock.json',null]]),code=new Map(),modules=[],conflicts=[]
  for(const [id,item] of Object.entries(lock.mods)) {
    const descriptor=archive.plugins.find(p=>p.name===item.packageName)
    if(!descriptor || !/^plugins\/[a-z0-9][a-z0-9._-]{0,63}\/$/.test(descriptor.path))throw modError('MOD_INVALID','Lock/plugin mismatch')
    if(packageHash(item.files)!==item.sha256)throw modError('MOD_INTEGRITY','Plugin identity does not match its file table')
    if(item.files.reduce((n,f)=>n+f.size,0)>64*1024*1024)throw modError('MOD_INVALID','Plugin exceeds 64 MiB')
    for(const row of item.files) {
      zipPath(row.path);const full=descriptor.path+row.path,entry=entries.get(full)
      if(expected.has(full) || !entry || entry.size!==row.size)throw modError('MOD_INVALID','Duplicate, missing or wrong-size plugin file: '+full)
      const bytes=await zip.read(entry)
      if(sha(bytes)!==row.sha256)throw modError('MOD_INTEGRITY','Plugin file does not match lock: '+full)
      code.set(full,bytes);expected.set(full,row)
    }
    const manifest=JSON.parse(code.get(descriptor.path+'mod.json')?.toString('utf8') || 'null')
    validateDistributionManifest(manifest)
    const pkg=JSON.parse(code.get(descriptor.path+'package.json')?.toString('utf8') || 'null')
    if(manifest.id!==id || manifest.packageName!==item.packageName || manifest.version!==item.version || pkg?.name!==item.packageName || pkg?.version!==item.version || pkg.scripts)throw modError('MOD_INVALID','Package/manifest/lock identity mismatch or install scripts')
    if(JSON.stringify([...item.dependencies].sort())!==JSON.stringify(manifest.dependencies.filter(d=>!d.optional).map(d=>d.id).sort()))throw modError('MOD_INTEGRITY','Locked dependencies differ from the published mod API manifest',{id})
    const alias=Object.values(installed.packages).find(p=>p.modId===id && p.manifest.packageName!==item.packageName)
    if(alias)conflicts.push({id,reason:'mod-id-owned',current:alias.manifest.packageName,requested:item.packageName})
    const known=trusted.some(t=>t.manifest.packageName===item.packageName && t.sha256===item.sha256)
    const reused=installed.packages[item.packageName]?.sha256===item.sha256
    if(installed.packages[item.packageName] && !reused)conflicts.push({packageName:item.packageName,current:installed.packages[item.packageName].sha256,requested:item.sha256})
    modules.push({id,name:manifest.name,packageName:item.packageName,version:item.version,sha256:item.sha256,permissions:manifest.permissions,known,reused,bytes:item.files.reduce((n,f)=>n+f.size,0),manifest})
  }
  const candidates=new Map(Object.values(installed.packages).map(p=>[p.modId,p.manifest]))
  for(const module of modules)candidates.set(module.id,module.manifest)
  validateDependencyGraph([...candidates.values()])
  if(archive.plugins.length!==modules.length)throw modError('MOD_INVALID','Unlisted plugin descriptor')
  for(const [id,item] of Object.entries(lock.packs)) {
    const descriptor=archive.packs.find(p=>p.id===id)
    if(!descriptor || descriptor.path!=='assets/'+id+'/' || descriptor.contentHash!==item.contentHash)throw modError('MOD_INVALID','Pack/lock mismatch')
    const packManifest=await readJson(descriptor.path+'manifest.json')
    if(packManifest.id!==id || packManifest.contentHash!==item.contentHash || await computeContentHash(packManifest)!==item.contentHash || JSON.stringify(packManifest.files)!==JSON.stringify(item.files.filter(f=>f.path!=='manifest.json')))throw modError('MOD_INTEGRITY','Pack content identity or file closure differs from lock')
    for(const row of item.files) {
      zipPath(row.path);const full=descriptor.path+row.path,entry=entries.get(full)
      if(expected.has(full)||!entry||entry.size!==row.size)throw modError('MOD_INVALID','Duplicate, missing or wrong-size pack file: '+full)
      expected.set(full,row)
    }
  }
  const extraFiles = ['assets/icon/images/main.png', typeof archive.defaults?.preset === 'string' ? archive.defaults.preset : archive.defaults?.preset?.path].filter(Boolean)
  for (const name of extraFiles) if (entries.has(name)) { zipPath(name); expected.set(name, null) }
  if(archive.packs.length!==Object.keys(lock.packs).length || expected.size!==entries.size || [...entries.keys()].some(key=>!expected.has(key)))throw modError('MOD_INVALID','Archive contains unlisted content')
  const newCodeBytes=modules.filter(m=>!m.reused).reduce((n,m)=>n+m.bytes,0)
  const packBytes=Object.values(lock.packs).flatMap(p=>p.files).reduce((n,f)=>n+f.size,0)
  // A token commits the entire lock, card intent and provenance, not merely a filename.
  const token=sha(json({archive,card,lock}))
  return {zip,entries,expected,code,archive,card,lock,modules,conflicts,token,newCodeBytes,packBytes,
    zipAdapter:{entries,stream:async entry=>Readable.from([code.get(entry.path) || await zip.read(entry)])}}
}
