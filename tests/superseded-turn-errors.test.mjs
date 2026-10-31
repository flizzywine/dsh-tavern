import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from './fixtures/client-vm.mjs'
import * as surface from '../tavern-plugin/lib/domain/rollback-surface.js'

function fixture() {
  const message = (seq, turn, text, extra = {}) => ({ seq, type: 'assistant/message', data: { turn, message: { source: { kind: 'model' }, content: text ? [{ type: 'text', text }] : [] } }, ...extra })
  return [
    { seq: 1, type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } } },
    message(10, 6, 'original'),
    { seq: 20, type: 'turn/end', data: { turn: 7, reason: { kind: 'error' } } },
    message(30, 8, 'regenerated'),
    { seq: 31, type: 'turn/end', data: { turn: 8, reason: { kind: 'completed' } } },
    message(32, 6, '', { surfaceOp: { op: 'replace', start: 10, end: 30 }, sourceEventSeqs: [10, 30] }),
    { seq: 40, type: 'turn/end', data: { turn: 9, reason: { kind: 'error' } } }
  ]
}

test('连续重生成从持久替换记录恢复，不受后续事件增长影响', () => {
  const events = fixture()
  const body = { seq: 50, type: 'assistant/message', data: { turn: 10, message: { source: { kind: 'model' }, content: [{ type: 'text', text: 'next' }] } } }
  events.push(body, { seq: 51, type: 'turn/end', data: { turn: 10, reason: { kind: 'completed' } } }, {
    seq: 52, type: 'assistant/message', data: { turn: 6, message: { source: { kind: 'model' }, content: [] } }, surfaceOp: { op: 'replace', start: 32, end: 50 }
  })
  assert.deepEqual(surface.supersededRegenerationErrorTurns({ events, suppressedDshTurns: [8, 10] }), [7, 9])
})

let descriptor
vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console })
const client = descriptor.factory(() => ({}))
