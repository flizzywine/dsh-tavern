// A card's opening page on the stage (card page opening:true, presets/tavern/skills/stage-status-panel/references/panel-contract.md「开局页」): it completes the
// card's openingSetup through the same host authority as the 游戏准备 form, keeps the chosen greeting as the first act,
// and its values reach the greeting floor once official MVU has built it in the game.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'
import { createOpeningPreparation } from '../tavern-plugin/lib/domain/opening-preparation.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { createCardPagesService } from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/status-panel-service.js'
import { projectCardSummary } from '../tavern-plugin/lib/domain/card-preparation.js'
import { projectCardPageOpening } from '../tavern-plugin/lib/domain/card-page-opening.js'

const initvar = stage => '<initvar>\n{"剧情":{"阶段":"' + stage + '"},"好感":{"露娜":0}}\n</initvar>'
const spec = { version: 2, title: '开局', fields: [
  { key: 'name', type: 'name', label: '你的名字' },
  { key: 'wish', type: 'text', label: '额外设定', multiline: true, maxLength: 2000 },
  { key: 'bond', type: 'choice', label: '关系', variable: '好感.露娜', options: [{ value: 5, label: '刚认识' }, { value: 35, label: '常一起玩' }] }
], message: '{wish}' }

async function start(choice) {
  const h = initializationFixture()
  h.card.first_mes = '{{user}}停下了脚步。' + initvar('星光杯')
  h.card.alternate_greetings = ['鸟居下走出一个银发少女。' + initvar('露娜哈喽')]
  h.state.extensions = { openingSetup: { spec } }
  const service = createOpeningPreparation({ readCard: async () => h.card, worldBooks: { bound: async () => null }, readRuntimeExtensions: async () => ({ openingSetup: { spec } }) })
  const { id } = await service.begin(h.card.path)
  const prepared = await service.callRuntime(id, 'prepareOpeningPage', choice)
  const chat = await h.make().start({ ...h.input, openingId: choice.openingId, userName: prepared.playerName, preparation: service.resolve(id, h.card.path, choice.openingId) })
  return { chat, prepared }
}

test('a stage opening page keeps the chosen greeting as the first floor and the player speaks first', async () => {
  const { chat, prepared } = await start({ openingId: 'alternate:0', values: { name: '月城遥', wish: '月城遥会弹吉他', bond: 35 } })
  assert.deepEqual(prepared, { playerName: '月城遥', input: '' })
  const greeting = chat.messages.find(message => message.greeting)
  assert.match(greeting.text, /银发少女/, 'the greeting is shown, not replaced by the setup form blank')
  assert.equal(greeting.openingChoiceId, 'alternate:0')
  assert.equal(chat.macroState.userName, '月城遥')
  // the setup note (the setup's message) is sent once with the first request and has no floor: the greeting stays
  // the latest floor, which official MVU builds first
  assert.deepEqual(chat.messages.map(message => message.role), ['assistant'])
  assert.ok(chat.tavernScriptPrompts.some(prompt => prompt.prompts?.some(item => item.content === '月城遥会弹吉他') || prompt.content === '月城遥会弹吉他'))
  // no frame built MVU before the start: the values wait for the game's own build
  assert.deepEqual(chat.mvu.openingStartVariables, { '好感.露娜': 35 })
  assert.equal(chat.mvu.openingInitialization.status, 'pending')
  assert.equal(chat.openingPrepared, true, 'a set-up game is not a never-played chat')
})

test('an empty extra setting adds no setup note; without a greeting the setting is required and the AI goes first', async () => {
  const { chat } = await start({ openingId: 'primary', values: { name: '遥', wish: '' } })
  assert.ok(!(chat.tavernScriptPrompts || []).length)
  assert.match(chat.messages[0].text, /停下了脚步/)
  await assert.rejects(start({ openingId: 'primary', withoutGreeting: true, values: { name: '遥', wish: ' ' } }), /开局内容为空/)
  const free = await start({ openingId: 'primary', withoutGreeting: true, values: { name: '遥', wish: '十年后的研究室' } })
  // as the 游戏准备 form starts: the setting is the first player input, the greeting floor only owns the variables
  assert.deepEqual(free.prepared, { playerName: '遥', input: '十年后的研究室' })
  assert.ok(!free.chat.messages.some(message => message.role === 'system'))
  const floor = free.chat.messages[0]
  assert.equal(floor.greeting, true)
  assert.equal(floor.text.trim(), '')
  assert.match(floor.swipes[floor.swipeId], /<initvar>/, 'official MVU builds the variables from the chosen greeting')
  assert.equal(free.chat.mvu.openingInitialization.status, 'pending')
  await assert.rejects(start({ openingId: 'alternate:9', values: {} }), /开场白不存在/)
})

