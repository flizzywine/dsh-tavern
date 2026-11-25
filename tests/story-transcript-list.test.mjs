import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { withStyleReferenceProtocol } from './helpers/style-reference-source.mjs'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { JSDOM } from 'jsdom'

import { projectStoryTranscript } from '../tavern-plugin/lib/domain/story-transcript.js'

const dataSource = await readFile(new URL('../tavern-plugin/src/client/features/story-transcript-data.js', import.meta.url), 'utf8').then(withStyleReferenceProtocol)
const refreshSource = await readFile(new URL('../tavern-plugin/src/client/modules/session-refresh-controller.js', import.meta.url), 'utf8')
const listSource = await readFile(new URL('../tavern-plugin/src/client/features/story-transcript-list.js', import.meta.url), 'utf8')
const deletionSource = await readFile(new URL('../tavern-plugin/src/client/features/message-deletion.js', import.meta.url), 'utf8')
const playControlsSource = await readFile(new URL('../tavern-plugin/src/client/features/play-controls.js', import.meta.url), 'utf8')
const turnActionsSource = await readFile(new URL('../tavern-plugin/src/client/turn-actions.js', import.meta.url), 'utf8')

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

test('楼层操作用故事正文和稳定轮次，回退提交确认过的消息 UID', async t => {
	const calls = []
	const button = (label, value) => React.createElement('button', { 'aria-label': label }, value)
	const page = createPage(t, {
		isPlayMode: mode => mode === 'story',
		useLiveTavernView: () => ({ view }),
		tavernMvuReceiptForTurn: (_view, turn) => turn === 12 ? { status: 'updated' } : null,
		useTavernConfirm: () => async text => { calls.push(text); return true },
		rpc: async (method, args, sessionId) => {
			calls.push({ method, ...args, sessionId })
			return method === 'getBodyEdit' ? { edit: { messageUid: args.messageUid, parts: [{ kind: 'text', text: args.text }] } } : {}
		},
		bodyPortal: element => createPortal(element, document.body),
		TavernRollbackAction: () => button('回退本轮'), TavernUndoRollbackAction: () => null, CandidateAction: () => null,
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
	const menus = vm.runInContext(turnActionsSource.slice(turnActionsSource.indexOf('function usePopover('), turnActionsSource.indexOf('function ReceiptButton('))
		+ turnActionsSource.slice(turnActionsSource.indexOf('function TurnMenu('), turnActionsSource.indexOf('const compactionRuns'))
		+ '\n({ TurnMenu, LatestReplyActions })', page.context)
	const rollback = vm.runInContext(playControlsSource.slice(
		playControlsSource.indexOf('function TavernRollbackToTurnButton('),
		playControlsSource.indexOf('const bodyEditPanel =')
	) + '\nTavernRollbackToTurnButton', page.context)
	const feature = page.context.createTavernStoryTranscriptFeature({
		replyActions: {
			Illustrate: props => button('配图', props.turn),
			Receipt: props => button('变量结算', props.storyTurn),
			Latest: menus.LatestReplyActions,
			Menu: menus.TurnMenu,
			RollbackTo: rollback,
			IllustrationDraft: () => null, PluginActions: () => null
		}
	})
	await mount(page, React.createElement(feature.StoryTranscriptList, { sessionId: 'game', transcript: saved, view, host: {} }))
	const document = page.dom.window.document
	const [duplicate, , historical, latest, user] = document.querySelectorAll('[data-story-row]')
	const action = (row, label) => row.querySelector('button[aria-label="' + label + '"]')
	// 有声书 (the 顶栏 speaker) reads the story; a reply has no 🔊 of its own (owner 11-18)
	assert.equal(duplicate.querySelector('[data-fork-turn="speech"]'), null)
	assert.equal(action(duplicate, '配图'), null)
	assert.equal(action(duplicate, '回退到这一轮'), null)
	assert.equal(action(historical, '配图').textContent, '12')
	assert.equal(action(historical, '变量结算').textContent, '12')
	assert.ok(action(historical, '更多'))
	assert.ok(action(latest, '更多'))
	assert.equal(action(latest, '回退到这一轮'), null)
	await act(async () => action(historical, '回退到这一轮').click())
	assert.match(calls[0], /回退到第 3 楼/)
	assert.deepEqual(calls[1], { method: 'rollbackToTurn', turn: 12, messageUid: 'story-12', sessionId: 'game' })
	let openedEdit
	page.dom.window.addEventListener('dsh-tavern-open-body-edit', event => { openedEdit = event.detail }, { once: true })
	await act(async () => action(historical, '更多').click())
	const oldMenu = document.querySelector('.fork-turn-menu')
	assert.equal(oldMenu.querySelector('[aria-label="回退本轮"]'), null)
	await act(async () => oldMenu.querySelector('[role="menuitem"]').click())
	assert.deepEqual(calls[2], { method: 'getBodyEdit', role: 'assistant', messageIndex: 2, revision: 7, messageUid: 'story-12', text: '可回退的正文', sessionId: 'game' })
	assert.equal(openedEdit.texts[0], '可回退的正文')
	await act(async () => action(latest, '更多').click())
	const latestMenu = Array.from(document.querySelectorAll('.fork-turn-menu')).find(menu => menu.querySelector('[aria-label="回退本轮"]'))
	assert.equal(latestMenu?.querySelector('[role="menuitem"]')?.textContent, '编辑正文')
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


test('流式显示思维链在已提交楼层随 useChat 恢复多步思维链', async t => {
	const page = createPage(t)
	page.context.useTavernReasoningStreamEnabled = () => true
	const turnSteps = [
		{ data: { get: key => (key === 'assistant-step' ? { blocks: [{ kind: 'reasoning', text: '第一段推理' }, { kind: 'tool-call', name: 'tavern_state' }] } : null) } },
		{ data: { get: key => (key === 'assistant-step' ? { blocks: [{ kind: 'reasoning', text: '第二段推理' }, { kind: 'text', text: '已提交正文' }] } : null) } }
	]
	const host = {
		useChat: selector => selector({
			timeline: { turns: new Map([[11, { status: 'closed', steps: turnSteps }]]) }
		})
	}
	const React = page.context.React
	const feature = page.context.createTavernStoryTranscriptFeature({
		renderProjection: projection => React.createElement('div', { className: 'test-proj' }, projection.text)
	})
	const committed = story([
		{ role: 'user', text: '玩家发言' },
		{ role: 'assistant', turn: 1, text: '已提交正文' }
	], 2)
	committed.messages[1].nativeTurn = 11
	await mount(page, React.createElement(feature.StoryTranscriptList, {
		transcript: committed, view: { mode: 'story' }, sessionId: 's-reasoning-toggle-on', host
	}))
	const doc = page.dom.window.document
	const box = doc.querySelector('details.dsh-tavern-stream-reasoning')
	assert.ok(box, '已提交楼层应通过 nativeTurn 汇总展示思维链')
	assert.equal(box.open, false, '已提交楼层默认收起')
	assert.ok(box.textContent.includes('第一段推理') && box.textContent.includes('第二段推理'))
})

test('流式思考超过折叠框高度时自动滚到底部，上翻阅读时暂停跟随、回到底部后恢复', async t => {
	const page = createPage(t)
	page.context.useTavernReasoningStreamEnabled = () => true
	const feature = page.context.createTavernStoryTranscriptFeature({
		renderProjection: projection => React.createElement('div', { className: 'test-proj' }, projection.text)
	})
	const pending = story([
		{ role: 'user', text: '玩家行动' },
		{ role: 'assistant', turn: 1, placeholder: true, text: '' }
	], 1)
	const element = (partial, running = true) => React.createElement(feature.StoryTranscriptList, {
		transcript: pending, partial, running, view: { mode: 'story' }, sessionId: 's-reasoning-scroll'
	})
	const root = await mount(page, element({ turn: 1, step: 0, blocks: [{ kind: 'reasoning', text: '第一段' }] }))
	const pre = page.dom.window.document.querySelector('details.dsh-tavern-stream-reasoning pre')
	assert.ok(pre)
	let scrollHeight = 520
	const clientHeight = 200
	let scrollTop = 0
	Object.defineProperty(pre, 'clientHeight', { configurable: true, get: () => clientHeight })
	Object.defineProperty(pre, 'scrollHeight', { configurable: true, get: () => scrollHeight })
	Object.defineProperty(pre, 'scrollTop', {
		configurable: true,
		get: () => scrollTop,
		set(value) { scrollTop = Math.max(0, Math.min(Math.max(0, scrollHeight - clientHeight), Number(value) || 0)) }
	})

	await act(async () => root.render(element({ turn: 1, step: 0, blocks: [{ kind: 'reasoning', text: '第一段\n第二段' }] })))
	assert.equal(scrollTop, 320, '流式新增思考内容时应自动滚到底部')

	// 模拟用户手动向上滚动查看前文
	scrollTop = 60
	await act(async () => {
		pre.dispatchEvent(new page.dom.window.Event('scroll'))
	})
	scrollHeight = 680
	await act(async () => root.render(element({ turn: 1, step: 0, blocks: [{ kind: 'reasoning', text: '第一段\n第二段\n第三段' }] })))
	assert.equal(scrollTop, 60, '用户手动上翻后不得强制拉回底部')

	// 模拟用户拉回底部后恢复自动跟随
	scrollTop = 475
	await act(async () => {
		pre.dispatchEvent(new page.dom.window.Event('scroll'))
	})
	scrollHeight = 820
	await act(async () => root.render(element({ turn: 1, step: 0, blocks: [{ kind: 'reasoning', text: '第一段\n第二段\n第三段\n第四段' }] })))
	assert.equal(scrollTop, 620, '用户回到底部后应恢复自动滚动')

	// 未回到底部时进入工具步收起，再进入下一步思考应重新恢复自动跟随
	scrollTop = 100
	await act(async () => {
		pre.dispatchEvent(new page.dom.window.Event('scroll'))
	})
	await act(async () => root.render(element({ turn: 1, step: 0, blocks: [{ kind: 'reasoning', text: '第一段\n第二段\n第三段\n第四段' }, { kind: 'tool-call', name: 'tavern_state' }] })))
	scrollHeight = 960
	await act(async () => root.render(element({ turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: '第二步继续思考' }] })))
	assert.equal(scrollTop, 760, '新一步思考重新展开时应自动滚到最新位置')
})
