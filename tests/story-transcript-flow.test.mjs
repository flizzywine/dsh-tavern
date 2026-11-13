import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { createSessionSignalTransport } from '../tavern-plugin/lib/domain/session-signal-transport.js'
import { projectStoryTranscript } from '../tavern-plugin/lib/domain/story-transcript.js'
import { syncClock } from './fixtures/sync-clock.mjs'

const dataSource = await readFile(new URL('../tavern-plugin/src/client/features/story-transcript-data.js', import.meta.url), 'utf8')
const refreshSource = await readFile(new URL('../tavern-plugin/src/client/modules/session-refresh-controller.js', import.meta.url), 'utf8')
const hostChatFlowSource = await readFile(new URL('../tavern-plugin/src/client/host/chat-flow.js', import.meta.url), 'utf8')
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
	const context = vm.createContext({ React, AbortController, console, window: dom.window, document: dom.window.document,
		DshUi: {
			MarkdownText: props => React.createElement('span', { className: 'md-text' }, props.text),
			Tooltip: props => props.children,
			IconEditOutlineRegular: icon('edit'), IconBranchOutlineRegular: icon('branch'),
			IconCopyOutlineRegular: icon('copy'), IconCheckOutlineRegular: icon('check'),
			writeClipboard: async () => true
		},
		useTavernSessionMode: () => 'story', publishSessionMode: () => {}, isPlayMode: mode => mode === 'story' || mode === 'script'
	})
	vm.runInContext(refreshSource, context)
	vm.runInContext(dataSource, context)
	vm.runInContext(hostChatFlowSource, context)
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

test('宿主先空闲时，落盘信号刷新故事并挡住迟到的旧读取', async t => {
	const p = page(t)
	const signals = createSessionSignalTransport()
	p.context.tavernSessionSignals = signals
	const clock = syncClock(), createRefresh = p.context.createSessionRefreshController
	p.context.createSessionRefreshController = options => createRefresh({ ...options, ...clock })
	const earlyRead = Promise.withResolvers()
	const old = { storyTranscript: transcript(messages), view: { mode: 'story' }, revision: 1 }
	const replacement = '重新生成的长正文'.repeat(800)
	let committed = old, reads = 0, earlySignal
	const data = p.context.createTavernStoryTranscriptDataModule({ rpc: async (_method, _args, _id, options) => {
		if (++reads !== 2) return committed
		earlySignal = options.signal
		return earlyRead.promise
	} })
	const feature = p.context.createTavernStoryTranscriptFeature({ dataModule: data })
	const flow = running => React.createElement(feature.StoryTranscriptFlow, {
		sessionId: 's1', renderNative: () => null,
		useChat: selector => selector({ legacy: {} }), useSession: selector => selector({ running })
	})
	const root = await mount(p, flow(true))
	await act(async () => root.render(flow(false)))
	await act(async () => clock.advance(0))
	assert.equal(reads, 2, '宿主先变空闲，提前发出了读取')

	committed = { ...old, storyTranscript: transcript([...messages.slice(0, -1), { ...messages.at(-1), text: replacement }], 2), revision: 2 }
	await act(async () => {
		signals.publish('s1', { kind: 'story-regenerated', version: '2' })
		await clock.advance(0)
	})
	assert.equal(earlySignal.aborted, true, '提交信号取消还在途的旧读取')
	assert.equal(reads, 3, '正文提交后独立触发重新读取')
	await act(async () => earlyRead.resolve(old))
	assert.ok(p.dom.window.document.querySelector('[data-chat-flow-key="turn:9"]').textContent.includes(replacement))

	await act(async () => { signals.publish('s1', { kind: 'story-regenerated', version: '1' }) })
	assert.equal(reads, 3, '已经读过的旧提交无需再次刷新')
})

test('提交信号只到一次时，重读失败或读到旧版本会自动恢复', async t => {
	const p = page(t)
	const clock = syncClock(), signals = createSessionSignalTransport()
	const createRefresh = p.context.createSessionRefreshController
	p.context.createSessionRefreshController = options => createRefresh({ ...options, ...clock })
	p.context.tavernSessionSignals = signals
	let reads = 0
	const data = p.context.createTavernStoryTranscriptDataModule({ rpc: async (_method, _args, _sessionId, options) => {
		reads++
		if (reads === 2) {
			assert.ok(options.signal instanceof AbortSignal)
			throw new Error('暂时断网')
		}
		const updated = reads >= 4
		const revision = updated ? 2 : 1
		const body = updated ? [...messages.slice(0, -1), { ...messages.at(-1), text: '已提交的新正文' }] : messages
		return { storyTranscript: transcript(body, revision), view: { mode: 'story' }, revision }
	} })
	const store = data.createStoryTranscriptStore()
	const feature = p.context.createTavernStoryTranscriptFeature({ dataModule: data })
	await mount(p, React.createElement(feature.StoryTranscriptFlow, { store, sessionId: 's1', renderNative: () => null,
		useChat: selector => selector({ legacy: {} }), useSession: selector => selector({ running: false }) }))
	await act(async () => {
		signals.publish('s1', { kind: 'story-regenerated', version: '2' })
		await clock.advance(0)
	})
	assert.equal(store.getSnapshot().status, 'error')
	assert.deepEqual(clock.delays(), [500])
	await act(async () => clock.advance(500))
	assert.equal(store.getSnapshot().revision, 1, '落后的响应不覆盖已显示的版本')
	assert.deepEqual(clock.delays(), [1500])
	await act(async () => clock.advance(1500))
	assert.equal(reads, 4)
	assert.equal(store.getSnapshot().revision, 2)
	assert.match(p.dom.window.document.querySelector('main').textContent, /已提交的新正文/)
	assert.deepEqual(clock.delays(), [])
})

