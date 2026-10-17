import assert from 'node:assert/strict'
import test from 'node:test'

import { registerCardEditingTools } from '../tavern-plugin/lib/tools/card-editing.js'

const card = () => ({
  spec: 'chara_card_v3', description: '集市（根部镜像）',
  data: {
    description: '在集市里交易。', alternate_greetings: ['无', '去集市'], tags: ['集市'],
    character_book: { entries: [{ comment: '组织-集市', keys: ['集市', '市场'], content: '集市开门。$&' }, { comment: '无关', keys: [], content: '无' }] },
    extensions: { regex_scripts: [{ scriptName: '面板', replaceString: '<b>集市</b>' }] }
  }
})

test('替换工具保存后报告剩余处数与校验，处数不符时不写入', async () => {
  let current = { kind: 'dsh-tavern-character-workspace', version: 1, raw: card(), meta: {} }
  const saves = [], tools = new Map()
  registerCardEditingTools({
    activeTurnOf: () => 3,
    cardPreparation: { raw: workspace => workspace.raw },
    chatForSession: async () => ({ mode: 'card', cardPath: 'cards/甲.json' }),
    checkCard: async () => ({ valid: true, errors: [], warnings: [] }),
    readCardWorkspace: async () => structuredClone(current),
    restoreCurrentCard: async () => {}, str: value => value == null ? '' : String(value),
    tools: { register: tool => tools.set(tool.name, tool) },
    turnOrchestrator: { saveChanges: async input => { saves.push(input); Object.assign(current.raw.data, input.fields); for (const op of input.rawOperations) current.raw.data.extensions.regex_scripts[0].replaceString = op.value; return { saved: true } } },
    worldBooks: { update: async (source, request) => { saves.push({ source, request }); Object.assign(current.raw.data.character_book.entries[0], { comment: request.operations[0].patch.comment, keys: request.operations[0].patch.primaryKeys, content: request.operations[0].patch.content }) } }
  })
  const tool = tools.get('tavern_replace_card_text'), exec = { agent: { session: { id: 's' } } }
  await assert.rejects(tool.execute({ find: '集市', replace: '墟', expectedCount: 3 }, exec), /预期 3 处，实际 7 处，未修改/)
  assert.equal(saves.length, 0)
  const result = await tool.execute({ find: '集市', replace: '墟', expectedCount: 7 }, exec)
  assert.equal(saves[0].turn, 3)
  assert.deepEqual(saves[1].source, { kind: 'card', cardPath: 'cards/甲.json' })
  assert.equal(result.replaced, 7)
  assert.equal(result.remaining, 0)
  assert.match(tool.output.render({}, result)[0].text, /替换 7 处，全卡剩余 0 处[\s\S]*格式校验：通过/)
})