test('official MVU\'s first build of the greeting floor takes the start\'s values over it, once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stage-opening-'))
  try {
    const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: directory }) })
    await persistence.write({ id: 'game', sessionId: 'game', cardPath: 'card.json', mode: 'story', tavernHelperLifecycleRevision: 1,
      mvu: { enabled: true, owner: 'official', openingInitialization: { version: 2, status: 'pending' }, openingStartVariables: { '好感.露娜': 35 } },
      messages: [{ role: 'assistant', greeting: true, turn: 1, text: 'a', sourceText: 'a', swipes: ['a', 'b'], swipeId: 1, variables: [{}, {}] }] })
    const adapter = createTavernScriptHostAdapter({ resolveChat: id => persistence.read(id), writeChat: (...args) => persistence.write(...args),
      patchChat: (...args) => persistence.patch(...args), updateChat: (...args) => persistence.update(...args), readChatRevision: (...args) => persistence.readRevision(...args),
      hasScripts: async () => true, isPlayChat: () => true, readCard: async () => ({}), worldBooks: {}, scriptDispatch: {} })
    const built = { stat_data: { 好感: { 露娜: [0, '露娜的好感'] } }, schema: {} }
    await adapter.updateMessages('game', [{ message_id: 0, swipes_data: [structuredClone(built), structuredClone(built)] }], 1)
    const chat = await persistence.read('game')
    assert.deepEqual(chat.messages[0].variables[1].stat_data.好感.露娜, [35, '露娜的好感'], 'MVU keeps its description')
    assert.deepEqual(chat.messages[0].variables[0].stat_data.好感.露娜, [0, '露娜的好感'], 'only the chosen greeting')
    assert.equal(chat.mvu.openingStartVariables, undefined)
    assert.equal(chat.mvu.openingInitialization.status, 'complete')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('the opening page reads the card\'s greetings, their scenes and the setup it completes', async () => {
  const card = { name: '露娜', first_mes: '{{user}}停下了脚步。' + initvar('星光杯'), alternate_greetings: ['鸟居下。'],
    extensions: { dsh_tavern: { openingSetup: spec, openings: { scenes: { primary: { greeting: '0'.repeat(16), title: '公寓附近的小路', summary: '下班路上，你在小路上遇见了她', background: { packId: 'p', kind: 'backgrounds', assetId: 'road' }, music: null, timeOfDay: 'night', cast: [] } } },
      pages: [{ id: 'title', label: '标题', html: '<p>t</p>', size: 'full', showOn: { event: 'stage-enter' } }, { id: 'opening', label: '开局', html: '<p>o</p>', size: 'full', opening: true }] } } }
  const service = createCardPagesService({ readWorkspace: async () => ({ raw: { spec: 'chara_card_v2', data: card } }), chatForSession: async () => ({ cardPath: 'c', mode: 'story', macroState: { userName: '你' }, openingPrepared: false }),
    index: async () => ({ messages: [{ role: 'assistant' }] }), packSnapshot: async () => null, cardPageOpening: projectCardPageOpening })
  const opening = await service.opening({ sessionId: 's', page: 'opening', userName: '月城遥' })
  assert.equal(opening.userName, '月城遥')
  assert.equal(opening.setup.message, '{wish}')
  assert.equal(opening.openings[0].text.startsWith('月城遥停下了脚步'), true, 'projected for the typed name by the host')
  assert.deepEqual(opening.openings[0].state.剧情, { 阶段: '星光杯' })
  assert.deepEqual(opening.openings[0].scene, { title: '公寓附近的小路', summary: '下班路上，你在小路上遇见了她', background: 'road', music: null, timeOfDay: 'night' })
  assert.equal(opening.openings[1].scene, undefined)
  assert.equal(await service.opening({ sessionId: 's', page: 'title' }), null, 'only the opening page reads it')
  const listed = await service.list({ sessionId: 's' })
  assert.equal(listed.fresh, true)
  assert.equal(listed.pages.find(page => page.id === 'opening').opening, true)
  assert.equal(projectCardSummary({ spec: 'chara_card_v2', data: card }).openingPage, 'opening')
  assert.equal(projectCardSummary({ spec: 'chara_card_v2', data: { ...card, extensions: {} } }).openingPage, '')
})

