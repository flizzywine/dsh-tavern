import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, name } from '../tavern-plugin/packages/dsh-tavern-story-director/lib/index.js'

const version = turn => 'version-' + turn
const plan = {
  intent: '逐渐收紧的悬疑感',
  story: '先让旅人从信里看见陌生签名，等他追问再揭示署名者。',
  pacing: '放慢拆信，留一拍观察，再递出新的线索。',
  style: '用短对白交锋，少写直白的心理解释。',
  reviewAfter: 2
}
const response = (next = plan) => JSON.stringify({ reply: '先把张力留在拆信这个动作里。', plan: next })

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
    async runTask(request) { requests.push(request); return { text: await generate(request) } }
  }
  apply({ tavern, effect: setup => { dispose = setup() } })
  const call = (handler, args = {}) => handlers.get(name + '/' + handler)({ gameId: 'game', ...args })
  return {
    call, requests, dispose,
    model(value) { generate = typeof value === 'function' ? value : () => value },
    guide: (gameId = 'game') => guide({ gameId }),
    move(turn) { latest = turn },
    prose(turn, text) { prose.set(turn, text) },
    settle(turn) { latest = turn; return settled({ gameId: 'game', turn, textVersion: version(turn) }) }
  }
}

test('一句模糊想法自动生成 Guide，带着最新正文复盘，暂停后不再注入或调用模型', async () => {
  const f = fixture()
  const request = { requestId: 'first', question: '我想稍微紧张点。' }
  assert.equal(await f.guide(), '')
  const { turns } = await f.call('send', request)
  assert.equal(turns[0].applied, true)
  assert.match(f.requests[0].prompt, /旅人揭开信封/)
  assert.match(f.requests[0].prompt, /我想稍微紧张点/)
  assert.match(await f.guide(), /剧情：先让旅人[\s\S]*节奏：放慢拆信[\s\S]*文风：用短对白/)
  assert.equal(await f.guide('other-game'), '')
  assert.deepEqual((await f.call('state')).turns, turns)
  await f.call('send', request)
  await f.settle(2)
  assert.equal(f.requests.length, 1, '重试发送和未到复盘轮都不重复调用')
  f.model(response({ ...plan, intent: '不相干的新目标', story: '署名已查明，把新疑问留给门外的访客。' }))
  await f.settle(3)
  assert.equal((await f.call('state')).plan.intent, '逐渐收紧的悬疑感')
  assert.match(await f.guide(), /门外的访客/)
  assert.match(f.requests[1].prompt, /复盘当前安排/)
  await f.call('set-enabled', { enabled: false })
  await f.settle(6)
  assert.equal(await f.guide(), '')
  assert.equal(f.requests.length, 2)
  await f.call('set-enabled', { enabled: true })
  assert.match(await f.guide(), /门外的访客/)
})

test('纯讨论保留安排，无效或基于旧正文的回复不会生效', async () => {
  const f = fixture()
  f.model(response(null))
  assert.equal((await f.call('send', { requestId: 'question', question: '你有什么想法？' })).plan, null)
  assert.equal(await f.guide(), '')
  f.model(response({ ...plan, story: '<% 写入状态 %>' }))
  await assert.rejects(f.call('send', { requestId: 'invalid', question: '让情节收紧' }), /计划内容无效/)
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
  finish.resolve(response({ ...plan, story: '这条已经取消。' }))
  await Promise.all([reviewing, pause])
  assert.equal(await f.guide(), '')
  const restored = await f.call('set-enabled', { enabled: true })
  assert.equal(restored.plan.story, plan.story)
})


test('长期纲要和剧情进度留给导演，下一轮 Guide 随实际节奏加速或减速', async () => {
  const f = fixture()
  const framework = '先调查假账，再追查内鬼，最终才揭晓馆长是主谋。'
  const opening = { ...plan, intent: framework, framework, progress: '旅人刚发现账册', reviewAfter: 4 }
  f.model(response(opening))
  await f.call('send', { requestId: 'long', question: framework })
  assert.match(await f.guide(), /先让旅人从信里看见陌生签名/)
  assert.doesNotMatch(await f.guide(), /假账|主谋|刚发现账册/)

  f.prose(2, '一场戏里已经查到假账并得知账房失踪。')
  f.model(({ prompt }) => {
    assert.match(prompt, /长期纲要.*馆长是主谋/)
    assert.match(prompt, /一场戏里已经查到假账并得知账房失踪/)
    assert.match(prompt, /判断推进过快、过慢还是合适/)
    return response({ ...opening, framework: null, progress: '假账已查实，账房失踪',
      story: '先写同伴听到失踪消息后的反应。', pacing: '先留一拍消化消息，把新的揭露推迟。' })
  })
  await f.settle(2)
  assert.match(await f.guide(), /先留一拍/)
  assert.doesNotMatch(await f.guide(), /假账已查实|馆长是主谋|先让旅人/)

  f.prose(3, '两人反复讨论失踪的事，仍没有作出决定。')
  f.model(({ prompt }) => {
    assert.match(prompt, /假账已查实，账房失踪/)
    assert.match(prompt, /两人反复讨论失踪的事/)
    assert.match(prompt, /馆长是主谋/)
    return response({ ...opening, progress: '假账已查实，账房失踪；两人尚未决定去处',
      story: '让同伴摊开那张当夜的值勤表。', pacing: '结束重复讨论，用一个具体的新线索推动决定。' })
  })
  await f.settle(3)
  assert.match(await f.guide(), /摊开那张当夜的值勤表.*结束重复讨论/s)
  assert.doesNotMatch(await f.guide(), /先留一拍|馆长是主谋|剧情进度/)
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
  assert.match(await f.guide(), /文风：用短对白/)
  assert.doesNotMatch(await f.guide(), /陌生签名|剧情：|节奏：/)
  assert.deepEqual((await f.call('state')).guide, { style: plan.style })

  f.model(response({ ...plan, framework, story: '最新一轮后让信使敲门。' }))
  finish.resolve(response({ ...plan, framework, story: '已经过时的安排。' }))
  await oldReview
  for (let tries = 0; !(await f.guide()).includes('让信使敲门'); tries++) {
    assert.ok(tries < 30, '最新一轮应自动补做复盘')
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.doesNotMatch(await f.guide(), /已经过时的安排|三场戏里/)
  assert.equal(f.requests.length, 3)
})
