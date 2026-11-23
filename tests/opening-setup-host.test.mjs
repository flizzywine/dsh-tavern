import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpeningPreparation } from '../tavern-plugin/lib/domain/opening-preparation.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'

const spec = () => ({
  version: 2,
  title: '{{char}}的开局',
  fields: [
    { key: 'name', type: 'name', label: '你的称呼' },
    { key: 'stage', type: 'choice', label: '从哪里开始', variable: '剧情.阶段', options: [
      { value: '同居初期', desc: '{{user}}第一次见到露娜' },
      { value: '星光杯', scriptStart: { chunk: 2 }, worldbook: { '1️⃣': false, '2️⃣': true } }] }
  ],
  message: '（开局：{stage}。{name}在场。）'
})

const card = (setup) => ({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: '露娜', first_mes: '<initvar>{"剧情":{"阶段":["同居初期","阶段说明"]}}</initvar>你好，{{user}}。', alternate_greetings: ['第二幕'],
  extensions: setup === undefined ? {} : { dsh_tavern: { openingSetup: setup } } } })

test('card writes validate a v2 spec once and keep v1 forms accepted', () => {
  const service = createCardPreparation()
  const workspace = service.create({ kind: 'import', payload: card() })
  const set = value => ({ kind: 'card', card: workspace, rawOperations: [{ op: 'set', path: '/data/extensions/dsh_tavern', value: { openingSetup: value } }] })
  const before = JSON.stringify(workspace)
  assert.throws(() => service.update(set({ version: 2, fields: [{ key: 'a', type: 'date', label: '日期' }], message: 'x' })), /开局设置：第 1 个字段「日期」的 type「date」不受支持/)
  assert.equal(JSON.stringify(workspace), before, 'a rejected write changes nothing')
  assert.equal(service.update(set({ version: 1, form: '<form></form>' })).changed, true)
  const saved = service.update(set(spec()))
  assert.equal(saved.changed, true)
  // An unchanged spec is not re-validated on later unrelated edits.
  assert.equal(service.update({ kind: 'card', card: saved.card, patch: { description: '新描述' } }).changed, true)
})

test('resolveOpeningSetup turns values into the start payload, switches the draft book and starts the game', async () => {
  const h = initializationFixture()
  h.state.extensions = { openingSetup: { spec: spec() } }
  h.state.script = { title: 'Routes', importedAt: 1, chunks: [{ id: 'c1', order: 0, text: '第一块。' }, { id: 'c2', order: 1, text: '第二块。' }] }
  const document = { name: '书', entries: { 0: { uid: 0, key: ['甲'], comment: '1️⃣主线', content: '一周目' }, 1: { uid: 1, key: ['乙'], comment: '2️⃣后日谈', content: '后日谈', disable: true }, 2: { uid: 2, key: ['丙'], comment: '通用', content: '通用' } } }
  const service = createOpeningPreparation({ readCard: async () => h.card, worldBooks: { bound: async () => ({ source: { kind: 'standalone', path: 'book.json' }, document, view: inspectWorldBookDocument(document) }) } })
  const draft = await service.create(h.card.path, { userName: '玩家', extensions: h.state.extensions })
  assert.ok(draft.runtime, 'a v2 setup enables the prep runtime')
  await assert.rejects(service.callRuntime(draft.id, 'resolveOpeningSetup', { values: { name: '  ' } }), /「你的称呼」还没填/)
  const resolved = await service.callRuntime(draft.id, 'resolveOpeningSetup', { values: { name: '小林', stage: '星光杯' } })
  assert.deepEqual(resolved, { playerName: '小林', message: '（开局：星光杯。小林在场。）', scriptStart: { chunk: 2 } }, 'the variables stay on the host')
  const book = service.get(draft.id).worldbook.entries
  assert.deepEqual(book.map(entry => [entry.name, entry.enabled]), [['1️⃣主线', false], ['2️⃣后日谈', true], ['通用', true]])
  assert.equal(document.entries[0].disable, undefined, 'the source book is untouched')
  // The frame's MVU, still initializing the greeting floor, writes its initvar values after the player pressed start.
  await service.callRuntime(draft.id, 'updateTavernHelperVariables', { option: { type: 'message', message_id: 0 }, variables: { stat_data: { 剧情: { 阶段: ['同居初期', '阶段说明'] } }, schema: {} } })
  // The frame then runs the v1 start: dshOpening.start → prepareOpeningCommand.
  await service.callRuntime(draft.id, 'prepareOpeningCommand', { line: '/send ' + resolved.message + '|/trigger', userName: resolved.playerName, scriptStart: resolved.scriptStart })
  const preparation = service.resolve(draft.id, h.card.path, 'primary')
  assert.deepEqual(preparation.messageVariables, { stat_data: { 剧情: { 阶段: ['星光杯', '阶段说明'] } }, schema: {} }, 'the chosen values win over the late initialization and keep the MVU description')
  const chat = await h.make().start({ ...h.input, preparation })
  assert.equal(chat.macroState.userName, '小林')
  assert.equal(chat.messages.find(message => message.greeting).text, '\u3000', 'the greeting is neither shown nor sent')
  assert.equal(chat.scriptState.sourceOffset, h.state.script.chunks[0].text.length, 'the chosen chunk is the cursor')
})
