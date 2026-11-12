import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {validateDistributionManifest} from './domain/mod-system.js'

const root=fileURLToPath(new URL('../../',import.meta.url))
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
import {modPackageIdentity} from './domain/mod-system-package.js'
export {modPackageIdentity}
async function filesIn(directory,prefix='') {
  const files=[]
  for(const entry of await fs.readdir(path.join(directory,prefix),{withFileTypes:true})) {
    if(entry.isSymbolicLink())throw new Error('Distribution source must not contain links')
    if(entry.isDirectory())files.push(...await filesIn(directory,prefix+entry.name+'/'))
    else if(entry.isFile())files.push(prefix+entry.name)
  }
  return files.sort((a,b)=>a.localeCompare(b))
}

// The CLI and native owner publish the same prebuilt code; runtime never loads a compiler.
// Only the user-plugin loader imports the installed entry after code consent.
// Every folder under tavern-plugin/mods is one first-party mod (docs/mod-authoring.md); the folder list is the only list.
export const firstPartyModIds = (await fs.readdir(path.join(root,'tavern-plugin/mods'),{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort()
// Their manifest ids (mod.json id, dsh.<folder>), for the readers that tell a first-party managed mod from others.
export const firstPartyManifestIds = await Promise.all(firstPartyModIds.map(async folder => JSON.parse(await fs.readFile(path.join(root,'tavern-plugin/mods',folder,'mod.json'),'utf8')).id))
export const firstPartyModDirectory = folder => pathToFileURL(path.join(root,'tavern-plugin/mods',folder)+path.sep)
export async function firstPartyDistributions() {
  const results=[]
  for(const id of firstPartyModIds) {
    const directory=path.join(root,'tavern-plugin/mods',id),manifest=JSON.parse(await fs.readFile(path.join(directory,'mod.json'),'utf8'))
    validateDistributionManifest(manifest)
    const compiled=await fs.readFile(path.join(root,'tavern-plugin/lib/host','mod-'+id+'.mjs'))
    const files=[],entries=[]
    for(const relative of await filesIn(directory)) {
      const bytes=relative===manifest.entry?compiled:await fs.readFile(path.join(directory,relative))
      files.push({path:relative,sha256:sha(bytes),size:bytes.length});entries.push({path:'plugins/'+id+'/'+relative,data:bytes})
    }
    results.push({manifest,files,sha256:modPackageIdentity(files),entries,folder:id})
  }
  return results
}
