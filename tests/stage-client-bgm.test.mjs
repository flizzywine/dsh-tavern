import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createBgmPlayer} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/bgm.cjs')
test('disposed BGM ignores a late track list and cannot reactivate', async () => {
  let resolveList, reads = 0, selected = 0, stopped = 0, notifications = 0
  const player = createBgmPlayer({
    music:{get:() => ({}),stop:() => stopped++},
    session:() => {selected++;return null},
    read:() => {reads++;return new Promise(resolve => {resolveList=resolve})},
  })
  player.subscribe(() => notifications++)
  player.activate('s')
  assert.equal(player.get().loading,true)
  player.dispose();player.dispose()
  const before = notifications
  resolveList({tracks:[{ref:{packId:'p',assetId:'a'},name:'late'}]})
  await Promise.resolve();await Promise.resolve()
  player.activate('new')
  player.invalidate()
  player.follow(false)
  assert.equal(notifications,before)
  assert.equal(reads,1)
  assert.equal(selected,1)
  assert.equal(stopped,1)
  assert.deepEqual(player.acquirePerformance({}),{status:'stale'})
})
