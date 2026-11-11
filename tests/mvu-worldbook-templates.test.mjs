import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlayWorldBook } from '../tavern-plugin/lib/domain/play-world-book.js'
import { UpstreamTemplateRuntime } from './fixtures/upstream-template-runtime.mjs'
import { createWorldBookLibrary } from '../tavern-plugin/lib/domain/worldbook-library.js'
import { createMvuSettlementModule, PROMPT_PROSE } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
const runtime = await UpstreamTemplateRuntime.create()
const entry = (ref, content, extra = {}) => ({ ref, comment: '[mvu_update]' + ref, enabled: true, content, ...extra })
const rules = entries => createPlayWorldBook({ worldBooks: { bound: async () => ({ view: { entries } }) }, runtime: async () => runtime }).mvuUpdateRules

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
  const render = createPlayWorldBook({ worldBooks, runtime: async () => runtime }).mvuUpdateRules
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

test('MVU renders current input and conditional rules against settlement baseline, excluding other controllers', async () => {
  const entries = [entry('plain', '角色：{{char}}'),
    entry('input', '<%- lastUserMessage %>'),
    entry('signal', "<% if (Array.isArray(getMessageVar('stat_data.事件.信号'))) { %>信号规则<% } %>"),
    entry('disabled', '<% throw new Error("disabled") %>', { enabled: false }),
    entry('ordinary', '<% throw new Error("ordinary") %>', { comment: '普通动态', constant: true })]
  const chat = { messages: [{ role: 'user', text: '查看公会任务' }, { role: 'assistant', text: '任务列表', variables: [{ stat_data: { 事件: { 信号: [] } } }] }] }
  const render = rules(entries)
  const absent = await render(chat, { name: '命定之诗' }, { variables: { stat_data: { 事件: {} } } })
  assert.deepEqual(absent.sort(), ['角色：命定之诗', '查看公会任务'].sort())
  const present = await render(chat, { name: '命定之诗' }, { variables: { stat_data: { 事件: { 信号: [] } } } })
  assert.deepEqual(present.sort(), ['角色：命定之诗', '查看公会任务', '信号规则'].sort())
})
test('MVU template failure stops settlement instead of silently dropping rules or forwarding EJS', async () => {
  await assert.rejects(rules([entry('broken', '<% throw new Error("broken") %>')])({ messages: [] }, {}), /MVU 更新规则模板执行失败/)
})

test('MVU embedded rules accept object entries and deduplicate already bound content', async () => {
  const card = { character_book: { entries: {
    0: { uid: 0, comment: '[mvu_update]卡规则', content: '共同规则', disable: false },
    1: { uid: 1, comment: '[mvu_update]禁用', content: '禁用内容', disable: true },
    2: { uid: 2, comment: '[mvu_update]空白', content: '  ' },
  } } }
  assert.deepEqual(await rules([entry('same', ' 共同规则 '), entry('external', '独立规则')])({}, card), ['共同规则', '独立规则'])
  assert.deepEqual(await rules([])({}, card), ['共同规则'])
})

test('MVU embedded templates render against settlement variables with independent refs', async () => {
  const card = { name: '规则卡', character_book: { entries: [
    { id: 0, name: '[mvu_update]卡模板', enabled: true, content: "<% if (getMessageVar('stat_data.阶段') === '牵手') { %>{{char}}：本轮最多增加五点。<% } %>" },
    { id: 1, name: '普通控制器', enabled: true, content: '<% throw new Error("ordinary embedded controller") %>' },
  ] } }
  const render = rules([entry('entry:0', '<%- lastUserMessage %>')])
  assert.deepEqual((await render({ messages: [{ role: 'user', text: '玩家输入' }] }, card,
    { variables: { stat_data: { 阶段: '牵手' } } })).sort(), ['规则卡：本轮最多增加五点。', '玩家输入'].sort())
  card.character_book.entries[0].content = '<% throw new Error("broken embedded rule") %>'
  await assert.rejects(render({ messages: [] }, card), /MVU 更新规则模板执行失败.*card-mvu:/)
})
