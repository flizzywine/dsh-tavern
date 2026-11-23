import test from 'node:test'
import assert from 'node:assert/strict'
import {modSettingValue,validateModSettingsSchema} from '../tavern-plugin/lib/domain/mods/settings.js'

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
