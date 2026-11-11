import test from 'node:test'
import assert from 'node:assert/strict'
import vm from './fixtures/client-vm.mjs'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const groups = source.slice(source.indexOf('function groupWorldBookEditorEntries('), source.indexOf('function createWorldBookLibraryFeatureModule('))
const editor = source.slice(source.indexOf('function WorldBookEditor('), source.indexOf('function WorldBookLibraryTab('))

const entries = [
  { ref: 'a', comment: '固定设定', title: '固定设定', content: '甲设定', enabled: true, constant: true, channel: 'auto', channelInherited: true, primaryKeys: [], secondaryKeys: [] },
  { ref: 'b', comment: '会切换', title: '会切换', content: '乙设定', enabled: true, constant: false, channel: 'tail', channelInherited: false, primaryKeys: [], secondaryKeys: [] }
]

// A tiny stateful renderer: the editor re-renders through its own setters, so a
// click can be observed the same way a browser would see it.
function mount() {
  const state = []
  let index = 0
  let tree = null
  let saved = null
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
    WorldBookKeyInput() {},
    notifyTavernDataChanged() {},
    rpc: async (method, args) => { calls.push([method, args]); return {} }
  })
  const props = {
    record: { source: { kind: 'standalone' }, view: { displayName: '测试书', channel: 'auto', entries: JSON.parse(JSON.stringify(entries)) } },
    sessionId: 's',
    onSaved: result => { saved = result }
  }
  function render() { index = 0; tree = Editor(props) }
  render()
  function nodes(node) {
    return Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' ? [] : [node, ...nodes(node.children)]
  }
  const text = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : node.children.map(text).join('')
  const find = predicate => nodes(tree).find(predicate)
  return { render, nodes, text, find, props, calls, saved: () => saved, get tree() { return tree } }
}

test('整本开关一次改掉全部条目，并记成整本默认', async () => {
  const page = mount()
  const bar = () => page.find(node => node.tag === 'div' && node.props.className === 'dsh-tavern-worldbook-checks'
    && page.nodes(node).some(child => child.tag === 'button' && page.text(child) === '稳定前缀'))
  assert.ok(bar(), '缺少整本注入通道开关')
  page.nodes(bar()).find(child => child.tag === 'button' && page.text(child) === '稳定前缀').props.onClick()

  // Every entry switches at once, including the one pinned to 'tail'.
  const selects = () => page.nodes(page.tree).filter(node => node.tag === 'select' && node.props['aria-label'] === '注入通道')
  assert.deepEqual(Array.from(selects().map(node => node.props.value)), ['prefix', 'prefix'])
  const view = page.find(node => node.props.className === 'dsh-tavern-card-field' && page.text(node).includes('整本注入通道'))
  assert.match(page.text(view), /当前默认：稳定前缀/)
  assert.equal(page.find(node => node.props.className === 'dsh-tavern-worldbook-kind is-active').children[0], '稳定前缀')

  // Saving writes the book default and the per-entry channels together.
  await page.find(node => node.tag === 'button' && page.text(node) === '保存世界书').props.onClick()
  const [method, args] = page.calls.at(-1)
  assert.equal(method, 'updateWorldBook')
  assert.equal(args.update.channel, 'prefix')
  const patched = args.update.operations.filter(operation => operation.op === 'update')
  assert.deepEqual(Array.from(patched.map(operation => operation.ref)), ['a', 'b'])
  assert.ok(patched.every(operation => operation.patch.channel === 'prefix'))
})

test('条目下拉提供“跟随整本”，清除覆盖时写入 auto 让扩展键真正删除', async () => {
  const page = mount()
  const selects = page.nodes(page.tree).filter(node => node.tag === 'select')
  assert.ok(selects.length >= 2, '每个条目应有注入通道下拉')
  const inherited = selects.find(node => node.props.value === '')
  assert.ok(inherited, '继承条目应显示跟随整本')
  const options = inherited.children.flat().map(option => option.children[0])
  assert.ok(options.includes('跟随整本（自动）'))

  const explicit = selects.find(node => node.props.value === 'tail')
  assert.ok(explicit, '单独设过通道的条目应显示该通道')
  explicit.props.onChange({ target: { value: '' } })

  const save = page.find(node => node.tag === 'button' && page.text(node) === '保存世界书')
  await save.props.onClick()
  const [method, args] = page.calls.at(-1)
  assert.equal(method, 'updateWorldBook')
  const update = args.update
  // Only the cleared entry is written; the inherited one keeps following the book.
  const refs = (update.operations || []).filter(operation => operation.op === 'update').map(operation => operation.ref)
  assert.deepEqual(Array.from(refs), ['b'])
  assert.equal(update.operations.find(operation => operation.ref === 'b').patch.channel, 'auto')
  assert.equal(update.channel, undefined)
})
