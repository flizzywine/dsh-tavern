import test from 'node:test'
import {channel} from 'node:diagnostics_channel'
import assert from 'node:assert/strict'
import {createRequestPerformance,coldReadLogRows} from '../tavern-plugin/lib/domain/request-performance.js'
import {registerRequestHooks} from '../tavern-plugin/lib/hooks/request.js'

test('并发请求独立计时，错误保留计时，容量有界且不保留输入', async t => {
  let time = 0
  const trace = createRequestPerformance({now: () => time, wall: () => 100})
  t.after(() => trace.dispose())
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
test('cold reads aggregate pack work per async request and log the first three plus later slow ones', async t => {
  const logged = [], trace = createRequestPerformance({onColdRead:row => logged.push(row)})
  t.after(() => trace.dispose())
  const reads = channel('dsh.asset.read')
  await Promise.all(['getStageDirection','getDialogueBubbles'].map(method => trace.run(method,'',async () => {
    await Promise.resolve()
    for (let i=0;i<300;i++) reads.publish({name:'pack.json.parse',durationMs:1,bytes:20})
  })))
  for (const row of logged.filter(row => row.phase === 'end')) assert.deepEqual(row.reads,[{key:'pack.json.parse:',count:300,durationMs:300,bytes:6000}])
  for (let i=0;i<5;i++) await trace.run('getStageDirection','',async () => {})
  assert.equal(logged.filter(row => row.method === 'getStageDirection' && row.phase === 'end').length,3)
  let time = 0
  const timed = createRequestPerformance({now:() => time, onColdRead:row => logged.push(row)})
  t.after(() => timed.dispose())
  for (let i=0;i<4;i++) await timed.run('getStageItems','',async () => {})
  await timed.run('getStageItems','',async () => {time += 300})
  assert.deepEqual(logged.filter(row => row.method === 'getStageItems' && row.phase === 'end').map(row => row.durationMs),[0,0,0,300],'a slow request past the first three is still logged')
  const id = 'session-00000000-0000-0000-0000-000000000001'
  await trace.run('getStageDirection',id,() => trace.stage('direction.chat',async () => {}))
  const cold = logged.at(-1)
  assert.equal(cold.ordinal,1,'another session still logs its first cold read')
  assert.equal(cold.id,id)
  assert.ok(Number.isFinite(cold.stages[0].atMs))
  assert.ok(cold.endedAt >= cold.receivedAt)
  assert.equal(trace.serialize('getStageDirection',id,{ok:true}),'{"ok":true}')
  assert.equal(logged.at(-1).phase,'serialize')
  assert.equal(logged.at(-1).chars,11)
})

test('cold trace chunks fit host log limits and retain native phases after cheap startup reads', async t => {
  const logged = [], trace = createRequestPerformance({onColdRead:row => logged.push(row)})
  t.after(() => trace.dispose())
  const reads = channel('dsh.chat.read')
  for (let i=0;i<50;i++) reads.publish({name:'chat.materialize',durationMs:1})
  await trace.run('getStageDirection','',async () => {
    reads.publish({name:'chat.native.messages',durationMs:500})
    reads.publish({name:'chat.materialize',durationMs:1000})
    for (let i=0;i<80;i++) channel('dsh.asset.read').publish({name:'pack.gate.wait',durationMs:20,
      packIds:Array(300).fill('00000000-0000-0000-0000-000000000001')})
  })
  assert.equal(logged.filter(row => row.method === 'chat-load').length,1)
  const row=logged.find(row => row.phase === 'end'), chunks=coldReadLogRows(row)
  assert.equal(chunks[0].waitsCount,80)
  assert.ok(chunks.every(chunk => Buffer.byteLength(JSON.stringify(chunk)) < 9000))
  assert.deepEqual(chunks.filter(chunk => chunk.section === 'waits').flatMap(chunk => chunk.values),row.waits)
  assert.ok(row.reads.some(read => read.key === 'chat.native.messages:'))
  assert.deepEqual(row.waits.at(-1).packIds,['00000000-0000-0000-0000-000000000001'])
})
