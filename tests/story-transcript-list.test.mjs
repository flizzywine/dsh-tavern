import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

import { projectStoryTranscript } from '../tavern-plugin/lib/domain/story-transcript.js'

const dataSource = await readFile(new URL('../tavern-plugin/src/client/features/story-transcript-data.js', import.meta.url), 'utf8')
const listSource = await readFile(new URL('../tavern-plugin/src/client/features/story-transcript-list.js', import.meta.url), 'utf8')

// 一个页面 DOM + 两个 @include 片段共用同一个 factory 作用域（data 先、list 后）。
function createPage(t) {
	const dom = new JSDOM('<main></main>', { pretendToBeVisual: true })
	const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
	Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
	const roots = []
	t.after(async () => {
		for (const root of roots) await act(async () => root.unmount())
		Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act })
		dom.window.close()
	})
	const context = vm.createContext({
		React, console,
		window: dom.window, document: dom.window.document,
		// 宿主 Markdown 原语的替身：记录文本，证明正文走 Markdown 而不是纯文本 <pre>。
		DshUi: { MarkdownText: function (props) { return React.createElement('span', { className: 'md-text' }, 'MD[' + props.text + ']') } },
		tavernProjectionForTurn: (view, turn) => (view && Array.isArray(view.replyProjections) ? view.replyProjections : []).findLast(item => Number(item.turn) === Number(turn)) || null,
		tavernLatestProjectionTurn: view => (view && Array.isArray(view.replyProjections) ? view.replyProjections : []).reduce((latest, item) => Math.max(latest, Number(item.turn) || 0), 0)
	})
	vm.runInContext(dataSource, context)
	vm.runInContext(listSource, context)
	return { dom, context, roots }
}

const story = (messages, revision = 7) => projectStoryTranscript({
	chat: { messages },
	from: 0,
	to: messages.length - 1,
	messageCount: messages.length,
	revision
})

const MESSAGES = [
	{ role: 'assistant', greeting: true, turn: 1, text: '开场正文' },
	{ role: 'user', text: '行动一' },
	{ role: 'assistant', turn: 1, text: '重复 turn 的正文' },
	{ role: 'assistant', turn: 5, text: '跳号正文' },
	{ role: 'user', text: '行动二' },
	{ role: 'assistant', turn: 2, text: '倒退正文' }
]

async function mount(page, element) {
	const root = createRoot(page.dom.window.document.querySelector('main'))
	await act(async () => root.render(element))
	page.roots.push(root)
	return root
}

const rowKeys = dom => [...dom.window.document.querySelectorAll('[data-story-row]')].map(node => node.getAttribute('data-row-key'))
const textOf = dom => [...dom.window.document.querySelectorAll('[data-story-row]')].map(node => node.textContent)

test('严格按 messages 数组顺序渲染，key 取 projection，legacyTurn 不重排', async t => {
	const page = createPage(t)
	const { dom, context } = page
	const transcript = story(MESSAGES)
	const feature = context.createTavernStoryTranscriptFeature()
	await mount(page, React.createElement(feature.StoryTranscriptList, { transcript }))

	const expectedKeys = transcript.messages.map(entry => entry.key)
	assert.deepEqual(rowKeys(dom), expectedKeys, '行顺序必须等于数组顺序')
	assert.deepEqual(transcript.messages.map(entry => entry.legacyTurn), [1, null, 1, 5, null, 2])
	const roles = [...dom.window.document.querySelectorAll('[data-story-row]')].map(node => node.getAttribute('data-role'))
	assert.deepEqual(roles, ['assistant', 'user', 'assistant', 'assistant', 'user', 'assistant'])
	const texts = textOf(dom)
	for (let index = 0; index < MESSAGES.length; index++) assert.ok(texts[index].includes(MESSAGES[index].text), '第 ' + index + ' 条顺序不符')
	assert.equal(dom.window.document.querySelectorAll('[class*="_flowItem"]').length, 0, '不依赖宿主分组节点')
})

test('assistant 从 1 起编号（开场也算），user 不编号', async t => {
	const page = createPage(t)
	const { dom, context } = page
	const transcript = story(MESSAGES)
	const feature = context.createTavernStoryTranscriptFeature()
	await mount(page, React.createElement(feature.StoryTranscriptList, { transcript }))

	const floors = [...dom.window.document.querySelectorAll('[data-story-row]')].map(node => node.getAttribute('data-floor'))
	assert.deepEqual(floors, ['1', null, '2', '3', null, '4'])
	const rows = [...dom.window.document.querySelectorAll('[data-story-row]')]
	for (const row of rows.filter(node => node.getAttribute('data-role') === 'user')) {
		assert.equal(row.querySelector('[class*="floor"]'), null, 'user 行不得出现楼层头')
		assert.ok(!/第 \d+ 楼/.test(row.textContent), 'user 行不得出现楼层号')
	}
	assert.ok(rows[0].textContent.includes('第 1 楼'), '开场必须有 1 楼')
	assert.ok(rows[0].getAttribute('data-greeting') !== null)
})

