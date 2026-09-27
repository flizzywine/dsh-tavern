import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createOrderedNumericIndex } from '../tavern-plugin/lib/domain/ordered-numeric-index.js'
const source = await readFile(new URL('../tavern-plugin/src/client/modules/history-viewport.js', import.meta.url), 'utf8')
const create = new Function('createOrderedNumericIndex', source.split('const tavernHistoryViewport =')[0] + ';return createTavernHistoryViewport')(createOrderedNumericIndex)

test('fully expanded history append and removal have bounded index visits and notifications', () => {
  for (const count of [20, 400, 10000]) {
    let visits = 0, notifications = 0
    const viewport = create(20, { visit: () => visits++ })
    for (let turn = 0; turn < count; turn++) {
      viewport.register('a', turn, () => {})
      viewport.subscribe(viewport.key('a', turn), () => notifications++)
    }
    for (let n = 20; n < count; n += 20) viewport.more('a')
    // Set the explicit paging limit even for the smallest fixture.
    viewport.more('a')
    visits = notifications = 0
    const remove = viewport.register('a', count, () => {})
    assert.equal(viewport.state(viewport.key('a', 0)), 1)
    assert.ok(visits < 500, `${count}: ${visits} visits`)
    assert.ok(notifications <= 2, `${count}: ${notifications} notifications`)
    visits = notifications = 0
    remove()
    assert.ok(visits < 500, `${count}: ${visits} removal visits`)
    assert.ok(notifications <= 2)
  }
})

test('paging, duplicate mounts, holes, session changes and earlier controls retain semantics', () => {
  const viewport = create(3), released = []
  const unmount = new Map()
  for (const turn of [5, 1, 4, 2, 3]) unmount.set(turn, viewport.register('a', turn, () => released.push(turn)))
  const state = turn => viewport.state(viewport.key('a', turn))
  assert.deepEqual([1,2,3,4,5].map(state), [0,0,2,1,1])
  const duplicate = viewport.register('a', 5, () => assert.fail('duplicate owner'))
  duplicate()
  assert.equal(state(5), 1)
  unmount.get(4)()
  assert.equal(state(4), 0)
  viewport.register('a', 6, () => released.push(6))
  assert.deepEqual([1,2,3,4,5,6].map(state), [0,0,2,0,1,1])
  viewport.more('a')
  assert.equal(state(1), 1)
  viewport.register('a', 7, () => {})
  assert.equal(state(1), 1)
  viewport.register('b', 1, () => {})
  assert.equal(state(1), 0)
  assert.equal(viewport.state(viewport.key('b',1)), 1)
  assert.ok(released.includes(6))
})

test('numeric suffix preserves sorted values and only reports discarded entries', () => {
  const index = createOrderedNumericIndex()
  const values = [-Infinity, -2, 0, 1.5, 8, Infinity]
  const all = index.from(values.map(key => [key, { key }]))
  for (let start = 0; start <= values.length; start++) {
    const next = index.suffix(all, start)
    assert.deepEqual(next.map(item => item.key), values.slice(start))
    assert.equal(index.changed(all, next).length, start)
  }
})
