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
				const extensionsVersion = useTavernUiExtensions();
				const h = React.createElement, sessionId = props.sessionId;
				const [launchRoot, setLaunchRoot] = React.useState(null);
				const launchRef = React.useCallback(function (node) { if (node) setLaunchRoot(node.shadowRoot || node.attachShadow({ mode: 'open' })); }, []);
				const [snapshot, setSnapshot] = React.useState(null), [modes, setModes] = React.useState([]);
				const [error, setError] = React.useState(''), [pending, setPending] = React.useState(false);
				const [paused, setPaused] = React.useState(false);
                const [pageOpen, setPageOpen] = React.useState(true);
				const actionLocks = TavernGameModeSurface.actionLocks || (TavernGameModeSurface.actionLocks = new Set());
				React.useEffect(function () {
					let disposed = false;
					async function refresh() {
						try {
							const result = await rpc('gameMode', { op: 'view' }, sessionId);
							if (!disposed) setSnapshot(result.mode);
							if (!result.mode) { const list = await rpc('gameMode', { op: 'list' }, sessionId); if (!disposed) setModes(list.modes); }
						} catch (e) { if (!disposed) setError(e.message); }
					}
					refresh();
					const stop = tavernSessionSignals.subscribe(sessionId, 'plugin-state:@tavern:game-mode', refresh);
					return function () { disposed = true; stop(); };
				}, [sessionId, extensionsVersion]);
				async function act(input) {
					if (input.op === 'stop' || input.op === 'seek') setPaused(true);
					if (actionLocks.has(sessionId) && input.op !== 'stop') return false;
					if (input.op !== 'stop') actionLocks.add(sessionId);
					setPending(true); setError('');
					try { const result = await rpc('gameMode', Object.assign({ revision: snapshot && snapshot.revision, actionId: crypto.randomUUID() }, input), sessionId); if (result.mode) setSnapshot(result.mode); return true; }
					catch (e) { setError(e.message); setPaused(true); return false; }
					finally { if (input.op !== 'stop') actionLocks.delete(sessionId); setPending(false); }
				}
				if (!snapshot && !modes.length && !error) return null;
                const pageRenderer = snapshot ? tavernUiExtensions.gameModeView(snapshot.key) : modes.map(mode => tavernUiExtensions.gameModeView(mode.key)).find(view => view?.page);
                if (props.pageHost && !pageRenderer?.page) return null;
                if (!props.pageHost && pageRenderer?.page) return null;
				if (!props.pageHost && snapshot?.foreground && !props.foreground) return null;
				if (props.foreground && (!snapshot || props.messageId !== snapshot.foregroundMessageId)) return null;
				const renderer = snapshot && tavernUiExtensions.gameModeView(snapshot.key);
				const surface = h('section', { className: 'dsh-tavern-game-mode', 'aria-label': '自定义玩法', 'data-revision': snapshot && snapshot.revision },
					error ? h('p', { role: 'alert' }, error) : null,
					!snapshot && props.pageHost && pageRenderer?.lobby ? h(tavernPluginBoundary(), { owner: pageRenderer.owner }, h(pageRenderer.lobby, { busy: pending, start: function () { const mode = modes.find(mode => tavernUiExtensions.gameModeView(mode.key) === pageRenderer); if (mode) return act({ op: 'create', key: mode.key }); } })) : !snapshot ? h('div', { ref: launchRef }, launchRoot && ReactDOM.createPortal(h(React.Fragment, null,
						h('style', null, ':host{display:block;margin:24px 0}*{box-sizing:border-box}.launch{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:24px;border:1px solid #bda16c66;border-radius:16px;background:linear-gradient(120deg,#101a2c,#1e2940);color:#f2eadb;font:14px/1.6 system-ui;box-shadow:0 12px 32px #07102018}.title{font-size:20px;font-weight:650}.hint{color:#b9c5d7;margin-top:4px;font-size:12px}button{flex-shrink:0;border:1px solid #eddbb6;border-radius:10px;padding:13px 24px;background:linear-gradient(120deg,#efdcaf,#c4a36c);color:#1b2230;font:650 15px/1.5 system-ui;cursor:pointer;box-shadow:0 4px 18px #0003}button:hover{filter:brightness(1.1)}button:focus-visible{outline:3px solid #fff;outline-offset:4px}button:disabled{opacity:.6;cursor:wait}@media(max-width:600px){.launch{flex-wrap:wrap;padding:20px}button{width:100%}}'),
						modes.map(function (mode) { return h('div', { key: mode.key, className: 'launch' }, h('div', null, h('div', { className: 'title' }, mode.title), h('div', { className: 'hint' }, '准备就绪，开启你的游戏')), h('button', { type: 'button', disabled: pending, onClick: function () { act({ op: 'create', key: mode.key }); } }, pending ? '正在开启…' : '开始 ' + mode.title)); })), launchRoot)) : null,
					snapshot ? h('div', null,
						h('button', { disabled: !pending && !snapshot.busy, onClick: function () { act({ op: 'stop' }); } }, '停止'),
						h('button', { disabled: pending || snapshot.busy || snapshot.cursor < 1, onClick: function () { act({ op: 'seek', cursor: snapshot.cursor - 1 }); } }, '回退一步'),
						h('button', { disabled: pending || snapshot.busy || snapshot.cursor + 1 >= snapshot.length, onClick: function () { act({ op: 'seek', cursor: snapshot.cursor + 1 }); } }, '撤销回退'),
						renderer ? h(tavernPluginBoundary(), { owner: renderer.owner, fallback: h('p', null, '玩法界面出错，请恢复插件') },
							h(renderer.render, { gameId: sessionId, data: snapshot.data, foreground: props.pageHost ? false : snapshot.foreground, page: !!props.pageHost, revision: snapshot.revision, paused: paused, error: error, resume: function () { setError(''); setPaused(false); }, busy: pending || snapshot.busy, advance: function (input) { return act({ op: 'advance', input: input }); } })) : h('p', null, '请加载对应的玩法界面插件')) : null);
                if (!props.pageHost) return surface;
                if (!pageOpen) return h('button', { className: 'dsh-tavern-btn', onClick: function () { setPageOpen(true); } }, '返回游戏页面');
                return ReactDOM.createPortal(h('div', { className: 'dsh-tavern-game-page', role: 'dialog', 'aria-modal': 'true', 'aria-label': '专属游玩页面', style: { position: 'fixed', inset: '36px 0 0', zIndex: 10000, background: '#080e19', color: '#edf2fa', overflow: 'auto' } },
                    h('style', null, '.dsh-tavern-game-page>.page-nav{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;border-bottom:1px solid #ffffff20;font:14px system-ui}.dsh-tavern-game-page button{cursor:pointer}.dsh-tavern-game-page>.dsh-tavern-game-mode{max-width:1600px;margin:auto;padding:12px 24px}.dsh-tavern-game-page>.dsh-tavern-game-mode>div>button{background:#1b293d;border:1px solid #53647d;color:#edf2fa;border-radius:6px;padding:7px 14px;margin:0 8px 10px 0}'),
                    h('nav', { className: 'page-nav' }, h('strong', null, 'DSH Tavern · 游戏'), h('button', { className: 'dsh-tavern-btn', onClick: function () { setPageOpen(false); } }, '返回酒馆')), surface), document.body);

			}

            function TavernGamePage(props) {
                const sessionId = String(props.sessionId || '');
                if (!sessionId) return null;
                return React.createElement(TavernGameModeSurface, { key: sessionId, sessionId: sessionId, pageHost: true });
            }

			function TavernComposerSlot(props) {
				useTavernUiExtensions();
				const sessionId = String(props.sessionId || "");
				const live = useLiveTavernView(sessionId, "composer-slot", [["mode"]]);
				const mode = live && live.view && typeof live.view.mode === "string" ? live.view.mode : "";
				const slot = mode === "" ? null : tavernUiExtensions.composerSlotFor(mode);
				const busy = props.useSession(function (snapshot) { return snapshot.running === true; });

				if (sessionId === "" || !slot || !tavernPluginAllowed(slot.owner, sessionId)) return null;
				const h = React.createElement;
				const fallback = h("div", { className: "dsh-tavern-plugin-slot-error" }, "插件 " + slot.owner + " 的界面出错了");
				return h(React.Fragment, null, h("div", { className: "dsh-tavern-composer-slot", "data-plugin": slot.owner },
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

			return Object.freeze({ register: register, tavernReplyState: tavernReplyState, GamePage: TavernGamePage, GameModeSurface: TavernGameModeSurface });
		}
		const tavernReplyObserverFeature = createTavernReplyObserverFeatureModule();

