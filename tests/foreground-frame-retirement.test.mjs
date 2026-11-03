import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'

import { retireForegroundFrames } from '../tavern-plugin/lib/domain/foreground-frame-retirement.js'

import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
function frames() {
  const session = Session.create('frame-entry')
  for (const turn of [1, 2]) session.append('user/message', { id: 'f-' + turn, role: 'user', content: [{ type: 'text', text: 'frame-' + turn }], source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'foreground-frame', trace: { turn } } }, { surfaceOp: 'append' })
  return session
}

// only successful whole-turn compaction may consume old frames.
test('production compaction keeps frames intact until the host summary transaction', async () => {
  const session = frames(), calls = [], before = JSON.stringify(session.deriveMessages())
  const start = source.indexOf('    async compact(id, side, options, signal) {')
  const method = source.slice(start, source.indexOf('\n  })', start))
  const context = {
    // upstream skips compaction when its verbatim retention covers the history.
    storyRetention: async () => ({ rounds: 0 }), storyHistoryFullyRetained: () => false,
    withCompactionSession: async (_id, work) => work({ session, phase: { kind: 'idle' } }),
    configureAgentCompaction: async () => ({ compactNow: async () => {
      assert.equal(JSON.stringify(session.deriveMessages()), before)
      calls.push('summary')
    } })
  }
  const entry = vm.runInNewContext('({' + method + '})', context)
  await entry.compact('front', 'foreground', {}, undefined)
  assert.deepEqual(calls, ['summary'])
  assert.doesNotMatch(source, /retireOldForegroundFrames|retireForegroundFrames/)
})

test('旧存档无 trace 的指引可清理，其他插件内容不受影响', () => {
  const session = Session.create('legacy-frames')
  for (const [id, plugin, form] of [['legacy', 'dsh-tavern', 'foreground-frame'], ['foreign', 'other', 'foreground-frame'], ['snapshot', 'dsh-tavern', 'snapshot']]) {
    session.append('user/message', { id, role: 'user', content: [{ type: 'text', text: id }], source: { kind: 'plugin', plugin, form } }, { surfaceOp: 'append' })
  }
  assert.equal(retireForegroundFrames(session, { keepTurn: 3 }), 1)
  const text = JSON.stringify(session.deriveMessages().map(message => message.content))
  assert.doesNotMatch(text, /legacy/)
  assert.match(text, /foreign/); assert.match(text, /snapshot/)
})
