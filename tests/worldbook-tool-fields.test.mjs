import test from 'node:test'
import assert from 'node:assert/strict'
import { registerWorldbookTools } from '../tavern-plugin/lib/tools/worldbook.js'

function setup() {
  const registered = new Map(), calls = []
  registerWorldbookTools({
    chatForSession: async () => ({ mode: 'card', cardPath: 'cards/甲.json' }),
    checkCard: async (_chat, path) => { calls.push({ checked: path }); return { valid: true, errors: [], warnings: [{ path: '/data', message: '提醒' }] } },
    readChatCard: async () => undefined,
    str: value => value == null ? '' : String(value),
    tools: { register: tool => registered.set(tool.name, tool) },
    worldBooks: { update: async (source, request) => { calls.push({ source, request }); return { view: { displayName: '甲', entryCount: 1 } } } }
  })
  const exec = { agent: { session: { id: 's1' } } }
  return { run: args => registered.get('tavern_update_worldbook').execute(args, exec), calls, tool: registered.get('tavern_update_worldbook') }
}

test('世界书条目接受 SillyTavern 常用写法，不认识的字段报错而不是静默丢弃', async () => {
  const { run, calls } = setup()
  await run({ operations: [{ op: 'add', entry: { comment: '时局', content: '1936', keys: ['上海'], disable: true } }] })
  assert.deepEqual(calls[0].request.operations[0].entry, { comment: '时局', content: '1936', primaryKeys: ['上海'], enabled: false })
  await assert.rejects(run({ operations: [{ op: 'update', ref: 'entry:0', patch: { tag: 'x' } }] }), /不认识字段 tag/)
  assert.equal(calls.length, 2)
})

test('修改人物卡内置世界书时结果附带整卡校验，独立世界书不做人物卡校验', async () => {
  const { run, calls, tool } = setup()
  const inCard = await run({ operations: [{ op: 'update', ref: 'entry:0', patch: { content: '新' } }] })
  assert.equal(calls[1].checked, 'cards/甲.json')
  assert.equal(inCard.validation.valid, true)
  assert.match(tool.output.render({}, inCard)[0].text, /格式校验：通过，1 个提醒\n- 提醒 \/data：提醒/)
  const standalone = await run({ path: 'worldbooks/乙.json', operations: [{ op: 'update', ref: 'entry:0', patch: { content: '新' } }] })
  assert.equal(standalone.validation, undefined)
  assert.equal(calls.length, 3)
})

test('读世界书只给模型正文原文和已设置的字段，不重复原始条目', () => {
  const registered = new Map()
  registerWorldbookTools({ chatForSession: async () => ({}), checkCard: async () => null, readChatCard: async () => undefined, str: String, tools: { register: tool => registered.set(tool.name, tool) }, worldBooks: {} })
  const entry = { ref: 'entry:3', sourceUid: 9, sourcePath: 'entries/3', title: '货币', comment: '货币', content: '第一行\n"第二行"', enabled: true, primaryKeys: ['钱'], secondaryKeys: [], depth: null, group: '', rawEntry: { content: '第一行\n"第二行"' } }
  const text = registered.get('tavern_read_worldbook').output.render({}, { found: true, message: '', name: '书', total: 4, entries: [{ ref: 'entry:3', entry }] })[0].text
  assert.equal(text, '世界书《书》· 共 4 条\n\n[entry:3] 货币\n设置：{"enabled":true,"primaryKeys":["钱"]}\n正文：\n第一行\n"第二行"')
})
