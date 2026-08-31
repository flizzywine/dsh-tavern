import test from 'node:test'
import assert from 'node:assert/strict'
import { sceneStateSources } from '../tavern-plugin/lib/domain/scene-state.js'
import { sceneTarget, sceneInput } from '../tavern-plugin/lib/domain/scene-illustration.js'

function fixture(data) {
  const chat = { id: 'state-chat', settleStatus: 'done', _storageRevision: 12, messages: [{ role: 'assistant', turn: 2,
    swipes: ['林岚和 Alice 站在窗边。', '另一个开场。'], swipeId: 0, mvu: { pending: false }, variables: [{ stat_data: data }] }] }
  return { chat, target: sceneTarget(chat, 2) }
}

test('visual state selects present identities and scene facts, never schema/mirrors/off-stage people or unrelated stats', () => {
  const { chat, target } = fixture({
    人物: { 林岚: { 外貌: '黑色短发', 服饰: { 上装: '青色外套', 下装: '长裙' }, 当前行动: '左手扶窗', 好感度: 90,
      心理活动: '不发送的想法', 朋友: { 另一个人: { 服装: '朋友的衣服' } }, schema: { 服装: '结构规则' }, $meta: { template: { 服装: '模板值' } } },
      无关角色: { 服装: '后台角色秘密服装', 位置: '远方' } },
    characters: [{ name: 'Alice', outfit: { name: 'blue jacket', color: 'navy blue' }, expression: 'smiling' }, { name: 'Malice', outfit: 'not Alice clothing' }],
    场景: { 名称: '车站环境', 地点: '旧车站', 时间: '夜晚', 天气: '小雨', 温度: 22 },
    schema: { 场景: { 地点: '全量定义' } }, delta_data: { 林岚: { 衣着: '变化记录' } }, display_data: { 天气: '镜像' },
    description: '不是场景的整卡说明'
  })
  chat.messages[0].variables[0].schema = { secret: 'top schema' }
  const before = structuredClone(chat)
  const result = sceneStateSources(chat, target, target.source)
  const text = JSON.stringify(result.sources)
  for (const word of ['黑色短发', '青色外套', '长裙', '左手扶窗', 'blue jacket', 'navy blue', 'smiling', '旧车站', '夜晚', '小雨']) assert.ok(text.includes(word), word)
  for (const word of ['不发送', '后台角色', '朋友的衣服', '结构规则', '模板值', '全量定义', '变化记录', '镜像', '整卡说明', 'not Alice', 'top schema', '好感度']) assert.ok(!text.includes(word), word)
  assert.ok(result.sources.every(source => source.origin.kind === 'mvu-state' && source.origin.bodyDigest === target.sourceDigest && source.origin.storageRevision === 12))
  assert.deepEqual(chat, before)
})

test('state is bound to selected body and readiness; missing old state never uses future variables', () => {
  const { chat, target } = fixture({ 林岚: { 衣着: '过去青衣' } })
  const history = structuredClone(chat)
  chat.messages.push({ role: 'assistant', turn: 3, text: '未来剧情。', variables: [{ stat_data: { 林岚: { 衣着: '未来红衣' } } }] })
  assert.equal(sceneInput(chat, target).state.sources.length, 0)
  assert.match(JSON.stringify(sceneInput(chat, target, history).state.sources), /过去青衣/)
  assert.doesNotMatch(JSON.stringify(sceneInput(chat, target, history)), /未来红衣/)
  for (const alter of [
    draft => { draft.settleStatus = 'running' },
    draft => { draft.mvu = { enabled: false } },
    draft => { draft.messages[0].mvu.pending = true },
    draft => { draft.messages[0].mvu.receipt = { status: 'partial' } },
    draft => { draft.messages[0].swipeId = 1 },
    draft => { draft.messages[0].swipes[0] = '重写的正文' }
  ]) {
    const changed = structuredClone(history); alter(changed)
    assert.equal(sceneStateSources(changed, target, target.source).sources.length, 0)
  }
})

test('state projection is bounded, omits markup and unknown formats, and preserves literal provenance', () => {
  const { chat, target } = fixture({ 林岚: { 服装: { unknown: ['青衣', '旧格式说明'], html: '<script>secret</script>', unset: '未明确',
    ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['衣物' + i, '衣'.repeat(100)])) } }, 环境: { 地点: '窗/边~角落' } })
  const result = sceneStateSources(chat, target, target.source)
  assert.ok(result.sources.reduce((n, source) => n + source.text.length + 2, 0) <= 2400)
  assert.ok(result.sources.length <= 40)
  assert.ok(result.omitted.some(item => item.reason === 'scene-state-budget'))
  assert.doesNotMatch(JSON.stringify(result.sources), /script|旧格式说明|未明确/)
  const small = fixture({ 林岚: { 服装: { '衣物/~': '青衣' } } })
  assert.equal(sceneStateSources(small.chat, small.target, small.target.source).sources[0].origin.path, '/stat_data/林岚/服装/衣物~1~0')
  const changed = structuredClone(small.chat)
  changed.messages[0].variables[0].stat_data.林岚.服装['衣物/~'] = '红衣'
  assert.notEqual(sceneStateSources(changed, small.target, small.target.source).sources[0].id,
    sceneStateSources(small.chat, small.target, small.target.source).sources[0].id)
})

test('scan bounds protect large unknown trees and numerically dense state without returning them', () => {
  const { chat, target } = fixture({ 数组: Array.from({ length: 20000 }, (_, n) => n), 林岚: { 服装: '晚到字段' } })
  const result = sceneStateSources(chat, target, target.source)
  assert.equal(result.sources.length, 0)
  assert.ok(result.omitted.some(item => item.reason === 'scene-state-scan-budget'))
})
