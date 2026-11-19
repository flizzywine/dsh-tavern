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

test('切换到后台已生成会话时，连续到达的 tavern-state 不会打断在途补读或触发退避等待', async t => {
	const p = page(t)
	const clock = syncClock(), signals = createSessionSignalTransport()
	const createRefresh = p.context.createSessionRefreshController
	p.context.createSessionRefreshController = options => createRefresh({ ...options, ...clock })
	p.context.tavernSessionSignals = signals

	const oldMessages = [{ role: 'assistant', greeting: true, turn: 1, text: '开场' }]
	const bgReplyMessages = [
		...oldMessages,
		{ role: 'user', text: '后台行动' },
		{ role: 'assistant', turn: 2, text: '后台生成的最新楼层正文' }
	]
	let stage = 'initial'
	let switchRead = null
	const observedSignals = []
	let s1Reads = 0
	const data = p.context.createTavernStoryTranscriptDataModule({ rpc: async (_method, _args, id, options) => {
		if (id === 's2') return { storyTranscript: transcript(oldMessages, 1), view: { mode: 'story', storageRevision: 1 }, revision: 1, storySignature: 's2-1' }
		s1Reads += 1
		observedSignals.push(options?.signal)
		if (stage === 'initial') {
			return { storyTranscript: transcript(oldMessages, 1), view: { mode: 'story', storageRevision: 1 }, revision: 1, storySignature: 's1-1' }
		}
		if (stage === 'switch') {
			switchRead = Promise.withResolvers()
			return switchRead.promise
		}
		return { storyTranscript: transcript(bgReplyMessages, 4), view: { mode: 'story', storageRevision: 4 }, revision: 4, storySignature: 's1-4' }
	} })
	const store = data.createStoryTranscriptStore()
	const feature = p.context.createTavernStoryTranscriptFeature({ dataModule: data })
	const flow = sessionId => React.createElement(feature.StoryTranscriptFlow, {
		store, sessionId, renderNative: () => null,
		useChat: selector => selector({ legacy: {} }), useSession: selector => selector({ running: false })
	})

	const root = await mount(p, flow('s1'))
	assert.equal(s1Reads, 1)
	await act(async () => root.render(flow('s2')))

	// s1 在后台生成了新楼层（revision=3），随后后台结算又推进到 revision=4
	stage = 'switch'
	await act(async () => root.render(flow('s1')))
	assert.equal(s1Reads, 2, '切回 s1 时立即发出首趟补读')
	assert.ok(switchRead, '首趟补读在途')

	await act(async () => {
		signals.publish('s1', { kind: 'tavern-state', version: '3', snapshot: { storageRevision: 3 } })
		await clock.advance(0)
		signals.publish('s1', { kind: 'tavern-state', version: '4', snapshot: { storageRevision: 4 } })
		await clock.advance(0)
	})
	assert.equal(observedSignals.at(-1)?.aborted ?? false, false, '连续后台结算信号不得中断切回时的首趟正文读取')
	assert.equal(s1Reads, 2, '在途首读完成前不重复叠加请求')

	stage = 'settled'
	await act(async () => {
		switchRead.resolve({
			storyTranscript: transcript(bgReplyMessages, 3),
			view: { mode: 'story', storageRevision: 3 },
			revision: 3,
			storySignature: 's1-3'
		})
	})
	// 首趟返回即刻把后台生成的最新楼层画上屏，不等后续版本或 500ms 重试定时器
	assert.match(p.dom.window.document.querySelector('main').textContent, /后台生成的最新楼层正文/)
	assert.deepEqual(clock.delays().filter(ms => ms >= 500), [], '不得进入 500ms 错误退避')
	await act(async () => clock.advance(0))
	assert.equal(store.getSnapshot().revision, 4, '紧接 0ms 跟进到最新结算版本')
})
