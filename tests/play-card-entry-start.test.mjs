import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { sourceFunction } from './fixtures/source-function.mjs'
import { projectCardSummary } from '../tavern-plugin/lib/domain/card-preparation.js'

// A card whose initial entry page (page-contract「入口」) opens each new game on the stage and that has nothing for the
// 游戏准备 to ask (no opening setup, no opening page, one greeting) starts its game at once from 开始游戏.
const handbook = { id: 'handbook', label: '员工手册', html: '<p>h</p>', size: 'full', showOn: { event: 'stage-enter' }, initial: true }
const title = { id: 'title', label: '标题', html: '<p>t</p>', size: 'full', showOn: { event: 'stage-enter' } }
const setup = { version: 2, title: '开局', fields: [{ key: 'name', type: 'text', label: '名字' }], message: '{name}' }
const summary = (data) => projectCardSummary({ spec: 'chara_card_v2', data: { name: 'Card', first_mes: '欢迎入职。', ...data } })
const pages = list => ({ extensions: { dsh_tavern: { schemaVersion: 1, pages: list } } })

test('the card summary marks a card whose initial entry page starts each game', () => {
  assert.equal(summary(pages([title, handbook])).entryStart, true)
  assert.equal(summary({ ...pages([handbook]), alternate_greetings: [] }).entryStart, true, 'an empty alternate list is still one greeting')
})

test('only cards whose initial entry page starts the game are marked', () => {
  assert.equal(summary({}).entryStart, false, 'no pages')
  assert.equal(summary(pages([title])).entryStart, false, 'no initial page')
  assert.equal(summary({ ...pages([handbook]), alternate_greetings: ['另一段开场。'] }).entryStart, false, 'several greetings')
  assert.equal(summary({ ...pages([handbook]), first_mes: '' }).entryStart, false, 'no greeting')
  assert.equal(summary({ extensions: { dsh_tavern: { schemaVersion: 1, pages: [handbook], openingSetup: setup } } }).entryStart, false, 'an opening setup')
  const opening = { id: 'opening', label: '开局', html: '<p>o</p>', size: 'full', opening: true }
  assert.equal(summary({ extensions: { dsh_tavern: { schemaVersion: 1, pages: [handbook, opening], openingSetup: setup } } }).entryStart, false, 'an opening page')
})

const source = readFileSync(new URL('../tavern-plugin/src/client/features/sidebar.js', import.meta.url), 'utf8')
function sidebar(stage) {
  const events = []
  const context = vm.createContext({
    busy: false, pendingChatImport: null, console: { warn() {} }, setOpeningCardName() {}, setBusy() {}, setError() {},
    galStageAvailable: { get: () => true, subscribe: () => () => {} },
    galStageHold: () => { events.push('hold'); return () => events.push('release') },
    galEnter: (id, target) => events.push(['enter', id, target === undefined ? 'entry' : target]),
    call: async method => { assert.equal(method, 'prepareCardStage'); if (stage === 'broken') throw new Error('offline'); return { stage } },
    preparePlayConversation: async () => { events.push('游戏准备') },
    newConversation: async (card, mode, openingId, userName, input, from) => {
      events.push(['create', openingId, userName, input])
      from.onCreated?.({ sessionId: 'new-game' })
    }
  })
  for (const name of ['openPlayCard', 'stageOpens', 'whenStageAvailable']) vm.runInContext(sourceFunction(source, name), context)
  return { open: (card, toOpening) => context.openPlayCard(card, toOpening).then(() => JSON.parse(JSON.stringify(events))) }
}
const card = { path: 'cards/agency.json', name: '机构', hasOpeningForm: false, entryStart: true }

test('开始游戏 on such a card with the stage on starts the game and enters the stage at its entry pages', async () => {
  assert.deepEqual(await sidebar(true).open(card), ['hold', ['create', null, null, null], 'release', ['enter', 'new-game', 'entry']])
  // the stage's 新游戏 on a saved game: the new game also opens at its initial page, not at a blank first act
  assert.deepEqual(await sidebar(true).open(card, true), ['hold', ['create', null, null, null], 'release', ['enter', 'new-game', 'entry']])
})

test('with the stage off the game starts in text mode at its greeting, still without the 游戏准备', async () => {
  assert.deepEqual(await sidebar(false).open(card), [['create', null, null, null]])
  assert.deepEqual(await sidebar('broken').open(card), [['create', null, null, null]])
})

test('plain cards start in the conversation and only cards with an opening form use 游戏准备', async () => {
  assert.deepEqual(await sidebar(true).open(summary({ alternate_greetings: ['另一段开场。'] })), [['create', null, null, null]])
  assert.deepEqual(await sidebar(true).open({ path: 'cards/form.json', hasOpeningForm: true }), ['游戏准备'])
  assert.deepEqual(await sidebar(false).open({ path: 'cards/page.json', hasOpeningForm: true, openingPage: 'opening' }), ['游戏准备'])
})
