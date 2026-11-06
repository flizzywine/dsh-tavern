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

function page(t) {
	const dom = new JSDOM('<main></main>', { pretendToBeVisual: true })
	const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
	Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
	const roots = []
	t.after(async () => {
		for (const root of roots) await act(async () => root.unmount())
		Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act })
		dom.window.close()
	})
	const context = vm.createContext({ React, console, window: dom.window, document: dom.window.document,
		DshUi: { MarkdownText: props => React.createElement('span', { className: 'md-text' }, props.text) },
		useTavernSessionMode: () => 'story', publishSessionMode: () => {}, isPlayMode: mode => mode === 'story' || mode === 'script'
	})
	vm.runInContext(dataSource, context)
	vm.runInContext(listSource, context)
	return { dom, context, roots }
}

function transcript(messages, revision = 1) {
	return projectStoryTranscript({ chat: { messages }, from: 0, to: messages.length - 1, messageCount: messages.length, revision },
		messages.map(({ role, turn, greeting }) => ({ role, turn, greeting })))
}

async function mount(p, element) {
	const root = createRoot(p.dom.window.document.querySelector('main'))
	await act(async () => root.render(element))
	p.roots.push(root)
	return root
}

const messages = [
	{ role: 'assistant', greeting: true, turn: 1, text: '开场' },
	{ role: 'user', text: '行动' },
	{ role: 'assistant', turn: 9, text: '正文' }
]

test('故事行直接位于槽锚点下，提供滚动锚点且不带旧隐藏行类型', async t => {
	const p = page(t), feature = p.context.createTavernStoryTranscriptFeature()
	await mount(p, React.createElement(feature.StoryTranscriptList, { transcript: transcript(messages) }))
	const children = [...p.dom.window.document.querySelector('main').children]
	assert.equal(children.length, messages.length)
	assert.ok(children.every(row => row.tagName === 'ARTICLE'))
	assert.deepEqual(children.map(row => row.getAttribute('data-chat-flow-key')), ['turn:1', 'index:1', 'turn:9'])
	assert.deepEqual(children.map(row => row.getAttribute('data-chat-anchor-key')), ['turn:1', 'index:1', 'turn:9'])
	assert.deepEqual(children.map(row => row.getAttribute('data-chat-turn')), ['1', null, '9'])
	assert.ok(children.every(row => !row.hasAttribute('data-chat-flow-kind')))
})

test('加载更早期间保留旧窗口，扩展成功后一次性替换', async t => {
	const { context } = page(t)
	const all = [{ role: 'user', text: '更早' }, ...messages]
	const older = projectStoryTranscript({ chat: { messages: all.slice(1) }, from: 1, to: 3, messageCount: 4, revision: 4 },
		all.map(({ role, turn, greeting }) => ({ role, turn, greeting })))
	let resolveExpanded
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async (_method, args) => {
		if (args.historyFrom === 0) return new Promise(resolve => { resolveExpanded = resolve })
		return { storyTranscript: older, view: { mode: 'story' }, revision: 4 }
	} })
	const store = data.createStoryTranscriptStore()
	await store.read('s1')
	const pending = store.read('s1', { historyFrom: 0 })
	assert.equal(store.getSnapshot().status, 'refreshing')
	assert.equal(store.getSnapshot().transcript, older)
	resolveExpanded({ storyTranscript: transcript(all, 5), view: { mode: 'story' }, revision: 5 })
	await pending
	assert.equal(store.getSnapshot().status, 'ready')
	assert.equal(store.getSnapshot().transcript.from, 0)
	assert.equal(store.getSnapshot().transcript.messages.length, 4)
})

