// 故事历史（story）正文的独立读取层。只用 play.getStoryTranscript（客户端方法名
// "getStoryTranscript"），不读 getSession、不做 reconcile，也不依赖宿主 Chat 快照或
// sessionEvents；列表组件拿到的是纯投影。
//
// 接入（主线程稍后做，本文件不注册任何槽）：
//   main.js: // @include features/story-transcript-data.js
//   main.js: exports.createTavernStoryTranscriptDataModule = createTavernStoryTranscriptDataModule
//   const storyTranscriptData = createTavernStoryTranscriptDataModule()
//   await storyTranscriptData.fetchStoryTranscript(sessionId, { historyFrom })
//   storyTranscriptData.createStoryTranscriptStore() / .useStoryTranscript(store, sessionId, { historyFrom })
//   include 顺序：本文件先于 features/story-transcript-list.js（列表复用这里的纯投影）。
//
// 输入 transcript：{source:'story', revision, from, to, messageCount, floorCount,
// floorOffset, messages:[{absoluteIndex, key, legacyTurn, nativeTurn, floorNo, messageUid, message}]}，
// 由 lib/domain/story-transcript.js 的 projectStoryTranscript 产出。

// 故事行正文：持久消息可能是 {text}（story 存档）、{message}（Helper 旁路）或
// content 块数组（宿主修复行）。取不到文本时返回空串，不猜测。
function tavernStoryTranscriptMessageText(message) {
	if (typeof message === 'string') return message
	if (!message || typeof message !== 'object') return ''
	if (message.role === 'assistant' && typeof message.displayText === 'string') return message.displayText
	if (typeof message.text === 'string') return message.text
	if (typeof message.message === 'string') return message.message
	const content = Array.isArray(message.content) ? message.content
		: message.message && Array.isArray(message.message.content) ? message.message.content : null
	if (!content) return ''
	return content.filter(function (block) { return block && block.type === 'text' && typeof block.text === 'string' })
		.map(function (block) { return block.text }).join('\n')
}

function tavernStoryTranscriptHistoryFrom(value) {
	return Number.isSafeInteger(value) && value >= 0 ? value : null
}

// A transcript object is immutable while one stream is being published. Reuse
// its base rows so a new partial only allocates the single overlaid tail row;
// without this every published partial rebuilt every row object and defeated
// memoization further down the list.
const TAVERN_STORY_TRANSCRIPT_ROWS_CACHE = new WeakMap()

// 严格按 messages 数组顺序逐条投影，一步都不排序：turn 只带走 legacyTurn，
// 重复、缺失、非单调的 turn 都不会重排，也不参与 key（key 由 projection 给出）。
function tavernStoryTranscriptRows(transcript) {
	const entries = transcript && Array.isArray(transcript.messages) ? transcript.messages : []
	if (transcript && typeof transcript === 'object') {
		const cached = TAVERN_STORY_TRANSCRIPT_ROWS_CACHE.get(transcript)
		if (cached && cached.messages === entries) return cached.rows
	}
	const rows = []
	let previousUser = null
	for (let position = 0; position < entries.length; position++) {
		const entry = entries[position] && typeof entries[position] === 'object' ? entries[position] : {}
		const message = entry.message && typeof entry.message === 'object' ? entry.message : {}
		const role = typeof message.role === 'string' ? message.role : ''
		// Helper-created user input feeds model context without becoming a player message.
		if (role === 'tavern-helper' && (message.tavernRole === 'user' || message.tavernHidden === true)) continue
		const absoluteIndex = Number.isInteger(entry.absoluteIndex) ? entry.absoluteIndex : null
		const key = typeof entry.key === 'string' && entry.key !== ''
			? entry.key
			: 'index:' + (absoluteIndex === null ? position : absoluteIndex)
		const floorNo = role === 'assistant' && Number.isInteger(entry.floorNo) && entry.floorNo > 0 ? entry.floorNo : null
		const legacyTurn = Number.isInteger(entry.legacyTurn) && entry.legacyTurn > 0 ? entry.legacyTurn : null
		const text = tavernStoryTranscriptMessageText(message)
		const streaming = role === 'assistant' && message.placeholder === true
		const source = message.source && typeof message.source === 'object' ? message.source
			: entry.source && typeof entry.source === 'object' ? entry.source : null
		const requestId = source && typeof source.rpcId === 'string' && source.rpcId ? source.rpcId : null
		const nextEntry = entries[position + 1]
		const nextMessage = nextEntry && nextEntry.message && typeof nextEntry.message === 'object' ? nextEntry.message : null
		const nextReplyTurn = role === 'user' && nextMessage && nextMessage.role === 'assistant' && Number.isSafeInteger(nextMessage.turn) && nextMessage.turn > 0
			? String(nextMessage.turn) : null
		// 旧存档里同一条提交（同一个请求号）可能被写了两行：一次准备、一次补写。
		// 视图只画第一行，否则玩家看到两个一模一样的输入气泡。
		if (role === 'user' && requestId !== null && previousUser !== null
			&& previousUser.requestId === requestId && previousUser.text === text) continue
		if (role === 'user' && requestId !== null) previousUser = { requestId: requestId, text: text }
		rows.push({
			key: key,
			position: position,
			role: role,
			// 开场（greeting）也是 1 号楼层：projection 的 floorNo 已经按 assistant 实际顺序编号。
			floorNo: floorNo,
			greeting: message.greeting === true,
			legacyTurn: legacyTurn,
			nativeTurn: Number.isSafeInteger(entry.nativeTurn) && entry.nativeTurn > 0 ? entry.nativeTurn : null,
			inputTurnKey: nextReplyTurn,
			absoluteIndex: absoluteIndex,
			messageUid: typeof entry.messageUid === 'string' && entry.messageUid ? entry.messageUid
				: (typeof message.messageUid === 'string' && message.messageUid ? message.messageUid : null),
			requestId: requestId,
			text: text,
			streaming: streaming,
			tool: null,
			toolCalls: entry.toolCalls,
			projection: role === 'assistant' ? {
				version: Math.max(1, Number(message.projectionVersion) || 1),
				turn: Number.isInteger(message.turn) ? message.turn : (message.greeting === true ? 1 : 0),
				text: text,
				mode: streaming ? 'markdown' : (typeof message.displayMode === 'string' && message.displayMode ? message.displayMode : 'markdown'),
				warnings: Array.isArray(message.projectionWarnings) ? message.projectionWarnings : []
			} : null,
			message: message
		})
	}
	if (transcript && typeof transcript === 'object') TAVERN_STORY_TRANSCRIPT_ROWS_CACHE.set(transcript, { messages: entries, rows: rows })
	return rows
}

