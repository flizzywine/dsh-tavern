import test from 'node:test'
import assert from 'node:assert/strict'

import {createServerTemplateSync} from '../tavern-plugin/lib/domain/server-template-sync.js'

test('entering settlement cancels a pending retry and blocks a running callback from rearming', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let runs = 0, release
  const sync = createServerTemplateSync({ run: () => { runs++; return new Promise(resolve => { release = resolve }) } })
  t.after(() => sync.dispose())
  sync.schedule('s', 1)
  t.mock.timers.tick(250)
  sync.schedule('s', 2, { blocked: true })
  release({ deferred: true }); await Promise.resolve()
  for (let i = 0; i < 40; i++) { t.mock.timers.tick(250); await Promise.resolve() }
  assert.equal(runs, 1)
  sync.schedule('s', 3)
  t.mock.timers.tick(250)
  release({ deferred: true }); await Promise.resolve()
  sync.schedule('s', 4, { blocked: true })
  t.mock.timers.tick(5000); await Promise.resolve()
  assert.equal(runs, 2)
  sync.schedule('s', 4, { blocked: false })
  t.mock.timers.tick(250)
  assert.equal(runs, 3, 'unblocking the same revision still wakes work')
  release({}); await Promise.resolve()
})

test('回合进行中写入的显示同步先暂缓，回合结束放行后只跑一次', async () => {
  const runs = []
  const sync = createServerTemplateSync({ delayMs: 1, run: async id => { runs.push(id) } })
  sync.schedule('a', 1, { blocked: true })
  sync.schedule('a', 2, { blocked: true })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(runs, [])
  sync.release('a')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(runs, ['a'])
  sync.release('a')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(runs, ['a'])
  sync.dispose()
})

test('模板运行期间存档变了（冲突）：不报失败，退避后在新状态上重跑一次', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let runs = 0
  const errors = []
  const sync = createServerTemplateSync({ onError: error => errors.push(error), run: async () => {
    runs++
    if (runs === 1) throw Object.assign(new Error('聊天正文或 swipe 已变化，模板存档未保存'), { code: 'PROMPT_TEMPLATE_STATE_CONFLICT' })
    return {}
  } })
  t.after(() => sync.dispose())
  sync.schedule('s', 1)
  t.mock.timers.tick(250)
  for (let i = 0; i < 5; i++) await Promise.resolve()
  assert.equal(runs, 1)
  t.mock.timers.tick(500)
  for (let i = 0; i < 5; i++) await Promise.resolve()
  assert.equal(runs, 2, 'reruns after backing off')
  t.mock.timers.tick(5000)
  for (let i = 0; i < 5; i++) await Promise.resolve()
  assert.equal(runs, 2, 'a successful rerun stops')
  assert.deepEqual(errors, [])
})
