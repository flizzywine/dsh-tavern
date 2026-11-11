import test from 'node:test'
import assert from 'node:assert/strict'
import {createModRuntime} from '../tavern-plugin/lib/domain/mods/runtime.js'
import {modSettingValue,validateModSettingsSchema} from '../tavern-plugin/lib/domain/mods/settings.js'

test('a failing mod callback names the mod and the step; optional lifecycle hooks may be absent',async()=>{
  const seen=[]
  const runtime=createModRuntime({current:()=>true,createHost:()=>({}),onError:row=>seen.push(row),
    builtins:{module:()=>({command(){throw new Error('bad input')}})}})
  const failed=await runtime.invoke({modId:'example.mod'},'command',{})
  assert.equal(failed.ok,false)
  assert.equal(failed.error.code,'MOD_RUNTIME_FAILED')
  assert.equal(failed.error.modId,'example.mod')
  assert.equal(failed.error.operation,'command')
  assert.equal(failed.error.message,'example.mod command: bad input')
  assert.deepEqual(seen.map(row=>[row.modId,row.operation,row.message]),[['example.mod','command','bad input']])
  assert.deepEqual(await runtime.invoke({modId:'example.mod'},'settled',{}),{ok:true,value:null})
})

test('asset-ref fields hold one main-library background, and object children may be optional',async()=>{
  const field={key:'scene',type:'asset-ref',label:'Scene',default:null,target:{kinds:['backgrounds']}}
  const record={key:'row',type:'object',label:'Row',default:{},fields:[{...field,optional:true}]}
  assert.doesNotThrow(()=>validateModSettingsSchema({fields:[record]},'$.settingsSchema',false,'example.mod'))
  assert.throws(()=>validateModSettingsSchema({fields:[{...field,target:{kinds:['sfx']}}]},'$.settingsSchema',false,'example.mod'))
  const ref={packId:'35f08180-af5f-43c6-b09c-635567e5c4c4',kind:'backgrounds',assetId:'classroom'}
  assert.equal(modSettingValue(field,ref,'example.mod'),true)
  assert.equal(modSettingValue(field,{...ref,kind:'sfx'},'example.mod'),false)
  assert.equal(modSettingValue(record,{},'example.mod'),true)
  assert.equal(modSettingValue(record,{scene:ref},'example.mod'),true)
})