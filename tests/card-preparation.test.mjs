import assert from 'node:assert/strict'
import test from 'node:test'

import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'

function moduleUnderTest() {
  let sequence = 0
  return createCardPreparation({
    id: () => 'card-' + (++sequence),
    now: () => 123456
  })
}

test('SillyTavern v3 导入与导出共享字段政策，并保持 world book 内容', () => {
  const cards = moduleUnderTest()
  const imported = cards.create({
    kind: 'import',
    payload: {
      kind: 'text',
      text: JSON.stringify({
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: {
          name: '阿芙拉',
          description: '银发佣兵',
          tags: ['佣兵', ' 佣兵 ', '旅行'],
          alternate_greetings: ['你好', '你好', '雨夜见。'],
          character_book: {
            name: '黑麦镇',
            entries: [{ keys: ['钟楼'], content: '钟楼藏着线索。', enabled: true, extensions: { depth: 4 } }]
          }
        }
      })
    }
  })

  assert.equal(imported.id, 'card-1')
  assert.deepEqual(imported.tags, ['佣兵', '旅行'])
  const exported = cards.present({ card: imported, as: 'sillytavern-v3' })
  assert.equal(exported.spec, 'chara_card_v3')
  assert.equal(exported.data.name, '阿芙拉')
  assert.deepEqual(exported.data.character_book.entries[0].extensions, { depth: 4 })
})

test('手动编辑与对话式 patch 使用同一个 update interface', () => {
  const cards = moduleUnderTest()
  const original = cards.create({ kind: 'import', payload: { kind: 'text', text: '{"name":"旧名","description":"旧描述"}' } })
  const changed = cards.update({
    kind: 'card',
    card: original,
    patch: { name: '新名', description: '', tags: ['甲', '甲', ' 乙 '] },
    revision: { ts: 123456, instruction: '修改名字', summary: '对话更新' }
  })

  assert.equal(changed.card.name, '新名')
  assert.equal(changed.card.description, '')
  assert.deepEqual(changed.card.tags, ['甲', '乙'])
  assert.deepEqual(changed.changedFields.sort(), ['description', 'name', 'tags'])
  assert.equal(changed.card.revision_history.length, 1)
  assert.equal(original.name, '旧名')

  const unchanged = cards.update({ kind: 'card', card: changed.card, patch: { name: '新名' } })
  assert.equal(unchanged.changed, false)
  assert.deepEqual(unchanged.changedFields, [])
})

test('素材抽取 draft 的 player 不是人物卡字段，finalize 校验玩家与角色视角', () => {
  const cards = moduleUnderTest()
  const draftChange = cards.update({
    kind: 'draft',
    card: { name: '' },
    player: '',
    patch: { name: '阿芙拉', player: '旅行者', personality: '果断' }
  })
  assert.equal(draftChange.card.name, '阿芙拉')
  assert.equal(draftChange.player, '旅行者')
  assert.equal(draftChange.card.player, undefined)

  const finalized = cards.create({
    kind: 'extract',
    draft: draftChange.card,
    player: draftChange.player,
    sourceIds: ['src-1']
  })
  assert.match(finalized.creator_notes, /\[玩家\] 旅行者/)

  assert.throws(() => cards.create({ kind: 'extract', draft: { name: '阿芙拉' }, player: '', sourceIds: [] }), /玩家.*没有确认/)
  assert.throws(() => cards.create({ kind: 'extract', draft: { name: '阿芙拉', system_prompt: '你是阿芙拉' }, player: '旅行者', sourceIds: [] }), /第二人称|玩家身份冲突/)
})

test('未知 patch 字段明确失败，避免 Agent 输出被静默丢弃', () => {
  const cards = moduleUnderTest()
  const card = cards.create({ kind: 'import', payload: { kind: 'text', text: '{"name":"阿芙拉"}' } })
  assert.throws(() => cards.update({ kind: 'card', card, patch: { unknown_field: 'x' } }), /未知人物卡字段/)
})

test('对话投影只暴露可编辑人物卡字段', () => {
  const cards = moduleUnderTest()
  const card = cards.create({ kind: 'import', payload: { kind: 'text', text: '{"name":"阿芙拉","description":"佣兵"}' } })
  const editable = cards.present({ card, as: 'editable' })
  assert.equal(editable.name, '阿芙拉')
  assert.equal(editable.description, '佣兵')
  assert.equal(editable.id, undefined)
  assert.equal(editable.importedAt, undefined)
})
