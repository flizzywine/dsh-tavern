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

// 严格按 messages 数组顺序逐条投影，一步都不排序：turn 只带走 legacyTurn，
// 重复、缺失、非单调的 turn 都不会重排，也不参与 key（key 由 projection 给出）。
function tavernStoryTranscriptRows(transcript) {
	const entries = transcript && Array.isArray(transcript.messages) ? transcript.messages : []
	const rows = []
	for (let position = 0; position < entries.length; position++) {
		const entry = entries[position] && typeof entries[position] === 'object' ? entries[position] : {}
		const message = entry.message && typeof entry.message === 'object' ? entry.message : {}
		const role = typeof message.role === 'string' ? message.role : ''
		const absoluteIndex = Number.isInteger(entry.absoluteIndex) ? entry.absoluteIndex : null
		const key = typeof entry.key === 'string' && entry.key !== ''
			? entry.key
			: 'index:' + (absoluteIndex === null ? position : absoluteIndex)
		const floorNo = role === 'assistant' && Number.isInteger(entry.floorNo) && entry.floorNo > 0 ? entry.floorNo : null
		const legacyTurn = Number.isInteger(entry.legacyTurn) && entry.legacyTurn > 0 ? entry.legacyTurn : null
		const text = tavernStoryTranscriptMessageText(message)
		const streaming = role === 'assistant' && message.placeholder === true
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
			text: text,
			streaming: streaming,
			tool: null,
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
	return rows
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
	const next = source.slice()
	next[index] = Object.assign({}, row, {
		streaming: true,
		text: text,
		tool: latestCall && typeof latestCall.name === 'string' ? latestCall.name : row.tool || null,
		projection: row.projection ? Object.assign({}, row.projection, { text: text, mode: 'markdown' }) : null
	})
	return next
}

const TAVERN_STORY_TRANSCRIPT_NOOP_SUBSCRIBE = function () { return function () {} }
const TAVERN_STORY_TRANSCRIPT_IDLE_SNAPSHOT = Object.freeze({
	sessionId: '', historyFrom: null, status: 'idle', transcript: null, view: null, revision: null, error: null, ticket: 0
})
function tavernStoryTranscriptIdleSnapshot() { return TAVERN_STORY_TRANSCRIPT_IDLE_SNAPSHOT }

// 组件订阅 store 的 hook（顶层函数，列表文件直接复用）。store 缺失时返回 idle，
// 组件仍然无条件调用本 hook，避免条件 hook。
function useTavernStoryTranscript(store, sessionId, hookOptions) {
	const settings = hookOptions || {}
	const historyFrom = tavernStoryTranscriptHistoryFrom(settings.historyFrom)
	const enabled = settings.enabled !== false && store !== null && store !== undefined
	const force = settings.force === true
	const snapshot = React.useSyncExternalStore(
		enabled ? store.subscribe : TAVERN_STORY_TRANSCRIPT_NOOP_SUBSCRIBE,
		enabled ? store.getSnapshot : tavernStoryTranscriptIdleSnapshot,
		enabled ? store.getSnapshot : tavernStoryTranscriptIdleSnapshot)
	const read = enabled ? store.read : null
	React.useEffect(function () {
		if (read === null) return
		void read(sessionId, { historyFrom: historyFrom, force: force })
	}, [read, sessionId, historyFrom, force])
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
		const listeners = new Set()
		let ticket = 0
		let state = IDLE

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

		async function read(sessionId, readOptions) {
			const id = String(sessionId || '')
			const historyFrom = tavernStoryTranscriptHistoryFrom(readOptions && readOptions.historyFrom)
			const force = readOptions && readOptions.force === true
			const sameSession = state.sessionId === id
			const sameTarget = sameSession && state.historyFrom === historyFrom
			if (id === '') {
				if (state !== IDLE) publish(IDLE)
				return state
			}
			if (!force && sameTarget && (state.status === 'loading' || state.status === 'refreshing')) return state
			if (!force && sameTarget && (state.status === 'ready' || state.status === 'empty')) return state
			const current = ++ticket
			publish({
				sessionId: id,
				historyFrom: historyFrom,
				status: sameSession && state.transcript ? 'refreshing' : 'loading',
				transcript: sameSession ? state.transcript : null,
				view: sameSession ? state.view : null,
				revision: sameSession ? state.revision : null,
				error: null,
				ticket: current
			})
			try {
				const result = await load(id, { historyFrom: historyFrom === null ? undefined : historyFrom })
				if (current !== ticket) return state
				const transcript = result && result.transcript ? result.transcript : null
				publish({
					sessionId: id, historyFrom: historyFrom,
					status: transcript ? 'ready' : 'empty',
					transcript: transcript,
					view: result && result.view ? result.view : null,
					revision: result && result.revision !== undefined ? result.revision : null,
					error: null, ticket: current
				})
			} catch (error) {
				if (current !== ticket) return state
				const preserve = state.sessionId === id && state.transcript
				publish({ sessionId: id, historyFrom: historyFrom, status: 'error', transcript: preserve ? state.transcript : null,
					view: preserve ? state.view : null, revision: preserve ? state.revision : null, error: error, ticket: current })
			}
			return state
		}

		function reset() {
			ticket += 1
			publish(IDLE)
		}

		return Object.freeze({ subscribe: subscribe, getSnapshot: getSnapshot, read: read, reset: reset })
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
		storyTranscriptStreamText: tavernStoryTranscriptStreamText,
		storyTranscriptMessageText: tavernStoryTranscriptMessageText
	})
}
