import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import * as dice from '../mods/dice/plugin.mjs'
import * as timer from '../mods/timer/plugin.mjs'
import * as phone from '../mods/phone/plugin.mjs'
import * as textcard from '../mods/textcard/plugin.mjs'
import * as danmaku from '../mods/danmaku/plugin.mjs'
import {validateAudienceContent} from '../mods/danmaku/audience.js'
import {projectView} from '../mods/danmaku/contract.js'
import {CORPUS_EXTENSION} from '../mods/danmaku/corpus.js'
import {emptyPresentation,appendPresentation,readPresentation} from '../mods/danmaku/presentation.js'
import {createManagedModHost} from './domain/mod-system-host.js'
import {registerModStageContribution} from './domain/mods/stage-contributions.js'
import timerStage from '../packages/dsh-tavern-stage/lib/mods/timer/stage.js'
import phoneStage from '../mods/phone/stage.js'
import danmakuStage from '../mods/danmaku/stage.js'
const sources = Object.freeze([
  {id:'dsh.dice',directory:new URL('../mods/dice/',import.meta.url),module:dice},
  {id:'dsh.timer',directory:new URL('../mods/timer/',import.meta.url),module:timer,stage:timerStage},
  {id:'dsh.danmaku',directory:new URL('../mods/danmaku/',import.meta.url),module:danmaku,assetPackId:'829254f8-e721-4c06-ae27-73d91c495f7c',stage:danmakuStage},
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
  const releases=[],assetPacks=[]
  for (const source of sources) {
    const manifest=JSON.parse(await readFile(new URL('manifest.json',source.directory),'utf8'))
    const files=new Map(await Promise.all(manifest.files.map(async entry=>[entry.path,await readFile(new URL(entry.path,source.directory))])))
    releases.push({manifest,files,module:source.module})
    if(source.assetPackId) {
      const assets=manifest.builtinAssets.filter(row=>row.type==='bundle').map(row=>JSON.parse(files.get(row.path).toString('utf8')))
      for(const asset of assets)validateAudienceContent(asset.content)
      assetPacks.push({packId:source.assetPackId,modId:source.id,name:manifest.name,assets})
    }
  }
  const entries=new Map(releases.map(row=>[row.manifest.id,row]))
  // This is a resource catalogue; executable code belongs only to the managed host.
  const resources={manifest:id=>entries.get(id).manifest,module:id=>host.execution(id),file:(id,name)=>entries.get(id).files.get(name),files:id=>new Map(entries.get(id).files)}
  return Object.freeze({...resources,
    assetPacks:()=>structuredClone(assetPacks),
    presentation:id=>id==='dsh.danmaku'?{empty:emptyPresentation,append:appendPresentation,read:readPresentation,
      settings:(view,values)=>({...view,view:values.view ?? view.view,settings:{...view.settings,...values}}),
      failure:(context,payload,error)=>projectView({context,anchor:payload.anchor,active:payload.active,activeTimeMs:payload.activeTimeMs,
        silent:!payload.host.entries.length,settings:payload.host.settings,model:payload.host.models.audience,corpus:payload.host.entries.some(entry=>entry.extensions?.[CORPUS_EXTENSION]),error})}:null,
    catalogue:() => sources.map(source=>({id:source.id,name:resources.manifest(source.id).name,version:resources.manifest(source.id).version})),
    source(id) {const source=sources.find(row=>row.id===id);if(!source)throw Object.assign(new Error('Unknown first-party release'),{code:'MOD_RESOURCE_UNAVAILABLE'});return {kind:'directory',path:fileURLToPath(source.directory)}},
  })
}
