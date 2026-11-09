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
	const icon = name => () => React.createElement('svg', { 'data-icon': name })
	t.after(async () => {
		for (const root of roots) await act(async () => root.unmount())
		Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act })
		dom.window.close()
	})
	const context = vm.createContext({ React, console, window: dom.window, document: dom.window.document,
		DshUi: {
			MarkdownText: props => React.createElement('span', { className: 'md-text' }, props.text),
			Tooltip: props => props.children,
			IconEditOutlineRegular: icon('edit'), IconBranchOutlineRegular: icon('branch'),
			IconCopyOutlineRegular: icon('copy'), IconCheckOutlineRegular: icon('check'),
			writeClipboard: async () => true
		},
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

test('打开游玩工作过程后只在对应故事楼层显示可展开的工具记录', async t => {
	const p = page(t), { context } = p
	const listeners = new Set(), requests = []
	let preference = { showPlayProcess: false }
	const displayPreferences = {
		snapshot: () => preference,
		subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) }
	}
	const setShowProcess = value => act(async () => {
		preference = { showPlayProcess: value }
		listeners.forEach(listener => listener())
	})
	const data = context.createTavernStoryTranscriptDataModule({ displayPreferences, rpc: async (method, args) => {
		requests.push([method, args.includeToolCalls])
		const storyTranscript = transcript(messages)
		if (args.includeToolCalls) storyTranscript.messages[2].toolCalls = [
			{ id: 'one', name: 'worldbook_grep', arguments: '{"query":"舞台"}', status: 'success', result: '<b>结果</b>' },
			{ id: 'two', name: 'read', status: 'error', result: '找不到文件' }
		]
		return { storyTranscript, view: { mode: 'story' }, revision: 1 }
	} })
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data })
	await mount(p, React.createElement(feature.StoryTranscriptFlow, {
		sessionId: 's1', nativeFlow: () => null,
		useChat: selector => selector({ legacy: {} }), useSession: selector => selector({ running: false })
	}))
	const document = p.dom.window.document
	const floor = document.querySelector('[data-chat-flow-key="turn:9"]')
	assert.ok(floor.textContent.includes('正文'))
	assert.equal(document.querySelector('.dsh-tavern-story-tools'), null)
	assert.deepEqual(requests, [['getStoryTranscript', undefined]])

	await setShowProcess(true)
	const details = document.querySelector('.dsh-tavern-story-tools')
	assert.equal(document.querySelectorAll('.dsh-tavern-story-tools').length, 1)
	assert.equal(details.closest('article'), floor)
	assert.equal(details.open, false)
	details.querySelector('summary').click()
	assert.equal(details.open, true)
	assert.match(details.textContent, /worldbook_grep · 完成/)
	assert.match(details.textContent, /read · 失败/)
	assert.match(details.textContent, /<b>结果<\/b>/)
	assert.equal(details.querySelector('b'), null, '工具结果按文本显示')
	await setShowProcess(false)
	assert.equal(document.querySelector('.dsh-tavern-story-tools'), null)
	assert.equal(document.querySelector('[data-chat-flow-key="turn:9"]'), floor)
	assert.deepEqual(requests, [['getStoryTranscript', undefined], ['getStoryTranscript', true]])
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
	assert.equal(registrations.some(entry => entry.options.id === 'dsh-tavern-story-transcript-mode'), false, '不再注册楼层／原生切换按钮')
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
