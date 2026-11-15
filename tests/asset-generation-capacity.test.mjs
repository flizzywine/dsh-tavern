import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {randomUUID} from 'node:crypto'
import {createAssetGeneration} from '../tavern-plugin/lib/domain/asset-generation.js'

function fixture(t, statuses) {
  const packId = randomUUID(), clock = 1_800_000_000_000, removed = []
  const rows = statuses.map((status, index) => ({jobId:randomUUID(), groupId:randomUUID(), status,
    outcome:status === 'failed' ? 'unconfirmed' : 'received', target:{packId,kind:'background'}, references:[{}],
    createdAt:clock - 1000 + index, expiresAt:clock + 86_400_000}))
  const files = new Map([['asset-generation/jobs.json', structuredClone(Object.fromEntries(rows.map(job => [job.jobId,job]))) ]])
  let sent = 0
  const store = {readJson:async key => structuredClone(files.get(key)), updateJson:async (key, update) => files.set(key, structuredClone(await update(files.get(key)))),
    remove:async key => removed.push(key), readBytes:async () => null, writeBytes:async () => {}}
  const provider = {label:'test', status:async () => ({ready:true, model:'test', maxReferences:4}),
    generate:async () => { sent++; throw Object.assign(new Error('test refusal'), {requestMayHaveSucceeded:false}) }}
  const service = createAssetGeneration({store, now:() => clock, imageProvider:() => provider,
    getLibrary:() => ({getPackSnapshot:async () => ({revision:1, manifest:{assets:[]}})})})
  t.after(() => service.dispose())
  return {service, rows, files, removed, sent:() => sent, prepare:(extra = {}) => service.prepare({target:{packId,kind:'background'}, expectedRevision:1, userPrompt:'forest', ...extra})}
}

test('a full pool recycles oldest accepted/rejected records and their temporary images before generating', async t => {
  const f = fixture(t, Array.from({length:128}, (_, i) => i % 2 ? 'rejected' : 'accepted'))
  const plan = await f.prepare({count:4})
  assert.equal(Object.keys(f.files.get('asset-generation/jobs.json')).length, 124)
  for (const job of f.rows.slice(0,4)) {
    assert.ok(f.removed.includes('asset-generation/' + job.jobId + '.png'))
    assert.ok(f.removed.includes('asset-generation/' + job.jobId + '.ref-0'))
  }
  const result = await f.service.generate({planId:plan.planId, consentToken:plan.consentToken})
  assert.equal(result.jobs.length, 4)
  assert.equal(f.sent(), 4)
})

test('active candidates and uncertain purchases are retained with actionable distinct errors', async t => {
  const active = fixture(t, Array(32).fill('candidate'))
  await assert.rejects(active.prepare(), {code:'TOO_MANY_ACTIVE_JOBS', message:/采用或丢弃/})
  assert.deepEqual(active.removed, [])
  const uncertain = fixture(t, Array(128).fill('failed'))
  await assert.rejects(uncertain.prepare(), {code:'GENERATION_RECORD_POOL_FULL', message:/确认未返回结果/})
  assert.deepEqual(uncertain.removed, [])
  assert.equal((await uncertain.prepare({preview:true})).preview, true)
})

test('unused plans have their own limit message and generation rechecks capacity for the entire batch', async t => {
  const f = fixture(t, Array(29).fill('candidate'))
  const plan = await f.prepare({count:3})
  await assert.rejects(f.prepare({count:4}), {code:'TOO_MANY_ACTIVE_JOBS'})
  for (let i = 1; i < 8; i++) await f.prepare()
  await assert.rejects(f.prepare(), {code:'TOO_MANY_GENERATION_PLANS', message:/15 分钟/})
  assert.equal((await f.prepare({preview:true})).preview, true)
  const result = await f.service.generate({planId:plan.planId, consentToken:plan.consentToken})
  assert.equal(result.jobs.length, 3)
})

test('generation capacity errors reach the player with their actionable messages', async t => {
  const source = await readFile(new URL('../tavern-plugin/src/client/asset-pack-ui.js', import.meta.url), 'utf8')
  const format = vm.runInNewContext(source.slice(0, source.indexOf('function createAssetPackUI')) + '\nplayerErrorText', {console:{warn(){}}})
  const f = fixture(t, Array(32).fill('candidate'))
  await assert.rejects(f.prepare(), error => {
    assert.equal(format(error), error.message)
    assert.doesNotMatch(format(error), /素材数据超过|未能保存/)
    return true
  })
})
