import test from 'node:test'
import assert from 'node:assert/strict'
import {createModConfigHost} from '../tavern-plugin/packages/dsh-tavern-stage/lib/mod-config-host.js'
import {modLibrary} from '../tavern-plugin/lib/mod-library.js'
const manifest=id=>({id,name:id,settingsSchema:{fields:[]}})
function host(manifests) {return createModConfigHost({library:modLibrary, manifests,store:{},listCards:async()=>[],readCard:async()=>null})}

// A mod still installed in the library after its built-in was removed (owner 2026-11-02: 弹幕, 地图) is named by its own
// installed manifest; it once took the whole stage runtime down at start (舞台不可用).
test('installed managed mods are named by their own manifests, not the built-in catalogue',async()=>{
  const gone={id:'test.gone',name:'已移除',config:{schema:{properties:{note:{type:'string',maxLength:8}}},defaults:{note:''}},preferences:{schema:{properties:{}}}}
  const owner=createModConfigHost({library:modLibrary, manifests:[],managedManifests:[gone],store:{},listCards:async()=>[],readCard:async()=>null})
  const {sources:rows}=await owner.sources.list({mods:{'test.gone':{note:'x'}}})
  assert.equal(rows.find(row=>row.id==='mod:test.gone')?.label,'已移除')
})
