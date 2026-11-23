// 自动素材 › 自动立绘 / 自动配音: each part on or off, the card layer over the global one, only while 自动素材 is on.
// The global layer's save is in auto-cast-global-settings.test.mjs. Synthetic data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import {effectiveAutoCast,validateCardStage,AUTO_CAST_DEFAULTS} from '../tavern-plugin/lib/domain/card-stage-settings.js'
import {createStageRequests} from '../tavern-plugin/packages/dsh-tavern-stage/lib/requests.js'

const card = stage => ({schemaVersion:1, assetBindings:{boundPackIds:[]}, stage})

test('each part is on or off, the card layer over the global one, and only while 自动素材 is', () => {
  assert.deepEqual(AUTO_CAST_DEFAULTS, {enabled:false, level:'balanced', sprites:true, voices:true})
  const parts = (stage, global, dialogue = true) => {const {sprites, voices} = effectiveAutoCast(card(stage), global, dialogue); return {sprites, voices}}
  assert.deepEqual(parts({}, {enabled:true}), {sprites:true, voices:true}, 'the defaults: both on')
  assert.deepEqual(parts({}, {enabled:true, sprites:false, voices:false}), {sprites:false, voices:false}, 'the global layer')
  assert.deepEqual(parts({autoCast:{sprites:false}}, {enabled:true}), {sprites:false, voices:true}, 'the card layer wins')
  assert.deepEqual(parts({autoCast:{voices:true}}, {enabled:true, voices:false}), {sprites:true, voices:true}, 'a card turns on what the global turned off')
  assert.deepEqual(parts({}, {enabled:false}), {sprites:false, voices:false}, '自动素材 off: every part off')
  assert.deepEqual(parts({switches:{autoCast:'on'}, autoCast:{voices:false}}, {enabled:false}), {sprites:true, voices:false}, 'the card switch on')
  assert.deepEqual(parts({}, {enabled:true}, false), {sprites:false, voices:false}, 'no bubbles')
})

test('the card layer of the parts is validated where the stage is written', () => {
  validateCardStage({autoCast:{level:'balanced', sprites:false, voices:true}})
  assert.throws(() => validateCardStage({autoCast:{sprites:'on'}}))
  assert.throws(() => validateCardStage({autoCast:{music:true}}), 'no other parts')
})

test('the 自动素材 status names the latest problem; the host adds whether each service is set up', async () => {
  const autoCastSettings = {read:() => ({values:{...AUTO_CAST_DEFAULTS}, revision:'r1', writable:true}), save:() => null}
  const status = createStageRequests({}, {autoCastSettings, autoCastStatus:async () => ({problem:null, services:{sprites:true, voices:false}})})
  assert.deepEqual(await status.call('getAutoCastStatus', {path:'cards/c.json'}), {problem:null, services:{sprites:true, voices:false}})
})
