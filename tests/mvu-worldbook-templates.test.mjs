import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlayWorldBook } from '../tavern-plugin/lib/domain/play-world-book.js'
import { createServerTemplateRuntime } from '../tavern-plugin/lib/domain/server-template-runtime.js'
import { UpstreamTemplateRuntime } from './fixtures/upstream-template-runtime.mjs'
import { createWorldBookLibrary } from '../tavern-plugin/lib/domain/worldbook-library.js'
import { createMvuSettlementModule, PROMPT_PROSE } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
const runtime = await UpstreamTemplateRuntime.create()
const rules = entries => createPlayWorldBook({ worldBooks: { bound: async () => ({ view: { entries } }) }, readOnlyTemplateRuntime: async () => runtime }).mvuUpdateRules

test('MVU rule templates share variables without persisting autosaves', async t => {
  const chat = { sessionId: 'game', cardPath: 'rules.json', variables: {}, messages: [] }
  const globals = { value: 'saved' }
  const state = { sessionId: chat.sessionId, chatId: chat.sessionId, chat: [], chat_metadata: { variables: {} } }
  const environment = { name1: 'Player', name2: 'Test', characters: [{ name: 'Test' }], dsh: {},
    extension_settings: { variables: { global: globals }, EjsTemplate: { autosave_enabled: true } } }
  const worker = createServerTemplateRuntime({ rpc: async method => {
    assert.equal(method, 'getFullPromptTemplateState', 'MVU projection must never send an autosave to the host')
    return structuredClone({ state, environment })
  } })
  t.after(() => worker.dispose())
  const entries = [
    { ref: 'controller', title: '[mvu_update] controller', position: 0, content: '<% setvar("value", "temporary", { scope: "global" }); await window.EjsTemplate.saveVariables(); %>' },
    { ref: 'reader', title: '[mvu_update] reader', position: 1, content: '<%= getvar("value", { scope: "global" }) %>' }
  ]
  const play = createPlayWorldBook({ worldBooks: { bound: async () => ({ view: { entries } }) },
    readOnlyTemplateRuntime: worker.forReadOnlyProjection, globalVariables: async () => globals })
  assert.deepEqual(await play.mvuUpdateRules(chat, { name: 'Test' }), ['temporary'])
  assert.deepEqual(globals, { value: 'saved' })
})

