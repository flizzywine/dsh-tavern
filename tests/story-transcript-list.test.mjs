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
const deletionSource = await readFile(new URL('../tavern-plugin/src/client/features/message-deletion.js', import.meta.url), 'utf8')
const tavernCss = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')

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
		React, console,
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

test('重新生成时流式正文按视图的 messageUid 落到目标行，不碰同 turn 与后续行', async t => {
	const page = createPage(t)
	const { dom, context } = page
	const messages = [
		{ role: 'user', turn: 1, text: '输入一' },
		{ role: 'assistant', turn: 1, text: '目标旧正文', messageUid: 'uid-target' },
		{ role: 'assistant', turn: 1, text: '同轮旧正文', messageUid: 'uid-sibling' },
		{ role: 'user', turn: 2, text: '输入二' },
		{ role: 'assistant', turn: 2, text: '后续旧正文', messageUid: 'uid-next' }
	]
	const transcript = story(messages, 1)
	const regenerating = { mode: 'story', regenInProgress: true, streamingMessageUid: 'uid-target', latestAssistantTurn: 2 }
	const feature = context.createTavernStoryTranscriptFeature()
	const element = (value, partial, running, view) => React.createElement(feature.StoryTranscriptList, {
		transcript: value, partial, running, view, sessionId: 's-regen'
	})
	const root = await mount(page, element(transcript, null, true, regenerating))
	const rowsOf = () => [...dom.window.document.querySelectorAll('[data-story-row][data-role="assistant"]')]
	// 重新生成一开始就把被替换的旧正文撤下页面，只留下一轮输入和别的楼层。
	let rows = rowsOf()
	assert.equal(rows.length, 2, '被替换的旧正文不在页面上')
	assert.ok(!rows.some(row => row.textContent.includes('目标旧正文')))
	assert.ok(rows[0].textContent.includes('同轮旧正文'), '同 turn 的兄弟行不受影响')
	assert.ok(rows[1].textContent.includes('后续旧正文'))
	const keyOfTarget = transcript.messages[1].key
	const partial = { turn: 0, blocks: [{ kind: 'text', text: '流式新正文' }] }
	await act(async () => root.render(element(transcript, partial, true, regenerating)))
	rows = rowsOf()
	assert.equal(rows.length, 3, '不得追加草稿行')
	assert.ok(rows[0].textContent.includes('流式新正文'), '目标 UID 行承载流式正文')
	assert.ok(rows[0].textContent.includes('正在生成'))
	assert.equal(rows[0].getAttribute('data-row-key'), keyOfTarget, '流式更新复用同一 article')
	assert.ok(rows[1].textContent.includes('同轮旧正文'), '同 turn 的兄弟行不得被覆盖')
	assert.ok(!rows[1].textContent.includes('正在生成'))
	assert.ok(rows[2].textContent.includes('后续旧正文'), 'latestAssistantTurn 指向的后续行不得被覆盖')
	assert.ok(!rows[2].textContent.includes('正在生成'))

	const nextPartial = { turn: 0, blocks: [{ kind: 'text', text: '第二段流式' }] }
	await act(async () => root.render(element(transcript, nextPartial, true, regenerating)))
	rows = rowsOf()
	assert.ok(rows[0].textContent.includes('第二段流式'))
	assert.ok(rows[1].textContent.includes('同轮旧正文'))
	assert.ok(rows[2].textContent.includes('后续旧正文'))

	const committed = story(messages.map(message => message.messageUid === 'uid-target'
		? { ...message, text: '正式新正文' } : message), 2)
	await act(async () => root.render(element(committed, null, false, { mode: 'story' })))
	rows = rowsOf()
	assert.ok(rows[0].textContent.includes('正式新正文'))
	assert.ok(!rows[0].textContent.includes('正在生成'))
	assert.ok(rows[1].textContent.includes('同轮旧正文'))
	assert.ok(rows[2].textContent.includes('后续旧正文'))
})

