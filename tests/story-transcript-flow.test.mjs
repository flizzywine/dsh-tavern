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

test('故事视图就绪前外壳订阅不抢发完整会话读取', async t => {
	const p = page(t), { context } = p, subscriptions = []
	context.useLiveTavernView = (...args) => { subscriptions.push(args); return { view: null } }
	let release
	const data = context.createTavernStoryTranscriptDataModule({ rpc: () => new Promise(resolve => { release = resolve }) })
	const store = data.createStoryTranscriptStore(), mode = data.createModeStore()
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data, mode })
	await mount(p, React.createElement(feature.StoryTranscriptFlow, {
		sessionId: 's1', store, nativeFlow: () => null,
		useChat: selector => selector({ legacy: {} }), useSession: selector => selector({ running: false })
	}))
	const revisionCalls = () => subscriptions.filter(args => args[1] === 'story-transcript-revision')
	assert.equal(revisionCalls().at(-1)[3].deferLoad, true)
	await act(async () => {
		release({ storyTranscript: transcript(messages), view: { mode: 'story' }, revision: 1 })
		await Promise.resolve()
	})
	assert.equal(revisionCalls().at(-1)[3].deferLoad, false, '故事快照播种后恢复正常失效刷新')
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

test('玩家输入只来自持久故事行，准备、失败和提交始终保持同一 DOM', async t => {
	const p = page(t), { context } = p
	const settledUser = { role: 'user', text: '立即显示输入', source: { kind: 'user', rpcId: 'submit-1' } }
	const user = { ...settledUser, placeholder: true }
	const saved = [...messages, user], failed = [...messages, settledUser]
	const prepared = [...saved, { role: 'assistant', turn: 10, text: '', placeholder: true }]
	const committed = [...failed, { role: 'assistant', turn: 10, text: '正文' }]
	let current = messages, revision = 0
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async () => ({
		storyTranscript: transcript(current, ++revision), view: { mode: 'story' }, revision: revision
	}) })
	const store = data.createStoryTranscriptStore(), mode = data.createModeStore()
	await store.read('s1')
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data, mode,
		externalHistory: { refresh() {}, dispose() {} } })
	const session = { running: false, pendingSubmissions: [{ requestId: 'host-only', text: '宿主临时回声' }] }
	const chat = { legacy: { partial: null, nodes: [{ kind: 'user', content: '原生临时行', source: { kind: 'user', rpcId: 'native-only' } }], runningCalls: [] } }
	const flow = () => React.createElement(feature.StoryTranscriptFlow, {
		sessionId: 's1', store, nativeFlow: () => null,
		useChat: selector => selector(chat), useSession: selector => selector(session)
	})
	const root = await mount(p, flow())
	const visibleRow = () => [...p.dom.window.document.querySelectorAll('article[data-story-row]')].find(row => row.textContent.includes('立即显示输入'))
	assert.equal(p.dom.window.document.querySelectorAll('article').length, messages.length)
	assert.equal(p.dom.window.document.body.textContent.includes('宿主临时回声'), false)
	assert.equal(p.dom.window.document.body.textContent.includes('原生临时行'), false)
	async function refresh(next) {
		current = next
		await act(async () => {
			p.dom.window.dispatchEvent(new p.dom.window.CustomEvent('dsh-tavern-story-mutated', { detail: { sessionId: 's1' } }))
			root.render(flow())
		})
	}
	await refresh(saved)
	const original = visibleRow()
	assert.equal(original?.getAttribute('data-row-key'), 'index:3')
	assert.equal(original.querySelector('.dsh-tavern-story-row-actions'), null, '生成中的持久输入不开放写操作')
	await refresh(prepared)
	assert.equal(visibleRow(), original, '正文准备只追加 assistant，用户 DOM 不替换')
	assert.ok(p.dom.window.document.querySelector('.dsh-tavern-story-streaming'))
	session.pendingSubmissions = []
	session.running = false
	await refresh(failed)
	assert.equal(visibleRow(), original, '生成失败和宿主状态变化都不移除玩家输入')
	assert.ok(original.querySelector('.dsh-tavern-story-row-actions'), '失败结束后玩家输入恢复写操作')
	await refresh(prepared)
	await refresh(committed)
	assert.equal(visibleRow(), original, '重试与提交仍使用同一个故事索引')
	assert.equal([...p.dom.window.document.querySelectorAll('.dsh-tavern-user-bubble')].filter(node => node.textContent === '立即显示输入').length, 1)
})

