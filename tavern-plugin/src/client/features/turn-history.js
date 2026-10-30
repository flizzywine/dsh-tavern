		function TavernDockedPanel(props) {
			const ref = React.useRef(null);
			React.useLayoutEffect(function () {
				tavernPanelRegistry.dock(props.id, ref.current);
				return function () { tavernPanelRegistry.restore(props.id); };
			}, [props.id]);
			return React.createElement("div", { ref: ref });
		}
		function TavernPersistentStatusRuntime(props) {
			const entries = React.useSyncExternalStore(tavernPanelRegistry.subscribe, tavernPanelRegistry.inspect);
			const [selected, setSelected] = React.useState("");
			const [refreshes, setRefreshes] = React.useState({});
			const view = props.view;
			// "pinned": only panels pinned from messages (status bar shown in the story body);
			// "status": only the card's status views (that body copy). Default: both.
			// Automatic status frames still need Helper; moving an existing message frame does not.
			const statuses = view && view.tavernHelper && isPlayMode(view.mode) && props.panels !== "pinned" ? (view.tavernStatusViews || []) : [];
			const manual = props.panels === "status" ? [] : entries.filter(function (entry) { return entry.sessionId === props.sessionId && entry.pinned; });
			const newest = manual.reduce(function (latest, entry) { return !latest || entry.activation > latest.activation ? entry : latest; }, null);
			React.useEffect(function () { if (newest) setSelected(newest.id); }, [props.sessionId, newest && newest.activation]);
			const ids = statuses.map(function (panel) { return panel.viewId; }).concat(manual.map(function (entry) { return entry.id; }));
			const active = ids.includes(selected) ? selected : ids[0];
			if (!view || !ids.length) return null;
			const h = React.createElement;
			const runtime = h("section", { className: "dsh-tavern-status-runtime" + (ids.length === 1 ? " single-panel" : "") },
				h("div", { className: "dsh-tavern-panel-toolbar" }, ids.length > 1 ? h("div", { className: "dsh-tavern-panel-tabs", role: "tablist", "aria-label": "人物卡面板" },
					statuses.concat(manual.map(function (entry) { return { viewId: entry.id, title: entry.title }; })).map(function (panel) {
						return h("button", { key: panel.viewId, role: "tab", type: "button", "aria-selected": active === panel.viewId,
							className: "dsh-tavern-panel-tab", onClick: function () { setSelected(panel.viewId); } }, panel.title || "角色状态");
					})) : null,
                    statuses.some(panel => panel.viewId === active) ? h("button", { type: "button", className: "dsh-tavern-panel-refresh", "aria-label": "放大面板", title: "全屏查看此面板", onClick: function (event) { expandTavernFrame(event.currentTarget.closest(".dsh-tavern-status-runtime")?.querySelector('[role="tabpanel"]:not([hidden])')); } }, "⤢") : null,
                    statuses.some(panel => panel.viewId === active) ? h("button", { type: "button", className: "dsh-tavern-panel-refresh", "aria-label": "刷新状态", title: "重新加载此面板，未保存的输入会清空", onClick: function () { tavernRetainedFrames.invalidatePanel(props.sessionId, active); setRefreshes(function (previous) { return Object.assign({}, previous, { [active]: (previous[active] || 0) + 1 }); }); } }, "↻") : null),
				statuses.map(function (statusView) { return h("div", { key: props.sessionId + statusView.viewId, role: "tabpanel", hidden: active !== statusView.viewId,
					"data-status-view-id": statusView.viewId, "data-template-revision": statusView.templateRevision },
					h(TavernMessageFrame, {
					key: props.sessionId + statusView.viewId + (refreshes[statusView.viewId] || 0),
					content: String(statusView.content), sessionId: props.sessionId,
					turn: Math.max(1, Number(statusView.targetTurn) || 1), partIndex: Math.max(0, Number(statusView.sourcePartIndex) || 0),
					panelId: statusView.viewId, helperContext: view.tavernHelper,
                    frameSizing: view.tavernRuntimePolicy?.frameSizing,
					trustedCardMode: Boolean(view.tavernRuntimePolicy && view.tavernRuntimePolicy.trustedCardMode),
					eager: true, persistent: true, executeSlash: props.executeSlash,
					observeMvuView: false, runtimeReporting: true
				})); }),
				manual.map(function (entry) { return h("div", { key: entry.id, role: "tabpanel", hidden: active !== entry.id },
					h("button", { type: "button", className: "dsh-tavern-btn", onClick: function () { tavernPanelRegistry.pin(entry.id, false); } }, "返回正文栏"),
					h(TavernDockedPanel, { id: entry.id })); })
			);
			return props.section ? h("section", { className: "dsh-tavern-status-section" }, runtime) : runtime;
		}

		function latestTavernAssistantMessageId(snapshot) {
			// alpha.2 keeps message projections on Chat, separate from Session lifecycle.
			const nodes = snapshot && snapshot.legacy && snapshot.legacy.nodes || [];
			for (let index = nodes.length - 1; index >= 0; index -= 1) {
				if (nodes[index].kind === "assistant" && nodes[index].messageId) return nodes[index].messageId;
			}
			return null;
		}
		function nodeTurn(node) {
			// Legacy flat nodes carry the native turn directly; layout nodes keep it
			// under location.turn.
			const direct = Number(node && node.turn);
			if (Number.isSafeInteger(direct) && direct > 0) return direct;
			const location = node && node.location;
			return location && (location.kind === "turn" || location.kind === "step") ? Number(location.turn && location.turn.turn) || 0 : 0;
		}
		// The last player input the page actually shows is the only message the quick
		// edit action offers. The user node has no turn of its own; the next
		// assistant/step node does. Rolled back, failed and regenerated turns stay in
		// the host's node list forever (only their rows are hidden), so the row plan
		// decides which input is really the visible tail.
		function latestTavernUserTurn(snapshot, plan) {
			const nodes = snapshot && snapshot.legacy && snapshot.legacy.nodes || [];
			let turn = 0;
			for (let index = nodes.length - 1; index >= 0; index -= 1) {
				const node = nodes[index];
				turn = nodeTurn(node) || turn;
				if (node.kind !== "user") continue;
				if (tavernPlanShowsRow(plan, turn, "user")) return turn;
			}
			return 0;
		}
		// A user message belongs to the round drawn by the assistant of the same
		// native turn; its closing message carries the fork target.
		function tavernAssistantMessageIdForTurn(snapshot, turn) {
			const expected = Number(turn) || 0;
			const nodes = snapshot && snapshot.legacy && snapshot.legacy.nodes || [];
			for (let index = nodes.length - 1; index >= 0; index -= 1) {
				const node = nodes[index];
				if (node.kind !== "assistant" || !node.messageId) continue;
				if (nodeTurn(node) === expected) return node.messageId;
			}
			return null;
		}

		// @include turn-error-controls.js
		// @include step-fold.js

		// @include debug.js






		// @include card-stage.js
        // shared physical sizing contract and candidate-only measurement.
        // @include-protocol figure-scale.cjs
        // @include figure-measure.js
		// @include gal-device.js
		// @include gal-motion.js
		// @include gal-scene.js
