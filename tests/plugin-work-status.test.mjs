import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function createTavernUiExtensions()')
const factory = source.slice(start, source.indexOf('const tavernUiExtensions = createTavernUiExtensions()', start))

/** A clock the factory sees through Date.now and setTimeout/clearTimeout. */
function createClock() {
  let now = 1_000_000
  let nextId = 1
  const timers = new Map()
  function setTimeout(fn, ms) {
    const id = nextId++
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn })
    return id
  }
  function clearTimeout(id) {
    timers.delete(id)
  }
  function advance(ms) {
    now += Math.max(0, Number(ms) || 0)
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at)
      if (!due.length) return
      for (const [id, timer] of due) {
        if (!timers.has(id)) continue
        timers.delete(id)
        timer.fn()
      }
    }
  }
  return { now: () => now, setTimeout, clearTimeout, advance, pending: () => timers.size }
}

/** The slice of liveTavernView the factory reads: getSnapshot + subscribe(paths). */
function createLiveView() {
  const snapshots = new Map()
  const listeners = new Map()
  return {
    set(sessionId, view, error = '') {
      snapshots.set(sessionId, { phase: view ? 'ready' : 'idle', view, error })
      for (const listener of [...(listeners.get(sessionId) || [])]) listener()
    },
    getSnapshot(sessionId) {
      return snapshots.get(sessionId) || { phase: 'idle', view: null, error: '' }
    },
    subscribe(sessionId, listener) {
      let set = listeners.get(sessionId)
      if (!set) { set = new Set(); listeners.set(sessionId, set) }
      set.add(listener)
      return () => set.delete(listener)
    },
  }
}

function createSessions() {
  const rows = {}
  const listeners = new Set()
  return {
    rows,
    list: {
      getSnapshot: () => ({ byId: rows }),
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    },
    touch(sessionId, running) {
      rows[sessionId] = { id: sessionId, running }
      for (const listener of [...listeners]) listener()
    },
  }
}

function load() {
  const clock = createClock()
  const live = createLiveView()
  const sessions = createSessions()
  const context = {
    React: { createElement: () => null },
    tavernPluginBoundary: () => 'Boundary',
    tavernPluginAllowed: () => true,
    tavernErrorHub: { report() {} },
    liveTavernView: live,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    Date: { now: clock.now },
  }
  const ui = vm.runInNewContext(factory + '; createTavernUiExtensions()', context)
  ui.attachHost({ sessions, get: () => undefined })
  function plugin(name = 'pet') {
    const instance = { ctx: { fiber: { name } } }
    Object.setPrototypeOf(instance, ui.service)
    return instance
  }
  return { ui, clock, live, sessions, plugin }
}

function activity(busy, role = 'foreground') {
  return { busy, role, phase: busy ? 'running' : 'idle' }
}

test('工作状态：没人动时是 idle，忙碌/工具/提问/结算失败各有自己的状态', () => {
  const { ui, live, plugin } = load()
  const pet = plugin()
  const seen = []
  const stop = pet.watchWorkStatus('s1', state => seen.push(state))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].state, 'idle')
  assert.equal(seen[0].sessionId, 's1')

  live.set('s1', { activity: activity(true), settleStatus: 'done', latestAssistantTurn: 2 })
  assert.equal(seen.at(-1).state, 'thinking')
  assert.equal(seen.at(-1).busy, true)

  ui.publishReply({ sessionId: 's1', mode: 'story', turn: 2, text: '写到一半', streaming: true, busy: true, tool: 'tavern_update_card' })
  assert.equal(seen.at(-1).state, 'working')
  assert.equal(seen.at(-1).tool, 'tavern_update_card')

  ui.publishReply({ sessionId: 's1', mode: 'story', turn: 2, text: '', streaming: false, busy: true, tool: 'ask_user_question' })
  assert.equal(seen.at(-1).state, 'waiting')

  live.set('s1', { activity: activity(false), settleStatus: 'error', settleError: '后台结算已中断，请重试结算。', latestAssistantTurn: 2 })
  assert.equal(seen.at(-1).state, 'error')
  assert.equal(seen.at(-1).error, '后台结算已中断，请重试结算。')

  stop()
})

