import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionResourceAccess } from '../tavern-plugin/lib/domain/session-resource-access.js'
import { helperHostHarness } from './fixtures/helper-host-harness.mjs'

test('capabilities read only their issued revision, deduplicate reads and reject tampering before storage', async () => {
  const calls = []
  const resources = createSessionResourceAccess({ read: async scope => { calls.push(scope); return { name: 'saved' } } })
  const access = resources.issue('chat', 7, 'card')
  assert.equal(calls.length, 0)
  const results = await Promise.all([resources.read(access.token), resources.read(access.token)])
  assert.equal(results[0], results[1])
  await resources.read(access.token)
  assert.deepEqual(calls, [{ chatId: 'chat', revision: 7, kind: 'card' }])
  const parts = access.token.split('.')
  parts[0] = Buffer.from(JSON.stringify({ chatId: 'other', revision: 8, kind: 'card' })).toString('base64url')
  await assert.rejects(resources.read(parts.join('.')), /capability/)
  await assert.rejects(createSessionResourceAccess({read: async () => assert.fail()}).read(access.token), /capability/)
  assert.equal(calls.length, 1)
})

test('worldbook names need no download; concurrent explicit reads share a download and return isolated entries', async () => {
  let calls = 0
  const run = helperHostHarness({worldbook:{name:'书',resourceAccess:{token:'book',kind:'worldbook',revision:2}}}, {
    fetch: async () => { calls++; return {ok:true,json:async () => ({kind:'worldbook',revision:2,value:{name:'书',entries:[{uid:1,content:'saved'}]}})} }
  })
  assert.equal(run.window.getCharWorldbookNames().primary, '书')
  assert.equal(calls, 0)
  const [a, b] = await Promise.all([run.window.getWorldbook('current'), run.window.getWorldbook('书')])
  a[0].content = 'modified'
  assert.equal(b[0].content, 'saved')
  assert.equal((await run.window.getWorldbook('书'))[0].content, 'saved')
  assert.equal(calls, 1)
})
