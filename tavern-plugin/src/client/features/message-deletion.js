		function tavernMessageDeletionUserSelector(turn, data) {
			return { role: "user", turn: Number(turn), seq: Number(data && data.seq) };
		}
		function tavernMessageDeletionAssistantSelector(_turn, storyTurn, data) {
			const finalNode = data && data.finalNode || {};
			// 保留第一个参数兼容旧调用；正文删除身份不与原生 turn 绑定。
			return { role: "assistant", storyTurn: Number(storyTurn), seq: Number(finalNode.seq), messageId: String(finalNode.messageId) };
		}
		function tavernMessageDeletionSelectorKey(selector) {
			if (!selector) return "";
			return JSON.stringify(selector.role === "assistant"
				? [selector.role, selector.storyTurn, selector.seq, selector.messageId]
				: [selector.role, selector.turn, selector.seq]);
		}
		function tavernMessageDeletionSelectorValid(selector) {
			if (!selector || !Number.isFinite(selector.seq)) return false;
			if (selector.role === "user") return Number.isFinite(selector.turn);
			return selector.role === "assistant" && Number.isFinite(selector.storyTurn) && typeof selector.messageId === "string" && selector.messageId !== "" && selector.messageId !== "undefined";
		}
		function createTavernMessageDeletionStore(dependencies) {
			const deps = dependencies || {};
			const call = deps.rpc;
			const applyView = deps.applyView || function () {};
			const records = new Map();
			function idle() { return { active: false, deleting: false, error: "", items: [], keys: new Set() }; }
			function recordFor(sessionId) {
				const id = String(sessionId || "");
				let record = records.get(id);
				if (!record) { record = { state: idle(), listeners: new Set() }; records.set(id, record); }
				return record;
			}
			function publish(sessionId, state) {
				const record = recordFor(sessionId);
				record.state = state;
				record.listeners.forEach(function (listener) { listener(); });
			}
			function selectedState(state, patch) {
				return Object.assign({}, state, patch || {});
			}
			return Object.freeze({
				getSnapshot: function (sessionId) { return recordFor(sessionId).state; },
				subscribe: function (sessionId, listener) {
					const record = recordFor(sessionId);
					record.listeners.add(listener);
					return function () { record.listeners.delete(listener); };
				},
				enter: function (sessionId) {
					const state = recordFor(sessionId).state;
					if (state.deleting || state.active) return;
					publish(sessionId, selectedState(state, { active: true, error: "" }));
				},
				cancel: function (sessionId) {
					if (recordFor(sessionId).state.deleting) return;
					publish(sessionId, idle());
				},
				clear: function (sessionId) {
					const state = recordFor(sessionId).state;
					if (!state.active || state.deleting) return;
					publish(sessionId, selectedState(state, { items: [], keys: new Set(), error: "" }));
				},
				toggle: function (sessionId, selector) {
					const state = recordFor(sessionId).state;
					if (!state.active || state.deleting || !tavernMessageDeletionSelectorValid(selector)) return;
					const key = tavernMessageDeletionSelectorKey(selector);
					const items = state.items.slice(), keys = new Set(state.keys);
					if (keys.has(key)) {
						keys.delete(key);
						const at = items.findIndex(function (item) { return tavernMessageDeletionSelectorKey(item) === key; });
						if (at >= 0) items.splice(at, 1);
					} else {
						keys.add(key);
						items.push(selector.role === "user"
							? { role: "user", turn: Number(selector.turn), seq: Number(selector.seq) }
							: { role: "assistant", storyTurn: Number(selector.storyTurn), seq: Number(selector.seq), messageId: String(selector.messageId) });
					}
					publish(sessionId, selectedState(state, { items: items, keys: keys, error: "" }));
				},
				remove: async function (sessionId) {
					const state = recordFor(sessionId).state;
					if (!state.active || state.deleting || !state.items.length) return null;
					const items = state.items.map(function (item) { return Object.assign({}, item); });
					const keys = new Set(state.keys);
					publish(sessionId, selectedState(state, { deleting: true, error: "" }));
					try {
						const result = await call("deleteMessages", { items: items }, sessionId);
						if (result && result.view) await applyView(sessionId, result.view);
						publish(sessionId, idle());
						return result;
					} catch (error) {
						publish(sessionId, { active: true, deleting: false, error: String(error && error.message || error), items: items, keys: keys });
						return null;
					}
				}
			});
		}
		function createTavernMessageDeletionFeatureModule(dependencies) {
			const deps = dependencies || {};
			const store = createTavernMessageDeletionStore({
				rpc: deps.rpc || rpc,
				applyView: deps.applyView || function (sessionId, view) {
					liveTavernView.setView(sessionId, view);
					notifyTavernDataChanged(["sessions"], "message-deletion");
					tavernCoordination.invalidate(sessionId);
				}
			});
			const confirm = deps.confirm || askTavernConfirm;
			function useSelection(sessionId) {
				const subscribe = React.useCallback(function (listener) { return store.subscribe(sessionId, listener); }, [sessionId]);
				const snapshot = React.useCallback(function () { return store.getSnapshot(sessionId); }, [sessionId]);
				return React.useSyncExternalStore(subscribe, snapshot, snapshot);
			}
			function TavernMessageDeletionCheckbox(props) {
				const state = useSelection(props.sessionId);
				const key = tavernMessageDeletionSelectorKey(props.selector);
				const valid = tavernMessageDeletionSelectorValid(props.selector);
				const labelRef = React.useRef(null);
				React.useEffect(function () {
					const label = labelRef.current;
					if (!state.active || state.deleting || !valid || !label) return undefined;
					const floor = label.closest(".dsh-tavern-user-row, .dsh-tavern-assistant");
					if (!floor) return undefined;
					function toggleFloor(event) {
						// 复选框与 label 自己走 onChange；其他交互控件保留原行为。
						if (event.defaultPrevented || event.button !== 0 || label.contains(event.target)) return;
						const target = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
						if (target && target.closest("button, a, input, textarea, select, summary, [contenteditable='true'], [role='button'], [role='link']")) return;
						store.toggle(props.sessionId, props.selector);
					}
					floor.addEventListener("click", toggleFloor);
					return function () { floor.removeEventListener("click", toggleFloor); };
				}, [props.sessionId, key, state.active, state.deleting, valid]);
				if (!state.active || !valid) return null;
				const label = props.selector.role === "user" ? "选择这条用户输入" : "选择这条 AI 输出";
				return React.createElement("label", { ref: labelRef, className: "dsh-tavern-message-select " + (props.selector.role === "user" ? "user" : "assistant"), title: label },
					React.createElement("input", { type: "checkbox", "aria-label": label, checked: state.keys.has(key), disabled: state.deleting,
						onChange: function () { store.toggle(props.sessionId, props.selector); } }));
			}
			function TavernMessageDeletionDock(props) {
				const state = useSelection(props.sessionId);
				const confirming = React.useRef(false);
				React.useEffect(function () {
					if (!state.active) return undefined;
					function escape(event) {
						if (event.key !== "Escape" || event.isComposing || state.deleting || confirming.current) return;
						event.preventDefault();
						event.stopPropagation();
						store.cancel(props.sessionId);
					}
					document.addEventListener("keydown", escape);
					return function () { document.removeEventListener("keydown", escape); };
				}, [props.sessionId, state.active, state.deleting]);
				if (!state.active) return null;
				async function remove() {
					if (state.deleting || confirming.current || !state.items.length) return;
					confirming.current = true;
					try {
						const accepted = await confirm("确定删除选中的 " + state.items.length + " 条消息吗？它们将从对话和后续模型上下文中移除。", { confirmText: "删除", cancelText: "取消" });
						if (accepted) await store.remove(props.sessionId);
					} finally { confirming.current = false; }
				}
				return React.createElement("section", { className: "dsh-tavern-message-deletion-dock", "aria-label": "删除消息", "aria-busy": state.deleting || undefined },
					React.createElement("span", { className: "dsh-tavern-message-deletion-count", role: "status" }, state.deleting ? "正在删除…" : "已选 " + state.items.length + " 条"),
					React.createElement("div", { className: "dsh-tavern-message-deletion-actions" },
						React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: state.deleting || !state.items.length, onClick: function () { store.clear(props.sessionId); } }, "清空"),
						React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: state.deleting, onClick: function () { store.cancel(props.sessionId); } }, "取消"),
						React.createElement("button", { type: "button", className: "dsh-tavern-btn danger", disabled: state.deleting || !state.items.length, onClick: remove }, state.deleting ? "删除中…" : "删除")),
					state.error ? React.createElement("div", { className: "dsh-tavern-message-deletion-error", role: "alert" }, state.error) : null);
			}
			function register(input) {
				input.ctx.effect(function () {
					return input.ctx.commandUi.register({
						name: "delete",
						label: function () { return "删除"; },
						description: function () { return "选择并删除当前对话中的用户输入和 AI 输出"; },
						available: function (session) { return Boolean(session && session.sessionId); },
						ui: { kind: "action", run: function (session) { store.enter(session.sessionId); } }
					});
				}, "dsh-tavern: delete message command");
				input.ctx.effect(function () {
					return input.slots.inject("conversation.input.dock", function () {
						return input.slots.register({ name: "conversation.input.dock", id: "dsh-tavern-message-deletion", order: -100, label: "删除消息" }, TavernMessageDeletionDock);
					});
				}, "dsh-tavern: delete message dock");
			}
			return Object.freeze({ store: store, register: register, useSelection: useSelection, Checkbox: TavernMessageDeletionCheckbox, Dock: TavernMessageDeletionDock,
				userSelector: tavernMessageDeletionUserSelector, assistantSelector: tavernMessageDeletionAssistantSelector });
		}
		const messageDeletionFeature = createTavernMessageDeletionFeatureModule();