test('a card write refuses an opening page without a version 2 openingSetup', async () => {
  const { createCardPreparation } = await import('../tavern-plugin/lib/domain/card-preparation.js')
  const preparation = createCardPreparation({ id: () => 'fixture-card', now: () => 1 })
  const card = preparation.create({ kind: 'import', payload: { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Card', first_mes: 'Hi', extensions: { dsh_tavern: { schemaVersion: 1 } } } } })
  const pages = [{ id: 'opening', label: '开局', html: '<p>o</p>', size: 'full', opening: true }]
  assert.throws(() => preparation.update({ kind: 'card', card, rawOperations: [{ op: 'set', path: '/data/extensions/dsh_tavern/pages', value: pages }] }), { code: 'CARD_PAGES_INVALID' })
  const saved = preparation.update({ kind: 'card', card, rawOperations: [{ op: 'set', path: '/data/extensions/dsh_tavern/openingSetup', value: spec }, { op: 'set', path: '/data/extensions/dsh_tavern/pages', value: pages }] }).card
  assert.equal(projectCardSummary(saved).openingPage, 'opening')
})

// A fresh install has no open session whose card needs the stage, so its stage client is not loaded when the player
// picks a card with an opening page: the card list asks the server stage and the card's 舞台模式 instead, holds the
// stage client while the new game is made, and enters that game once the stage is up (it used to fall back to 游戏准备).
test('the first game of a fresh install holds the stage client and enters the new game once it is up', async () => {
  const { readFileSync } = await import('node:fs')
  const vm = (await import('node:vm')).default
  const { sourceFunction } = await import('./fixtures/source-function.mjs')
  const source = readFileSync(new URL('../tavern-plugin/src/client/features/sidebar.js', import.meta.url), 'utf8')
  const listeners = new Set(), events = []
  let available = false
  const context = vm.createContext({
    busy: false, pendingChatImport: null, console,
    galStageAvailable: { get: () => available, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } },
    galStageHold: () => { events.push('hold'); return () => events.push('release') },
    galEnter: (id, target) => events.push(['enter', id, target]),
    call: async method => method === 'getStageRuntimeStatus' ? { status: 'ready' } : { effectiveStage: { stage: true } },
    preparePlayConversation: () => events.push('form'),
    newConversation: async (card, mode, openingId, userName, input, from) => { events.push('create'); from.onCreated({ sessionId: 'new-game' }) }
  })
  for (const name of ['openPlayCard', 'stageOpens', 'whenStageAvailable']) vm.runInContext(sourceFunction(source, name), context)
  await context.openPlayCard({ path: 'cards/a.json', hasOpeningForm: true, openingPage: 'opening' }, true)
  assert.deepEqual(events, ['hold', 'create'], 'no 游戏准备, and nothing entered before the stage is up')
  available = true
  for (const fn of [...listeners]) fn()
  assert.deepEqual(JSON.parse(JSON.stringify(events)), ['hold', 'create', 'release', ['enter', 'new-game', { page: 'opening' }]])
  // the server stage is off: the card keeps its 游戏准备
  events.length = 0
  context.call = async method => method === 'getStageRuntimeStatus' ? { status: 'stopped' } : { effectiveStage: { stage: true } }
  await context.openPlayCard({ path: 'cards/a.json', hasOpeningForm: true, openingPage: 'opening' })
  assert.deepEqual(events, ['form'])
})