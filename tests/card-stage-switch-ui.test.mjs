import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import protocol from '../tavern-plugin/packages/dsh-presentation-protocol/src/card-stage-mode.cjs'

test('card settings writes one stage field, preserves styling and routes sound preferences globally',async()=>{
 const source=await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/asset-pack-card-ui.js',import.meta.url),'utf8')
 const section=source.slice(source.indexOf('const CARD_SWITCHES='),source.indexOf('function stageEnable('))
 const sandbox={cardStageMode:protocol.cardStageMode};vm.createContext(sandbox);vm.runInContext(section,sandbox)
 let extension={stage:{dialogue:true,stage:true,defaultSkin:'classic'}},global
 const writer={write:async update=>{extension={...extension,...update(extension)}},global:async patch=>{global=patch}}
 await sandbox.stageWrite(writer,{enabled:false,music:false})
 assert.deepEqual(JSON.parse(JSON.stringify(extension.stage)),{enabled:false,defaultSkin:'classic'})
 assert.deepEqual(JSON.parse(JSON.stringify(global)),{music:false})
 assert.equal(sandbox.stagePrefs(extension).dialogue,false)
 await sandbox.stageWrite(writer,{enabled:true})
 assert.equal(sandbox.stagePrefs(extension).dialogue,true);assert.equal(sandbox.stagePrefs(extension).stage,true)
})
