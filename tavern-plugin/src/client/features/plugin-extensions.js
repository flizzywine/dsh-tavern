		// Browser half of the public plugin API (docs/plugin-api.md): the `tavernUi`
		// service, plugin media under assistant text, markers and plugin buttons.
		// Only additive changes: published plugins depend on these names.
		// @include-domain plugin-text-segments.js

		function createTavernUiExtensions() {
			const mediaRenderers = new Map();
			const markers = [];
			const messageActions = [];
			const composerActions = [];
			const panels = new Map();
			const startGroups = [];
			const cardListViews = [];
			const statusSections = [];
			const turnViews = [];
			const illustrators = [];
			const replyPresenters = [];
			const composerSlots = [];
			// Latest reply per session, fed by the observer in the composer dock (reply-observer.js):
			// the card workbench has no transcript in Tavern's session view, so DSH's own Chat
			// snapshot (running step blocks + finalized nodes) is the source for every mode.
			const replyStates = new Map();
			const replySubscribers = new Map();
			const replyPresenterFailures = new Map();
			const replyPresenterDisabled = new Set();
			// Work status (apiVersion 7): what a game is doing right now, for plugins such as a
			// companion pet. One shared record per session, fed by Tavern's live view and the
			// reply observer; success is a short pulse after a busy turn settles.
			const WORK_STATUS_SUCCESS_MS = 4000;
			const workStatusRecords = new Map();
			// Cooperative leases (apiVersion 7): at most one holder per (session, scope). The
			// holder is a plugin; a TTL and release-on-unload keep a crashed plugin from
			// holding a surface forever.
			const LEASE_DEFAULT_TTL_MS = 30 * 1000;
			const LEASE_MIN_TTL_MS = 1000;
			const LEASE_MAX_TTL_MS = 10 * 60 * 1000;
			const leases = new Map();
			const leaseWatchers = new Map();
			const listeners = new Set();
			// Tavern's own context, for the sidebar a plugin panel opens in (set at apply).
			let host = null;
			let version = 0;
			function changed() { version += 1; Array.from(listeners).forEach(function (listener) { listener(); }); }
			function ownerOf(service) {
				const ctx = service && service.ctx;
				const fiber = ctx && (ctx[Symbol.for("cordis.shadow")] ? Object.getPrototypeOf(ctx) : ctx).fiber;
				return String(fiber && fiber.name || "插件");
			}
			function owned(service, register, label) {
				const ctx = service && service.ctx;
				return ctx && typeof ctx.effect === "function" ? ctx.effect(register, label) : register();
			}
			function addTo(list, entry) {
				list.push(entry);
				changed();
				return function () { const index = list.indexOf(entry); if (index >= 0) { list.splice(index, 1); changed(); } };
			}
			function action(input, kind) {
				if (!input || typeof input.label !== "string" || !input.label.trim()) throw new TypeError(kind + " 需要 label");
				if (typeof input.run !== "function") throw new TypeError(kind + " 需要 run 函数");
				if (input.when !== undefined && typeof input.when !== "function") throw new TypeError(kind + " 的 when 必须是函数");
				return { id: String(input.id || input.label), label: input.label.trim(), when: input.when, run: input.run };
			}
			// Mode lists on the two card-workbench APIs; only "card" exists today, but a plugin
			// may also ask for a play mode without Tavern changing.
			function modesOf(value, label) {
				const modes = value === undefined ? ["card"] : value;
				if (!Array.isArray(modes) || modes.length === 0 || modes.length > 8) throw new TypeError(label + " 的 modes 需要 1–8 个模式名");
				if (!modes.every(function (mode) { return typeof mode === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(mode); })) throw new TypeError(label + " 的 modes 只能用小写字母、数字和连字符");
				return Array.from(new Set(modes));
			}
			// The public ReplyState; cardSaved/changed come from the view's cardSave so a direct
			// tool save (no staged fields) still reads as "this turn changed the card".
			function replyStateOf(sessionId, value) {
				const input = value !== null && typeof value === "object" ? value : {};
				const turn = Math.max(0, Number(input.turn) || 0);
				const save = input.cardSave !== null && typeof input.cardSave === "object" ? {
					turn: Math.max(0, Number(input.cardSave.turn) || 0),
					path: String(input.cardSave.path || ""),
					createsCard: input.cardSave.createsCard === true,
					changed: input.cardSave.changed === true
				} : null;
				const savedHere = save !== null && save.path !== "" && turn > 0 && save.turn === turn;
				return {
					sessionId: String(sessionId || ""),
					mode: typeof input.mode === "string" ? input.mode : "",
					turn: turn,
					text: typeof input.text === "string" ? input.text : "",
					streaming: input.streaming === true,
					busy: input.busy === true,
					tool: typeof input.tool === "string" && input.tool !== "" ? input.tool : null,
					cardSave: save,
					cardSaved: savedHere && save.createsCard ? save.path : null,
					changed: savedHere && (save.changed || save.createsCard)
				};
			}
			// The input box of a game open in this page, for setInput / submitInput.
			function composerFor(input, label) {
				if (!input || typeof input.gameId !== "string" || !input.gameId) throw new TypeError(label + " 需要 gameId");
				if (typeof input.text !== "string") throw new TypeError(label + " 需要 text 字符串");
				const scope = host && host.sessions && host.sessions.scope(input.gameId);
				const conversation = host && typeof host.get === "function" && host.get("conversation");
				if (!scope || !conversation) throw new Error("这一局没有在当前页面打开，无法使用输入框");
				return { input: conversation.input.for(scope), text: input.text };
			}
			function replySnapshot(sessionId) {
				const record = replyStates.get(String(sessionId || ""));
				return record ? record.state : replyStateOf(sessionId, null);
			}
			// Called by the observer while a reply streams; identical states are dropped so a
			// Vue side repaint cannot feed itself back through the API.
			function publishReply(value) {
				const sessionId = String(value && value.sessionId || "");
				if (sessionId === "") return;
				const state = replyStateOf(sessionId, value);
				const text = JSON.stringify(state);
				const previous = replyStates.get(sessionId);
				if (previous && previous.text === text) return;
				replyStates.set(sessionId, { state: state, text: text });
				const record = workStatusRecords.get(sessionId);
				if (record) refreshWorkStatus(record, { settle: true, notify: true });
				const entries = replySubscribers.get(sessionId);
				if (!entries) return;
				for (const entry of Array.from(entries)) {
					if (!tavernPluginAllowed(entry.owner, sessionId)) continue;
					entry.listener(state);
				}
			}
			function presentReply(input) {
				const sessionId = String(input && input.sessionId || "");
				const mode = String(input && input.mode || "");
				if (sessionId === "" || mode === "") return null;
				const message = {
					sessionId: sessionId,
					turn: Math.max(0, Number(input.turn) || 0),
					text: String(input.text || ""),
					changed: input.changed === true,
					streaming: input.streaming === true
				};
				for (const presenter of replyPresenters) {
					if (presenter.modes.indexOf(mode) < 0) continue;
					if (!tavernPluginAllowed(presenter.owner, sessionId)) continue;
					const failureKey = presenter.owner + ":" + sessionId;
					if (replyPresenterDisabled.has(failureKey)) continue;
					let result;
					try { result = presenter.present(message); }
					catch (error) {
						const count = (replyPresenterFailures.get(failureKey) || 0) + 1;
						replyPresenterFailures.set(failureKey, count);
						if (count >= 3) replyPresenterDisabled.add(failureKey);
						try { tavernErrorHub.report("插件 " + presenter.owner, error); } catch (_) {}
						continue;
					}
					const summary = result && result.fold && typeof result.fold.summary === "string" ? result.fold.summary.replace(/\s+/g, " ").trim() : "";
					if (summary === "") continue;
					return { owner: presenter.owner, key: presenter.key, fold: { summary: summary.slice(0, 60) } };
				}
				return null;
			}

			// ---- work status (apiVersion 7) ----

			/** Raw fields of a session's live view; every read is defensive because a game may
			 * not be open in this page (or the host may be an older build). */
			function workStatusInput(sessionId) {
				let snapshot = null;
				try {
					if (typeof liveTavernView !== "undefined" && liveTavernView && typeof liveTavernView.getSnapshot === "function") snapshot = liveTavernView.getSnapshot(sessionId);
				} catch (_) {}
				const view = snapshot && snapshot.view || null;
				const reply = replyStates.get(String(sessionId || ""));
				let row = null;
				try {
					const list = host && host.sessions && host.sessions.list;
					if (list && typeof list.getSnapshot === "function") row = (list.getSnapshot().byId || {})[sessionId] || null;
				} catch (_) {}
				return {
					phase: String(snapshot && snapshot.phase || "idle"),
					viewError: String(snapshot && snapshot.error || ""),
					activity: view && view.activity && typeof view.activity === "object" ? view.activity : null,
					settleStatus: String(view && view.settleStatus || ""),
					settleError: String(view && view.settleError || ""),
					turn: Math.max(0, Number(view && view.latestAssistantTurn) || Number(reply && reply.state && reply.state.turn) || 0),
					reply: reply ? reply.state : null,
					running: !!(row && row.running === true)
				};
			}
			function workStatusBusy(input) {
				// The card workbench has no Tavern activity view; there the reply observer's
				// busy flag is the only signal that something is running.
				return input.running || !!(input.activity && input.activity.busy === true) || input.settleStatus === "running" || !!(input.reply && input.reply.busy === true);
			}
			/** The public shape: plain data only, so a plugin can compare or serialize it. */
			function projectWorkStatus(sessionId, input, record) {
				const now = Date.now();
				const activity = input.activity;
				const reply = input.reply;
				const tool = reply && typeof reply.tool === "string" && reply.tool ? reply.tool : null;
				const busy = workStatusBusy(input);
				let state = "idle", reason = "idle", error = "";
				if (input.viewError) { state = "error"; reason = "load"; error = input.viewError; }
				else if (input.settleStatus === "error") { state = "error"; reason = "settlement"; error = input.settleError || "后台结算失败"; }
				else if (busy) {
					// A question waiting for the player is not "working": the reply is blocked on
					// them, and a companion should look at the player rather than busy itself.
					if (tool === "ask_user_question") { state = "waiting"; reason = "question"; }
					else if (tool) { state = "working"; reason = "tool"; }
					else if (input.settleStatus === "running" || activity && activity.role === "settlement") { state = "working"; reason = "settlement"; }
					else if (reply && reply.streaming) { state = "thinking"; reason = "streaming"; }
					else { state = "thinking"; reason = "busy"; }
				} else if (record && record.successUntil > now) { state = "success"; reason = "settled"; }
				return {
					sessionId: String(sessionId || ""),
					state: state,
					reason: reason,
					busy: busy,
					turn: input.turn,
					tool: tool,
					phase: input.phase,
					role: activity && typeof activity.role === "string" ? activity.role : null,
					error: error,
					updatedAt: now
				};
			}
			function workStatusSame(left, right) {
				return !!left && !!right && left.state === right.state && left.reason === right.reason && left.busy === right.busy
					&& left.turn === right.turn && left.tool === right.tool && left.phase === right.phase && left.role === right.role && left.error === right.error;
			}
			function notifyWorkStatus(record) {
				for (const entry of Array.from(record.listeners)) {
					if (!tavernPluginAllowed(entry.owner, record.sessionId)) continue;
					try { entry.listener(record.state); }
					catch (error) { try { tavernErrorHub.report("插件 " + entry.owner + " 的工作状态回调", error); } catch (_) {} }
				}
			}
			/**
			 * Recompute one session's status. `settle` turns a busy→idle edge into a success
			 * pulse; `notify` decides whether subscribers hear about a change (the first
			 * computation is handed to the new subscriber by watchWorkStatus itself).
			 */
			function refreshWorkStatus(record, options) {
				const input = workStatusInput(record.sessionId);
				const busy = workStatusBusy(input);
				const now = Date.now();
				if (options && options.settle && record.busy && !busy && input.turn > 0 && input.settleStatus !== "error") {
					record.successUntil = now + WORK_STATUS_SUCCESS_MS;
					if (record.timer !== null) clearTimeout(record.timer);
					record.timer = setTimeout(function () {
						record.timer = null;
						record.successUntil = 0;
						refreshWorkStatus(record, { notify: true });
					}, WORK_STATUS_SUCCESS_MS);
				}
				if (busy && record.timer !== null) {
					clearTimeout(record.timer);
					record.timer = null;
					record.successUntil = 0;
				}
				const next = projectWorkStatus(record.sessionId, input, record);
				record.busy = busy;
				const changed = !workStatusSame(record.state, next);
				record.state = next;
				if (changed && options && options.notify) notifyWorkStatus(record);
				return next;
			}
			function ensureWorkStatusRecord(sessionId) {
				const id = String(sessionId || "");
				let record = workStatusRecords.get(id);
				if (record) return record;
				record = { sessionId: id, state: null, busy: false, successUntil: 0, timer: null, listeners: new Set(), stopView: null, stopList: null };
				workStatusRecords.set(id, record);
				try {
					if (typeof liveTavernView !== "undefined" && liveTavernView && typeof liveTavernView.subscribe === "function") {
						const stop = liveTavernView.subscribe(id, function () { refreshWorkStatus(record, { settle: true, notify: true }); },
							[["activity"], ["settleStatus"], ["settleError"], ["latestAssistantTurn"], ["settlementTurn"]]);
						record.stopView = typeof stop === "function" ? stop : null;
					}
				} catch (_) {}
				try {
					const list = host && host.sessions && host.sessions.list;
					if (list && typeof list.subscribe === "function") {
						const stop = list.subscribe(function () { refreshWorkStatus(record, { settle: true, notify: true }); });
						record.stopList = typeof stop === "function" ? stop : null;
					}
				} catch (_) {}
				refreshWorkStatus(record, {});
				return record;
			}
			function dropWorkStatusRecord(record) {
				if (record.stopView) { try { record.stopView(); } catch (_) {} record.stopView = null; }
				if (record.stopList) { try { record.stopList(); } catch (_) {} record.stopList = null; }
				if (record.timer !== null) { clearTimeout(record.timer); record.timer = null; }
				workStatusRecords.delete(record.sessionId);
			}

			// ---- cooperative leases (apiVersion 7) ----

			function leaseKey(sessionId, scope) { return String(sessionId) + "\u0000" + String(scope); }
			function normalizeLeaseScope(value) {
				if (typeof value !== "string") return "";
				const scope = value.trim();
				return /^[a-z][a-z0-9._-]{0,31}$/.test(scope) ? scope : "";
			}
			function normalizeLeaseTtl(value) {
				if (value === undefined || value === null) return LEASE_DEFAULT_TTL_MS;
				if (typeof value !== "number" || !Number.isInteger(value) || value < LEASE_MIN_TTL_MS || value > LEASE_MAX_TTL_MS) return null;
				return value;
			}
			function leaseSnapshotOf(record) {
				return record ? { leaseId: record.leaseId, sessionId: record.sessionId, scope: record.scope, holder: record.owner, reason: record.reason, expiresAt: record.expiresAt } : null;
			}
			function leaseWatcherSet(key) {
				let set = leaseWatchers.get(key);
				if (!set) { set = new Set(); leaseWatchers.set(key, set); }
				return set;
			}
			function notifyLease(key, snapshot, cause) {
				const set = leaseWatchers.get(key);
				if (!set) return;
				for (const entry of Array.from(set)) {
					if (!tavernPluginAllowed(entry.owner, entry.sessionId)) continue;
					try { entry.listener(snapshot ? Object.assign({}, snapshot) : null, cause); }
					catch (error) { try { tavernErrorHub.report("插件 " + entry.owner + " 的占用锁回调", error); } catch (_) {} }
				}
			}
			function purgeLease(key) {
				const record = leases.get(key);
				if (!record) return null;
				if (record.expiresAt > Date.now()) return record;
				leases.delete(key);
				if (record.timer !== null) { clearTimeout(record.timer); record.timer = null; }
				notifyLease(key, null, "expired");
				return null;
			}
			function armLeaseTimer(key, record, ttl) {
				if (record.timer !== null) clearTimeout(record.timer);
				record.timer = setTimeout(function () {
					const current = leases.get(key);
					if (!current || current.leaseId !== record.leaseId) return;
					purgeLease(key);
				}, ttl);
			}
			function readLease(sessionId, scope) {
				const normalized = normalizeLeaseScope(scope);
				if (typeof sessionId !== "string" || !sessionId || !normalized) return null;
				return leaseSnapshotOf(purgeLease(leaseKey(sessionId, normalized)));
			}
			function renewLease(handle, ttlMs) {
				const ttl = normalizeLeaseTtl(ttlMs);
				if (ttl === null) throw new TypeError("renew 的 ttlMs 必须是 " + LEASE_MIN_TTL_MS + "–" + LEASE_MAX_TTL_MS + " 的整数");
				const key = leaseKey(handle.sessionId, handle.scope);
				const record = leases.get(key);
				if (!record || record.leaseId !== handle.leaseId || record.expiresAt <= Date.now()) {
					const error = new Error("占用已失效：请重新 acquireLease");
					error.code = "TAVERN_PLUGIN_LEASE_LOST";
					error.sessionId = handle.sessionId;
					error.scope = handle.scope;
					throw error;
				}
				record.expiresAt = Date.now() + ttl;
				armLeaseTimer(key, record, ttl);
				handle.expiresAt = record.expiresAt;
				notifyLease(key, leaseSnapshotOf(record), "renewed");
				return record.expiresAt;
			}
			function releaseLease(handle) {
				const key = leaseKey(handle.sessionId, handle.scope);
				const record = leases.get(key);
				if (!record || record.leaseId !== handle.leaseId) return false;
				leases.delete(key);
				if (record.timer !== null) { clearTimeout(record.timer); record.timer = null; }
				notifyLease(key, null, "released");
				return true;
			}
			function acquireLease(service, input) {
				if (!input || typeof input.sessionId !== "string" || !input.sessionId) throw new TypeError("acquireLease 需要 sessionId");
				const scope = normalizeLeaseScope(input.scope);
				if (!scope) throw new TypeError("acquireLease 的 scope 只能用小写字母、数字、点、下划线和连字符，并以字母开头");
				const ttl = normalizeLeaseTtl(input.ttlMs);
				if (ttl === null) throw new TypeError("acquireLease 的 ttlMs 必须是 " + LEASE_MIN_TTL_MS + "–" + LEASE_MAX_TTL_MS + " 的整数");
				const owner = ownerOf(service);
				const sessionId = input.sessionId;
				const key = leaseKey(sessionId, scope);
				const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 120) : "";
				const existing = purgeLease(key);
				if (existing && existing.owner !== owner) {
					const error = new Error("这一局已有插件占用 " + scope + "：" + existing.owner);
					error.code = "TAVERN_PLUGIN_LEASED";
					error.sessionId = sessionId;
					error.scope = scope;
					error.holder = existing.owner;
					error.expiresAt = existing.expiresAt;
					throw error;
				}
				const now = Date.now();
				const record = existing || { leaseId: "", sessionId: sessionId, scope: scope, owner: owner, reason: "", expiresAt: 0, timer: null };
				if (!record.leaseId) record.leaseId = "lease-" + now.toString(36) + "-" + Math.random().toString(36).slice(2, 8);
				record.reason = reason;
				record.expiresAt = now + ttl;
				armLeaseTimer(key, record, ttl);
				leases.set(key, record);
				const handle = {
					leaseId: record.leaseId,
					sessionId: sessionId,
					scope: scope,
					holder: owner,
					reason: reason,
					expiresAt: record.expiresAt,
					renew: function (nextTtl) { return renewLease(handle, nextTtl); },
					release: function () { return releaseLease(handle); },
					active: function () { return readLease(sessionId, scope); }
				};
				notifyLease(key, leaseSnapshotOf(record), existing ? "renewed" : "acquired");
				owned(service, function () { return function () { releaseLease(handle); }; }, "tavernUi.acquireLease()");
				return handle;
			}

			const service = {
				ctx: undefined,
				apiVersion: 7,
				registerMediaRenderer(kind, render) {
					if (typeof kind !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}$/.test(kind)) throw new TypeError("只能为插件自定义的 <插件名>/<类型> 注册显示方式");
					if (typeof render !== "function") throw new TypeError("registerMediaRenderer 需要 render 函数");
					const entry = { owner: ownerOf(this), render: render };
					return owned(this, function () {
						mediaRenderers.set(kind, entry);
						changed();
						return function () { if (mediaRenderers.get(kind) === entry) { mediaRenderers.delete(kind); changed(); } };
					}, "tavernUi.registerMediaRenderer()");
				},
				registerTextMarker(input) {
					if (!input || !(input.pattern instanceof RegExp)) throw new TypeError("registerTextMarker 需要正则 pattern");
					if (typeof input.render !== "function") throw new TypeError("registerTextMarker 需要 render 函数");
					const entry = { owner: ownerOf(this), pattern: input.pattern, render: input.render };
					return owned(this, function () { return addTo(markers, entry); }, "tavernUi.registerTextMarker()");
				},
				registerMessageAction(input) {
					const entry = Object.assign({ owner: ownerOf(this) }, action(input, "registerMessageAction"));
					return owned(this, function () { return addTo(messageActions, entry); }, "tavernUi.registerMessageAction()");
				},
				registerComposerAction(input) {
					const entry = Object.assign({ owner: ownerOf(this) }, action(input, "registerComposerAction"));
					return owned(this, function () { return addTo(composerActions, entry); }, "tavernUi.registerComposerAction()");
				},
				// Call a host handler registered with tavern.handle(name, handler); JSON in, JSON out.
				callHost(name, args) {
					if (typeof name !== "string" || !name) return Promise.reject(new TypeError("callHost 需要处理函数的名字"));
					return rpc("callPluginHandler", { name: name, args: args === undefined ? {} : args }).then(function (reply) { return reply ? reply.result : null; });
				},
				// An image plugin drives Tavern's own illustration UI (apiVersion 5): the 配图 button on each
				// turn and the card around its pictures. Tavern shows a button only for a handler given.
				registerIllustrator(input) {
					if (!input || !Array.isArray(input.kinds) || !input.kinds.length || input.kinds.some(function (kind) { return typeof kind !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}$/.test(kind); })) throw new TypeError("registerIllustrator 需要 kinds：插件自己的 <插件名>/<类型> 列表");
					const handlers = {};
					["draw", "redraw", "revise", "editPrompt", "add", "cancel", "action"].forEach(function (name) {
						if (input[name] === undefined) return;
						if (typeof input[name] !== "function") throw new TypeError("registerIllustrator 的 " + name + " 必须是函数");
						handlers[name] = input[name];
					});
					const entry = Object.assign({ owner: ownerOf(this), kinds: input.kinds.slice() }, handlers);
					return owned(this, function () { return addTo(illustrators, entry); }, "tavernUi.registerIllustrator()");
				},
				// Pictures Tavern itself drew before image plugins (apiVersion 4). Those old pictures
				// are no longer kept, so the list is always empty; the method stays for plugins that call it.
				listIllustrations() {
					return Promise.resolve([]);
				},
				// Names of the given games, { [gameId]: { title, cardName } }; deleted games are left out (apiVersion 4).
				getGames(gameIds) {
					return rpc("gameTitles", { gameIds: Array.isArray(gameIds) ? gameIds : [] }).then(function (reply) { return (reply && reply.games) || {}; });
				},
				// The plugin's own data, not tied to a game; the same copy its host side reads (tavern.readPluginData).
				readPluginData() {
					let owner;
					try { owner = ownerOf(this); } catch (error) { return Promise.reject(error); }
					return rpc("pluginData", { plugin: owner, op: "read" }).then(function (reply) { return reply ? reply.data : null; });
				},
				savePluginData(data) {
					let owner;
					try { owner = ownerOf(this); } catch (error) { return Promise.reject(error); }
					if (data === undefined) return Promise.reject(new TypeError("savePluginData 需要 data；要清除请传 null"));
					return rpc("pluginData", { plugin: owner, op: "save", data: data }).then(function () {});
				},
				// A sidebar page of the plugin's own, for the game open beside it (apiVersion 2).
				registerPanel(input) {
					if (!input || typeof input.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.id)) throw new TypeError("registerPanel 的 id 只能用小写字母、数字、点、下划线和连字符");
					if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 40) throw new TypeError("registerPanel 需要 1–40 字的 title");
					if (typeof input.render !== "function") throw new TypeError("registerPanel 需要 render 函数");
					const owner = ownerOf(this);
					const tabId = "tavern-plugin:" + owner + ":" + input.id;
					const render = input.render, title = input.title.trim();
					return owned(this, function () {
						if (panels.has(tabId)) throw new Error("面板 " + input.id + " 已注册");
						if (!host || !host.betterSidebar || typeof host.betterSidebar.registerTab !== "function") throw new Error("当前界面没有侧栏，无法注册插件面板");
						// a plugin panel's tab carries the host plugin glyph like every other tab.
						const PluginIcon = DshUi && DshUi.IconCordisPluginOutline14;
						const dispose = host.betterSidebar.registerTab({ id: tabId, title: title, order: 60, single: true,
							...(PluginIcon ? { icon: function (size) { return React.createElement(PluginIcon, { size: size || 16, width: size || 16, height: size || 16 }); } } : {}),
							component: function (props) {
								const gameId = props.scope && props.scope.sessionId || "";
								if (gameId && !tavernPluginAllowed(owner, gameId)) return React.createElement("p", { className: "dsh-tavern-plugin-panel-empty" }, "这是另一张人物卡的插件面板。");
								return React.createElement(tavernPluginBoundary(), { owner: owner, fallback: React.createElement("p", { className: "dsh-tavern-plugin-panel-error" }, "插件 " + owner + " 的面板出错了") },
									gameId ? React.createElement(render, { gameId: gameId, visible: props.visible !== false }) : React.createElement("p", { className: "dsh-tavern-plugin-panel-empty" }, "请先打开一局游戏。"));
							} });
						panels.set(tabId, owner);
						changed();
						return function () { if (typeof dispose === "function") dispose(); panels.delete(tabId); changed(); };
					}, "tavernUi.registerPanel()");
				},
				// URL of a file in the plugin folder's assets/ (images, maps, sounds, fonts).
				assetUrl(file) {
					if (typeof file !== "string" || !file || file.split("/").some(function (part) { return !part || part === "." || part === ".." || part.charAt(0) === "."; })) throw new TypeError("assetUrl 需要 assets/ 下的相对路径，例如 'map/forest.png'");
					return "/api/dsh-tavern/plugin-assets/" + ownerOf(this).split("/").map(encodeURIComponent).join("/") + "/" + file.split("/").map(encodeURIComponent).join("/");
				},
				// Where a game stands now (apiVersion 2): latest turn and whether a reply or settlement runs.
				getTurnState(gameId) {
					if (typeof gameId !== "string" || !gameId) return Promise.reject(new TypeError("getTurnState 需要 gameId"));
					return rpc("pluginTurnState", {}, gameId).then(function (reply) { return reply ? reply.state : null; });
				},
				// Calls listener with the state now and after every change, while that game is open here.
				watchTurnState(gameId, listener) {
					if (typeof gameId !== "string" || !gameId) throw new TypeError("watchTurnState 需要 gameId");
					if (typeof listener !== "function") throw new TypeError("watchTurnState 需要 listener 函数");
					const owner = ownerOf(this), getTurnState = service.getTurnState;
					return owned(this, function () {
						let disposed = false, queued = false, last = "", running, generation = 0;
						function refresh() {
							if (queued || disposed) return;
							queued = true;
							const request = ++generation;
							Promise.resolve().then(function () { queued = false; return disposed ? null : getTurnState(gameId); }).then(function (state) {
								const text = JSON.stringify(state);
								if (disposed || request !== generation || !state || text === last) return;
								last = text;
								try { listener(state); } catch (error) { try { tavernErrorHub.report("插件 " + owner, error); } catch (_) {} }
							}, function () {});
						}
						const list = host && host.sessions && host.sessions.list;
						// The session list changes while text streams; only a start or stop of this game matters.
						const stopSessions = list && typeof list.subscribe === "function" ? list.subscribe(function () {
							const next = list.getSnapshot().byId[gameId]?.running === true;
							if (next !== running) { running = next; refresh(); }
						}) : function () {};
						const stopView = liveTavernView.subscribe(gameId, refresh, [["latestAssistantTurn"], ["activity"], ["settlementTurn"], ["settleStatus"]]);
						return function () { disposed = true; stopView(); if (typeof stopSessions === "function") stopSessions(); };
					}, "tavernUi.watchTurnState()");
				},
				// The latest assistant reply of the game open here (apiVersion 6), card workbench
				// included: the text (streamed while it is written), the running tool, and the
				// card this turn saved. Calls listener with the state now, then after each change.
				watchReply(sessionId, listener) {
					if (typeof sessionId !== "string" || !sessionId) throw new TypeError("watchReply 需要 sessionId");
					if (typeof listener !== "function") throw new TypeError("watchReply 需要 listener 函数");
					const owner = ownerOf(this);
					return owned(this, function () {
						let disposed = false;
						const entry = {
							owner: owner,
							listener: function (state) {
								if (disposed) return;
								try { listener(state); } catch (error) { try { tavernErrorHub.report("插件 " + owner, error); } catch (_) {} }
							}
						};
						let entries = replySubscribers.get(sessionId);
						if (!entries) { entries = new Set(); replySubscribers.set(sessionId, entries); }
						entries.add(entry);
						if (tavernPluginAllowed(owner, sessionId)) entry.listener(replySnapshot(sessionId));
						return function () {
							disposed = true;
							const current = replySubscribers.get(sessionId);
							if (!current) return;
							current.delete(entry);
							if (!current.size) replySubscribers.delete(sessionId);
						};
					}, "tavernUi.watchReply()");
				},
				// What this game is doing now (apiVersion 7): idle / thinking / working /
				// waiting / success / error, the turn, the running tool and the error. Calls
				// listener with the current status, then after each change. Success lasts
				// WORK_STATUS_SUCCESS_MS after a busy turn settles, then falls back to idle.
				watchWorkStatus(sessionId, listener) {
					if (typeof sessionId !== "string" || !sessionId) throw new TypeError("watchWorkStatus 需要 sessionId");
					if (typeof listener !== "function") throw new TypeError("watchWorkStatus 需要 listener 函数");
					const owner = ownerOf(this);
					return owned(this, function () {
						let disposed = false;
						const entry = {
							owner: owner,
							listener: function (state) {
								if (disposed) return;
								try { listener(state); } catch (error) { try { tavernErrorHub.report("插件 " + owner + " 的工作状态回调", error); } catch (_) {} }
							}
						};
						const record = ensureWorkStatusRecord(sessionId);
						record.listeners.add(entry);
						if (tavernPluginAllowed(owner, sessionId)) entry.listener(record.state);
						return function () {
							disposed = true;
							record.listeners.delete(entry);
							if (!record.listeners.size) dropWorkStatusRecord(record);
						};
					}, "tavernUi.watchWorkStatus()");
				},
				// The status right now, without subscribing (apiVersion 7). A session nobody
				// watches yet gets a fresh read; success needs the busy→idle edge only
				// watchWorkStatus can see.
				getWorkStatus(sessionId) {
					if (typeof sessionId !== "string" || !sessionId) throw new TypeError("getWorkStatus 需要 sessionId");
					const record = workStatusRecords.get(sessionId);
					if (record) return record.state;
					return projectWorkStatus(sessionId, workStatusInput(sessionId), null);
				},
				// One holder per (session, scope), with a TTL (apiVersion 7). Scopes are the
				// plugin's own names ("voice", "stage", "composer", …); Tavern enforces who may
				// hold one, plugins cooperate by checking getLease/watchLease before acting.
				acquireLease(input) {
					return acquireLease(this, input);
				},
				getLease(sessionId, scope) {
					if (typeof sessionId !== "string" || !sessionId) throw new TypeError("getLease 需要 sessionId");
					return readLease(sessionId, scope);
				},
				// Calls listener with the current holder (or null) and after each change:
				// acquired / renewed / released / expired. Returning a function releases the lease.
				watchLease(sessionId, scope, listener) {
					if (typeof sessionId !== "string" || !sessionId) throw new TypeError("watchLease 需要 sessionId");
					const normalized = normalizeLeaseScope(scope);
					if (!normalized) throw new TypeError("watchLease 的 scope 只能用小写字母、数字、点、下划线和连字符，并以字母开头");
					if (typeof listener !== "function") throw new TypeError("watchLease 需要 listener 函数");
					const owner = ownerOf(this);
					return owned(this, function () {
						const key = leaseKey(sessionId, normalized);
						const entry = { owner: owner, sessionId: sessionId, listener: listener };
						const current = leaseSnapshotOf(purgeLease(key));
						leaseWatcherSet(key).add(entry);
						if (tavernPluginAllowed(owner, sessionId)) {
							try { listener(current, "current"); }
							catch (error) { try { tavernErrorHub.report("插件 " + owner + " 的占用锁回调", error); } catch (_) {} }
						}
						return function () {
							const set = leaseWatchers.get(key);
							if (!set) return;
							set.delete(entry);
							if (!set.size) leaseWatchers.delete(key);
						};
					}, "tavernUi.watchLease()");
				},
				// Fold a finished reply in the main area into one line (apiVersion 6). present() runs
				// while the message is drawn, must be synchronous, and returns null to keep the
				// original message. The first registered presenter that answers wins; a presenter
				// that throws three times is skipped for that session.
				registerReplyPresenter(input) {
					if (!input || typeof input.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.id)) throw new TypeError("registerReplyPresenter 的 id 只能用小写字母、数字、点、下划线和连字符");
					if (typeof input.present !== "function") throw new TypeError("registerReplyPresenter 需要 present 函数");
					const owner = ownerOf(this);
					const entry = { key: owner + ":" + input.id, owner: owner, modes: modesOf(input.modes, "registerReplyPresenter"), present: input.present };
					return owned(this, function () {
						if (replyPresenters.some(function (presenter) { return presenter.key === entry.key; })) throw new Error("回复呈现器 " + input.id + " 已注册");
						const dispose = addTo(replyPresenters, entry);
						return function () {
							dispose();
							for (const key of Array.from(replyPresenterFailures.keys())) if (key.indexOf(entry.owner + ":") === 0) replyPresenterFailures.delete(key);
							for (const key of Array.from(replyPresenterDisabled)) if (key.indexOf(entry.owner + ":") === 0) replyPresenterDisabled.delete(key);
						};
					}, "tavernUi.registerReplyPresenter()");
				},
				// A block of the plugin's own above the input box (apiVersion 6), for card-workbench
				// guides: the pet, its bubble and its option buttons live here. Only one slot per
				// session; render returns React.
				registerComposerSlot(input) {
					if (!input || typeof input.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.id)) throw new TypeError("registerComposerSlot 的 id 只能用小写字母、数字、点、下划线和连字符");
					if (typeof input.render !== "function") throw new TypeError("registerComposerSlot 需要 render 函数");
					const owner = ownerOf(this);
					const entry = { key: owner + ":" + input.id, owner: owner, modes: modesOf(input.modes, "registerComposerSlot"), render: input.render };
					return owned(this, function () {
						if (composerSlots.some(function (slot) { return slot.key === entry.key; })) throw new Error("输入框停靠区 " + input.id + " 已注册");
						return addTo(composerSlots, entry);
					}, "tavernUi.registerComposerSlot()");
				},
				// What the stage shows (apiVersion 2): the latest turns with their dialogue annotations, and the card's characters.
				getStage(gameId, options) {
					if (typeof gameId !== "string" || !gameId) return Promise.reject(new TypeError("getStage 需要 gameId"));
					const count = options && Number(options.count) || 5;
					return rpc("castStage", { count: count }, gameId).then(tavernStagePublicData);
				},
				// Calls listener with the stage now and after each new turn, annotation or material change, while that game is open here.
				watchStage(gameId, listener) {
					if (typeof gameId !== "string" || !gameId) throw new TypeError("watchStage 需要 gameId");
					if (typeof listener !== "function") throw new TypeError("watchStage 需要 listener 函数");
					const owner = ownerOf(this), getStage = service.getStage;
					return owned(this, function () {
						let disposed = false, queued = false, last = "", generation = 0;
						function refresh() {
							if (queued || disposed) return;
							queued = true;
							const request = ++generation;
							Promise.resolve().then(function () { queued = false; return disposed ? null : getStage(gameId); }).then(function (stage) {
								const text = JSON.stringify(stage);
								if (disposed || request !== generation || !stage || text === last) return;
								last = text;
								try { listener(stage); } catch (error) { try { tavernErrorHub.report("插件 " + owner, error); } catch (_) {} }
							}, function () {});
						}
						let stopCast = function () {};
						try { if (tavernSessionSignals && typeof tavernSessionSignals.subscribe === "function") stopCast = tavernSessionSignals.subscribe(gameId, "cast", refresh); } catch (_) {}
						const stopView = liveTavernView.subscribe(gameId, refresh, [["settlementTurn"], ["updatedAt"]]);
						refresh();
						return function () { disposed = true; stopView(); stopCast(); };
					}, "tavernUi.watchStage()");
				},
				// Retired with the old stage (#424): Tavern now draws the stage itself from the card's 素材包 and
				// the director; a plugin can no longer replace its scene. Says so in the error notice instead of
				// registering a view nothing would show. Never throws: a throw while a plugin applies fails the
				// whole page's boot, not just that plugin.
				registerStageView() {
					const message = "插件 " + ownerOf(this) + " 调用了已停用的 registerStageView：舞台改由 Tavern 按人物卡绑定的素材包绘制，这个舞台视图不会显示。请给人物卡绑定素材包并打开对话气泡，改用 Tavern 的舞台。";
					try { tavernErrorHub.report("舞台", new Error(message)); } catch (_) { console.warn(message); }
					return function () {};
				},
				// This plugin's own settings in a game (declared on the host side with tavern.gameSettings):
				// { key: value }, or null when it declared none or is off in that game.
				getGameSettings(gameId) {
					if (typeof gameId !== "string" || !gameId) return Promise.reject(new TypeError("getGameSettings 需要 gameId"));
					return rpc("pluginGameSettings", { plugin: ownerOf(this) }, gameId).then(function (reply) { return reply ? reply.values : null; });
				},
				// Calls listener with the values now and after each change the player makes in 本局设置.
				watchGameSettings(gameId, listener) {
					if (typeof gameId !== "string" || !gameId) throw new TypeError("watchGameSettings 需要 gameId");
					if (typeof listener !== "function") throw new TypeError("watchGameSettings 需要 listener 函数");
					const owner = ownerOf(this);
					return owned(this, function () {
						let disposed = false, generation = 0, last = "";
						function refresh() {
							const request = ++generation;
							rpc("pluginGameSettings", { plugin: owner }, gameId).then(function (reply) {
								const values = reply ? reply.values : null, text = JSON.stringify(values);
								if (disposed || request !== generation || text === last) return;
								last = text;
								try { listener(values); } catch (error) { try { tavernErrorHub.report("插件 " + owner, error); } catch (_) {} }
							}, function () {});
						}
						let stop = function () {};
						try { if (tavernSessionSignals && typeof tavernSessionSignals.subscribe === "function") stop = tavernSessionSignals.subscribe(gameId, "plugin-settings", refresh); } catch (_) {}
						refresh();
						return function () { disposed = true; stop(); };
					}, "tavernUi.watchGameSettings()");
				},
				// Calls listener with the state this plugin's host side published (tavern.publishState) now and after each publish.
				watchState(gameId, name, listener) {
					if (typeof gameId !== "string" || !gameId) throw new TypeError("watchState 需要 gameId");
					if (typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) throw new TypeError("watchState 的 name 只能用小写字母、数字、点、下划线和连字符");
					if (typeof listener !== "function") throw new TypeError("watchState 需要 listener 函数");
					const owner = ownerOf(this);
					return owned(this, function () {
						let disposed = false, generation = 0, last;
						function refresh() {
							const request = ++generation;
							rpc("pluginState", { plugin: owner, name: name }, gameId).then(function (reply) {
								const data = reply ? reply.data : null, text = JSON.stringify(data);
								if (disposed || request !== generation || text === last) return;
								last = text;
								try { listener(data); } catch (error) { try { tavernErrorHub.report("插件 " + owner, error); } catch (_) {} }
							}, function () {});
						}
						let stop = function () {};
						try { if (tavernSessionSignals && typeof tavernSessionSignals.subscribe === "function") stop = tavernSessionSignals.subscribe(gameId, "plugin-state:" + owner + ":" + name, refresh); } catch (_) {}
						refresh();
						return function () { disposed = true; stop(); };
					}, "tavernUi.watchState()");
				},
				// The asset packs this game's card carries (apiVersion 2): { id, title, format, contentHash, baseUrl }.
				getCardPacks(gameId) {
					if (typeof gameId !== "string" || !gameId) return Promise.reject(new TypeError("getCardPacks 需要 gameId"));
					return rpc("cardPacks", {}, gameId).then(function (reply) { return reply ? reply.packs || [] : []; });
				},
				// Say a line in its character's voice on the channel the player chose (apiVersion 2);
				// resolves true when it was heard to the end. A new line stops the one being said.
				speak(input) {
					if (!input || typeof input.gameId !== "string" || !input.gameId) return Promise.reject(new TypeError("speak 需要 gameId"));
					if (typeof input.text !== "string" || !input.text.trim()) return Promise.reject(new TypeError("speak 需要 text"));
					return tavernSpeech.speak({ sessionId: input.gameId, speaker: typeof input.speaker === "string" ? input.speaker : "", text: input.text, emotion: input.emotion, narration: input.narration === true });
				},
				stopSpeech() { tavernSpeech.stop(); },
				// Background music (apiVersion 2): one looping track; the same url keeps playing, a new one
				// fades in, an empty one stops. The player's music switch decides whether it is heard.
				playMusic(input) {
					const url = typeof input === "string" ? input : input && typeof input.url === "string" ? input.url : "";
					tavernMusic.play(url, typeof input === "object" && input ? { title: input.title, volume: input.volume } : null);
				},
				stopMusic() { tavernMusic.stop(); },
				// Put text in the game's input box without sending it.
				setInput(input) {
					const composer = composerFor(input, "setInput");
					composer.input.setDraft(composer.text);
				},
				// Send text as the player's input; queued behind a reply already being written.
				submitInput(input) {
					let composer;
					try { composer = composerFor(input, "submitInput"); } catch (error) { return Promise.reject(error); }
					if (!composer.text.trim()) return Promise.reject(new TypeError("submitInput 的 text 不能为空"));
					composer.input.setDraft(composer.text);
					return Promise.resolve(composer.input.submit("queue")).then(function () { return { submitted: true }; });
				},
				// A layer over the whole page for the plugin's own screen (a battle, a map). Escape closes it
				// unless dismissible is false; it closes by itself when the plugin unloads.
				openOverlay(input) {
					if (!input || typeof input.render !== "function") throw new TypeError("openOverlay 需要 render 函数");
					if (input.onClose !== undefined && typeof input.onClose !== "function") throw new TypeError("openOverlay 的 onClose 必须是函数");
					if (typeof document === "undefined") throw new Error("当前环境没有页面，无法打开插件界面");
					const owner = ownerOf(this);
					let cleanup = function () {}, dispose = null;
					const handle = { close: function () { if (typeof dispose === "function") dispose(); else cleanup(); } };
					dispose = owned(this, function () {
						const container = document.createElement("div");
						container.className = "dsh-tavern-plugin-overlay";
						container.setAttribute("role", "dialog");
						container.setAttribute("aria-modal", "true");
						document.body.append(container);
						const root = require("react-dom/client").createRoot(container);
						let closed = false;
						function onKey(event) { if (event.key === "Escape" && input.dismissible !== false) { event.stopPropagation(); handle.close(); } }
						document.addEventListener("keydown", onKey, true);
						cleanup = function () {
							if (closed) return;
							closed = true;
							document.removeEventListener("keydown", onKey, true);
							root.unmount();
							container.remove();
							if (input.onClose) try { input.onClose(); } catch (error) { try { tavernErrorHub.report("插件 " + owner, error); } catch (_) {} }
						};
						const h = React.createElement;
						const fallback = h("div", { className: "dsh-tavern-plugin-overlay-error" }, "插件 " + owner + " 的界面出错了",
							h("button", { type: "button", onClick: handle.close }, "关闭"));
						function Screen() { return input.render({ gameId: String(input.gameId || ""), close: handle.close }); }
						root.render(h(tavernPluginBoundary(), { owner: owner, fallback: fallback }, h(Screen)));
						return function () { cleanup(); };
					}, "tavernUi.openOverlay()");
					return handle;
				},
				// A group of the plugin's own on the sidebar start page; tabs not in any group stay under 「插件」 or 「其他」.
				registerStartGroup(input) {
					if (!input || typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 20) throw new TypeError("registerStartGroup 需要 1–20 字的 title");
					if (!Array.isArray(input.tabs) || !input.tabs.length || input.tabs.length > 20 || !input.tabs.every(function (tab) { return typeof tab === "string" && tab.length > 0 && tab.length <= 160; })) throw new TypeError("registerStartGroup 的 tabs 需要 1–20 个侧栏页 id");
					const owner = ownerOf(this);
					// A bare id names the plugin's own registerPanel page; anything with ":" is a sidebar tab id as registered.
					const entry = { owner: owner, title: input.title.trim(), tabs: input.tabs.map(function (tab) { return tab.indexOf(":") >= 0 ? tab : "tavern-plugin:" + owner + ":" + tab; }) };
					return owned(this, function () { return addTo(startGroups, entry); }, "tavernUi.registerStartGroup()");
				},
				// A section of the plugin's own on the game's 酒馆状态 page, after Tavern's own sections.
				registerStatusSection(input) {
					if (!input || typeof input.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.id)) throw new TypeError("registerStatusSection 的 id 只能用小写字母、数字、点、下划线和连字符");
					if (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 20) throw new TypeError("registerStatusSection 需要 1–20 字的 title");
					if (typeof input.render !== "function") throw new TypeError("registerStatusSection 需要 render 函数");
					const owner = ownerOf(this);
					const entry = { key: owner + ":" + input.id, owner: owner, title: input.title.trim(), render: input.render };
					return owned(this, function () {
						if (statusSections.some(function (section) { return section.key === entry.key; })) throw new Error("状态分节 " + input.id + " 已注册");
						return addTo(statusSections, entry);
					}, "tavernUi.registerStatusSection()");
				},
				// Another look for a whole turn's story text (bubbles, a script layout): the view gets Tavern's
				// own rendering as children and may wrap it; Tavern's own is used when it fails or returns null.
				registerTurnView(input) {
					if (!input || typeof input.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.id)) throw new TypeError("registerTurnView 的 id 只能用小写字母、数字、点、下划线和连字符");
					if (typeof input.label !== "string" || !input.label.trim() || input.label.trim().length > 20) throw new TypeError("registerTurnView 需要 1–20 字的 label");
					if (typeof input.render !== "function") throw new TypeError("registerTurnView 需要 render 函数");
					const owner = ownerOf(this);
					const entry = { key: owner + ":" + input.id, owner: owner, label: input.label.trim(), render: input.render };
					return owned(this, function () {
						if (turnViews.some(function (view) { return view.key === entry.key; })) throw new Error("正文视图 " + input.id + " 已注册");
						return addTo(turnViews, entry);
					}, "tavernUi.registerTurnView()");
				},
				// Another way to show the card library and the play picker (a grid, covers); Tavern keeps
				// searching, groups and batch actions, and falls back to its own list when the view fails.
				registerCardListView(input) {
					if (!input || typeof input.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.id)) throw new TypeError("registerCardListView 的 id 只能用小写字母、数字、点、下划线和连字符");
					if (typeof input.label !== "string" || !input.label.trim() || input.label.trim().length > 20) throw new TypeError("registerCardListView 需要 1–20 字的 label");
					if (typeof input.render !== "function") throw new TypeError("registerCardListView 需要 render 函数");
					const owner = ownerOf(this);
					const entry = { key: owner + ":" + input.id, owner: owner, label: input.label.trim(), render: input.render };
					return owned(this, function () {
						if (cardListViews.some(function (view) { return view.key === entry.key; })) throw new Error("人物卡列表视图 " + input.id + " 已注册");
						return addTo(cardListViews, entry);
					}, "tavernUi.registerCardListView()");
				}
			};
			Object.defineProperty(service, Symbol.for("cordis.tracker"), { value: { associate: "tavernUi", property: "ctx" } });
			return {
				service: service,
				attachHost: function (ctx) { host = ctx; },
				subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
				getSnapshot: function () { return version; },
				mediaRenderer: function (kind) { return mediaRenderers.get(kind); },
				markers: function () { return markers.slice(); },
				messageActions: function () { return messageActions.slice(); },
				composerActions: function () { return composerActions.slice(); },
				cardListViews: function () { return cardListViews.slice(); },
				statusSections: function () { return statusSections.slice(); },
				turnViews: function () { return turnViews.slice(); },
				// The latest registered illustrator handling `kind`; without a kind, the latest one that can draw.
				illustrator: function (kind) { for (let index = illustrators.length - 1; index >= 0; index -= 1) if (kind === undefined ? illustrators[index].draw : illustrators[index].kinds.indexOf(kind) >= 0) return illustrators[index]; return null; },
				startGroups: function () { return startGroups.map(function (group) { return { title: group.title, tabs: group.tabs.slice() }; }); },
				// Reply observation (fed by the composer-dock observer) and the two workbench
				// registries. Tavern's renderer uses presentReply/composerSlotFor directly.
				publishReply: publishReply,
				replySnapshot: replySnapshot,
				presentReply: presentReply,
				replyPresenters: function () { return replyPresenters.slice(); },
				composerSlotFor: function (mode) { for (const slot of composerSlots) if (slot.modes.indexOf(mode) >= 0) return slot; return null; },
				composerSlots: function () { return composerSlots.slice(); }
			};
		}
		const tavernUiExtensions = createTavernUiExtensions();

		// Which of several plugin views (stage, turn text) a game shows: Tavern's own, or a plugin's;
		// remembered per browser. With no choice made a plugin view is used: installing one is asking for it.
		// A card that brings its own view (a DSH card's plugin) opens on it; the choice is then kept per card.
		const TAVERN_VIEW_BUILTIN = "dsh-tavern:builtin";
		function useTavernPluginViewChoice(all, storageBase, sessionId) {
			useTavernUiExtensions();
			const scopes = useTavernCardPluginScopes();
			const [, setVersion] = React.useState(0);
			const views = all.filter(function (entry) { return tavernPluginAllowed(entry.owner, sessionId); });
			const cardView = views.find(function (entry) { return Array.isArray(scopes[entry.owner]) && scopes[entry.owner].length; }) || null;
			// Kept per card: the card this game plays (a plugin may be shared by copies of a card).
			const snapshot = cardView && sessionId ? liveTavernView.getSnapshot(sessionId).view : null;
			const storageKey = cardView && snapshot && snapshot.card ? storageBase + ":" + snapshot.card.path : storageBase;
			let chosen = "";
			try { chosen = window.localStorage.getItem(storageKey) || ""; } catch (_) {}
			const view = chosen === TAVERN_VIEW_BUILTIN ? null : views.find(function (entry) { return entry.key === chosen; }) || cardView || views[0] || null;
			function choose(key) {
				try { window.localStorage.setItem(storageKey, key); } catch (_) {}
				setVersion(function (value) { return value + 1; });
			}
			return { views: views, view: view, card: Boolean(cardView), choose: choose };
		}
		function TavernPluginViewSwitch(props) {
			const h = React.createElement;
			if (!props.choice.views.length) return null;
			const current = props.choice.view ? props.choice.view.key : TAVERN_VIEW_BUILTIN;
			// the shared inline menu, not a native select.
			return h(InlineField, { kind: "menu", label: props.label, className: props.className, value: current, onCommit: props.choice.choose,
				options: [{ key: TAVERN_VIEW_BUILTIN, label: "内置" }].concat(props.choice.views).map(function (entry) { return { value: entry.key, label: entry.label, title: entry.owner || undefined }; }) });
		}

		function useTavernTurnView(sessionId) {
			return useTavernPluginViewChoice(tavernUiExtensions.turnViews(), "dsh-tavern-turn-view", sessionId);
		}
		function TavernTurnPluginView(props) {
			const rendered = props.view.render(props.input);
			return rendered === null || rendered === undefined ? props.fallback : rendered;
		}
		/** A turn's story in the chosen plugin look; Tavern's own rendering when there is none or it fails. */
		function tavernTurnViewElement(view, input, body) {
			if (!view) return body;
			const fallback = React.createElement(React.Fragment, null, body);
			return React.createElement(tavernPluginBoundary(), { key: view.key, owner: view.owner, fallback: fallback },
				React.createElement(TavernTurnPluginView, { view: view, input: Object.assign({}, input, { children: fallback }), fallback: fallback }));
		}

		function TavernPluginStatusSection(props) { return props.section.render({ gameId: props.sessionId }) || null; }
		/** Plugins' own sections of 酒馆状态, and the switch for how turn text is shown when a plugin offers one. */
		function TavernPluginStatusSections(props) {
			const h = React.createElement;
			useTavernUiExtensions();
			const turnView = useTavernTurnView(props.sessionId);
			const sections = tavernUiExtensions.statusSections().filter(function (section) { return tavernPluginAllowed(section.owner, props.sessionId); });
			return h(React.Fragment, null,
				turnView.views.length ? h("section", { className: "dsh-tavern-status-section" },
					h("div", { className: "dsh-tavern-status-label" }, "正文样式"),
					h(TavernPluginViewSwitch, { choice: turnView, label: "正文样式", className: "dsh-tavern-turn-view-switch" })) : null,
				sections.map(function (section) {
					return h("section", { key: section.key, className: "dsh-tavern-status-section dsh-tavern-plugin-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, section.title),
						h(tavernPluginBoundary(), { owner: section.owner, fallback: h("div", { className: "dsh-tavern-plugin-error" }, "插件 " + section.owner + " 的内容出错了") },
							h(TavernPluginStatusSection, { section: section, sessionId: props.sessionId })));
				}));
		}
		function useTavernUiExtensions() {
			return React.useSyncExternalStore(tavernUiExtensions.subscribe, tavernUiExtensions.getSnapshot, tavernUiExtensions.getSnapshot);
		}

		// Created on first use: React is the host's, not available at bundle load.
		let tavernPluginBoundaryClass = null;
		function tavernPluginBoundary() {
			if (tavernPluginBoundaryClass) return tavernPluginBoundaryClass;
			tavernPluginBoundaryClass = class TavernPluginBoundary extends React.Component {
				constructor(props) { super(props); this.state = { failed: false }; }
				static getDerivedStateFromError() { return { failed: true }; }
				componentDidCatch(error) { try { tavernErrorHub.report("插件 " + this.props.owner, error); } catch (_) {} }
				render() { return this.state.failed ? (this.props.fallback === undefined ? null : this.props.fallback) : this.props.children; }
			};
			return tavernPluginBoundaryClass;
		}

		// Per-session index of turns holding plugin items; refreshed by the host signal.
		const tavernPluginMediaIndex = (function () {
			const entries = new Map();
			function entryFor(sessionId) {
				let entry = entries.get(sessionId);
				if (entry) return entry;
				entry = { turns: new Set(), version: 0, listeners: new Set(), stop: null, revision: 0 };
				entries.set(sessionId, entry);
				return entry;
			}
			async function refresh(sessionId) {
				const entry = entryFor(sessionId);
				const requested = ++entry.revision;
				try {
					const result = await rpc("pluginMediaTurns", {}, sessionId);
					if (requested !== entry.revision) return;
					entry.turns = new Set((result.turns || []).map(Number));
				} catch (_) { if (requested !== entry.revision) return; }
				entry.version += 1;
				Array.from(entry.listeners).forEach(function (listener) { listener(); });
			}
			function subscribe(sessionId, listener) {
				const entry = entryFor(sessionId);
				entry.listeners.add(listener);
				if (!entry.stop) {
					let stop = function () {};
					try {
						if (tavernSessionSignals && typeof tavernSessionSignals.subscribe === "function") {
							stop = tavernSessionSignals.subscribe(sessionId, "plugin-media", function () { void refresh(sessionId); });
						}
					} catch (_) {}
					entry.stop = stop;
					void refresh(sessionId);
				}
				return function () {
					entry.listeners.delete(listener);
					if (!entry.listeners.size) { entry.stop(); entries.delete(sessionId); }
				};
			}
			return {
				subscribe: subscribe,
				version: function (sessionId) { return entries.get(sessionId) ? entries.get(sessionId).version : 0; },
				has: function (sessionId, turn) { return Boolean(entries.get(sessionId) && entries.get(sessionId).turns.has(Number(turn))); }
			};
		})();

		function useTavernPluginMedia(sessionId, turn, enabled) {
			const subscribe = React.useCallback(function (listener) { return sessionId ? tavernPluginMediaIndex.subscribe(sessionId, listener) : function () {}; }, [sessionId]);
			const indexVersion = React.useSyncExternalStore(subscribe, function () { return tavernPluginMediaIndex.version(sessionId); });
			const wanted = Boolean(enabled && sessionId && turn > 0 && tavernPluginMediaIndex.has(sessionId, turn));
			const [state, setState] = React.useState({ key: null, items: [] });
			React.useEffect(function () {
				let active = true;
				if (!wanted) { setState({ key: null, items: [] }); return; }
				rpc("pluginMediaForTurn", { turn: turn }, sessionId).then(function (result) {
					if (active) setState({ key: result.key || null, items: Array.isArray(result.items) ? result.items : [] });
				}, function () {});
				return function () { active = false; };
			}, [sessionId, turn, wanted, indexVersion]);
			return state;
		}

		function tavernPluginMediaUrl(sessionId, item, version) {
			const query = { sessionId: sessionId, id: item.id, v: String(item.updatedAt || "") };
			if (version !== undefined) query.version = String(version);
			return "/api/dsh-tavern/plugin-media?" + new URLSearchParams(query).toString();
		}

		// What the 配图 button is doing for a turn, shown in that turn's text: a placeholder while the
		// illustrator plans the pictures, then a short note when it skipped or failed.
		const tavernIllustrationDrafts = (function () {
			const states = new Map(), listeners = new Set();
			function emit() { Array.from(listeners).forEach(function (listener) { listener(); }); }
			return {
				get: function (sessionId, turn) { return states.get(sessionId + ":" + turn) || null; },
				set: function (sessionId, turn, value) { const key = sessionId + ":" + turn; if (value) states.set(key, value); else states.delete(key); emit(); },
				subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; }
			};
		})();
		const TAVERN_ILLUSTRATION_NOTICE_MS = 8000;
		async function runTavernIllustrator(illustrator, sessionId, turn, instruction) {
			let normalizedInstruction;
			if (instruction !== undefined) {
				if (typeof instruction !== "string") throw new TypeError("配图要求必须是文本");
				normalizedInstruction = instruction.trim();
				if (normalizedInstruction.length > 2000) throw new RangeError("配图要求不能超过 2000 字");
			}
			const planning = { planning: true };
			tavernIllustrationDrafts.set(sessionId, turn, planning);
			let draft = null;
			let failure = null;
			try {
				const request = { gameId: sessionId, turn: turn };
				if (normalizedInstruction) request.instruction = normalizedInstruction;
				const result = await illustrator.draw(request);
				const notice = result && typeof result.notice === "string" ? result.notice.trim() : "";
				if (notice) draft = { text: notice.slice(0, 200) };
			} catch (error) { failure = error; draft = { text: String(error && error.message || error).slice(0, 200), failed: true }; }
			if (tavernIllustrationDrafts.get(sessionId, turn) === planning) {
				tavernIllustrationDrafts.set(sessionId, turn, draft);
				if (draft) setTimeout(function () { if (tavernIllustrationDrafts.get(sessionId, turn) === draft) tavernIllustrationDrafts.set(sessionId, turn, null); }, TAVERN_ILLUSTRATION_NOTICE_MS);
			}
			if (failure && instruction !== undefined) throw failure;
		}
		// `items` are the turn's plugin media: once the illustrator attaches a new one, planning is
		// over and that item's own card shows the drawing, so the placeholder goes.
		function TavernIllustrationDraft(props) {
			const subscribe = React.useCallback(function (listener) { return tavernIllustrationDrafts.subscribe(listener); }, []);
			const draft = React.useSyncExternalStore(subscribe, function () { return tavernIllustrationDrafts.get(props.sessionId, props.turn); });
			const known = React.useRef({ draft: null, ids: null });
			const ids = (props.items || []).map(function (item) { return item.id; });
			if (known.current.draft !== draft) known.current = { draft: draft, ids: new Set(ids) };
			if (!draft) return null;
			if (draft.planning && ids.some(function (id) { return !known.current.ids.has(id); })) return null;
			return React.createElement("figure", { className: "dsh-tavern-plugin-media dsh-tavern-illustration" },
				React.createElement("div", { className: draft.failed ? "dsh-tavern-plugin-media-failed" : "dsh-tavern-plugin-media-pending", role: draft.failed ? "alert" : "status" }, draft.planning ? "正在整理画面…" : draft.text));
		}

		// Tavern's illustration card around a picture an illustrator plugin drew: earlier versions,
		// redraw / edit prompt / add, delete, progress and the plugin's own extra buttons.
		function TavernIllustrationCard(props) {
			const h = React.createElement;
			const item = props.item, illustrator = props.illustrator;
			const askConfirm = useTavernConfirm(props.sessionId);
			const history = item.history || [];
			const count = history.length + (item.attachment ? 1 : 0);
			const [selected, setSelected] = React.useState(count - 1);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const [panel, setPanel] = React.useState(null);
			const [draft, setDraft] = React.useState("");
			React.useEffect(function () { setSelected(count - 1); setError(""); }, [item.updatedAt, count]);
			const index = Math.min(Math.max(selected, 0), count - 1);
			const current = index === history.length;
			const url = count ? tavernPluginMediaUrl(props.sessionId, item, current ? undefined : index) : "";
			const working = item.status === "pending" || Boolean(item.activity);
			const context = { gameId: props.sessionId, turn: props.turn, textVersion: item.textVersion, item: item };
			async function run(name, extra) {
				if (busy || !illustrator[name]) return;
				setBusy(true); setError("");
				try { await illustrator[name](Object.assign({}, context, extra || {})); setPanel(null); setDraft(""); }
				catch (e) { setError(String(e && e.message || e)); }
				finally { setBusy(false); }
			}
			async function removeVersion() {
				if (busy || !await askConfirm(count > 1 ? "删除这一张？其他版本保留。" : "删除这张插图？")) return;
				setBusy(true); setError("");
				try { await rpc("removePluginMediaVersion", { sessionId: props.sessionId, itemId: item.id, version: current ? null : index }, props.sessionId); }
				catch (e) { setError(String(e && e.message || e)); }
				finally { setBusy(false); }
			}
			function open(kind) { setPanel(kind); setDraft(kind === "prompt" ? String((current ? item.prompt : history[index] && history[index].prompt) || item.prompt || "") : ""); }
			const progress = item.activity ? item.activity.progress : item.progress;
			const workingLabel = (item.activity ? item.activity.label : "生成中") + (typeof progress === "number" && progress > 0 && progress < 1 ? " " + Math.round(progress * 100) + "%" : "…");
			const canCancel = illustrator.cancel && (item.status === "pending" || item.activity && item.activity.cancellable);
			return h("figure", { className: "dsh-tavern-plugin-media dsh-tavern-illustration", "data-kind": item.kind, "data-owner": item.owner },
				url ? h("a", { href: url, "aria-label": "放大插图", onClick: function (event) { event.preventDefault(); openSceneImagePreview(url, event.currentTarget, null, illustrator.editPrompt && !working ? function () { open("prompt"); } : null); } },
					h("img", { src: url, alt: item.caption || "插图", loading: "lazy" })) : null,
				item.caption && url ? h("figcaption", null, current ? item.caption : history[index] && history[index].caption || item.caption) : null,
				url ? h("div", { className: "dsh-tavern-image-actions" },
					h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || working, onClick: removeVersion }, "删除图片"),
					count > 1 ? h(React.Fragment, null,
						h("button", { type: "button", className: "dsh-tavern-btn", "aria-label": "上一张插图", disabled: index <= 0, onClick: function () { setSelected(index - 1); } }, "‹"),
						h("span", null, String(index + 1) + " / " + String(count)),
						h("button", { type: "button", className: "dsh-tavern-btn", "aria-label": "下一张插图", disabled: index >= count - 1, onClick: function () { setSelected(index + 1); } }, "›")) : null,
					// With revise, 重画 opens a panel: the same prompt again, or a prompt rewritten by the wish (or freshly).
					illustrator.revise ? h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || working, onClick: function () { open("redraw"); } }, "重画")
						: illustrator.redraw ? h("button", { type: "button", className: "dsh-tavern-btn", title: "按这张图的提示词再画一张，旧图保留为上一个版本", disabled: busy || working, onClick: function () { return run("redraw"); } }, "重画") : null,
					illustrator.editPrompt ? h("button", { type: "button", className: "dsh-tavern-btn", title: "自己改这张图的提示词再画", disabled: busy || working, onClick: function () { open("prompt"); } }, "改提示词") : null,
					illustrator.add ? h("button", { type: "button", className: "dsh-tavern-btn", title: "为这一轮另选一个场景，再加一张插图", disabled: busy, onClick: function () { open("add"); } }, "新增插图") : null) : null,
				panel === "redraw" ? h("div", { className: "dsh-tavern-image-adjust dsh-tavern-image-repaint", role: "region", "aria-label": "重画插图" },
					h(TextArea, { value: draft, maxLength: 2000, rows: 2, autoFocus: true, disabled: busy, "aria-label": "重画意见（选填）",
						placeholder: "想怎么改？例如：改成雨夜，镜头拉近。留空则重新构思画面，或用同一份提示词再画一张",
						onChange: function (value) { setDraft(value); },
						onKeyDown: function (event) {
							if (event.key === "Escape" && !busy) setPanel(null);
							else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !busy) { event.preventDefault(); run("revise", { instruction: draft.trim() }); }
						} }),
					h("div", { className: "dsh-tavern-image-repaint-actions" },
						h("button", { type: "button", className: "dsh-tavern-image-repaint-cancel", disabled: busy, onClick: function () { setPanel(null); } }, "取消"),
						illustrator.redraw && !draft.trim() ? h("button", { type: "button", className: "dsh-tavern-btn", title: "提示词不变，只换随机种子再画一张", disabled: busy, onClick: function () { return run("redraw"); } }, "同提示词重画") : null,
						h("button", { type: "button", className: "dsh-tavern-btn dsh-tavern-image-repaint-submit", title: draft.trim() ? "按意见改写这张图的提示词后重画" : "重新整理这张图的提示词再画，多跑一次文字模型", disabled: busy,
							onClick: function () { return run("revise", { instruction: draft.trim() }); } }, draft.trim() ? "按意见重画" : "重新整理提示词"))) : null,
				panel === "prompt" || panel === "add" ? h("div", { className: "dsh-tavern-image-adjust dsh-tavern-image-repaint", role: "region", "aria-label": panel === "prompt" ? "改提示词重画" : "新增插图" },
					h(TextArea, { value: draft, maxLength: 12000, rows: panel === "prompt" ? 6 : 2, autoFocus: true, disabled: busy,
						"aria-label": panel === "prompt" ? "画面提示词" : "新插图想画什么（选填）",
						placeholder: panel === "prompt" ? "直接写画面提示词" : "想画哪个场景？留空由插件另选一个不同的场景",
						onChange: function (value) { setDraft(value); },
						onKeyDown: function (event) {
							if (event.key === "Escape" && !busy) setPanel(null);
							else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !busy) { event.preventDefault(); run(panel === "prompt" ? "editPrompt" : "add", panel === "prompt" ? { prompt: draft.trim() } : { instruction: draft.trim() }); }
						} }),
					h("div", { className: "dsh-tavern-image-repaint-actions" },
						h("button", { type: "button", className: "dsh-tavern-image-repaint-cancel", disabled: busy, onClick: function () { setPanel(null); } }, "取消"),
						h("button", { type: "button", className: "dsh-tavern-btn dsh-tavern-image-repaint-submit", disabled: busy || panel === "prompt" && !draft.trim(),
							onClick: function () { return run(panel === "prompt" ? "editPrompt" : "add", panel === "prompt" ? { prompt: draft.trim() } : { instruction: draft.trim() }); } }, panel === "prompt" ? "用这段重画" : "新增插图"))) : null,
				working ? h("div", { className: "dsh-tavern-plugin-media-pending", role: "status" }, workingLabel,
					canCancel ? h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { return run("cancel"); } }, "取消") : null) : null,
				!url && item.status === "failed" ? h("div", { className: "dsh-tavern-image-actions" },
					h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: removeVersion }, "移除")) : null,
				(item.actions || []).length && illustrator.action ? h("div", { className: "dsh-tavern-image-actions" }, item.actions.map(function (entry) {
					return h("button", { key: entry.id, type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: async function () {
						if (entry.confirm && !await askConfirm(entry.confirm)) return;
						return run("action", { actionId: entry.id });
					} }, entry.label);
				})) : null,
				error || item.error ? h("span", { role: "alert", className: "dsh-tavern-settings-error" }, error || (item.status === "failed" ? "生成失败：" : "") + item.error) : null);
		}

		function TavernPluginMediaItem(props) {
			useTavernUiExtensions();
			const h = React.createElement;
			const item = props.item;
			const caption = item.caption ? h("figcaption", null, item.caption) : null;
			let body;
			const illustrator = item.kind.indexOf("/") > 0 ? tavernUiExtensions.illustrator(item.kind) : null;
			if (illustrator && tavernPluginAllowed(illustrator.owner, props.sessionId)) return h(tavernPluginBoundary(), { owner: illustrator.owner }, h(TavernIllustrationCard, { item: item, illustrator: illustrator, sessionId: props.sessionId, turn: props.turn }));
			if (item.kind.indexOf("/") > 0) {
				const renderer = tavernUiExtensions.mediaRenderer(item.kind);
				if (!renderer) return null;
				body = h(tavernPluginBoundary(), { owner: renderer.owner }, h(renderer.render, { item: Object.assign({}, item, { url: item.attachment ? tavernPluginMediaUrl(props.sessionId, item) : "" }), gameId: props.sessionId, turn: props.turn }));
			} else if (item.status === "pending") {
				body = h("div", { className: "dsh-tavern-plugin-media-pending", role: "status" }, typeof item.progress === "number" ? "生成中… " + Math.round(item.progress * 100) + "%" : "生成中…");
			} else if (item.status === "failed") {
				body = h("div", { className: "dsh-tavern-plugin-media-failed", role: "status" }, item.error ? "生成失败：" + item.error : "生成失败");
			} else if (item.attachment) {
				const url = tavernPluginMediaUrl(props.sessionId, item);
				if (item.kind === "image") body = h("a", { href: url, "aria-label": "放大插图", onClick: function (event) { event.preventDefault(); openSceneImagePreview(url, event.currentTarget); } }, h("img", { src: url, alt: item.caption || "插图", loading: "lazy" }));
				else if (item.kind === "video") body = h("video", { src: url, controls: true, preload: "metadata", playsInline: true });
				else body = h("audio", { src: url, controls: true, preload: "metadata" });
			}
			if (!body) return null;
			return h("figure", { className: "dsh-tavern-plugin-media dsh-tavern-illustration", "data-kind": item.kind, "data-owner": item.owner }, body, caption);
		}

		function TavernPluginMarker(props) {
			const marker = props.marker;
			const fallback = React.createElement("span", null, props.match[0]);
			let rendered;
			try {
				rendered = marker.render({ match: props.match[0], groups: props.match.slice(1), gameId: props.sessionId, turn: props.turn, streaming: Boolean(props.streaming) });
			} catch (error) {
				try { tavernErrorHub.report("插件 " + marker.owner, error); } catch (_) {}
				return fallback;
			}
			if (rendered === null || rendered === undefined) return fallback;
			return React.createElement(tavernPluginBoundary(), { owner: marker.owner, fallback: fallback }, rendered);
		}

		/**
		 * Context for renderTavernAssistantBlocks: which markers apply and which
		 * media still needs a place. `placed` collects anchored ids during render.
		 */
		function createTavernPluginTextContext(input) {
			const markers = tavernUiExtensions.markers().filter(function (marker) { return tavernPluginAllowed(marker.owner, input.sessionId); });
			// `extras` are Tavern's own anchored elements (the built-in scene picture).
			const extras = new Map((input.extras || []).filter(function (extra) { return extra.anchor; }).map(function (extra) { return [extra.id, extra]; }));
			const anchored = input.items.filter(function (item) { return item.anchor; }).concat(Array.from(extras.values()));
			if (!markers.length && !anchored.length) return null;
			const byId = new Map(input.items.map(function (item) { return [item.id, item]; }));
			const placed = new Set();
			const anchors = input.streaming ? [] : anchored.map(function (item) { return { id: item.id, anchor: item.anchor }; });
			return {
				placed: placed,
				render: function (text, key, renderText) {
					const result = segmentPluginText(text, { markers: markers.map(function (marker) { return marker.pattern; }), anchors: anchors.filter(function (anchor) { return !placed.has(anchor.id); }) });
					result.placed.forEach(function (id) { placed.add(id); });
					if (result.segments.length === 1 && result.segments[0].kind === "text") return renderText(text, key, 0);
					// retain source coordinates; media consumes no source text.
					let sourceOffset = 0;
					return React.createElement(React.Fragment, { key: key }, result.segments.map(function (segment, index) {
						const offset = sourceOffset;
						if (segment.kind === "text") { sourceOffset += segment.text.length; return renderText(segment.text, index, offset); }
						if (segment.kind === "marker") sourceOffset += segment.match[0].length;
						if (segment.kind === "media") return React.createElement(React.Fragment, { key: index }, segment.ids.map(function (id) {
							if (extras.has(id)) return React.createElement(React.Fragment, { key: id }, extras.get(id).render());
							return React.createElement(TavernPluginMediaItem, { key: id, item: byId.get(id), sessionId: input.sessionId, turn: input.turn });
						}));
						return React.createElement(TavernPluginMarker, { key: index, marker: markers[segment.marker], match: segment.match, sessionId: input.sessionId, turn: input.turn, streaming: input.streaming });
					}));
				},
				renderHtmlMarkers: function (html) {
					if (!markers.length) return { html: html, after: null };
					const extracted = extractPluginMarkers(html, markers.map(function (marker) { return marker.pattern; }));
					if (!extracted.markers.length) return { html: html, after: null };
					return { html: extracted.html, after: extracted.markers.map(function (segment, index) {
						return React.createElement(TavernPluginMarker, { key: "marker:" + index, marker: markers[segment.marker], match: segment.match, sessionId: input.sessionId, turn: input.turn, streaming: input.streaming });
					}) };
				}
			};
		}

		function TavernPluginActionButtons(props) {
			useTavernUiExtensions();
			const [busy, setBusy] = React.useState("");
			const context = props.context;
			const visible = props.actions.filter(function (entry) {
				if (!entry.when) return true;
				try { return Boolean(entry.when(Object.assign({}, context))); }
				catch (error) { try { tavernErrorHub.report("插件 " + entry.owner, error); } catch (_) {} return false; }
			});
			if (!visible.length) return null;
			return React.createElement("div", { className: props.className },
				visible.map(function (entry) {
					const key = entry.owner + ":" + entry.id;
					return React.createElement("button", { key: key, type: "button", className: props.buttonClassName, title: entry.owner, disabled: Boolean(busy) || props.disabled, onClick: async function () {
						setBusy(key);
						try { await entry.run(Object.assign({}, context)); }
						catch (error) { tavernErrorHub.report("插件 " + entry.owner, error); }
						finally { setBusy(""); }
					} }, busy === key ? entry.label + "…" : entry.label);
				}));
		}

		function TavernPluginMessageActions(props) {
			useTavernUiExtensions();
			const actions = tavernUiExtensions.messageActions().filter(function (entry) { return tavernPluginAllowed(entry.owner, props.sessionId); });
			if (!actions.length) return null;
			return React.createElement(TavernPluginActionButtons, { actions: actions, className: "dsh-tavern-plugin-message-actions", buttonClassName: "dsh-tavern-btn",
				// text: the reply as written, so `when` can show a button only for the replies it fits.
				context: { gameId: props.sessionId, turn: props.turn, settled: props.settled, text: String(props.text || "") } });
		}

		function TavernPluginComposerActions(props) {
			useTavernUiExtensions();
			const actions = tavernUiExtensions.composerActions().filter(function (entry) { return tavernPluginAllowed(entry.owner, props.sessionId); });
			if (!actions.length) return null;
			return React.createElement(TavernPluginActionButtons, { actions: actions, className: "dsh-tavern-plugin-composer-actions", buttonClassName: "dsh-tavern-choice-trigger",
				disabled: props.running, context: { gameId: props.sessionId, turn: props.turn, busy: Boolean(props.running) } });
		}

		const TAVERN_CARD_LIST_VIEW_KEY = "dsh-tavern-card-list-view";
		function readTavernCardListView() { try { return window.localStorage.getItem(TAVERN_CARD_LIST_VIEW_KEY) || ""; } catch (_) { return ""; } }

		function tavernCardListViewCard(card) {
			return {
				path: card.path, name: card.name, fileName: String(card.path).replace(/\\/g, "/").split("/").pop(),
				imageUrl: card.hasImage ? "/api/dsh-tavern/card-image?path=" + encodeURIComponent(card.path) : "",
				script: card.script ? { title: card.script.title } : null,
				group: card.group || "", starred: Boolean(card.starred), error: card.readError || ""
			};
		}

		// Tavern's own grid of covers, built on the same render input plugin views get.
		// From swp-z/dsh-tavern-card-grid (MIT): 2–6 columns per place, remembered; the name sits over
		// the cover, and the file name and bound script are in the tooltip.
		const TAVERN_CARD_GRID_COLUMNS = [2, 3, 4, 5, 6];
		function readTavernCardGridColumns(place) {
			const fallback = place === "play" ? 6 : 4;
			try {
				// The plugin's own key, so its users keep their setting.
				const stored = window.localStorage.getItem("dsh-tavern-card-grid-cols-" + place) || window.localStorage.getItem("tavern-card-grid-cols-" + place);
				return Math.min(6, Math.max(2, Number(stored) || fallback));
			} catch (_) { return fallback; }
		}
		function TavernCardGrid(props) {
			const h = React.createElement;
			const input = props.input;
			const [columns, setColumns] = React.useState(function () { return readTavernCardGridColumns(input.place); });
			function changeColumns(next) {
				setColumns(next);
				try { window.localStorage.setItem("dsh-tavern-card-grid-cols-" + input.place, String(next)); } catch (_) {}
			}
			const toolbar = h("div", { className: "dsh-tavern-card-grid-tools" },
				h("span", null, "每行"),
				h("div", { className: "dsh-tavern-segmented", role: "group", "aria-label": "每行列数" },
					TAVERN_CARD_GRID_COLUMNS.map(function (count) {
						return h("button", { key: count, type: "button", "aria-pressed": count === columns, "aria-label": count + " 列", onClick: function () { changeColumns(count); } }, String(count));
					})),
				h("span", { className: "dsh-tavern-card-grid-count" }, input.cards.length + " 张"));
			if (!input.cards.length) return h("div", null, toolbar, h(EmptyState, { text: "没有匹配的人物卡", icon: "search" }));
			return h("div", null, toolbar, h("div", { className: "dsh-tavern-card-grid" + (columns >= 5 ? " dense" : ""), style: { "--dsh-tavern-card-grid-cols": String(columns) } }, input.cards.map(function (card) {
				const selected = input.isSelected(card.path);
				const corner = [input.mention(card.path), input.menu(card.path)].filter(Boolean);
				const script = card.script && card.script.title ? card.script.title : "";
				return h("div", { key: card.path, className: "dsh-tavern-card-grid-item" + (selected ? " selected" : "") + (card.error ? " broken" : "") },
					h("button", { type: "button", className: "dsh-tavern-card-grid-open", title: card.error || [card.name, card.fileName ? "文件：" + card.fileName : "", script ? "剧本：" + script : "自由故事"].filter(Boolean).join("\n"), "aria-pressed": input.selecting ? selected : undefined,
						disabled: input.busy || (!input.selecting && input.place === "play" && Boolean(card.error)), onClick: function () { input.open(card.path); } },
						card.imageUrl ? h("img", { className: "dsh-tavern-card-grid-cover", src: card.imageUrl, alt: "", loading: "lazy" })
							: h("span", { className: "dsh-tavern-card-grid-cover placeholder", "aria-hidden": "true" }, Array.from(String(card.name || "").replace(/^[^\p{L}\p{N}]+/u, ""))[0] || "?"),
						h("span", { className: "dsh-tavern-card-grid-copy" },
							h("span", { className: "dsh-tavern-card-grid-name" }, card.name))),
					input.selecting ? h(Switch, { className: "dsh-tavern-card-grid-check", checked: selected, disabled: input.busy,
                        label: "选择人物卡：" + card.name, onChange: function () { input.toggle(card.path); } }) : null,
					corner.length ? h("span", { className: "dsh-tavern-card-grid-corner" }, corner) : null);
			})));
		}
		function renderTavernCardGrid(input) {
			return React.createElement(TavernCardGrid, { input: input });
		}
		const TAVERN_CARD_GRID_VIEW = { key: "dsh-tavern:grid", owner: "DSH Tavern", label: "宫格", render: renderTavernCardGrid };

		function TavernCardListViewBody(props) {
			const rendered = props.view.render(props.input);
			return rendered === null || rendered === undefined ? props.fallback : rendered;
		}

		/**
		 * The card rows of the library and the play picker: Tavern's own list or grid, or a
		 * plugin view, picked by a switcher (remembered per browser).
		 * props: place, cards (already searched and filtered), batch, busy, open(card), menu(card)?, mention(card)?, builtin().
		 */
		function TavernCardList(props) {
			useTavernUiExtensions();
			const [chosen, setChosen] = React.useState(readTavernCardListView);
			const h = React.createElement;
			const views = [TAVERN_CARD_GRID_VIEW].concat(tavernUiExtensions.cardListViews());
			const view = views.find(function (entry) { return entry.key === chosen; }) || null;
			const builtin = props.builtin();
			function choose(key) {
				setChosen(key);
				try { window.localStorage.setItem(TAVERN_CARD_LIST_VIEW_KEY, key); } catch (_) {}
			}
			const switcher = h("div", { className: "dsh-tavern-card-view-switch dsh-tavern-segmented", role: "group", "aria-label": "人物卡显示方式" },
				[{ key: "", label: "列表" }].concat(views).map(function (entry) {
					return h("button", { key: entry.key, type: "button", "aria-pressed": (view ? view.key : "") === entry.key, title: entry.owner && entry !== TAVERN_CARD_GRID_VIEW ? "来自插件 " + entry.owner : undefined, onClick: function () { choose(entry.key); } }, entry.label);
				}));
			if (!view) return h(React.Fragment, null, switcher, builtin);
			const byPath = new Map(props.cards.map(function (card) { return [card.path, card]; }));
			const batch = props.batch;
			const input = {
				place: props.place,
				cards: props.cards.map(tavernCardListViewCard),
				busy: Boolean(props.busy),
				selecting: Boolean(batch.managing),
				isSelected: function (path) { return batch.managing && batch.isSelected(path); },
				toggle: function (path) { if (batch.managing && byPath.has(path)) batch.toggle(path); },
				open: function (path) {
					const card = byPath.get(path);
					if (!card || props.busy) return;
					if (batch.managing) batch.toggle(path); else props.open(card);
				},
				menu: function (path) { const card = byPath.get(path); return card && props.menu && !batch.managing ? props.menu(card) : null; },
				mention: function (path) { const card = byPath.get(path); return card && props.mention && !batch.managing ? props.mention(card) : null; }
			};
			return h(React.Fragment, null, switcher,
				h(tavernPluginBoundary(), { key: view.key, owner: view.owner, fallback: builtin }, h(TavernCardListViewBody, { view: view, input: input, fallback: builtin })));
		}
