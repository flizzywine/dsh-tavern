import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

import { projectStoryTranscript } from '../tavern-plugin/lib/domain/story-transcript.js'

const dataSource = await readFile(new URL('../tavern-plugin/src/client/features/story-transcript-data.js', import.meta.url), 'utf8')
const refreshSource = await readFile(new URL('../tavern-plugin/src/client/modules/session-refresh-controller.js', import.meta.url), 'utf8')
const listSource = await readFile(new URL('../tavern-plugin/src/client/features/story-transcript-list.js', import.meta.url), 'utf8')
const deletionSource = await readFile(new URL('../tavern-plugin/src/client/features/message-deletion.js', import.meta.url), 'utf8')
const playControlsSource = await readFile(new URL('../tavern-plugin/src/client/features/play-controls.js', import.meta.url), 'utf8')

// 一个页面 DOM + 两个 @include 片段共用同一个 factory 作用域（data 先、list 后）。
function createPage(t, extra) {
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
	const context = vm.createContext(Object.assign({
		React, AbortController, console,
		window: dom.window, document: dom.window.document, CustomEvent: dom.window.CustomEvent,
		// 宿主 Markdown 原语的替身：记录文本，证明正文走 Markdown 而不是纯文本 <pre>。
		DshUi: {
			MarkdownText: function (props) { return React.createElement('span', { className: 'md-text' }, 'MD[' + props.text + ']') },
			Tooltip: props => props.children,
			IconEditOutlineRegular: icon('edit'), IconBranchOutlineRegular: icon('branch'),
			IconCopyOutlineRegular: icon('copy'), IconCheckOutlineRegular: icon('check'),
			writeClipboard: async text => { dom.window.__copiedText = text; return true }
		},
		tavernProjectionForTurn: (view, turn) => (view && Array.isArray(view.replyProjections) ? view.replyProjections : []).findLast(item => Number(item.turn) === Number(turn)) || null,
		tavernLatestProjectionTurn: view => (view && Array.isArray(view.replyProjections) ? view.replyProjections : []).reduce((latest, item) => Math.max(latest, Number(item.turn) || 0), 0)
	}, extra || {}))
	vm.runInContext(refreshSource, context)
	vm.runInContext(dataSource, context)
	if (extra && extra.enableStoryDeletion) {
		vm.runInContext(deletionSource, context)
		vm.runInContext('globalThis.__storyMessageDeletion = messageDeletionFeature', context)
	}
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

test('故事正文使用所属原生轮次的用量和时间，重生成后跟随新轮次', async t => {
	const page = createPage(t)
	const renderSlotCalls = []
	const saved = story([
		{ role: 'assistant', greeting: true, turn: 1, text: '开场' },
		{ role: 'assistant', turn: 2, text: '历史正文' },
		{ role: 'assistant', turn: 3, text: '重生成后的正文' },
		{ role: 'assistant', turn: 4, text: '未完成', placeholder: true },
		{ role: 'assistant', turn: 5, text: '没有原生用量' }
	])
	saved.messages[0].nativeTurn = 1
	saved.messages[1].nativeTurn = 9
	saved.messages[2].nativeTurn = 12
	saved.messages[3].nativeTurn = 4
	function nativeTurn(turn, totalTokens) {
		const tail = { turn, tokenUsage: { totalTokens }, closing: { time: turn, finalNode: { seq: turn + 100, messageId: 'out-' + turn } } }
		const source = { subscribe: () => () => {}, getSnapshot: () => tail }
		return { turn, data: { source: () => source } }
	}
	const turns = new Map([[1, nativeTurn(1, 0)], [9, nativeTurn(9, 38200)], [3, nativeTurn(3, 100)],
		[12, nativeTurn(12, 19500)], [4, nativeTurn(4, 500)]])
	const turnFooter = {
		useChat: selector => selector({ timeline: { turns } }),
		renderSlot: (slot, owner, options) => {
			renderSlotCalls.push({ slot, owner, options })
			return React.createElement('span', null, owner.node.data.tokenUsage.totalTokens)
		}
	}
	const feature = page.context.createTavernStoryTranscriptFeature()
	await mount(page, React.createElement(feature.StoryTranscriptList, {
		transcript: saved, sessionId: 'game', turnFooter
	}))
	const rows = [...page.dom.window.document.querySelectorAll('[data-story-row]')]
	assert.deepEqual(rows.map(row => row.querySelector('.dsh-tavern-story-turn-footer')?.textContent ?? null),
		[null, '38200', '19500', null, null])
	assert.deepEqual(renderSlotCalls.map(call => [call.slot, call.options.entryKey, call.owner.node.location.turn.turn]),
		[['conversation.chat.node', 'turn-tail', 9], ['conversation.chat.node', 'turn-tail', 12]])
	for (const { owner } of renderSlotCalls) assert.equal(owner.node.data.closing.finalNode.messageId, undefined)
})

test('楼层操作用故事正文和稳定轮次，回退提交确认过的消息 UID', async t => {
	const calls = []
	const page = createPage(t, {
		isPlayMode: mode => mode === 'story',
		useLiveTavernView: () => ({ view }),
		tavernMvuReceiptForTurn: (_view, turn) => turn === 12 ? { status: 'updated' } : null,
		useTavernConfirm: () => async text => { calls.push(text); return true },
		rpc: async (method, args, sessionId) => { calls.push({ method, ...args, sessionId }); return {} },
		historyProjection: { rolledBack() {} },
		setCandidatePanel() {}, setRegenPanel() {}, setCandidateGuidePanel() {},
		notifyTavernDataChanged() {},
		liveTavernView: { setView() {}, invalidate() {} }, tavernCoordination: { invalidate() {} }
	})
	const view = { mode: 'story', canRollback: true, rollbackTargetTurn: 19, settlementTurn: 12 }
	const saved = story([
		{ role: 'assistant', turn: 2, text: '重号正文甲' },
		{ role: 'assistant', turn: 2, text: '重号正文乙' },
		{ role: 'assistant', turn: 12, text: '可回退的正文', messageUid: 'story-12' },
		{ role: 'assistant', turn: 19, text: '最新正文' },
		{ role: 'user', text: '玩家输入' }
	])
	const button = (label, value) => React.createElement('button', { 'aria-label': label }, value)
	const rollback = vm.runInContext(playControlsSource.slice(
		playControlsSource.indexOf('function TavernRollbackToTurnButton('),
		playControlsSource.indexOf('const bodyEditPanel =')
	) + '\nTavernRollbackToTurnButton', page.context)
	const feature = page.context.createTavernStoryTranscriptFeature({
		replyActions: {
			useReadAloudState: () => ({ auto: false }),
			ReadAloud: props => button('朗读', props.source),
			Illustrate: props => button('配图', props.turn),
			Receipt: props => button('变量结算', props.storyTurn),
			Latest: () => button('更多'),
			RollbackTo: rollback,
			IllustrationDraft: () => null, PluginActions: () => null
		}
	})
	await mount(page, React.createElement(feature.StoryTranscriptList, { sessionId: 'game', transcript: saved, view, host: {} }))
	const document = page.dom.window.document
	const [duplicate, , historical, latest, user] = document.querySelectorAll('[data-story-row]')
	const action = (row, label) => row.querySelector('button[aria-label="' + label + '"]')
	assert.equal(action(duplicate, '朗读').textContent, '重号正文甲')
	assert.equal(action(duplicate, '配图'), null)
	assert.equal(action(duplicate, '回退到这一轮'), null)
	assert.equal(action(historical, '配图').textContent, '12')
	assert.equal(action(historical, '变量结算').textContent, '12')
	assert.equal(action(historical, '更多'), null)
	assert.ok(action(latest, '更多'))
	assert.equal(action(latest, '回退到这一轮'), null)
	assert.equal(action(user, '朗读'), null)
	await act(async () => action(historical, '回退到这一轮').click())
	assert.match(calls[0], /回退到第 3 楼/)
	assert.deepEqual(calls[1], { method: 'rollbackToTurn', turn: 12, messageUid: 'story-12', sessionId: 'game' })
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


test('缓存会话快照按目标读取，不从当前槽继承', async t => {
	const page = createPage(t)
	const other = story([{ role: 'assistant', turn: 1, text: '另一个会话' }], 2)
	const data = page.context.createTavernStoryTranscriptDataModule({ rpc: async (_method, args) => ({
		storyTranscript: args.sessionId === 's1' ? story(MESSAGES) : other,
		view: { mode: 'story' }, revision: 1
	}) })
	const store = data.createStoryTranscriptStore()
	await store.read('s1')
	await store.read('s2')
	assert.equal(store.getSnapshot().sessionId, 's2')
	assert.equal(store.snapshotFor('s1', null).sessionId, 's1')
	assert.equal(store.snapshotFor('s1', null).transcript.messages[0].message.text, '开场正文')
	assert.equal(store.snapshotFor('missing', null).status, 'idle', '没有缓存的会话不从 s2 继承正文')
})

test('a failed round shows its reason under the kept input, and only while that input is the tail', async t => {
	const page = createPage(t)
	const feature = page.context.createTavernStoryTranscriptFeature()
	const failed = story([{ role: 'assistant', greeting: true, turn: 1, text: '开场' }, { role: 'user', text: '叫我陈默' }])
	const view = { mode: 'story', foregroundError: { turn: 3, message: '这一轮没有生成正文：API error (400)' } }
	const root = await mount(page, React.createElement(feature.StoryTranscriptList, { transcript: failed, view, sessionId: 's' }))
	const alert = page.dom.window.document.querySelector('[role="alert"]')
	assert.equal(alert.textContent, '⚠ 这一轮没有生成正文：API error (400)')
	assert.ok(page.dom.window.document.querySelector('[data-story-row]:last-of-type').compareDocumentPosition(alert) & page.dom.window.Node.DOCUMENT_POSITION_FOLLOWING)
	// A retry is running: the reason leaves with the failure.
	await act(async () => root.render(React.createElement(feature.StoryTranscriptList, { transcript: failed, view, sessionId: 's', running: true })))
	assert.equal(page.dom.window.document.querySelector('[role="alert"]'), null)
})

test('故事楼层保留受信任脚本层、开场脚本挂载、正文下方状态栏与长历史旧楼层投影回退', async t => {
	const receivedOptions = []
	let legacyMounted = 0
	const page = createPage(t, {
		isPlayMode: mode => mode === 'story',
		useLiveTavernView: () => ({ view: liveWindowView }),
		mountTavernLegacyMessage: ({ node }) => {
			legacyMounted++
			node.textContent = 'legacy-mounted'
			return () => {}
		},
		TavernPersistentStatusRuntime: props => React.createElement('div', { 'data-inline-status': props.panels }, props.sessionId),
		TavernMessageFrame: props => React.createElement('div', { 'data-user-template': props.partIndex }, props.content)
	})
	const saved = story([
		{ role: 'assistant', greeting: true, turn: 1, text: '开场原文' },
		{ role: 'user', text: '原始输入' },
		{ role: 'assistant', turn: 2, text: '第二楼原文' },
		{ role: 'assistant', turn: 50, text: '最新楼原文' }
	], 10)
	// storyView 覆盖当前读取的旧楼层 turn 2；liveWindowView 只包含最近窗口 turn 50。
	const storyView = {
		mode: 'story',
		statusBarPlacement: 'body',
		tavernRuntimePolicy: { trustedCardMode: true },
		tavernHelper: { stateRevision: 10, messages: [{ message_id: 0, role: 'assistant', message: '开场完整脚本源' }] },
		inputTemplateDisplays: { '2': '<b>模板化玩家输入</b>' },
		replyProjections: [
			{ version: 2, turn: 1, mode: 'markdown', text: '开场正则投影' },
			{ version: 2, turn: 2, mode: 'html', text: '<div>旧楼层人物卡面板</div>' },
			{ version: 2, turn: 50, mode: 'markdown', text: '最新楼投影' }
		]
	}
	const liveWindowView = {
		mode: 'story',
		statusBarPlacement: 'body',
		historyWindow: { onDemand: true, from: 40, to: 50, messageCount: 51, revision: 10 },
		tavernRuntimePolicy: { trustedCardMode: true },
		tavernHelper: { stateRevision: 10, messages: [{ message_id: 0, role: 'assistant', message: '开场完整脚本源' }] },
		replyProjections: [
			{ version: 2, turn: 50, mode: 'markdown', text: '最新楼窗口投影' }
		]
	}
	const feature = page.context.createTavernStoryTranscriptFeature({
		renderProjection: (projection, options) => {
			receivedOptions.push({ turn: options.turn, mode: projection.mode, text: projection.text, scriptLayer: options.scriptLayer, eagerFrame: options.eagerFrame })
			return React.createElement('div', { 'data-rendered-turn': String(options.turn), 'data-mode': projection.mode }, projection.text)
		}
	})
	await mount(page, React.createElement(feature.StoryTranscriptList, {
		transcript: saved, view: storyView, sessionId: 's-switch'
	}))
	const doc = page.dom.window.document
	assert.equal(legacyMounted, 1, '受信任模式开场楼层应挂载 legacy greeting 容器')
	assert.equal(doc.querySelector('[data-user-template="user-template"]')?.textContent, '<b>模板化玩家输入</b>', '玩家输入模板应渲染')
	assert.equal(doc.querySelector('[data-rendered-turn="2"]')?.getAttribute('data-mode'), 'html', '超出 liveView 窗口的旧楼层应回退使用 storyView 的完整 HTML 投影而非退回纯文本')
	assert.equal(doc.querySelector('[data-rendered-turn="50"]')?.textContent, '最新楼窗口投影')
	assert.equal(JSON.stringify(receivedOptions.map(item => item.scriptLayer)), JSON.stringify([
		{ sessionId: 's-switch', messageId: 0 },
		{ sessionId: 's-switch', messageId: 2 },
		{ sessionId: 's-switch', messageId: 3 }
	]), '每层正文应传递绝对 messageId 供 retrieveDisplayedMessage 脚本改写')
	const inlineStatuses = doc.querySelectorAll('[data-inline-status="status"]')
	assert.equal(inlineStatuses.length, 1, 'statusBarPlacement=body 时仅在最新楼层下方渲染状态栏')
	assert.equal(inlineStatuses[0].closest('article')?.getAttribute('data-row-key'), 'turn:50')
})