test('实时视图不参与流式与正式故事行的显隐', async t => {
	const page = createPage(t)
	const { dom, context } = page
	const targetUid = 'legacy-target'
	const transcript = story([
		{ role: 'assistant', turn: 1, text: '开场', messageUid: 'uid-opening' },
		{ role: 'user', text: 'ok' },
		{ role: 'assistant', turn: 2, text: '', messageUid: targetUid, placeholder: true, regenerationDiscarded: true }
	], 71)
	const storedView = { mode: 'story', regenInProgress: true, streamingMessageUid: targetUid,
		latestAssistantTurn: 2, tavernHelper: { stateRevision: 71 } }
	let staleLiveView = { mode: 'story', regenInProgress: false, streamingMessageUid: null,
		latestAssistantTurn: 2, tavernHelper: { stateRevision: 71 } }
	context.useLiveTavernView = () => ({ view: staleLiveView })
	context.liveTavernView = { getSnapshot: () => ({ view: staleLiveView }) }
	const feature = context.createTavernStoryTranscriptFeature()
	const element = (value, partial, running, view) => React.createElement(feature.StoryTranscriptList, {
		transcript: value, sessionId: 's-single-story-view', running, partial, view
	})
	const root = await mount(page, element(transcript,
		{ turn: 18, blocks: [{ kind: 'text', text: '新一轮流式正文' }] }, true, storedView))
	const assistants = [...dom.window.document.querySelectorAll('[data-story-row][data-role="assistant"]')]
	assert.equal(assistants.length, 2, '流式目标行只由故事视图决定')
	assert.ok(assistants[0].textContent.includes('开场'))
	assert.ok(assistants[1].textContent.includes('新一轮流式正文'))
	assert.ok(assistants[1].textContent.includes('正在生成'))
	assert.equal(assistants[1].getAttribute('data-row-key'), 'turn:2')

	// 提交后实时视图即使仍停留在生成状态，也不能再过滤故事存档里的正式正文。
	const committed = story([
		{ role: 'assistant', turn: 1, text: '开场', messageUid: 'uid-opening' },
		{ role: 'user', text: 'ok' },
		{ role: 'assistant', turn: 2, text: '已经提交的正式正文', messageUid: targetUid }
	], 79)
	staleLiveView = { mode: 'story', regenInProgress: true, streamingMessageUid: targetUid,
		latestAssistantTurn: 2, tavernHelper: { stateRevision: 79 } }
	await act(async () => root.render(element(committed, null, false,
		{ mode: 'story', regenInProgress: false, streamingMessageUid: null,
			latestAssistantTurn: 2, tavernHelper: { stateRevision: 79 } })))
	assert.equal(assistants.length, 2)
	assert.ok(assistants[1].textContent.includes('已经提交的正式正文'))
	assert.ok(!assistants[1].textContent.includes('正在生成'))
})