test('助手正文走 Markdown，不退化成纯文本 <pre>', async t => {
	const page = createPage(t)
	const { dom, context } = page
	const transcript = story(MESSAGES)
	const feature = context.createTavernStoryTranscriptFeature()
	await mount(page, React.createElement(feature.StoryTranscriptList, { transcript }))

	assert.equal(dom.window.document.querySelectorAll('pre').length, 0, '不得用 <pre> 承载正文')
	const firstAssistant = dom.window.document.querySelector('[data-story-row][data-role="assistant"]')
	assert.ok(firstAssistant.querySelector('.md-text'), 'assistant 正文必须经过 Markdown 原语')
	assert.ok(firstAssistant.textContent.includes('MD[开场正文]'))
})

test('首轮占位、流式正文和最终 HTML 始终复用同一逻辑行', async t => {
	const page = createPage(t)
	const { dom, context } = page
	const pendingMessages = [
		{ role: 'user', text: '第一句行动', placeholder: true },
		{ role: 'assistant', turn: 0, text: '', placeholder: true, displayMode: 'html' }
	]
	const pending = story(pendingMessages, 1)
	const snapshot = JSON.stringify(pending)
	const projections = []
	const feature = context.createTavernStoryTranscriptFeature({ renderProjection: (projection, options) => {
		projections.push({ projection, options })
		return React.createElement('div', { 'data-projection-mode': projection.mode }, projection.text)
	} })
	const element = (value, partial = null, running = false) => React.createElement(feature.StoryTranscriptList, {
		transcript: value, partial, running, sessionId: 's1'
	})
	const root = await mount(page, element(pending))
	let rows = [...dom.window.document.querySelectorAll('[data-story-row]')]
	assert.equal(rows.length, 2, '首个 token 前已有输入和输出占位')
	assert.ok(rows[0].textContent.includes('第一句行动'))
	assert.ok(rows[1].textContent.includes('第 1 楼'))
	assert.ok(rows[1].textContent.includes('正在生成'))
	const assistant = rows[1]
	const key = assistant.getAttribute('data-row-key')
	assert.equal(key, 'index:1', 'turn 0 也使用稳定的绝对位置 key')

	await act(async () => root.render(element(pending, { turn: 99, blocks: [{ kind: 'text', text: '其他回合' }] }, true)))
	assert.equal(dom.window.document.querySelectorAll('[data-story-row]').length, 2, '没有匹配占位时不得追加草稿')
	const partial = { turn: 0, blocks: [{ kind: 'reasoning', text: '思考' }, { kind: 'text', text: '流式正文' }] }
	await act(async () => root.render(element(pending, partial, true)))
	rows = [...dom.window.document.querySelectorAll('[data-story-row]')]
	assert.equal(rows.length, 2)
	assert.strictEqual(rows[1], assistant, '流式更新不得替换 article DOM')
	assert.equal(rows[1].getAttribute('data-row-key'), key)
	assert.ok(rows[1].textContent.includes('流式正文'))
	assert.ok(!rows[1].textContent.includes('思考'))
	assert.equal(rows[1].querySelector('[data-projection-mode]').getAttribute('data-projection-mode'), 'markdown')
	assert.equal(JSON.stringify(pending), snapshot, '流式覆盖不得修改持久投影')

	const finalMessages = [
		{ role: 'user', text: '第一句行动' },
		{ role: 'assistant', turn: 0, text: '<p>正式正文</p>', displayMode: 'html' }
	]
	const committed = story(finalMessages, 2)
	await act(async () => root.render(element(committed, partial, true)))
	rows = [...dom.window.document.querySelectorAll('[data-story-row]')]
	assert.equal(rows[1].querySelector('[data-projection-mode]').getAttribute('data-projection-mode'), 'html', '正式 revision 可先于 turn/end 接管')
	await act(async () => root.render(element(committed, partial, true)))
	assert.equal(dom.window.document.querySelector('[data-projection-mode="html"]').textContent, '<p>正式正文</p>', '迟到 partial 不得覆盖已提交 HTML')
	await act(async () => root.render(element(committed, null, false)))
	rows = [...dom.window.document.querySelectorAll('[data-story-row]')]
	assert.equal(rows.length, 2, '提交不得重复或短暂删除输入/输出')
	assert.strictEqual(rows[1], assistant, '最终提交也必须保留同一 article DOM')
	assert.equal(rows[1].getAttribute('data-row-key'), key)
	assert.ok(rows[0].textContent.includes('第一句行动'))
	assert.ok(rows[1].textContent.includes('<p>正式正文</p>'))
	assert.equal(rows[1].querySelector('[data-projection-mode]').getAttribute('data-projection-mode'), 'html')
	assert.equal(rows[1].querySelector('pre,code'), null, 'HTML 正文不得进入代码块')
	assert.ok(!rows[1].textContent.includes('正在生成'))
	assert.equal(projections.at(-1).projection.mode, 'html')
	assert.equal(dom.window.document.querySelectorAll('[data-story-draft]').length, 0)
})

