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
		DshUi: { MarkdownText: function (props) { return React.createElement('span', { className: 'md-text' }, 'MD[' + props.text + ']') } }
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

test('partial.blocks 只做末尾草稿项，不改持久消息', async t => {
	const page = createPage(t)
	const { dom, context } = page
	const transcript = story(MESSAGES)
	const snapshot = JSON.stringify(transcript)
	const feature = context.createTavernStoryTranscriptFeature()
	await mount(page, React.createElement(feature.StoryTranscriptList, { transcript,
		partial: { turn: 9, blocks: [{ kind: 'reasoning', text: '思考' }, { kind: 'text', text: '草稿正文' }] } }))

	const rows = [...dom.window.document.querySelectorAll('[data-story-row]')]
	assert.equal(rows.length, MESSAGES.length + 1)
	const draft = rows[rows.length - 1]
	assert.ok(draft.hasAttribute('data-story-draft'))
	assert.equal(draft.getAttribute('data-row-key'), 'draft:partial')
	assert.equal(draft.getAttribute('data-floor'), null, '草稿不占楼层号')
	assert.ok(draft.textContent.includes('MD[草稿正文]'))
	assert.ok(!draft.textContent.includes('思考'))
	assert.equal(JSON.stringify(transcript), snapshot, '持久消息不得被改写')
	assert.equal(dom.window.document.querySelectorAll('[data-story-draft]').length, 1)
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