test('新旧渲染开关保留故事数据并即时回退原生 ChatFlow', async t => {
	const p = page(t), { context } = p
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async () => ({ storyTranscript: transcript(messages), view: { mode: 'story' }, revision: 1 }) })
	const store = data.createStoryTranscriptStore(), mode = data.createModeStore()
	await store.read('s1')
	const refreshes = []
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data, mode: mode,
		externalHistory: { refresh: (sessionId, options) => refreshes.push({ sessionId, options }) } })
	const NativeFlow = () => React.createElement('div', { 'data-native-flow': '' }, '原生')
	const chat = { legacy: { partial: null, nodes: [], runningCalls: [] } }
	const element = () => React.createElement(feature.StoryTranscriptFlow, {
		sessionId: 's1', store: store, nativeFlow: NativeFlow,
		useChat: selector => selector(chat), useSession: selector => selector({ running: false })
	})
	const root = await mount(p, element())
	assert.equal(p.dom.window.document.querySelectorAll('[data-story-row]').length, 3)
	assert.equal(p.dom.window.document.querySelector('[data-native-flow]'), null)
	await act(async () => mode.set(false))
	assert.ok(p.dom.window.document.querySelector('[data-native-flow]'))
	assert.equal(p.dom.window.document.querySelector('[data-story-row]'), null)
	await act(async () => mode.set(true))
	assert.equal(p.dom.window.document.querySelector('[data-native-flow]'), null)
	assert.equal(p.dom.window.document.querySelectorAll('[data-story-row]').length, 3)
	assert.deepEqual(refreshes.map(item => item.sessionId), ['s1', 's1', 's1'], '初次、切原生、回故事各同步一次投影')
	assert.ok(refreshes.every(item => item.options === undefined), '模式切换由 external-history 的状态变化触发一次全量重建')
})

test('空故事回退原生 ChatFlow 时同步恢复完整 native 投影', async t => {
	const p = page(t), { context } = p
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async () => ({ storyTranscript: null, view: null, revision: 0 }) })
	const store = data.createStoryTranscriptStore()
	await store.read('plain')
	assert.equal(store.getSnapshot().status, 'empty')
	let externalOptions
	const cleanups = []
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data, externalHistoryInstaller: options => {
		externalOptions = options
		return { refresh: () => {}, dispose: () => {} }
	} })
	const ctx = {
		effect: run => { const cleanup = run(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
		get: () => ({}),
		sessions: { list: { getSnapshot: () => ({ current: 'plain' }) } }
	}
	const slots = { inject: (_name, contribute) => contribute(), register: () => () => {}, entries: () => [], subscribe: () => () => {} }
	feature.register({ ctx, slots })
	assert.equal(externalOptions.isEnabled('plain'), true, '首次读取前乐观按故事首屏处理')
	const NativeFlow = () => React.createElement('div', { 'data-native-flow': '' }, '完整原生')
	await mount(p, React.createElement(feature.StoryTranscriptFlow, {
		sessionId: 'plain', store: store, nativeFlow: NativeFlow,
		useChat: selector => selector({ legacy: { partial: null, nodes: [], runningCalls: [] } }),
		useSession: selector => selector({ running: false })
	}))
	assert.ok(p.dom.window.document.querySelector('[data-native-flow]'))
	assert.equal(externalOptions.isEnabled('plain'), false, '空故事不再裁剪原生历史')
	for (const cleanup of cleanups) cleanup()
})

