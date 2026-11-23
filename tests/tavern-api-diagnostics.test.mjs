
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTavernApiDiagnostics } from '../tavern-plugin/lib/domain/tavern-api-diagnostics.js'
function harness() {
  const values = new Map()
  return createTavernApiDiagnostics({ async updateJson(key, update) { values.set(key, update(values.get(key))) }, async readJson(key) { return values.get(key) } })
}

test('宿主调用日志区分成功、拒绝与异常，并且不保存参数内容', async () => {
  const d = harness()
  const args = { sessionId: 'session', variables: { text: 'PRIVATE-STORY', apiKey: 'PRIVATE-KEY' }, apiCallOrigin: { scriptId: 'card-script', eventId: 'settlement-1', requestId: '3' } }
  const result = { updated: true, privateResult: 'PRIVATE-REPLY' }
  assert.equal(await d.observe('updateTavernHelperVariables', args, () => result), result)
  await d.observe('updateTavernHelperVariables', args, () => ({ stale: true }))
  const failure = Object.assign(new Error('PRIVATE-STORY Authorization: Bearer sk-12345678901234567890'), { code: 'TEST_ERROR' })
  await assert.rejects(d.observe('updateTavernHelperVariables', args, () => { throw failure }), error => error === failure)
  const data = await d.read('session')
  assert.deepEqual(data.records.map(r => r.status), ['success', 'rejected', 'failed'])
  assert.equal(data.records[0].scriptId, 'card-script')
  assert.equal(data.records[0].eventId, 'settlement-1')
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE-|sk-12345678901234567890/)
})
