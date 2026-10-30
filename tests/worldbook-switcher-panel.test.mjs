// 世界书快捷面板：换书、开关条目、「完整」跳书库、点外面/Esc 关闭。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { clientControls } from './fixtures/native-controls.mjs'

const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = client.indexOf('const WBSW_STORAGE_KEY')
const marker = 'const worldBookSwitcherFeature = createWorldBookSwitcherFeatureModule();'
const end = client.indexOf(marker) + marker.length
const source = client.slice(start, end)

function setup() {
	const dom = new JSDOM('<!doctype html><html><body><div id="anchor" style="position:fixed;top:10px;left:400px;width:80px;height:32px"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
	return dom
}
test('世界书快捷面板：换书、开关条目、完整与关闭', async () => {
	assert.ok(start >= 0 && end > marker.length, '客户端 bundle 应包含世界书快捷面板')
	const dom = setup()
	globalThis.window = dom.window
	globalThis.document = dom.window.document
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
	globalThis.HTMLElement = dom.window.HTMLElement
	globalThis.Element = dom.window.Element
	globalThis.Node = dom.window.Node
	globalThis.IS_REACT_ACT_ENVIRONMENT = true

	const React = (await import('react')).default
	const ReactDOMClient = await import('react-dom/client')
	const { act } = await import('react')

	const books = {
		'worldbooks/测试.json': [
			{ ref: 'entry:0', title: '王城设定', content: '王城位于大陆中央。', enabled: true, primaryKeys: [] },
			{ ref: 'entry:1', title: '雨季', content: '每年七月进入雨季。', enabled: true, primaryKeys: ['雨'] }
		],
		'worldbooks/备用.json': [{ ref: 'entry:0', title: '备用条目', content: '', enabled: false, primaryKeys: [] }],
		'cards/阿珂.png': [{ ref: 'entry:0', title: '阿珂的家', content: '', enabled: true, primaryKeys: [] }]
	}
	const keyOf = source => source.kind === 'card' ? source.cardPath : source.path
	const record = source => ({ source, view: { displayName: keyOf(source), entries: books[keyOf(source)] }, globalEnabled: true })
	const calls = []
	const rpc = async (method, args) => {
		calls.push([method, args])
		if (method === 'listWorldBooks') {
			return {
				standalone: [
					{ kind: 'standalone', path: 'worldbooks/备用.json', name: '备用世界书', globalEnabled: false, entryCount: 1, enabledCount: 0 },
					{ kind: 'standalone', path: 'worldbooks/测试.json', name: '测试世界书', globalEnabled: true, entryCount: 2, enabledCount: 2 }
				],
				embedded: [{ kind: 'card', cardPath: 'cards/阿珂.png', name: '阿珂世界书', cardName: '阿珂', entryCount: 1, enabledCount: 1 }]
			}
		}
		if (method === 'getWorldBook') return record(args.source)
		if (method === 'updateWorldBook') {
			const operation = args.update.operations[0]
			const key = keyOf(args.source)
			books[key] = books[key].map(entry => entry.ref === operation.ref ? Object.assign({}, entry, operation.patch) : entry)
			return record(args.source)
		}
		throw new Error('未预期的 RPC：' + method)
	}
	const requireShim = name => {
		if (name === 'react-dom/client') return ReactDOMClient
		throw new Error('未预期的 require：' + name)
	}
	const controls = clientControls(React)
	const factory = new Function('React', 'rpc', 'rpcWithTimeout', 'notifyTavernDataChanged', 'require', 'window', 'document', ...Object.keys(controls),
		source + '\nreturn worldBookSwitcherFeature;')
	const feature = factory(React, rpc, rpc, () => {}, requireShim, dom.window, dom.window.document, ...Object.values(controls))
	const tick = async () => { await act(async () => { await new Promise(resolve => setImmediate(resolve)) }) }
	const query = selector => dom.window.document.querySelector(selector)
	const queryAll = selector => Array.from(dom.window.document.querySelectorAll(selector))
	const names = () => queryAll('.dsh-tavern-wbsw-row-name').map(node => node.textContent)

	// 下拉分组：全局生效在前，其余独立书、人物卡内置各一组。
	const groups = feature.catalogGroups({ standalone: [{ name: 'b', globalEnabled: false }, { name: 'a', globalEnabled: true }], embedded: [{ name: 'c' }] })
	assert.deepEqual(groups.map(group => group.label), ['全局生效', '其他世界书', '人物卡内置'])

	const opened = []
	let dispose
	await act(async () => { dispose = feature.register({ openLibrary: (source, sessionId) => opened.push([source, sessionId]) }) })
	const anchor = query('#anchor')
	await act(async () => { feature.open(anchor, 'session-1') })
	await tick(); await tick()

	// 没有记忆时默认选全局生效的书。
	assert.equal(query('.dsh-tavern-wbsw-select').value, 'standalone:worldbooks/测试.json')
	assert.deepEqual(names(), ['王城设定', '雨季'])
	assert.deepEqual(queryAll('.dsh-tavern-wbsw-select optgroup').map(node => node.label), ['全局生效', '其他世界书', '人物卡内置'])

	// 开关即时写入，只改 enabled；点整行也能切换。
	await act(async () => { queryAll('.dsh-tavern-wbsw-switch input')[0].click() })
	await tick()
	assert.deepEqual(calls.at(-1)[1].update.operations[0], { op: 'update', ref: 'entry:0', patch: { enabled: false } })
	assert.ok(queryAll('.dsh-tavern-wbsw-row')[0].classList.contains('is-disabled'))
	await act(async () => { queryAll('.dsh-tavern-wbsw-row')[0].click() })
	await tick()
	assert.deepEqual(calls.at(-1)[1].update.operations[0].patch, { enabled: true })

	// 换书：读新书并记住选择。
	const select = query('.dsh-tavern-wbsw-select')
	await act(async () => {
		select.value = 'card:cards/阿珂.png'
		select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
	})
	await tick()
	assert.deepEqual(names(), ['阿珂的家'])
	assert.equal(JSON.parse(dom.window.localStorage.getItem('dsh-tavern-worldbook-switcher')).selectedKey, 'card:cards/阿珂.png')

	// 「完整」带上当前书去书库，并关闭面板。
	await act(async () => { query('.dsh-tavern-wbsw-btn').click() })
	assert.deepEqual(opened, [[{ kind: 'card', cardPath: 'cards/阿珂.png' }, 'session-1']])
	assert.equal(query('.dsh-tavern-wbsw-shell'), null)

	// 重开记住上次的书；Esc 关闭；再点按钮也是关闭。
	await act(async () => { feature.open(anchor, 'session-1') })
	await tick(); await tick()
	assert.equal(query('.dsh-tavern-wbsw-select').value, 'card:cards/阿珂.png')
	await act(async () => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })) })
	assert.equal(query('.dsh-tavern-wbsw-shell'), null)
	await act(async () => { feature.open(anchor, 'session-1') })
	await act(async () => { assert.equal(feature.open(anchor, 'session-1'), false) })
	assert.equal(query('.dsh-tavern-wbsw-shell'), null)

	// 点面板外关闭。
	await act(async () => { feature.open(anchor, 'session-1') })
	await tick(); await tick()
	await act(async () => { dom.window.document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })) })
	assert.equal(query('.dsh-tavern-wbsw-shell'), null)

	await act(async () => { dispose() })
	dom.window.close()
})
