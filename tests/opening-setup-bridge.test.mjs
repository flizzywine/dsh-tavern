import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

async function frame(preview) {
  const source = await readFile(new URL('../tavern-plugin/src/client/opening-preview.js', import.meta.url), 'utf8')
  const sent = [], listeners = [], stat = { stat_data: { 剧情: { 阶段: ['同居初期', '五个阶段之一'] } } }
  const parent = { postMessage: message => sent.push(JSON.parse(JSON.stringify(message))) }
  const context = vm.createContext({ parent, console, setTimeout, clearTimeout,
    addEventListener: (type, listener) => { if (type === 'message') listeners.push(listener) } })
  context.window = context
  context.waitGlobalInitialized = async () => {}
  context.updateVariablesWith = async (update) => { update(stat) }
  vm.runInContext(source, context)
  context.installOpeningPreviewBridge('token', { runtime: { scripts: [{ system: 'official-mvu' }] }, swipes: ['Opening'], selectedIndex: 0, openingIds: ['primary'], worldbook: null, ...preview })
  const dispatch = event => { for (const listener of [...listeners]) listener(event) }
  const reply = (request, result) => dispatch({ source: parent, data: { type: 'dsh-tavern-helper-response', token: 'token', requestId: request.requestId, ok: true, result } })
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  return { sent, parent, dispatch, reply, settle, stat }
}

test('only the parent can start a v2 opening; one start resolves values, writes MVU and sends one slash', async () => {
  const f = await frame()
  f.dispatch({ source: {}, data: { type: 'dsh-tavern-opening-setup-start', values: { name: '外人' } } })
  await f.settle()
  assert.equal(f.sent.length, 0, 'a message from another window is ignored')

  f.dispatch({ source: f.parent, data: { type: 'dsh-tavern-opening-setup-start', values: { name: '小林', stage: '星光杯' } } })
  await f.settle()
  const resolve = f.sent.at(-1)
  assert.equal(resolve.method, 'resolveOpeningSetup')
  assert.deepEqual(resolve.args, { values: { name: '小林', stage: '星光杯' } })
  f.reply(resolve, { playerName: '小林', variables: { '剧情.阶段': '星光杯' }, message: '开局 | 星光杯', scriptStart: { chunk: 2 } })
  await f.settle(); await f.settle()
  const slashes = f.sent.filter(message => message.method === 'triggerTavernSlash')
  assert.equal(slashes.length, 1)
  assert.deepEqual(slashes[0].args, { line: '/send 开局 \\| 星光杯|/trigger', playerName: '小林', scriptStart: { chunk: 2 } })
  assert.deepEqual(f.stat.stat_data.剧情.阶段, ['星光杯', '五个阶段之一'], 'MVU keeps the description')
  f.reply(slashes[0], {})
  await f.settle(); await f.settle()
  assert.deepEqual(f.sent.at(-1), { type: 'dsh-tavern-opening-setup-result', ok: true })
})

test('a rejected submission reports one readable error back to the parent', async () => {
  const f = await frame()
  f.dispatch({ source: f.parent, data: { type: 'dsh-tavern-opening-setup-start', values: {} } })
  await f.settle()
  const resolve = f.sent.at(-1)
  f.dispatch({ source: f.parent, data: { type: 'dsh-tavern-helper-response', token: 'token', requestId: resolve.requestId, ok: false, error: '开局设置：「你的称呼」还没填' } })
  await f.settle(); await f.settle()
  assert.deepEqual(f.sent.at(-1), { type: 'dsh-tavern-opening-setup-result', ok: false, error: '开局设置：「你的称呼」还没填' })
  assert.equal(f.sent.some(message => message.method === 'triggerTavernSlash'), false)
})
