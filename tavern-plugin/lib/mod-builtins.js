import {access,readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createManagedModHost} from './domain/mod-system-host.js'
import {firstPartyModDirectory,firstPartyModIds} from './mod-system-distributions.js'
import {registerModStageContribution} from './domain/mods/stage-contributions.js'
// One source per mod folder; its entry comes from its own mod.json, its director contribution from its optional stage.js.
const sources = Object.freeze(await Promise.all(firstPartyModIds.map(async folder => {
  const directory=firstPartyModDirectory(folder),manifest=JSON.parse(await readFile(new URL('mod.json',directory),'utf8'))
  const stage=await access(new URL('stage.js',directory)).then(()=>true,()=>false) ? (await import(new URL('stage.js',directory))).default : undefined
  return {id:manifest.id,directory,module:await import(new URL(manifest.entry,directory)),stage}
})))
// The installed first-party mods' director contributions; core reaches their stage state only through these.
for (const source of sources) if (source.stage) registerModStageContribution(source.id, source.stage)

export async function createFirstPartyMods({host}={}) {
  if(!host) {
    host=createManagedModHost({authorized:sources.map(row=>row.id)})
    for(const source of sources)source.module.apply({tavern:{registerMod:(manifest,implementation)=>host.register(manifest.packageName,manifest,implementation)}})
  }
  const releases=[]
  for (const source of sources) {
    const manifest=JSON.parse(await readFile(new URL('manifest.json',source.directory),'utf8'))
    const files=new Map(await Promise.all(manifest.files.map(async entry=>[entry.path,await readFile(new URL(entry.path,source.directory))])))
    releases.push({manifest,files,module:source.module})
  }
  const entries=new Map(releases.map(row=>[row.manifest.id,row]))
  // This is a resource catalogue; executable code belongs only to the managed host.
  const resources={manifest:id=>entries.get(id).manifest,module:id=>host.execution(id),file:(id,name)=>entries.get(id).files.get(name),files:id=>new Map(entries.get(id).files)}
  return Object.freeze({...resources,
    catalogue:() => sources.map(source=>({id:source.id,name:resources.manifest(source.id).name,version:resources.manifest(source.id).version})),
    source(id) {const source=sources.find(row=>row.id===id);if(!source)throw Object.assign(new Error('Unknown first-party release'),{code:'MOD_RESOURCE_UNAVAILABLE'});return {kind:'directory',path:fileURLToPath(source.directory)}},
  })
}
