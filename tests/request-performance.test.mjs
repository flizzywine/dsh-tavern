import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequestPerformance} from '../tavern-plugin/lib/domain/request-performance.js'

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
