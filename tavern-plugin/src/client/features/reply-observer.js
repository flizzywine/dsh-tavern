		// The latest reply of the game open in this page, for plugins (docs/plugin-api-ui.md,
		// apiVersion 6). The card workbench has no transcript in Tavern's session view: its
		// replies only exist in DSH's own Chat snapshot, so this observer reads that and
		// publishes a small, stable state. It covers play chats too (same snapshot), which
		// keeps watchReply a single code path.
		function createTavernReplyObserverFeatureModule() {
			const EMPTY_REPLY_NODES = Object.freeze([]);

			function tavernReplyText(blocks) {
				return (Array.isArray(blocks) ? blocks : [])
					.filter(function (block) { return block && block.kind === "text"; })
					.map(function (block) { return String(block.text || ""); })
					.join("\n");
			}
			/**
			 * Pure projection of one DSH Chat snapshot; also used by tests.
			 * @param input { sessionId, partial, nodes, runningCalls, running, view }
			 * @returns the fields tavernUi.watchReply publishes (ReplyState).
			 */
			function tavernReplyState(input) {
				const sessionId = String(input && input.sessionId || "");
				const nodes = Array.isArray(input && input.nodes) ? input.nodes : [];
				const partial = input && input.partial && typeof input.partial === "object" ? input.partial : null;
				const runningCalls = Array.isArray(input && input.runningCalls) ? input.runningCalls : [];
				let latest = null;
				for (let index = nodes.length - 1; index >= 0; index -= 1) {
					const node = nodes[index];
					if (node && node.kind === "assistant") { latest = node; break; }
				}
				// A running step is the streamed text; otherwise the newest finalized reply.
				const streaming = partial !== null;
				const turn = streaming ? Math.max(0, Number(partial.turn) || 0) : Math.max(0, Number(latest && latest.turn) || 0);
				const text = streaming ? tavernReplyText(partial.blocks) : tavernReplyText(latest && latest.blocks);
				let tool = null;
				const runningTool = runningCalls.length ? runningCalls[runningCalls.length - 1] : null;
				if (runningTool && typeof runningTool.name === "string" && runningTool.name !== "") tool = runningTool.name;
				if (tool === null && streaming) {
					const blocks = Array.isArray(partial.blocks) ? partial.blocks : [];
					for (let index = blocks.length - 1; index >= 0; index -= 1) {
						const block = blocks[index];
						if (block && block.kind === "tool-call" && typeof block.name === "string" && block.name !== "") { tool = block.name; break; }
					}
				}
				const view = input && input.view && typeof input.view === "object" ? input.view : null;
				return {
					sessionId: sessionId,
					mode: view && typeof view.mode === "string" ? view.mode : "",
					turn: turn,
					text: text,
					streaming: streaming,
					busy: Boolean(input && input.running === true),
					tool: tool,
					cardSave: view && view.cardSave ? view.cardSave : null
				};
			}

			// Always mounted with the composer, for the session open in this page.
			function TavernReplyObserver(props) {
				const sessionId = String(props.sessionId || "");
				const partial = props.useChat(function (snapshot) { return snapshot && snapshot.legacy ? snapshot.legacy.partial : null; });
				const nodes = props.useChat(function (snapshot) { return snapshot && snapshot.legacy ? snapshot.legacy.nodes : EMPTY_REPLY_NODES; });
				const runningCalls = props.useChat(function (snapshot) { return snapshot && snapshot.legacy ? snapshot.legacy.runningCalls : EMPTY_REPLY_NODES; });
				const running = props.useSession(function (snapshot) { return snapshot.running === true; });
				const live = useLiveTavernView(sessionId, "reply-observer", [["mode"], ["cardSave"]]);
				const view = live && live.view ? live.view : null;
				const cardSave = view && view.cardSave ? view.cardSave : null;
				const mode = view && typeof view.mode === "string" ? view.mode : "";
				const state = React.useMemo(function () {
					return tavernReplyState({ sessionId: sessionId, partial: partial, nodes: nodes, runningCalls: runningCalls, running: running, view: view });
				}, [sessionId, partial, nodes, runningCalls, running, mode,
					cardSave && cardSave.turn, cardSave && cardSave.path, cardSave && cardSave.createsCard, cardSave && cardSave.changed]);
				React.useEffect(function () {
					if (sessionId !== "") tavernUiExtensions.publishReply(state);
				}, [state, sessionId]);
				return null;
			}

			// The first registered plugin slot that asks for this mode, in its own boundary.
			function TavernGameModeSurface(props) {
				useTavernUiExtensions();
				const h = React.createElement, sessionId = props.sessionId;
				const [snapshot, setSnapshot] = React.useState(null), [modes, setModes] = React.useState([]);
				const [error, setError] = React.useState(''), [pending, setPending] = React.useState(false);
				React.useEffect(function () {
					let disposed = false;
					async function refresh() {
						try {
							const result = await rpc('gameMode', { op: 'view' }, sessionId);
							if (!disposed) { setSnapshot(result.mode); setError(''); }
							if (!result.mode) { const list = await rpc('gameMode', { op: 'list' }, sessionId); if (!disposed) setModes(list.modes); }
						} catch (e) { if (!disposed) setError(e.message); }
					}
					refresh();
					const stop = tavernSessionSignals.subscribe(sessionId, 'plugin-state:@tavern:game-mode', refresh);
					return function () { disposed = true; stop(); };
				}, [sessionId]);
				async function act(input) {
					setPending(true); setError('');
					try { const result = await rpc('gameMode', Object.assign({ revision: snapshot && snapshot.revision, actionId: crypto.randomUUID() }, input), sessionId); if (result.mode) setSnapshot(result.mode); }
					catch (e) { setError(e.message); }
					finally { setPending(false); }
				}
				if (!snapshot && !modes.length && !error) return null;
				const renderer = snapshot && tavernUiExtensions.gameModeView(snapshot.key);
				return h('section', { className: 'dsh-tavern-game-mode', 'aria-label': '自定义玩法' },
					error ? h('p', { role: 'alert' }, error) : null,
					!snapshot ? modes.map(function (mode) { return h('button', { key: mode.key, disabled: pending, onClick: function () { act({ op: 'create', key: mode.key }); } }, '开始 ' + mode.title); }) : null,
					snapshot ? h('div', null,
						h('button', { disabled: !pending && !snapshot.busy, onClick: function () { act({ op: 'stop' }); } }, '停止'),
						h('button', { disabled: pending || snapshot.busy || snapshot.cursor < 1, onClick: function () { act({ op: 'seek', cursor: snapshot.cursor - 1 }); } }, '回退一步'),
						h('button', { disabled: pending || snapshot.busy || snapshot.cursor + 1 >= snapshot.length, onClick: function () { act({ op: 'seek', cursor: snapshot.cursor + 1 }); } }, '撤销回退'),
						renderer ? h(tavernPluginBoundary(), { owner: renderer.owner, fallback: h('p', null, '玩法界面出错，请恢复插件') },
							h(renderer.render, { gameId: sessionId, data: snapshot.data, busy: pending || snapshot.busy, advance: function (input) { return act({ op: 'advance', input: input }); } })) : h('p', null, '请加载对应的玩法界面插件')) : null);
			}

			function TavernComposerSlot(props) {
				useTavernUiExtensions();
				const sessionId = String(props.sessionId || "");
				const live = useLiveTavernView(sessionId, "composer-slot", [["mode"]]);
				const mode = live && live.view && typeof live.view.mode === "string" ? live.view.mode : "";
				const slot = mode === "" ? null : tavernUiExtensions.composerSlotFor(mode);
				const busy = props.useSession(function (snapshot) { return snapshot.running === true; });
				const gameSurface = sessionId && isPlayMode(mode) ? React.createElement(TavernGameModeSurface, { key: sessionId, sessionId: sessionId }) : null;
				if (sessionId === "" || !slot || !tavernPluginAllowed(slot.owner, sessionId)) return gameSurface;
				const h = React.createElement;
				const fallback = h("div", { className: "dsh-tavern-plugin-slot-error" }, "插件 " + slot.owner + " 的界面出错了");
				return h(React.Fragment, null, gameSurface, h("div", { className: "dsh-tavern-composer-slot", "data-plugin": slot.owner },
					h(tavernPluginBoundary(), { owner: slot.owner, fallback: fallback },
						h(slot.render, { sessionId: sessionId, busy: busy === true }))));
			}

			function register(input) {
				const slots = input.slots;
				input.ctx.effect(function () {
					return slots.inject("conversation.input.dock", function () {
						return slots.register({ name: "conversation.input.dock", id: "dsh-tavern-reply-observer", order: -300, label: "回复观察" }, TavernReplyObserver);
					});
				}, "dsh-tavern: reply observer");
				input.ctx.effect(function () {
					return slots.inject("conversation.input.dock", function () {
						return slots.register({ name: "conversation.input.dock", id: "dsh-tavern-plugin-slot", order: -290, label: "插件停靠区" }, TavernComposerSlot);
					});
				}, "dsh-tavern: plugin composer slot");
				return function () {};
			}

			return Object.freeze({ register: register, tavernReplyState: tavernReplyState });
		}
		const tavernReplyObserverFeature = createTavernReplyObserverFeatureModule();

