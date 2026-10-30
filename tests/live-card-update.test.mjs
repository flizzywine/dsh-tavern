import test from 'node:test'
import assert from 'node:assert/strict'
import {createLiveCardUpdate} from '../tavern-plugin/lib/domain/live-card-update.js'
import {generateSchema} from '../tavern-plugin/lib/domain/mvu-schema.generated.js'

const card = state => ({name:'测试',first_mes:`<initvar>${JSON.stringify(state)}</initvar>`,extensions:{}})
const snapshot = state => ({stat_data:structuredClone(state),schema:generateSchema(structuredClone(state)),initialized_lorebooks:{test:true}})
function chat(definition, state) {
  const variables = snapshot(state)
  return {id:'test',mvu:{enabled:true},cardDefinitionSnapshot:definition,
    messages:[{greeting:true,swipeId:0,variables:[variables]}],
    timeline:[{variables:structuredClone(variables)}],rollbackUndo:{variables:structuredClone(variables)}}
}

test('card update aligns current and rollback states while preserving earned values and dynamic data', async () => {
  const runtime = createLiveCardUpdate()
  try {
    const old = {角色:{体力:100,旧字段:0},记录:[], 'a/b':{'~old':0}}
    const next = {角色:{体力:20,金币:5},记录:[], 'a/b':{新增:1}}
    const original = chat(card(old),{角色:{体力:73,旧字段:9,动态:42},记录:['已完成'], 'a/b':{'~old':8}})
    const before = structuredClone(original)
    const updated = await runtime.prepare(original,card(next),original)
    for (const value of [updated.messages[0].variables[0],updated.timeline[0].variables,updated.rollbackUndo.variables]) {
      assert.deepEqual(value.stat_data,{角色:{体力:73,金币:5,动态:42},记录:['已完成'],'a/b':{新增:1}})
      assert.equal(value.schema.properties.角色.properties.旧字段,undefined)
      assert.equal(value.schema.properties.角色.properties.金币.type,'number')
      assert.deepEqual(value.initialized_lorebooks,{test:true})
      assert.deepEqual(value.display_data,value.stat_data)
      assert.deepEqual(value.delta_data,{})
    }
    assert.deepEqual(original,before)
    updated.cardDefinitionSnapshot=card(next)
    assert.deepEqual(await runtime.prepare(updated,card(next),updated),updated)
  } finally {runtime.dispose()}
})

test('explicit moves still preserve values before automatic additions and removals',async()=>{
  const runtime=createLiveCardUpdate()
  try {
    const original=chat(card({旧:0,删除:0}),{旧:75,删除:8})
    const next=card({新:0})
    next.extensions={dsh_tavern:{stateMigrations:[{id:'rename',operations:[{op:'move',from:'/旧',path:'/新'}]}]}}
    const updated=await runtime.prepare(original,next,original)
    assert.deepEqual(updated.messages[0].variables[0].stat_data,{新:75})
  }finally{runtime.dispose()}
})

test('stage projections request history only for active templated status rules after a card update', () => {
  const runtime = createLiveCardUpdate()
  const rule = { findRegex: '<StatusPlaceHolderImpl/>', replaceString: '<%= value %>' }
  try {
    assert.equal(runtime.needsHistory({}, { regexScripts: [rule] }), false)
    assert.equal(runtime.needsHistory({ cardContextRevision: 1 }, {}), false)
    assert.equal(runtime.needsHistory({ cardContextRevision: 1 }, { regexScripts: [rule] }), true)
    for (const patch of [{ enabled: false }, { disabled: true }, { replaceString: 'plain' }, { findRegex: 'ordinary' }]) {
      assert.equal(runtime.needsHistory({ cardContextRevision: 1 }, { regexScripts: [{ ...rule, ...patch }] }), false)
    }
  } finally { runtime.dispose() }
})
