// presentation 'stage'：有舞台消费者时，玩法把舞台作为内存租约借走、不渲染页面；否则同 'page'。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from './fixtures/client-vm.mjs'
import React, { act } from 'react'
import ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const fragment = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))

test('stage view lends a lease while a consumer is attached and falls back to the page otherwise', async t => {
  const dom = new JSDOM('<div id="root"></div><div id="hud"></div>')
  const previous = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  let root, hudRoot
  t.after(async () => {
    if (hudRoot) await act(() => hudRoot.unmount())
    if (root) await act(() => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]
  })

  let version = 0, scene = { actors: [{ name: '凛', emotion: '微笑' }], lines: [{ id: 'l1', speaker: '凛', text: '早。' }] }
  const extensionWatchers = new Set(), views = new Map(), rpcCalls = []
  const changed = () => { version += 1; for (const fn of extensionWatchers) fn() }
  const Hud = () => null
  const view = { owner: 'card-plugin', page: true, stage: { scene: () => scene, hud: Hud }, render: () => React.createElement('span', { id: 'page-view' }, 'page view'), lobby: null }
  views.set('card:mode', view)
  const context = vm.createContext({
    React, ReactDOM, Object, Array, Map, Set, Error, document: dom.window.document, crypto: globalThis.crypto,
    useTavernUiExtensions: () => React.useSyncExternalStore(fn => { extensionWatchers.add(fn); return () => extensionWatchers.delete(fn) }, () => version),
    tavernSessionSignals: { subscribe: () => () => {} },
    tavernPluginBoundary: () => props => props.children,
    tavernUiExtensions: { gameModeView: key => views.get(key) },
    rpc: async (_, args) => { rpcCalls.push(args.op); return args.op === 'view' ? { mode: { key: 'card:mode', revision: 3, cursor: 1, length: 2, busy: false, data: { day: 1 } } } : {} }
  })
  const leases = vm.runInContext(fragment('function createTavernStageLeases()', 'const tavernStageLeases') + '; createTavernStageLeases()', context)
  context.tavernStageLeases = leases
  const Surface = vm.runInContext(fragment('function TavernGameModeSurface(props)', 'function TavernGamePage(') + '; TavernGameModeSurface', context)
  const notices = []
  leases.subscribe('s', lease => notices.push(lease && lease.owner))
  const dialog = () => document.querySelector('[aria-label="专属游玩页面"]')

  root = createRoot(document.getElementById('root'))
  await act(() => root.render(React.createElement(Surface, { sessionId: 's', pageHost: true })))
  assert.ok(dialog(), 'no consumer: page fallback like presentation page')
  assert.equal(document.getElementById('page-view').textContent, 'page view')
  assert.equal(leases.get('s'), null)

  const detach = await act(() => leases.attach('s'))
  assert.equal(dialog(), null, 'attached: no page surface')
  const lease = leases.get('s')
  assert.equal(lease.owner, 'card-plugin')
  assert.deepEqual(lease.scene, scene)
  assert.equal(lease.hud, Hud)
  assert.deepEqual(lease.props.data, { day: 1 })
  assert.equal(lease.props.revision, 3)
  assert.equal(typeof lease.props.advance, 'function')
  hudRoot = createRoot(document.getElementById('hud'))
  await act(() => hudRoot.render(React.createElement(lease.props.GameControls)))
  assert.deepEqual([...document.querySelectorAll('#hud button')].map(button => button.textContent), ['停止', '回退一步', '撤销回退'])
  assert.equal(document.querySelector('#hud button:nth-child(2)').disabled, false, 'step back available at cursor 1')

  await act(() => { scene = null; changed() })
  assert.equal(leases.get('s'), null, 'scene null releases the lease')
  assert.equal(dialog(), null, 'still attached: the story returns to the stage, not the page')

  await act(() => { scene = { actors: [], lines: [] }; changed() })
  assert.equal(leases.get('s').owner, 'card-plugin')
  await act(() => { views.delete('card:mode'); changed() })
  assert.equal(leases.get('s'), null, 'unregister releases the lease')

  await act(() => { views.set('card:mode', view); changed() })
  assert.equal(leases.get('s').owner, 'card-plugin')
  await act(() => detach())
  assert.equal(leases.get('s'), null, 'detach releases the lease')
  assert.ok(dialog(), 'no consumer again: page returns')

  await act(() => leases.attach('s'))
  assert.equal(leases.get('s').owner, 'card-plugin')
  await act(() => root.unmount()); root = null
  assert.equal(leases.get('s'), null, 'unmount releases the lease')
  assert.ok(notices.includes(null) && notices.includes('card-plugin'))
  assert.deepEqual([...new Set(rpcCalls)], ['view'], 'leasing never writes game, chat or stage state')
})

test('stage leases: release only by the owner; attach is counted and detach is idempotent', async () => {
  const context = vm.createContext({ Object, Array, Map, Set })
  const leases = vm.runInContext(fragment('function createTavernStageLeases()', 'const tavernStageLeases') + '; createTavernStageLeases()', context)
  leases.publish('s', { owner: 'a', scene: { actors: [], lines: [] }, props: {} })
  leases.release('s', 'b')
  assert.equal(leases.get('s').owner, 'a')
  leases.release('s', 'a')
  assert.equal(leases.get('s'), null)
  const one = leases.attach('s'), two = leases.attach('s')
  one(); one()
  assert.equal(leases.attached('s'), true)
  two()
  assert.equal(leases.attached('s'), false)
})