// 失败尾重新生成时，存档末尾只有玩家输入，没有旧 assistant 行可供流式覆盖。
// 在这次生成期间补一个纯视图占位行；它使用即将提交的故事轮次与绝对位置，
// 所以正式正文落盘后会复用同一 DOM。生成失败则随视图标记结束自然消失。
function tavernStoryTranscriptRegenerationDraftRows(rows, transcript, storyTurn, damperOutcome) {
	if (!Number.isInteger(storyTurn) || storyTurn <= 0 || !transcript || !Array.isArray(transcript.messages)) return rows
	const messageCount = Number(transcript.messageCount)
	// 只有包含存档尾部的窗口才能追加这一轮，往前翻历史时不把新行插进旧页。
	if (!Number.isSafeInteger(messageCount) || Number(transcript.to) !== messageCount - 1) return rows
	if (rows.some(function (row) {
		return row && row.role === 'assistant' && (row.legacyTurn === storyTurn || Number(row.message && row.message.turn) === storyTurn)
	})) return rows
	const key = 'turn:' + String(storyTurn)
	const message = {
		role: 'assistant', turn: storyTurn, text: '', placeholder: true,
		...(damperOutcome && typeof damperOutcome === 'object' ? { narrativeDamper: [damperOutcome] } : {})
	}
	return rows.concat({
		key: key,
		position: rows.length,
		role: 'assistant',
		floorNo: Math.max(0, Number(transcript.floorCount) || 0) + 1,
		greeting: false,
		legacyTurn: storyTurn,
		absoluteIndex: messageCount,
		messageUid: null,
		text: '',
		streaming: true,
		tool: null,
		projection: { version: 1, turn: storyTurn, text: '', mode: 'markdown', warnings: [] },
		message: message
	})
}

function sameDamperOutcomeValue(left, right) {
	if (left === right) return true
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
	try { return JSON.stringify(left) === JSON.stringify(right) }
	catch { return false }
}

