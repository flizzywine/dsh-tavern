import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createSessionViewSync } from '../tavern-plugin/lib/domain/session-view-sync.js'
const context = vm.createContext({})
vm.runInContext(fs.readFileSync(new URL('../tavern-plugin/lib/domain/indexed-array.js', import.meta.url), 'utf8').replace(/^export .*$/gm,'') + '\n' + fs.readFileSync(new URL('../tavern-plugin/src/client/modules/session-view-sync.js', import.meta.url), 'utf8') + '\nthis.reader = createSessionViewReader', context)
const json = value => JSON.parse(JSON.stringify(value))
const sample = () => ({ activity: { busy: false }, replyProjections: [{ turn: 1, text: 'old' }], inputSources: { a: 'input' }, inputTemplateDisplays: {}, tavernHelper: { messages: [{ mes: 'old', variables: { hp: 1 } }], variables: { hp: 1 } } })

test('wire delta reconstructs append, edits, rollback, deletions and helper lifecycle', () => {
  const server = createSessionViewSync(), begin = context.reader()
  let view = sample()
  const apply = () => {
    const request = begin('one')
    const result = server('one', view, request.cursor)
    assert.deepEqual(json(request.accept(json(result)).view), json(view))
    return result
  }
  assert.ok(apply().view)
  assert.equal(apply().viewDelta.set.length, 0)
  view.replyProjections.push({ turn: 2, text: 'new' })
  view.tavernHelper.messages.push({ mes: 'new' })
  view.inputSources.b = 'second'
  view.activity.busy = true
  apply()
  view.replyProjections[0].text = 'edit'
  view.tavernHelper.messages[0].variables.hp = 2
  view.tavernHelper.variables.hp = 2
  delete view.inputSources.a
  apply()
  view.replyProjections.length = 0
  view.tavernHelper = null
  apply()
  view.replyProjections = null
  apply()
  view.replyProjections = []
  view.tavernHelper = sample().tavernHelper
  apply()
  delete view.tavernHelper
  apply()
  view = null
  apply()
  view = sample()
  assert.ok(apply().view)
})

test('concurrent responses use their own base and do not overwrite a newer cursor', () => {
  const server = createSessionViewSync(), begin = context.reader()
  const first = begin('one')
  first.accept(json(server('one', sample(), first.cursor)))
  const slow = begin('one'), fast = begin('one')
  const slowView = { ...sample(), activity: { busy: true } }
  const slowResult = json(server('one', slowView, slow.cursor))
  const fastView = { ...sample(), activity: { busy: false, finished: true } }
  const fastResult = json(server('one', fastView, fast.cursor))
  assert.deepEqual(json(fast.accept(fastResult).view), fastView)
  assert.deepEqual(json(slow.accept(slowResult).view), slowView)
  assert.equal(begin('one').cursor, fastResult.viewCursor)
})

test('eviction, restart and cross-session cursors fall back to full responses', () => {
  const server = createSessionViewSync({ maxReaders: 1 })
  const first = server('one', sample())
  assert.ok(server('two', sample(), first.viewCursor).view)
  assert.ok(server('one', sample(), first.viewCursor).view)
  assert.ok(createSessionViewSync()('one', sample(), first.viewCursor).view)
})

test('large unchanged history stays off the wire; changed message sends only that row', () => {
  const server = createSessionViewSync()
  const view = sample()
  view.replyProjections = Array.from({ length: 1800 }, (_, turn) => ({ turn, text: '正文'.repeat(1000) }))
  view.tavernHelper.messages = view.replyProjections.map(row => ({ mes: row.text }))
  const full = server('one', view)
  const unchanged = server('one', view, full.viewCursor)
  assert.ok(JSON.stringify(unchanged).length < 300)
  view.tavernHelper.messages[1799].mes = 'changed'
  const changed = server('one', view, unchanged.viewCursor)
  assert.equal(changed.viewDelta.set.length, 1)
  assert.ok(JSON.stringify(changed).length < 400)
})

test('dirty message indices reuse hashes without re-serializing untouched history', () => {
  const server = createSessionViewSync()
  const view = sample()
  view.tavernHelper.messages = Array.from({ length: 400 }, (_, index) => ({ mes: '楼层'.repeat(200), index }))
  const full = server('one', view, undefined, { revision: 1 })
  assert.ok(full.view)
  const peek = server.peek(full.viewCursor)
  assert.equal(peek.revision, 1)
  const untouched = server('one', view, full.viewCursor, { revision: 1, dirtyMessageIndices: new Set() })
  assert.ok(untouched.viewDelta)
  assert.equal(untouched.viewDelta.set.length, 0)
  assert.ok(JSON.stringify(untouched).length < 300)
  view.tavernHelper.messages[399].mes = 'changed'
  const changed = server('one', view, untouched.viewCursor, { revision: 2, dirtyMessageIndices: new Set([399]) })
  assert.equal(changed.viewDelta.set.length, 1)
  assert.deepEqual(changed.viewDelta.set[0][0], ['tavernHelper', 'messages', 399])
  assert.equal(server.peek(changed.viewCursor).revision, 2)
})