test('回合结束与页面变更合并读取，切换会话后旧会话停止重试', async t => {
	const p = page(t)
	const clock = syncClock(), signals = createSessionSignalTransport()
	const createRefresh = p.context.createSessionRefreshController
	p.context.createSessionRefreshController = options => createRefresh({ ...options, ...clock })
	p.context.tavernSessionSignals = signals
	const requests = []
	const data = p.context.createTavernStoryTranscriptDataModule({ rpc: async (_method, _args, sessionId, options) => {
		requests.push(sessionId)
		if (sessionId === 's1' && options?.signal) throw new Error('暂时断网')
		return { storyTranscript: transcript(messages), view: { mode: 'story' }, revision: 1 }
	} })
	const feature = p.context.createTavernStoryTranscriptFeature({ dataModule: data })
	const flow = (sessionId, running = false) => React.createElement(feature.StoryTranscriptFlow, {
		sessionId, renderNative: () => null, useChat: selector => selector({ legacy: {} }),
		useSession: selector => selector({ running })
	})
	const root = await mount(p, flow('s1', true))
	await act(async () => root.render(flow('s1')))
	await act(async () => {
		const { window } = p.dom
		window.dispatchEvent(new window.CustomEvent('dsh-tavern-story-mutated', { detail: { sessionId: 's1' } }))
		await clock.advance(0)
	})
	assert.deepEqual(requests, ['s1', 's1'])
	assert.deepEqual(clock.delays(), [500])
	await act(async () => root.render(flow('s2')))
	assert.deepEqual(clock.delays(), [])
	await act(async () => clock.advance(10000))
	assert.deepEqual(requests, ['s1', 's1', 's2'])
})

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
		sessionId: 's1', renderNative: () => null,
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


test('故事读取不把自己的精简视图写进会话视图（舞台读的回合正文不会时有时无）', async t => {
	const p = page(t), { context } = p
	const touched = []
	// The live session view the stage reads: any write from a story read is the regression.
	context.liveTavernView = new Proxy({}, { get: (_target, name) => (...args) => { touched.push([name, args[0]]) } })
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async () => ({
		storyTranscript: transcript(messages), view: { mode: 'story', replyProjections: [{ turn: 9, text: '正文' }] }, revision: 1
	}) })
	const store = data.createStoryTranscriptStore()
	await store.read('s1')
	await store.read('s1', { force: true })
	await store.read('s2')
	store.reset()
	assert.equal(store.getSnapshot().status, 'idle')
	assert.deepEqual(touched, [])
})

test('普通会话从首次读取到回退原生 ChatFlow 都保留完整历史', async t => {
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
	assert.equal(externalOptions.isEnabled('plain'), false, '故事列表接管前保留原生历史')
	const NativeFlow = () => React.createElement('div', { 'data-native-flow': '' }, '完整原生')
	await mount(p, React.createElement(feature.StoryTranscriptFlow, {
		sessionId: 'plain', store: store, renderNative: NativeFlow,
		useChat: selector => selector({ legacy: { partial: null, nodes: [], runningCalls: [] } }),
		useSession: selector => selector({ running: false })
	}))
	assert.ok(p.dom.window.document.querySelector('[data-native-flow]'))
	assert.equal(externalOptions.isEnabled('plain'), false, '空故事不再裁剪原生历史')
	for (const cleanup of cleanups) cleanup()
})