function tavernStoryTranscriptDamperRows(rows, options) {
	const source = Array.isArray(rows) ? rows : []
	if (!options || typeof options !== 'object' || source.length === 0) return source
	const live = options.live && options.live.active === true && options.live.outcome && typeof options.live.outcome === 'object'
		? options.live : null
	const regenOutcome = options.regenOutcome && typeof options.regenOutcome === 'object' ? options.regenOutcome : null
	const regenerating = options.regenerating === true
	const targetUid = typeof options.targetUid === 'string' && options.targetUid !== '' ? options.targetUid : null
	const targetStoryTurn = Number.isInteger(options.storyTurn) && options.storyTurn > 0 ? options.storyTurn : null
	let index = -1
	let desiredOutcome = null
	if (regenerating) {
		if (targetUid !== null) {
			index = source.findLastIndex(function (row) {
				return row && row.role === 'assistant' && row.messageUid === targetUid
			})
		} else if (targetStoryTurn !== null) {
			index = source.findLastIndex(function (row) {
				return row && row.role === 'assistant' && (row.legacyTurn === targetStoryTurn || Number(row.message && row.message.turn) === targetStoryTurn)
			})
		}
		if (index >= 0) {
			const liveMatches = live && (
				live.targetMessageUid ? live.targetMessageUid === targetUid
					: (targetStoryTurn !== null && Number(live.storyTurn) === targetStoryTurn)
						|| live.regeneration === true
			)
			desiredOutcome = liveMatches ? live.outcome : regenOutcome
		}
	} else if (live && live.regeneration !== true) {
		const liveTurn = Number.isInteger(live.storyTurn) && live.storyTurn > 0 ? live.storyTurn : null
		index = source.findLastIndex(function (row) {
			if (!row || row.role !== 'assistant' || row.greeting || row.streaming !== true) return false
			if (live.targetMessageUid && row.messageUid === live.targetMessageUid) return true
			return liveTurn !== null && (row.legacyTurn === liveTurn || Number(row.message && row.message.turn) === liveTurn)
		})
		if (index < 0) {
			index = source.findLastIndex(function (row) {
				return Boolean(row && row.role === 'assistant' && !row.greeting && row.streaming === true)
			})
		}
		if (index >= 0) desiredOutcome = live.outcome
	}
	if (index < 0) return source
	const row = source[index]
	if (!row || !row.message || row.streaming !== true) return source
	const existingList = Array.isArray(row.message.narrativeDamper) ? row.message.narrativeDamper : null
	const swipeId = Math.max(0, Number(row.message.swipeId) || 0)
	const existing = existingList ? (existingList[swipeId] || existingList[0] || null) : null
	if (desiredOutcome) {
		if (sameDamperOutcomeValue(existing, desiredOutcome)) return source
		const nextMessage = Object.assign({}, row.message, { narrativeDamper: [desiredOutcome] })
		const next = source.slice()
		next[index] = Object.assign({}, row, { message: nextMessage })
		return next
	}
	if (regenerating && existingList) {
		const nextMessage = Object.assign({}, row.message)
		delete nextMessage.narrativeDamper
		delete nextMessage.damperState
		const next = source.slice()
		next[index] = Object.assign({}, row, { message: nextMessage })
		return next
	}
	return source
}

function tavernStoryTranscriptStreamText(partial) {
	const blocks = Array.isArray(partial && partial.blocks) ? partial.blocks : []
	const texts = []
	for (let index = 0; index < blocks.length; index++) {
		const block = blocks[index]
		if (block && block.kind === 'text' && typeof block.text === 'string' && block.text !== '') texts.push(block.text)
	}
	return texts.join('\n')
}

function tavernStoryTranscriptReasoningState(blocks, streaming) {
	const list = Array.isArray(blocks) ? blocks : []
	const parts = []
	let lastMeaningfulKind = ''
	for (let index = 0; index < list.length; index++) {
		const block = list[index]
		if (!block || typeof block !== 'object') continue
		if (block.kind === 'reasoning') {
			if (typeof block.text === 'string' && block.text.trim() !== '') {
				parts.push(block.text)
				lastMeaningfulKind = 'reasoning'
			}
		} else if (block.kind === 'text') {
			if (typeof block.text === 'string' && block.text.trim() !== '') {
				lastMeaningfulKind = 'text'
			}
		} else {
			lastMeaningfulKind = String(block.kind || 'other')
		}
	}
	return {
		text: parts.join('\n\n'),
		live: streaming === true && parts.length > 0 && lastMeaningfulKind === 'reasoning'
	}
}

function tavernStoryTranscriptTurnReasoning(turn) {
	const steps = turn && Array.isArray(turn.steps) ? turn.steps : []
	const parts = []
	let live = false
	for (let index = 0; index < steps.length; index++) {
		const data = steps[index] && steps[index].data
		const node = data && typeof data.get === 'function' ? data.get('assistant-step') : data
		if (!node) continue
		const state = tavernStoryTranscriptReasoningState(node.blocks, node.status === 'running')
		if (state.text !== '') parts.push(state.text)
		if (state.live) live = true
	}
	return { text: parts.join('\n\n'), live: live }
}

