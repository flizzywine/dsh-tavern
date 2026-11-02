import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import * as dice from '../mods/dice/plugin.mjs'
import * as timer from '../mods/timer/plugin.mjs'
import * as phone from '../mods/phone/plugin.mjs'
import * as textcard from '../mods/textcard/plugin.mjs'
import {createManagedModHost} from './domain/mod-system-host.js'
import {registerModStageContribution} from './domain/mods/stage-contributions.js'
import timerStage from '../packages/dsh-tavern-stage/lib/mods/timer/stage.js'
import phoneStage from '../mods/phone/stage.js'
const sources = Object.freeze([
  {id:'dsh.dice',directory:new URL('../mods/dice/',import.meta.url),module:dice},
  {id:'dsh.timer',directory:new URL('../mods/timer/',import.meta.url),module:timer,stage:timerStage},
  {id:'dsh.phone',directory:new URL('../mods/phone/',import.meta.url),module:phone,stage:phoneStage},
  {id:'dsh.textcard',directory:new URL('../mods/textcard/',import.meta.url),module:textcard},
])
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
    validatePack:(id,pack)=>entries.get(id)?.module.validatePack?.(pack),
    catalogue:() => sources.map(source=>({id:source.id,name:resources.manifest(source.id).name,version:resources.manifest(source.id).version})),
    source(id) {const source=sources.find(row=>row.id===id);if(!source)throw Object.assign(new Error('Unknown first-party release'),{code:'MOD_RESOURCE_UNAVAILABLE'});return {kind:'directory',path:fileURLToPath(source.directory)}},
  })
}
