import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL('../tavern-plugin/src/client/' + path, import.meta.url), 'utf8')

// A hook-order React stand-in: createElement builds a plain tree; state persists across render() calls.
function fakeReact() {
  const values = []
  let cursor = 0
  const React = {
    Fragment: 'Fragment',
    useRef(value) { const at = cursor++; return values[at] ||= { current: value } },
    useState(value) { const at = cursor++; if (!(at in values)) values[at] = typeof value === 'function' ? value() : value; return [values[at], next => { values[at] = typeof next === 'function' ? next(values[at]) : next }] },
    useMemo(fn) { const at = cursor++; return values[at] ||= fn() },
    useEffect() {}, useLayoutEffect() {},
    createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat() } }
  }
  return { React, reset() { cursor = 0 } }
}
function find(node, test) {
  if (!node || typeof node !== 'object') return null
  if (test(node)) return node
  for (const child of node.children || []) { const found = find(child, test); if (found) return found }
  return null
}
function all(node, test, out = []) {
  if (!node || typeof node !== 'object') return out
  if (test(node)) out.push(node)
  for (const child of node.children || []) all(child, test, out)
  return out
}

const setup = {
  version: 2, title: '契约申请书', theme: { accent: '#e8578f' }, style: { '--dsh-opening-accent': '#e8578f' },
  fields: [
    { key: 'name', type: 'name', label: '你的称呼', default: '小林' },
    { key: 'city', type: 'choice', label: '初始城市', options: [{ value: '东港市', desc: '标准契约区' }, { value: '西岭市', desc: '高危异常区' }] },
    { key: 'arc', type: 'choice', label: '剧情章节', when: { city: '西岭市' }, options: ['第一部', '第二部'] },
    { type: 'note', text: '丘比会忠实地实现你的愿望。' },
    { key: 'night', type: 'toggle', label: '扣扣规则' }
  ],
  template: ''
}

async function form() {
  const { React, reset } = fakeReact()
  const posted = [], listeners = []
  const contentWindow = { postMessage: (message, origin) => posted.push({ message: JSON.parse(JSON.stringify(message)), origin }) }
  const frame = { getAttribute: () => null, contentWindow }
  const host = { querySelectorAll: () => [frame] }
  const window = { setTimeout, clearTimeout, addEventListener: (type, fn) => listeners.push(fn), removeEventListener: (type, fn) => listeners.splice(listeners.indexOf(fn), 1) }
  const context = vm.createContext({ React, window, encodeURIComponent, InlineField: 'InlineField', InlineRow: 'InlineRow', Switch: 'Switch', Slider: 'Slider', Segmented: 'Segmented', Spinner: 'Spinner', OpeningSetupTemplate: 'OpeningSetupTemplate' })
  vm.runInContext(await read('features/opening-setup-form.js'), context)
  const render = props => { reset(); const tree = context.OpeningSetupForm({ setup, card: { path: 'cards/a.json', hasImage: true }, ...props }); const ref = find(tree, node => node.props.className === 'dsh-opening-frame-host'); ref.props.ref.current = host; return tree }
  return { context, render, posted, listeners, contentWindow }
}

test('the form renders the schema with the card theme and only shows fields whose when holds', async () => {
  const f = await form()
  const tree = f.render({})
  assert.equal(tree.props['data-opening-setup'], 'form')
  assert.equal(tree.props.style['--dsh-opening-accent'], '#e8578f')
  assert.equal(tree.props.style['--fork-accent'], '#e8578f')
  assert.ok(find(tree, node => node.type === 'h2' && node.children[0] === '契约申请书'))
  assert.equal(find(tree, node => node.props['aria-label'] === '剧情章节'), null, 'a hidden field is not rendered')
  const element = find(tree, node => node.type === f.context.OpeningSetupCards)
  const cards = f.context.OpeningSetupCards(element.props)
  assert.equal(cards.props.className, 'dsh-opening-cards')
  assert.equal(cards.props.role, 'radiogroup')
  const kamihama = all(cards, node => node.props.role === 'radio')[1]
  kamihama.props.onClick()
  assert.ok(find(f.render({}), node => node.props['aria-label'] === '剧情章节'))
  assert.ok(find(tree, node => node.type === 'p' && node.children[0] === '丘比会忠实地实现你的愿望。'))
})

test('开始 posts exactly one start message with the shown schema keys and shows the error in one line', async () => {
  const f = await form()
  let tree = f.render({})
  const start = () => find(f.render({}), node => node.type === 'button' && /dsh-opening-start/.test(node.props.className || ''))
  start().props.onClick()
  start().props.onClick()
  assert.equal(f.posted.length, 1)
  assert.deepEqual(f.posted[0].message, { type: 'dsh-tavern-opening-setup-start', values: { name: '小林', city: '东港市', night: false } })
  assert.equal(start().props.disabled, true, 'busy while the frame starts the game')
  f.listeners[0]({ source: {}, data: { type: 'dsh-tavern-opening-setup-result', ok: false, error: 'x' } })
  assert.equal(f.listeners.length, 1, 'a reply from another window is ignored')
  f.listeners[0]({ source: f.contentWindow, data: { type: 'dsh-tavern-opening-setup-result', ok: false, error: '开局设置：「你的称呼」还没填' } })
  await new Promise(resolve => setTimeout(resolve, 0))
  tree = f.render({})
  const error = find(tree, node => node.props.role === 'alert')
  assert.equal(error.children[0], '「你的称呼」还没填')
  assert.equal(start().props.disabled, undefined)
})

test('a card without a v2 setup keeps the picker as it was: the greeting frame is rendered directly', async () => {
  const sidebar = await read('features/sidebar.js')
  assert.match(sidebar, /return selectedOpening\.setup \? h\(OpeningSetupForm, \{[^}]*\}, frame\) : frame;/)
  assert.match(sidebar, /eagerFrame: Boolean\(selectedOpening\.setup\)/)
  const main = await read('main.js')
  assert.ok(main.indexOf('features/opening-setup-form.js') < main.indexOf('features/sidebar.js'))
})
