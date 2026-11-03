import assert from 'node:assert/strict'
import test from 'node:test'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { registerCardReadingTools } from '../tavern-plugin/lib/tools/card-reading.js'

// the converter reads forms that only survive in the original import.
test('tavern_read_card_raw reads the original import on request, working version by default', async () => {
  const cardPreparation = createCardPreparation()
  const working = cardPreparation.create({ kind: 'import', payload: { spec: 'chara_card_v2', spec_version: '2.0', data: { name: '卡', first_mes: '改过的' } } })
  const originals = { 'cards/a.json': { kind: 'text', name: 'a.json', text: JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: '卡', first_mes: '<form>原版表单</form>' } }) } }
  let tool
  registerCardReadingTools({
    tools: { register(value) { if (value.name === 'tavern_read_card_raw') tool = value } },
    chatForSession: async () => ({ mode: 'card', cardPath: 'cards/a.json' }),
    str: value => String(value ?? ''), cardPreparation,
    fileResources: { originalCardPayload: async path => originals[path] ?? null },
    readCardWorkspace: async () => working,
  })
  const exec = { agent: { session: { id: 's' } } }
  assert.match((await tool.execute({ pointer: '/data/first_mes' }, exec)).text, /改过的/)
  assert.match((await tool.execute({ pointer: '/data/first_mes', source: 'original' }, exec)).text, /原版表单/)
  delete originals['cards/a.json']
  await assert.rejects(tool.execute({ source: 'original' }, exec), /没有保存导入原版/)
})