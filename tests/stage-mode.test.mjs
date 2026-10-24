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
const JUDGE = { enabled: true, provider: 'unset', model: '', baseUrl: '', keyName: '', threshold: 0.6, capPerKind: 8, timeoutMs: 1500, preamble: '' }
const settings = (dimensions = {}, beat = 6, judge = {}) => ({ stageDimensions: { scene: true, cast: true, acts: true, screenEffects: true, ...dimensions }, stageActionCaps: { beat }, stageJudge: { ...JUDGE, ...judge } })

// The page's own states come first in call order (settings, error, attempt, caps, judge, busy, save state); later hooks use their initial value.
function load({ states = [], calls = [], reply } = {}) {
  const queue = [...states]
  const React = { createElement: h, Fragment: 'Fragment', useState: init => [queue.length ? queue.shift() : init, () => {}], useRef: () => ({ current: null }), useEffect() {} }
  return vm.runInNewContext(source + '; ({ TavernStageModePage, TavernStageModeField, TavernJudgeFields, tavernCapValue, tavernJudgeWithProvider, tavernJudgeProblem, TAVERN_STAGE_MODE_HELP })', {
    React, JSON, Number, URL, window: { dispatchEvent: event => calls.push(['event', event.type]) }, CustomEvent: class { constructor(type) { this.type = type } },
    rpc: async (method, args) => { calls.push([method, args]); return reply || { settings: settings() } },
    TavernAssetGlyph: 'Glyph', TavernAssetHelp: 'Help', TavernAssetMenu: 'Menu', TavernAssetMenuItem: 'MenuItem', TavernAssetAlert: 'Alert', TavernAssetLoading: 'Loading', tavernAssetErrorText: (error, fallback) => fallback
  })
}
const page = (stored, caps = stored.stageActionCaps, dirty = { current: null }, options = {}, judge = stored.stageJudge) => {
  const loaded = load({ states: [stored, '', 0, caps, judge, false, ''], ...options })
  return { tree: expand(loaded.TavernStageModePage({ dirty })), dirty }
}

test('可用演出 lists the upstream director commands by group and saves a chip at once', async () => {
  const calls = []
  const { tree } = page(settings({ acts: false }), undefined, undefined, { calls })
  assert.deepEqual(all(tree, node => node.type === 'h3').map(text), ['判断模型', '可用演出', '每轮上限'])
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
  const field = find(changed.tree, node => node.type === 'input' && node.props['aria-label'] === '画面效果 每轮上限')
  assert.deepEqual([field.props['aria-label'], field.props.value], ['画面效果 每轮上限', '3'])
  await find(foot, node => node.type === 'button').props.onClick()
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['updateTavernSettings', { patch: { stageActionCaps: { beat: 3 }, stageJudge: JUDGE } }])
})

test('a cap joins the draft only as a whole number from 1 to 256; loading and a failed read have their own states', () => {
  const committed = [], { TavernStageModeField, tavernCapValue } = load()
  const input = () => find(expand(TavernStageModeField({ id: 'x', label: '画面效果', unit: '次', value: 6, parse: tavernCapValue, onCommit: value => committed.push(value) })), node => node.type === 'input')
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

test('判断模型 is first and part of the draft: a provider fills its model and key name, and a draft problem blocks 保存', async () => {
  const { tavernJudgeWithProvider, tavernJudgeProblem, TavernJudgeFields } = load()
  const jev = tavernJudgeWithProvider({ ...JUDGE, enabled: false }, 'jev')
  assert.deepEqual([jev.provider, jev.enabled, jev.model, jev.keyName, jev.baseUrl], ['jev', true, 'jev-1.13.0', 'TYPESAFE_API_KEY', ''])
  assert.deepEqual(JSON.parse(JSON.stringify(tavernJudgeWithProvider(jev, 'unset'))), { ...JUDGE, enabled: true })
  const compatible = tavernJudgeWithProvider(jev, 'openai-compatible')
  assert.equal(tavernJudgeProblem(compatible), '请填写接口地址')
  assert.equal(tavernJudgeProblem({ ...compatible, baseUrl: 'https://user@host/v1' }), '地址里不能带账号、参数或 #')
  assert.equal(tavernJudgeProblem({ ...compatible, baseUrl: 'https://host/v1' }), '')
  assert.equal(tavernJudgeProblem({ ...jev, model: ' ' }), '请填写模型')
  // Unset: only 提供方 and the tuning rows; no model, key or test.
  const labels = config => all(expand(TavernJudgeFields({ config, onPatch() {}, onSaveKey() {} })), node => node.props.className === 'dsh-tavern-mode-label').map(text)
  assert.deepEqual(labels(JUDGE).map(label => label.replace(/\?$/, '')), ['提供方', '门槛', '每类上限', '超时', '附加说明'])
  assert.deepEqual(labels(compatible), ['提供方', '接口地址', '模型', 'API Key', '门槛', '每类上限', '超时', '附加说明'])
  // A problem shows in the foot and keeps 保存 disabled; a valid draft saves 判断模型 with 每轮上限 in one patch.
  const broken = page(settings(), undefined, undefined, {}, compatible)
  const foot = find(broken.tree, node => node.props.className === 'dsh-tavern-mode-foot')
  assert.equal(text(foot), '请填写接口地址保存')
  assert.equal(find(foot, node => node.type === 'button').props.disabled, true)
  assert.equal(broken.dirty.current, true, 'Esc keeps the unsaved draft')
  const calls = [], ready = page(settings(), undefined, undefined, { calls }, jev)
  await find(find(ready.tree, node => node.props.className === 'dsh-tavern-mode-foot'), node => node.type === 'button').props.onClick()
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['updateTavernSettings', { patch: { stageActionCaps: { beat: 6 }, stageJudge: JSON.parse(JSON.stringify(jev)) } }])
})