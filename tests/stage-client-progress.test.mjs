import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageProgress} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/progress.cjs')
test('progress isolates sessions, ignores replaced requests and rejects writes after disposal', () => {
  let now = 0, notifications = 0
  const {store} = createStageProgress({performance:{now:() => now}})
  const stop = store.subscribe(() => notifications++)
  store.begin('a',1);store.begin('b',2)
  now = 400
  store.plan('a',1,{background:{resource:true,identity:'bg'}})
  assert.equal(store.get('a').total,1)
  assert.equal(store.get('b').phase,'read')
  store.begin('a',3)
  store.settle('a',1,'background')
  store.end('a',1)
  assert.equal(store.get('a').id,3)
  assert.equal(store.get('a').endedAt,null)
  store.dispose()
  const count = notifications
  store.begin('a',4)
  store.plan('b',2,{background:{resource:true,identity:'late'}})
  store.end('b',2)
  assert.equal(store.get('a'),null)
  assert.equal(store.get('b'),null)
  assert.equal(notifications,count)
  stop()
  const replacement = createStageProgress({performance:{now:() => now}}).store
  replacement.begin('a',1)
  assert.equal(replacement.get('a').id,1)
})