test('流式结束并提交 native 节点后强制重读逻辑消息', async t => {
	const p = page(t), { context } = p
	let calls = 0
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async () => {
		calls++
		const current = calls === 1 ? messages : [...messages, { role: 'assistant', turn: 10, text: '提交后的正文' }]
		return { storyTranscript: transcript(current, calls), view: { mode: 'story' }, revision: calls }
	} })
	const store = data.createStoryTranscriptStore(), mode = data.createModeStore()
	await store.read('s1')
	const refreshes = []
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data, mode: mode,
		externalHistory: { refresh: (sessionId, options) => refreshes.push({ sessionId, options }) } })
	const chat = { legacy: { partial: { turn: 10, blocks: [{ kind: 'text', text: '流式草稿' }] }, nodes: [], runningCalls: [] } }
	const NativeFlow = () => React.createElement('div', { 'data-native-flow': '' })
	const element = () => React.createElement(feature.StoryTranscriptFlow, {
		sessionId: 's1', store: store, nativeFlow: NativeFlow,
		useChat: selector => selector(chat), useSession: selector => selector({ running: false })
	})
	const root = await mount(p, element())
	assert.equal(calls, 1)
	assert.equal(p.dom.window.document.querySelectorAll('[data-story-draft]').length, 1)
	chat.legacy = { partial: null, nodes: [{ kind: 'assistant', messageId: 'm10' }], runningCalls: [] }
	await act(async () => root.render(element()))
	await act(async () => Promise.resolve())
	assert.equal(calls, 2)
	assert.equal(p.dom.window.document.querySelector('[data-story-draft]'), null)
	assert.ok(p.dom.window.document.querySelector('main').textContent.includes('提交后的正文'))
	assert.equal(refreshes.filter(item => item.options && item.options.force).length, 1, '生成收尾只主动裁剪一次旧原生回合')
	assert.equal(refreshes.at(-1).sessionId, 's1')
})

test('槽注册复制原生 inject/store/locale，保留 children 声明并优先故事条目', async t => {
	const { context } = page(t)
	const NativeFlow = () => null, inject = () => ({}), store = () => {}
	const registrations = []
	let nativeEntries = [], notify = null
	const slots = {
		inject: (_name, contribute) => contribute(),
		register: (options, component) => { registrations.push({ options, component }); return () => {} },
		entries: () => nativeEntries,
		subscribe: (_name, listener) => { notify = listener; return () => {} }
	}
	const ctx = { effect: run => run() }
	context.createTavernStoryTranscriptFeature().register({ ctx, slots })
	assert.equal(registrations.some(entry => entry.options.name === 'conversation.chat.flow'), false)
	nativeEntries = [{ component: NativeFlow, inject, store, locale: 'chat', children: { 'conversation.chat.node': {} } }]
	notify()
	const flow = registrations.find(entry => entry.options.name === 'conversation.chat.flow')
	assert.equal(flow.options.priority, -1)
	assert.equal(flow.options.inject, inject)
	assert.equal(flow.options.store, store)
	assert.equal(flow.options.locale, 'chat')
	assert.equal(flow.options.children, undefined)
	assert.ok(registrations.some(entry => entry.options.id === 'dsh-tavern-story-transcript-mode'))
})

test('注册生命周期安装 external-history，跟随模式与当前会话并完整卸载', async t => {
	const { context } = page(t)
	const cleanups = [], refreshes = [], installs = []
	let disposed = 0
	const uiConversation = { marker: 'ui' }
	const slots = {
		inject: (_name, contribute) => contribute(),
		register: () => () => {},
		entries: () => [],
		subscribe: () => () => {}
	}
	const ctx = {
		effect: run => { const cleanup = run(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
		get: name => name === 'uiConversation' ? uiConversation : undefined,
		sessions: { list: { getSnapshot: () => ({ current: 's1' }) } }
	}
	const feature = context.createTavernStoryTranscriptFeature({ externalHistoryInstaller: options => {
		installs.push(options)
		return { refresh: sessionId => refreshes.push(sessionId), dispose: () => { disposed++ } }
	} })
	feature.register({ ctx, slots })
	assert.equal(installs.length, 1)
	assert.equal(installs[0].uiConversation, uiConversation)
	assert.equal(installs[0].isEnabled('s1'), true)
	assert.deepEqual(refreshes, ['s1'])
	feature.mode.set(false)
	assert.equal(installs[0].isEnabled('s1'), false)
	assert.deepEqual(refreshes, ['s1', 's1'])
	for (const cleanup of cleanups) cleanup()
	assert.equal(disposed, 1)
})
