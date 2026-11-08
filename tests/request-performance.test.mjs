import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequestPerformance} from '../tavern-plugin/lib/domain/request-performance.js'
import {channel} from 'node:diagnostics_channel'

test('并发请求独立计时，错误保留计时，容量有界且不保留输入', async () => {
  let time = 0
  const trace = createRequestPerformance({now: () => time, wall: () => 100})
  const id = '00000000-0000-0000-0000-000000000001'
  await Promise.all([trace.run('getSession', id, () => trace.stage('readChat', async () => {time += 1200})), trace.run('syncSession', 'SECRET', () => trace.stage('candidateSync', async () => {}))])
  assert.deepEqual(trace.read().recent.map(row => row.stages[0].name), ['readChat', 'candidateSync'])
  assert.equal(trace.read().recent[1].active, 2)
  await assert.rejects(trace.run('getSession', id, async () => {throw Error('PRIVATE')}))
  assert.equal(trace.read().recent.at(-1).failed, true)
  for (let i=0;i<200;i++) await trace.run('getSession', id, async () => {time += 1100})
  assert.equal(trace.read().recent.length, 120)
  assert.equal(trace.read().slow.length, 60)
  assert.doesNotMatch(JSON.stringify(trace.read()), /SECRET|PRIVATE/)
  const copy = trace.read(); copy.recent[0].method='changed'
  assert.equal(trace.read().recent[0].method, 'getSession')
})

test('重新生成保留模型阶段逐条计时但不混入开局诊断', async t => {
  let time = 0
  const trace = createRequestPerformance({now: () => time, wall: () => 1000})
  t.after(() => trace.dispose())
  const id = '00000000-0000-0000-0000-000000000003'
  await trace.run('regenBody', id, () => trace.stage('regen.generate', async () => { time += 1200 }))
  const row = trace.read().recent[0]
  assert.equal(row.method, 'regenBody')
  assert.equal(row.stages[0].name, 'regen.generate')
  assert.equal(row.durationMs, 1200)
  assert.equal(trace.read().openings.length, 0)
  assert.equal(trace.read().slow.length, 1)
})

test('正文读取进入逐条诊断，原生表头与历史阶段不泄漏内容', async t => {
  let time = 100
  const trace = createRequestPerformance({now: () => time, wall: () => 1000})
  t.after(() => trace.dispose())
  const id = '00000000-0000-0000-0000-000000000002'
  await trace.run('getStoryTranscript', id, async () => {
    time += 30
    channel('dsh.chat.read').publish({kind:'phase', name:'chat.native.header', chatId:'PRIVATE', durationMs:20})
    await trace.stage('projectStoryWindow', async () => {})
  })
  const row = trace.read().recent[0]
  assert.equal(row.method, 'getStoryTranscript')
  assert.deepEqual(row.stages.map(stage => stage.name), ['chat.native.header', 'projectStoryWindow'])
  assert.equal(row.stages[0].atMs, 10)
  assert.equal(row.stages[0].durationMs, 20)
  assert.equal(trace.read().openings.length, 0)
  assert.equal(row.eventLoopUtilization, undefined)
  assert.doesNotMatch(JSON.stringify(row), /PRIVATE/)
})