test('撤回后故事气泡立即消失，重发与重新读取不会重复', async t => {
	const p = page(t), { context } = p
	const tail = { role: 'user', text: '6', sourceText: '6', native: true, placeholder: true,
		source: { kind: 'user', rpcId: 'rpc-6' } }
	let current = [...messages, tail], revision = 0
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async () => ({
		storyTranscript: transcript(current, ++revision), view: { mode: 'story' }, revision: revision
	}) })
	const store = data.createStoryTranscriptStore(), mode = data.createModeStore()
	await store.read('s1')
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data, mode,
		externalHistory: { refresh() {}, dispose() {} } })
	const session = { running: false, pendingSubmissions: [{ requestId: 'rpc-6', text: '6' }] }
	const chat = { legacy: { partial: null, nodes: [{ kind: 'user', content: '6', source: { kind: 'user', rpcId: 'rpc-6' } }], runningCalls: [] } }
	const flow = () => React.createElement(feature.StoryTranscriptFlow, {
		sessionId: 's1', store, nativeFlow: () => null,
		useChat: selector => selector(chat), useSession: selector => selector(session)
	})
	await mount(p, flow())
	const bubbles = () => [...p.dom.window.document.querySelectorAll('.dsh-tavern-user-bubble')].filter(node => node.textContent === '6')
	assert.equal(bubbles().length, 1, 'placeholder 玩家行在生成期间正常显示，原生回声不再画一次')
	async function refresh(next) {
		current = next
		await act(async () => {
			p.dom.window.dispatchEvent(new p.dom.window.CustomEvent('dsh-tavern-story-mutated', { detail: { sessionId: 's1' } }))
		})
	}
	await refresh(messages)
	assert.equal(bubbles().length, 0, '撤回事件重读后，持久用户行和气泡一起消失')
	await refresh([...messages, { ...tail, placeholder: undefined }, { role: 'assistant', turn: 10, text: '新正文' }])
	assert.equal(bubbles().length, 1, '重发只保留新提交的一条用户行')
	await act(async () => { await store.read('s1', { force: true }) })
	assert.equal(bubbles().length, 1, '重新读取存档仍只有一个气泡')
})


test('旧原生偏好在初始化时恢复故事楼层', async t => {
	const p = page(t), { context } = p
	const writes = []
	const storage = { getItem: () => 'legacy', setItem: (key, value) => writes.push([key, value]) }
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async () => ({ storyTranscript: transcript(messages), view: { mode: 'story' }, revision: 1 }) })
	const store = data.createStoryTranscriptStore(), mode = data.createModeStore({ storage })
	assert.equal(mode.getSnapshot(), false)
	await store.read('s1')
	const refreshes = []
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data, mode: mode,
		externalHistory: { refresh: (sessionId, options) => refreshes.push({ sessionId, options }) } })
	assert.equal(mode.getSnapshot(), true)
	assert.deepEqual(writes, [['dsh-tavern-story-transcript-renderer', 'story']])
	const NativeFlow = () => React.createElement('div', { 'data-native-flow': '' }, '原生')
	const chat = { legacy: { partial: null, nodes: [], runningCalls: [] } }
	await mount(p, React.createElement(feature.StoryTranscriptFlow, {
		sessionId: 's1', store: store, nativeFlow: NativeFlow,
		useChat: selector => selector(chat), useSession: selector => selector({ running: false })
	}))
	assert.equal(p.dom.window.document.querySelectorAll('[data-story-row]').length, 3)
	assert.equal(p.dom.window.document.querySelector('[data-native-flow]'), null)
	assert.deepEqual(refreshes.map(item => item.sessionId), ['s1'])
	assert.ok(refreshes.every(item => item.options === undefined))
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