test('失败输入后的重新生成：没有旧正文行也能立即挂载流式新正文', async t => {
	const page = createPage(t)
	const { dom, context } = page
	const messages = [
		{ role: 'assistant', turn: 7, text: '上一轮正文', messageUid: 'uid-previous' },
		{ role: 'user', text: '这次输入生成失败' }
	]
	const transcript = story(messages, 10)
	const regenerating = { mode: 'story', regenInProgress: true, streamingMessageUid: null, streamingStoryTurn: 8, latestAssistantTurn: 7 }
	const feature = context.createTavernStoryTranscriptFeature()
	const element = (value, partial, running, view) => React.createElement(feature.StoryTranscriptList, {
		transcript: value, partial, running, view, sessionId: 's-failed-tail-regen'
	})
	const root = await mount(page, element(transcript, null, true, regenerating))
	const assistants = () => [...dom.window.document.querySelectorAll('[data-story-row][data-role="assistant"]')]
	// 失败尾在存档里只有 user，没有可被流式覆盖的 assistant。页面要补一个仅存在于
	// 这次生成期的故事行，不能等模型提交后才第一次画出正文。
	assert.equal(assistants().length, 2)
	assert.ok(assistants()[1].textContent.includes('正在生成'))
	assert.equal(assistants()[1].getAttribute('data-row-key'), 'turn:8')
	const draft = assistants()[1]
	const partial = { turn: 17, blocks: [{ kind: 'text', text: '失败后的流式新正文' }] }
	await act(async () => root.render(element(transcript, partial, true, regenerating)))
	assert.equal(assistants().length, 2)
	assert.strictEqual(assistants()[1], draft)
	assert.ok(assistants()[1].textContent.includes('失败后的流式新正文'))
	assert.ok(!assistants()[1].textContent.includes('17'), '宿主临时轮号不得漏到故事楼层')

	const committed = story(messages.concat({ role: 'assistant', turn: 8, text: '失败后的正式正文' }), 11)
	await act(async () => root.render(element(committed, null, false, { mode: 'story', latestAssistantTurn: 8 })))
	assert.equal(assistants().length, 2)
	assert.strictEqual(assistants()[1], draft, '提交后复用同一个故事行，不追加第二份正文')
	assert.ok(assistants()[1].textContent.includes('失败后的正式正文'))
	assert.ok(!assistants()[1].textContent.includes('正在生成'))

	// 若这次生成失败而没有提交，虚拟行随 regenInProgress 结束消失，失败输入保留。
	await act(async () => root.render(element(transcript, null, false, { mode: 'story', latestAssistantTurn: 7 })))
	assert.equal(assistants().length, 1)
	assert.ok(dom.window.document.querySelector('[data-story-row][data-role="user"]').textContent.includes('这次输入生成失败'))
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

test('故事仅自动渲染最近三轮 HTML，旧轮次可按需展开', async t => {
	const page = createPage(t)
	const { dom, context } = page
	const messages = [1, 2, 3, 4].map(turn => ({ role: 'assistant', turn, text: '正文' + turn, displayText: '正文' + turn, displayMode: 'html' }))
	const view = { mode: 'story', replyProjections: messages.map(message => ({ version: 2, turn: message.turn, text: message.text, mode: 'html', parts: [{ kind: 'html', content: '<div>' + message.text + '</div>' }] })) }
	const feature = context.createTavernStoryTranscriptFeature({ renderProjection: (projection, options) => options.deferHtml
		? React.createElement('button', { className: 'render-old', onClick: options.deferHtml }, '渲染此轮')
		: React.createElement('div', { className: 'auto-rich', 'data-turn': projection.turn }) })
	await mount(page, React.createElement(feature.StoryTranscriptList, { transcript: story(messages, 1), view, sessionId: 's1' }))
	const turns = () => [...dom.window.document.querySelectorAll('.auto-rich')].map(row => row.getAttribute('data-turn'))
	assert.deepEqual(turns(), ['2', '3', '4'])
	assert.equal(dom.window.document.querySelectorAll('.render-old').length, 1)
	await act(async () => { dom.window.document.querySelector('.render-old').click() })
	assert.deepEqual(turns(), ['1', '2', '3', '4'], '点击后使用已下载 parts 渲染旧轮次，无需新增读取')
})

test('故事楼层恢复插件视频：正文锚点内嵌，未锚定项追加且互不重复', async t => {
	const anchored = { id: 'video-anchor', kind: 'video', status: 'ready', anchor: '正文', attachment: { attachmentId: 'a1', name: 'anchor.mp4' } }
	const trailing = { id: 'video-tail', kind: 'video', status: 'ready', attachment: { attachmentId: 'a2', name: 'tail.mp4' } }
	const mediaCalls = []
	const MediaItem = props => React.createElement('video', {
		'data-plugin-video': props.item.id, src: '/media/' + props.item.id + '.mp4', controls: true
	})
	const page = createPage(t, {
		isPlayMode: mode => mode === 'story',
		useTavernPluginMedia: (sessionId, turn, enabled) => {
			mediaCalls.push({ sessionId, turn, enabled })
			return { key: 'v1', items: [anchored, trailing] }
		},
		createTavernPluginTextContext: input => {
			const placed = new Set()
			return {
				placed,
				render: (text, key, renderText) => {
					placed.add(anchored.id)
					return React.createElement(React.Fragment, { key },
						renderText(text, key, 0),
						React.createElement(MediaItem, { item: anchored, sessionId: input.sessionId, turn: input.turn }))
				},
				renderHtmlMarkers: html => ({ html, after: null })
			}
		},
		TavernPluginMediaItem: MediaItem
	})
	const { dom, context } = page
	const feature = context.createTavernStoryTranscriptFeature({ renderProjection: (projection, options) => {
		const renderText = (text, key) => React.createElement('div', { key, className: 'md-text' }, text)
		return options.plugin ? options.plugin.render(projection.text, 0, renderText) : renderText(projection.text, 0)
	} })
	await mount(page, React.createElement(feature.StoryTranscriptList, {
		transcript: story([{ role: 'assistant', turn: 5, text: '正文' }]),
		view: { mode: 'story' }, sessionId: 's-video'
	}))

	assert.deepEqual(mediaCalls[0], { sessionId: 's-video', turn: 5, enabled: true })
	const row = dom.window.document.querySelector('[data-story-row]')
	assert.equal(row.querySelectorAll('video[data-plugin-video]').length, 2, '两个插件视频都必须进入故事楼层')
	assert.equal(row.querySelectorAll('.dsh-tavern-story-body video[data-plugin-video="video-anchor"]').length, 1, '锚定视频必须随正文投影内嵌')
	const tail = row.querySelectorAll('.dsh-tavern-plugin-media-list video[data-plugin-video]')
	assert.deepEqual([...tail].map(node => node.getAttribute('data-plugin-video')), ['video-tail'], '只有未锚定视频追加到楼底')
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

test('切回最近会话与历史窗口先用缓存上屏，随后补读一次；force 与 reset 仍重新读取', async t => {
	const page = createPage(t)
	const { context } = page
	const reads = []
	const data = context.createTavernStoryTranscriptDataModule()
	const store = data.createStoryTranscriptStore({ load: async (sessionId, options) => {
		reads.push([sessionId, options.historyFrom ?? null])
		return { transcript: story([{ role: 'assistant', turn: 1, text: sessionId, messageUid: sessionId }]), view: { mode: 'story' }, revision: 7 }
	} })
	await store.read('s1')
	await store.read('s2')
	await store.read('s1', { historyFrom: 20 })
	reads.length = 0

	// 切走期间这一局可能已经在别的视图里生成完：缓存负责首帧，落盘的正文靠补读回来。
	// 少了这次补读，切回页面就停在上次离开时的旧正文，必须刷新才看到最新输出。
	const back = store.read('s1')
	assert.equal(store.getSnapshot().sessionId, 's1', '切回时缓存立刻成为当前故事')
	assert.equal(store.getSnapshot().status, 'ready', '首帧直接读缓存，不等网络')
	await back
	assert.deepEqual(reads, [['s1', null]], '缓存上屏后仍补读一次')
	assert.equal(store.getSnapshot().status, 'ready')

	await store.read('s2')
	assert.deepEqual(reads, [['s1', null], ['s2', null]], '切到另一个会话同样先缓存后补读')
	assert.equal(store.getSnapshot().sessionId, 's2')
	assert.equal(store.getSnapshot().status, 'ready')

	await store.read('s2', { force: true })
	assert.deepEqual(reads, [['s1', null], ['s2', null], ['s2', null]], '版本变化使用的 force 必须绕过缓存')
	store.reset()
	await store.read('s2')
	assert.deepEqual(reads, [['s1', null], ['s2', null], ['s2', null], ['s2', null]], 'reset 必须清空全部会话缓存')
})

test('故事首读与缓存切回都播种 liveView，切回仍补读一次', async t => {
	const page = createPage(t)
	const { context } = page
	const seeds = [], reads = [], waits = []
	const data = context.createTavernStoryTranscriptDataModule()
	const store = data.createStoryTranscriptStore({
		liveTavernView: {
			expectSeed: sessionId => waits.push(sessionId),
			seed: (sessionId, view) => seeds.push([sessionId, view.historyWindow.revision])
		},
		load: async sessionId => {
			reads.push(sessionId)
			return { transcript: story([{ role: 'assistant', turn: 1, text: sessionId }]), view: { mode: 'story', historyWindow: { revision: 7 } }, revision: 7 }
		}
	})
	await store.read('s1')
	await store.read('s2')
	await store.read('s1')
	assert.deepEqual(reads, ['s1', 's2', 's1'], '切回先复用缓存上屏，再补读一次')
	assert.deepEqual(seeds, [['s1', 7], ['s2', 7], ['s1', 7], ['s1', 7]], '每次成为当前故事时都恢复对应 liveView 快照')
	assert.deepEqual(waits, ['s1', 's2'], '缓存切回有自己的视图，不额外等待种子')
})

test('故事缓存按最近使用顺序执行有界淘汰', async t => {
	const page = createPage(t)
	const { context } = page
	const reads = []
	const data = context.createTavernStoryTranscriptDataModule()
	const store = data.createStoryTranscriptStore({ cacheSize: 2, load: async sessionId => {
		reads.push(sessionId)
		return { transcript: story([{ role: 'assistant', turn: 1, text: sessionId }]), view: null, revision: 7 }
	} })
	await store.read('s1')
	await store.read('s2')
	await store.read('s1')
	await store.read('s3')
	assert.deepEqual(reads, ['s1', 's2', 's1', 's3'], '缓存命中先上屏并补读，新增窗口只读一次')
	await store.read('s2')
	assert.deepEqual(reads, ['s1', 's2', 's1', 's3', 's2'], '最久未使用的 s2 已被淘汰')
})

const flush = () => new Promise(resolve => setImmediate(resolve))

test('后台结算推进 live revision 后自动重读故事操作选择器', async t => {
	let liveRevision = 7
	const page = createPage(t, { useTavernSessionMode: () => 'story',
		useLiveTavernView: () => ({ view: { mode: 'story', tavernHelper: { stateRevision: liveRevision } } }) })
	const { dom, context } = page
	let revision = 7
	const reads = []
	const data = context.createTavernStoryTranscriptDataModule()
	const store = data.createStoryTranscriptStore({ load: async () => {
		reads.push(revision)
		return { transcript: story(MESSAGES, revision), view: { mode: 'story' }, revision }
	} })
	const feature = context.createTavernStoryTranscriptFeature()
	const props = current => ({
		sessionId: 's-live', store, view: { mode: 'story', tavernHelper: { stateRevision: current } },
		useChat: selector => selector({ legacy: {} }), useSession: selector => selector({ running: false })
	})
	const root = await mount(page, React.createElement(feature.StoryTranscriptFlow, props(7)))
	const initialReads = reads.length
	assert.deepEqual(reads, [7], '首次加载不为空的 live revision 不应多发一次请求')
	revision = 8
	liveRevision = 8
	await act(async () => root.render(React.createElement(feature.StoryTranscriptFlow, props(7))))
	assert.equal(reads.length, initialReads + 1, 'live revision 前进只触发一次新的故事读取')
	assert.equal(reads.at(-1), 8)
	assert.equal(dom.window.document.querySelector('[data-story-row]').getAttribute('data-revision'), '8')
})

test('故事行编辑按 Chat 索引调用 getBodyEdit 并派发已有编辑面板事件', async t => {
	const calls = [], details = []
	const page = createPage(t, {
		rpc: (...args) => { calls.push(args); return Promise.resolve({ edit: { messageUid: args[1].messageUid, parts: [{ kind: 'text', text: '改后的正文' }, { kind: 'image' }] } }) }
	})
	const { dom, context } = page
	dom.window.addEventListener('dsh-tavern-open-body-edit', event => details.push(event.detail))
	const transcript = story(MESSAGES)
	const feature = context.createTavernStoryTranscriptFeature()
	await mount(page, React.createElement(feature.StoryTranscriptList, { transcript, sessionId: 's1' }))
	const rows = [...dom.window.document.querySelectorAll('[data-story-row]')]

	await act(async () => { rows[1].querySelector('button[aria-label="编辑这条输入"]').click() })
	await flush()
	assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['getBodyEdit', { role: 'user', messageIndex: 1, revision: 7, messageUid: transcript.messages[1].messageUid,
		text: transcript.messages[1].message.text }, 's1'])
	assert.equal(details[0].sessionId, 's1')
	assert.deepEqual(details[0].texts, ['改后的正文'])
	assert.equal(details[0].edit.parts.length, 2, '编辑面板事件原样携带 edit')

	await act(async () => { rows[0].querySelector('button[aria-label="编辑正文"]').click() })
	await flush()
	assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), ['getBodyEdit', { role: 'assistant', messageIndex: 0, revision: 7, messageUid: transcript.messages[0].messageUid,
		text: transcript.messages[0].message.text }, 's1'])
})

test('点击编辑遇到后台 revision 前进时重读并自动打开当前行', async t => {
	const calls = [], details = []
	const page = createPage(t, { rpc: async (method, args, sessionId) => {
		calls.push([method, args, sessionId])
		if (method === 'getBodyEdit' && args.revision === 7) throw new Error('正文或会话已变化，请重新打开编辑')
		if (method === 'getStoryTranscript') return { storyTranscript: story(MESSAGES, 8), revision: 8 }
		return { edit: { role: 'assistant', messageIndex: 2, revision: 8, messageUid: args.messageUid, parts: [{ kind: 'text', text: '当前正文' }] } }
	} })
	const { dom, context } = page
	dom.window.addEventListener('dsh-tavern-open-body-edit', event => details.push(event.detail))
	const feature = context.createTavernStoryTranscriptFeature()
	await mount(page, React.createElement(feature.StoryTranscriptList, { transcript: story(MESSAGES, 7), sessionId: 's-retry' }))
	const row = dom.window.document.querySelectorAll('[data-story-row][data-role="assistant"]')[1]
	await act(async () => { row.querySelector('button[aria-label="编辑正文"]').click() })
	await flush()
	const messageUid = story(MESSAGES, 7).messages[2].messageUid
	const messageText = story(MESSAGES, 7).messages[2].message.text
	// 重读后仍带上正文：重试只换渲染戳，行身份由正文担保。
	assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
		['getBodyEdit', { role: 'assistant', messageIndex: 2, revision: 7, messageUid, text: messageText }, 's-retry'],
		['getStoryTranscript', { sessionId: 's-retry' }, 's-retry'],
		['getBodyEdit', { role: 'assistant', messageIndex: 2, revision: 8, messageUid, text: messageText }, 's-retry']
	])
	assert.equal(details.length, 1)
	assert.equal(details[0].edit.revision, 8)
	assert.deepEqual(details[0].texts, ['当前正文'])
})

