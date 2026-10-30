import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const groups = source.slice(source.indexOf('function groupWorldBookEditorEntries('), source.indexOf('function createWorldBookLibraryFeatureModule('))
const editor = source.slice(source.indexOf('function WorldBookEditor('), source.indexOf('function WorldBookLibraryTab('))

test('世界书编辑器把 [mvu_update] 条目标为仅后台变量更新，不显示常驻', () => {
  const entries = [
    { ref: 'a', comment: '世界观', content: '常驻设定', constant: true },
    { ref: 'b', comment: '[mvu_update] 变量更新规则', content: '规则', constant: true },
    { ref: 'c', comment: '钟楼', content: '触发设定', constant: false, primaryKeys: ['钟楼'] }
  ]
  const React = {
    // Every entry starts open so its badge renders.
    useState: init => [typeof init === 'function' ? (value => value instanceof Set ? new Set(entries.map(e => e.ref)) : value)(init()) : init, () => {}],
    useDeferredValue: value => value, useEffect() {},
    createElement: (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat() })
  }
  const Editor = vm.runInNewContext(groups + '\n' + editor + '\nWorldBookEditor', {
    React, Set, useTavernConfirm: () => async () => true, usePersistentError: () => ['', () => {}], EmptyState() {}, WorldBookKeyInput() {}, notifyTavernDataChanged() {}, rpc: async () => ({})
  })
  const tree = Editor({ record: { source: { kind: 'standalone' }, view: { displayName: '书', entries } }, sessionId: 's' })
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(nodes)]
  const text = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : node.children.map(text).join('')
  const sections = nodes(tree).filter(node => node.props.className === 'dsh-tavern-worldbook-group')
  const section = label => sections.find(node => text(node).startsWith(label))
  const kinds = node => nodes(node).filter(n => String(n.props.className || '').startsWith('dsh-tavern-worldbook-kind')).map(text)

  assert.deepEqual(kinds(section('常驻条目')), ['常驻'])
  assert.deepEqual(kinds(section('非常驻条目')), ['非常驻'])
  const background = section('仅后台变量更新')
  assert.match(text(background), /只交给后台变量更新任务，不发给正文模型/)
  assert.deepEqual(kinds(background), ['仅后台变量更新'])
  assert.ok(!nodes(background).some(n => n.tag === 'button' && text(n) === '常驻'))
})
