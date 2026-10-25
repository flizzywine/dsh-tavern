// 分页: a page's line cut into the cards its text box holds (modules/stage-pager.js), with a box measured in characters: no browser.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../tavern-plugin/src/client/modules/stage-pager.js', import.meta.url), 'utf8')
const pager = vm.runInNewContext(source + '; ({ stagePagerCards, stageCardAt, stageCardVoiceShare, stageBoxRoom, STAGE_PAGE_LINES })')
const { stageCardAt, stageCardVoiceShare, stageBoxRoom, STAGE_PAGE_LINES } = pager
const stagePagerCards = (text, fits) => JSON.parse(JSON.stringify(pager.stagePagerCards(text, fits)))
// A box that holds `room` characters; it records every text it was asked about.
function box(room) {
  const asked = []
  return { asked, fits: text => { asked.push(text); return Array.from(text).length <= room } }
}
const texts = cards => cards.map(card => card.text)

test('a line the box holds is one card; an empty page is one empty card', () => {
  assert.deepEqual(stagePagerCards('短句。', box(20).fits), [{ text: '短句。', start: 0, end: 3 }])
  assert.deepEqual(stagePagerCards('', box(20).fits), [{ text: '', start: 0, end: 0 }])
})

test('a long line is cut at sentence ends, every card fits and the cards cover the line in order', () => {
  const line = '夕阳把走廊染成了橘色。她停下脚步，回头看了你一眼。然后什么也没说，转身走进了教室。'
  const cards = stagePagerCards(line, box(20).fits)
  assert.deepEqual(texts(cards), ['夕阳把走廊染成了橘色。', '她停下脚步，回头看了你一眼。', '然后什么也没说，转身走进了教室。'])
  assert.ok(cards.every(card => Array.from(card.text).length <= 20))
  assert.deepEqual(cards.map(card => [card.start, card.end]), [[0, 11], [11, 25], [25, 41]])
  assert.equal(cards.map(card => card.text).join(''), line)
})

test('no card opens with closing punctuation; an oversized bracket is closed and reopened on each card', () => {
  const cards = stagePagerCards('这句话很长很长很长很长很长很长很长很长很长……！结束', box(23).fits)
  assert.ok(cards.slice(1).every(card => !/^[、。，！？…」』）]/.test(card.text)), JSON.stringify(texts(cards)))
  assert.deepEqual(texts(stagePagerCards('她说：「我们明天再见吧，到时候再把这件事情讲清楚。」然后就走了。', box(14).fits)),
    ['她说：「我们明天再见吧，」', '「到时候再把这件事情讲清」', '「楚。」然后就走了。'])
  // a bracketed passage that fits a card stays whole
  assert.deepEqual(texts(stagePagerCards('他回头看了看。「没事的，我在这里。」她笑了。', box(16).fits)), ['他回头看了看。', '「没事的，我在这里。」她笑了。'])
})

test('a tiny last card makes the line re-split evenly over the same number of cards', () => {
  const line = '一二三四五六七八九十一二三四五六七八九十，甲乙。'
  const cards = stagePagerCards(line, box(20).fits)
  assert.equal(cards.length, 2)
  assert.ok(Math.min(...cards.map(card => card.end - card.start)) >= 8, JSON.stringify(texts(cards)))
  // a short last card after a clause break beats even cards cut mid-phrase
  assert.deepEqual(texts(stagePagerCards('他慢慢走到窗前看着外面的雨，说道好。', box(15).fits)), ['他慢慢走到窗前看着外面的雨，', '说道好。'])
})

test('one card per box, whatever the box: a phone box of one line, Latin text breaks at spaces', () => {
  const line = 'The corridor stretches on in the evening light, long and quiet.'
  const cards = stagePagerCards(line, box(24).fits)
  assert.ok(cards.length >= 3 && cards.every(card => card.text.length <= 24))
  assert.equal(cards.map(card => card.text).join(''), line)
  assert.ok(cards.slice(0, -1).every(card => /[\s,.]$/.test(card.text)), JSON.stringify(texts(cards)))
  // even a box too small for a word makes progress
  assert.equal(stagePagerCards('abcdef', box(1).fits).length, 6)
})

test('the shown card follows its offset; voice shares; the lines a text area holds', () => {
  const cards = [{ start: 0, end: 10 }, { start: 10, end: 25 }, { start: 25, end: 30 }]
  assert.equal(stageCardAt(cards, 0), 0)
  assert.equal(stageCardAt(cards, 10), 1)
  assert.equal(stageCardAt(cards, 24), 1)
  assert.equal(stageCardAt(cards, Infinity), 2, 'past the end: the last card')
  assert.deepEqual([0, 1, 2].map(card => stageCardVoiceShare(cards, card)), [1 / 3, 25 / 30, 1])
  assert.equal(STAGE_PAGE_LINES, 3)
  assert.equal(stageBoxRoom(92, 30.6, 18), 3)
  assert.equal(stageBoxRoom(41, 30.6, 18), 1)
  assert.equal(stageBoxRoom(10, 30.6, 18), 1, 'a box always holds one line')
})