test('编辑重读遇到同索引同文本的另一 UID 时拒绝打开错行', async t => {
	const details = [], errors = []
	const page = createPage(t, {
		tavernErrorHub: { report: (label, error) => errors.push([label, String(error.message || error)]) },
		rpc: async (method, args) => {
			if (method === 'getBodyEdit' && args.revision === 7) throw new Error('正文或会话已变化，请重新打开编辑')
			if (method === 'getStoryTranscript') return { storyTranscript: story(MESSAGES, 8), revision: 8 }
			return { edit: { role: 'assistant', messageIndex: 2, revision: 8, messageUid: 'different-logical-row', parts: [{ kind: 'text', text: '重复 turn 的正文' }] } }
		}
	})
	const { dom, context } = page
	dom.window.addEventListener('dsh-tavern-open-body-edit', event => details.push(event.detail))
	const feature = context.createTavernStoryTranscriptFeature()
	await mount(page, React.createElement(feature.StoryTranscriptList, { transcript: story(MESSAGES, 7), sessionId: 's-identity' }))
	const row = dom.window.document.querySelectorAll('[data-story-row][data-role="assistant"]')[1]
	await act(async () => { row.querySelector('button[aria-label="编辑正文"]').click() })
	await flush()
	assert.equal(details.length, 0)
	assert.equal(errors.length, 1)
	assert.match(errors[0][1], /这条消息已变化/)
})

