import assert from 'node:assert/strict'
import test from 'node:test'


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

test('只保留最近一次精修，那轮正文换了版本就不再显示、不能撤销', async () => {
  const { createPolishRecords } = await import('../tavern-plugin/lib/domain/polish-records.js')
  let game = null, key = 'k1'
  const saved = []
  const records = createPolishRecords({
    data: { saveGame: async ({ data }) => { game = data }, readGame: async () => game },
    turns: { resolveGame: async () => ({ chatId: 'c', sessionId: 's' }), currentKey: async () => key },
    now: () => 5,
    onSaved(sessionId, requestId) { saved.push({ sessionId, requestId, record: game }) }
  })
  await records.save('s', 3, { original: ['甲。乙。', '丙。'], edits: [{ find: '乙。', replace: '乙改。', reason: '套话' }], seconds: 20, requestId: 'manual-polish' })
  assert.deepEqual(saved, [{ sessionId: 's', requestId: 'manual-polish', record: game }])
  assert.equal(game.key, 'k1')
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
