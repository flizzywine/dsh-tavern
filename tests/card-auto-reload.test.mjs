import assert from 'node:assert/strict'
import test from 'node:test'
import { CARD_RELOAD_BUSY, createCardAutoReload } from '../tavern-plugin/lib/domain/card-auto-reload.js'

const status = { available: true, cardChanged: true, digest: 'card-v2' }

test('自动重载发现游戏正忙时等待，任务抢先启动时也会在空闲后重试', async () => {
  const jobs = [], published = []
  let calls = 0
  const reload = createCardAutoReload({
    apply: async () => {
      if (++calls === 1) throw Object.assign(new Error('generation started'), { code: CARD_RELOAD_BUSY })
    },
    defer: job => jobs.push(job),
    published: session => published.push(session),
    logger: { warn: () => assert.fail('暂时忙碌不应记录失败') }
  })
  assert.equal(reload.schedule('session', status, { busy: true }), false)
  assert.equal(reload.waiting('session'), true)
  assert.equal(jobs.length, 0)

  assert.equal(reload.schedule('session', status), true)
  assert.equal(reload.schedule('session', status), false)
  await jobs.shift()()
  assert.equal(reload.running('session'), false)
  assert.equal(reload.waiting('session'), true)
  assert.equal(reload.failure('session', status.digest), '')

  assert.equal(reload.schedule('session', status), true)
  await jobs.shift()()
  assert.equal(calls, 2)
  assert.equal(reload.waiting('session'), false)
  assert.deepEqual(published, ['session'])
})

test('真正的自动重载失败只阻止同一版本反复执行', async () => {
  const jobs = [], warnings = []
  const reload = createCardAutoReload({
    apply: async () => { throw new Error('template failed') },
    defer: job => jobs.push(job),
    logger: { warn: (...args) => warnings.push(args) }
  })
  reload.schedule('session', status)
  await jobs.shift()()
  assert.equal(reload.failure('session', status.digest), 'template failed')
  assert.equal(reload.failure('session', 'card-v3'), '')
  assert.equal(reload.schedule('session', status), false)
  assert.equal(reload.waiting('session'), false)
  assert.equal(warnings.length, 1)
  reload.retry('session')
  assert.equal(reload.schedule('session', status), true)
})
