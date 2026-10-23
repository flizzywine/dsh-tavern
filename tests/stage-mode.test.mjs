import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../tavern-plugin/src/client/features/stage-mode.js', import.meta.url), 'utf8')
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() })
const expand = node => typeof node?.type === 'function' ? expand(node.type({ ...node.props, children: node.children })) : node && typeof node === 'object' ? { ...node, children: (node.children || []).map(expand) } : node
const find = (node, test) => !node || typeof node !== 'object' ? null : test(node) ? node : (node.children || []).reduce((found, child) => found || find(child, test), null)
const all = (node, test, out = []) => { if (node && typeof node === 'object') { if (test(node)) out.push(node); (node.children || []).forEach(child => all(child, test, out)) } return out }
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? (node.children || []).map(text).join('') : ''
const settings = (dimensions = {}, beat = 6) => ({ stageDimensions: { scene: true, cast: true, acts: true, screenEffects: true, ...dimensions }, stageActionCaps: { beat } })

// The page's own states come first in call order (settings, error, attempt, caps, busy, save state); later hooks use their initial value.
function load({ states = [], calls = [], reply } = {}) {
  const queue = [...states]
  const React = { createElement: h, Fragment: 'Fragment', useState: init => [queue.length ? queue.shift() : init, () => {}], useRef: () => ({ current: null }), useEffect() {} }
  return vm.runInNewContext(source + '; ({ TavernStageModePage, TavernStageCapField, TAVERN_STAGE_MODE_HELP })', {
    React, JSON, Number, window: { dispatchEvent: event => calls.push(['event', event.type]) }, CustomEvent: class { constructor(type) { this.type = type } },
    rpc: async (method, args) => { calls.push([method, args]); return reply || { settings: settings() } },
    TavernAssetGlyph: 'Glyph', TavernAssetHelp: 'Help', TavernAssetAlert: 'Alert', TavernAssetLoading: 'Loading', tavernAssetErrorText: (error, fallback) => fallback
  })
}
const page = (stored, caps = stored.stageActionCaps, dirty = { current: null }, options = {}) => {
  const loaded = load({ states: [stored, '', 0, caps, false, ''], ...options })
  return { tree: expand(loaded.TavernStageModePage({ dirty })), dirty }
}

test('可用演出 lists the upstream director commands by group and saves a chip at once', async () => {
  const calls = []
  const { tree } = page(settings({ acts: false }), undefined, undefined, { calls })
  assert.deepEqual(all(tree, node => node.type === 'h3').map(text), ['可用演出', '每轮上限'])
  assert.equal(text(find(tree, node => node.props.className === 'dsh-tavern-mode-meta')), '3 / 4')
  const groups = all(tree, node => node.props.className === 'dsh-tavern-mode-group-toggle')
  assert.deepEqual(groups.map(group => [text(find(group, node => node.props.className === 'dsh-tavern-mode-group-name')), text(find(group, node => node.props.className === 'dsh-tavern-mode-group-state'))]),
    [['场景与转场', '全部'], ['人物', '部分 1/2'], ['效果', '全部']])
  assert.deepEqual(groups.map(group => group.props['aria-expanded']), [false, false, false], 'groups start folded')
  const chips = all(tree, node => node.props.role === 'checkbox')
  assert.deepEqual(chips.map(chip => [text(chip), chip.props['aria-checked']]), [['场景', true], ['出场', true], ['动作', false], ['画面效果', true]])
  assert.ok(all(tree, node => node.props.role === 'group').every(body => body.props.hidden === true), 'folded chips stay in the tree, hidden')
  await chips[2].props.onClick()
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['updateTavernSettings', { patch: { stageDimensions: { acts: true } } }], ['event', 'dsh-tavern-settings-changed']])
})

test('每轮上限 is a draft: 保存 is enabled only with a change, and Esc may leave only without one', async () => {
  const clean = page(settings())
  const button = find(clean.tree, node => node.type === 'button' && text(node) === '保存')
  assert.equal(button.props.disabled, true)
  assert.equal(clean.dirty.current, false)
  assert.equal(find(clean.tree, node => node.props.className === 'dsh-tavern-mode-foot').props['data-dirty'], undefined)
  const calls = [], changed = page(settings(), { beat: 3 }, undefined, { calls })
  const foot = find(changed.tree, node => node.props.className === 'dsh-tavern-mode-foot')
  assert.equal(foot.props['data-dirty'], true)
  assert.equal(text(foot), '有未保存的修改保存')
  assert.equal(changed.dirty.current, true)
  const field = find(changed.tree, node => node.type === 'input')
  assert.deepEqual([field.props['aria-label'], field.props.value], ['画面效果 每轮上限', '3'])
  await find(foot, node => node.type === 'button').props.onClick()
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['updateTavernSettings', { patch: { stageActionCaps: { beat: 3 } } }])
})

test('a cap joins the draft only as a whole number from 1 to 256; loading and a failed read have their own states', () => {
  const committed = [], { TavernStageCapField } = load()
  const input = () => find(expand(TavernStageCapField({ id: 'x', label: '画面效果', unit: '次', value: 6, onCommit: value => committed.push(value) })), node => node.type === 'input')
  for (const value of ['0', '257', '1.5', 'a', '']) input().props.onChange({ target: { value } })
  input().props.onChange({ target: { value: '12' } })
  assert.deepEqual(committed, [12])
  const loading = expand(load({ states: [null, '', 0] }).TavernStageModePage({}))
  assert.ok(find(loading, node => node.type === 'Loading'))
  const failed = expand(load({ states: [null, '读取舞台模式设置失败', 0] }).TavernStageModePage({}))
  const alert = find(failed, node => node.type === 'Alert')
  assert.equal(alert.props.error, '读取舞台模式设置失败')
  assert.equal(typeof alert.props.onReload, 'function', 'a failed read can be retried')
})
