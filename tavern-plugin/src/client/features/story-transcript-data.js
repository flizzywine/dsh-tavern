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
// floorOffset, messages:[{absoluteIndex, key, legacyTurn, floorNo, messageUid, message}]}，
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
		rows.push({
			key: key,
			position: position,
			role: role,
			// 开场（greeting）也是 1 号楼层：projection 的 floorNo 已经按 assistant 实际顺序编号。
			floorNo: floorNo,
			greeting: message.greeting === true,
			legacyTurn: legacyTurn,
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
function tavernStoryTranscriptRegenerationDraftRows(rows, transcript, storyTurn) {
	if (!Number.isInteger(storyTurn) || storyTurn <= 0 || !transcript || !Array.isArray(transcript.messages)) return rows
	const messageCount = Number(transcript.messageCount)
	// 只有包含存档尾部的窗口才能追加这一轮，往前翻历史时不把新行插进旧页。
	if (!Number.isSafeInteger(messageCount) || Number(transcript.to) !== messageCount - 1) return rows
	if (rows.some(function (row) {
		return row && row.role === 'assistant' && (row.legacyTurn === storyTurn || Number(row.message && row.message.turn) === storyTurn)
	})) return rows
	const key = 'turn:' + String(storyTurn)
	const message = { role: 'assistant', turn: storyTurn, text: '', placeholder: true }
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

function tavernStoryTranscriptStreamText(partial) {
	const blocks = Array.isArray(partial && partial.blocks) ? partial.blocks : []
	const texts = []
	for (let index = 0; index < blocks.length; index++) {
		const block = blocks[index]
		if (block && block.kind === 'text' && typeof block.text === 'string' && block.text !== '') texts.push(block.text)
	}
	return texts.join('\n')
}

// Stream text is an overlay on the real assistant placeholder, never another
// message. Missing rows stay missing: the prepare revision must create them.
// A live partial may also overlay a regenerated committed row; a retained
// post-step partial is restricted to rows still marked placeholder=true.
// A body regeneration names its target by messageUid: the story view carries no
// regeneratedDshTurns, so the native partial turn cannot identify the row. When
// messageUid is given only that exact row may be overlaid — rows sharing the
// story turn, and the turn hint itself, stay untouched.
function tavernStoryTranscriptStreamRows(rows, partial, runningCalls, storyTurn, allowCommitted, messageUid) {
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
	const row = source[index]
	const text = streamed !== '' ? streamed : row.text
	const tool = latestCall && typeof latestCall.name === 'string' ? latestCall.name : row.tool || null
	// Reasoning-only partials and repeated text should not allocate a new row.
	if (row.streaming === true && row.text === text && row.tool === tool) return rows
	const next = source.slice()
	next[index] = Object.assign({}, row, {
		streaming: true,
		text: text,
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
	function request(method, args, sessionId) {
		if (typeof options.rpc === 'function') return options.rpc(method, args, sessionId)
		if (typeof rpc === 'function') return rpc(method, args, sessionId)
		return Promise.reject(fail('故事历史缺少 RPC 通道', 'STORY_TRANSCRIPT_NO_RPC'))
	}

	/** 一次故事历史读取：只调用 play.getStoryTranscript。 */
	async function fetchStoryTranscript(sessionId, readOptions) {
		const id = String(sessionId || '')
		if (id === '') throw fail('故事历史缺少会话', 'STORY_TRANSCRIPT_NO_SESSION')
		const historyFrom = tavernStoryTranscriptHistoryFrom(readOptions && readOptions.historyFrom)
		const args = historyFrom === null ? { sessionId: id } : { sessionId: id, historyFrom: historyFrom }
		if (readOptions?.includeToolCalls === true) args.includeToolCalls = true
		const result = await request('getStoryTranscript', args, id)
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
		const subscribeProcess = preferences ? preferences.subscribe : TAVERN_STORY_TRANSCRIPT_NOOP_SUBSCRIBE
		const listeners = new Set()
		// The visible store is single-slot, but switching sessions must not throw away
		// every transcript it already downloaded. Keep a small LRU by session+window;
		// force/read-after-mutation still bypasses it and replaces the cached revision.
		const cacheSize = Number.isSafeInteger(settings.cacheSize) ? Math.max(0, settings.cacheSize) : 4
		const cache = new Map()
		const expectedLiveViews = new Set()
		const liveViews = settings.liveTavernView || options.liveTavernView
			|| (typeof liveTavernView !== 'undefined' && liveTavernView ? liveTavernView : null)
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

		function expectLiveView(sessionId) {
			if (!liveViews || typeof liveViews.expectSeed !== 'function') return
			expectedLiveViews.add(sessionId)
			liveViews.expectSeed(sessionId)
		}
		function cancelLiveView(sessionId) {
			if (!expectedLiveViews.delete(sessionId)) return
			if (liveViews && typeof liveViews.cancelSeed === 'function') liveViews.cancelSeed(sessionId)
		}

		function publish(next) {
			state = next
			// The story response already carries the bounded Helper/projection view.
			// Seed liveView so its first subscriber does not download the same window
			// again through getSession; later invalidations still refresh normally.
			if (next && (next.status === 'ready' || next.status === 'empty')) {
				if (next.view && liveViews && typeof liveViews.seed === 'function') {
					expectedLiveViews.delete(next.sessionId)
					liveViews.seed(next.sessionId, next.view)
				} else cancelLiveView(next.sessionId)
			}
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
			const includeToolCalls = showPlayProcess()
			const key = cacheKey(id, historyFrom)
			const sameSession = state.sessionId === id
			const sameTarget = sameSession && state.historyFrom === historyFrom && (!includeToolCalls || state.includeToolCalls)
			if (id === '') {
				if (state !== IDLE) publish(IDLE)
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
				expectLiveView(id)
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
					...(includeToolCalls ? { includeToolCalls: true } : {}) })
				if (current !== ticket) return state
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
				cancelLiveView(id)
				const preserve = state.sessionId === id && state.transcript
				publish({ sessionId: id, historyFrom: historyFrom, status: 'error', transcript: preserve ? state.transcript : null,
					view: preserve ? state.view : null, revision: preserve ? state.revision : null, error: error, ticket: current })
			}
			return state
		}

		function reset() {
			ticket += 1
			for (const sessionId of Array.from(expectedLiveViews)) cancelLiveView(sessionId)
			cache.clear()
			publish(IDLE)
		}

		return Object.freeze({ subscribe: subscribe, getSnapshot: getSnapshot, snapshotFor: snapshotFor, peek: peek, read: read, reset: reset, subscribeProcess, showPlayProcess })
	}

	return Object.freeze({
		fetchStoryTranscript: fetchStoryTranscript,
		createStoryTranscriptStore: createStoryTranscriptStore,
		useStoryTranscript: useTavernStoryTranscript,
		createModeStore: createTavernStoryTranscriptModeStore,
		useMode: useTavernStoryTranscriptMode,
		// 纯投影，列表组件与本模块的测试共用（顶层同名函数）。
		storyTranscriptRows: tavernStoryTranscriptRows,
		storyTranscriptStreamRows: tavernStoryTranscriptStreamRows,
		storyTranscriptPendingRows: tavernStoryTranscriptPendingRows,
		storyTranscriptStreamText: tavernStoryTranscriptStreamText,
		storyTranscriptMessageText: tavernStoryTranscriptMessageText
	})
}
