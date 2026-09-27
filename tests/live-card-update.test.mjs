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

test('重新加载同步开场 initvar 元数据，保留正文与当前变量',async()=>{
 const runtime=createLiveCardUpdate()
 try {
  const old=card({金币:0,旧字段:1}),next=card({金币:99,体力:100})
  const original=chat(old,{金币:12,旧字段:1})
  original.messages[0].sourceText='保留原开场\n'+old.first_mes
  original.messages[0].text=original.messages[0].sourceText
  original.messages[0].swipes=[original.messages[0].sourceText]
  original.rollbackUndo.messages=structuredClone(original.messages)
  const updated=await runtime.prepare(original,next,original)
  const text=updated.messages[0].sourceText
  assert.deepEqual(JSON.parse(text.match(/<initvar>([\s\S]*?)<\/initvar>/)[1]),{金币:99,体力:100})
  assert.ok(text.startsWith('保留原开场\n'))
  assert.equal(updated.messages[0].swipes[0],text)
  assert.equal(updated.rollbackUndo.messages[0].sourceText,text)
  assert.deepEqual(updated.messages[0].variables[0].stat_data,{金币:12,体力:100})
  assert.equal(original.messages[0].sourceText,'保留原开场\n'+old.first_mes)
 }finally{runtime.dispose()}
})

test('frame sizing is applied as card configuration while preserving earned variables and story', async () => {
  const runtime = createLiveCardUpdate()
  try {
    const original = chat(card({ gold: 0 }), { gold: 73 })
    original.messages[0].text = 'existing story'
    const next = structuredClone(original.cardDefinitionSnapshot)
    next.extensions.dsh_tavern = { frameSizing: { default: { mode: 'viewport' }, panels: { status: { mode: 'content', maxHeight: 600 } } } }
    const updated = await runtime.prepare(original, next, original)
    assert.equal(updated.messages[0].text, 'existing story')
    assert.equal(updated.messages[0].variables[0].stat_data.gold, 73)
    assert.equal(updated.timeline[0].variables.stat_data.gold, 73)
    assert.equal(updated.rollbackUndo.variables.stat_data.gold, 73)
    assert.deepEqual(original.cardDefinitionSnapshot.extensions, {})
  } finally { runtime.dispose() }
})
