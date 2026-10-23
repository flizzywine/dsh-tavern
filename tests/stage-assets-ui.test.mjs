import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../tavern-plugin/src/client/features/stage-assets.js', import.meta.url), 'utf8')
const h = (type, props, ...children) => ({ type, props: children.length ? { ...props, children: children.length === 1 ? children[0] : children } : props || {}, children: children.flat() })
const find = (node, test) => !node || typeof node !== 'object' ? null : test(node) ? node : (node.children || []).reduce((found, child) => found || find(child, test), null)
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? (node.children || []).map(text).join('') : ''
function load(context = {}) {
  const React = { createElement: h, Fragment: 'Fragment', useState: init => [typeof init === 'function' ? init() : init, () => {}], useRef: init => ({ current: init ?? null }), useEffect() {}, useLayoutEffect() {}, useCallback: fn => fn }
  return vm.runInNewContext(source + '; ({ tavernAssetErrorText, tavernTriggerLintText, tavernEntryLamp, tavernSetEntryLamp, tavernEntryWords, tavernOrderPacks, tavernAssetFileStem, tavernAssetNav, TavernEntryDetail, TavernPackStateTag, TAVERN_PACK_STATE_TITLES, TAVERN_ENTRY_LAMPS })', {
    React, Intl, console: { warn() {} }, window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }, CustomEvent: class {}, rpc: async () => ({}), ...context })
}

test('errors read as one player sentence; a refused trigger word keeps its reason and example', () => {
  const ui = load()
  assert.equal(ui.tavernAssetErrorText({ code: 'REVISION_CONFLICT', message: 'Expected revision x' }), '内容已被修改，请重新载入')
  assert.equal(ui.tavernAssetErrorText({ message: '素材包名称不能为空' }), '素材包名称不能为空')
  assert.equal(ui.tavernAssetErrorText({ message: 'ENOENT: something broke' }), '出错了，请稍后再试')
  const lint = { code: 'TRIGGER_LINT', message: '教室 [backgrounds/bg-1] 触发词「教室」违反 count：须有 3–6 个触发词。正例：教室、黑板、讲台。' }
  assert.equal(ui.tavernTriggerLintText(lint), '「教室」：须有 3–6 个触发词。例如：教室、黑板、讲台')
  assert.equal(ui.tavernTriggerLintText({ code: 'TRIGGER_LINT', message: '?' }), '触发词不符合要求，请填写能在正文中出现的简短词语，去掉重复或过于笼统的词后再保存')
  assert.equal(ui.tavernAssetFileStem('教室 白天.png'), '教室 白天')
})

test('the lamp is one of 蓝灯 / 绿灯 / 关闭; words replace the list and their synonyms follow them out', () => {
  const ui = load()
  const asset = { enabled: true, recall: { mode: 'keyword', keywords: ['离别', '毕业'], synonyms: { 离别: ['告别'], 毕业: ['卒业'] } } }
  assert.equal(ui.tavernEntryLamp(asset), 'keyword')
  assert.equal(ui.tavernEntryLamp({ ...asset, enabled: false }), 'off')
  assert.deepEqual(JSON.parse(JSON.stringify(ui.tavernSetEntryLamp({ ...asset, enabled: false }, 'constant').recall.mode)), 'constant')
  assert.equal(ui.tavernSetEntryLamp(asset, 'constant').enabled, true)
  assert.equal(ui.tavernSetEntryLamp(asset, 'off').recall.mode, 'keyword', 'off keeps the lamp it comes back to')
  assert.deepEqual(JSON.parse(JSON.stringify(ui.tavernEntryWords(asset, ['离别', '远行']).recall)), { mode: 'keyword', keywords: ['离别', '远行'], synonyms: { 离别: ['告别'] } })
  assert.equal(ui.tavernEntryWords(asset, []).recall.synonyms, undefined)
  assert.deepEqual(JSON.parse(JSON.stringify(ui.TAVERN_ENTRY_LAMPS)), { constant: '蓝灯', keyword: '绿灯', off: '关闭' })
  assert.deepEqual(JSON.parse(JSON.stringify(ui.TAVERN_PACK_STATE_TITLES)), { off: '关闭：不参与演出', card: '本卡：只在这张卡使用', global: '全局：所有卡都可使用' })
})

test('packs list 全局 first, then 本卡, then 关闭; each band by name, count or time', () => {
  const ui = load()
  const pack = (id, name, n, updatedAt) => [id, { manifest: { id, name, assets: Array.from({ length: n }, () => ({ kind: 'music' })) }, updatedAt }]
  const byId = new Map([pack('a', '乙', 1, 3), pack('b', '甲', 3, 1), pack('c', '丙', 2, 2), pack('d', '丁', 0, 4)])
  const rank = id => ({ c: 0, a: 1 })[id] ?? 2
  assert.deepEqual(ui.tavernOrderPacks(['a', 'b', 'c', 'd'], byId, rank, 'name'), ['c', 'a', 'd', 'b'])
  assert.deepEqual(ui.tavernOrderPacks(['a', 'b', 'c', 'd'], byId, rank, 'count', 'music'), ['c', 'a', 'b', 'd'])
  assert.deepEqual(ui.tavernOrderPacks(['a', 'b', 'c', 'd'], byId, rank, 'time'), ['c', 'a', 'd', 'b'])
})

test('the entry page: the name, the lamp row, then only the filled rows; empty ones wait as 「＋ 名称」 chips', () => {
  const ui = load({ openSceneImagePreview() {} })
  const pack = { manifest: { id: 'p', name: '校园' } }
  const asset = { kind: 'backgrounds', id: 'bg-1', name: '教室', enabled: true, recall: { mode: 'keyword', keywords: ['教室', '黑板', '讲台'] }, directorNote: '', media: 'h' }
  const audio = { state: null, toggle() {}, stop() {}, level() {} }
  const expand = node => typeof node?.type === 'function' && !['TavernAssetMenu', 'TavernAssetModal', 'TavernPackPicture', 'TavernTriggerChips', 'TavernAssetText'].includes(node.type.name) ? expand(node.type({ ...node.props })) : node && typeof node === 'object' ? { ...node, children: (node.children || []).map(expand) } : node
  const tree = expand(h(ui.TavernEntryDetail, { pack, asset, audio, commit: async () => {}, replace: async () => {}, remove: async () => {} }))
  const labels = []
  ;(function walk(node) { if (node && typeof node === 'object') { if (node.props.className === 'dsh-tavern-asset-field-label') labels.push(text(node.children[0])); (node.children || []).forEach(walk) } })(tree)
  assert.deepEqual(labels, ['触发策略', '触发词'])
  const adds = find(tree, node => node.props.className === 'dsh-tavern-asset-adds')
  assert.deepEqual(adds.children.map(chip => chip.props['aria-label']), ['添加导演说明', '添加备注'])
  assert.equal(find(tree, node => node.type?.name === 'TavernTriggerChips').props.words.length, 3)
})
