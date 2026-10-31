import test from 'node:test'
import assert from 'node:assert/strict'
import vm from './fixtures/client-vm.mjs'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function WorldBookLibraryTab(props)')
const end = source.indexOf('\n\t\tfunction register(input)', start)
for (const kind of ['standalone', 'card']) test(`世界书详情删除 ${kind}：取消、成功刷新和错误提示`, async () => {
  let confirm = false, fail = false, error = '', stateIndex = 0
  const calls = [], notifications = []
  let refreshes = 0
  const item = { kind, path: 'worldbooks/test.json', cardPath: 'cards/test.json', name: '测试书', entryCount: 1, enabledCount: 1 }
  const catalog = { standalone: kind === 'standalone' ? [item] : [], embedded: kind === 'card' ? [item] : [] }
  const Panel = vm.runInNewContext('(' + source.slice(start, end).trim() + ')', {
    React: { useState: value => [stateIndex++ === 2 ? { source: kind === 'card' ? { kind, cardPath: item.cardPath } : { kind, path: item.path }, view: { displayName: item.name } } : value, () => {}], useRef: () => ({}), useEffect() {}, createElement: (tag, props, ...children) => ({ tag, props, children }) },
    usePersistentError: () => [error, value => { error = value }], useTavernSessionMode: () => 'card',
    createWorldBookLibraryRefreshModule: () => ({ request() { refreshes++ }, whenIdle: async () => {} }),
    WorldBookEditor() {}, useVisibleDataRefresh() {}, useTavernConfirm: () => async () => confirm, window: {}, rpc: async (...args) => { calls.push(args); if (fail) throw Error('删除失败') },
    notifyTavernDataChanged: (...args) => notifications.push(args)
  })
  const tree = Panel({ scope: { sessionId: 'session' }, tab: { id: 'book' }, ctx: { betterSidebar: { updateTab() {} } }, appendMention() {} })
  function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(nodes)] }
  const button = nodes(tree.props.actions).find(n => n.tag === 'button' && n.children.includes('删除世界书'))
  assert.ok(button)
  button.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 0)
  confirm = true
  button.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls[0][0], 'deleteWorldBook')
  assert.equal(calls[0][1].source.kind, kind)
  assert.equal(refreshes, 1)
  assert.equal(notifications.length, 1)
  fail = true
  button.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(error, '删除失败')
  assert.equal(refreshes, 1)
})