function tavernStoryTranscriptSummarizeSteps(stepsMap, activeStep, active) {
	if (!(stepsMap instanceof Map) || stepsMap.size === 0) return { text: '', live: false }
	const keys = Array.from(stepsMap.keys()).sort(function (a, b) { return a - b })
	const parts = []
	let live = false
	for (let index = 0; index < keys.length; index++) {
		const key = keys[index]
		const entry = stepsMap.get(key)
		if (!entry || !entry.text) continue
		parts.push(entry.text)
		if (active === true && key === activeStep && entry.live === true) live = true
	}
	return { text: parts.join('\n\n'), live: live }
}

// Stream text is an overlay on the real assistant placeholder, never another
// message. Missing rows stay missing: the prepare revision must create them.
// A live partial may also overlay a regenerated committed row; a retained
// post-step partial is restricted to rows still marked placeholder=true.
// A body regeneration names its target by messageUid: the story view carries no
// regeneratedDshTurns, so the native partial turn cannot identify the row. When
// messageUid is given only that exact row may be overlaid — rows sharing the
// story turn, and the turn hint itself, stay untouched.
function tavernStoryTranscriptStreamRows(rows, partial, runningCalls, storyTurn, allowCommitted, messageUid, reasoningOverride) {
	if (!partial) return rows
	const source = Array.isArray(rows) ? rows : []
	const streamUid = typeof messageUid === 'string' && messageUid !== '' ? messageUid : null
	let index = -1
	if (streamUid !== null) {
		index = source.findLastIndex(function (row) {
			return row && row.role === 'assistant' && row.messageUid === streamUid
		})
	} else if (Number.isInteger(storyTurn)) {
		index = source.findLastIndex(function (row) {
			return row && row.role === 'assistant' && (row.legacyTurn === storyTurn || Number(row.message && row.message.turn) === storyTurn)
		})
	}
	if (index < 0 || (!allowCommitted && source[index].streaming !== true)) return rows
	const calls = Array.isArray(runningCalls) ? runningCalls : []
	const latestCall = calls.length ? calls[calls.length - 1] : null
	const streamed = tavernStoryTranscriptStreamText(partial)
	const streamedReasoning = reasoningOverride && typeof reasoningOverride === 'object'
		? { text: typeof reasoningOverride.text === 'string' ? reasoningOverride.text : '', live: reasoningOverride.live === true }
		: tavernStoryTranscriptReasoningState(partial && partial.blocks, Boolean(partial))
	const row = source[index]
	const text = streamed !== '' ? streamed : row.text
	const reasoningText = streamedReasoning.text !== '' ? streamedReasoning.text : (row.reasoningText || '')
	const reasoningLive = streamedReasoning.text !== '' ? streamedReasoning.live : false
	const streamingNativeTurn = reasoningOverride && Number.isInteger(reasoningOverride.nativeTurn) && reasoningOverride.nativeTurn > 0
		? reasoningOverride.nativeTurn
		: (Number.isInteger(partial && partial.turn) && partial.turn > 0 ? partial.turn : (row.streamingNativeTurn || null))
	const tool = latestCall && typeof latestCall.name === 'string' ? latestCall.name : row.tool || null
	// 仅在文本、工具和思维链均未变化时跳过复制，纯思维链增量仍需刷新行状态。
	if (row.streaming === true && row.text === text && row.tool === tool
		&& (row.reasoningText || '') === reasoningText
		&& Boolean(row.reasoningLive) === reasoningLive
		&& (row.streamingNativeTurn || null) === streamingNativeTurn) return rows
	const next = source.slice()
	next[index] = Object.assign({}, row, {
		streaming: true,
		text: text,
		reasoningText: reasoningText,
		reasoningLive: reasoningLive,
		streamingNativeTurn: streamingNativeTurn,
		tool: tool,
		projection: row.projection ? Object.assign({}, row.projection, { text: text, mode: 'markdown' }) : null
	})
	return next
}

// Host submissions are visible to the composer one frame before their player
// row reaches the durable story log. Paint those echoes as ordinary story rows
// and reconcile them by requestId; the durable row then replaces the same DOM
// node (the list uses requestId as its React key).
function tavernStoryTranscriptPendingRows(rows, pendingInputs) {
	const source = Array.isArray(rows) ? rows : []
	const pending = Array.isArray(pendingInputs) ? pendingInputs : []
	if (pending.length === 0) return source
	const represented = new Set()
	for (const row of source) if (row && row.requestId) represented.add(row.requestId)
	const seen = new Set()
	let next = source
	for (const input of pending) {
		if (!input || typeof input !== 'object') continue
		const requestId = typeof input.requestId === 'string' ? input.requestId : ''
		const text = typeof input.text === 'string' ? input.text : ''
		if (requestId === '' || text.trim() === '' || represented.has(requestId) || seen.has(requestId)) continue
		seen.add(requestId)
		if (next === source) next = source.slice()
		next.push({
			key: 'pending:' + requestId,
			position: next.length,
			role: 'user',
			floorNo: null,
			greeting: false,
			legacyTurn: null,
			absoluteIndex: null,
			messageUid: null,
			requestId: requestId,
			text: text,
			streaming: false,
			tool: null,
			projection: null,
			message: { role: 'user', text: text, placeholder: true, source: { kind: 'user', rpcId: requestId } }
		})
	}
	return next
}

