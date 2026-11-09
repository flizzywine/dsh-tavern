// 故事历史的只读楼层列表。它直接消费 chat.messages 的故事投影，不按 native
// turn 分组，不扫描 sessionEvents，也不复用旧 DOM 隐藏行的 data-chat-flow-kind。
// 列表和原生 ChatFlow 一样直接返回行，槽锚点保持 display:contents，宿主继续负责滚动。

const TAVERN_STORY_TRANSCRIPT_LABELS = Object.freeze({ code: Object.freeze({ copyLabel: '复制', copiedLabel: '已复制' }), footnotes: '脚注' })
const TAVERN_STORY_TRANSCRIPT_EMPTY_CALLS = Object.freeze([])

function TavernStoryMarkdown(props) {
	const text = String(props.text === undefined || props.text === null ? '' : props.text)
	const labels = props.labels || TAVERN_STORY_TRANSCRIPT_LABELS
	if (typeof TavernColoredMarkdown === 'function') {
		return React.createElement(TavernColoredMarkdown, {
			text: text,
			streaming: props.streaming === true,
			labels: labels,
			codeLabels: labels.code
		})
	}
	if (typeof DshUi !== 'undefined' && DshUi && typeof DshUi.MarkdownText === 'function') {
		return React.createElement('div', { className: 'dsh-tavern-story-markdown' },
			React.createElement(DshUi.MarkdownText, { text: text, labels: labels }))
	}
	return React.createElement('div', { className: 'dsh-tavern-story-markdown', style: { whiteSpace: 'pre-wrap' } }, text)
}

// liveTavernView 只提供 Helper、变量和后台状态，不参与正文行的显隐。

