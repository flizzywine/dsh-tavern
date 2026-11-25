// The 世界书库 book page (WorldBookDetail) from the built client, mounted on a tiny stateful React stand-in: the page's own
// components (rows, the entry editor, 内容) and the windowed lists expand in place, shared components stay elements, so a test
// reads props and calls handlers the way a click would.
import vm from './client-vm.mjs'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to))
const code = slice('function worldBookEntryLamp(', 'function createWorldBookLibraryFeatureModule(') + '\n' +
  slice('const WORLD_BOOK_SELECTIVE_LOGIC', 'function WorldBookLibraryTab(') +
  '\n({ WorldBookDetail, WorldBookEntryRow, WorldBookEntryEditor, WorldBookEntryText })'

export function mountWorldBookDetail(view, { open = true } = {}) {
  const state = [], calls = []
  let index = 0, tree = null
  const named = new Proxy({}, { get: (cache, name) => cache[name] ||= Object.defineProperty(function () {}, 'name', { value: String(name) }) })
  const React = {
    Fragment: 'Fragment',
    createElement: (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat() }),
    useState(init) {
      const slot = index++
      if (!(slot in state)) {
        const value = typeof init === 'function' ? init() : init
        // the page's open entries: every entry starts open so its editor mounts.
        state[slot] = value instanceof Set && open ? new Set(view.entries.map(entry => entry.ref)) : value
      }
      return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; render() }]
    },
    useRef: value => ({ current: value }),
    useEffect() {},
    useDeferredValue: value => value
  }
  const page = vm.runInNewContext(code, {
    React, Set, Promise, JSON, setTimeout,
    packUi: named, InlineGrid: named.InlineGrid, InlineRow: named.InlineRow, InlineField: named.InlineField, Switch: named.Switch,
    EmptyState: named.EmptyState, PanelLoading: named.PanelLoading, WorldBookAddMenu: named.WorldBookAddMenu, HelpTip: named.HelpTip,
    useTavernConfirm: () => async () => true, usePersistentError: () => ['', () => {}], notifyTavernDataChanged() {},
    rpc: async (method, args) => { calls.push([method, args]); return {} }
  })
  const own = new Set([page.WorldBookEntryRow, page.WorldBookEntryEditor, page.WorldBookEntryText])
  const expand = node => {
    if (Array.isArray(node)) return node.map(expand)
    if (!node || typeof node !== 'object') return node
    if (own.has(node.tag)) return { tag: node.tag, props: node.props, children: [expand(node.tag({ ...node.props, children: node.children.length ? node.children : undefined }))] }
    if (node.tag === named.WindowedItems) return { ...node, children: node.props.items.map(item => expand(node.props.render(item))) }
    return { ...node, children: node.children.map(expand) }
  }
  const props = { record: { source: { kind: 'standalone', path: 'books/test.json' }, view }, sessionId: 's', onSaved() {}, onBack() {} }
  function render() { index = 0; tree = expand(page.WorldBookDetail(props)) }
  render()
  const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' ? [] : [node, ...nodes(node.children)]
  const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : !node || typeof node !== 'object' ? '' : text(node.children)
  return { get tree() { return tree }, nodes: () => nodes(tree), text, calls, ui: named, components: page }
}
