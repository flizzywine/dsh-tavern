import test from 'node:test'
import assert from 'node:assert/strict'
import {projectStageLease} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-lease-projection.js'
import {resolution} from '../tavern-plugin/lib/domain/figure-catalogue.js'

const rows = [
  {actorKey:'actor-one', name:'星野', aliases:['Hoshino'], ref:{packId:'11111111-1111-4111-8111-111111111111',figureId:'figure-one'}},
  {actorKey:'actor-two', name:'艾玛', aliases:['Emma'], ref:{packId:'11111111-1111-4111-8111-111111111111',figureId:'figure-two'}},
  {actorKey:'actor-three', name:'同名', aliases:[], ref:{packId:'11111111-1111-4111-8111-111111111111',figureId:'figure-three'}},
  {actorKey:'actor-four', name:'同名', aliases:[], ref:{packId:'11111111-1111-4111-8111-111111111111',figureId:'figure-four'}},
]
function consumer() {
  const calls = []
  return {calls, allowedPackIds:['11111111-1111-4111-8111-111111111111'], presentation:{
    async figureRows() {return rows},
    async resolveName(name) {return resolution.resolveFigureName(rows, name)},
    async character(alias, options) {calls.push({alias,options}); return {alias,form:'sprite',outfitKey:'default'}},
    async materialize(character, options) {assert.equal(options.descriptors,true);return character},
    async scene(state, options) {assert.equal(options.descriptors,true);return {background:state.scene?.background || null}},
  }}
}
for (const [name,alias,emotion] of [['Hoshino','actor-one','生气'],['艾玛','actor-two','平静']]) {
  test('lease projects declared figure independently of story cast: '+name, async () => {
    const own = consumer()
    const result = await projectStageLease({consumer:own,actors:[{name,emotion}]})
    assert.equal(result.characters[0].alias,alias)
    assert.equal(own.calls[0].options.emotion,emotion)
    assert.equal(own.calls[0].options.actor,undefined,'use the figure default, not story actor state')
    assert.equal(own.calls[0].options.historical,undefined)
  })
}
for (const assetId of ['hall','garden']) {
  test('opening background and plugin mapping share projection: '+assetId, async () => {
    const own = consumer(), openingScene = {background:{packId:'11111111-1111-4111-8111-111111111111',kind:'backgrounds',assetId},timeOfDay:'night'}
    assert.deepEqual((await projectStageLease({consumer:own,openingScene})).scene.background,openingScene.background)
    const scene = {...openingScene, timeOfDay:'day'}
    assert.deepEqual((await projectStageLease({consumer:own,scene})).scene.background,scene.background)
    assert.equal((await projectStageLease({consumer:own,openingScene,scene:null})).scene.background,null)
    assert.equal((await projectStageLease({consumer:own,scene:{...scene,background:{...scene.background,packId:'22222222-2222-4222-8222-222222222222'}}})).scene.background,null)
  })
}
