// P0 target examples, not an installed runtime or a second manifest validator.
export function coreModV2(baseline, id = 'fixture.lantern') {
  const value = structuredClone(baseline)
  Object.assign(value, {id, name:'Lantern display', schemaVersion:6, hostApi:'>=2.0.0 <3.0.0'})
  value.commands = value.commands.map(command => ({...command, op:`mod.${id}.${command.id}`, mode:'adds'}))
  return value
}
export const replacementExamples = [
  {id:'title',op:'mod.fixture.lantern.title',mode:'replaces',replaces:'title.play'},
  {id:'time',op:'mod.fixture.lantern.time',mode:'replaces',replaces:'lighting.mood.set'},
]
export const rejectedReplacements = [
  {mode:'adds',replaces:'title.play'},
  {mode:'replaces'},
  {mode:'replaces',replaces:['title.play','item.play']},
  {mode:'replaces',replaces:'mod.fixture.other.title'},
]
export const context = {modId:'fixture.lantern',sessionId:'session-one',branchId:'branch-one',revision:'revision-one',sourceKey:'source-one',generation:1,textVersion:'text-one',authorityEpoch:1,settledTurn:1,mode:'live'}
export const messages = {
  request:{channel:'dsh-mod',version:2,token:'fixture-instance-token',requestId:'request-one',method:'host.source.window',args:{limit:1}},
  reply:{channel:'dsh-mod',version:2,requestId:'request-one',result:{ok:true,value:{context,units:[{text:'Seen'}],inputs:[]}}},
  event:{channel:'dsh-mod',version:2,type:'event',eventId:'event-one',seq:1,event:'text.revealed',context,payload:{text:'Seen'}},
}

// Core kind contract only; authoring/media/UI wiring follows in P2-P5.
export const propEntry = {kind:'props',id:'silver-key',name:'Silver key',enabled:true,recall:{mode:'keyword',keywords:['key']},media:'a'.repeat(64)}
export const admissionExamples = {phone:{entryKinds:[]},textcard:{entryKinds:[]},items:{entryKinds:['props']},performance:{entryKinds:['performances']}}

// Target generic variant container; content validation/media closure stays kind-owned.
export const genericVariantExamples = [
  {kind:'backgrounds',id:'school-road',name:'School road',variants:{default:'day',entries:[{id:'day',name:'Clear morning',content:{media:'a'.repeat(64)}},{id:'dusk',name:'Golden hour',content:{media:'b'.repeat(64)}}]}},
  {kind:'cg',id:'reunion',name:'Reunion',variants:{default:'wide',entries:[{id:'wide',name:'Wide',content:{media:'c'.repeat(64)}},{id:'smile',name:'Smile',content:{media:'d'.repeat(64)}}]}},
  {kind:'props',id:'silver-key',name:'Silver key',variants:{default:'clean',entries:[{id:'clean',name:'Clean',content:{media:'e'.repeat(64)}},{id:'worn',name:'Worn',content:{media:'f'.repeat(64)}}]}},
  {kind:'music',id:'town-theme',name:'Town theme',variants:{default:'full',entries:[{id:'full',name:'Full',content:{media:'1'.repeat(64)}},{id:'piano',name:'Piano',content:{media:'2'.repeat(64)}}]}},
  {kind:'sfx',id:'door-close',name:'Door close',variants:{default:'soft',entries:[{id:'soft',name:'Soft',content:{media:'3'.repeat(64)}},{id:'slam',name:'Slam',content:{media:'4'.repeat(64)}}]}},
]
export const genericVariantCommands = [
  {kind:'backgrounds',select:{op:'scene.set',background:{packId:'11111111-1111-4111-8111-111111111111',kind:'backgrounds',assetId:'school-road'},variant:'dusk'},switch:{op:'scene.variant',variant:'day'}},
  {kind:'cg',select:{op:'cg.show',cg:{packId:'11111111-1111-4111-8111-111111111111',kind:'cg',assetId:'reunion'},variant:'smile'},switch:{op:'cg.variant',variant:'wide'}},
  {kind:'music',select:{op:'music.set',ref:{packId:'11111111-1111-4111-8111-111111111111',kind:'music',assetId:'town-theme'},variant:'piano'},switch:{op:'music.variant',variant:'full'}},
  {kind:'sfx',select:{op:'sfx.play',ref:{packId:'11111111-1111-4111-8111-111111111111',kind:'sfx',assetId:'door-close'},variant:'slam'},switch:{op:'sfx.variant',variant:'soft'}},
]

// Test-only resources (as tavern-plugin/lib/mod-builtins.js) including the demo release; modules are the given imports.
import * as demo from './demo-shipped/runtime.js'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import * as phone from '../../../tavern-plugin/mods/phone/runtime.js'
import * as textcard from '../../../tavern-plugin/mods/textcard/runtime.js'
import {modDeclarations} from '../../../tavern-plugin/lib/domain/mods/declarations.js'
const sources = Object.freeze([
  {id:'dsh.demo',directory:new URL('./demo-shipped/',import.meta.url),module:demo},
  {id:'dsh.phone',directory:new URL('../../../tavern-plugin/mods/phone/',import.meta.url),module:phone},
  {id:'dsh.textcard',directory:new URL('../../../tavern-plugin/mods/textcard/',import.meta.url),module:textcard},
])
// releases: [{manifest, files: Map(path -> bytes), module}].
export function modResources(releases) {
  const entries=new Map(releases.map(row=>[row.manifest.id,{...row,manifest:modDeclarations(row.manifest)}]))
  const entry=id=>{const row=entries.get(id);if(!row)throw Object.assign(new Error('No release'),{code:'MOD_API_UNSUPPORTED'});return row}
  return Object.freeze({manifest:id=>entry(id).manifest,module:id=>entry(id).module,file:(id,path)=>entry(id).files.get(path) ?? null,files:id=>new Map(entry(id).files)})
}
// A mod folder's mod.json and the files it names (commandPrompts, coreAssets).
export async function readModRelease(directory) {
  const manifest=modDeclarations(JSON.parse(await readFile(new URL('mod.json',directory),'utf8')))
  return {manifest,files:new Map(await Promise.all([...manifest.commandPrompts,...manifest.coreAssets].map(async row=>[row.path,await readFile(new URL(row.path,directory))])))}
}

export async function createFirstPartyMods() {
  const registry=modResources(await Promise.all(sources.map(async source=>({...await readModRelease(source.directory),module:source.module}))))
  return Object.freeze({...registry,
    catalogue:() => sources.map(source=>({id:source.id,name:registry.manifest(source.id).name,version:registry.manifest(source.id).version})),
    source(id) {const source=sources.find(row=>row.id===id);if(!source)throw Object.assign(new Error('Unknown first-party release'),{code:'MOD_RESOURCE_UNAVAILABLE'});return {kind:'directory',path:fileURLToPath(source.directory)}},
  })
}