const TAVERN_STORY_TRANSCRIPT_NOOP_SUBSCRIBE = function () { return function () {} }
const TAVERN_STORY_TRANSCRIPT_IDLE_SNAPSHOT = Object.freeze({
	sessionId: '', historyFrom: null, status: 'idle', transcript: null, view: null, revision: null, error: null, ticket: 0
})


// 组件订阅 store 的 hook（顶层函数，列表文件直接复用）。store 缺失时返回 idle，
// 组件仍然无条件调用本 hook，避免条件 hook。
function useTavernStoryTranscript(store, sessionId, hookOptions) {
	const settings = hookOptions || {}
	const historyFrom = tavernStoryTranscriptHistoryFrom(settings.historyFrom)
	const enabled = settings.enabled !== false && store !== null && store !== undefined
	const force = settings.force === true
	// Read the cache for this exact target during render. Switching sessions must
	// not inherit the previous slot's snapshot, and a warm target must paint on
	// its first render instead of waiting for the read effect.
	const getSnapshot = React.useCallback(function () {
		if (!enabled) return TAVERN_STORY_TRANSCRIPT_IDLE_SNAPSHOT
		if (typeof store.snapshotFor === 'function') return store.snapshotFor(sessionId, historyFrom)
		return store.getSnapshot()
	}, [enabled, store, sessionId, historyFrom])
	const snapshot = React.useSyncExternalStore(
		enabled ? store.subscribe : TAVERN_STORY_TRANSCRIPT_NOOP_SUBSCRIBE,
		getSnapshot,
		getSnapshot)
	const read = enabled ? store.read : null
	const showPlayProcess = settings.showPlayProcess === true
	React.useEffect(function () {
		if (read === null) return
		void read(sessionId, { historyFrom: historyFrom, force: force })
	}, [read, sessionId, historyFrom, force, showPlayProcess])
	return snapshot
}

// Story windows and live views are separate projections. Coordinate reads here
// so rendering does not have to order their refresh triggers.
function useTavernStoryLiveDamper(sessionId) {
	const [damper, setDamper] = React.useState(null)
	React.useEffect(function () {
		setDamper(null)
		if (!sessionId || typeof tavernSessionSignals === 'undefined' || typeof tavernSessionSignals?.subscribe !== 'function') {
			return undefined
		}
		return tavernSessionSignals.subscribe(sessionId, 'narrative-damper', function (signal) {
			const snap = signal && signal.snapshot && typeof signal.snapshot === 'object' ? signal.snapshot : null
			if (snap && snap.active === true && snap.outcome && typeof snap.outcome === 'object') {
				setDamper(snap)
			} else {
				setDamper(null)
			}
		})
	}, [sessionId])
	return damper
}

