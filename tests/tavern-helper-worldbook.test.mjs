import assert from 'node:assert/strict'
import test from 'node:test'

import {
  projectTavernHelperWorldbook,
  replaceTavernHelperWorldbookOperations
} from '../tavern-plugin/lib/domain/tavern-helper-worldbook.js'

function view() {
  return {
    displayName: '灯火阑珊世界书',
    entries: [{
      ref: 'entry:3', sourceUid: 9, title: '[地图]神州', comment: '[地图]神州', content: '神州资料', enabled: true,
      primaryKeys: ['神州'], secondaryKeys: ['城镇'], constant: false, selective: true, selectiveLogic: 0,
      vectorized: false, order: 120, position: 'after_char', depth: 4, role: 0, probability: 100,
      excludeRecursion: false, preventRecursion: true, delayUntilRecursion: 0, sticky: null, cooldown: null, delay: null
    }]
  }
}

test('世界书投影为 Tavern Helper 的稳定条目结构', function () {
  const projected = projectTavernHelperWorldbook(view())
  assert.equal(projected.name, '灯火阑珊世界书')
  assert.deepEqual(projected.entries[0], {
    uid: 9,
    name: '[地图]神州',
    enabled: true,
    strategy: {
      type: 'selective',
      keys: ['神州'],
      keys_secondary: { logic: 'and_any', keys: ['城镇'] },
      scan_depth: 'same_as_global'
    },
    position: { type: 'after_character_definition', role: 'system', depth: 4, order: 120 },
    content: '神州资料',
    probability: 100,
    recursion: { prevent_incoming: false, prevent_outgoing: true, delay_until: null },
    effect: { sticky: null, cooldown: null, delay: null },
    extra: { displayIndex: 0, caseSensitive: null, matchWholeWords: null, group: '', dsh_tavern_ref: 'entry:3' }
  })
})

test('世界书位置与角色编号遵循 Tavern Helper 上游定义', function () {
  const source = view()
  source.entries = [
    { ...source.entries[0], ref: 'entry:0', sourceUid: 0, position: 0, role: 0 },
    { ...source.entries[0], ref: 'entry:1', sourceUid: 1, position: 1, role: 1 },
    { ...source.entries[0], ref: 'entry:2', sourceUid: 2, position: 4, role: 2 },
    { ...source.entries[0], ref: 'entry:3', sourceUid: 3, position: 7, role: null }
  ]
  assert.deepEqual(projectTavernHelperWorldbook(source).entries.map(function (entry) {
    return [entry.position.type, entry.position.role]
  }), [
    ['before_character_definition', 'system'],
    ['after_character_definition', 'user'],
    ['at_depth', 'assistant'],
    ['outlet', 'system']
  ])
})

test('非 constant 条目默认投影为 selective，关闭概率时固定为百分百', function () {
  const source = view()
  source.entries[0].constant = false
  source.entries[0].selective = false
  source.entries[0].probabilityEnabled = false
  source.entries[0].probability = 20
  const entry = projectTavernHelperWorldbook(source).entries[0]
  assert.equal(entry.strategy.type, 'selective')
  assert.equal(entry.probability, 100)
})

test('人物卡脚本按 uid 更新条目并生成明确的增删操作', function () {
  const projected = projectTavernHelperWorldbook(view())
  const requested = structuredClone(projected.entries)
  requested[0].enabled = false
  requested[0].content = '新资料'
  requested[0].strategy.type = 'constant'
  assert.deepEqual(replaceTavernHelperWorldbookOperations(view(), requested), [{
    op: 'update', ref: 'entry:3', patch: { content: '新资料', enabled: false, constant: true, selective: false, vectorized: false }
  }])
  assert.deepEqual(replaceTavernHelperWorldbookOperations(view(), []), [{ op: 'delete', ref: 'entry:3' }])
  const replaced = replaceTavernHelperWorldbookOperations(view(), [{ ...requested[0], uid: 10 }])
  assert.equal(replaced[0].op, 'add')
  assert.equal(replaced[0].uid, 10)
  assert.deepEqual(replaced[1], { op: 'delete', ref: 'entry:3' })
  assert.throws(() => replaceTavernHelperWorldbookOperations(view(), [requested[0], requested[0]]), /编号无效或重复/)
})