test('assistant 分叉请求带 messageIndex+revision+messageUid，user 行没有分叉', async t => {
	const forked = []
	const page = createPage(t, { tavernConversationForkRequests: { request: async payload => { forked.push(payload) } } })
	const { dom, context } = page
	const transcript = story(MESSAGES)
	const feature = context.createTavernStoryTranscriptFeature()
	await mount(page, React.createElement(feature.StoryTranscriptList, { transcript, sessionId: 's2' }))
	const rows = [...dom.window.document.querySelectorAll('[data-story-row]')]
	assert.equal(rows[1].querySelector('button[aria-label="从这一轮分叉"]'), null)
	await act(async () => { rows[2].querySelector('button[aria-label="从这一轮分叉"]').click() })
	await flush()
	assert.deepEqual(JSON.parse(JSON.stringify(forked)), [{ sessionId: 's2', messageIndex: 2, revision: 7, messageUid: transcript.messages[2].messageUid }])
})

test('故事行的编辑、分叉和复制都保留图标，复制使用当前行原文', async t => {
	const page = createPage(t)
	const { dom, context } = page
	const feature = context.createTavernStoryTranscriptFeature()
	await mount(page, React.createElement(feature.StoryTranscriptList, { transcript: story(MESSAGES), sessionId: 's-copy' }))
	const rows = [...dom.window.document.querySelectorAll('[data-story-row]')]
	const userEdit = rows[1].querySelector('button[aria-label="编辑这条输入"]')
	const assistantEdit = rows[2].querySelector('button[aria-label="编辑正文"]')
	const fork = rows[2].querySelector('button[aria-label="从这一轮分叉"]')
	assert.ok(userEdit.querySelector('svg[data-icon="edit"]'))
	assert.ok(assistantEdit.querySelector('svg[data-icon="edit"]'))
	assert.ok(fork.querySelector('svg[data-icon="branch"]'))
	assert.equal(userEdit.textContent, '')
	assert.equal(assistantEdit.textContent, '')
	assert.equal(fork.textContent, '')
	await act(async () => { rows[1].querySelector('button[aria-label="复制"]').click() })
	assert.equal(dom.window.__copiedText, '行动一')
	assert.ok(rows[1].querySelector('button[aria-label="已复制"] svg[data-icon="check"]'))
	await act(async () => { rows[2].querySelector('button[aria-label="复制"]').click() })
	assert.equal(dom.window.__copiedText, '重复 turn 的正文')
})

