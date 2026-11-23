import test from 'node:test'
import assert from 'node:assert/strict'
import {createLiveCardUpdate} from '../tavern-plugin/lib/domain/live-card-update.js'
import {generateSchema} from '../tavern-plugin/lib/domain/mvu-schema.generated.js'
import {captureStageTarget} from '../tavern-plugin/lib/domain/stage-incremental.js'
import {assetPackDigest} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-asset-pack-catalogue.js'
import {createStageDirector} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-director.js'

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

// A round the stage directed, bound to its prefix (which holds the greeting) and chained to the previous record.
function directed(game, index, previous) {
  const target = {...captureStageTarget(game, index), predecessorDigest: previous?.digest || null}
  const binding = {cardRevision: 'r', target}
  const record = {format: 'asset-packs-v1', binding, baseline: {scene: 'meeting-room'}, entries: [{at: 1, ops: []}], end: {}}
  record.digest = assetPackDigest({binding, baseline: record.baseline, entries: record.entries, end: record.end})
  game.messages[index].stageDirectionAssetPacks = record
  return record
}

test('a card update that refreshes the opening <initvar> keeps every directed round on the stage', async t => {
  const greeting = state => `入职办公室没有窗。<initvar>${JSON.stringify(state)}</initvar>`
  const game = {id: 'chat-a', sessionId: 'session-a', cardPath: 'cards/a.json', timeline: {branchId: 'branch-1', revision: 4}, messages: [
    {role: 'assistant', greeting: true, turn: 1, swipeId: 0, text: greeting({嘉奖: 0}), sourceText: greeting({嘉奖: 0}), swipes: [greeting({嘉奖: 0})]},
    {role: 'user', turn: 2, text: '我叫林晓'},
    {role: 'assistant', turn: 2, text: '主管推了推眼镜。'},
    {role: 'user', turn: 3, text: '结算吧'},
    {role: 'assistant', turn: 3, text: '总经理转身坐了回来。'}
  ]}
  directed(game, 4, directed(game, 2, null))
  const runtime = createLiveCardUpdate(), director = createStageDirector({assets: {hasBindings: async () => true, subscribe: () => () => {}}})
  t.after(() => { runtime.dispose(); director.dispose() })
  const updated = await runtime.prepare(game, card({嘉奖: 0, 申领目录: {}}), game)
  assert.match(updated.messages[0].sourceText, /申领目录/, 'the opening carries the new initial state')
  assert.notEqual(captureStageTarget(updated, 2).prefixDigest, captureStageTarget(game, 2).prefixDigest)
  for (const turn of [2, 3]) {
    const direction = await director.get(updated, turn, null, {readOnly: true, generate: false})
    assert.equal(direction.status, 'done', 'round ' + turn + ' keeps its scene')
    assert.deepEqual(direction.record.baseline, {scene: 'meeting-room'})
  }
  assert.equal(game.messages[2].stageDirectionAssetPacks.binding.target.sourceKey, captureStageTarget(game, 2).sourceKey, 'the game before the update is not changed')
})
