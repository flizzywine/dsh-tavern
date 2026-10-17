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
  const stale = slow.accept(slowResult)
  assert.deepEqual(json(stale.view), fastView)
  assert.equal(stale.viewCursor, fastResult.viewCursor)
  assert.equal(stale.viewDelta, undefined)
  assert.equal(stale.viewBase, undefined)
  assert.equal(begin('one').cursor, fastResult.viewCursor)
})

for (const full of [false, true]) test(`superseded ${full ? 'full' : 'delta'} response returns newest null snapshot with coherent metadata`, () => {
  const begin = context.reader()
  begin('A').accept({ ok: true, viewCursor: 'base', view: { value: 1 } })
  const old = begin('A'), next = begin('A')
  next.accept({ ok: true, runtimeGeneration: 'new', viewCursor: 'null', view: null })
  const value = old.accept(full ? { ok: true, runtimeGeneration: 'old', viewCursor: 'old', view: { value: 0 } } :
    { ok: true, runtimeGeneration: 'old', viewCursor: 'old', viewDelta: { baseCursor: 'base', set: [[['value'], 0]], remove: [] } })
  assert.deepEqual(json(value), { ok: true, runtimeGeneration: 'new', viewCursor: 'null', view: null })
})

test('release is idempotent and explicitly released reads cannot mutate the cursor', () => {
  const begin = context.reader(), old = begin('A')
  old.release(); old.release()
  assert.throws(() => old.accept({ viewCursor: 'retired', view: { old: true } }), /取消/)
  const fresh = begin('A'); assert.equal(fresh.cursor, undefined); fresh.release()
})

test('error recovery exposes only a strictly newer accepted result, with session isolation', () => {
  const begin = context.reader()
  begin('A').accept({ ok: true, viewCursor: 'a1', view: { value: 1 } })
  const old = begin('A'), latest = begin('A')
  assert.equal(old.current(), null)
  begin('B').accept({ ok: true, viewCursor: 'b1', view: { value: 'B' } })
  assert.equal(old.current(), null)
  latest.accept({ ok: true, viewCursor: 'a2', view: { value: 2 } })
  assert.equal(old.current().view.value, 2)
  old.release()
  const failed = begin('A'); assert.equal(failed.current(), null); failed.release()
})