test('流式占位行不渲染编辑、分叉或删除操作', async t => {
	const page = createPage(t, {
		enableStoryDeletion: true,
		rpc: async () => ({ edit: { parts: [] } }),
		askTavernConfirm: async () => true,
		liveTavernView: { setView() {} },
		notifyTavernDataChanged() {},
		tavernCoordination: { invalidate() {} },
		tavernConversationForkRequests: { request: async () => {} }
	})
	const { dom, context } = page
	context.__storyMessageDeletion.store.enter('s3')
	const transcript = story([{ role: 'assistant', turn: 1, text: '已完成' }, { role: 'assistant', turn: 2, text: '', placeholder: true }], 3)
	const feature = context.createTavernStoryTranscriptFeature()
	await mount(page, React.createElement(feature.StoryTranscriptList, { transcript, sessionId: 's3' }))
	const rows = [...dom.window.document.querySelectorAll('[data-story-row]')]
	assert.ok(rows[0].querySelector('.dsh-tavern-story-row-actions'), '已提交行有操作区')
	assert.equal(rows[0].querySelectorAll('input[type="checkbox"]').length, 1, '已提交行有删除复选框')
	assert.equal(rows[1].querySelector('.dsh-tavern-story-row-actions'), null)
	assert.equal(rows[1].querySelector('.dsh-tavern-story-row-action'), null)
	assert.equal(rows[1].querySelector('.dsh-tavern-message-select'), null)
	assert.equal(rows[1].querySelectorAll('input[type="checkbox"]').length, 0)
})