function useTavernStoryProjectionRefresh(store, sessionId, {
	historyFrom, enabled, active, running, partial, transcript, view, externalHistory
}) {
	const live = typeof useLiveTavernView === 'function'
		? useLiveTavernView(sessionId, 'story-transcript-revision', undefined, { deferLoad: !view }) : null
	const liveRevision = Number(
		live?.view?.storageRevision ?? live?.view?.tavernHelper?.stateRevision
		?? view?.storageRevision ?? view?.tavernHelper?.stateRevision
	)
	const storyRevision = Number(transcript?.revision)
	const nativeTurn = Number.isInteger(partial?.turn) ? partial.turn : null
	const storyTurn = nativeTurn !== null && typeof tavernStoryTurnForDshTurn === 'function'
		? tavernStoryTurnForDshTurn(view, nativeTurn) : nativeTurn
	const previous = React.useRef(null)
	const requestRefresh = React.useRef(null)

	React.useEffect(function () {
		if (!active || !sessionId || typeof window === 'undefined') return undefined
		let wantedRevision = 0
		// Local invalidations have no revision. Remember any that arrive during a read.
		let requestedRead = 0, acceptedRead = 0
		const snapshot = () => store.snapshotFor(sessionId, historyFrom)
		const reached = read => (read.status === 'ready' || read.status === 'empty') && read.revision >= wantedRevision
		const refresh = createSessionRefreshController({
			loadTimeoutMs: 10000,
			retryDelaysMs: TAVERN_PROJECTION_RETRY_DELAYS_MS,
			async load({ signal }) {
				const requested = requestedRead
				if (requested !== acceptedRead || !reached(snapshot())) {
					await store.read(sessionId, { historyFrom, force: true, signal, minimumRevision: wantedRevision })
				}
				return requested
			},
			onResult(requested) {
				const read = snapshot()
				if (!reached(read)) {
					throw read.error || new Error('故事历史尚未读到已提交版本')
				}
				acceptedRead = requested
			},
			onError() {}
		})
		refresh.start()
		function request(revision, committed = false) {
			if (revision === undefined) requestedRead++
			else {
				if (!Number.isSafeInteger(revision) || revision <= snapshot().revision || revision < wantedRevision) return
				if (revision === wantedRevision && !committed) return
				wantedRevision = revision
				// A durable commit can overtake a read started while the model was still finishing.
				if (committed) refresh.replace()
			}
			refresh.request()
		}
		requestRefresh.current = request
		function changed(event) {
			if (String(event.detail?.sessionId || '') === sessionId) request()
		}
		window.addEventListener('dsh-tavern-story-mutated', changed)
		const unsubscribe = typeof tavernSessionSignals !== 'undefined' && tavernSessionSignals?.subscribe(sessionId, 'story-regenerated', signal => {
			request(Number(signal.version), true)
		})
		const unsubscribeState = typeof tavernSessionSignals !== 'undefined' && tavernSessionSignals?.subscribe(sessionId, 'tavern-state', signal => {
			const revision = Number(signal && signal.snapshot && signal.snapshot.storageRevision)
			if (Number.isSafeInteger(revision) && revision > 0) request(revision, true)
		})
		return function () {
			requestRefresh.current = null
			refresh.stop()
			window.removeEventListener('dsh-tavern-story-mutated', changed)
			if (unsubscribe) unsubscribe()
			if (unsubscribeState) unsubscribeState()
		}
	}, [store, sessionId, historyFrom, active])

	React.useEffect(function () {
		const last = previous.current
		const sameSession = last?.store === store && last.sessionId === sessionId
		const sameWindow = sameSession && last.historyFrom === historyFrom
		previous.current = { store, sessionId, historyFrom, enabled, active, running, nativeTurn, storyTurn }
		if (!active) return

		const resumed = sameSession && enabled && !last.enabled
		const turnEnded = sameSession && last.running && !running
		const openingStatus = !sameWindow ? store.snapshotFor?.(sessionId, historyFrom)?.status : null
		const openingRead = openingStatus === 'loading' || openingStatus === 'refreshing'
		const streamStarted = nativeTurn !== null && !openingRead && (!sameWindow || !last.active || last.nativeTurn !== nativeTurn)
		const streamStopped = sameSession && last.active && last.storyTurn != null && nativeTurn === null && !running
		const settled = streamStopped && Array.isArray(transcript?.messages) && transcript.messages.some(function (entry) {
			const message = entry?.message
			return message?.role === 'assistant' && message.placeholder !== true
				&& (Number(message.turn) === Number(last.storyTurn) || (entry.messageUid && entry.messageUid === view?.streamingMessageUid))
		})
		if (turnEnded) externalHistory?.refresh(sessionId, { force: true })
		if (resumed || turnEnded || streamStarted || (streamStopped && !settled)) {
			requestRefresh.current?.()
		}
		if (Number.isSafeInteger(storyRevision) && liveRevision > storyRevision) requestRefresh.current?.(liveRevision)
	}, [store, sessionId, historyFrom, enabled, active, running, nativeTurn, storyTurn,
		transcript, view, liveRevision, storyRevision, externalHistory])
}

function createTavernStoryTranscriptModeStore(storeOptions) {
	const options = storeOptions || {}
	const key = options.key || 'dsh-tavern-story-transcript-renderer'
	let storage = options.storage
	if (!storage) {
		try { storage = typeof window !== 'undefined' ? window.localStorage : null } catch (_) { storage = null }
	}
	let enabled = true
	try { enabled = storage && storage.getItem(key) === 'legacy' ? false : true } catch (_) {}
	const listeners = new Set()
	function set(value) {
		const next = value !== false
		if (next === enabled) return
		enabled = next
		try { if (storage) storage.setItem(key, enabled ? 'story' : 'legacy') } catch (_) {}
		listeners.forEach(function (listener) { listener(enabled) })
	}
	return Object.freeze({
		getSnapshot: function () { return enabled },
		subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener) } },
		set: set,
		toggle: function () { set(!enabled) }
	})
}

