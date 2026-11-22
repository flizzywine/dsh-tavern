import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, name } from '../tavern-plugin/packages/dsh-tavern-story-director/lib/index.js'

const version = turn => 'version-' + turn
const plan = {
  intent: '失踪案会影响同伴之间的信任',
  direction: '让调查触及同伴之间的信任。'
}
const response = (next = plan) => JSON.stringify({ reply: '这条线可以从同伴之间的信任展开。', plan: next })
const chosenModel = { provider: 'configured', model: 'director-model' }

function fixture() {
  const records = new Map(), handlers = new Map(), requests = []
  let settled, guide, dispose, generate = () => response(), latest = 1
  const prose = new Map()
  const tavern = {
    capabilities: { guideSource: 1 },
    handle(key, handler) { handlers.set(key, handler) },
    guideSource({ text }) { guide = text },
    onTurnSettled(listener) { settled = listener },
    async readGameData({ gameId }) { return structuredClone(records.get(gameId)) },
    async saveGameData({ gameId, data }) { records.set(gameId, structuredClone(data)) },
    async getTurnState() { return { turn: latest, textVersion: version(latest) } },
    async getHistory({ from, to }) {
      assert.ok(to - from <= 4)
      return [{ turn: to, input: '打开信', text: prose.get(to) || '旅人揭开信封。' }]
    },
    async publishState() {},
    async taskModels() {
      return { catalog: [{ provider: chosenModel.provider, models: [{ id: chosenModel.model }] }], background: null }
    },
    async runTask(request) { requests.push(request); return { text: await generate(request) } }
  }
  apply({ tavern, effect: setup => { dispose = setup() } })
  const call = (handler, args = {}) => handlers.get(name + '/' + handler)({ gameId: 'game', ...args })
  return {
    call, requests, dispose,
    restore(state) { records.set('game', structuredClone(state)) },
    model(value) { generate = typeof value === 'function' ? value : () => value },
    guide: (gameId = 'game') => guide({ gameId }),
    move(turn) { latest = turn },
    prose(turn, text) { prose.set(turn, text) },
    settle(turn) { latest = turn; return settled({ gameId: 'game', turn, textVersion: version(turn) }) }
  }
}

test('导演模型按本局保存，对话与复盘使用同一选择，可以恢复跟随后台', async () => {
  const f = fixture()
  assert.equal((await f.call('models')).catalog[0].models[0].id, chosenModel.model)
  await assert.rejects(f.call('set-model', { selection: { provider: 'unconfigured', model: 'unavailable' } }), /已不可用/)
  await f.call('set-model', { selection: chosenModel })
  await f.call('send', { requestId: 'first', question: '按悬疑写' })
  await f.settle(3)
  assert.deepEqual(f.requests.map(request => request.selection), [chosenModel, chosenModel])
  assert.deepEqual((await f.call('state')).model, chosenModel)
  assert.equal((await f.call('state', { gameId: 'another' })).model, undefined)
  await f.call('set-model', { selection: null })
  await f.call('send', { requestId: 'second', question: '留一个小线索' })
  assert.equal(f.requests.at(-1).selection, undefined)
})

test('一句模糊想法生成一句剧情 Guide，每轮复盘，暂停后停止注入和调用', async () => {
  const f = fixture()
  const request = { requestId: 'first', question: '我想让调查影响同伴之间的关系。' }
  assert.equal(await f.guide(), '')
  const { turns } = await f.call('send', request)
  assert.equal(turns[0].applied, true)
  assert.match(f.requests[0].prompt, /旅人揭开信封/)
  assert.match(f.requests[0].prompt, /我想让调查影响同伴之间的关系/)
  assert.equal(await f.guide(), '【剧情导演 Guide】\n' + plan.direction)
  assert.equal(await f.guide('other-game'), '')
  assert.deepEqual((await f.call('state')).turns, turns)
  await f.call('send', request)
  assert.equal(f.requests.length, 1, '重试发送不重复调用')
  f.model(response({ ...plan, intent: '不相干的新目标', direction: '让追查和同伴的共同利益发生冲突。' }))
  await f.settle(2)
  assert.equal((await f.call('state')).plan.intent, plan.intent)
  assert.match(await f.guide(), /共同利益发生冲突/)
  assert.match(f.requests[1].prompt, /对照总纲和最新正文/)
  await f.call('set-enabled', { enabled: false })
  await f.settle(6)
  assert.equal(await f.guide(), '')
  assert.equal(f.requests.length, 2)
  await f.call('set-enabled', { enabled: true })
  assert.equal(await f.guide(), '', '恢复时不注入旧正文版本的方向')
  await f.settle(7)
  assert.match(await f.guide(), /共同利益发生冲突/)
})

test('纯讨论保留安排，无效或基于旧正文的回复不会生效', async () => {
  const f = fixture()
  f.model(response(null))
  assert.equal((await f.call('send', { requestId: 'question', question: '你有什么想法？' })).plan, null)
  assert.equal(await f.guide(), '')
  const invalidDirections = ['<% 写入状态 %>', '让调查出现阻力。让同伴发生争执。', '推进调查'.repeat(16)]
  for (const [index, direction] of invalidDirections.entries()) {
    f.model(response({ ...plan, direction }))
    await assert.rejects(f.call('send', { requestId: 'invalid-' + index, question: '让调查遇到阻力' }), /计划内容无效/)
  }
  f.model(() => { f.move(2); return response() })
  await assert.rejects(f.call('send', { requestId: 'stale', question: '让情节收紧' }), /剧情已推进/)
  assert.equal(await f.guide(), '')
  assert.equal((await f.call('state')).turns.length, 1)
})

