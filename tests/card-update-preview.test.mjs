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