// @include gal-effects.js
		// @include widget-definitions.cjs
		// @include stage-widgets.cjs
		// @include widget-sandbox.js
		// @include stage-entries.js
		// @include gal-widgets.js
        // @include cg-stage.js
		// @include gal-stage.js
		// @include gal-config.js
        // @include danmaku-ui.js
        // @include phone-layout.js
		// @include bgm-player.js
		// @include bg-manual.js
		// @include stage-ambience.js
		// @include gal-backlog.js


		function createSupersededErrorProjection(root) {
			const owned = new Map();
			function restore(row, previous) {
				row.hidden = previous.hidden;
				if (row.style) row.style.display = previous.display;
			}
			function dispose() {
				for (const [row, previous] of owned) restore(row, previous);
				owned.clear();
			}
			function apply(turns) {
				const hidden = new Set(turns.map(String));
				const rows = root.querySelectorAll('[data-chat-flow-kind]');
				const keep = new Set();
				let pending = [];
				let failedTurn = "";
				function flush(turn) {
					for (const row of pending) {
						const owner = row.getAttribute("data-chat-turn") || turn;
						if (!hidden.has(owner)) continue;
						keep.add(row);
						if (!owned.has(row)) owned.set(row, { hidden: row.hidden, display: row.style && row.style.display });
						row.hidden = true;
						// Native process rows update `hidden` themselves when folding.
						// Keep suppression independent of that presentation state.
						if (row.style) row.style.display = "none";
					}
					pending = [];
				}
				for (const row of rows) {
					pending.push(row);
					const kind = row.getAttribute("data-chat-flow-kind");
					if (kind !== "turn-error" && kind !== "turn-tail") { failedTurn = ""; continue; }
					// Legacy rows have message IDs, not turn IDs. The terminal error or
					// tail anchors the whole turn, including its input and reasoning.
					// A failed tail can be empty, so inherit its preceding error's turn.
					const key = row.getAttribute("data-chat-flow-key") || "";
					const prefix = kind.length + ":" + kind;
					const keyTurn = key.startsWith(prefix) ? key.slice(prefix.length) : "";
					const tail = kind === "turn-tail" && row.querySelector ? row.querySelector("[data-turn-tail]") : null;
					const turn = row.getAttribute("data-chat-turn") || row.getAttribute("data-turn-tail") || (tail && tail.getAttribute("data-turn-tail")) || (/^\d+$/.test(keyTurn) ? keyTurn : "") || (kind === "turn-tail" ? failedTurn : "");
					flush(turn);
					failedTurn = kind === "turn-error" ? turn : "";
				}
				// alpha has explicit ownership even before its tail is mounted.
				flush("");
				for (const [row, previous] of owned) {
					if (!keep.has(row)) { restore(row, previous); owned.delete(row); }
				}
			}
			return { apply: apply, dispose: dispose };
		}
		// The conversation page shows the rows the server's row plan names
		// (Wiki「设计：transcript-row-plan」): for each saved round, the native turn that
		// draws its input and the one that draws its reply. The plan lists exceptions only,
		// keyed by native turn; a turn absent from it shows its own input and reply, and
		// native turns before a windowed plan's first round are left as the host draws them.
		// Same rule as planShowsRow in lib/domain/transcript-row-plan.js.
		function tavernPlanShowsRow(plan, turnValue, kind) {
			if (!plan || !plan.turns || turnValue === null || turnValue === "") return true;
			if (plan.from !== null && plan.from !== undefined && Number(turnValue) < plan.from) return true;
			const entry = plan.turns[String(turnValue)];
			if (!entry) return true;
			// A kept input turn draws the player's own message and nothing else.
			if (entry.kept) return kind === "user" || kind === "steering";
			// Host notes (context rows) of a turn that draws nothing go with it.
			if (kind === "context") return entry.input === 1 || entry.reply === 1;
			return kind === "user" || kind === "turn-trigger" ? entry.input === 1 : entry.reply === 1;
		}
		function tavernPlanOf(view) {
			return view && view.transcriptTurns ? { turns: view.transcriptTurns, from: view.transcriptFrom } : null;
		}
		function createTurnHistoryProjection(options) {
			options = options || {};
			const root = options.root || function () { return document; };
			const storage = options.storage || function () { return window.localStorage; };
			const hiddenRows = new Map();
			function hideRow(row) {
				if (!hiddenRows.has(row)) hiddenRows.set(row, row.style.display);
				row.style.display = "none";
			}
			function restoreHiddenRows() {
				for (const [row, previous] of hiddenRows) {
					if (row.style.display === "none") row.style.display = previous;
				}
				hiddenRows.clear();
			}
			// Earlier versions kept hidden turns in this browser; the plan covers them now.
			try { for (const key of ["dsh-tavern-hidden-turns", "dsh-tavern-rolled-back-turns", "dsh-tavern-hidden-regen-user-turns"]) storage().removeItem(key); } catch (err) {}
			function tailTurnOf(el) {
				if (el.getAttribute("data-chat-turn")) return el.getAttribute("data-chat-turn");
				if (el.getAttribute("data-turn-tail")) return el.getAttribute("data-turn-tail");
				const inner = el.querySelector("[data-turn-tail]");
				return inner ? inner.getAttribute("data-turn-tail") : "";
			}
			// Every conversation row with its native turn. A row the host mounted without
			// one belongs to the turn whose tail closes it.
			function rowsWithTurns() {
				const result = [];
				let pending = [];
				for (const row of root().querySelectorAll("[data-chat-flow-kind]")) {
					const kind = row.getAttribute("data-chat-flow-kind");
					const turn = row.getAttribute("data-chat-turn") || (kind === "turn-tail" ? tailTurnOf(row) : "");
					if (!turn) { pending.push(row); continue; }
					for (const owned of pending) result.push([owned, turn]);
					pending = [];
					result.push([row, turn]);
				}
				return result;
			}
			// `wholeTurns`: background Agent sessions have no plan; their rolled-back turns hide whole.
			function apply(sessionId, plan, wholeTurns) {
				// Reconcile both directions: rows a previous plan hid may show now.
				restoreHiddenRows();
				const whole = new Set((Array.isArray(wholeTurns) ? wholeTurns : []).map(String));
				for (const [row, turn] of rowsWithTurns()) {
					const kind = row.getAttribute("data-chat-flow-kind");
					if (whole.has(turn) || !tavernPlanShowsRow(plan, turn, kind)) hideRow(row);
				}
				for (const row of root().querySelectorAll('[data-chat-flow-kind="context"]')) {
					const source = row.querySelector('[data-context-source]');
					if (source && source.textContent.trim() === "dsh-tavern-surface-restore") hideRow(row);
				}
			}
			function refresh(sessionId, view) { apply(sessionId, tavernPlanOf(view)); }
			return Object.freeze({ apply: apply, regenerated: refresh, rolledBack: refresh, restored: refresh });
		}
		function applyBodyRegenerationResult(options) {
			options.liveTavernView.setView(options.sessionId, options.view);
			options.historyProjection.regenerated(options.sessionId, options.view, options.tail);
		}

		function resolveConversationChatBinding(uiConversation, binding) {
			if (uiConversation && typeof uiConversation.binding === "function") {
				return uiConversation.binding(binding).target("chat");
			}
			if (!binding || !binding.session || typeof binding.session.subscribe !== "function" || typeof binding.session.getSnapshot !== "function") {
				throw new Error("当前 DSHA 无法提供酒馆状态所需的对话消息");
			}
			return {
				subscribe: function (listener) { return binding.session.subscribe(listener); },
				getSnapshot: function () {
					const snapshot = binding.session.getSnapshot();
					if (!snapshot || !snapshot.chat) throw new Error("当前 DSHA 的对话消息尚未就绪");
					return snapshot.chat;
				}
			};
		}