test('首个 partial 读取占位，turn 结束后重读提交且两行始终可见', async t => {
	const p = page(t), { context } = p
	const prepared = [...messages,
		{ role: 'user', text: '新行动', placeholder: true },
		{ role: 'assistant', turn: 10, text: '', placeholder: true, displayMode: 'html' }]
	const committed = [...messages, { role: 'user', text: '新行动' },
		{ role: 'assistant', turn: 10, text: '<p>提交后的正文</p>', displayMode: 'html' }]
	let calls = 0, phase = 'initial'
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async () => {
		calls++
		const current = phase === 'initial' ? messages : (phase === 'prepared' ? prepared : committed)
		return { storyTranscript: transcript(current, calls), view: { mode: 'story' }, revision: calls }
	} })
	const store = data.createStoryTranscriptStore(), mode = data.createModeStore()
	await store.read('s1')
	phase = 'prepared'
	const refreshes = []
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data, mode: mode,
		externalHistory: { refresh: (sessionId, options) => refreshes.push({ sessionId, options }) } })
	const chat = { legacy: { partial: { turn: 10, blocks: [{ kind: 'text', text: '流式草稿' }] }, nodes: [], runningCalls: [] } }
	const session = { running: true }
	const NativeFlow = () => React.createElement('div', { 'data-native-flow': '' })
	const element = () => React.createElement(feature.StoryTranscriptFlow, {
		sessionId: 's1', store: store, nativeFlow: NativeFlow,
		useChat: selector => selector(chat), useSession: selector => selector(session)
	})
	const root = await mount(p, element())
	await act(async () => Promise.resolve())
	assert.equal(calls, 2, '首个 partial 后读取已持久化的 prepare 占位')
	let rows = [...p.dom.window.document.querySelectorAll('[data-story-row]')]
	assert.equal(rows.length, prepared.length)
	assert.ok(rows.at(-2).textContent.includes('新行动'))
	assert.ok(rows.at(-1).textContent.includes('流式草稿'))
	const assistant = rows.at(-1), key = assistant.getAttribute('data-row-key')
	assert.equal(key, 'turn:10')

	chat.legacy = { partial: null, nodes: [], runningCalls: [] }
	await act(async () => root.render(element()))
	await act(async () => Promise.resolve())
	assert.equal(calls, 2, 'step 结束不等于 turn 提交，不提前用旧存档覆盖流式文本')
	assert.ok(p.dom.window.document.querySelector('main').textContent.includes('流式草稿'))
	assert.strictEqual([...p.dom.window.document.querySelectorAll('[data-story-row]')].at(-1), assistant)

	phase = 'committed'
	session.running = false
	chat.legacy = { partial: null, nodes: [{ kind: 'assistant', messageId: 'm10' }], runningCalls: [] }
	await act(async () => root.render(element()))
	await act(async () => Promise.resolve())
	assert.equal(calls, 3, 'turn/end 后才读取 await turn-stopping 完成的最终提交')
	rows = [...p.dom.window.document.querySelectorAll('[data-story-row]')]
	assert.equal(rows.length, committed.length)
	assert.ok(rows.at(-2).textContent.includes('新行动'))
	assert.strictEqual(rows.at(-1), assistant, '提交前后保留同一 article')
	assert.equal(rows.at(-1).getAttribute('data-row-key'), key)
	assert.ok(rows.at(-1).textContent.includes('提交后的正文'))
	assert.ok(!rows.at(-1).textContent.includes('正在生成'))
	assert.equal(p.dom.window.document.querySelector('[data-story-draft]'), null)
	assert.equal(refreshes.filter(item => item.options && item.options.force).length, 1, '生成收尾只主动裁剪一次旧原生回合')
	assert.equal(refreshes.at(-1).sessionId, 's1')
})

test('宿主一直报空闲时，流式正文结束会补读这一局，不用刷新页面', async t => {
	const p = page(t), { context } = p
	let calls = 0
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async () => {
		calls++
		return { storyTranscript: transcript(messages, calls), view: { mode: 'story' }, revision: calls }
	} })
	const store = data.createStoryTranscriptStore()
	await store.read('s1')
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data })
	// 重新生成与后台收尾都不一定会把 running 翻成 true：宿主全程报空闲。
	const chat = { legacy: { partial: { turn: 10, blocks: [{ kind: 'text', text: '流式草稿' }] }, nodes: [], runningCalls: [] } }
	const session = { running: false }
	const element = () => React.createElement(feature.StoryTranscriptFlow, {
		sessionId: 's1', store: store, nativeFlow: () => React.createElement('div', { 'data-native-flow': '' }),
		useChat: selector => selector(chat), useSession: selector => selector(session)
	})
	const root = await mount(p, element())
	await act(async () => Promise.resolve())
	const streamingCalls = calls
	chat.legacy = { partial: null, nodes: [], runningCalls: [] }
	await act(async () => root.render(element()))
	await act(async () => Promise.resolve())
	assert.ok(calls > streamingCalls, '流式结束后应补读一次故事，不能等玩家刷新')
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

test('真实 story-flow 槽向尾部投影注入会话级 executeSlash', async t => {
	const p = page(t), { context } = p
	const executeSlash = () => Promise.resolve({ drafted: true })
	const projections = []
	let executorCreations = 0
	context.createTavernFrameSlashExecutor = ctx => { executorCreations++; assert.ok(ctx); return executeSlash }
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async () => ({
		storyTranscript: transcript([{ role: 'assistant', turn: 2, text: '尾部选项', displayMode: 'html' }]),
		view: { mode: 'story' }, revision: 1
	}) })
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data, renderProjection: (projection, options) => {
		projections.push({ projection, options })
		return React.createElement('div', { 'data-tail-frame': '' }, projection.text)
	} })
	const NativeFlow = () => null
	const registrations = []
	const slots = {
		inject: (_name, contribute) => contribute(),
		register: (options, component) => { registrations.push({ options, component }); return () => {} },
		entries: () => [{ component: NativeFlow }], subscribe: () => () => {}
	}
	feature.register({ ctx: { effect: run => run() }, slots })
	assert.equal(executorCreations, 1)
	const flow = registrations.find(entry => entry.options.name === 'conversation.chat.flow')
	await mount(p, React.createElement(flow.component, {
		sessionId: 's1', useChat: selector => selector({ legacy: { partial: null, runningCalls: [] } }),
		useSession: selector => selector({ running: false })
	}))
	await act(async () => { await new Promise(resolve => setImmediate(resolve)) })
	assert.ok(projections.length > 0)
	assert.strictEqual(projections.at(-1).options.executeSlash, executeSlash)
	assert.ok(p.dom.window.document.querySelector('[data-tail-frame]'))
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
