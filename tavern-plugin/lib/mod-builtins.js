import {access,readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createManagedModHost} from './domain/mod-system-host.js'
import {firstPartyModDirectory,firstPartyModIds} from './mod-system-distributions.js'
import {registerModStageContribution} from './domain/mods/stage-contributions.js'
import {modDeclarations} from './domain/mods/declarations.js'
// One source per mod folder: its mod.json, its entry, and its director contribution from its optional stage.js.
const sources = Object.freeze(await Promise.all(firstPartyModIds.map(async folder => {
  const directory=firstPartyModDirectory(folder),manifest=modDeclarations(JSON.parse(await readFile(new URL('mod.json',directory),'utf8')))
  const stage=await access(new URL('stage.js',directory)).then(()=>true,()=>false) ? (await import(new URL('stage.js',directory))).default : undefined
  return {id:manifest.id,directory,manifest,module:await import(new URL(manifest.entry,directory)),stage}
})))
// The installed first-party mods' director contributions; core reaches their stage state only through these.
for (const source of sources) if (source.stage) registerModStageContribution(source.id, source.stage)

export async function createFirstPartyMods({host}={}) {
  if(!host) {
    host=createManagedModHost({authorized:sources.map(row=>row.id)})
    for(const source of sources)source.module.apply({tavern:{registerMod:(manifest,implementation)=>host.register(manifest.packageName,manifest,implementation)}})
  }
  // The director rules and core assets a mod's mod.json names are the files the director and its renders read.
  const entries=new Map(await Promise.all(sources.map(async ({manifest,directory})=>[manifest.id,{manifest,
    files:new Map(await Promise.all([...manifest.commandPrompts,...manifest.coreAssets].map(async row=>[row.path,await readFile(new URL(row.path,directory))])))}])))
  // This is a resource catalogue; executable code belongs only to the managed host.
  const resources={manifest:id=>entries.get(id).manifest,module:id=>host.execution(id),file:(id,name)=>entries.get(id).files.get(name),files:id=>new Map(entries.get(id).files)}
  return Object.freeze({...resources,
    catalogue:() => sources.map(source=>({id:source.id,name:source.manifest.name,version:source.manifest.version})),
    source(id) {const source=sources.find(row=>row.id===id);if(!source)throw Object.assign(new Error('Unknown first-party release'),{code:'MOD_RESOURCE_UNAVAILABLE'});return {kind:'directory',path:fileURLToPath(source.directory)}},
  })
}
