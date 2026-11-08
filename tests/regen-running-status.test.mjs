import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlayHandlers } from '../tavern-plugin/lib/rpc/play.js'

// 发送键只看宿主的运行状态。重新生成要读完存档、选好目标、拼好提示词才轮到模型，
// 这段时间里按键还是「发送」；请求一进门就先报运行中，结束再交还。
function harness(options = {}) {
  const emitted = [], releases = []
  let attempts = 0
  const handlers = createPlayHandlers({
    str: String,
    ctx: { emit: (...args) => emitted.push(args) },
    autoChoices: { cancel() {} },
    requestPerformance: { stage: async (_name, run) => run() },
    reconcileStory: async () => {},
    polishPrereview: { cancel() {}, start: async () => {} },
    notifyPluginTimeline() {},
    pluginApi: { gameModes: { active: async () => options.blocked === true } },
    regenBody: async () => {
      attempts += 1
      if (attempts > 1) throw new Error('正文正在重新生成，请等待完成')
      if (options.fail === true) throw new Error('重新生成失败')
      if (options.hold === true) await new Promise(resolve => releases.push(resolve))
      return { view: { mode: 'story' } }
    }
  })
  return { emitted, handlers, attempts: () => attempts, release: () => releases.splice(0).forEach(resolve => resolve()) }
}

test('重新生成一开始就报运行中，结束时交还宿主', async () => {
  const h = harness({ hold: true })
  const running = h.handlers.regenBody({ sessionId: 'game' })
  // 模型请求还没开始（准备阶段卡住），页面已经该看到停止键。
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.emitted, [['api-session/status', 'game', true]])
  h.release()
  await running
  assert.deepEqual(h.emitted, [['api-session/status', 'game', true], ['api-session/status', 'game', false]])
})

test('重新生成失败也把运行状态交还宿主', async () => {
  const h = harness({ fail: true })
  await assert.rejects(() => h.handlers.regenBody({ sessionId: 'game' }), /重新生成失败/)
  assert.deepEqual(h.emitted, [['api-session/status', 'game', true], ['api-session/status', 'game', false]])
})

test('请求在门口就被拒绝时不假装在运行', async () => {
  const h = harness({ blocked: true })
  await assert.rejects(() => h.handlers.regenBody({ sessionId: 'game' }), /玩法面板/)
  assert.deepEqual(h.emitted, [])
})

test('同时到达的重新生成只报一次运行中、一次空闲', async () => {
  const h = harness({ hold: true })
  const first = h.handlers.regenBody({ sessionId: 'game' })
  await new Promise(resolve => setImmediate(resolve))
  const second = h.handlers.regenBody({ sessionId: 'game' })
  // 第二个请求失败（正文正在重新生成）不能把第一个的运行状态点亮又按灭。
  await assert.rejects(() => second, /正在重新生成/)
  assert.deepEqual(h.emitted, [['api-session/status', 'game', true]])
  h.release()
  await first
  assert.deepEqual(h.emitted, [['api-session/status', 'game', true], ['api-session/status', 'game', false]])
})
