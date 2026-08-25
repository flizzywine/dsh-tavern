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

  assert.equal(imported.meta.id, 'card-1')
  assert.deepEqual(cards.project(imported).tags, ['佣兵', '旅行'])
  const exported = cards.present({ card: imported, as: 'sillytavern-v3' })
  assert.equal(exported.spec, 'chara_card_v3')
  assert.equal(exported.data.name, '阿芙拉')
  assert.deepEqual(exported.data.character_book.entries[0].extensions, { depth: 4 })
})

test('人物卡工作 raw 在普通字段修改后仍保留 user 和 char 宏', () => {
  const cards = moduleUnderTest()
  const workspace = cards.create({
    kind: 'import',
    payload: {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: { name: '测试卡', description: '{{char}} 看向 {{user}}。旧描述。' }
    }
  })
  const changed = cards.update({
    kind: 'card',
    card: workspace,
    patch: { description: '{{char}} 看向 {{user}}。新描述。' }
  })

  assert.equal(changed.card.raw.data.description, '{{char}} 看向 {{user}}。新描述。')
  assert.equal(cards.present({ card: changed.card, as: 'raw' }).data.description, '{{char}} 看向 {{user}}。新描述。')
})

test('完整 raw 是可编辑工作数据，未知扩展在投影、修改和导出后保持不变', () => {
  const cards = moduleUnderTest()
  const source = {
    spec: 'chara_card_v3',
    spec_version: '3.1',
    future_root: { enabled: true },
    data: {
      name: '阿芙拉',
      description: '旧描述',
      future_field: ['保留'],
      extensions: {
        regex_scripts: [{ scriptName: '状态栏', findRegex: '/<status>(.*?)<\\/status>/s', replaceString: '<aside>$1</aside>' }],
        mvu: { version: 7 }
      }
    }
  }
  const workspace = cards.create({ kind: 'import', payload: { kind: 'text', text: JSON.stringify(source) } })
  const changed = cards.update({ kind: 'card', card: workspace, patch: { description: '新描述' } })
  const exported = cards.present({ card: changed.card, as: 'raw' })

  assert.equal(changed.view.description, '新描述')
  assert.equal(exported.spec_version, '3.1')
  assert.deepEqual(exported.future_root, { enabled: true })
  assert.deepEqual(exported.data.future_field, ['保留'])
  assert.deepEqual(exported.data.extensions, source.data.extensions)
})

test('人物卡详情用稳定投影展示字段，同时从完整工作 raw 解析扩展', () => {
  const cards = moduleUnderTest()
  const workspace = cards.create({
    kind: 'import',
    payload: {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: '命运',
        description: '稳定字段',
        extensions: {
          regex_scripts: [{ scriptName: '状态栏', findRegex: '/<status>/', replaceString: '<aside>' }],
          depth_prompt: { depth: 4, role: 'system', prompt: '保持设定' }
        }
      }
    }
  })

  const detail = cards.present({ card: workspace, as: 'detail' })

  assert.equal(detail.name, '命运')
  assert.equal(detail.description, '稳定字段')
  assert.equal(detail.extensions.regexScripts.length, 1)
  assert.deepEqual(detail.extensions.otherExtensions.map((item) => item.name), ['depth_prompt'])
})