function useTavernStoryTranscriptMode(store) {
	return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

function createTavernStoryTranscriptDataModule(deps) {
	const options = deps || {}

	function fail(message, code) {
		return Object.assign(new Error(message), { code: code || 'STORY_TRANSCRIPT_INVALID' })
	}

	// 宿主 HTTP 通道是 main.js 的 rpc(method, args, sessionId)；测试通过 deps.rpc 注入。
	function request(method, args, sessionId, requestOptions) {
		if (typeof options.rpc === 'function') return options.rpc(method, args, sessionId, requestOptions)
		if (typeof rpc === 'function') return rpc(method, args, sessionId, requestOptions)
		return Promise.reject(fail('故事历史缺少 RPC 通道', 'STORY_TRANSCRIPT_NO_RPC'))
	}

	/** 一次故事历史读取：只调用 play.getStoryTranscript。 */
	async function fetchStoryTranscript(sessionId, readOptions) {
		const id = String(sessionId || '')
		if (id === '') throw fail('故事历史缺少会话', 'STORY_TRANSCRIPT_NO_SESSION')
		const historyFrom = tavernStoryTranscriptHistoryFrom(readOptions && readOptions.historyFrom)
		const args = historyFrom === null ? { sessionId: id } : { sessionId: id, historyFrom: historyFrom }
		if (readOptions?.includeToolCalls === true) args.includeToolCalls = true
		const result = await request('getStoryTranscript', args, id, readOptions?.signal ? { signal: readOptions.signal } : undefined)
		return {
			sessionId: id,
			historyFrom: historyFrom,
			transcript: result && result.storyTranscript ? result.storyTranscript : null,
			view: result && result.view ? result.view : null,
			revision: result && result.revision !== undefined ? result.revision : null
		}
	}

	const IDLE = TAVERN_STORY_TRANSCRIPT_IDLE_SNAPSHOT

	// 单槽用的极简 store：同一会话+historyFrom 不重复读，旧请求的晚到结果被序号挡掉。
	function createStoryTranscriptStore(storeOptions) {
		const settings = storeOptions || {}
		const load = typeof settings.load === 'function' ? settings.load : fetchStoryTranscript
		const preferences = options.displayPreferences || (typeof displayPreferences === 'undefined' ? null : displayPreferences)
		const showPlayProcess = () => preferences?.snapshot()?.showPlayProcess === true
		const showDamperStatus = () => preferences?.snapshot()?.showDamperStatus !== false
		const subscribeProcess = preferences ? preferences.subscribe : TAVERN_STORY_TRANSCRIPT_NOOP_SUBSCRIBE
		const listeners = new Set()
		// The visible store is single-slot, but switching sessions must not throw away
		// every transcript it already downloaded. Keep a small LRU by session+window;
		// force/read-after-mutation still bypasses it and replaces the cached revision.
		const cacheSize = Number.isSafeInteger(settings.cacheSize) ? Math.max(0, settings.cacheSize) : 4
		const cache = new Map()
		let ticket = 0
		let state = IDLE

		function cacheKey(sessionId, historyFrom) { return JSON.stringify([sessionId, historyFrom]) }
		function touch(key) {
			const cached = cache.get(key)
			if (!cached) return null
			cache.delete(key)
			cache.set(key, cached)
			return cached
		}
		function remember(key, value) {
			if (cacheSize === 0) return
			cache.delete(key)
			cache.set(key, value)
			while (cache.size > cacheSize) cache.delete(cache.keys().next().value)
		}

		// The story response's view is the story's own reduced projection (no round bodies,
		// fork turns or editable inputs); it stays here. The live session view (getSession) is
		// another projection with its own readers: publishing this one into it made the stage
		// lose and regain the round's text on every story read while a round was running.
		function publish(next) {
			state = next
			listeners.forEach(function (listener) {
				try { listener(state) } catch (_) { /* 订阅方自己处理 */ }
			})
		}
		function subscribe(listener) {
			if (typeof listener !== 'function') return function () {}
			listeners.add(listener)
			return function () { listeners.delete(listener) }
		}
		function getSnapshot() { return state }
		function peek(sessionId, historyFrom) {
			const id = String(sessionId || '')
			const from = tavernStoryTranscriptHistoryFrom(historyFrom)
			if (id === '') return null
			if (state.sessionId === id && state.historyFrom === from) return state
			return cache.get(cacheKey(id, from)) || null
		}
		function snapshotFor(sessionId, historyFrom) {
			return peek(sessionId, historyFrom) || IDLE
		}

		async function read(sessionId, readOptions) {
			const id = String(sessionId || '')
			const historyFrom = tavernStoryTranscriptHistoryFrom(readOptions && readOptions.historyFrom)
			const force = readOptions && readOptions.force === true
			const signal = readOptions?.signal
			const includeToolCalls = showPlayProcess()
			const key = cacheKey(id, historyFrom)
			const sameSession = state.sessionId === id
			const sameTarget = sameSession && state.historyFrom === historyFrom && (!includeToolCalls || state.includeToolCalls)
			if (id === '') {
				if (state !== IDLE) {
					ticket += 1
					publish(IDLE)
				}
				return state
			}
			if (!force && sameTarget && (state.status === 'loading' || state.status === 'refreshing')) return state
			if (!force && sameTarget && (state.status === 'ready' || state.status === 'empty')) {
				touch(key)
				return state
			}
			const cached = force ? null : touch(key)
			const cacheHit = cached && (!includeToolCalls || cached.includeToolCalls) ? cached : null
			// 缓存只负责首帧：玩家切走再切回时，这一局在别的视图里可能已经生成完，
			// 宿主的流和 turn/end 都不会通知这里。命中缓存仍然继续读一次，落盘的
			// 正文到位后替换这份旧快照（先上屏、后补读）；补读失败就留着缓存，
			// 不把已经画出来的正文换成错误。
			if (cacheHit) {
				const shown = ++ticket
				publish(Object.assign({}, cacheHit, { ticket: shown }))
			}
			const current = ++ticket
			if (cacheHit === null) {
				publish({
					sessionId: id,
					historyFrom: historyFrom,
					includeToolCalls: includeToolCalls,
					status: sameSession && state.transcript ? 'refreshing' : 'loading',
					transcript: sameSession ? state.transcript : null,
					view: sameSession ? state.view : null,
					revision: sameSession ? state.revision : null,
					error: null,
					ticket: current
				})
			}
			try {
				const result = await load(id, { historyFrom: historyFrom === null ? undefined : historyFrom,
					...(includeToolCalls ? { includeToolCalls: true } : {}), ...(signal ? { signal } : {}) })
				if (current !== ticket) return state
				signal?.throwIfAborted()
				if (readOptions?.minimumRevision && !(result?.revision >= readOptions.minimumRevision)) {
					throw new Error('故事历史尚未读到已提交版本')
				}
				const transcript = result && result.transcript ? result.transcript : null
				const next = {
					sessionId: id, historyFrom: historyFrom, includeToolCalls: includeToolCalls,
					status: transcript ? 'ready' : 'empty',
					transcript: transcript,
					view: result && result.view ? result.view : null,
					revision: result && result.revision !== undefined ? result.revision : null,
					error: null, ticket: current
				}
				remember(key, next)
				publish(next)
			} catch (error) {
				if (current !== ticket) return state
				// 有缓存就已经有东西可看：后台补读失败不打扰玩家，缓存留着，
				// 下一次切换、故事变更或 force 读取会再试。
				if (cacheHit) return state
				const preserve = state.sessionId === id && state.transcript
				publish({ sessionId: id, historyFrom: historyFrom, status: 'error', transcript: preserve ? state.transcript : null,
					view: preserve ? state.view : null, revision: preserve ? state.revision : null, error: error, ticket: current })
			}
			return state
		}

		function reset() {
			ticket += 1
			cache.clear()
			publish(IDLE)
		}

		return Object.freeze({ subscribe: subscribe, getSnapshot: getSnapshot, snapshotFor: snapshotFor, peek: peek, read: read, reset: reset, subscribeProcess, showPlayProcess, showDamperStatus })
	}

	return Object.freeze({
		fetchStoryTranscript: fetchStoryTranscript,
		createStoryTranscriptStore: createStoryTranscriptStore,
		useStoryTranscript: useTavernStoryTranscript,
		useLiveDamper: useTavernStoryLiveDamper,
		useProjectionRefresh: useTavernStoryProjectionRefresh,
		createModeStore: createTavernStoryTranscriptModeStore,
		useMode: useTavernStoryTranscriptMode,
		// 纯投影，列表组件与本模块的测试共用（顶层同名函数）。
		storyTranscriptRows: tavernStoryTranscriptRows,
		storyTranscriptRegenerationDraftRows: tavernStoryTranscriptRegenerationDraftRows,
		storyTranscriptDamperRows: tavernStoryTranscriptDamperRows,
		storyTranscriptStreamRows: tavernStoryTranscriptStreamRows,
		storyTranscriptPendingRows: tavernStoryTranscriptPendingRows,
		storyTranscriptStreamText: tavernStoryTranscriptStreamText,
		storyTranscriptMessageText: tavernStoryTranscriptMessageText
	})
}
