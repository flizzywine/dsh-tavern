import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageConfigFields}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/config-fields.cjs')
test('mod setting sections preserve defaults, dependencies and grouped field order',()=>{
  const fields=createStageConfigFields({React:{}}),writes=[]
  const manifest={settingsSchema:{fields:[{key:'enabled',type:'toggle',default:false},{key:'size',type:'slider',default:5,dependsOn:{key:'enabled',equals:true}}],sections:[{id:'a',groups:[{id:'b',fields:['size','enabled']}]}]}}
  assert.deepEqual(fields.sections(manifest,{},()=>{})[0].items.map(x=>x.key),['enabled'])
  const rows=fields.sections(manifest,{enabled:true,size:8},patch=>writes.push(patch))
  assert.equal(rows[0].id,'a.b')
  assert.deepEqual(rows[0].items.map(x=>x.value),[8,true])
  rows[0].items[0].onChange(9)
  assert.deepEqual(writes,[{size:9}])
  fields.dispose();rows[0].items[0].onChange(10)
  assert.equal(writes.length,1)
  assert.equal(fields.itemKind({type:'segmented',choices:Array(7).fill({})}),'select')
})
test('setting controls preserve skin classification and ignore callbacks after disposal',()=>{
  const fields=createStageConfigFields({React:{createElement:(type,props,...children)=>({type,props,children})}})
  let changed=0
  const button=fields.Switch({checked:false,onChange:value=>{assert.equal(value,true);changed++}})
  button.props.onClick()
  const row=fields.row('label',{type:fields.Switch,props:{}})
  assert.equal(row.props['data-fk-control'],'toggle')
  fields.dispose();button.props.onClick()
  assert.equal(changed,1)
})