test('NPC registration uses the card identity and aliases, keeps ambiguity, and compresses the fallback', async () => {
  const common = '登记时以上述硬字段为准：身份不写姓名（卡头已有），简介不复述身份、不写本名；态度仍只填本轮私心好恶的个人偏置。气血最大值照上面的落点逐字抄；有 `$道`、`$天资` 或 `兵甲` 各行就连它一并照抄，没有则不写该项。'
  const profile = (name, identity, primaryKeys) => ({
    ref: name, title: '[mvu_update]人物登记·' + name, primaryKeys,
    content: '# NPC首登登记·' + name + '\n身份：' + identity + '\n气血：860\n' + common
  })
  const render = rules([
    { ref: 'ordinary', title: '[mvu_update]日常规则', content: '普通结算规则' },
    profile('关含英', '振远镖局的女镖师', ['关镖师', '关娘子']),
    profile('关玉', '绣坊掌柜', ['关娘子']),
    profile('陈南', '车夫', ['陈车夫']),
    { ...profile('自定义', '掌柜', ['自定义']), content: '自定义登记在正文未提及的时候也应执行。' },
  ])
  const names = rendered => [...rendered.join('\n').matchAll(/^# NPC首登登记·(.+)$/gm)].map(match => match[1])
  const target = (text, NPC = {}, variableRetry = false) => ({
    message: { role: 'assistant', text, mvu: { variableRetry } }, messageId: 2, variables: { stat_data: { NPC } }
  })
  const chat = { cardPath: 'cards/rules.json', messages: [
    { role: 'assistant', text: '开场提到陈车夫。', greeting: true },
    { role: 'user', text: '我打算找陈车夫。' }
  ] }
  const surname = await render(chat, {}, target('振远镖局来招工。他往檐下一指，那位女镖师姓关。'))
  assert.deepEqual(names(surname), ['关含英'])
  assert.match(surname.join('\n'), /气血：860/)
  assert.equal(surname[0], '普通结算规则')
  assert.equal(surname.at(-1), '自定义登记在正文未提及的时候也应执行。')
  assert.deepEqual(names(await render(chat, {}, target('关娘子走进来。'))), ['关含英', '关玉'])
  assert.deepEqual(names(await render(chat, {}, target('关镖师笑了。', { 关含英: {} }))), [])
  const fallback = await render(chat, {}, target('她转身离开了。'))
  assert.deepEqual(names(fallback), ['关含英', '关玉', '陈南'])
  assert.equal(fallback.join('\n').split(common).length - 1, 1)
  assert.deepEqual(names(await render(chat, {}, target('关镖师笑了。', { 关含英: {} }, true))), ['关含英', '关玉', '陈南'])
  const continued = { ...chat, messages: [{ role: 'assistant', text: '关镖师进了亭子。' }, chat.messages[1]] }
  assert.deepEqual(names(await render(continued, {}, target('她转身离开了。'))), ['关含英'])
})

test('MVU settlement keeps card rules alongside separately bound and global books (#619)', async () => {
  const card = { name: '规则卡', character_book: { entries: [
    { id: 0, name: '[mvu_update]卡规则', content: '卡规则：接触阶段只能为独处/牵手/拥抱/接吻。', enabled: true },
    { id: 1, name: '[mvu_update]禁用规则', content: '禁用规则不得注入', enabled: false },
    { id: 2, name: '普通设定', content: '普通设定不得注入', enabled: true },
  ] } }
  let globals = true
  const worldBooks = createWorldBookLibrary({ normalizePath: value => value, removeStandalone: async () => {},
    cards: { read: async () => card }, resources: {
      bindingForCard: async () => ({ kind: 'standalone', path: 'local.json', available: true }),
      globalSources: async () => globals ? [{ kind: 'standalone', path: 'global.json' }] : [],
      readText: async path => JSON.stringify({ entries: { 0: { uid: 0, comment: '[mvu_update]外部规则', content: path === 'global.json' ? '全局规则' : '绑定规则' } } }),
    } })
  const render = createPlayWorldBook({ worldBooks, readOnlyTemplateRuntime: async () => runtime }).mvuUpdateRules
  const chat = { cardPath: 'cards/rules.json', messages: [] }
  const updateRules = await render(chat, card)
  assert.deepEqual(updateRules, [card.character_book.entries[0].content, '绑定规则', '全局规则'])
  let request
  const captured = new Error('captured settlement request')
  const settlement = createMvuSettlementModule({ model: { async run(input) { request = input; throw captured } },
    runtime: { async settleMvuUpdate() { assert.fail('Capturing the prompt must not execute an update') } } })
  await assert.rejects(settlement.settleVariables({ operationId: 'rules-619', chatId: 'chat', branchId: 'branch',
    basedOnRevision: 1, sessionId: 'game', messageId: 0, swipeId: 0, storyText: '本轮正文',
    currentVariables: { stat_data: {} }, updateRules }), error => error === captured)
  const prompt = request.turnContext
  const ruleStart = prompt.indexOf(PROMPT_PROSE.p002)
  assert.ok(ruleStart >= 0)
  const ruleSection = prompt.slice(ruleStart, prompt.indexOf(PROMPT_PROSE.p003, ruleStart))
  for (const rule of updateRules) assert.ok(ruleSection.includes(rule), rule)
  globals = false
  assert.deepEqual(await render(chat, card), [card.character_book.entries[0].content, '绑定规则'])
})
