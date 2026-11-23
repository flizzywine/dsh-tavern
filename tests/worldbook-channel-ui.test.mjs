import test from 'node:test'
import assert from 'node:assert/strict'
import vm from './fixtures/client-vm.mjs'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const groups = source.slice(source.indexOf('function groupWorldBookEditorEntries('), source.indexOf('function createWorldBookLibraryFeatureModule('))
const editor = source.slice(source.indexOf('function WorldBookEditor('), source.indexOf('function WorldBookLibraryTab('))

const entries = [
  { ref: 'a', comment: '固定设定', title: '固定设定', content: '甲设定', enabled: true, constant: true, primaryKeys: [], secondaryKeys: [] },
  { ref: 'b', comment: '会切换', title: '会切换', content: '乙设定', enabled: true, constant: false, channel: 'tail', primaryKeys: [], secondaryKeys: [] }
]

// A tiny stateful renderer: the editor re-renders through its own setters, so a
// click can be observed the same way a browser would see it.
function mount() {
  const state = []
  let index = 0
  let tree = null
  const calls = []
  const React = {
    createElement: (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat() }),
    useState(init) {
      const slot = index++
      if (!(slot in state)) {
        const value = typeof init === 'function' ? init() : init
        // Open every entry so its settings form mounts.
        state[slot] = value instanceof Set ? new Set(entries.map(entry => entry.ref)) : value
      }
      const set = value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; render() }
      return [state[slot], set]
    },
    useRef: () => ({ current: false }),
    useEffect() {},
    useDeferredValue: value => value
  }
  const Editor = vm.runInNewContext(groups + '\n' + editor + '\nWorldBookEditor', {
    React, Set,
    useTavernConfirm: () => async () => true,
    usePersistentError: () => ['', () => {}],
    EmptyState() {},
    InlineField() {},
    WorldBookKeyInput() {},
    notifyTavernDataChanged() {},
    rpc: async (method, args) => { calls.push([method, args]); return {} }
  })
  const props = {
    record: { source: { kind: 'standalone' }, view: { displayName: '测试书', channel: 'prefix', entries } },
    sessionId: 's',
    onSaved() {}
  }
  function render() { index = 0; tree = Editor(props) }
  render()
  function nodes(node) {
    return Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' ? [] : [node, ...nodes(node.children)]
  }
  const text = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : node.children.map(text).join('')
  const find = predicate => nodes(tree).find(predicate)
  return { text, find, calls, get tree() { return tree } }
}

test('编辑旧世界书时没有通道选项，保存时仍能修改条目', async () => {
  const page = mount()
  assert.doesNotMatch(page.text(page.tree), /注入通道|每轮尾部/)
  assert.equal(page.find(node => node.props.label === '注入通道'), undefined)
  const body = page.find(node => node.tag === 'textarea' && node.props.value === '乙设定')
  body.props.onChange({ target: { value: '修改后的设定' } })
  const save = page.find(node => node.tag === 'button' && page.text(node) === '保存世界书')
  await save.props.onClick()
  const [method, args] = page.calls.at(-1)
  assert.equal(method, 'updateWorldBook')
  assert.equal(args.update.channel, undefined)
  assert.equal(args.update.operations.length, 1)
  const [operation] = args.update.operations
  assert.equal(operation.op, 'update')
  assert.equal(operation.ref, 'b')
  assert.equal(operation.patch.content, '修改后的设定')
  assert.equal(operation.patch.channel, undefined)
})