test('后台 activity.busy 时编辑与分叉按钮禁用，空闲后恢复', async t => {
	let busy = true
	const page = createPage(t, { useLiveTavernView: () => ({ view: { activity: { busy } } }) })
	const { dom, context } = page
	const feature = context.createTavernStoryTranscriptFeature()
	const element = () => React.createElement(feature.StoryTranscriptList, { transcript: story(MESSAGES), sessionId: 's-busy' })
	const root = await mount(page, element())
	const edit = () => dom.window.document.querySelector('button[aria-label="编辑正文"]')
	const fork = () => dom.window.document.querySelector('button[aria-label="从这一轮分叉"]')
	assert.equal(edit().disabled, true)
	assert.equal(fork().disabled, true)
	busy = false
	await act(async () => root.render(element()))
	assert.equal(edit().disabled, false)
	assert.equal(fork().disabled, false)
})

test('故事行 Checkbox 走 storySelector，deleteMessages 收到精确索引、revision 与稳定身份', async t => {
	const calls = []
	const page = createPage(t, {
		enableStoryDeletion: true,
		rpc: (...args) => { calls.push(args); return Promise.resolve({ view: { revision: 8 }, deletedCount: 1 }) },
		askTavernConfirm: async () => true,
		liveTavernView: { setView() {} },
		notifyTavernDataChanged() {},
		tavernCoordination: { invalidate() {} }
	})
	const { dom, context } = page
	const deletion = context.__storyMessageDeletion
	deletion.store.enter('s4')
	const transcript = story(MESSAGES)
	const feature = context.createTavernStoryTranscriptFeature()
	await mount(page, React.createElement(feature.StoryTranscriptList, { transcript, sessionId: 's4' }))
	const rows = [...dom.window.document.querySelectorAll('[data-story-row]')]
	const boxes = row => [...row.querySelectorAll('input[type="checkbox"]')]
	assert.equal(boxes(rows[1]).length, 1, 'user 行有删除复选框')
	assert.equal(boxes(rows[2]).length, 1, 'assistant 行有删除复选框')
	await act(async () => { boxes(rows[1])[0].click() })
	await act(async () => { boxes(rows[2])[0].click() })
	// 选择器带上渲染正文与 swipe：后台写入推进 revision 时服务端仍能认出这一行。
	const expected = [
		{ role: 'user', messageIndex: 1, revision: 7, messageUid: transcript.messages[1].messageUid, text: transcript.messages[1].message.text },
		{ role: 'assistant', messageIndex: 2, revision: 7, messageUid: transcript.messages[2].messageUid, text: transcript.messages[2].message.text }
	]
	assert.ok(expected.every(item => typeof item.messageUid === 'string' && item.messageUid))
	assert.deepEqual(JSON.parse(JSON.stringify(deletion.store.getSnapshot('s4').items)), expected)
	await act(async () => { await deletion.store.remove('s4') })
	assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['deleteMessages', { items: expected }, 's4'])
})