test('暂停抢先于正在复盘的旧计划，已保存的安排仍可恢复', async () => {
  const f = fixture()
  await f.call('send', { requestId: 'first', question: '想渐渐紧张起来' })
  const started = Promise.withResolvers(), finish = Promise.withResolvers()
  f.model(({ signal }) => { started.resolve(signal); return finish.promise })
  const reviewing = f.settle(3)
  const signal = await started.promise
  const pause = f.call('set-enabled', { enabled: false })
  assert.equal(signal.aborted, true)
  finish.resolve(response({ ...plan, direction: '这条已经取消。' }))
  await Promise.all([reviewing, pause])
  assert.equal(await f.guide(), '')
  const restored = await f.call('set-enabled', { enabled: true })
  assert.equal(restored.plan.direction, plan.direction)
})


test('总纲和剧情进度留给导演，下一轮 Guide 随正文更新剧情方向', async () => {
  const f = fixture()
  const framework = '先调查假账，再追查内鬼，最终才揭晓馆长是主谋。'
  const opening = { ...plan, intent: framework, framework, progress: '旅人刚发现账册' }
  f.model(response(opening))
  await f.call('send', { requestId: 'long', question: framework })
  assert.match(await f.guide(), /调查触及同伴之间的信任/)
  assert.doesNotMatch(await f.guide(), /假账|主谋|刚发现账册/)

  f.prose(2, '一场戏里已经查到假账并得知账房失踪。')
  f.model(({ prompt }) => {
    assert.match(prompt, /长期纲要.*馆长是主谋/)
    assert.match(prompt, /一场戏里已经查到假账并得知账房失踪/)
    assert.match(prompt, /判断现在值得关注哪条剧情线/)
    return response({ ...opening, framework: null, progress: '假账已查实，账房失踪',
      direction: '让失踪案成为调查的重心。' })
  })
  await f.settle(2)
  assert.equal(await f.guide(), '【剧情导演 Guide】\n让失踪案成为调查的重心。')

  f.prose(3, '两人反复讨论失踪的事，仍没有作出决定。')
  f.model(({ prompt }) => {
    assert.match(prompt, /假账已查实，账房失踪/)
    assert.match(prompt, /两人反复讨论失踪的事/)
    assert.match(prompt, /馆长是主谋/)
    return response({ ...opening, progress: '假账已查实，账房失踪；两人尚未决定去处',
      direction: '把调查转向失踪者与同伴之间的关系。' })
  })
  await f.settle(3)
  assert.equal(await f.guide(), '【剧情导演 Guide】\n把调查转向失踪者与同伴之间的关系。')
  assert.equal((await f.call('state')).plan.framework, framework)
  assert.equal(f.requests.length, 3, '长期纲要按已结算剧情逐轮复盘')
})

test('剧情连续推进时，跳过过时安排并补做最新一轮复盘', async () => {
  const f = fixture()
  const framework = '三场戏里逐步揭晓去向。'
  f.model(response({ ...plan, framework }))
  await f.call('send', { requestId: 'first', question: framework })
  const started = Promise.withResolvers(), finish = Promise.withResolvers()
  f.model(() => { started.resolve(); return finish.promise })
  const oldReview = f.settle(2)
  await started.promise
  await f.settle(3)
  assert.equal(await f.guide(), '')
  assert.equal((await f.call('state')).guide, null)

  f.model(response({ ...plan, framework, direction: '让调查转向失踪者的去向。' }))
  finish.resolve(response({ ...plan, framework, direction: '已经过时的安排。' }))
  await oldReview
  for (let tries = 0; !(await f.guide()).includes('调查转向失踪者的去向'); tries++) {
    assert.ok(tries < 30, '最新一轮应自动补做复盘')
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.doesNotMatch(await f.guide(), /已经过时的安排|三场戏里/)
  assert.equal(f.requests.length, 3)
})

test('旧存档的细节、节奏和文风立即停止注入，总纲仍用于随后复盘', async () => {
  const f = fixture()
  const framework = '调查失踪案，最后厘清同伴为何隐瞒。'
  f.restore({
    enabled: true, anchor: { turn: 1, textVersion: version(1) }, turns: [],
    plan: { intent: plan.intent, framework, progress: '失踪已被发现',
      story: '旧剧情细节', style: '旧文风', pacing: '旧节奏', reviewAfter: 4 }
  })
  assert.equal(await f.guide(), '')
  assert.equal((await f.call('state')).guide, null)
  f.model(({ prompt }) => {
    assert.match(prompt, /调查失踪案，最后厘清同伴为何隐瞒/)
    assert.doesNotMatch(prompt, /旧剧情细节|旧文风|旧节奏/)
    return response({ ...plan, framework: null })
  })
  await f.settle(2)
  assert.equal(await f.guide(), '【剧情导演 Guide】\n' + plan.direction)
  assert.deepEqual((await f.call('state')).plan, { ...plan, framework, progress: '失踪已被发现' })
})

test('本轮无需引导时清空当前 Guide，总纲继续用于下一轮', async () => {
  const f = fixture()
  const framework = '最终揭示角色为何离开。'
  f.model(response({ ...plan, framework }))
  await f.call('send', { requestId: 'first', question: framework })
  f.model(response(null))
  await f.settle(2)
  assert.equal(await f.guide(), '')
  assert.equal((await f.call('state')).plan.framework, framework)
  f.model(({ prompt }) => {
    assert.match(prompt, /最终揭示角色为何离开/)
    return response(plan)
  })
  await f.settle(3)
  assert.equal(await f.guide(), '【剧情导演 Guide】\n' + plan.direction)
})
