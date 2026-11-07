import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/features/play-controls.js', import.meta.url), 'utf8')
const start = source.indexOf('function createTavernRegenerationViewRefresher(')
const end = source.indexOf('function createPlayControlsFeatureModule()', start)
assert.ok(start >= 0 && end > start, '重生成视图刷新器必须位于 play-controls 中')
const createRefresher = vm.runInNewContext(source.slice(start, end) + '; createTavernRegenerationViewRefresher')

function fixture() {
  let now = 0, nextTimer = 1
  const timers = new Map(), invalidations = [], storyReads = []
  const snapshot = { view: { regenInProgress: false, streamingMessageUid: null } }
  function schedule(run, delay) {
    const id = nextTimer++
    timers.set(id, { at: now + delay, run })
    return id
  }
  function advance(ms) {
    const target = now + ms
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (!next || next[1].at > target) break
      now = next[1].at
      timers.delete(next[0])
      next[1].run()
    }
    now = target
  }
  const notify = createRefresher({
    liveTavernView: {
      invalidate: id => invalidations.push({ id, at: now }),
      getSnapshot: () => snapshot
    },
    storyChanged: id => storyReads.push({ id, at: now }),
    schedule,
    cancel: id => timers.delete(id)
  })
  return { notify, snapshot, timers, invalidations, storyReads, advance }
}

test('准备超过 2.2 秒仍持续确认生成标记，读到后立即撤旧正文并停止轮询', () => {
  const h = fixture()
  h.notify('session-a', true)
  h.advance(2200)
  assert.equal(h.invalidations.length, 5, '固定三次刷新之外仍继续读取')

  // 服务端在旧的最后一次定时刷新之后才写入 regen-begin。
  h.snapshot.view = { regenInProgress: true, streamingMessageUid: 'uid-target' }
  h.advance(400)
  assert.equal(h.invalidations.length, 6, '下一次确认读取到生成标记')
  assert.deepEqual(h.invalidations.at(-1), { id: 'session-a', at: 2500 })
  assert.equal(h.timers.size, 0, '确认标记后不在整个模型生成期间轮询')
  assert.equal(h.storyReads.length, h.invalidations.length, '故事行与实时视图同步刷新')

  h.advance(5000)
  assert.equal(h.invalidations.length, 6, '生成期间不再产生额外读取')
  h.notify('session-a', false)
  assert.equal(h.invalidations.length, 7, '请求结束再读取一次正式正文')
  assert.equal(h.timers.size, 0)
})

test('准备失败或请求提前结束时取消确认，不留下后台定时器', () => {
  const h = fixture()
  h.notify('session-a', true)
  h.advance(1200)
  assert.equal(h.invalidations.length, 3)
  h.notify('session-a', false)
  assert.equal(h.invalidations.length, 4)
  assert.equal(h.timers.size, 0)
  h.advance(10000)
  assert.equal(h.invalidations.length, 4, '结束后没有迟到的生成中刷新')
})

test('不同会话的标记确认互不收尾', () => {
  const h = fixture()
  h.notify('session-a', true)
  h.notify('session-b', true)
  h.notify('session-a', false)
  assert.equal(h.timers.size, 1, 'session-b 仍等待自己的生成标记')
  h.advance(500)
  assert.deepEqual(h.invalidations.at(-1), { id: 'session-b', at: 500 })
  h.notify('session-b', false)
  assert.equal(h.timers.size, 0)
})