test('raw 扩展按 JSON Pointer 分段读取并做最小修改', () => {
  const cards = moduleUnderTest()
  const workspace = cards.create({
    kind: 'import',
    payload: { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '阿芙拉', extensions: { regex_scripts: [{ scriptName: '状态栏', disabled: false }] } } }
  })
  const section = cards.present({ card: workspace, as: 'raw-section', pointer: '/data/extensions/regex_scripts', limit: 40 })
  assert.equal(section.pointer, '/data/extensions/regex_scripts')
  assert.equal(section.from, 1)
  assert.equal(section.done, false)
  assert.match(section.text, /状态栏/)

  const changed = cards.update({
    kind: 'card', card: workspace, patch: {},
    rawOperations: [
      { op: 'set', path: '/data/extensions/regex_scripts/0/disabled', value: true },
      { op: 'set', path: '/data/extensions/mvu', value: { version: 1 } }
    ]
  })
  assert.deepEqual(changed.changedFields, [
    'raw:/data/extensions/regex_scripts/0/disabled',
    'raw:/data/extensions/mvu'
  ])
  assert.equal(changed.card.raw.data.extensions.regex_scripts[0].disabled, true)
  assert.deepEqual(changed.card.raw.data.extensions.mvu, { version: 1 })
  assert.throws(() => cards.update({ kind: 'card', card: workspace, patch: {}, rawOperations: [{ op: 'set', path: '/__proto__/polluted', value: true }] }), /不安全字段/)
  assert.throws(() => cards.update({
    kind: 'card', card: workspace, patch: {},
    rawOperations: [{ op: 'set', path: '/data/character_book/entries/0/content', value: '绕过专用接口' }]
  }), /世界书只能通过 tavern_update_worldbook 修改/)
})

test('旧平面工作版迁移时以原版 raw 为底，并合并用户已修改字段', () => {
  const cards = moduleUnderTest()
  const original = {
    spec: 'chara_card_v3', spec_version: '3.0',
    data: { name: '原名', description: '原始描述', extensions: { regex_scripts: [{ scriptName: '保留' }] } }
  }
  const migrated = cards.migrate({
    working: { name: '新名字', description: '用户修改', importedAt: 100, revision_history: [{ summary: '旧记录' }] },
    payload: { kind: 'text', text: JSON.stringify(original) }
  })

  assert.equal(cards.project(migrated).name, '新名字')
  assert.equal(migrated.raw.data.description, '用户修改')
  assert.deepEqual(migrated.raw.data.extensions, original.data.extensions)
  assert.equal(migrated.meta.importedAt, 100)
  assert.deepEqual(migrated.meta.revisionHistory, [{ summary: '旧记录' }])
})

test('旧导入器的数组截断和 UI 投影回传不会覆盖完整 raw', () => {
  const cards = moduleUnderTest()
  const tags = Array.from({ length: 35 }, (_item, index) => '标签' + index)
  const greetings = Array.from({ length: 25 }, (_item, index) => '开场' + index)
  const original = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '阿芙拉', tags, alternate_greetings: greetings } }
  const migrated = cards.migrate({
    working: { name: '阿芙拉', tags: tags.slice(0, 30), alternate_greetings: greetings.slice(0, 20) },
    payload: { kind: 'text', text: JSON.stringify(original) }
  })
  assert.deepEqual(migrated.raw.data.tags, tags)
  assert.deepEqual(migrated.raw.data.alternate_greetings, greetings)

  const view = cards.project(migrated)
  const unchanged = cards.update({ kind: 'card', card: migrated, patch: { tags: view.tags, alternate_greetings: view.alternate_greetings } })
  assert.equal(unchanged.changed, false)
  assert.deepEqual(unchanged.card.raw.data.tags, tags)
  assert.deepEqual(unchanged.card.raw.data.alternate_greetings, greetings)
})

