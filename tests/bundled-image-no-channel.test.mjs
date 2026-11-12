import test from 'node:test'
import assert from 'node:assert/strict'
import { imagePluginFixture } from './fixtures/image-plugin-runtime.mjs'

// A fresh install has 配图 on but no image channel and no workflow. A settled turn must not plan pictures (a paid model
// call) that can only fail; the player sees no failed picture. A manual 配图 request still says what is missing.
function tavernWithTurns() {
  const settled = [], attached = []
  return {
    settled, attached,
    tavern: {
      apiVersion: 5,
      attach: async item => { attached.push(item); return { id: 'm' + attached.length } },
      update: async () => ({}), remove: async () => ({}), list: async () => [],
      getTurn: async () => ({ text: '雨夜，她望向窗外。', textVersion: 'v1', card: { id: 'card-1', name: '测试卡' } }),
      promptSection: () => () => {},
      onTurnSettled: listener => { settled.push(listener); return () => {} },
    },
  }
}
const IMAGE = '<decision>draw</decision><reason>窗边</reason><image><regex>雨夜，她望向窗外。</regex><title_styled>窗边</title_styled><prompts>a girl by a rainy window</prompts></image>'
const noChannel = { imageBackend: 'comfyui', activeImageChannel: '', imageChannels: [], plannerEnabled: true, imageEnabled: true }
const until = async check => { for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 20)) }

test('without a usable image channel or workflow a settled turn plans no picture and attaches no failed one; it says so once', async t => {
  const calls = [], turn = tavernWithTurns()
  const fixture = await imagePluginFixture(t, { config: noChannel, tavern: turn.tavern,
    llm: { stream: args => { calls.push(args); return (async function* () { yield { type: 'text-delta', text: IMAGE } })() } } })
  await fixture.start()
  await until(() => turn.settled.length)
  for (const listener of turn.settled) { listener({ gameId: 'g', turn: 2, textVersion: 'v1', text: '雨夜，她望向窗外。' }); listener({ gameId: 'g', turn: 3, textVersion: 'v1', text: '雨夜，她望向窗外。' }) }
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(calls.length, 0, 'no planning call')
  assert.equal(turn.attached.length, 0, 'no picture placeholder, so no 生成失败')
  assert.equal(fixture.logs.filter(line => line.includes('还没有可用的生图渠道')).length, 1, 'said once')
})

test('a manual 配图 request without a channel still reports what is missing', async t => {
  const turn = tavernWithTurns()
  const fixture = await imagePluginFixture(t, { config: noChannel, tavern: turn.tavern,
    llm: { stream: () => (async function* () { yield { type: 'text-delta', text: IMAGE } })() } })
  const runtime = await fixture.start()
  const reply = await runtime.request('draw-turn', { gameId: 'g', turn: 2 })
  await until(() => turn.attached.length)
  assert.match(JSON.stringify(reply.body) + JSON.stringify(turn.attached), /没有可用的 ComfyUI 工作流|生图渠道|工作流/)
})

test('control: with a channel the same settled turn is planned', async t => {
  const calls = [], turn = tavernWithTurns()
  const fixture = await imagePluginFixture(t, { tavern: turn.tavern,
    llm: { stream: args => { calls.push(args); return (async function* () { yield { type: 'text-delta', text: IMAGE } })() } } })
  await fixture.start()
  await until(() => turn.settled.length)
  for (const listener of turn.settled) listener({ gameId: 'g', turn: 2, textVersion: 'v1', text: '雨夜，她望向窗外。' })
  await until(() => calls.length)
  assert.ok(calls.length > 0)
})