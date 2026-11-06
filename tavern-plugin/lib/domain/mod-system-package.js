import {createHash} from 'node:crypto'
import {Readable} from 'node:stream'
import {openZip,zipPath} from '../../packages/dsh-asset-library/lib/zip.js'
import {modVersionMatches} from './mod-system-semver.js'
import {validateDistributionManifest} from './mod-system.js'
import {validateModSystem,modError,MOD_HOST_API} from './mod-system-contract.js'
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n')
export const modPackageIdentity=files=>sha(Buffer.from([...files].sort((a,b)=>a.path.localeCompare(b.path)).map(f=>f.path+'\0'+f.sha256+'\n').join('')))
const packageHash=modPackageIdentity
export const MOD_PACKAGE_LIMIT=64*1024**2
const limit=MOD_PACKAGE_LIMIT
export function validateModPackageIdentity(manifest,pkg) {
  try{validateDistributionManifest(manifest)}catch(error){error.details={id:manifest?.id,packageName:manifest?.packageName,...error.details};throw error}
  if(!modVersionMatches(MOD_HOST_API,manifest.hostApi))throw modError('MOD_HOST_API','This package requires a different host API',{id:manifest.id,required:manifest.hostApi,hostApi:MOD_HOST_API})
  if(pkg?.name!==manifest.packageName || pkg.version!==manifest.version || pkg.type!=='module' || pkg.exports?.['.']!=='./'+manifest.entry || pkg.scripts)throw modError('MOD_INVALID','package.json must match name/version, use type=module and exports[.]=./<entry>, and omit scripts',{id:manifest.id,packageName:manifest.packageName})
}
export async function inspectModPackage(file) {
  const zip=await openZip(file),entries=new Map(zip.entries.map(e=>[e.path,e])),header=entries.get('dsh-mod-package.json')
  if(!header || header.size>8*1024**2)throw modError('MOD_INVALID','Expected dsh-mod-package.json in a .dshmod ZIP')
  const descriptor=JSON.parse((await zip.read(header)).toString('utf8'));validateModSystem('package',descriptor)
  if(descriptor.manifest!=='mod.json' || descriptor.files.reduce((n,f)=>n+f.size,0)>limit)throw modError('MOD_INVALID','Unsupported manifest path or package exceeds 64 MiB')
  const code=new Map(),expected=new Map(),folder='local',prefix='plugins/'+folder+'/'
  for(const row of descriptor.files) {
    zipPath(row.path);const entry=entries.get(row.path)
    if(row.path==='dsh-mod-package.json' || code.has(prefix+row.path) || !entry || entry.size!==row.size)throw modError('MOD_INVALID','Duplicate/missing/wrong-size package file',{path:row.path})
    const bytes=await zip.read(entry)
    if(sha(bytes)!==row.sha256)throw modError('MOD_INTEGRITY','Package bytes differ from descriptor',{path:row.path})
    code.set(prefix+row.path,bytes);expected.set(prefix+row.path,row)
  }
  if(entries.size!==code.size+1)throw modError('MOD_INVALID','Package contains unlisted files')
  const manifest=JSON.parse(code.get(prefix+'mod.json')?.toString('utf8') || 'null'),pkg=JSON.parse(code.get(prefix+'package.json')?.toString('utf8') || 'null')
  validateModPackageIdentity(manifest,pkg)
  if(!code.has(prefix+manifest.entry))throw modError('MOD_INVALID','Declared entry is missing',{id:manifest.id})
  const sha256=packageHash(descriptor.files)
  return {manifest,files:descriptor.files,sha256,token:sha(json({descriptor,sha256})),expected,code,
    plugins:[{name:manifest.packageName,path:prefix,purpose:manifest.name}],zipAdapter:{entries:new Map([...code].map(([path,bytes])=>[path,{path,size:bytes.length}])),stream:async entry=>Readable.from([code.get(entry.path)])}}
}

