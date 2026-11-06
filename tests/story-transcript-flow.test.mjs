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

test('直接显示宿主待发送用户回声，接受后替换为正式行', async t => {
	const p = page(t), { context } = p
	const prepared = [...messages.slice(0, 1), { role: 'user', text: '立即显示输入', source: { kind: 'user', rpcId: 'submit-1' } }, { role: 'assistant', turn: 10, text: '', placeholder: true }]
	let phase = 'initial'
	const reads = []
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async () => {
		reads.push(phase)
		return { storyTranscript: transcript(phase === 'initial' ? messages : prepared, reads.length), view: { mode: 'story' }, revision: reads.length }
	} })
	const store = data.createStoryTranscriptStore(), mode = data.createModeStore()
	await store.read('s1')
	phase = 'prepared'
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data, mode,
		externalHistory: { refresh() {}, dispose() {} } })
	const session = { running: false, pendingSubmissions: [] }, chat = { legacy: { partial: null, nodes: [], runningCalls: [] } }
	const flow = () => React.createElement(feature.StoryTranscriptFlow, {
		sessionId: 's1', store, nativeFlow: () => null,
		useChat: selector => selector(chat), useSession: selector => selector(session)
	})
	const root = await mount(p, flow())
	assert.deepEqual(reads, ['initial'])
	assert.equal(p.dom.window.document.querySelectorAll('article').length, messages.length)
	await act(async () => {
		session.pendingSubmissions = [{ requestId: 'submit-1', text: '立即显示输入' }]
		root.render(flow())
	})
	assert.deepEqual(reads, ['initial'], '宿主回声直接上屏，不读取历史')
	assert.equal(p.dom.window.document.querySelectorAll('article').length, messages.length + 1, '只增加用户输入，不伪造助手行')
	assert.equal([...p.dom.window.document.querySelectorAll('.dsh-tavern-user-bubble')].at(-1).textContent, '立即显示输入')
	await act(async () => {
		p.dom.window.dispatchEvent(new p.dom.window.CustomEvent('dsh-tavern-story-mutated', { detail: { sessionId: 's1' } }))
	})
	assert.deepEqual(reads, ['initial', 'prepared'])
	assert.equal(p.dom.window.document.querySelectorAll('article').length, prepared.length, 'requestId 相同则正式行与宿主回声只显示一份')
	assert.equal(p.dom.window.document.querySelector('.dsh-tavern-user-bubble').textContent, '立即显示输入')
	assert.ok(p.dom.window.document.querySelector('.dsh-tavern-story-streaming'))
	await act(async () => { session.pendingSubmissions = []; root.render(flow()) })
	assert.equal(p.dom.window.document.querySelectorAll('article').length, prepared.length)
})

test('原生用户行接棒待发送回声，故事读取完成前不出现空白', async t => {
	const p = page(t), { context } = p
	const prepared = [...messages.slice(0, 1), { role: 'user', text: '立即显示输入', source: { kind: 'user', rpcId: 'submit-1' } }, { role: 'assistant', turn: 10, text: '', placeholder: true }]
	let phase = 'initial'
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async () => ({
		storyTranscript: transcript(phase === 'initial' ? messages : prepared, phase === 'initial' ? 1 : 2),
		view: { mode: 'story' }, revision: phase === 'initial' ? 1 : 2
	}) })
	const store = data.createStoryTranscriptStore(), mode = data.createModeStore()
	await store.read('s1')
	phase = 'prepared'
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data, mode,
		externalHistory: { refresh() {}, dispose() {} } })
	const session = { running: true, pendingSubmissions: [{ requestId: 'submit-1', text: '立即显示输入' }] }
	const chat = { legacy: { partial: null, nodes: [], runningCalls: [] } }
	const flow = () => React.createElement(feature.StoryTranscriptFlow, {
		sessionId: 's1', store, nativeFlow: () => null,
		useChat: selector => selector(chat), useSession: selector => selector(session)
	})
	const root = await mount(p, flow())
	const visibleRow = () => [...p.dom.window.document.querySelectorAll('article[data-story-row]')].find(row => row.textContent.includes('立即显示输入'))
	assert.equal(visibleRow()?.getAttribute('data-row-key'), 'submission:submit-1')
	await act(async () => {
		chat.legacy.nodes = [{ kind: 'user', content: [{ type: 'text', text: '立即显示输入' }], source: { kind: 'user', rpcId: 'submit-1' } }]
		session.pendingSubmissions = []
		root.render(flow())
	})
	assert.equal(visibleRow()?.getAttribute('data-row-key'), 'submission:submit-1', '宿主撤回回声后由同 key 的原生用户行接棒')
	assert.equal(p.dom.window.document.querySelectorAll('article').length, messages.length + 1)
	await act(async () => {
		p.dom.window.dispatchEvent(new p.dom.window.CustomEvent('dsh-tavern-story-mutated', { detail: { sessionId: 's1' } }))
	})
	assert.equal(p.dom.window.document.querySelectorAll('article').length, prepared.length)
	assert.notEqual(visibleRow()?.getAttribute('data-row-key'), 'submission:submit-1')
	assert.equal([...p.dom.window.document.querySelectorAll('.dsh-tavern-user-bubble')].filter(node => node.textContent === '立即显示输入').length, 1)
})

test('宿主撤回待发送回声后用户输入同步消失', async t => {
	const p = page(t), { context } = p
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async () => ({ storyTranscript: transcript(messages), view: { mode: 'story' }, revision: 1 }) })
	const store = data.createStoryTranscriptStore(), mode = data.createModeStore()
	await store.read('s1')
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data, mode,
		externalHistory: { refresh() {}, dispose() {} } })
	const session = { running: false, pendingSubmissions: [{ requestId: 'submit-failed', text: '失败后撤回' }] }
	const chat = { legacy: { partial: null, nodes: [], runningCalls: [] } }
	const flow = () => React.createElement(feature.StoryTranscriptFlow, {
		sessionId: 's1', store, nativeFlow: () => null,
		useChat: selector => selector(chat), useSession: selector => selector(session)
	})
	const root = await mount(p, flow())
	assert.equal([...p.dom.window.document.querySelectorAll('.dsh-tavern-user-bubble')].at(-1).textContent, '失败后撤回')
	await act(async () => { session.pendingSubmissions = []; root.render(flow()) })
	assert.equal(p.dom.window.document.querySelectorAll('article').length, messages.length)
	assert.equal([...p.dom.window.document.querySelectorAll('.dsh-tavern-user-bubble')].some(node => node.textContent === '失败后撤回'), false)
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