test('世界书常驻上下文只暴露目录，正文按编号或关键词读取', () => {
  const cards = moduleUnderTest()
  const card = cards.create({
    kind: 'import',
    payload: {
      name: '阿芙拉',
      character_book: {
        name: '黑麦镇',
        entries: [
          { keys: ['钟楼'], content: '钟楼藏着失踪商队的线索。', enabled: true, constant: false },
          { keys: ['废案'], content: '这条设定已经停用。', enabled: false, constant: true },
          { keys: ['酒馆'], content: '吧台下面藏着一把短弩。', enabled: true, constant: true }
        ]
      }
    }
  })

  const overview = cards.present({ card, as: 'world-book-overview' })
  assert.equal(overview.entryCount, 2)
  assert.deepEqual(overview.entries[0], {
    ref: 'entry:0', keys: ['钟楼'], comment: '', enabled: true, constant: false, chars: 12
  })
  assert.deepEqual(overview.entries.map((entry) => entry.ref), ['entry:0', 'entry:2'])
  assert.equal(JSON.stringify(overview).includes('失踪商队'), false)

  const window = cards.present({ card, as: 'world-book-window', ref: 'entry:2' })
  assert.equal(window.total, 2)
  assert.equal(window.entries[0].ref, 'entry:2')
  assert.equal(window.entries[0].entry.content, '吧台下面藏着一把短弩。')
  assert.equal(cards.present({ card, as: 'world-book-window', query: '失踪商队', limit: 1 }).entries[0].ref, 'entry:0')
  assert.deepEqual(cards.present({ card, as: 'world-book-window', ref: 'entry:1' }).entries, [])
})

test('世界书按条目合并修改，不要求模型重传整本世界书', () => {
  const cards = moduleUnderTest()
  const card = cards.create({
    kind: 'import',
    payload: {
      name: '阿芙拉',
      character_book: {
        name: '旧世界书',
        entries: [
          { keys: ['钟楼'], content: '旧线索', enabled: true, extensions: { depth: 4 } },
          { keys: ['酒馆'], content: '保持不变', enabled: true }
        ]
      }
    }
  })

  const changed = cards.update({
    kind: 'card',
    card,
    patch: {},
    worldBookOperations: [
      { op: 'rename', name: '新世界书' },
      { op: 'update', ref: 'entry:0', patch: { content: '新线索' } },
      { op: 'add', entry: { keys: ['水道'], content: '新的入口', enabled: true } }
    ]
  })

  assert.equal(changed.changed, true)
  assert.deepEqual(changed.changedFields, ['character_book'])
  assert.equal(changed.view.character_book.name, '新世界书')
  assert.equal(changed.view.character_book.entries[0].content, '新线索')
  assert.deepEqual(changed.view.character_book.entries[0].extensions, { depth: 4 })
  assert.equal(changed.view.character_book.entries[1].content, '保持不变')
  assert.equal(changed.view.character_book.entries[2].content, '新的入口')

  const removed = cards.update({ kind: 'card', card: changed.card, patch: {}, worldBookOperations: { op: 'delete', ref: 'entry:1' } })
  assert.deepEqual(removed.view.character_book.entries.map((entry) => entry.content), ['新线索', '新的入口'])
  assert.throws(() => cards.update({ kind: 'card', card, patch: {}, worldBookOperations: { op: 'update', ref: 'entry:9', patch: { content: 'x' } } }), /世界书条目不存在/)
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

  assert.equal(changed.view.name, '新名')
  assert.equal(changed.view.description, '')
  assert.deepEqual(changed.view.tags, ['甲', '乙'])
  assert.deepEqual(changed.changedFields.sort(), ['description', 'name', 'tags'])
  assert.equal(changed.card.meta.revisionHistory.length, 1)
  assert.equal(cards.project(original).name, '旧名')

  const unchanged = cards.update({ kind: 'card', card: changed.card, patch: { name: '新名' } })
  assert.equal(unchanged.changed, false)
  assert.deepEqual(unchanged.changedFields, [])
})

test('卡片工作台草稿的 player 不是人物卡字段，保存时校验玩家与角色视角', () => {
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
    kind: 'draft',
    draft: draftChange.card,
    player: draftChange.player,
    sourceIds: ['src-1']
  })
  assert.match(cards.project(finalized).creator_notes, /\[玩家\] 旅行者/)

  assert.throws(() => cards.create({ kind: 'draft', draft: { name: '阿芙拉' }, player: '', sourceIds: [] }), /玩家.*没有确认/)
  assert.throws(() => cards.create({ kind: 'draft', draft: { name: '阿芙拉', system_prompt: '你是阿芙拉' }, player: '旅行者', sourceIds: [] }), /第二人称|玩家身份冲突/)
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
