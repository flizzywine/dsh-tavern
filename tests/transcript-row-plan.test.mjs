import test from 'node:test'
import assert from 'node:assert/strict'
import { createTranscriptFold, planTranscriptRows, planTranscriptWindow, planShowsRow, planStoryTurn } from '../tavern-plugin/lib/domain/transcript-row-plan.js'

const model = { kind: 'model', provider: 'test', model: 'test' }
const story = n => ({ source: { ...model, tavernStoryTurn: n } })
const reply = (seq, turn, text, extra = {}, step = 1) => ({ seq, type: 'assistant/message', surfaceOp: 'append', data: { turn, step, message: { role: 'assistant', content: [{ type: 'text', text }], source: model, ...extra } } })
const input = (seq, source = { kind: 'user' }) => ({ seq, type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text: '输入' }], source } })
const mark = (seq, type, turn, step = 1) => ({ seq, type, data: { turn, step, reason: { kind: 'completed' } } })
const floors = turns => turns.flatMap(turn => [{ role: 'user' }, { role: 'assistant', turn }])
const chat = turns => ({ messages: floors(turns) })
const plain = plan => Object.fromEntries(Object.keys(plan).map(key => [key, plan[key]]))
// A round as the log writes it, numbered from `seq`.
function round(seq, turn, text = '正文') {
  return [mark(seq, 'turn/start', turn), input(seq + 1), reply(seq + 2, turn, text), mark(seq + 3, 'step/end', turn), mark(seq + 4, 'turn/end', turn)]
}

test('最后一轮还在跑、或失败停在那里：这一轮原样显示；回退掉的和作废的生成期回合藏起来', () => {
  const running = [...round(0, 1), mark(5, 'turn/start', 2), input(6)]
  assert.deepEqual(plain(planTranscriptRows({ chat: chat([1]), events: running })), {})
  const failed = [...running, reply(7, 2, '半截'), mark(8, 'step/end', 2), { seq: 9, type: 'turn/end', data: { turn: 2, reason: { kind: 'error' } } }]
  assert.deepEqual(plain(planTranscriptRows({ chat: chat([1]), events: failed })), {})
  // A completed turn the save lacks was rolled back (rounds are saved before the turn ends).
  const rolledBack = [...running, reply(7, 2, '回退了'), mark(8, 'step/end', 2), mark(9, 'turn/end', 2)]
  assert.deepEqual(plain(planTranscriptRows({ chat: chat([1]), events: rolledBack })), { 2: { input: 0, reply: 0 } })
  const attempt = [...round(0, 1), mark(5, 'turn/start', 2), input(6, { kind: 'plugin', plugin: 'dsh-tavern-regen' }), reply(7, 2, '作废'), mark(8, 'step/end', 2), mark(9, 'turn/end', 2)]
  assert.deepEqual(plain(planTranscriptRows({ chat: chat([1]), events: attempt })), { 2: { input: 0, reply: 0 } })
})

// The fold is fed in pieces in the app: one event at a time, the save from the first
// changed floor on. Any order of feeding must land on the plan fed everything at once.
test('逐条喂入日志、按变化喂入存档，结果和一次喂完完全相同', () => {
  const regen = [...round(0, 1, '旧'), mark(5, 'turn/start', 2), input(6, { kind: 'plugin', plugin: 'dsh-tavern-regen' }), reply(7, 2, '新'), mark(8, 'step/end', 2), mark(9, 'turn/end', 2),
    mark(10, 'turn/start', 3), { seq: 11, type: 'assistant/message', surfaceOp: { op: 'replace', start: 2, end: 7 }, data: { turn: 3, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '新' }], ...story(1) } } },
    mark(12, 'step/end', 3), mark(13, 'turn/end', 3), ...round(14, 4)]
  const save = floors([1, 4])
  const whole = plain(planTranscriptRows({ chat: { messages: save }, events: regen }))
  const fold = createTranscriptFold()
  fold.setFloors(0, save.slice(0, 2))
  for (let index = 0; index < regen.length; index++) {
    fold.addEvents(regen.slice(0, index + 1))
    if (index === 15) fold.setFloors(2, save.slice(2))
    fold.result()
  }
  assert.deepEqual(plain(fold.result()), whole)
  // A rollback of the last round, then the round played again.
  fold.setFloors(2, [])
  fold.setFloors(2, save.slice(2))
  assert.deepEqual(plain(fold.result()), whole)
})

// A long game, every 5th round regenerated once (attempt turn + projection edit turn).
function longGame(rounds) {
  const events = [], save = []
  let turn = 0
  for (let index = 1; index <= rounds; index++) {
    const own = ++turn, seq = events.length
    events.push(...round(seq, own, '第 ' + index + ' 轮'))
    save.push(...floors([own]))
    if (index % 5 === 0) {
      const attempt = ++turn, edit = ++turn, at = events.length
      events.push(mark(at, 'turn/start', attempt), input(at + 1, { kind: 'plugin', plugin: 'dsh-tavern-regen' }), reply(at + 2, attempt, '新'), mark(at + 3, 'step/end', attempt), mark(at + 4, 'turn/end', attempt),
        mark(at + 5, 'turn/start', edit), { seq: at + 6, type: 'assistant/message', surfaceOp: { op: 'replace', start: seq + 2, end: at + 2 }, data: { turn: edit, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '新' }], ...story(own) } } },
        mark(at + 7, 'step/end', edit), mark(at + 8, 'turn/end', edit))
    }
  }
  return { events, save }
}

test('按窗口算：窗口内每个原生轮的结论与全量计算相同，窗口之前原样显示', () => {
  const { events, save } = longGame(60)
  const whole = planTranscriptRows({ chat: { messages: save }, events })
  const window = planTranscriptWindow({ messages: save.slice(-48), events, partial: true })
  assert.ok(window.from > 1)
  for (let turn = 1; turn <= events.filter(event => event.type === 'turn/start').length + 5; turn++) {
    for (const kind of ['user', 'turn-trigger', 'assistant-step', 'turn-tail']) {
      const planned = planShowsRow(window.turns, { turn, kind }, window.from)
      // Before the window: shown as the host draws it, until scrolling widens the window.
      if (turn < window.from) assert.equal(planned, true)
      else assert.equal(planned, planShowsRow(whole, { turn, kind }), `原生轮 ${turn} ${kind}`)
    }
  }
})

// Count the log events the window plan touches: it must not grow with the game.
// #311: an old save repaired many times and rolled back twice. The log's prose is
// replaced by placeholders (tests/fixtures/transcript/issue-311.json); the save holds the
// opening and rounds 2, 3, 5 and 12.
test('#311 旧存档：只画存档里五轮各一份输入与正文，修复副本与已回退的轮都不画', async () => {
  const { readFile } = await import('node:fs/promises')
  const { events } = JSON.parse(await readFile(new URL('./fixtures/transcript/issue-311.json', import.meta.url), 'utf8'))
  const messages = [{ role: 'assistant', greeting: true, turn: 1 }, ...[2, 3, 5, 12].flatMap(turn => [{ role: 'user', turn }, { role: 'assistant', turn }])]
  const plan = planTranscriptRows({ chat: { messages }, events })
  const turns = [...new Set(events.filter(event => event.type === 'turn/start').map(event => event.data.turn))]
  const shown = kind => turns.filter(turn => planShowsRow(plan, { turn, kind }))
  assert.deepEqual(shown('user'), [1, 2, 3, 5, 12])
  assert.deepEqual(shown('assistant-step'), [1, 2, 3, 11, 14])
  assert.deepEqual([11, 14].map(turn => planStoryTurn(plan, turn)), [5, 12])
})
