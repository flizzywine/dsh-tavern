import test from 'node:test'
import assert from 'node:assert/strict'
import { createHelperChatDataHost } from './fixtures/helper-chat-data-host.mjs'

async function fixture(t) {
  const host = await createHelperChatDataHost()
  t.after(host.cleanup)
  const invoke = host.invoke
  host.invoke = (method, args) => method === 'updateTavernHelperVariables'
    ? host.adapter.updateVariables(args.sessionId, args.option, args.variables, args.expectedLifecycleRevision, args.eventId, args.contextBaseline)
    : invoke(method, args)
  return host
}

test('local variables share Helper state, save bursts, survive reopening and isolate chats', async t => {
  const host = await fixture(t), run = await host.connect(), local = run.api.variables.local
  assert.equal(local.get('missing'), '')
  assert.equal(local.has('missing'), false)
  assert.equal(local.set('score', '2'), '2')
  assert.equal(local.get('score'), 2)
  assert.equal(local.inc('score'), 3)
  assert.equal(local.dec('score'), 2)
  local.set('other', 'kept')
  assert.equal(run.window.getVariables({ type: 'chat' }).score, 2)
  await run.api.saveMetadata()
  assert.equal((await host.connect()).api.variables.local.get('score'), 2)
  assert.equal((await host.connect('other')).api.variables.local.has('score'), false)
  await run.window.insertOrAssignVariables({ helper: 'visible' }, { type: 'chat' })
  assert.equal(local.get('helper'), 'visible')
  local.del('score')
  await run.api.saveChat()
  const saved = await host.open().read('audit')
  assert.equal(Object.hasOwn(saved.variables, 'score'), false)
  assert.equal(saved.variables.other, 'kept')
  assert.equal(saved.variables.helper, 'visible')
})
