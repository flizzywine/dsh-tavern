import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/modules/card-update-dialog.js', import.meta.url), 'utf8')
const file = (text, name) => Object.assign(new Blob([text]), { name })

// A shallow React: function components are called (state is the initial value), host elements kept as {type, props, children}.
const React = { useState: value => [value, () => {}], useEffect() {}, useRef: value => ({ current: value }), createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }) }
function render(node) {
  if (Array.isArray(node)) return node.map(render)
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') return render(node.type({ ...node.props, children: node.children }))
  return { ...node, props: { ...node.props, ...(node.props.head ? { head: render(node.props.head) } : {}), ...(node.props.foot ? { foot: render(node.props.foot) } : {}) }, children: node.children.map(render) }
}
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? [node.props.head, ...node.children, node.props.foot].map(text).join('') : node === null || node === undefined || node === false ? '' : String(node)
const find = (node, test) => !node || typeof node !== 'object' ? null : Array.isArray(node) ? node.map(item => find(item, test)).find(Boolean) || null
  : test(node) ? node : [node.props.head, ...node.children, node.props.foot].map(item => find(item, test)).find(Boolean) || null
const host = name => props => ({ type: name, props, children: [].concat(props.children ?? []) })
const api = vm.runInNewContext(source + ';({ readTavernCardUpdateMetadata, tavernCardUpdateMetadata, tavernCardPackDecisions, TavernCardUpdateDialog })', {
  React, TextDecoder, Uint8Array, atob,
  parseCardFile: async file => ({ kind: 'text', text: await file.text() }),
  Segmented: host('Segmented'), Spinner: host('Spinner'),
  // the pack previews need the stage pages; unbound, the list shows the names.
  usePackRevision() {}, galStageHold() {}, cardZipServiceReady: () => false, packClient: () => null, useCardPackBinding: () => null,
  packUi: { Modal: host('Modal'), Button: host('Button'), IconButton: host('IconButton'), stageScope: { use: () => false } },
})
const dialog = props => render(React.createElement(api.TavernCardUpdateDialog, props))
const packs = (choices, removed = []) => [
  { packId: 'a', title: '示例卡', choices, removed },
  { packId: 'b', title: '通用SE', choices, removed: [] },
]

test('a PNG or JSON card is read in the browser; an archive is left to the server', async () => {
  assert.equal((await api.readTavernCardUpdateMetadata(file(JSON.stringify({ name: 'Old', character_version: '0.6.0' }), 'old.json'))).version, '0.6.0')
  assert.equal(api.tavernCardUpdateMetadata({ data: { name: 'Unversioned' } }).version, '')
  await assert.rejects(api.readTavernCardUpdateMetadata({ name: 'big.json', size: 3 * 1024 * 1024 }), /更新时读取/)
  assert.deepEqual({ ...api.tavernCardPackDecisions(packs([]), 'merge') }, { a: 'merge', b: 'merge' })
})

test('update: card, 旧版本 → 新版本, the packs; 完全替换 lists what it removes, 增量更新 adds nothing', () => {
  const base = { current: { name: '示例卡', version: '11-15' }, incoming: { name: '示例卡', version: '11-17' }, file: { name: '示例卡.dshcard', size: 712 * 1024 * 1024 }, ready: true, pick() {} }
  const replace = dialog({ ...base, packs: packs(['update', 'merge', 'keep-both', 'cancel'], [{ kind: 'figures', id: 'f', name: '旧角色的配音' }]), way: 'update' })
  assert.equal(replace.props.title, '更新人物卡')
  const shown = text(replace)
  for (const part of ['11-15', '→', '11-17', '示例卡.dshcard · 712.0 MB', '更换', '素材包2', '通用SE', '以下旧版素材将被删除', '旧角色的配音', '取消', '更新']) assert.ok(shown.includes(part), part)
  assert.ok(find(replace, node => node.type === 'Segmented'), 'merge offered: the segmented choice shows')
  const merge = dialog({ ...base, packs: packs(['update', 'merge', 'keep-both', 'cancel'], [{ kind: 'figures', id: 'f', name: '旧角色的配音' }]), way: 'merge' })
  assert.ok(!text(merge).includes('以下旧版素材将被删除'))
  const only = dialog({ ...base, packs: packs(['update', 'keep-both', 'cancel']), way: 'update' })
  assert.equal(find(only, node => node.type === 'Segmented'), null, 'no merge: only 完全替换, no segmented choice')
  const plain = dialog({ ...base, packs: [], way: 'update' })
  assert.ok(!text(plain).includes('素材包'))
  assert.ok(!text(dialog({ ...base, incoming: { name: 'X', version: '' } })).includes('→'), 'no new version: no version line')
})

test('import, loading and the finished update with 撤回', () => {
  const imported = dialog({ mode: 'import', incoming: { name: '示例卡', version: '11-17' }, file: { name: 'k.dshcard', size: 1024 * 1024 }, packs: packs(['update', 'merge']), way: 'update', ready: true })
  assert.equal(imported.props.title, '导入人物卡')
  assert.ok(text(imported).includes('导入') && !text(imported).includes('更换'))
  assert.ok(find(dialog({ current: { name: 'A', version: '1' }, incoming: null, file: { name: 'a.dshcard', size: 1 } }), node => node.type === 'Spinner'))
  let reverted = false
  const done = dialog({ current: { name: '示例卡' }, result: { name: '示例卡', version: '11-17', updateId: 'u1' }, revert: () => { reverted = true } })
  assert.ok(text(done).includes('示例卡 已更新到 11-17'))
  find(done, node => node.type === 'Button' && text(node) === '撤回').props.onClick()
  assert.equal(reverted, true)
})