function createTavernStoryTranscriptFeature(deps) {
	if (typeof tavernStoryTranscriptRows !== 'function' || typeof tavernStoryTranscriptStreamRows !== 'function') {
		throw new Error('故事历史列表缺少数据模块：先包含 features/story-transcript-data.js')
	}
	const options = deps || {}
	const h = React.createElement
	const data = options.dataModule || createTavernStoryTranscriptDataModule({ rpc: options.rpc })
	const labels = options.labels || TAVERN_STORY_TRANSCRIPT_LABELS
	const renderText = typeof options.markdown === 'function'
		? options.markdown
		: function (text, info) { return h(TavernStoryMarkdown, { text: text, labels: labels, streaming: Boolean(info && info.streaming) }) }
	const renderProjection = typeof options.renderProjection === 'function' ? options.renderProjection
		: (typeof renderTavernProjection === 'function' ? renderTavernProjection : null)
	const mode = options.mode || data.createModeStore()
	// 故事楼层是唯一展示模式；旧版本保存的“原生”偏好在升级后直接纠正。
	mode.set(true)
	let storyTranscriptStore = null
	let nativeFlow = null
	let flowExecuteSlash = options.executeSlash || null
	let storyExternalHistory = options.externalHistory || null
	const storyEligibility = new Map()
	const externalHistoryInstaller = options.externalHistoryInstaller ||
		(typeof installTavernStoryExternalHistory === 'function' ? installTavernStoryExternalHistory : null)

	function rowAttributes(row, transcript) {
		const turn = Number.isInteger(row.legacyTurn) && row.legacyTurn > 0 ? row.legacyTurn : row.floorNo
		return {
			role: 'listitem',
			'data-story-row': '',
			'data-story-transcript': transcript && transcript.source ? String(transcript.source) : 'story',
			'data-row-key': row.key,
			'data-chat-flow-key': row.key,
			'data-chat-anchor-key': row.key,
			'data-chat-turn': Number.isInteger(turn) && turn > 0 ? String(turn) : undefined,
			'data-role': row.role,
			'data-floor': row.floorNo === null ? undefined : String(row.floorNo),
			'data-greeting': row.greeting ? '' : undefined,
			'data-legacy-turn': row.legacyTurn === null ? undefined : String(row.legacyTurn),
			'data-revision': transcript && transcript.revision !== undefined ? String(transcript.revision) : undefined,
			'data-from': transcript && Number.isInteger(transcript.from) ? String(transcript.from) : undefined,
			'data-to': transcript && Number.isInteger(transcript.to) ? String(transcript.to) : undefined,
			'data-floor-count': transcript && Number.isInteger(transcript.floorCount) ? String(transcript.floorCount) : undefined
		}
	}

	function StoryTranscriptMvuReceipt(props) {
		if (typeof useLiveTavernView !== 'function' || typeof TavernMvuReceipt !== 'function' || typeof tavernMvuReceiptForTurn !== 'function') return null
		const turn = Number(props.turn) || 0
		const state = useLiveTavernView(props.sessionId, 'story-receipt:' + String(turn),
			[['$mvuReceiptTurn', String(turn)], ['$settlementOwner', String(turn)], ['$receiptBusy']])
		const receipt = tavernMvuReceiptForTurn(state.view, turn)
		if (!receipt) return null
		return h(TavernMvuReceipt, { sessionId: props.sessionId, turn: turn, receipt: receipt,
			latest: turn === state.view?.settlementTurn, busy: Boolean(state.view?.activity?.busy) })
	}

	function StoryTranscriptActions(props) {
		const row = props.row, transcript = props.transcript
		const [busy, setBusy] = React.useState('')
		const [copied, setCopied] = React.useState(false)
		const copyTimer = React.useRef(null)
		React.useEffect(function () { return function () { if (copyTimer.current !== null) window.clearTimeout(copyTimer.current) } }, [])
		const messageIndex = row.absoluteIndex
		const revision = transcript && transcript.revision
		const usable = Number.isSafeInteger(messageIndex) && messageIndex >= 0 && revision !== null && revision !== undefined
			&& Number.isSafeInteger(Number(revision)) && Number(revision) >= 0 && !row.streaming
			&& !(row.role === 'user' && row.message && row.message.placeholder === true)
		if (!usable) return null
		const target = { role: row.role, messageIndex: messageIndex, revision: Number(revision),
			...(row.messageUid ? { messageUid: row.messageUid } : {}),
			...(row.message && typeof row.message.text === 'string' ? { text: row.message.text } : {}) }
		function report(label, error) {
			if (typeof tavernErrorHub !== 'undefined' && tavernErrorHub && typeof tavernErrorHub.report === 'function') tavernErrorHub.report(label, error)
		}
		async function edit() {
			if (busy || typeof rpc !== 'function') return
			setBusy('edit')
			try {
				const id = String(props.sessionId || '')
				let result
				try { result = await rpc('getBodyEdit', target, id) }
				catch (error) {
					if (!/正文或会话已变化|输入或会话已变化|剧情已变化/.test(String(error && error.message || error))) throw error
					// A background header write can land between rendering and clicking.
					// Reading is side-effect free, so reopen at the current story revision.
					const latest = await rpc('getStoryTranscript', { sessionId: id }, id)
					const revision = Number(latest && latest.revision !== undefined ? latest.revision : latest && latest.storyTranscript && latest.storyTranscript.revision)
					if (!Number.isSafeInteger(revision) || revision < 0) throw error
					result = await rpc('getBodyEdit', Object.assign({}, target, { revision: revision }), id)
				}
				if (target.messageUid && result?.edit?.messageUid !== target.messageUid) throw new Error('这条消息已变化，请重新打开编辑')
				if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dsh-tavern-open-body-edit', { detail: {
					sessionId: id, edit: result.edit,
					texts: result.edit.parts.filter(function (part) { return part.kind === 'text' }).map(function (part) { return part.text })
				} }))
			} catch (error) { report(row.role === 'user' ? '编辑输入' : '编辑正文', error) }
			finally { setBusy('') }
		}
		async function fork() {
			if (busy || typeof tavernConversationForkRequests === 'undefined') return
			setBusy('fork')
			try { await tavernConversationForkRequests.request({ sessionId: String(props.sessionId || ''), messageIndex: messageIndex, revision: Number(revision), messageUid: row.messageUid }) }
			catch (error) { report('分叉对话', error) }
			finally { setBusy('') }
		}
		async function copy() {
			try {
				const ok = await DshUi.writeClipboard(String(row.text === undefined || row.text === null ? '' : row.text))
				if (!ok) return
				setCopied(true)
				if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
				copyTimer.current = window.setTimeout(function () { copyTimer.current = null; setCopied(false) }, 1000)
			} catch (error) { report('复制消息', error) }
		}
		const selector = typeof messageDeletionFeature !== 'undefined' && messageDeletionFeature && typeof messageDeletionFeature.storySelector === 'function'
			? messageDeletionFeature.storySelector(row.role, messageIndex, Number(revision), row.messageUid,
				row.message && typeof row.message.text === 'string' ? row.message.text : undefined,
				row.message && Number.isSafeInteger(row.message.swipeId) ? row.message.swipeId : undefined) : null
		const editLabel = row.role === 'user' ? '编辑这条输入' : '编辑正文'
		const copyButton = h(DshUi.Tooltip, { label: copied ? '已复制' : '复制', side: 'bottom' },
			h('button', { type: 'button', className: 'dsh-tavern-story-row-action dsh-tavern-story-row-copy',
				'aria-label': copied ? '已复制' : '复制', onClick: copy },
				h(copied ? DshUi.IconCheckOutlineRegular : DshUi.IconCopyOutlineRegular, null)))
		const editButton = h(DshUi.Tooltip, { label: busy === 'edit' ? '正在读取…' : editLabel, side: 'bottom' },
			h('button', { type: 'button', className: 'dsh-tavern-story-row-action dsh-tavern-story-row-edit', disabled: Boolean(busy) || props.running === true,
				'aria-label': editLabel, onClick: edit }, h(DshUi.IconEditOutlineRegular, null)))
		const forkButton = row.role === 'assistant' ? h(DshUi.Tooltip, { label: busy === 'fork' ? '正在分叉…' : '从这一轮分叉', side: 'bottom' },
			h('button', { type: 'button', className: 'dsh-tavern-story-row-action dsh-tavern-story-row-fork', disabled: Boolean(busy) || props.running === true,
				'aria-label': '从这一轮分叉', onClick: fork }, h(DshUi.IconBranchOutlineRegular, null))) : null
		return h('div', { className: 'dsh-tavern-story-row-actions' },
			row.role === 'user' ? editButton : copyButton,
			row.role === 'user' ? copyButton : editButton,
			forkButton,
			selector ? h(messageDeletionFeature.Checkbox, { sessionId: String(props.sessionId || ''), selector: selector }) : null)
	}

	const memoComponent = typeof React.memo === 'function' ? React.memo : function (component) { return component }
	const StoryTranscriptRow = memoComponent(function StoryTranscriptRow(props) {
		const row = props.row
		const [renderRound, setRenderRound] = React.useState(false)
		const floorNo = Number(row.floorNo) || 0
		const floorCount = Number(props.transcript && props.transcript.floorCount) || 0
		// Match the native assistant renderer: only the latest three floors mount
		// heavy card HTML automatically. Older prose stays visible immediately.
		const deferHtml = !renderRound && row.role === 'assistant' && floorNo > 0 && floorCount - floorNo >= 3
			? function () { setRenderRound(true) } : null
		const markdown = props.markdown || renderText
		const attributes = rowAttributes(row, props.transcript)
		const projectionTurn = row.role === 'assistant'
			? (Number.isInteger(row.message && row.message.turn) ? Number(row.message.turn) : (row.greeting ? 1 : 0)) : 0
		const playView = projectionTurn > 0 && (typeof isPlayMode !== 'function' || isPlayMode(props.view && props.view.mode))
		// 原生 assistant-renderer 的插件媒体也必须出现在故事楼层里。媒体仍由
		// pluginMediaForTurn 按当前正文版本读取，不把附件复制进 transcript 快照。
		// Hook 在 user/assistant 分支前调用；用户行传空会话，不建立媒体订阅。
		const mediaSessionId = row.role === 'assistant' ? String(props.sessionId || '') : ''
		const pluginMedia = typeof useTavernPluginMedia === 'function'
			? useTavernPluginMedia(mediaSessionId, projectionTurn, playView && !row.streaming)
			: { key: null, items: [] }
		const pluginText = playView && typeof createTavernPluginTextContext === 'function'
			? createTavernPluginTextContext({ items: pluginMedia.items, extras: [], sessionId: mediaSessionId, turn: projectionTurn, streaming: row.streaming === true })
			: null
		if (row.role === 'user') {
			return h('article', Object.assign({}, attributes, {
				className: 'dsh-tavern-story-transcript-row dsh-tavern-user-row dsh-tavern-story-input'
			}),
				h('div', { className: 'dsh-tavern-user-bubble' },
					h('div', { className: 'dsh-tavern-story-body', style: { whiteSpace: 'pre-wrap' } }, row.text)),
				h(StoryTranscriptActions, { row: row, transcript: props.transcript, sessionId: props.sessionId, running: props.running }))
		}
		const sharedProjection = !row.streaming && row.key === 'turn:' + String(projectionTurn) && typeof tavernProjectionForTurn === 'function'
			? tavernProjectionForTurn(props.view, projectionTurn) : null
		const projection = sharedProjection || row.projection
		const rendered = projection && renderProjection ? renderProjection(projection, {
			sessionId: String(props.sessionId || ''),
			turn: projectionTurn,
			streaming: row.streaming === true,
			codeLabels: labels.code,
			plugin: pluginText,
			helperContext: props.helperView && props.helperView.tavernHelper,
			helperContextReader: function () {
				const current = typeof liveTavernView !== 'undefined' && liveTavernView && typeof liveTavernView.getSnapshot === 'function'
					? liveTavernView.getSnapshot(String(props.sessionId || '')).view : null
				return current && current.tavernHelper || props.helperView && props.helperView.tavernHelper
			},
			frameSizing: props.helperView && props.helperView.tavernRuntimePolicy && props.helperView.tavernRuntimePolicy.frameSizing,
			trustedCardMode: Boolean(props.helperView && props.helperView.tavernRuntimePolicy && props.helperView.tavernRuntimePolicy.trustedCardMode),
			frameOwner: props.frameOwner,
			executeSlash: props.executeSlash,
			eagerFrame: row.streaming === true || (typeof tavernLatestProjectionTurn === 'function' && projectionTurn === tavernLatestProjectionTurn(props.view)),
			deferHtml: deferHtml
		}) : null
		// 与原生渲染一致：正文渲染会登记已落位的 anchor；其余媒体只追加一次。
		const trailingMedia = pluginMedia.items.filter(function (item) { return !(pluginText && pluginText.placed.has(item.id)) })
		const pluginMediaNode = trailingMedia.length && typeof TavernPluginMediaItem === 'function'
			? h('div', { className: 'dsh-tavern-plugin-media-list' }, trailingMedia.map(function (item) {
				return h(TavernPluginMediaItem, { key: item.id, item: item, sessionId: mediaSessionId, turn: projectionTurn })
			})) : null
		return h('article', Object.assign({}, attributes, {
			className: 'dsh-tavern-story-transcript-row dsh-tavern-assistant dsh-tavern-story-floor' + (row.streaming ? ' dsh-tavern-story-streaming' : ''),
			'aria-live': row.streaming ? 'polite' : undefined
		}),
			row.floorNo === null ? null : h('div', { className: 'dsh-tavern-story-floor-head' },
				h('span', { className: 'dsh-tavern-story-floor-no' }, '第 ' + String(row.floorNo) + ' 楼'),
				row.greeting ? h('span', { className: 'dsh-tavern-story-floor-tag' }, '开场') : null,
				row.streaming ? h('span', { className: 'dsh-tavern-story-floor-tag' }, row.tool ? '正在调用 ' + row.tool : '正在生成') : null),
			props.showPlayProcess && !row.streaming && row.toolCalls?.length > 0 ? h(StoryToolCalls, { calls: row.toolCalls }) : null,
			h('div', { className: 'dsh-tavern-story-body' }, rendered || markdown(row.text, { greeting: row.greeting, streaming: row.streaming })),
			pluginMediaNode,
			!row.streaming && projectionTurn > 0
				? h(StoryTranscriptMvuReceipt, { sessionId: String(props.sessionId || ''), turn: projectionTurn }) : null,
			h(StoryTranscriptActions, { row: row, transcript: props.transcript, sessionId: props.sessionId, running: props.running }))
	})

	function StoryToolCalls({ calls }) {
		return h('details', { className: 'dsh-tavern-assistant-reasoning dsh-tavern-story-tools' },
			h('summary', null, '工作过程 · ' + calls.length + ' 次工具调用'),
			h('ol', null, calls.map(call => h('li', { key: call.id },
				h('strong', null, call.name), ' · ', call.status === 'error' ? '失败' : call.status === 'success' ? '完成' : '未返回结果',
				call.arguments && h('pre', null, '参数\n' + call.arguments),
				call.result && h('pre', null, '结果\n' + call.result)))))
	}

	function TavernStoryTranscriptList(props) {
		const transcript = props.transcript || null
		const sessionId = String(props.sessionId || '')
		// Rows remain story-transcript projections. The live Tavern view only keeps
		// iframe Helper variables/runtime policy fresh after background settlement.
		const live = typeof useLiveTavernView === 'function' ? useLiveTavernView(sessionId, 'story-transcript-frame') : null
		const liveView = live && live.view ? live.view : null
		const storyBusy = props.running === true || Boolean(liveView && liveView.activity && liveView.activity.busy)
		const helperView = liveView || props.view
		const liveRevision = Number(liveView && liveView.tavernHelper && liveView.tavernHelper.stateRevision)
		const storyRevision = Number(transcript && transcript.revision)
		// A native snapshot older than the story read must not repaint a newly
		// committed row. Same/newer revisions carry post-settlement EJS parts.
		const projectionView = liveView && Number.isSafeInteger(liveRevision) && Number.isSafeInteger(storyRevision) && liveRevision >= storyRevision ? liveView : props.view
		// 正文重生成只读故事视图；UID 用来定位同一故事行，不用于任何失败过滤。
		const storyStreamUid = props.view && props.view.regenInProgress === true
			&& typeof props.view.streamingMessageUid === 'string' && props.view.streamingMessageUid !== ''
			? props.view.streamingMessageUid : null
		const regeneratingTarget = storyStreamUid
		const regeneratingStoryTurn = props.view && props.view.regenInProgress === true
			&& Number.isInteger(props.view.streamingStoryTurn) && props.view.streamingStoryTurn > 0
			? props.view.streamingStoryTurn : null
		const streamRef = React.useRef({ sessionId: sessionId, turn: null, partial: null, revision: null, settledTurn: null, running: props.running === true })
		function storyTurn(nativeTurn) {
			return typeof tavernStoryTurnForDshTurn === 'function' ? tavernStoryTurnForDshTurn(props.view, nativeTurn) : Number(nativeTurn)
		}
		if (streamRef.current.sessionId !== sessionId) streamRef.current = { sessionId: sessionId, turn: null, partial: null, revision: null, settledTurn: null, running: props.running === true }
		if (props.running === true && !streamRef.current.running) {
			streamRef.current = { sessionId: sessionId, turn: null, partial: null, revision: null, settledTurn: null, running: true }
		} else if (props.running !== true) streamRef.current.running = false
		// 重生成已有故事行 UID 时完全不看原生 turn；失败尾则使用预留的故事轮次。
		// 两条路径都不能把宿主临时 turn（可能远大于剧情轮号）拿来找故事行。
		const nativeLiveTurn = storyStreamUid === null && regeneratingStoryTurn === null
			&& props.partial && Number.isInteger(storyTurn(props.partial.turn)) ? storyTurn(props.partial.turn) : null
		const latestTurnHint = storyStreamUid !== null && Number.isInteger(props.view.latestAssistantTurn)
			? props.view.latestAssistantTurn : null
		const liveTurn = latestTurnHint !== null ? latestTurnHint : (regeneratingStoryTurn !== null ? regeneratingStoryTurn : nativeLiveTurn)
		if (liveTurn !== null) {
			const previous = streamRef.current
			const text = tavernStoryTranscriptStreamText(props.partial)
			if (previous.settledTurn !== liveTurn && previous.turn !== liveTurn) {
				streamRef.current = { sessionId: sessionId, turn: liveTurn, partial: props.partial, revision: transcript && transcript.revision, settledTurn: null, running: props.running === true }
			} else if (previous.settledTurn !== liveTurn && text !== '') previous.partial = props.partial
		}
		const cached = streamRef.current
		let partial = cached.turn === null ? null : cached.partial
		const allowCommitted = liveTurn !== null && liveTurn === cached.turn
		const finalRow = cached.turn === null || !transcript || !Array.isArray(transcript.messages) ? null : transcript.messages.find(function (entry) {
			if (!entry || !entry.message || entry.message.role !== 'assistant' || entry.message.placeholder === true) return false
			// 重生成提交的是同一行：只有目标 UID 落成正文才算这份流已经结束。
			if (storyStreamUid !== null) return entry.messageUid === storyStreamUid
			return Number(entry.message.turn) === Number(cached.turn)
		})
		if (partial && finalRow && (cached.revision !== (transcript && transcript.revision) || (!props.running && !props.partial))) {
			streamRef.current = { sessionId: sessionId, turn: cached.turn, partial: null,
				revision: transcript && transcript.revision, settledTurn: cached.turn, running: props.running === true }
			partial = null
		}
		const rows = React.useMemo(function () {
			const base = typeof tavernStoryTranscriptPendingRows === 'function'
				? tavernStoryTranscriptPendingRows(tavernStoryTranscriptRegenerationDraftRows(tavernStoryTranscriptRows(transcript), transcript, regeneratingStoryTurn), props.pendingInputs)
				: tavernStoryTranscriptRegenerationDraftRows(tavernStoryTranscriptRows(transcript), transcript, regeneratingStoryTurn)
			const overlaid = tavernStoryTranscriptStreamRows(base, partial, props.runningCalls, cached.turn, allowCommitted && partial === props.partial, storyStreamUid)
			// 生成期间只处理当前流式目标；除此之外故事存档怎么返回就怎么渲染。
			if (regeneratingTarget === null) return overlaid
			const streaming = overlaid.some(function (row) { return row.streaming === true && row.messageUid === regeneratingTarget })
			return streaming ? overlaid : overlaid.filter(function (row) { return !(row.role === 'assistant' && row.messageUid === regeneratingTarget) })
		}, [transcript, partial, props.runningCalls, props.pendingInputs, cached.turn, allowCommitted, storyStreamUid, regeneratingTarget, regeneratingStoryTurn])
		if (!rows.length) {
			return h('div', {
				className: 'dsh-tavern-story-transcript-row dsh-tavern-story-empty',
				'data-story-transcript': transcript && transcript.source ? String(transcript.source) : 'story',
				'data-revision': transcript && transcript.revision !== undefined ? String(transcript.revision) : undefined,
				role: 'status'
			}, props.emptyLabel || '还没有故事内容')
		}
		return h(React.Fragment, null, rows.map(function (row) {
			const renderKey = row.requestId ? 'request:' + row.requestId : row.key
			return h(StoryTranscriptRow, { key: renderKey, row: row, transcript: transcript, markdown: renderText, running: storyBusy,
				sessionId: sessionId, view: projectionView, helperView: helperView, executeSlash: props.executeSlash, frameOwner: props.frameOwner,
				showPlayProcess: props.showPlayProcess })
		}))
	}

	function useStoryController(store, sessionId, controllerOptions) {
		const settings = controllerOptions || {}
		const [requested, setRequested] = React.useState({ sessionId: '', from: null })
		const localFrom = requested.sessionId === sessionId ? requested.from : null
		const explicitFrom = Number.isSafeInteger(settings.historyFrom) && settings.historyFrom >= 0 ? settings.historyFrom : null
		const historyFrom = explicitFrom === null ? localFrom : explicitFrom
		const showPlayProcess = React.useSyncExternalStore(store.subscribeProcess, store.showPlayProcess, store.showPlayProcess)
		const state = useTavernStoryTranscript(store, sessionId, { historyFrom: historyFrom, enabled: settings.enabled !== false, showPlayProcess })
		const loadOlder = React.useCallback(function () {
			const transcript = state.transcript
			if (!transcript || !Number.isInteger(transcript.from) || transcript.from <= 0) return
			setRequested({ sessionId: sessionId, from: Math.max(0, transcript.from - 60) })
		}, [sessionId, state.transcript])
		return { state: state, historyFrom: historyFrom, loadOlder: loadOlder, showPlayProcess: showPlayProcess && state.sessionId === sessionId }
	}

	function TavernStoryTranscriptContent(props) {
		const state = props.state
		const transcript = props.transcript || state.transcript
		let error = null
		if (state.status === 'error') {
			error = h('div', { className: 'dsh-tavern-story-transcript-row dsh-tavern-story-error', role: 'alert', 'data-story-transcript': 'story' },
				h('span', null, '故事历史读取失败'),
				props.store ? h('button', { type: 'button', className: 'dsh-tavern-btn', onClick: function () {
					void props.store.read(props.sessionId, { historyFrom: props.historyFrom, force: true })
				} }, '重试') : null)
		}
		if (!transcript && (state.status === 'idle' || state.status === 'loading')) {
			return h('div', { className: 'dsh-tavern-story-transcript-row dsh-tavern-story-loading', role: 'status', 'data-story-transcript': 'story' }, '正在读取故事…')
		}
		if (!transcript && state.status === 'error') return error
		const older = transcript && transcript.from > 0 ? h('div', { className: 'dsh-tavern-story-transcript-row dsh-tavern-story-older' },
			h('button', { type: 'button', className: 'dsh-tavern-btn', disabled: state.status === 'refreshing', onClick: props.loadOlder },
				state.status === 'refreshing' ? '正在加载更早…' : '加载更早')) : null
		return h(React.Fragment, null, error, older,
			h(TavernStoryTranscriptList, { transcript: transcript, partial: props.partial, running: props.running,
				runningCalls: props.runningCalls, pendingInputs: props.pendingInputs, emptyLabel: props.emptyLabel, sessionId: props.sessionId, view: props.view,
				executeSlash: props.executeSlash, frameOwner: props.frameOwner, showPlayProcess: props.showPlayProcess }))
	}

	function defaultStore() {
		if (storyTranscriptStore === null) storyTranscriptStore = data.createStoryTranscriptStore()
		return storyTranscriptStore
	}

	function TavernStoryTranscriptView(props) {
		const store = props.store || defaultStore()
		const controller = useStoryController(store, props.sessionId, {
			historyFrom: props.historyFrom,
			enabled: props.transcript ? false : props.enabled !== false
		})
		return h(TavernStoryTranscriptContent, Object.assign({}, props, {
			store: store,
			state: controller.state,
			historyFrom: controller.historyFrom,
			loadOlder: controller.loadOlder,
			showPlayProcess: controller.showPlayProcess,
			transcript: props.transcript || controller.state.transcript,
			view: props.view || controller.state.view
		}))
	}

	function TavernStoryTranscriptFlow(props) {
		const enabled = data.useMode(mode)
		const sessionId = String(props.sessionId || '')
		const sessionMode = typeof useTavernSessionMode === 'function' ? useTavernSessionMode(sessionId) : ''
		const store = props.store || defaultStore()
		const legacyFlow = props.nativeFlow || nativeFlow
		const controller = useStoryController(store, sessionId, {
			historyFrom: props.historyFrom,
			enabled: enabled && sessionMode !== 'card'
		})
		const state = controller.state
		const transcript = props.transcript || state.transcript
		const view = props.view || state.view
		const storyUnavailable = !transcript && state.status === 'empty'
		const storyActive = enabled && sessionMode !== 'card' && (!view || view.mode !== 'card') && !storyUnavailable
		const partial = props.useChat(function (snapshot) { return snapshot && snapshot.legacy ? snapshot.legacy.partial : null })
		const runningCalls = props.useChat(function (snapshot) { return snapshot && snapshot.legacy && Array.isArray(snapshot.legacy.runningCalls) ? snapshot.legacy.runningCalls : TAVERN_STORY_TRANSCRIPT_EMPTY_CALLS })
		const running = props.useSession(function (snapshot) { return snapshot && snapshot.running === true })
		const pendingInputs = props.useSession(function (snapshot) { return snapshot && Array.isArray(snapshot.pendingSubmissions) ? snapshot.pendingSubmissions : TAVERN_STORY_TRANSCRIPT_EMPTY_CALLS })
		const nativeStreamTurn = partial && Number.isInteger(partial.turn) ? partial.turn : null
		const previous = React.useRef({ sessionId: sessionId, enabled: enabled, running: running })
		React.useEffect(function () {
			if (nativeStreamTurn !== null && storyActive) void store.read(sessionId, { historyFrom: controller.historyFrom, force: true })
		}, [store, sessionId, controller.historyFrom, nativeStreamTurn, storyActive])
		// 流式正文消失且宿主已经报空闲，说明这一轮写完了：正式楼层若还没读回来，屏幕上
		// 只剩玩家那一行，要刷新才出现。重新生成、后台收尾都不一定把 running 从 true 翻
		// 回 false，turn/end 的那次重读也就不会来，这里按流本身补一次。
		const streamedStoryTurn = nativeStreamTurn !== null && typeof tavernStoryTurnForDshTurn === 'function'
			? tavernStoryTurnForDshTurn(view, nativeStreamTurn) : nativeStreamTurn
		const streamedTurnBefore = React.useRef(null)
		React.useEffect(function () {
			if (nativeStreamTurn !== null) { streamedTurnBefore.current = streamedStoryTurn; return }
			const settling = streamedTurnBefore.current
			streamedTurnBefore.current = null
			if (settling === null || settling === undefined || !storyActive || running) return
			if (state.status === 'loading' || state.status === 'refreshing') return
			// 这一楼已经落在存档里就不用再读，收尾由 turn/end 与 revision 负责。
			const settled = transcript && Array.isArray(transcript.messages) && transcript.messages.some(function (entry) {
				const message = entry && entry.message
				if (!message || message.role !== 'assistant' || message.placeholder === true) return false
				return Number(message.turn) === Number(settling) || entry.messageUid === (view && view.streamingMessageUid)
			})
			if (settled) return
			void store.read(sessionId, { historyFrom: controller.historyFrom, force: true })
		}, [store, sessionId, controller.historyFrom, storyActive, state.status, transcript, streamedStoryTurn, running, view])
		// The story response seeds this exact bounded view. Until it arrives this
		// outer revision reader is passive; otherwise its first subscription starts
		// a duplicate full getSession before the story response can be published.
		const liveState = typeof useLiveTavernView === 'function' ? useLiveTavernView(sessionId, 'story-transcript-revision', undefined, { deferLoad: !view }) : null
		const liveStoryRevision = Number(liveState && liveState.view && liveState.view.tavernHelper ? liveState.view.tavernHelper.stateRevision
			: view && view.tavernHelper && view.tavernHelper.stateRevision)
		const renderedStoryRevision = Number(transcript && transcript.revision)
		React.useEffect(function () {
			// Settlement and other background Chat writes do not end another native
			// turn. Once the live save revision moves ahead, refresh the story rows so
			// edit/fork/delete selectors never keep the pre-settlement revision.
			if (!transcript || !storyActive || state.status === 'loading' || state.status === 'refreshing') return
			if (!Number.isSafeInteger(liveStoryRevision) || !Number.isSafeInteger(renderedStoryRevision)) return
			if (liveStoryRevision > renderedStoryRevision) void store.read(sessionId, { historyFrom: controller.historyFrom, force: true })
		}, [store, sessionId, controller.historyFrom, storyActive, state.status, liveStoryRevision, renderedStoryRevision])
		React.useEffect(function () {
			// An ordinary chat with no Tavern story falls back to the native flow;
			// restore every native row instead of leaving only the latest turn.
			storyEligibility.set(sessionId, !storyUnavailable && sessionMode !== 'card' && (!view || view.mode !== 'card'))
			if (storyExternalHistory) storyExternalHistory.refresh(sessionId)
		}, [sessionId, enabled, sessionMode, view && view.mode, storyUnavailable])
		React.useEffect(function () {
			const last = previous.current
			const sameSession = last.sessionId === sessionId
			const resumed = sameSession && enabled && !last.enabled
			// The host appends turn/end only after the awaited turn-stopping hook,
			// which is where foreground.commit persists these same logical rows.
			const turnEnded = sameSession && last.running && !running
			previous.current = { sessionId: sessionId, enabled: enabled, running: running }
			if ((resumed || turnEnded) && storyActive) {
				if (turnEnded && storyExternalHistory) storyExternalHistory.refresh(sessionId, { force: true })
				void store.read(sessionId, { historyFrom: controller.historyFrom, force: true })
			}
		}, [store, sessionId, controller.historyFrom, running, enabled, sessionMode, storyActive])
		React.useEffect(function () {
			if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
			function changed(event) {
				if (event && event.detail && String(event.detail.sessionId || '') === sessionId && storyActive) {
					void store.read(sessionId, { historyFrom: controller.historyFrom, force: true })
				}
			}
			window.addEventListener('dsh-tavern-story-mutated', changed)
			return function () { window.removeEventListener('dsh-tavern-story-mutated', changed) }
		}, [store, sessionId, controller.historyFrom, storyActive])
		React.useEffect(function () {
			if (view && typeof view.mode === 'string' && typeof publishSessionMode === 'function') publishSessionMode(sessionId, view.mode)
		}, [sessionId, view && view.mode])

		if (!storyActive) {
			return legacyFlow ? h(legacyFlow, props) : h('div', { role: 'alert' }, '原生聊天记录暂不可用')
		}
		return h(TavernStoryTranscriptContent, Object.assign({}, props, {
			store: store,
			state: state,
			historyFrom: controller.historyFrom,
			loadOlder: controller.loadOlder,
			showPlayProcess: controller.showPlayProcess,
			transcript: transcript,
			view: view,
			partial: partial,
			running: running,
			runningCalls: runningCalls,
			pendingInputs: pendingInputs
		}))
	}

	function StoryTranscriptFlowSlot(props) {
		return h(TavernStoryTranscriptFlow, Object.assign({}, props, { nativeFlow: nativeFlow, store: options.store,
			executeSlash: props.executeSlash || flowExecuteSlash }))
	}

	function register(input) {
		const ctx = input.ctx, slots = input.slots
		if (typeof installTavernPlayerInputPersistence === 'function') ctx.effect(function () {
			return installTavernPlayerInputPersistence(ctx)
		}, 'dsh-tavern: persist player input')
		if (!flowExecuteSlash && typeof createTavernFrameSlashExecutor === 'function') flowExecuteSlash = createTavernFrameSlashExecutor(ctx)
		if (!storyExternalHistory && externalHistoryInstaller && typeof ctx.get === 'function') ctx.effect(function () {
			const uiConversation = ctx.get('uiConversation') || ctx.get('conversation')
			const external = externalHistoryInstaller({
				require: typeof require === 'function' ? require : function () { throw new Error('宿主模块加载器不可用') },
				uiConversation: uiConversation,
				isEnabled: function (sessionId) {
					if (!mode.getSnapshot() || storyEligibility.get(String(sessionId)) === false) return false
					const values = typeof tavernSessionModes !== 'undefined' && tavernSessionModes && tavernSessionModes.values ? tavernSessionModes.values : {}
					const sessionMode = values[String(sessionId)] || ''
					return !sessionMode || (typeof isPlayMode === 'function' ? isPlayMode(sessionMode) : sessionMode !== 'card')
				}
			})
			storyExternalHistory = external
			function currentSession() {
				const snapshot = ctx.sessions && ctx.sessions.list && ctx.sessions.list.getSnapshot()
				return snapshot && snapshot.current ? String(snapshot.current) : ''
			}
			const unsubscribe = typeof mode.subscribe === 'function' ? mode.subscribe(function () { external.refresh(currentSession()) }) : function () {}
			external.refresh(currentSession())
			return function () {
				unsubscribe()
				if (storyExternalHistory === external) storyExternalHistory = null
				external.dispose()
			}
		}, 'dsh-tavern: story external history')
		ctx.effect(function () {
			return slots.inject('conversation.chat.flow', function () {
				let dispose = null, installing = false
				function install() {
					if (dispose || installing) return
					const nativeEntry = slots.entries('conversation.chat.flow').find(function (entry) { return entry.component !== StoryTranscriptFlowSlot && entry.component })
					if (!nativeEntry) return
					nativeFlow = nativeEntry.component
					const registration = { name: 'conversation.chat.flow', priority: -1, registrant: 'dsh-tavern' }
					for (const key of ['inject', 'store', 'locale']) if (nativeEntry[key] !== undefined) registration[key] = nativeEntry[key]
					// children deliberately stay on the native entry: conversation.chat.node
					// is already declared there and cannot be declared a second time.
					installing = true
					try { dispose = slots.register(registration, StoryTranscriptFlowSlot) }
					finally { installing = false }
				}
				const unsubscribe = typeof slots.subscribe === 'function' ? slots.subscribe('conversation.chat.flow', install) : function () {}
				install()
				return function () {
					unsubscribe()
					const current = dispose
					dispose = null
					if (current) current()
				}
			})
		}, 'dsh-tavern: story transcript flow')
	}

	return Object.freeze({
		StoryTranscriptList: TavernStoryTranscriptList,
		StoryTranscriptView: TavernStoryTranscriptView,
		StoryTranscriptRow: StoryTranscriptRow,
		StoryTranscriptMarkdown: TavernStoryMarkdown,
		StoryTranscriptFlow: TavernStoryTranscriptFlow,
		register: register,
		mode: mode
	})
}