test('故事列表接管后才裁剪原生历史，切换渲染器时恢复已加载的旧回合', async t => {
	const p = page(t), { context } = p
	const pending = Promise.withResolvers()
	const story = transcript([1, 2, 3].map(turn => ({ role: 'assistant', turn, text: '正文 ' + turn })))
	const data = context.createTavernStoryTranscriptDataModule({ rpc: () => pending.promise })
	const store = data.createStoryTranscriptStore()
	const nativeRows = ['正文 1', '正文 2', '正文 3']
	let visibleNativeRows = nativeRows, isEnabled
	const listeners = new Set()
	const subscribeNative = listener => { listeners.add(listener); return () => listeners.delete(listener) }
	const cleanups = []
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data, externalHistoryInstaller: options => {
		isEnabled = options.isEnabled
		return {
			refresh: id => {
				visibleNativeRows = isEnabled(id) ? nativeRows.slice(-1) : nativeRows
				for (const listener of listeners) listener()
			},
			dispose() {}
		}
	} })
	feature.register({
		ctx: { effect: run => { cleanups.push(run()) }, get: () => ({}) },
		slots: { inject: () => () => {} }
	})
	t.after(() => { for (const cleanup of cleanups) cleanup() })

	function NativeFlow() {
		const rows = React.useSyncExternalStore(subscribeNative, () => visibleNativeRows)
		return React.createElement('div', null, rows.join('、'))
	}
	const flow = React.createElement(feature.StoryTranscriptFlow, {
		store, sessionId: 's1', renderNative: NativeFlow,
		useChat: selector => selector({ legacy: {} }), useSession: selector => selector({ running: false })
	})
	assert.equal(isEnabled('s1'), false, '原生或第三方渲染器优先时不裁剪')
	const root = await mount(p, flow)
	assert.equal(isEnabled('s1'), false, '故事历史仍在读取')
	await act(async () => pending.resolve({ storyTranscript: story, view: { mode: 'story' }, revision: 1 }))
	assert.equal(isEnabled('s1'), true)
	assert.deepEqual(visibleNativeRows, ['正文 3'])
	assert.equal(p.dom.window.document.querySelectorAll('[data-story-row]').length, 3)
	await act(async () => root.render(React.createElement(NativeFlow)))
	assert.equal(isEnabled('s1'), false)
	assert.equal(p.dom.window.document.querySelector('main').textContent, nativeRows.join('、'))
})

test('没有子槽的原生条目继续使用独立的故事注册', async t => {
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
	nativeEntries = [{ component: NativeFlow, inject, store, locale: 'chat' }]
	notify()
	const flow = registrations.find(entry => entry.options.name === 'conversation.chat.flow')
	assert.equal(flow.options.priority, -1)
	assert.equal(flow.options.inject, inject)
	assert.equal(flow.options.store, store)
	assert.equal(flow.options.locale, 'chat')
	assert.equal(flow.options.children, undefined)
	assert.equal(registrations.some(entry => entry.options.id === 'dsh-tavern-story-transcript-mode'), false, '不再注册楼层／原生切换按钮')
})

test('游玩 → 卡片 → 游玩保留原生条目的子槽能力', async t => {
	const p = page(t), { context } = p
	context.useTavernSessionMode = sessionId => sessionId === 'card-session' ? 'card' : 'story'
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async () => ({
		storyTranscript: transcript(messages), view: { mode: 'story' }, revision: 1
	}) })
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data })
	const NativeFlow = props => {
		assert.equal(props.renderNative, undefined)
		return props.renderSlot('conversation.chat.node', { text: '卡片工作台对话' })
	}
	const children = { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } }
	const entry = { component: NativeFlow, children }
	let entries = [entry], notify, dispose
	feature.register({ ctx: { effect: run => { dispose = run() } }, slots: {
		inject: (_key, contribute) => contribute(), entries: () => entries,
		subscribe: (_key, listener) => { notify = listener; return () => {} },
		register: () => assert.fail('已有的子槽不能重复注册')
	} })
	assert.notEqual(entry.component, NativeFlow)
	assert.equal(entry.children, children)
	const flow = sessionId => React.createElement(entry.component, {
		sessionId,
		// The host only supplies renderSlot to the entry declaring these children.
		renderSlot: entry.children && ((name, owner) => {
			assert.ok(entry.children[name])
			return React.createElement('div', { 'data-native-node': '' }, owner.text)
		}),
		useChat: selector => selector({ legacy: {} }), useSession: selector => selector({ running: false })
	})
	const root = await mount(p, flow('play-session'))
	assert.match(p.dom.window.document.querySelector('main').textContent, /正文/)
	await act(async () => root.render(flow('card-session')))
	assert.equal(p.dom.window.document.querySelector('[data-native-node]').textContent, '卡片工作台对话')
	await act(async () => root.render(flow('play-session')))
	assert.match(p.dom.window.document.querySelector('main').textContent, /正文/)
	assert.equal(p.dom.window.document.querySelector('[data-native-node]'), null)
	const replacement = { component: NativeFlow, children }
	entries = [replacement]
	notify()
	assert.equal(entry.component, NativeFlow)
	assert.notEqual(replacement.component, NativeFlow)
	dispose()
	assert.equal(replacement.component, NativeFlow)
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
	assert.equal(installs[0].isEnabled('s1'), false)
	assert.deepEqual(refreshes, ['s1'])
	feature.mode.set(false)
	assert.equal(installs[0].isEnabled('s1'), false)
	assert.deepEqual(refreshes, ['s1', 's1'])
	for (const cleanup of cleanups) cleanup()
	assert.equal(disposed, 1)
})
