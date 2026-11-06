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

function tavernStoryTranscriptCommitKey(snapshot) {
	const nodes = snapshot && snapshot.legacy && Array.isArray(snapshot.legacy.nodes) ? snapshot.legacy.nodes : []
	if (!nodes.length) return '0'
	const last = nodes[nodes.length - 1] || {}
	return String(nodes.length) + ':' + String(last.messageId || last.id || last.key || last.turn || '')
}

function createTavernStoryTranscriptFeature(deps) {
	if (typeof tavernStoryTranscriptRows !== 'function' || typeof tavernStoryTranscriptDraftItem !== 'function') {
		throw new Error('故事历史列表缺少数据模块：先包含 features/story-transcript-data.js')
	}
	const options = deps || {}
	const h = React.createElement
	const data = options.dataModule || createTavernStoryTranscriptDataModule({ rpc: options.rpc })
	const labels = options.labels || TAVERN_STORY_TRANSCRIPT_LABELS
	const renderText = typeof options.markdown === 'function'
		? options.markdown
		: function (text, info) { return h(TavernStoryMarkdown, { text: text, labels: labels, streaming: Boolean(info && info.streaming) }) }
	const mode = options.mode || data.createModeStore()
	let storyTranscriptStore = null
	let nativeFlow = null
	let storyExternalHistory = options.externalHistory || null
	const storyEligibility = new Map()
	const externalHistoryInstaller = options.externalHistoryInstaller ||
		(typeof installTavernStoryExternalHistory === 'function' ? installTavernStoryExternalHistory : null)

	function rowAttributes(row, transcript) {
		const turn = row.draft === true ? row.streamTurn : (Number.isInteger(row.legacyTurn) && row.legacyTurn > 0 ? row.legacyTurn : row.floorNo)
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

	function StoryTranscriptRow(props) {
		const row = props.row
		const markdown = props.markdown || renderText
		const attributes = rowAttributes(row, props.transcript)
		if (row.draft === true) {
			return h('article', Object.assign({}, attributes, {
				className: 'dsh-tavern-story-transcript-row dsh-tavern-story-draft',
				'data-story-draft': '',
				'aria-live': 'polite'
			}),
				h('div', { className: 'dsh-tavern-story-floor-head' },
					h('span', { className: 'dsh-tavern-story-floor-tag' }, row.tool ? '正在调用 ' + row.tool : '正在生成')),
				row.text ? h('div', { className: 'dsh-tavern-story-body' }, markdown(row.text, { streaming: true, draft: true })) : null)
		}
		if (row.role === 'user') {
			return h('article', Object.assign({}, attributes, {
				className: 'dsh-tavern-story-transcript-row dsh-tavern-user-row dsh-tavern-story-input'
			}),
				h('div', { className: 'dsh-tavern-user-bubble' },
					h('div', { className: 'dsh-tavern-story-body', style: { whiteSpace: 'pre-wrap' } }, row.text)))
		}
		return h('article', Object.assign({}, attributes, {
			className: 'dsh-tavern-story-transcript-row dsh-tavern-assistant dsh-tavern-story-floor'
		}),
			row.floorNo === null ? null : h('div', { className: 'dsh-tavern-story-floor-head' },
				h('span', { className: 'dsh-tavern-story-floor-no' }, '第 ' + String(row.floorNo) + ' 楼'),
				row.greeting ? h('span', { className: 'dsh-tavern-story-floor-tag' }, '开场') : null),
			h('div', { className: 'dsh-tavern-story-body' }, markdown(row.text, { greeting: row.greeting })))
	}

	function TavernStoryTranscriptList(props) {
		const transcript = props.transcript || null
		const rows = React.useMemo(function () { return tavernStoryTranscriptRows(transcript) }, [transcript])
		const draft = React.useMemo(function () { return tavernStoryTranscriptDraftItem(props.partial, props.runningCalls) }, [props.partial, props.runningCalls])
		if (!rows.length && !draft) {
			return h('div', {
				className: 'dsh-tavern-story-transcript-row dsh-tavern-story-empty',
				'data-story-transcript': transcript && transcript.source ? String(transcript.source) : 'story',
				'data-revision': transcript && transcript.revision !== undefined ? String(transcript.revision) : undefined,
				role: 'status'
			}, props.emptyLabel || '还没有故事内容')
		}
		return h(React.Fragment, null,
			rows.map(function (row) { return h(StoryTranscriptRow, { key: row.key, row: row, transcript: transcript, markdown: renderText }) }),
			draft === null ? null : h(StoryTranscriptRow, { key: draft.key, row: draft, transcript: transcript, markdown: renderText }))
	}

	function useStoryController(store, sessionId, controllerOptions) {
		const settings = controllerOptions || {}
		const [requested, setRequested] = React.useState({ sessionId: '', from: null })
		const localFrom = requested.sessionId === sessionId ? requested.from : null
		const explicitFrom = Number.isSafeInteger(settings.historyFrom) && settings.historyFrom >= 0 ? settings.historyFrom : null
		const historyFrom = explicitFrom === null ? localFrom : explicitFrom
		const state = useTavernStoryTranscript(store, sessionId, { historyFrom: historyFrom, enabled: settings.enabled !== false })
		const loadOlder = React.useCallback(function () {
			const transcript = state.transcript
			if (!transcript || !Number.isInteger(transcript.from) || transcript.from <= 0) return
			setRequested({ sessionId: sessionId, from: Math.max(0, transcript.from - 60) })
		}, [sessionId, state.transcript])
		return { state: state, historyFrom: historyFrom, loadOlder: loadOlder }
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
			h(TavernStoryTranscriptList, { transcript: transcript, partial: props.partial, runningCalls: props.runningCalls, emptyLabel: props.emptyLabel }))
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
			transcript: props.transcript || controller.state.transcript
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
		const commitKey = props.useChat(tavernStoryTranscriptCommitKey)
		const previous = React.useRef({ sessionId: sessionId, enabled: enabled, commitKey: commitKey, streaming: partial !== null })
		React.useEffect(function () {
			// An ordinary chat with no Tavern story falls back to the native flow;
			// restore every native row instead of leaving only the latest turn.
			storyEligibility.set(sessionId, !storyUnavailable && sessionMode !== 'card' && (!view || view.mode !== 'card'))
			if (storyExternalHistory) storyExternalHistory.refresh(sessionId)
		}, [sessionId, enabled, sessionMode, view && view.mode, storyUnavailable])
		React.useEffect(function () {
			const last = previous.current
			const sameSession = last.sessionId === sessionId
			const streaming = partial !== null
			const resumed = sameSession && enabled && !last.enabled
			const finished = sameSession && last.streaming && !streaming
			const committed = sameSession && last.enabled === enabled && last.commitKey !== commitKey && !streaming
			previous.current = { sessionId: sessionId, enabled: enabled, commitKey: commitKey, streaming: streaming }
			if ((resumed || finished || committed) && storyActive) {
				// Once streaming closes, prune the just-finished native tail as well.
				// The latest turn remains for composer/commit observers; older turns
				// return to story-only rows instead of accumulating for this session.
				if ((finished || committed) && storyExternalHistory) storyExternalHistory.refresh(sessionId, { force: true })
				void store.read(sessionId, { historyFrom: controller.historyFrom, force: true })
			}
		}, [store, sessionId, controller.historyFrom, commitKey, partial, enabled, sessionMode, storyActive])
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
			transcript: transcript,
			partial: partial || (running ? { blocks: [] } : null),
			runningCalls: runningCalls
		}))
	}

	function TavernStoryTranscriptModeAction(props) {
		const enabled = data.useMode(mode)
		const sessionMode = typeof useTavernSessionMode === 'function' ? useTavernSessionMode(String(props.sessionId || '')) : ''
		if (sessionMode && !isPlayMode(sessionMode)) return null
		const label = enabled ? '切换到原生记录' : '切换到故事楼层'
		return h('button', { type: 'button', className: 'dsh-tavern-btn dsh-tavern-story-mode', 'aria-label': label, title: label,
			onClick: mode.toggle }, enabled ? '楼层' : '原生')
	}

	function StoryTranscriptFlowSlot(props) {
		return h(TavernStoryTranscriptFlow, Object.assign({}, props, { nativeFlow: nativeFlow, store: options.store }))
	}

	function register(input) {
		const ctx = input.ctx, slots = input.slots
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
			return slots.inject('conversation.session.header.actions', function () {
				return slots.register({ name: 'conversation.session.header.actions', id: 'dsh-tavern-story-transcript-mode', order: -135,
					inject: function (sessionId) { return { sessionId: sessionId } } }, TavernStoryTranscriptModeAction)
			})
		}, 'dsh-tavern: story transcript mode switch')
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
		StoryTranscriptModeAction: TavernStoryTranscriptModeAction,
		register: register,
		mode: mode
	})
}