test('工作状态：忙完给一次 success，4 秒后回到 idle；重复状态不重复回调', () => {
  const { ui, live, clock, plugin } = load()
  const pet = plugin()
  const seen = []
  const stop = pet.watchWorkStatus('s2', state => seen.push(state))

  live.set('s2', { activity: activity(true), settleStatus: 'done', latestAssistantTurn: 3 })
  const busyCount = seen.length
  live.set('s2', { activity: activity(true), settleStatus: 'done', latestAssistantTurn: 3 })
  assert.equal(seen.length, busyCount, '同样的忙碌状态不重复回调')

  live.set('s2', { activity: activity(false), settleStatus: 'done', latestAssistantTurn: 3 })
  assert.equal(seen.at(-1).state, 'success')
  assert.equal(seen.at(-1).reason, 'settled')

  clock.advance(3999)
  assert.equal(seen.at(-1).state, 'success')
  clock.advance(1)
  assert.equal(seen.at(-1).state, 'idle')

  stop()
})

test('占用锁：一局一个 scope 只给一个插件；同插件续期不换编号', () => {
  const { ui, clock, plugin } = load()
  const pet = plugin('pet')
  const other = plugin('maid')

  const lease = pet.acquireLease({ sessionId: 'g1', scope: 'voice', ttlMs: 5000, reason: '引导提问' })
  assert.equal(lease.holder, 'pet')
  assert.equal(lease.reason, '引导提问')
  assert.equal(pet.getLease('g1', 'voice').leaseId, lease.leaseId)

  assert.throws(() => other.acquireLease({ sessionId: 'g1', scope: 'voice' }), error => {
    assert.equal(error.code, 'TAVERN_PLUGIN_LEASED')
    assert.equal(error.holder, 'pet')
    assert.ok(error.expiresAt > clock.now())
    return true
  })

  const renewed = pet.acquireLease({ sessionId: 'g1', scope: 'voice', ttlMs: 8000 })
  assert.equal(renewed.leaseId, lease.leaseId, '同插件重拿是续期，不是新锁')
  assert.ok(renewed.expiresAt > lease.expiresAt)

  renewed.release()
  assert.equal(pet.getLease('g1', 'voice'), null)
})

test('占用锁：watchLease 看到申请、续期、释放与过期', () => {
  const { ui, clock, plugin } = load()
  const pet = plugin('pet')
  const watcher = plugin('observer')
  const seen = []
  const stop = watcher.watchLease('g2', 'bubble', (lease, cause) => seen.push({ lease, cause }))
  assert.equal(seen[0].lease, null)
  assert.equal(seen[0].cause, 'current')

  const lease = pet.acquireLease({ sessionId: 'g2', scope: 'bubble', ttlMs: 2000 })
  assert.equal(seen.at(-1).lease.holder, 'pet')
  assert.equal(seen.at(-1).cause, 'acquired')

  lease.renew(3000)
  assert.equal(seen.at(-1).cause, 'renewed')

  clock.advance(3000)
  assert.equal(seen.at(-1).lease, null)
  assert.equal(seen.at(-1).cause, 'expired')

  lease.release()
  stop()
})

test('占用锁：过期后别人能拿；释放是幂等的；scope/ttl 有校验', () => {
  const { ui, clock, plugin } = load()
  const pet = plugin('pet')
  const other = plugin('maid')
  const lease = pet.acquireLease({ sessionId: 'g3', scope: 'stage', ttlMs: 1000 })
  clock.advance(1000)
  assert.equal(pet.getLease('g3', 'stage'), null)
  assert.equal(lease.release(), false, '过期后再释放是空操作')
  const next = other.acquireLease({ sessionId: 'g3', scope: 'stage', ttlMs: 1000 })
  assert.equal(next.holder, 'maid')

  assert.throws(() => pet.acquireLease({ sessionId: 'g3', scope: 'Voice' }), /scope/)
  assert.throws(() => pet.acquireLease({ sessionId: 'g3', scope: 'voice', ttlMs: 10 }), /ttlMs/)
  assert.throws(() => pet.acquireLease({ sessionId: 'g3', scope: 'voice', ttlMs: 700000 }), /ttlMs/)
  assert.throws(() => lease.renew(2000), error => {
    assert.equal(error.code, 'TAVERN_PLUGIN_LEASE_LOST')
    return true
  })
})
