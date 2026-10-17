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

test('selected opening supplies additions; incompatible types leave original save unchanged',async()=>{
  const runtime=createLiveCardUpdate()
  try {
    const old=card({地点:'起点',旧:0})
    const original=chat(old,{地点:'途中',旧:2})
    original.messages[0].swipeId=1
    const next={...card({地点:'起点',新增:1}),alternate_greetings:[card({地点:'另一开场',新增:7}).first_mes]}
    const updated=await runtime.prepare(original,next,original)
    assert.deepEqual(updated.messages[0].variables[0].stat_data,{地点:'途中',新增:7})
    const before=structuredClone(original)
    await assert.rejects(runtime.prepare(original,card({地点:{名称:'起点'}}),original),/变量类型已变化/)
    assert.deepEqual(original,before)
  }finally{runtime.dispose()}
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

test('explicit card reload clears ordinary regex display caches without replaying template effects', async () => {
  const runtime=createLiveCardUpdate()
  try {
    const definition=card({hp:10}), original=chat(definition,{hp:7})
    original.messages[0].text='开场正文'
    original.messages[0].tavernPluginData={template_display:{source:'开场正文',swipe:0,html:'旧界面',formattingText:'旧界面'},template_rendered:{hash:'saved',swipe:0},is_ejs_processed:[true]}
    original.messages.push({text:'剧情',tavernPluginData:{template_display:{source:'剧情',swipe:0,html:'历史模板结果'}}})
    const before=structuredClone(original)
    const updated=await runtime.prepare(original,definition,original)
    assert.equal(updated.messages[0].tavernPluginData.template_display,undefined)
    assert.deepEqual(updated.messages[0].tavernPluginData.template_rendered,before.messages[0].tavernPluginData.template_rendered)
    assert.deepEqual(updated.messages[0].tavernPluginData.is_ejs_processed,[true])
    assert.deepEqual(updated.messages[0].variables,before.messages[0].variables)
    assert.deepEqual(updated.messages[1],before.messages[1])
    assert.equal(updated.messages[0].text,'开场正文')
    assert.deepEqual(original,before)
  } finally {runtime.dispose()}
})