test('正式故事行复用最新视图 parts、Helper 上下文与变量结算 receipt', async t => {
	const page = createPage(t)
	const { dom, context } = page
	const message = { role: 'assistant', turn: 2, text: '原始正文', displayText: '原始正文', displayMode: 'html' }
	const shared = { version: 2, turn: 2, text: '拆分后的正文', mode: 'html', parts: [{ kind: 'html', content: '<div>富正文</div>' }] }
	const latest = { ...shared, text: '结算后的正文', parts: [{ kind: 'html', content: '<div>最新富正文</div>' }] }
	const helper = { stateRevision: 1, messages: [{ message_id: 2, message: '原始正文' }] }
	const liveHelper = { ...helper, stateRevision: 2 }
	const frameSizing = { minHeight: 120 }
	const view = { mode: 'story', replyProjections: [shared], tavernHelper: helper, tavernRuntimePolicy: { frameSizing, trustedCardMode: false } }
	const liveView = { ...view, replyProjections: [latest], tavernHelper: liveHelper,
		mvuReceipts: [{ turn: 2, status: 'updated', changes: [{}] }], settlementTurn: 2, activity: { busy: false } }
	context.useLiveTavernView = () => ({ view: liveView })
	context.liveTavernView = { getSnapshot: () => ({ view: liveView }) }
	context.tavernMvuReceiptForTurn = (value, turn) => (value.mvuReceipts || []).find(item => Number(item.turn) === Number(turn)) || null
	context.TavernMvuReceipt = props => React.createElement('div', { className: 'story-mvu-receipt' }, '变量已更新 · ' + props.turn)
	const calls = []
	const feature = context.createTavernStoryTranscriptFeature({ renderProjection: (projection, options) => {
		calls.push({ projection, options })
		return React.createElement('div', { 'data-rich-part': '' }, projection.parts[0].content)
	} })
	const executeSlash = () => {}
	await mount(page, React.createElement(feature.StoryTranscriptList, {
		transcript: story([message], 1), view, sessionId: 's1', executeSlash, frameOwner: 'owner'
	}))
	assert.equal(calls.length, 1)
	assert.strictEqual(calls[0].projection, latest, '更新的 live revision 必须提供结算后的 EJS parts')
	assert.strictEqual(calls[0].options.helperContext, liveHelper)
	assert.strictEqual(calls[0].options.frameSizing, frameSizing)
	assert.strictEqual(calls[0].options.executeSlash, executeSlash)
	assert.equal(calls[0].options.frameOwner, 'owner')
	assert.equal(calls[0].options.eagerFrame, true)
	assert.equal(dom.window.document.querySelector('[data-rich-part]').textContent, '<div>最新富正文</div>')
	assert.equal(dom.window.document.querySelector('.story-mvu-receipt').textContent, '变量已更新 · 2')
})

test('数据层只调用 getStoryTranscript，并带 historyFrom', async t => {
	const { context } = createPage(t)
	const calls = []
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async (method, args, sessionId) => {
		calls.push({ method, args, sessionId })
		return { view: { mode: { key: 'story' } }, storyTranscript: story(MESSAGES, 12), revision: 12 }
	} })
	const result = await data.fetchStoryTranscript('s1', { historyFrom: 40 })
	assert.deepEqual(calls.map(call => call.method), ['getStoryTranscript'])
	assert.equal(calls[0].args.historyFrom, 40)
	assert.equal(calls[0].sessionId, 's1')
	assert.equal(result.revision, 12)
	assert.equal(result.transcript.messages.length, MESSAGES.length)
	assert.ok(!calls.some(call => /getSession|reconcile/i.test(call.method)))

	const plain = context.createTavernStoryTranscriptDataModule({ rpc: async (method, args) => ({ storyTranscript: null }) })
	await plain.fetchStoryTranscript('s2')
})

test('store 挡掉晚到的旧响应，hook 驱动 view 渲染', async t => {
	const page = createPage(t)
	const { dom, context } = page
	const transcript = story(MESSAGES)
	const deferred = []
	const data = context.createTavernStoryTranscriptDataModule({ rpc: () => new Promise((resolve, reject) => deferred.push({ resolve, reject })) })
	const store = data.createStoryTranscriptStore()

	const first = store.read('s1', { historyFrom: 10 })
	const second = store.read('s1', { historyFrom: 20 })
	assert.equal(store.getSnapshot().status, 'loading')
	deferred[1].resolve({ storyTranscript: transcript, view: {}, revision: 20 })
	await second
	assert.equal(store.getSnapshot().status, 'ready')
	assert.equal(store.getSnapshot().revision, 20)
	// 第一份请求晚到：不得覆盖第二份的结果。
	deferred[0].resolve({ storyTranscript: story(MESSAGES, 10), view: {}, revision: 10 })
	await first
	assert.equal(store.getSnapshot().revision, 20)

	const feature = context.createTavernStoryTranscriptFeature()
	await mount(page, React.createElement(feature.StoryTranscriptView, { store, sessionId: 's1', historyFrom: 20 }))
	assert.equal(dom.window.document.querySelectorAll('[data-story-row]').length, MESSAGES.length)
	assert.equal(dom.window.document.querySelector('[data-story-transcript]').getAttribute('data-revision'), '7')
	assert.equal(deferred.length, 2, '同一会话 + historyFrom 不重复读取')
})
