import assert from 'node:assert/strict'
import test from 'node:test'

import { applyPolishEdits, composePolishEdits } from '../tavern-plugin/lib/domain/polish-review.js'

test('两步精修记成原文上的修改：意见改动映射回原文，碰到精修改过的句子就并成一处', () => {
  const review = [{ find: '乙。', replace: '乙改。', reason: '套话' }, { find: '戊。', replace: '', reason: '删去' }]
  const original = '甲。乙。丙。丁。戊。己。'
  // Inside a review change, on untouched text, and across a change and the text after it.
  assert.deepEqual(composePolishEdits(original, review, [{ find: '乙改', replace: '乙再改', reason: '更狠' }, { find: '己。', replace: '己改。', reason: '加细节' }]), [
    { find: '乙。', replace: '乙再改。', reason: '套话；按意见：更狠' },
    { find: '戊。', replace: '', reason: '删去' },
    { find: '己。', replace: '己改。', reason: '按意见：加细节' }
  ])
  assert.deepEqual(composePolishEdits(original, review, [{ find: '甲。乙改。丙', replace: '新句', reason: '合并' }]), [
    { find: '甲。乙。丙', replace: '新句', reason: '套话；按意见：合并' },
    { find: '戊。', replace: '', reason: '删去' }
  ])
  // Text right after a deleted sentence maps back past it.
  assert.deepEqual(composePolishEdits(original, review, [{ find: '丁。己', replace: '丁己', reason: '连起来' }]), [
    { find: '乙。', replace: '乙改。', reason: '套话' },
    { find: '丁。戊。己', replace: '丁己', reason: '删去；按意见：连起来' }
  ])
  // Applying the record to the original gives what the two passes gave.
  const record = composePolishEdits(original, review, [{ find: '丙。丁', replace: '丙丁', reason: 'x' }])
  assert.equal(applyPolishEdits([original], record)[0], applyPolishEdits(applyPolishEdits([original], review), [{ find: '丙。丁', replace: '丙丁' }])[0])
  assert.equal(review[0].replace, '乙改。')
})

test('后台预审：同一版正文只审一次，换了版本就作废，点精修时等它或当场审', async () => {
  const { createPolishPrereview } = await import('../tavern-plugin/lib/domain/polish-run.js')
  let enabled = false, texts = ['正文一'], calls = []
  const prereview = createPolishPrereview({
    enabled: async () => enabled,
    readTexts: async () => texts,
    review: (sessionId, read, signal) => { const call = { read, signal }; calls.push(call); return new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject }) },
    logger: { warn() {} }
  })
  assert.equal(await prereview.start('s'), false)
  enabled = true
  assert.equal(await prereview.start('s'), true)
  assert.equal(await prereview.start('s'), false)
  assert.equal(calls.length, 1)
  const waiting = prereview.take('s', ['正文一'])
  calls[0].resolve({ edits: [{ status: 'ok' }], fallback: '' })
  assert.deepEqual(await waiting, { edits: [{ status: 'ok' }], fallback: '' })
  assert.equal(await prereview.take('s', ['正文一']), null)
  // Another text aborts the running review and is never handed to a 精修 of the old one.
  assert.equal(await prereview.start('s'), true)
  texts = ['正文二']
  assert.equal(await prereview.start('s'), true)
  assert.equal(calls[1].signal.aborted, true)
  assert.equal(await prereview.take('s', ['正文一']), null)
  calls[2].reject(new Error('模型失败'))
  assert.equal(await prereview.take('s', ['正文二']), null)
  // Text a 精修 used or produced is not reviewed again; a player message cancels a running one.
  prereview.settle('s', ['正文三'])
  texts = ['正文三']
  assert.equal(await prereview.start('s'), false)
  texts = ['正文四']
  await prereview.start('s')
  prereview.cancel('s')
  assert.equal(calls.at(-1).signal.aborted, true)
  assert.equal(prereview.running('s'), false)
})

test('精修对比按原文顺序切出未改与改动段，找不到或重叠的修改跳过', async () => {
  const { polishSegments } = await import('../tavern-plugin/lib/domain/polish-records.js')
  const segments = polishSegments('甲。乙。丙。', [{ find: '丙。', replace: '丙改。', reason: 'b' }, { find: '甲。', replace: '', reason: 'a' }, { find: '甲。乙', replace: 'x' }, { find: '丁', replace: 'y' }])
  assert.deepEqual(segments, [
    { kind: 'edit', n: 2, find: '甲。', replace: '', reason: 'a' },
    { kind: 'same', text: '乙。' },
    { kind: 'edit', n: 1, find: '丙。', replace: '丙改。', reason: 'b' }
  ])
})

test('只保留最近一次精修，那轮正文换了版本就不再显示、不能撤销', async () => {
  const { createPolishRecords } = await import('../tavern-plugin/lib/domain/polish-records.js')
  let game = null, key = 'k1'
  const records = createPolishRecords({
    data: { saveGame: async ({ data }) => { game = data }, readGame: async () => game },
    turns: { resolveGame: async () => ({ chatId: 'c', sessionId: 's' }), currentKey: async () => key },
    now: () => 5
  })
  await records.save('s', 3, { original: ['甲。乙。', '丙。'], edits: [{ find: '乙。', replace: '乙改。', reason: '套话' }], seconds: 20 })
  assert.deepEqual(await records.latest('s'), { turn: 3, at: 5, seconds: 20, count: 1, auto: false, segments: [{ kind: 'same', text: '甲。' }, { kind: 'edit', n: 1, find: '乙。', replace: '乙改。', reason: '套话' }, { kind: 'same', text: '\n\n丙。' }] })
  assert.deepEqual((await records.current('s')).original, ['甲。乙。', '丙。'])
  key = 'k2'
  assert.equal(await records.latest('s'), null)
  assert.equal(await records.current('s'), null)
})

test('自动精修：审完就交给写回；新消息取消后不写回', async () => {
  const { createPolishPrereview } = await import('../tavern-plugin/lib/domain/polish-run.js')
  const applied = []
  let finish
  const prereview = createPolishPrereview({ enabled: async () => true, readTexts: async () => ['正文。'], logger: { warn() {} },
    review: (_id, _texts, signal) => new Promise((resolve, reject) => { finish = resolve; signal.addEventListener('abort', () => reject(new Error('aborted'))) }),
    apply: async (id, texts, review) => { applied.push([id, texts, review.edits.length]) } })
  await prereview.start('s')
  finish({ edits: [{ status: 'ok' }] })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(applied, [['s', ['正文。'], 1]])
  prereview.settle('s', ['不同的'])
  const again = createPolishPrereview({ enabled: async () => true, readTexts: async () => ['另一段。'], logger: { warn() {} },
    review: (_id, _texts, signal) => new Promise((resolve, reject) => { finish = resolve; signal.addEventListener('abort', () => reject(new Error('aborted'))) }),
    apply: async () => { applied.push('should not') } })
  await again.start('s')
  again.cancel('s')
  finish({ edits: [{ status: 'ok' }] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(applied.length, 1)
})