test('故事 user 与 AI 楼层点按正文都会切换选择，AI 选中行匹配高亮选择器', async t => {
	const page = createPage(t, {
		enableStoryDeletion: true,
		rpc: async () => ({}),
		askTavernConfirm: async () => true,
		liveTavernView: { setView() {} },
		notifyTavernDataChanged() {},
		tavernCoordination: { invalidate() {} }
	})
	const { dom, context } = page
	const deletion = context.__storyMessageDeletion
	deletion.store.enter('s-floor-click')
	const feature = context.createTavernStoryTranscriptFeature()
	await mount(page, React.createElement(feature.StoryTranscriptList, { transcript: story(MESSAGES), sessionId: 's-floor-click' }))
	const rows = [...dom.window.document.querySelectorAll('[data-story-row]')]
	const checked = row => row.querySelector('input[type="checkbox"]').checked
	await act(async () => { rows[1].querySelector('.dsh-tavern-story-body').click() })
	assert.equal(checked(rows[1]), true, '点按用户楼层应选择')
	await act(async () => { rows[2].querySelector('.dsh-tavern-story-body').click() })
	assert.equal(checked(rows[2]), true, '点按 AI 楼层应选择')
	assert.equal(deletion.store.getSnapshot('s-floor-click').items.length, 2)
	assert.ok(rows[2].matches('.dsh-tavern-assistant:has(.dsh-tavern-message-select.assistant input:checked)'), '嵌套在操作栏里的 AI 复选框也要驱动楼层高亮')
	assert.match(tavernCss, /\.dsh-tavern-assistant:has\(\.dsh-tavern-message-select\.assistant input:checked\)/, '实际 CSS 也必须使用可命中的后代选择器')
	await act(async () => { rows[2].querySelector('.dsh-tavern-story-body').click() })
	assert.equal(checked(rows[2]), false, '再次点按 AI 楼层应取消选择')
	assert.equal(deletion.store.getSnapshot('s-floor-click').items.length, 1)
})


test('流式 partial 只更新目标行，历史行不重复投影', async t => {
	const page = createPage(t)
	const { dom, context } = page
	const many = []
	for (let turn = 1; turn <= 40; turn++) {
		many.push({ role: 'user', turn, text: '输入 ' + turn })
		many.push({ role: 'assistant', turn, text: '正文 ' + turn, placeholder: turn === 40 })
	}
	const transcript = story(many, 1)
	let projections = 0
	const feature = context.createTavernStoryTranscriptFeature({ renderProjection: projection => {
		projections += 1
		return React.createElement('div', { 'data-projection': String(projection.turn) }, projection.text)
	} })
	const element = partial => React.createElement(feature.StoryTranscriptList, {
		transcript, partial, running: true, sessionId: 's1'
	})
	const root = await mount(page, element(null))
	const historyRows = [...dom.window.document.querySelectorAll('[data-story-row]')]
	assert.equal(projections, 40)
	const before = projections
	await act(async () => root.render(element({ turn: 40, blocks: [{ kind: 'text', text: '新一段流式正文' }] })))
	assert.equal(projections - before, 1, '一个 partial 只重渲染活动尾行')
	assert.strictEqual(dom.window.document.querySelector('[data-projection="40"]').textContent, '新一段流式正文')
	for (const row of historyRows.slice(0, -1)) assert.ok(dom.window.document.contains(row), '历史楼层 DOM 保持不变')
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

test('切走时还没出正文，切回来补读到后台写完的楼层', async t => {
	const page = createPage(t)
	const { dom, context } = page
	let chat = [{ role: 'user', text: '行动' }]
	let revision = 1
	const data = context.createTavernStoryTranscriptDataModule({ rpc: async (_method, args) => ({
		storyTranscript: args.sessionId === 's-other' ? story([{ role: 'assistant', turn: 1, text: '另一局正文' }], 1) : story(chat, revision),
		view: { mode: 'story' }, revision: args.sessionId === 's-other' ? 1 : revision
	}) })
	const store = data.createStoryTranscriptStore()
	const feature = context.createTavernStoryTranscriptFeature({ dataModule: data })
	const element = sessionId => React.createElement(feature.StoryTranscriptView, { store, sessionId })
	const settle = () => act(async () => { await new Promise(resolve => setImmediate(resolve)) })
	const root = await mount(page, element('s-cut'))
	await settle()
	assert.deepEqual(textOf(dom).map(text => text.includes('行动')), [true], '离开前只有玩家那一行')
	// 切到别的对话：故事槽位换成另一局，切走这一局在后台把这一轮写进存档，
	// 故事缓存里的仍是离开时的快照。
	await act(async () => root.render(element('s-other')))
	await settle()
	assert.ok(textOf(dom).every(text => !text.includes('后台写完的正文')))
	chat = [{ role: 'user', text: '行动' }, { role: 'assistant', turn: 1, text: '后台写完的正文' }]
	revision = 2
	await act(async () => root.render(element('s-cut')))
	await settle()
	const texts = textOf(dom)
	assert.ok(texts.some(text => text.includes('后台写完的正文')), '切回来补读后必须显示最新正文，不必刷新页面')
	assert.ok(texts.some(text => text.includes('行动')))
	assert.equal(dom.window.document.querySelector('[data-story-transcript]').getAttribute('data-revision'), '2')
})
