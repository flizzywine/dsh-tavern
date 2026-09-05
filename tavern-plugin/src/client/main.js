window.__ModuleLoader__.load({
	id: "dsh-tavern-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
			Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
			let React = require("react");
			let DshUi = require("@deepseek-ai/dsh-client-ui-primitives");

		const stylesheetId = "dsh-tavern-plugin/tavern.css";
		if (typeof document !== "undefined" && document.querySelector("link[data-plugin-css=" + JSON.stringify(stylesheetId) + "]") === null) {
			const stylesheet = document.createElement("link");
			stylesheet.rel = "stylesheet";
			stylesheet.dataset.plugin = "dsh-tavern-plugin";
			stylesheet.dataset.pluginCss = stylesheetId;
			stylesheet.href = "/api/dsh-tavern/client-assets/tavern.css";
			document.head.appendChild(stylesheet);
		}


		function isPlayMode(mode) {
			return mode === "story" || mode === "script";
		}
		function groupOfMode(mode) {
			return isPlayMode(mode || "story") ? "play" : "card";
		}
		function playModeOfCard(card) {
			return card && card.script ? "script" : "story";
		}
		function modeLabel(mode) {
			return mode === "script" ? "剧本" : mode === "card" ? "卡片" : "故事";
		}

		function ascii(bytes, off, len) {
			let s = "";
			for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[off + i]);
			return s;
		}

		function bytesToBase64(bytes) {
			let binary = "";
			for (let offset = 0; offset < bytes.length; offset += 32768) {
				binary += String.fromCharCode.apply(null, bytes.subarray(offset, Math.min(bytes.length, offset + 32768)));
			}
			return btoa(binary);
		}

		function parseTextResourceFile(file) {
			const name = String(file && file.name || "");
			if (!name.toLowerCase().endsWith(".epub")) {
				return file.text().then(function (text) { return { name: name, type: file.type || "", text: text, chunkSize: 500 }; });
			}
			if (Number(file.size) > 50 * 1024 * 1024) return Promise.reject(new Error("EPUB 文件不能超过 50 MB"));
			return file.arrayBuffer().then(function (buffer) {
				return { name: name, type: file.type || "application/epub+zip", fileB64: bytesToBase64(new Uint8Array(buffer)), chunkSize: 500 };
			});
		}

		function parseCardFile(file) {
			const name = String(file.name || "");
			if (name.toLowerCase().endsWith(".json")) {
				return file.text().then(function (text) { return { kind: "text", name: name, text: text }; });
			}
			return file.arrayBuffer().then(function (buf) {
				const bytes = new Uint8Array(buf);
				if (bytes.length <= 8 || ascii(bytes, 0, 8) !== "\x89PNG\r\n\x1a\n") {
					throw new Error("无法识别的角色卡文件（需要 PNG 或 JSON）");
				}
				let off = 8;
				while (off + 8 <= bytes.length) {
					const len = (((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3])) >>> 0;
					const type = ascii(bytes, off + 4, 4);
					if (type === "tEXt" && off + 8 + len <= bytes.length) {
						const dataOff = off + 8;
						let nul = -1;
						for (let i = 0; i < len; i++) {
							if (bytes[dataOff + i] === 0) { nul = i; break; }
						}
						if (nul >= 0) {
							const keyword = ascii(bytes, dataOff, nul);
							const value = ascii(bytes, dataOff + nul + 1, len - nul - 1);
							if (keyword === "chara" || keyword === "ccv3") return { kind: "png", name: name, b64: value, fileB64: bytesToBase64(bytes) };
						}
					}
					if (type === "IEND") break;
					off += 12 + len;
				}
				throw new Error("PNG 中未找到角色卡数据（chara/ccv3 文本块）");
			});
		}

		function MobileCardImportButton(props) {
			const [catalog, setCatalog] = React.useState(null);
			const [open, setOpen] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			function load() {
				return rpcWithTimeout("listMobileCardImports", {}).then(function (result) { setCatalog(result); return result; }, function () { setCatalog({ available: false, files: [] }); return { available: false, files: [] }; });
			}
			React.useEffect(function () { load(); }, []);
			async function activate() {
				const current = catalog || await load();
				if (current.available) { setOpen(true); load(); }
				else if (props.inputRef.current) props.inputRef.current.click();
			}
			async function importFile(file) {
				setBusy(true); setError("");
				try { const result = await rpc("importMobileCard", { id: file.id }); setOpen(false); await props.onImported(result.card); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			const h = React.createElement;
			return h(React.Fragment, null,
				h("button", { className: "dsh-tavern-btn", disabled: props.disabled || busy, onClick: activate }, "导入人物卡"),
				open ? h("div", { className: "dsh-tavern-mobile-import", role: "dialog", "aria-modal": "true", "aria-label": "从手机下载目录导入人物卡" }, h("div", { className: "dsh-tavern-mobile-import-shell" }, h("div", { className: "dsh-tavern-mobile-import-panel" },
					h("div", { className: "dsh-tavern-mobile-import-title" }, "从手机下载目录导入"),
					h("div", { className: "dsh-tavern-question-sub" }, "把 PNG 或 JSON 人物卡放进手机 Download，回到这里点选。"),
					error ? h("div", { className: "dsh-tavern-dock-error", role: "alert" }, error) : null,
					h("div", { className: "dsh-tavern-mobile-import-list" }, catalog && catalog.files.length ? catalog.files.map(function (file) { return h("button", { key: file.id, className: "dsh-tavern-mobile-import-file", disabled: busy, onClick: function () { importFile(file); } }, h("b", null, file.name), h("span", null, file.directory + " · " + Math.ceil(file.size / 1024) + " KB")); }) : h("div", { className: "dsh-tavern-empty" }, catalog && catalog.storageAccessible === false ? "DSHA 无法读取下载目录。请在系统设置中允许 DSHA ‘访问所有文件’，然后点刷新；也可尝试系统文件选择器。" : "下载目录里还没有 PNG/JSON 人物卡。")),
					h("div", { className: "dsh-tavern-library-head-actions" }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: load }, "刷新"), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { setOpen(false); if (props.inputRef.current) props.inputRef.current.click(); } }, "使用系统文件选择器"), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { setOpen(false); } }, "关闭"))
				))) : null
			);
		}

		// @include modules/runtime-generation-monitor.js

		function reloadTavernClient() {
			const script = Array.from(document.scripts || []).find(function (item) {
				return String(item && item.src || "").includes("/plugins/dsh-tavern-plugin/client.js");
			});
			const warm = script && script.src
				? fetch(script.src, { cache: "reload" }).catch(function () {})
				: Promise.resolve();
			return warm.then(function () { window.location.reload(); });
		}

		const tavernRuntimeGenerationMonitor = createTavernRuntimeGenerationMonitor({
			load: function () {
				return fetch("/api/dsh-tavern/runtime-generation", { cache: "no-store" }).then(readTavernJsonResponse);
			},
			refresh: reloadTavernClient
		});

		async function readTavernJsonResponse(response) {
			function failure(message, retryable) {
				const error = new Error(message);
				error.status = response.status;
				error.retryable = retryable;
				return error;
			}
			if (response.status === 401) throw failure("连接认证已失效，请通过服务启动时提供的地址重新打开页面", false);
			if (response.status === 403) throw failure("请求被拒绝，请检查访问地址和权限", false);
			if (!response.ok) throw failure("服务请求失败（HTTP " + response.status + "），请稍后重试", [404, 408, 429, 502, 503, 504].includes(response.status));
			const body = await response.text();
			if (!body.trim()) throw failure("服务返回空响应，可能仍在启动或重启，请稍后重试", true);
			try { return JSON.parse(body); }
			catch (_error) { throw failure("服务返回非 JSON 或不完整的响应，请稍后重试", true); }
		}

		function rpc(method, args, sessionId, requestOptions) {
			const payload = Object.assign({}, args || {});
			if (sessionId) payload.sessionId = sessionId;
			const request = {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload)
			};
			if (requestOptions && requestOptions.signal) request.signal = requestOptions.signal;
			if (requestOptions && requestOptions.keepalive === true) request.keepalive = true;
			return fetch("/api/dsh-tavern/" + method, request).then(readTavernJsonResponse).then(function (result) {
				tavernRuntimeGenerationMonitor.observe(result && result.runtimeGeneration);
				if (!result || !result.ok) throw new Error(result && result.error ? result.error : "操作失败");
				return result;
			});
		}

		function rpcWithTimeout(method, args, sessionId) {
			const controller = new AbortController();
			const timer = window.setTimeout(function () { controller.abort(); }, 15000);
			return rpc(method, args, sessionId, { signal: controller.signal }).catch(function (error) {
				if (controller.signal.aborted) throw new Error("读取超时，请重新读取");
				throw error;
			}).finally(function () { window.clearTimeout(timer); });
		}

		function worldBookCatalogDiagnostic(result) {
			const diagnostics = result && Array.isArray(result.diagnostics) ? result.diagnostics : [];
			if (!diagnostics.length) return "";
			return "已跳过 " + diagnostics.length + " 个损坏资源：\n" + diagnostics.map(function (item) { return String(item.path || "未知资源") + "：" + String(item.message || "无法读取"); }).join("\n");
		}

		function notifyTavernDataChanged(kinds, source) {
			const changedKinds = Array.isArray(kinds) ? kinds.filter(Boolean) : [];
			window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed", { detail: { kinds: changedKinds, source: String(source || "") } }));
		}

		function tavernDataChangeAffects(event, kinds, owner) {
			const detail = event && event.detail && typeof event.detail === "object" ? event.detail : null;
			if (!detail || !Array.isArray(detail.kinds) || detail.kinds.length === 0) return true;
			if (owner && detail.source === owner) return false;
			const expected = Array.isArray(kinds) ? kinds : [];
			return detail.kinds.indexOf("*") >= 0 || expected.some(function (kind) { return detail.kinds.indexOf(kind) >= 0; });
		}

		// @include modules/library-refresh.js

		function openPlayChatDebugWorkspace(sourceSessionId, turn) {
			return new Promise(function (resolve, reject) {
				let settled = false;
				const timer = window.setTimeout(function () {
					if (settled) return;
					settled = true;
					reject(new Error("卡片工作台没有响应，请重试"));
				}, 15000);
				function finish(callback, value) {
					if (settled) return;
					settled = true;
					window.clearTimeout(timer);
					callback(value);
				}
				window.dispatchEvent(new CustomEvent("dsh-tavern-debug-play-chat", { detail: {
					sourceSessionId: sourceSessionId,
					turn: Number(turn),
					resolve: function (value) { finish(resolve, value); },
					reject: function (error) { finish(reject, error); }
				} }));
			});
		}

		// @include modules/live-tavern-view.js

		function isMissingTavernCardError(value) {
			return /^人物卡不存在:\s*/.test(String(value && value.message || value || ""));
		}

		const liveTavernView = createLiveTavernViewModule({
			loadTimeoutMs: 10000,
			timeoutRetryDelayMs: 5000,
			load: function (sessionId, request) { return rpc("getSession", {}, sessionId, request); },
			shouldPoll: function (view) { return !!(view && view.activity && view.activity.busy); },
			pollWhileBusy: false,
			isTerminalError: isMissingTavernCardError
		});
		function coordinationView(result, sessionId) {
			const sync = result && result.sync ? result.sync : (result || {});
			const tasks = sync.tasks && typeof sync.tasks === "object" ? sync.tasks : {};
			const background = tasks.background || null;
			return {
				runtimeGeneration: String(sync.runtimeGeneration || ""),
				liveSession: sync.liveSession === true,
				requestMode: sync.requestMode === "sillytavern" ? "sillytavern" : "dsh",
				cardPath: String(sync.cardPath || ""),
				cardName: String(sync.cardName || ""),
				activity: background ? { phase: background.status === "queued" ? "pending" : (background.status === "succeeded" ? "idle" : background.status), busy: background.busy === true, role: background.kind, operationId: background.operationId, updatedAt: background.updatedAt } : (sync.activity || null),
				task: tasks.candidate || sync.task || null,
				tasks: tasks,
				mailboxVersion: Number(sync.mailboxVersion) || 0,
				projectionRevision: Number(sync.projectionRevision) || 0
			};
		}

		let tavernSessionSignals;

		function createTavernCoordinationEventModule(options) {
			if (!options || typeof options.connect !== "function") throw new Error("Tavern Coordination Event 缺少 SSE adapter");
			const records = new Map();
			function initialState() { return { phase: "connecting", view: null, error: "", updatedAt: 0 }; }
			function recordFor(sessionId) {
				const id = String(sessionId || "");
				if (!records.has(id)) records.set(id, { id: id, state: initialState(), listeners: new Set(), connection: null });
				return records.get(id);
			}
			function publish(record, state) {
				record.state = state;
				record.listeners.forEach(function (listener) { listener(state); });
			}
			function disconnect(record) {
				if (record.connection && typeof record.connection.close === "function") record.connection.close();
				record.connection = null;
			}
			function connect(record) {
				if (record.listeners.size === 0 || record.connection !== null) return;
				record.connection = options.connect(record.id, {
					message: function (view) {
						publish(record, { phase: "ready", view: view || null, error: "", updatedAt: Date.now() });
						if (typeof options.onView === "function") options.onView(record.id, view || null);
					},
					error: function (error) {
						publish(record, { phase: "retrying", view: record.state.view, error: String(error && error.message || ""), updatedAt: record.state.updatedAt });
					}
				});
				// Session Signals are lossy wake-ups, not state. Always establish the
				// coordination view from its authoritative source after (re)connecting.
				if (record.connection && typeof record.connection.refresh === "function") void record.connection.refresh();
			}
			function invalidate(sessionId) {
				const targets = sessionId === undefined || sessionId === null || sessionId === "" ? Array.from(records.values()) : [recordFor(sessionId)];
				targets.forEach(function (record) {
					if (record.connection && typeof record.connection.refresh === "function") {
						void record.connection.refresh();
						return;
					}
					disconnect(record);
					if (record.listeners.size > 0) {
						publish(record, { phase: "connecting", view: record.state.view, error: "", updatedAt: record.state.updatedAt });
						connect(record);
					}
				});
			}
			return {
				getSnapshot: function (sessionId) { return recordFor(sessionId).state; },
				setView: function (sessionId, view) {
					const record = recordFor(sessionId);
					publish(record, { phase: "ready", view: view || null, error: "", updatedAt: Date.now() });
				},
				subscribe: function (sessionId, listener) {
					const record = recordFor(sessionId);
					record.listeners.add(listener);
					listener(record.state);
					connect(record);
					return function () {
						record.listeners.delete(listener);
						if (record.listeners.size === 0) disconnect(record);
					};
				},
				invalidate: invalidate
			};
		}

		const coordinatedCardPaths = new Map();
		const tavernCoordination = createTavernCoordinationEventModule({
			onView: function (sessionId, view) {
				liveTavernView.invalidate(sessionId);
				const cardPath = String(view && view.cardPath || "");
				const observed = coordinatedCardPaths.has(sessionId);
				const previous = observed ? coordinatedCardPaths.get(sessionId) : cardPath;
				coordinatedCardPaths.set(sessionId, cardPath);
				if (observed && previous === "" && cardPath !== "") notifyTavernDataChanged(["cards", "sessions"], "coordination");
			},
			connect: function (sessionId, handlers) {
				let active = true;
				let loading = false;
				let reloadRequested = false;
				async function load() {
					if (!active) return;
					if (loading) { reloadRequested = true; return; }
					loading = true;
					try {
						const result = await rpc("syncSession", { kind: "candidate" }, sessionId);
						if (active) handlers.message(coordinationView(result, sessionId));
					} catch (error) {
						if (active) handlers.error(error);
					} finally {
						loading = false;
						if (active && reloadRequested) { reloadRequested = false; void load(); }
					}
				}
				const stop = tavernSessionSignals.subscribe(sessionId, "tavern-state", function (signal) {
					if (signal && signal.snapshot) {
						handlers.message(coordinationView(signal.snapshot, sessionId));
						return;
					}
					void load();
				}, handlers.error, function () {
					void load();
				});
				return { close: function () { active = false; stop(); }, refresh: load };
			}
		});

		function describeTavernActivity(value) {
			const activity = value && typeof value === "object" ? value : {};
			const busy = activity.busy === true;
			const role = String(activity.role || "");
			let label = "生成候选项";
			let blockReason = "";
			if (busy && role === "candidate") { label = "生成中…"; blockReason = "正在生成候选项，请稍候…"; }
			else if (busy) { label = "后台结算中…"; blockReason = "后台结算中，请稍候…"; }
			return { phase: String(activity.phase || "idle"), busy: busy, role: role, label: label, blockReason: blockReason };
		}

		function useLiveTavernView(sessionId, revision) {
			const [state, setState] = React.useState(function () { return liveTavernView.getSnapshot(sessionId); });
			React.useEffect(function () { return liveTavernView.subscribe(sessionId, setState); }, [sessionId]);
			React.useEffect(function () { liveTavernView.invalidate(sessionId); }, [sessionId, revision]);
			return state;
		}

		function useTavernCoordination(sessionId, revision) {
			const [state, setState] = React.useState(function () { return tavernCoordination.getSnapshot(sessionId); });
			React.useEffect(function () { return tavernCoordination.subscribe(sessionId, setState); }, [sessionId]);
			React.useEffect(function () { tavernCoordination.invalidate(sessionId); }, [sessionId, revision]);
			return state;
		}

		function createPlayWorkspaceResolver(options) {
			for (const method of ["currentWorkspaceId", "resourceRoot", "createWorkspace"]) {
				if (!options || typeof options[method] !== "function") throw new Error("Play Workspace Resolver 缺少 " + method + " adapter");
			}
			let fallbackPromise = null;
			return async function () {
				const currentWorkspaceId = String(options.currentWorkspaceId() || "");
				if (currentWorkspaceId) return currentWorkspaceId;
				if (!fallbackPromise) {
					fallbackPromise = (async function () {
						const root = await options.resourceRoot();
						const created = await options.createWorkspace({ path: root.path });
						if (!created || !created.workspaceId) throw new Error("无法创建 DSH Tavern Workspace");
						return created.workspaceId;
					})();
					fallbackPromise.catch(function () { fallbackPromise = null; });
				}
				return fallbackPromise;
			};
		}

		function createSessionListRecoveryModule(options) {
			for (const method of ["summary", "binding", "refresh", "open"]) {
				if (!options || typeof options[method] !== "function") throw new Error("Session List Recovery 缺少 " + method + " adapter");
			}
			const now = typeof options.now === "function" ? options.now : Date.now;
			const sleep = typeof options.sleep === "function" ? options.sleep : function (ms) { return new Promise(function (resolve) { window.setTimeout(resolve, ms); }); };
			const timeoutMs = Math.max(100, Number(options.timeoutMs || 8000));
			const retryDelays = Array.isArray(options.retryDelays) && options.retryDelays.length ? options.retryDelays : [0, 150, 350, 700, 1200, 1800, 2500];
			const isUnknownSession = typeof options.isUnknownSession === "function" ? options.isUnknownSession : function (error) {
				return /sessions\.select: unknown session/i.test(String(error && error.message || error || ""));
			};
			const active = new Map();

			function ready(sessionId) {
				return Boolean(options.summary(sessionId) && options.binding(sessionId));
			}

			async function synchronize(sessionId) {
				const expiresAt = now() + timeoutMs;
				let attempt = 0;
				while (!ready(sessionId) && now() < expiresAt) {
					try { await options.refresh(); }
					catch (error) {
						// An aborted or temporarily failed list request is recoverable here. The
						// deadline still bounds retries when the DSH service is genuinely down.
					}
					if (ready(sessionId)) return;
					const remaining = expiresAt - now();
					if (remaining <= 0) break;
					const delay = Math.max(0, Number(retryDelays[Math.min(attempt, retryDelays.length - 1)]) || 0);
					attempt += 1;
					await sleep(Math.min(delay, remaining));
				}
				if (!ready(sessionId)) throw new Error("DSH Session 列表同步超时，请刷新页面后重试：" + sessionId);
			}

			function wait(sessionId) {
				if (ready(sessionId)) return Promise.resolve();
				if (active.has(sessionId)) return active.get(sessionId);
				const task = synchronize(sessionId).finally(function () { active.delete(sessionId); });
				active.set(sessionId, task);
				return task;
			}

			async function open(sessionId) {
				try { options.open(sessionId); return; }
				catch (error) { if (!isUnknownSession(error)) throw error; }
				await wait(sessionId);
				options.open(sessionId);
			}

			return Object.freeze({ ready: ready, wait: wait, open: open });
		}

		// alpha.2 exposes Session creation and preset selection on separate controllers.
		function createConversationHostAdapter(ctx) {
			let injectedAgentPresets;
			if (ctx && typeof ctx.inject === "function") {
				ctx.inject(["remote.agentPresets"], function (scope) {
					const service = scope.remote.agentPresets;
					injectedAgentPresets = service;
					return function () {
						if (injectedAgentPresets === service) injectedAgentPresets = undefined;
					};
				});
			}
			return Object.freeze({
				workspaceId: function (snapshot, sessionId) {
					const items = snapshot.items || [];
					const owner = sessionId && items.find(function (item) { return (item.sessionIds || []).includes(sessionId); });
					return (owner || items[0] || {}).workspaceId || "";
				},
				// uiWorkspace.connectWorkspace may reuse a blank Session that already has a
				// Tavern opening and a locked preset. New conversations must have their own Session.
				connectWorkspace: function (workspaceId) { return ctx.sessions.create({ workspaceId: workspaceId }); },
				forkSession: function (sessionId) {
					if (!ctx.sessions || typeof ctx.sessions.fork !== "function") throw new Error("当前 DSH 版本不支持原生分叉，请升级 DSH 后重试");
					return ctx.sessions.fork({ sessionId: sessionId, increaseTitle: true });
				},
				ensurePreset: async function (sessionId, request) {
					// Select before writing the opening; the Session stream publishes preset state.
					// Keep Tavern's private Skill roots; its preset also mounts Cordis tools for card workbenches.
					const agentPreset = "tavern";
					let agentPresets = injectedAgentPresets;
					if (!agentPresets) {
						try {
							agentPresets = ctx.remote && ctx.remote.agentPresets;
						} catch (error) {
							if (!error || !/without inject/.test(String(error.message || error))) throw error;
						}
					}
					if (agentPresets && typeof agentPresets.select === "function") {
						const result = await agentPresets.select(sessionId, agentPreset);
						if (!result.ok) throw new Error(result.error && result.error.message || "无法切换到酒馆模式");
						return;
					}
					// DSHA 1.1 exposes the same host operation on the authenticated
					// connection API and wraps the result in the request envelope.
					const legacyAgentPresets = ctx.connection && ctx.connection.api && ctx.connection.api.agentPresets;
					if (!legacyAgentPresets || typeof legacyAgentPresets.select !== "function") throw new Error("当前 DSHA 版本不支持切换酒馆模式，请升级 DSHA 后重试");
					const response = await legacyAgentPresets.select({ sessionId: sessionId, agentPreset: agentPreset });
					const result = response && response.result;
					if (!result || !result.ok) throw new Error(result && result.error && result.error.message || "无法切换到酒馆模式");
				}
			});
		}

		function createConversationLifecycleModule(options) {
			for (const method of ["archiveCurrent", "resolveWorkspace", "connectWorkspace", "waitForSession", "ensurePreset", "createChat", "rememberPending", "finishOpen"]) {
				if (!options || typeof options[method] !== "function") throw new Error("Conversation Lifecycle 缺少 " + method + " adapter");
			}
			return {
				start: async function (request) {
					let phase = "清理当前空白对话";
					try {
						const preparedSessionId = typeof request.preparedSessionId === "string" ? request.preparedSessionId : "";
						await options.archiveCurrent(preparedSessionId);
						let sessionId = preparedSessionId;
						if (!sessionId) {
							phase = request.kind === "card" ? "准备卡片工作区" : "准备游玩工作区";
							const workspaceId = await options.resolveWorkspace(request);
							phase = "创建 DSH Session";
							sessionId = await options.connectWorkspace(workspaceId);
						}
						phase = "等待 DSH Session 就绪";
						await options.waitForSession(sessionId);
						phase = "切换到酒馆模式";
						await options.ensurePreset(sessionId, request);
						phase = request.kind === "card" ? "创建卡片工作台对话" : "写入人物卡开场白";
						await options.createChat(request, sessionId);
						phase = "同步并打开 DSH Session";
						const pending = Object.assign({}, request.pending || {}, { sessionId: sessionId, targetMode: request.targetMode });
						options.rememberPending(pending);
						await options.finishOpen(pending);
						return { sessionId: sessionId, pending: pending };
					} catch (error) {
						const failure = error instanceof Error ? error : new Error(String(error || "创建对话失败"));
						failure.phase = phase;
						throw failure;
					}
				}
			};
		}

		function createConversationPrewarmModule(options) {
			for (const method of ["sessionIds", "resolveWorkspace", "connectWorkspace", "archiveSession"]) {
				if (!options || typeof options[method] !== "function") throw new Error("Conversation Prewarm 缺少 " + method + " adapter");
			}
			const now = typeof options.now === "function" ? options.now : Date.now;
			const report = typeof options.report === "function" ? options.report : function () {};
			let active = null;

			function clean(record) {
				if (!record || record.cleanupScheduled) return;
				record.cleanupScheduled = true;
				record.promise.then(async function (lease) {
					if (!lease.created) return;
					try { await options.archiveSession(lease.sessionId); }
					catch (error) { report({ phase: "cleanup-failed", key: record.key, sessionId: lease.sessionId, error: error }); }
				}, function () {});
			}

			function cancel() {
				const record = active;
				active = null;
				clean(record);
			}

			function begin(request) {
				cancel();
				const key = String(request && request.key || "");
				const known = new Set(options.sessionIds());
				const startedAt = now();
				const record = { key: key, cleanupScheduled: false, promise: null };
				record.promise = (async function () {
					const workspaceId = await options.resolveWorkspace(request || {});
					const sessionId = await options.connectWorkspace(workspaceId);
					const lease = { sessionId: sessionId, created: !known.has(sessionId) };
					report({ phase: "ready", key: key, sessionId: sessionId, created: lease.created, elapsedMs: Math.max(0, now() - startedAt) });
					return lease;
				})();
				record.promise.catch(function (error) { report({ phase: "failed", key: key, elapsedMs: Math.max(0, now() - startedAt), error: error }); });
				active = record;
				return record.promise;
			}

			async function claim(key) {
				const record = active;
				if (!record || record.key !== String(key || "")) return "";
				active = null;
				return (await record.promise).sessionId;
			}

			return Object.freeze({ begin: begin, claim: claim, cancel: cancel });
		}

		function isIgnoredTavernError(value) {
			return /failed to fetch/i.test(String(value && value.message || value || "").trim());
		}

		const tavernErrorHub = (function () {
			const storageKey = "dsh-tavern:error-history:v1";
			function loadItems() {
				try {
					const value = JSON.parse(window.sessionStorage.getItem(storageKey) || "[]");
					return Array.isArray(value) ? value.filter(function (item) {
						return item && typeof item.id === "string" && typeof item.source === "string" && typeof item.message === "string";
					}).slice(0, 1) : [];
				} catch (_) { return []; }
			}
			let items = loadItems();
			let sequence = Date.now();
			const listeners = new Set();
			function emit() {
				try { window.sessionStorage.setItem(storageKey, JSON.stringify(items)); } catch (_) {}
				listeners.forEach(function (listener) { listener(items.slice()); });
			}
			return {
				getSnapshot: function () { return items.slice(); },
				subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
				report: function (source, error) {
					if (isIgnoredTavernError(error)) return;
					const message = String(error && error.message || error || "").trim();
					if (!message) return;
					const scope = String(source || "DSH Tavern");
					const now = Date.now();
					const existing = items[0] && items[0].source === scope && items[0].message === message ? items[0] : null;
					if (existing) {
						items = [{ id: existing.id, source: scope, message: message, firstAt: existing.firstAt, lastAt: now, count: existing.count + 1 }];
					} else {
						items = [{ id: "tavern-error-" + (++sequence), source: scope, message: message, firstAt: now, lastAt: now, count: 1 }];
					}
					emit();
				},
				dismiss: function (id) { items = items.filter(function (item) { return item.id !== id; }); emit(); },
				resolve: function (source, beforeAt) {
					if (!items[0] || items[0].source !== String(source || "")) return;
					const cutoff = Number(beforeAt);
					if (Number.isFinite(cutoff) && Number(items[0].lastAt) >= cutoff) return;
					items = [];
					emit();
				},
				clear: function () { items = []; emit(); }
			};
		})();

		function usePersistentError(source) {
			const [error, setLocalError] = React.useState("");
			const lastReported = React.useRef("");
			const setError = React.useCallback(function (value) {
				const message = String(value && value.message || value || "");
				const visible = isIgnoredTavernError(message) ? "" : message;
				setLocalError(visible);
				if (!visible) tavernErrorHub.resolve(source);
				else if (visible !== lastReported.current) tavernErrorHub.report(source, visible);
				lastReported.current = visible;
			}, [source]);
			return [error, setError];
		}

		function formatErrorTime(ts) {
			const date = new Date(ts);
			return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0") + ":" + String(date.getSeconds()).padStart(2, "0");
		}

		function copyErrorText(text) {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
				navigator.clipboard.writeText(text).catch(function () { window.prompt("复制错误信息", text); });
			} else window.prompt("复制错误信息", text);
		}

		function TavernErrorCenter() {
			const [items, setItems] = React.useState(tavernErrorHub.getSnapshot());
			React.useEffect(function () { return tavernErrorHub.subscribe(setItems); }, []);
			if (!items.length) return null;
			const h = React.createElement;
			const item = items[0];
			const text = "[" + formatErrorTime(item.lastAt) + "] " + item.source + (item.count > 1 ? "（重复 " + item.count + " 次）" : "") + "\n" + item.message;
			return h("section", { className: "dsh-tavern-error-center", role: "region", "aria-label": "DSH Tavern 错误记录" },
				h("div", { className: "dsh-tavern-error-center-head" }, h("span", null, "最新错误"), h("button", { className: "dsh-tavern-btn", onClick: function () { copyErrorText(text); } }, "复制"), h("button", { className: "dsh-tavern-btn", onClick: tavernErrorHub.clear }, "清除")),
				h("div", { className: "dsh-tavern-error-list" }, h("article", { className: "dsh-tavern-error-item", key: item.id },
					h("div", { className: "dsh-tavern-error-meta" }, h("span", null, item.source), item.count > 1 ? h("span", null, "重复 " + item.count + " 次") : null, h("time", { dateTime: new Date(item.lastAt).toISOString() }, formatErrorTime(item.lastAt))),
					h("div", { className: "dsh-tavern-error-message" }, item.message)
				))
			);
		}


		const tavernSessionModes = { values: {}, listeners: new Set() };
		function publishSessionModes(items) {
			const next = {};
			(items || []).forEach(function (item) { next[item.sessionId] = item.mode || "story"; });
			tavernSessionModes.values = next;
			tavernSessionModes.listeners.forEach(function (listener) { listener(next); });
		}
		function publishSessionMode(sessionId, mode) {
			const next = Object.assign({}, tavernSessionModes.values, { [sessionId]: mode });
			tavernSessionModes.values = next;
			tavernSessionModes.listeners.forEach(function (listener) { listener(next); });
		}
		function useTavernSessionMode(sessionId) {
			const [values, setValues] = React.useState(tavernSessionModes.values);
			React.useEffect(function () { tavernSessionModes.listeners.add(setValues); return function () { tavernSessionModes.listeners.delete(setValues); }; }, []);
			return values[sessionId] || "";
		}
		function escapeOpeningPreviewText(value) {
			return String(value || "")
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/\"/g, "&quot;")
				.replace(/'/g, "&#39;");
		}

		function isHtmlOpening(value) {
			return /<\/?[a-z][^>]*>/i.test(String(value || ""));
		}

		function tavernStaticAssetUrl(value) {
			const source = String(value || "");
			return /^https:\/\//i.test(source) ? "/api/dsh-tavern/static-assets?url=" + encodeURIComponent(source) : source;
		}

		function rewriteTavernStaticMarkup(value) {
			function replace(_match, prefix, quote, url) { return prefix + quote + tavernStaticAssetUrl(url) + quote; }
			return String(value || "")
				.replace(/(\b(?:src|poster)\s*=\s*)(["'])(https:\/\/[^"']+)\2/gi, replace)
				.replace(/(<link\b[^>]*\bhref\s*=\s*)(["'])(https:\/\/[^"']+)\2/gi, replace)
				.replace(/(\s(?:src|poster)\s*=\s*)(https:\/\/[^\s"'`<>]+)/gi, function (_match, prefix, url) { return prefix + '"' + tavernStaticAssetUrl(url) + '"'; })
				.replace(/(<link\b[^>]*\shref\s*=\s*)(https:\/\/[^\s"'`<>]+)/gi, function (_match, prefix, url) { return prefix + '"' + tavernStaticAssetUrl(url) + '"'; })
				.replace(/(url\(\s*)(["']?)(https:\/\/[^"')\s]+)\2(\s*\))/gi, function (_match, prefix, quote, url, suffix) { return prefix + quote + tavernStaticAssetUrl(url) + quote + suffix; })
				.replace(/(\bfrom\s*|\bimport\s*)(["'])(https:\/\/[^"']+)\2/g, replace)
				.replace(/(\bimport\s*\(\s*)(["'])(https:\/\/[^"']+)\2/g, replace);
		}

		function tavernStaticAssetShim() {
			return '<script data-dsh-tavern-static-cache>(function(){function proxy(value){var source=String(value||"");return /^https:\\/\\//i.test(source)?"/api/dsh-tavern/static-assets?url="+encodeURIComponent(source):source;}function css(value){return String(value||"").replace(/url\\(\\s*(["\\\']?)(https:\\/\\/[^"\\\')\\s]+)\\1\\s*\\)/gi,function(_,quote,url){return "url("+quote+proxy(url)+quote+")";});}window.__dshTavernStaticAssetUrl=proxy;var nativeSet=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){var key=String(name||"").toLowerCase(),tag=String(this.tagName||"").toLowerCase();if((key==="src"||key==="poster"||(key==="href"&&tag==="link"))&&/^https:\\/\\//i.test(String(value||"")))value=proxy(value);else if(key==="style")value=css(value);return nativeSet.call(this,name,value);};[["HTMLImageElement","src"],["HTMLScriptElement","src"],["HTMLSourceElement","src"],["HTMLVideoElement","src"],["HTMLVideoElement","poster"],["HTMLAudioElement","src"],["HTMLIFrameElement","src"],["HTMLLinkElement","href"]].forEach(function(row){var Type=window[row[0]],descriptor=Type&&Object.getOwnPropertyDescriptor(Type.prototype,row[1]);if(!descriptor||!descriptor.set||!descriptor.get)return;try{Object.defineProperty(Type.prototype,row[1],{configurable:descriptor.configurable,enumerable:descriptor.enumerable,get:descriptor.get,set:function(value){return descriptor.set.call(this,proxy(value));}});}catch(e){}});if(window.CSSStyleDeclaration&&CSSStyleDeclaration.prototype.setProperty){var nativeProperty=CSSStyleDeclaration.prototype.setProperty;CSSStyleDeclaration.prototype.setProperty=function(name,value,priority){return nativeProperty.call(this,name,css(value),priority);};}new MutationObserver(function(records){records.forEach(function(record){var node=record.target;if(!node||node.nodeType!==1)return;["src","poster"].forEach(function(name){var value=node.getAttribute&&node.getAttribute(name);if(/^https:\\/\\//i.test(String(value||"")))nativeSet.call(node,name,proxy(value));});if(String(node.tagName||"").toLowerCase()==="link"){var href=node.getAttribute("href");if(/^https:\\/\\//i.test(String(href||"")))nativeSet.call(node,"href",proxy(href));}var style=node.getAttribute&&node.getAttribute("style");if(style&&/https:\\/\\//i.test(style))nativeSet.call(node,"style",css(style));});}).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:["src","href","poster","style"]});})();<\/script>';
		}

		function tavernIconDependencies() {
			return '<link rel="stylesheet" data-dsh-tavern-icons href="/api/dsh-tavern/vendor/runtime-assets/fontawesome/css/all.min.css">';
		}

		const tavernHostStylesheetBridges = new WeakMap();
		function bundledTavernStylesheetHref(value) {
			const source = String(value || "");
			const href = source.split(/[?#]/)[0];
			const cdnjs = /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/[^/]+\/css\/all(?:\.min)?\.css$/i.test(href);
			const jsdelivr = /^https:\/\/(?:cdn|testingcf)\.jsdelivr\.net\/npm\/@fortawesome\/fontawesome-free@[^/]+\/css\/all(?:\.min)?\.css$/i.test(href);
			if (cdnjs || jsdelivr) return "/api/dsh-tavern/vendor/runtime-assets/fontawesome/css/all.min.css";
			return source;
		}

		function createTavernHostStylesheetBridge(options) {
			const hostWindow = options && options.window || window;
			let entry = tavernHostStylesheetBridges.get(hostWindow);
			if (entry) {
				entry.references += 1;
				return function () { release(); };
			}
			const Link = hostWindow && hostWindow.HTMLLinkElement;
			const prototype = Link && Link.prototype;
			const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "href");
			if (!descriptor || descriptor.configurable === false || typeof descriptor.set !== "function") return function () {};
			const nativeSet = descriptor.set;
			const bridgedSet = function (value) { return nativeSet.call(this, bundledTavernStylesheetHref(value)); };
			Object.defineProperty(prototype, "href", Object.assign({}, descriptor, { set: bridgedSet }));
			entry = { prototype: prototype, descriptor: descriptor, bridgedSet: bridgedSet, references: 1 };
			tavernHostStylesheetBridges.set(hostWindow, entry);
			function release() {
				if (!entry || entry.references <= 0) return;
				entry.references -= 1;
				if (entry.references > 0) return;
				const current = Object.getOwnPropertyDescriptor(entry.prototype, "href");
				if (current && current.set === entry.bridgedSet) Object.defineProperty(entry.prototype, "href", entry.descriptor);
				tavernHostStylesheetBridges.delete(hostWindow);
			}
			return release;
		}

		function createTavernHostArtifactScope(options) {
			const hostDocument = options && options.document;
			const roots = [hostDocument && hostDocument.head, hostDocument && hostDocument.body].filter(Boolean);
			const baselines = roots.map(function (root) {
				return { root: root, nodes: new Set(Array.from(root.childNodes || root.children || [])) };
			});
			let disposed = false;
			return Object.freeze({
				dispose: function () {
					if (disposed) return;
					disposed = true;
					for (const baseline of baselines) {
						const current = Array.from(baseline.root.childNodes || baseline.root.children || []);
						for (const node of current) {
							if (baseline.nodes.has(node)) continue;
							if (node && typeof node.remove === "function") node.remove();
							else if (baseline.root && typeof baseline.root.removeChild === "function") baseline.root.removeChild(node);
						}
					}
				}
			});
		}

		const TAVERN_CARD_PHONE_HOST = '[id^="improved-phone-shadow-host-"]';
		const TAVERN_CARD_PHONE_BUTTON = '[id^="improved-phone-floating-button-"]';
		const TAVERN_CARD_PHONE_PARKING = '[data-dsh-tavern-card-app-parking]';
		const TAVERN_CARD_PHONE_SESSION = 'data-dsh-tavern-card-app-session';
		const TAVERN_CARD_PHONE_CSS = '/api/dsh-tavern/vendor/runtime-assets/fontawesome/css/all.min.css';
		const TAVERN_CARD_PHONE_FONTS = '/api/dsh-tavern/vendor/runtime-assets/fontawesome/webfonts/';
		let tavernCardIconCssPromise = null;
		function loadTavernCardIconCss() {
			if (!tavernCardIconCssPromise) tavernCardIconCssPromise = window.fetch(TAVERN_CARD_PHONE_CSS).then(function (response) {
				if (!response.ok) throw new Error("人物卡图标样式加载失败（HTTP " + String(response.status) + "）");
				return response.text();
			}).then(function (css) {
				return String(css).replace(/url\((['"]?)\.\.\/webfonts\//g, "url($1" + TAVERN_CARD_PHONE_FONTS);
			}).catch(function (error) {
				tavernCardIconCssPromise = null;
				throw error;
			});
			return tavernCardIconCssPromise;
		}
		function ensureTavernCardIconFonts(hostDocument) {
			if (!hostDocument || !hostDocument.head || typeof hostDocument.createElement !== "function") return;
			if (hostDocument.querySelector && hostDocument.querySelector('style[data-dsh-tavern-card-app-fonts]')) return;
			const fonts = hostDocument.createElement("style");
			fonts.setAttribute("data-dsh-tavern-card-app-fonts", "fontawesome");
			fonts.textContent = '@font-face{font-family:"Font Awesome 6 Free";font-style:normal;font-weight:900;font-display:block;src:url("' + TAVERN_CARD_PHONE_FONTS + 'fa-solid-900.woff2") format("woff2")}\n'
				+ '@font-face{font-family:"Font Awesome 6 Free";font-style:normal;font-weight:400;font-display:block;src:url("' + TAVERN_CARD_PHONE_FONTS + 'fa-regular-400.woff2") format("woff2")}\n'
				+ '@font-face{font-family:"Font Awesome 6 Brands";font-style:normal;font-weight:400;font-display:block;src:url("' + TAVERN_CARD_PHONE_FONTS + 'fa-brands-400.woff2") format("woff2")}';
			hostDocument.head.appendChild(fonts);
		}
		function ensureTavernCardAppParking(hostDocument) {
			if (!hostDocument || !hostDocument.body || typeof hostDocument.createElement !== "function") return null;
			let parking = hostDocument.querySelector && hostDocument.querySelector(TAVERN_CARD_PHONE_PARKING);
			if (parking) return parking;
			parking = hostDocument.createElement("div");
			parking.setAttribute("data-dsh-tavern-card-app-parking", "");
			parking.setAttribute("aria-hidden", "true");
			parking.hidden = true;
			hostDocument.body.appendChild(parking);
			return parking;
		}
		function createTavernCardAppPresence(options) {
			const hostWindow = options && options.window || window;
			const notify = options && typeof options.onChange === "function" ? options.onChange : function () {};
			const listeners = new Set();
			const schedule = options && options.setTimeout || (typeof hostWindow.setTimeout === "function" ? hostWindow.setTimeout.bind(hostWindow) : function () { return null; });
			const cancel = options && options.clearTimeout || (typeof hostWindow.clearTimeout === "function" ? hostWindow.clearTimeout.bind(hostWindow) : function () {});
			const graceMs = Math.max(0, Number(options && options.graceMs) || 5000);
			let timer = null;
			let disposed = false;
			let state = Object.freeze({ visible: false, attached: false, recovering: false });
			function publish(next) {
				state = Object.freeze(next);
				notify(state);
				listeners.forEach(function (listener) { listener(); });
			}
			function cancelPending() { if (timer !== null) { cancel(timer); timer = null; } }
			function change(attached) {
				if (disposed) return;
				if (attached) {
					cancelPending();
					publish({ visible: true, attached: true, recovering: false });
					return;
				}
				if (!state.visible || state.recovering) return;
				publish({ visible: true, attached: false, recovering: true });
				timer = schedule(function () {
					timer = null;
					if (disposed || state.attached) return;
					publish({ visible: false, attached: false, recovering: false });
				}, graceMs);
			}
			return Object.freeze({
				change: change,
				inspect: function () { return state; },
				subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
				dispose: function () { disposed = true; cancelPending(); listeners.clear(); }
			});
		}
		const tavernCardAppPresence = createTavernCardAppPresence();
		function createTavernCardAppDock(options) {
			const hostDocument = options && options.document || document;
			const slot = options && options.slot;
			const sessionId = String(options && options.sessionId || "");
			const loadIconCss = options && options.loadIconCss || loadTavernCardIconCss;
			const notify = options && typeof options.onChange === "function" ? options.onChange : function () {};
			const Mutation = options && Object.prototype.hasOwnProperty.call(options, "MutationObserver") ? options.MutationObserver : (hostDocument.defaultView && hostDocument.defaultView.MutationObserver);
			const Resize = options && Object.prototype.hasOwnProperty.call(options, "ResizeObserver") ? options.ResizeObserver : (hostDocument.defaultView && hostDocument.defaultView.ResizeObserver);
			let attached = null;
			let originalParent = null;
			let originalNext = null;
			let originalStyle = null;
			let floatingButton = null;
			let floatingDisplay = null;
			let mutationObserver = null;
			let resizeObserver = null;
			const candidateObservers = new Map();
			let disposed = false;

			function hasPhoneLayout(host) {
				const root = host && host.shadowRoot;
				return Boolean(root && typeof root.querySelector === "function" && root.querySelector(".phone-wrapper"));
			}

			function clearCandidateObserver(host) {
				const observer = candidateObservers.get(host);
				if (observer) observer.disconnect();
				candidateObservers.delete(host);
			}

			function watchCandidate(host) {
				if (typeof Mutation !== "function" || !host || !host.shadowRoot || candidateObservers.has(host)) return;
				const observer = new Mutation(function () {
					if (hasPhoneLayout(host)) { clearCandidateObserver(host); scan(); }
				});
				observer.observe(host.shadowRoot, { childList: true, subtree: true });
				candidateObservers.set(host, observer);
			}

			function installShadowDependencies(host) {
				const root = host && host.shadowRoot;
				if (!root) return false;
				const staleIcons = typeof root.querySelectorAll === "function"
					? Array.from(root.querySelectorAll('link[href*="font-awesome"], link[href*="fontawesome"], link[data-dsh-tavern-card-app-icons], style[data-dsh-tavern-card-app-icons]'))
					: [];
				const icons = root.ownerDocument.createElement("style");
				icons.setAttribute("data-dsh-tavern-card-app-icons", "fontawesome");
				root.appendChild(icons);
				staleIcons.forEach(function (item) { if (item && item !== icons && typeof item.remove === "function") item.remove(); });
				Promise.resolve(loadIconCss()).then(function (css) {
					if (icons.isConnected === false) return;
					icons.textContent = String(css || "");
				}).catch(function (error) { console.warn("人物卡图标样式加载失败", error); });
				let layout = root.querySelector('[data-dsh-tavern-card-app-layout]');
				if (!layout) {
					layout = root.ownerDocument.createElement("style");
					layout.setAttribute("data-dsh-tavern-card-app-layout", "phone");
					layout.layoutStyle = true;
					layout.textContent = '.phone-wrapper{position:absolute!important;top:10px!important;left:50%!important;right:auto!important;transform:translateX(-50%) scale(var(--dsh-tavern-card-app-scale,1))!important;transform-origin:top center!important}.phone-drag-btn,.phone-charm{display:none!important}';
					root.appendChild(layout);
				}
				return true;
			}

			function resize() {
				if (!attached) return;
				const available = Math.max(240, Number(slot && slot.clientWidth) || 384) - 24;
				const scale = Math.min(1, available / 360);
				attached.style.setProperty("--dsh-tavern-card-app-scale", String(scale));
				attached.style.height = String(Math.ceil(620 * scale)) + "px";
			}

			function attach(host) {
				if (!host || host === attached) return false;
				const ownerSessionId = host.getAttribute && host.getAttribute(TAVERN_CARD_PHONE_SESSION);
				if (ownerSessionId && sessionId && ownerSessionId !== sessionId) return false;
				if (!hasPhoneLayout(host)) { watchCandidate(host); return false; }
				clearCandidateObserver(host);
				if (attached) restore();
				attached = host;
				if (sessionId && host.setAttribute) host.setAttribute(TAVERN_CARD_PHONE_SESSION, sessionId);
				originalParent = host.parentNode;
				originalNext = host.nextSibling;
				originalStyle = host.getAttribute && host.getAttribute("style");
				slot.appendChild(host);
				ensureTavernCardIconFonts(hostDocument);
				if (!installShadowDependencies(host)) { restore(); return false; }
				host.style.position = "relative";
				host.style.inset = "auto";
				host.style.zIndex = "auto";
				host.style.width = "100%";
				host.style.overflow = "hidden";
				const phoneKey = String(host.id || "").slice("improved-phone-shadow-host-".length);
				floatingButton = hostDocument.getElementById && hostDocument.getElementById("improved-phone-floating-button-" + phoneKey) || hostDocument.querySelector(TAVERN_CARD_PHONE_BUTTON);
				if (floatingButton) {
					floatingDisplay = floatingButton.style.display;
					floatingButton.style.display = "none";
				}
				resize();
				notify(true);
				return true;
			}

			function restore() {
				if (!attached) return;
				const host = attached;
				attached = null;
				if (originalStyle === null && host.removeAttribute) host.removeAttribute("style");
				else if (host.setAttribute) host.setAttribute("style", originalStyle || "");
				if (originalParent) {
					if (originalNext && originalNext.parentNode === originalParent && typeof originalParent.insertBefore === "function") originalParent.insertBefore(host, originalNext);
					else if (typeof originalParent.appendChild === "function") originalParent.appendChild(host);
				}
				if (floatingButton) floatingButton.style.display = floatingDisplay;
				originalParent = null; originalNext = null; originalStyle = null; floatingButton = null; floatingDisplay = null;
				notify(false);
			}

			function park() {
				if (!attached) return;
				const host = attached;
				attached = null;
				const parking = ensureTavernCardAppParking(hostDocument);
				if (parking && typeof parking.appendChild === "function") parking.appendChild(host);
				else host.style.display = "none";
				if (floatingButton) floatingButton.style.display = "none";
				originalParent = null; originalNext = null; originalStyle = null; floatingButton = null; floatingDisplay = null;
				notify(false);
			}

			function scan() {
				if (disposed || attached) return;
				const hosts = hostDocument.querySelectorAll(TAVERN_CARD_PHONE_HOST);
				for (let index = 0; index < hosts.length; index += 1) if (attach(hosts[index])) break;
			}

			scan();
			if (typeof Mutation === "function" && hostDocument.body) {
				mutationObserver = new Mutation(function () {
					if (attached && attached.isConnected === false) {
						attached = null; originalParent = null; originalNext = null; originalStyle = null;
						if (floatingButton) floatingButton.style.display = floatingDisplay;
						floatingButton = null; floatingDisplay = null;
						notify(false);
					}
					scan();
				});
				mutationObserver.observe(hostDocument.body, { childList: true, subtree: true });
			}
			if (typeof Resize === "function" && slot) {
				resizeObserver = new Resize(resize);
				resizeObserver.observe(slot);
			}
			return Object.freeze({
				open: function () { const button = hostDocument.querySelector(TAVERN_CARD_PHONE_BUTTON); if (button && typeof button.click === "function") button.click(); },
				inspect: function () { return { attached: Boolean(attached) }; },
				dispose: function () { disposed = true; if (mutationObserver) mutationObserver.disconnect(); if (resizeObserver) resizeObserver.disconnect(); candidateObservers.forEach(function (observer) { observer.disconnect(); }); candidateObservers.clear(); park(); }
			});
		}

		function tavernHelperMessageDependencies() {
			return tavernIconDependencies()
				+ '<script data-dsh-tavern-helper-dependency="tailwind" src="/api/dsh-tavern/vendor/runtime-assets/tailwind/index.global.js"><\/script>'
				+ '<script data-dsh-tavern-helper-dependency="jquery" src="/api/dsh-tavern/vendor/runtime-assets/jquery/jquery.min.js"><\/script>'
				+ '<script data-dsh-tavern-helper-dependency="jquery-ui" src="/api/dsh-tavern/vendor/runtime-assets/jquery-ui/jquery-ui.min.js"><\/script>'
				+ '<link rel="stylesheet" data-dsh-tavern-helper-dependency="jquery-ui-theme" href="/api/dsh-tavern/vendor/runtime-assets/jquery-ui/themes/base/theme.min.css">'
				+ '<script data-dsh-tavern-helper-dependency="jquery-ui-touch-punch" src="/api/dsh-tavern/vendor/runtime-assets/jquery-ui-touch-punch/jquery.ui.touch-punch.min.js"><\/script>'
				+ '<script data-dsh-tavern-helper-dependency="vue" src="/api/dsh-tavern/vendor/runtime-assets/vue/vue.runtime.global.prod.js"><\/script>'
				+ '<script data-dsh-tavern-helper-dependency="vue-router" src="/api/dsh-tavern/vendor/runtime-assets/vue-router/vue-router.global.prod.js"><\/script>'
				+ '<script data-dsh-tavern-helper-dependency="lodash" src="/api/dsh-tavern/vendor/runtime-assets/lodash/lodash.min.js"><\/script>';
		}

		function tavernHelperScriptDependencies() {
			return '<script data-dsh-tavern-helper-dependency="vue" src="/api/dsh-tavern/vendor/runtime-assets/vue/vue.runtime.global.prod.js"><\/script>'
				+ '<script data-dsh-tavern-helper-dependency="vue-router" src="/api/dsh-tavern/vendor/runtime-assets/vue-router/vue-router.global.prod.js"><\/script>'
				+ '<script data-dsh-tavern-helper-dependency="jquery" src="/api/dsh-tavern/vendor/runtime-assets/jquery/jquery.min.js"><\/script>'
				+ '<script data-dsh-tavern-helper-dependency="lodash" src="/api/dsh-tavern/vendor/runtime-assets/lodash/lodash.min.js"><\/script>';
		}

		const SILLYTAVERN_CSS_COMPAT = Object.freeze({
			version: "1.18.0",
			revision: "8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8",
			styles: Object.freeze([
				"webfonts/NotoSans/stylesheet.css",
				"webfonts/NotoSansMono/stylesheet.css",
				"css/fontawesome.min.css",
				"css/solid.min.css",
				"css/brands.min.css",
				"css/jquery-ui.min.css",
				"css/bright.min.css",
				"css/cropper.min.css",
				"css/toastr.min.css",
				"css/select2.min.css",
				"style.css",
				"css/st-tailwind.css",
				"css/rm-groups.css",
				"css/group-avatars.css",
				"css/toggle-dependent.css",
				"css/world-info.css",
				"css/extensions-panel.css",
				"css/select2-overrides.css",
				"css/mobile-styles.css",
				"css/macros.css"
			])
		});

		function sillyTavernCssCompatibilityDependencies() {
			const base = "https://cdn.jsdelivr.net/gh/SillyTavern/SillyTavern@" + SILLYTAVERN_CSS_COMPAT.revision + "/public/";
			const links = SILLYTAVERN_CSS_COMPAT.styles.map(function (path, index) {
				return '<link rel="stylesheet" data-dsh-sillytavern-css-compat="' + SILLYTAVERN_CSS_COMPAT.version + '" data-dsh-sillytavern-css-index="' + index + '" href="' + tavernStaticAssetUrl(base + path) + '">';
			}).join("");
			// Transparent frames use the embedder's color scheme, not ST's pale text/shadow defaults.
			// Keep these as overridable variables so explicit card and user themes still win.
			return links + '<style data-dsh-sillytavern-iframe-adapter>:root{--SmartThemeBodyColor:CanvasText;--shadowWidth:0}html,body{box-sizing:border-box!important;margin:0!important;padding:0!important;width:100%!important;min-width:0!important;max-width:none!important;height:auto!important;min-height:0!important;overflow:visible!important;background:transparent!important}body{position:static!important;display:block!important;color-scheme:inherit}body:before,body:after{pointer-events:none}img,video,svg,canvas{max-width:100%;height:auto}</style>';
		}


		function buildOpeningPreviewDocument(value) {
			const source = String(value || "");
			const content = rewriteTavernStaticMarkup(isHtmlOpening(source)
				? source
				: '<div class="dsh-tavern-greeting-text">' + escapeOpeningPreviewText(source) + '</div>');
			const preserveMixedTextLines = isHtmlOpening(source)
				? '<script data-dsh-preserve-lines>(function(){var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);var nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);nodes.forEach(function(node){if(node.nodeValue.indexOf("\\n")<0||!node.nodeValue.trim())return;var parent=node.parentElement;if(!parent||parent.closest("script,style,pre,textarea,code"))return;var span=document.createElement("span");span.className="dsh-tavern-preserve-lines";node.replaceWith(span);span.appendChild(node);});})();</script>'
				: '';
			return '<!doctype html><html><head><meta charset="utf-8">'
				+ '<meta name="viewport" content="width=device-width,initial-scale=1">'
				+ '<meta name="referrer" content="no-referrer">'
				+ '<meta http-equiv="Content-Security-Policy" content="default-src https: http: data: blob:; img-src https: http: data: blob:; media-src https: http: data: blob:; style-src \'unsafe-inline\' https: http:; font-src https: http: data:; script-src \'unsafe-inline\' \'unsafe-eval\' https: http: data: blob:; connect-src https: http: ws: wss: data: blob:; frame-src https: http: data: blob:; form-action https: http:">'
				+ '<base target="_blank">'
				+ '<style>html,body{margin:0;min-height:100%;background:#fff;color:#1f2328;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{box-sizing:border-box;padding:16px}.dsh-tavern-greeting-text,.dsh-tavern-preserve-lines{white-space:pre-wrap;overflow-wrap:anywhere}.dsh-tavern-greeting-text{font-size:14px;line-height:1.7}img,video{max-width:100%;height:auto}</style>'
				+ tavernIconDependencies() + tavernStaticAssetShim() + '</head><body>' + content + preserveMixedTextLines + '</body></html>';
		}

		function installTavernFrameVariableAliases() {
			window.getAllVariables = function () {
				// Read through the live Helper API so context updates and MVU view
				// observation use the same path. Each read already returns a copy.
				// Historical frames must not merge variables from later messages.
				return Object.assign({}, window.getVariables({ type: "chat" }), window.getVariables({ type: "message", message_id: window.getCurrentMessageId() }));
			};
		}

		function installTavernStatusRefresh(token) {
			// A legacy status may render only once. Observe reads, not card names or
			// source patterns; give event handlers and existing 4s polls time to catch up.
			const read = window.getVariables;
			const reads = new Map();
			const subscriptions = new Map();
			let timer = 0, requested = false, writes = false;
			["eventOn", "eventOff"].forEach(function (name) {
				const original = window[name];
				window[name] = function (event, handler) {
					if (event === "mag_variable_update_ended" || event === "MESSAGE_UPDATED") {
						if (!subscriptions.has(event)) subscriptions.set(event, new Set());
						if (name === "eventOn") subscriptions.get(event).add(handler);
						else subscriptions.get(event).delete(handler);
					}
					return original.apply(this, arguments);
				};
			});
			function optionFor(entry) {
				return entry.current ? Object.assign({}, entry.option, { message_id: window.getCurrentMessageId() }) : entry.option;
			}
			window.getVariables = function (option) {
				const normalized = Object.assign({ type: "message" }, option || {});
				const current = normalized.type === "message" && (normalized.message_id == null || normalized.message_id === window.getCurrentMessageId());
				if (current) delete normalized.message_id;
				const result = read.apply(this, arguments);
				reads.set(JSON.stringify([normalized, current]), { option: normalized, current: current, value: JSON.stringify(result) });
				return result;
			};
			// Reloading a read-only view is safe; never automatically replay Helper
			// mutations from a card that uses its UI as an execution surface.
			["replaceVariables", "updateVariablesWith", "setChatMessages"].forEach(function (name) {
				const original = window[name];
				if (typeof original !== "function") return;
				window[name] = function () { writes = true; return original.apply(this, arguments); };
			});
			addEventListener("message", function (event) {
				const data = event && event.data;
				if (event.source !== parent || !data || data.token !== token || data.type !== "dsh-tavern-helper-context-update" || timer || requested || writes) return;
				timer = setTimeout(function () {
					timer = 0;
					if (writes || requested || Array.from(subscriptions.values()).some(function (handlers) { return handlers.size > 0; })) return;
					const stale = Array.from(reads.values()).some(function (entry) { return JSON.stringify(read(optionFor(entry))) !== entry.value; });
					if (!stale) return;
					requested = true;
					parent.postMessage({ type: "dsh-tavern-status-stale", token: token }, "*");
				}, 5000);
			});
		}

		// Also used on runtime-report clones: presentation preferences must never become saved card styles.
		function restoreTavernFrameFontStyles(root) {
			const attribute = "data-dsh-tavern-font-original";
			const nodes = Array.from(root.querySelectorAll("[" + attribute + "]"));
			if (root.hasAttribute && root.hasAttribute(attribute)) nodes.unshift(root);
			nodes.forEach(function (node) {
				try {
					const saved = JSON.parse(node.getAttribute(attribute));
					["font-size", "line-height"].forEach(function (name, index) {
						if (node.style.getPropertyValue(name) !== saved.applied[index]) return;
						const original = saved.original[index];
						if (original[0]) node.style.setProperty(name, original[0], original[1]);
						else node.style.removeProperty(name);
					});
					if (!saved.hadStyle && !node.getAttribute("style")) node.removeAttribute("style");
				} catch (_) {}
				node.removeAttribute(attribute);
			});
		}

		function installTavernFrameFonts(token, restore) {
			let fontSize = 14, scheduled = false, disposed = false;
			const observer = new MutationObserver(schedule);
			function observe() { observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["style", "class", "hidden"] }); }
			function schedule() {
				if (scheduled || disposed) return;
				scheduled = true;
				requestAnimationFrame(apply);
			}
			function apply() {
				scheduled = false;
				if (disposed || !document.body) return;
				observer.disconnect();
				try {
					restore(document.body);
					const ratio = fontSize / 14;
					if (ratio === 1) return;
					// Measure everything before writing, with our old overrides removed. This prevents
					// inherited em/rem sizes and repeated preference changes from compounding.
					const measured = [document.body].concat(Array.from(document.body.querySelectorAll("*"))).filter(function (node) {
						return node.style && !/^(SCRIPT|STYLE|LINK|META|NOSCRIPT)$/.test(node.tagName) && (!node.closest("svg") || node.tagName.toLowerCase() === "svg");
					}).map(function (node) {
						const text = /^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(node.tagName) || Array.from(node.childNodes).some(function (child) { return child.nodeType === 3 && /\S/.test(child.nodeValue || ""); });
						const style = getComputedStyle(node), factor = text ? ratio : 1;
						return { node: node, size: parseFloat(style.fontSize) * factor, line: parseFloat(style.lineHeight) * factor };
					});
					measured.forEach(function (item) {
						if (!Number.isFinite(item.size) || item.size <= 0) return;
						const node = item.node, names = ["font-size", "line-height"];
						const saved = { hadStyle: node.hasAttribute("style"), original: names.map(function (name) { return [node.style.getPropertyValue(name), node.style.getPropertyPriority(name)]; }), applied: [] };
						node.style.setProperty("font-size", item.size.toFixed(4) + "px", "important");
						if (Number.isFinite(item.line)) node.style.setProperty("line-height", item.line.toFixed(4) + "px", "important");
						saved.applied = names.map(function (name) { return node.style.getPropertyValue(name); });
						node.setAttribute("data-dsh-tavern-font-original", JSON.stringify(saved));
					});
				} finally { observe(); }
			}
			function receive(event) {
				const data = event.data;
				if (event.source !== parent || !data || data.token !== token || data.type !== "dsh-tavern-font-size") return;
				const next = Number(data.fontSize);
				if (!Number.isFinite(next) || next < 8 || next > 48 || next === fontSize) return;
				fontSize = next;
				schedule();
			}
			observe();
			addEventListener("message", receive);
			addEventListener("resize", schedule);
			document.addEventListener("load", schedule, true);
			addEventListener("pagehide", function () { disposed = true; observer.disconnect(); removeEventListener("message", receive); removeEventListener("resize", schedule); document.removeEventListener("load", schedule, true); }, { once: true });
		}

		function buildTavernFrameDocument(input) {
			const html = rewriteTavernStaticMarkup(String(input && (input.content !== undefined ? input.content : input.html) || ""));
			const token = JSON.stringify(String(input && input.token || "")).replace(/</g, "\\u003c");
			const helperContext = JSON.stringify(input && input.helperContext || null).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
			const helperTurn = Math.max(0, Number(input && input.turn) || 0);
			const helperDependencies = input && input.helperContext ? tavernHelperMessageDependencies() : sillyTavernCssCompatibilityDependencies();
			const storageShim = '<script data-dsh-tavern-storage>(function(){try{void window.localStorage;return;}catch(e){}var values=Object.create(null),keys=[];var storage={getItem:function(key){key=String(key);return Object.prototype.hasOwnProperty.call(values,key)?values[key]:null;},setItem:function(key,value){key=String(key);if(!Object.prototype.hasOwnProperty.call(values,key))keys.push(key);values[key]=String(value);},removeItem:function(key){key=String(key);if(!Object.prototype.hasOwnProperty.call(values,key))return;delete values[key];keys.splice(keys.indexOf(key),1);},clear:function(){values=Object.create(null);keys=[];},key:function(index){index=Number(index);return index>=0&&index<keys.length?keys[index]:null;}};Object.defineProperty(storage,"length",{enumerable:true,get:function(){return keys.length;}});try{Object.defineProperty(window,"localStorage",{configurable:true,enumerable:true,value:storage});}catch(e){}})();<\/script>';
			const helperShim = input && input.helperContext ? '<script data-dsh-tavern-helper>(function(){var token=' + token + ',state=' + helperContext + ',turn=' + helperTurn + ',nextId=1,pending=Object.create(null),listeners=Object.create(null);var applyContextUpdate=' + applyTavernHelperContextUpdate.toString() + ';if(window.Vue)Object.assign(window,window.Vue);window.errorCatched=function(factory){return function(){try{return factory.apply(this,arguments);}catch(error){console.error(error);return {};}};};function copy(value){try{return structuredClone(value);}catch(e){return JSON.parse(JSON.stringify(value));}}function lastId(){return Math.max(-1,(state.messages||[]).length-1);}function normalizeId(value){var id=Number(value);if(!Number.isFinite(id))id=lastId();if(id<0)id=(state.messages||[]).length+id;return Math.max(0,Math.min(lastId(),id));}function currentId(){var mapped=state.turnMessageIds&&state.turnMessageIds[String(turn)];return mapped===undefined?lastId():normalizeId(mapped);}function selectedVariables(message){return copy(message&&message.variables&&typeof message.variables==="object"?message.variables:{});}function messagesFor(target,options){var all=state.messages||[],items=[];if(target===undefined||target===null)items=[all[currentId()]];else if(typeof target==="string"&&target.indexOf("-")>=0){var value=target.replace(/{{\\s*lastMessageId\\s*}}/gi,String(lastId())),parts=value.split("-"),from=normalizeId(parts[0]),to=normalizeId(parts[1]);for(var i=Math.min(from,to);i<=Math.max(from,to);i+=1)items.push(all[i]);}else items=[all[normalizeId(target)]];items=items.filter(Boolean);if(options&&options.role&&options.role!=="all")items=items.filter(function(item){return item.role===options.role;});return copy(items);}function call(method,args){return new Promise(function(resolve,reject){var requestId=String(nextId++);pending[requestId]={resolve:resolve,reject:reject};parent.postMessage({type:"dsh-tavern-helper-call",token:token,requestId:requestId,method:method,args:copy(args||{})},"*");});}function optionOf(option){var value=option&&typeof option==="object"?copy(option):{type:"message"};if(!value.type)value.type="message";if(value.type==="message"){if(value.message_id===undefined||value.message_id===null)value.message_id=currentId();else if(value.message_id==="latest")value.message_id=lastId();}return value;}function localReplace(variables,option){option=optionOf(option);if(option.type==="chat")state.chatVariables=copy(variables);else{var message=state.messages[normalizeId(option.message_id)];if(message){message.variables=copy(variables);if(Array.isArray(message.swipes_data))message.swipes_data[message.swipe_id||0]=copy(variables);}}}function localSetMessages(patches){(patches||[]).forEach(function(patch){var message=state.messages[normalizeId(patch.message_id)];if(!message)return;if(patch.swipe_id!==undefined){message.swipe_id=Math.max(0,Math.min((message.swipes||[]).length-1,Number(patch.swipe_id)||0));message.message=(message.swipes||[])[message.swipe_id]||message.message;}if(patch.message!==undefined){message.message=String(patch.message);if(Array.isArray(message.swipes))message.swipes[message.swipe_id||0]=message.message;}if(patch.data!==undefined){message.variables=copy(patch.data||{});if(Array.isArray(message.swipes_data))message.swipes_data[message.swipe_id||0]=copy(patch.data||{});}});}addEventListener("message",function(event){var data=event&&event.data;if(event.source!==parent||!data||data.token!==token)return;if(data.type==="dsh-tavern-helper-context-update"){var previous=copy(state),applied;try{applied=applyContextUpdate(state,data.update);}catch(error){parent.postMessage({type:"dsh-tavern-helper-context-request",token:token},"*");return;}state=applied.context;if(Number.isFinite(Number(applied.turn)))turn=Math.max(0,Number(applied.turn));Promise.resolve().then(async function(){var names=Array.isArray(applied.events)?applied.events:[];for(var index=0;index<names.length;index+=1){var name=names[index];if(window.Mvu&&name===window.Mvu.events.VARIABLE_UPDATE_ENDED)await window.eventEmit(name,selectedVariables((state.messages||[])[currentId()]),previous);else await window.eventEmit(name,currentId());}}).catch(function(error){console.error(error);});return;}if(data.type!=="dsh-tavern-helper-response")return;var task=pending[data.requestId];if(!task)return;delete pending[data.requestId];if(data.ok){if(data.result&&data.result.context)state=data.result.context;task.resolve(data.result);}else task.reject(new Error(String(data.error||"Helper 调用失败")));});window.getCurrentMessageId=currentId;window.getLastMessageId=lastId;window.getChatMessages=messagesFor;window.getVariables=function(option){option=optionOf(option);if(option.type==="chat")return copy(state.chatVariables||{});return selectedVariables((state.messages||[])[normalizeId(option.message_id)]);};window.replaceVariables=function(variables,option){option=optionOf(option);var plain=copy(variables||{});localReplace(plain,option);call("updateTavernHelperVariables",{option:option,variables:plain}).catch(function(error){console.error(error);});};window.updateVariablesWith=async function(updater,option){option=optionOf(option);var current=window.getVariables(option),next=typeof updater==="function"?await updater(copy(current)):current;if(next===undefined)next=current;next=copy(next);localReplace(next,option);await call("updateTavernHelperVariables",{option:option,variables:next});return copy(next);};window.setChatMessages=async function(patches){var plain=copy(patches||[]);localSetMessages(plain);var result=await call("updateTavernHelperMessages",{messages:plain});return result;};window.retrieveDisplayedMessage=function(messageId){return normalizeId(messageId)===currentId()?window.jQuery(document.body):window.jQuery();};window.toastr={success:function(message){console.info(String(message));},info:function(message){console.info(String(message));},warning:function(message){console.warn(String(message));},error:function(message){console.error(String(message));}};window.eventOn=function(name,handler){(listeners[name]||(listeners[name]=new Set())).add(handler);return handler;};window.eventOff=function(name,handler){if(listeners[name])listeners[name].delete(handler);};window.eventEmit=async function(name){var args=Array.prototype.slice.call(arguments,1),items=listeners[name]?Array.from(listeners[name]):[];for(var i=0;i<items.length;i+=1)await items[i].apply(null,args);};window.tavern_events={MESSAGE_SENT:"MESSAGE_SENT",MESSAGE_RECEIVED:"MESSAGE_RECEIVED",MESSAGE_UPDATED:"MESSAGE_UPDATED",MESSAGE_SWIPED:"MESSAGE_SWIPED",MESSAGE_DELETED:"MESSAGE_DELETED",MESSAGE_EDITED:"MESSAGE_EDITED"};if(state.mvuEnabled!==false)window.Mvu={events:{VARIABLE_INITIALIZED:"mag_variable_initialized",VARIABLE_UPDATE_STARTED:"mag_variable_update_started",COMMAND_PARSED:"mag_command_parsed",VARIABLE_UPDATE_ENDED:"mag_variable_update_ended",BEFORE_MESSAGE_UPDATE:"mag_before_message_update"},getMvuData:function(option){return window.getVariables(option);},replaceMvuData:async function(value,option){await window.updateVariablesWith(function(){return value;},option);return copy(value);},parseMessage:async function(){throw new Error("当前兼容层尚未开放 iframe 内手动 MVU 重算");}};window.waitGlobalInitialized=async function(name){if(name==="Mvu")return window.Mvu;return window[name];};var ready=import("/api/dsh-tavern/vendor/runtime-assets/zod/index.mjs").then(function(module){window.z=module;return true;});window.__dshTavernHelperReady=ready;if(window.jQuery&&window.jQuery.fn&&window.jQuery.fn.load&&!window.jQuery.fn.__dshDeferred){var original=window.jQuery.fn.load;var deferred=function(){var self=this,args=arguments;ready.then(function(){original.apply(self,args);});return self;};deferred.__dshDeferred=true;window.jQuery.fn.load=deferred;}})();<\/script>' : '';
			const interactiveHelperShim = input && input.helperContext ? '<script data-dsh-tavern-interactive-helper>(function(){var token=' + token + ',nextId=1,pending=Object.create(null);function copy(value){try{return structuredClone(value);}catch(e){return JSON.parse(JSON.stringify(value));}}function call(method,args){return new Promise(function(resolve,reject){var requestId="interactive:"+String(nextId++);pending[requestId]={resolve:resolve,reject:reject};parent.postMessage({type:"dsh-tavern-helper-call",token:token,requestId:requestId,method:method,args:copy(args||{})},"*");});}addEventListener("message",function(event){var data=event&&event.data;if(event.source!==parent||!data||data.token!==token||data.type!=="dsh-tavern-helper-response")return;var task=pending[data.requestId];if(!task)return;delete pending[data.requestId];if(data.ok)task.resolve(data.result);else task.reject(new Error(String(data.error||"Helper 调用失败")));});function payload(entries){if(!Array.isArray(entries))throw new TypeError("世界书条目必须是数组");return copy(entries).map(function(entry){delete entry.uid;return entry;});}async function fresh(name){var result=await call("getTavernHelperWorldbook",{name:String(name||"")});return copy(result&&result.worldbook&&result.worldbook.entries||[]);}async function replace(name,entries,expectedEntries){var result=await call("replaceTavernHelperWorldbook",{name:String(name||""),entries:copy(entries),expectedEntries:copy(expectedEntries)});return copy(result&&result.worldbook&&result.worldbook.entries||[]);}window.getWorldbook=async function(name){return await fresh(name);};window.updateWorldbookWith=async function(name,updater){if(typeof updater!=="function")throw new TypeError("世界书更新器必须是函数");var current=await fresh(name),draft=copy(current),next=await updater(draft);return await replace(name,next===undefined?draft:next,current);};window.createWorldbookEntries=async function(name,entries){var additions=payload(entries),previous;var worldbook=await window.updateWorldbookWith(name,function(current){previous=new Set(current.map(function(entry){return entry.uid;}));return current.concat(additions);});return{worldbook:worldbook,new_entries:worldbook.filter(function(entry){return!previous.has(entry.uid);})};};window.deleteWorldbookEntries=async function(name,predicate){if(typeof predicate!=="function")throw new TypeError("世界书删除条件必须是函数");var deleted=[];var worldbook=await window.updateWorldbookWith(name,function(current){return current.filter(function(entry){if(!predicate(copy(entry)))return true;deleted.push(copy(entry));return false;});});return{worldbook:worldbook,deleted_entries:deleted};};window.triggerSlash=function(line){return call("triggerTavernSlash",{line:String(line||"")});};})();<\/script>' : '';
			const mvuViewObservationShim = input && input.helperContext && input.observeMvuView !== false ? '<script data-dsh-tavern-mvu-view-observer>(function(){var token=' + token + ',reported=false;function report(){if(reported)return;reported=true;window.__dshTavernMvuViewUsed=true;parent.postMessage({type:"dsh-tavern-mvu-view-used",token:token,mvuViewUsed:true},"*");}var getMvuData=window.Mvu&&window.Mvu.getMvuData;if(typeof getMvuData==="function")window.Mvu.getMvuData=function(){report();return getMvuData.apply(window.Mvu,arguments);};var getVariables=window.getVariables;if(typeof getVariables==="function")window.getVariables=function(){report();return getVariables.apply(window,arguments);};})();<\/script>' : '';
			const runtimeReporter = input && input.runtimeReporting === false ? '' : '<script data-dsh-tavern-frame>(function(){var token=' + token + ';var logs=[],network=[],errors=[],timer=0;function trim(list){if(list.length>100)list.splice(0,list.length-100);}function value(input,depth){if(depth>3)return "[深度已截断]";if(input===null||input===undefined||typeof input==="boolean"||typeof input==="number"||typeof input==="string")return typeof input==="string"&&input.length>4000?input.slice(0,4000)+"…[已截断]":input;try{if(Array.isArray(input))return input.slice(0,30).map(function(item){return value(item,depth+1);});if(typeof input==="object"){var out={};Object.keys(input).slice(0,30).forEach(function(key){out[key]=value(input[key],depth+1);});return out;}}catch(e){}return String(input);}function cleanUrl(input){try{var parsed=new URL(String(input),location.href);return parsed.protocol+"//"+parsed.host+parsed.pathname;}catch(e){return String(input||"").split(/[?#]/)[0].slice(0,1000);}}function send(){timer=0;var dom="";try{if(document.body){var copy=document.body.cloneNode(true);Array.prototype.forEach.call(copy.querySelectorAll("script[data-dsh-tavern-frame],script[data-dsh-tavern-storage],script[data-dsh-tavern-layout]"),function(node){node.remove();});dom=copy.innerHTML;}}catch(e){}if(dom.length>100000)dom=dom.slice(0,100000)+"<!-- 已截断 -->";parent.postMessage({type:"dsh-tavern-frame-runtime",token:token,runtime:{capturedAt:Date.now(),dom:dom,console:logs.slice(),network:network.slice(),errors:errors.slice()}} ,"*");}function schedule(){if(timer)return;timer=setTimeout(send,350);}["log","info","warn","error"].forEach(function(level){var original=console[level];console[level]=function(){logs.push({at:Date.now(),level:level,args:Array.prototype.map.call(arguments,function(item){return value(item,0);})});trim(logs);if(level==="warn"||level==="error")schedule();return original&&original.apply(console,arguments);};});addEventListener("error",function(event){var target=event.target;if(target&&target!==window){errors.push({at:Date.now(),kind:"resource",tag:String(target.tagName||""),url:cleanUrl(target.src||target.href||"")});}else errors.push({at:Date.now(),kind:"error",message:String(event.message||""),source:cleanUrl(event.filename||""),line:Number(event.lineno)||0,column:Number(event.colno)||0});trim(errors);schedule();},true);addEventListener("unhandledrejection",function(event){errors.push({at:Date.now(),kind:"unhandledrejection",message:String(event.reason&&event.reason.message||event.reason||"")});trim(errors);schedule();});if(typeof window.fetch==="function"){var nativeFetch=window.fetch;window.fetch=function(input,init){var started=Date.now(),method=String(init&&init.method||"GET").toUpperCase(),url=cleanUrl(input&&input.url||input);return nativeFetch.apply(this,arguments).then(function(response){network.push({at:started,kind:"fetch",method:method,url:url,status:Number(response.status)||0,durationMs:Date.now()-started});trim(network);if(!response.ok)schedule();return response;},function(error){network.push({at:started,kind:"fetch",method:method,url:url,failed:true,durationMs:Date.now()-started,error:String(error&&error.message||error)});trim(network);schedule();throw error;});};}if(typeof XMLHttpRequest==="function"){var nativeOpen=XMLHttpRequest.prototype.open,nativeSend=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(method,url){this.__dshRequest={started:0,method:String(method||"GET").toUpperCase(),url:cleanUrl(url)};return nativeOpen.apply(this,arguments);};XMLHttpRequest.prototype.send=function(){var request=this.__dshRequest||{method:"GET",url:""};request.started=Date.now();this.addEventListener("loadend",function(){network.push({at:request.started,kind:"xhr",method:request.method,url:request.url,status:Number(this.status)||0,durationMs:Date.now()-request.started});trim(network);if(Number(this.status)>=400)schedule();});return nativeSend.apply(this,arguments);};}addEventListener("load",schedule);schedule();})();<\/script>';
			const reporter = '<script data-dsh-tavern-frame>(function(){var token=' + token + ';var last=0;var queued=false;function nodeBottom(node){if(!node||typeof node.getBoundingClientRect!=="function")return 0;var style;try{style=getComputedStyle(node);}catch(e){return 0;}if(style.display==="none"||style.visibility==="hidden"||style.position==="fixed")return 0;var rect=node.getBoundingClientRect();if(rect.width===0&&rect.height===0)return 0;var top=rect.top,bottom=rect.bottom+Math.max(0,parseFloat(style.marginBottom)||0);var ancestor=node.parentElement;while(ancestor&&ancestor!==document.documentElement){var ancestorStyle;try{ancestorStyle=getComputedStyle(ancestor);}catch(e){ancestorStyle=null;}var overflow=String(ancestorStyle&&(ancestorStyle.overflowY||ancestorStyle.overflow)||"visible");if(overflow!=="visible"){var ancestorRect=ancestor.getBoundingClientRect();top=Math.max(top,ancestorRect.top);bottom=Math.min(bottom,ancestorRect.bottom);if(bottom<=top)return 0;}ancestor=ancestor.parentElement;}return Math.ceil(bottom+(window.scrollY||0));}function measure(){var body=document.body;if(!body)return 48;var bodyRect=body.getBoundingClientRect();var height=Math.max(body.scrollHeight||0,Math.ceil(bodyRect.bottom+(window.scrollY||0)),48);var nodes=[body].concat(Array.prototype.slice.call(body.querySelectorAll("*")));for(var i=0;i<nodes.length;i+=1)height=Math.max(height,nodeBottom(nodes[i]));return height;}function report(){queued=false;var height=measure();if(height===last)return;last=height;parent.postMessage({type:"dsh-tavern-frame-height",token:token,height:height},"*");}function schedule(){if(queued)return;queued=true;if(typeof requestAnimationFrame==="function")requestAnimationFrame(report);else setTimeout(report,0);}if(typeof ResizeObserver==="function"){var observer=new ResizeObserver(schedule);observer.observe(document.documentElement);if(document.body)observer.observe(document.body);}addEventListener("load",schedule);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(schedule);new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});schedule();})();<\/script>';
			const readyReporter = '<script data-dsh-tavern-frame-ready>(function(){var token=' + token + ',armed=false,timer=0,reported=false;function report(){timer=0;if(reported)return;reported=true;var finish=function(){parent.postMessage({type:"dsh-tavern-frame-ready",token:token},"*");};if(typeof requestAnimationFrame==="function")requestAnimationFrame(function(){requestAnimationFrame(finish);});else setTimeout(finish,0);}function schedule(){if(!armed||reported)return;if(timer)clearTimeout(timer);timer=setTimeout(report,240);}new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});addEventListener("load",schedule);Promise.resolve(window.__dshTavernHelperReady).catch(function(){return false;}).then(function(){armed=true;schedule();});})();<\/script>';
			const layoutNormalizer = '<script data-dsh-tavern-layout>(function(){if(!document.body)return;Array.prototype.slice.call(document.body.childNodes).forEach(function(node){var value=String(node.nodeValue||"");if(node.nodeType===3&&!/\\S/.test(value)&&/[\\r\\n]/.test(value))node.nodeValue="";});})();<\/script>';
			const fontRuntime = '<script data-dsh-tavern-font-runtime>(' + installTavernFrameFonts.toString() + ')(' + token + ',' + restoreTavernFrameFontStyles.toString() + ');<\/script>';
			const cleanRuntimeReporter = runtimeReporter.replace('dom=copy.innerHTML;', '(' + restoreTavernFrameFontStyles.toString() + ')(copy);Array.from(copy.querySelectorAll("script[data-dsh-tavern-font-runtime]")).forEach(function(node){node.remove();});dom=copy.innerHTML;');
			return '<!doctype html><html><head><meta charset="utf-8">'
				+ '<meta name="viewport" content="width=device-width,initial-scale=1">'
				+ '<meta name="referrer" content="no-referrer">'
				+ '<meta http-equiv="Content-Security-Policy" content="default-src https: http: data: blob:; img-src https: http: data: blob:; media-src https: http: data: blob:; font-src https: http: data:; style-src \'unsafe-inline\' https: http:; script-src \'unsafe-inline\' \'unsafe-eval\' https: http: data: blob:; connect-src https: http: wss: data: blob:; frame-src https: http: data: blob:; object-src \'none\'; base-uri \'none\'; form-action \'none\'">'
				+ '<style>:root{color-scheme:light dark}html,body{box-sizing:border-box;margin:0;min-height:0;background:transparent;color:CanvasText;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px;line-height:1.75}body{padding:0 1px;overflow-wrap:anywhere;white-space:pre-wrap}body>*{white-space:normal}maintext{display:block;white-space:pre-wrap;overflow-wrap:anywhere}.dsh-tavern-plain-text{white-space:pre-wrap;overflow-wrap:anywhere}*,*:before,*:after{box-sizing:border-box}img,video,svg,canvas{max-width:100%;height:auto}pre{max-width:100%;overflow:auto;white-space:pre-wrap}table{max-width:100%;border-collapse:collapse}a{color:LinkText}</style>' + helperDependencies + tavernStaticAssetShim() + storageShim + helperShim + interactiveHelperShim + mvuViewObservationShim + cleanRuntimeReporter
				+ (input && input.helperContext ? '<script data-dsh-tavern-frame-variable-aliases>(' + installTavernFrameVariableAliases.toString() + ')();<\/script>' : '')
				+ (input && input.helperContext && input.persistent === true ? '<script data-dsh-tavern-status-refresh>(' + installTavernStatusRefresh.toString() + ')(' + token + ');<\/script>' : '')
				+ '</head><body class="no-blur">' + html + layoutNormalizer + fontRuntime + reporter + readyReporter + '</body></html>';
		}

		function encodeTavernScriptSource(value) {
			const binary = encodeURIComponent(String(value || "")).replace(/%([0-9A-F]{2})/g, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); });
			if (typeof btoa === "function") return btoa(binary);
			const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
			let result = "";
			for (let index = 0; index < binary.length; index += 3) {
				const a = binary.charCodeAt(index);
				const b = index + 1 < binary.length ? binary.charCodeAt(index + 1) : 0;
				const c = index + 2 < binary.length ? binary.charCodeAt(index + 2) : 0;
				result += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)]
					+ (index + 1 < binary.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=")
					+ (index + 2 < binary.length ? alphabet[c & 63] : "=");
			}
			return result;
		}

		function createTavernHelperTransport(options) {
			const { parent, token, copy, identity, onContext, onEvent } = options;
			let nextId = 1;
			const pending = Object.create(null);
			function post(message) { parent.postMessage(Object.assign({}, message, { token: token }), "*"); }
			function request(method, args) {
				return new Promise(function (resolve, reject) {
					const requestId = String(nextId++);
					pending[requestId] = { resolve: resolve, reject: reject, method: method };
					post(Object.assign({ type: "dsh-tavern-helper-call", requestId: requestId, method: method, args: copy(args || {}) }, identity()));
				});
			}
			function receive(event) {
				const data = event && event.data;
				if (event.source !== parent || !data || data.token !== token) return;
				if (data.type === "dsh-tavern-helper-context") { onContext({ context: data.context || {} }); return; }
				if (data.type === "dsh-tavern-helper-event") { onEvent(data); return; }
				if (data.type !== "dsh-tavern-helper-response") return;
				const task = pending[data.requestId];
				if (!task) return;
				delete pending[data.requestId];
				if (data.ok) { onContext(data.result || {}, task.method); task.resolve(data.result); }
				else task.reject(new Error(String(data.error || "Helper 调用失败")));
			}
			options.listen(receive);
			return Object.freeze({ request: request, post: post });
		}

		function createTavernHelperEventBus(options) {
			const { currentScript, withScript, reportSubscriptions, post } = options;
			const listeners = Object.create(null);
			function eventName(name) {
				const aliases = { message_sent: "MESSAGE_SENT", message_received: "MESSAGE_RECEIVED", message_updated: "MESSAGE_UPDATED", message_swiped: "MESSAGE_SWIPED", message_deleted: "MESSAGE_DELETED", message_edited: "MESSAGE_EDITED", chat_id_changed: "CHAT_CHANGED", chat_created: "CHAT_CREATED", character_page_loaded: "CHARACTER_PAGE_LOADED" };
				return aliases[String(name)] || String(name);
			}
			function removeEventEntry(name, entry) {
				if (listeners[name]) listeners[name].delete(entry);
				reportSubscriptions();
			}
			function listen(name, handler, position, once) {
				name = eventName(name);
				if (typeof handler !== "function") throw new TypeError("事件监听器必须是函数");
				let items = listeners[name] || (listeners[name] = new Set());
				let entry = Array.from(items).find(function (item) { return item.scriptId === currentScript().id && item.handler === handler; });
				if (!entry) entry = { scriptId: currentScript().id, handler: handler, once: once === true };
				if (position) items.delete(entry);
				if (position === "first") listeners[name] = new Set([entry].concat(Array.from(items)));
				else items.add(entry);
				reportSubscriptions();
				return { stop: function () { removeEventEntry(name, entry); } };
			}
			async function invokeEventEntry(name, entry, args) {
				if (!listeners[name] || !listeners[name].has(entry)) return;
				// Remove before calling so recursive emits cannot invoke a once-listener twice.
				if (entry.once) removeEventEntry(name, entry);
				return await withScript(entry.scriptId, function () { return entry.handler.apply(null, args); });
			}
			async function eventEmit(name) {
				name = eventName(name);
				const args = Array.prototype.slice.call(arguments, 1);
				const items = listeners[name] ? Array.from(listeners[name]) : [];
				// mvu_zod gates validation details on the official panel's checkbox.
				// Our executor has no visible panel: capture those errors for the receipt
				// without changing stored settings, commands, or validation behavior.
				let notification, previous;
				if (name === "mag_command_parsed_for_zod") {
					try {
						notification = options.document && options.document.getElementById("mvu_notification_error");
						if (notification) { previous = notification.checked; notification.checked = true; }
					} catch (_) { notification = null; }
				}
				try { for (const entry of items) await invokeEventEntry(name, entry, args); }
				finally { try { if (notification) notification.checked = previous; } catch (_) {} }
			}
			async function emitHostEvent(eventId, name, args) {
				name = eventName(name);
				const items = listeners[name] ? Array.from(listeners[name]) : [];
				for (const entry of items) {
					post({ type: "dsh-tavern-helper-event-progress", eventId: eventId, scriptId: entry.scriptId, phase: "started" });
					try { await invokeEventEntry(name, entry, args); }
					catch (error) {
						if (error && typeof error === "object") error.dshTavernScriptId = entry.scriptId;
						post({ type: "dsh-tavern-helper-event-progress", eventId: eventId, scriptId: entry.scriptId, phase: "failed" });
						throw error;
					}
					post({ type: "dsh-tavern-helper-event-progress", eventId: eventId, scriptId: entry.scriptId, phase: "completed" });
				}
			}
			function off(name, handler) {
				name = eventName(name);
				if (listeners[name]) for (const entry of Array.from(listeners[name])) if (entry.handler === handler && entry.scriptId === currentScript().id) listeners[name].delete(entry);
				reportSubscriptions();
			}
			return Object.freeze({
				listen: listen, off: off, emit: eventEmit, emitHost: emitHostEvent,
				names: function () { return Object.keys(listeners).filter(function (name) { return listeners[name] && listeners[name].size > 0; }); },
				subscriptionsFor: function (scriptId) { return Object.keys(listeners).filter(function (name) { return listeners[name] && Array.from(listeners[name]).some(function (entry) { return entry.scriptId === scriptId; }); }); }
			});
		}

		function createTavernHelperPopup(options) {
			const { document, parent, token } = options;
			function HelperPopup(content, _type, title, options) {
				const popup = this;
				popup.content = content;
				popup.options = options && typeof options === "object" ? options : {};
				popup.root = null;
				popup.resolve = null;
				popup.completeAffirmative = async function () {
					if (popup.root) popup.root.remove();
					popup.root = null;
					parent.postMessage({ type: "dsh-tavern-helper-ui-close", token: token }, "*");
					if (popup.resolve) { const resolve = popup.resolve; popup.resolve = null; resolve(true); }
					return true;
				};
				popup.show = function () {
					if (popup.root) return Promise.resolve(false);
					const overlay = document.createElement("div");
					overlay.setAttribute("data-dsh-helper-popup", "");
					overlay.style.cssText = "position:fixed;inset:0;z-index:10;display:grid;place-items:center;padding:24px;background:rgba(0,0,0,.64);box-sizing:border-box";
					const panel = document.createElement("section");
					panel.style.cssText = "width:min(920px,100%);max-height:90vh;overflow:auto;border:1px solid rgba(255,255,255,.2);border-radius:16px;padding:16px;background:#15191f;color:#eef4fb;box-shadow:0 24px 80px rgba(0,0,0,.5);box-sizing:border-box";
					if (title) { const heading = document.createElement("h2"); heading.textContent = String(title); panel.appendChild(heading); }
					const node = content && content.jquery ? content[0] : content;
					if (node && typeof node.nodeType === "number") panel.appendChild(node);
					else if (node !== undefined && node !== null) { const text = document.createElement("div"); text.textContent = String(node); panel.appendChild(text); }
					const actions = document.createElement("div");
					actions.style.cssText = "display:flex;justify-content:flex-end;margin-top:14px";
					const close = document.createElement("button");
					close.type = "button"; close.textContent = String(popup.options.okButton || "关闭");
					close.style.cssText = "border:1px solid rgba(255,255,255,.24);border-radius:9px;padding:7px 14px;background:#273241;color:#fff;cursor:pointer";
					close.addEventListener("click", popup.completeAffirmative);
					actions.appendChild(close); panel.appendChild(actions); overlay.appendChild(panel); document.body.appendChild(overlay);
					popup.root = overlay;
					parent.postMessage({ type: "dsh-tavern-helper-ui-open", token: token }, "*");
					return new Promise(function (resolve) { popup.resolve = resolve; });
				};
			}
			return HelperPopup;
		}

		function createTavernChatDataFacade(options) {
			const { copy, request } = options;
			const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
			const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
			const reserved = new Set(["message_id", "message", "mes", "role", "is_user", "is_system", "name", "send_date", "swipe_id", "swipes", "swipes_data", "variables", "pluginData", "original_avatar", "force_avatar"]);
			let chat = [], metadata = {}, rows = [], metadataBase = {}, metadataRevision = 0;
			let binding = "", chatId = "", lifecycleRevision = 0, lastRevision = -1;
			let tail = Promise.resolve(), saving = false, deferred = null;
			function keyOf(value) { return String(value.chatId || "") + ":" + Number(value.lifecycleRevision || 0); }
			function set(target, key, value) {
				Object.defineProperty(target, key, { value: copy(value), writable: true, configurable: true, enumerable: true });
			}
			function reconcile(target, source) {
				for (const key of Object.keys(target)) if (!own(source, key)) delete target[key];
				for (const key of Object.keys(source)) {
					const a = own(target, key) ? target[key] : undefined, b = source[key];
					if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
						reconcile(a, b); if (Array.isArray(a)) a.length = b.length;
					} else set(target, key, b);
				}
			}
			function pluginData(value) {
				const result = {};
				for (const key of Object.keys(value)) if (!reserved.has(key)) set(result, key, value[key]);
				return result;
			}
			function mergeView(target, base, remote, fields) {
				for (const key of new Set(Object.keys(base).concat(Object.keys(remote)))) {
					if (fields && !fields(key)) continue;
					if (own(target, key) !== own(base, key) || !same(target[key], base[key])) continue;
					if (!own(remote, key)) delete target[key];
					else if (target[key] && remote[key] && typeof target[key] === "object" && typeof remote[key] === "object" && Array.isArray(target[key]) === Array.isArray(remote[key])) {
						reconcile(target[key], remote[key]); if (Array.isArray(target[key])) target[key].length = remote[key].length;
					} else set(target, key, remote[key]);
				}
			}
			function coreOf(message) {
				const core = copy(message); delete core.pluginData;
				core.mes = String(message.message || ""); core.is_user = message.role === "user";
				core.variables = copy(message.swipes_data || []);
				return core;
			}
			function identity(core) { return [core.message_id, core.role, core.message, core.swipe_id, core.swipes]; }
			function layoutMatches() { return chat.length === rows.length && rows.every((row, index) => chat[index] === row.view); }
			function dirty() { return !layoutMatches() || !same(metadata, metadataBase) || rows.some(row => !same(pluginData(row.view), row.base)); }
			function sync(value, acknowledged) {
				if (!value) return;
				if (saving && !acknowledged) {
					if (!deferred || keyOf(value) !== keyOf(deferred) || Number(value.stateRevision || 0) >= Number(deferred.stateRevision || 0)) deferred = copy(value);
					return;
				}
				const nextBinding = keyOf(value), revision = Number(value.stateRevision || 0);
				if (binding !== nextBinding) {
					if (binding && dirty()) console.warn("聊天或历史版本已切换，未保存的插件编辑已隔离，请在当前聊天重新操作");
					chat = []; rows = []; metadata = {}; metadataBase = {}; metadataRevision = revision; lastRevision = -1;
					binding = nextBinding;
				}
				if (revision < lastRevision && !acknowledged) return;
				chatId = String(value.chatId || ""); lifecycleRevision = Number(value.lifecycleRevision || 0);
				// Do not conceal an unsupported local splice/reorder with a host refresh.
				if (!layoutMatches()) return;
				const nextRows = (value.messages || []).map(function (message, index) {
					const core = coreOf(message), remote = copy(message.pluginData || {});
					let row = rows[index];
					if (!row || !same(identity(row.core), identity(core))) {
						const view = copy(remote); for (const key of Object.keys(core)) set(view, key, core[key]);
						return { view: view, core: core, base: remote, revision: revision };
					}
					const ack = acknowledged && acknowledged.messages.find(item => item.message_id === core.message_id);
					mergeView(row.view, ack ? ack.data : row.base, remote, key => !reserved.has(key));
					mergeView(row.view, row.core, core, key => reserved.has(key));
					row.core = core;
					if (ack || same(pluginData(row.view), remote)) { row.base = remote; row.revision = revision; }
					return row;
				});
				rows = nextRows; chat.splice(0, chat.length, ...rows.map(row => row.view));
				const remoteMetadata = copy(value.chatMetadata || {}), ackMetadata = acknowledged && acknowledged.metadata;
				mergeView(metadata, ackMetadata ? ackMetadata.data : metadataBase, remoteMetadata);
				if (ackMetadata || same(metadata, remoteMetadata)) { metadataBase = remoteMetadata; metadataRevision = revision; }
				lastRevision = revision;
			}
			function snapshot() {
				if (!layoutMatches()) throw new Error("saveChat 不支持新增、删除、替换或重排历史消息");
				const messages = [];
				for (const row of rows) {
					for (const key of reserved) if (own(row.view, key) !== own(row.core, key) || !same(row.view[key], row.core[key])) throw new Error("saveChat 只保存插件数据，不支持修改正文、身份或消息版本: " + key);
					const data = pluginData(row.view);
					if (!same(data, row.base)) messages.push({ message_id: row.core.message_id, stateRevision: row.revision, data: data });
				}
				const result = { chatId: chatId, lifecycleRevision: lifecycleRevision, messages: messages };
				if (!same(metadata, metadataBase)) result.metadata = { stateRevision: metadataRevision, data: copy(metadata) };
				return result;
			}
			function save() {
				const requestedBinding = binding;
				const task = tail.catch(function () {}).then(async function () {
					if (binding !== requestedBinding) throw new Error("聊天已切换，已取消旧聊天的排队保存");
					const submitted = snapshot();
					if (!submitted.messages.length && !submitted.metadata) return;
					saving = true;
					try {
						const result = await request("saveTavernChatData", { request: submitted });
						if (!result || result.updated !== true || !result.context) throw new Error("插件聊天数据未保存");
						sync(result.context, submitted);
					} finally {
						saving = false;
						const pending = deferred; deferred = null; if (pending) sync(pending);
					}
				});
				tail = task;
				task.catch(function (error) { console.error(error); });
				return task;
			}
			function updateMetadata(values, reset) {
				if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("聊天元数据必须是对象");
				if (reset) reconcile(metadata, values);
				else for (const key of Object.keys(values)) set(metadata, key, values[key]);
			}
			sync(options.context());
			return { sync: sync, save: save, updateMetadata: updateMetadata, chat: () => chat, metadata: () => metadata };
		}

		function installTavernCompatibilityDiagnostics(options) {
			const counts = new Map();
			for (const entry of options.catalog || []) {
				const target = options.surfaces[entry.surface];
				if (!target || !["noop", "reject", "missing"].includes(entry.policy)) continue;
				function record(args) {
					const scriptId = options.currentScript().id;
					const key = scriptId + "\n" + entry.id;
					const count = Math.min(Number.MAX_SAFE_INTEGER, (counts.get(key) || 0) + 1);
					counts.set(key, count);
					// typeof never traverses plugin objects, invokes getters or serializes secrets.
					const argumentTypes = Array.from(args).slice(0, 12).map(value => value === null ? "null" : typeof value);
					options.post({ type: "dsh-tavern-helper-compatibility", scriptId: scriptId, capabilityId: entry.id, count: count, argumentTypes: argumentTypes });
				}
				if (entry.policy === "missing") {
					// Preserve typeof-based fallbacks. This records a lookup, never a successful call.
					Object.defineProperty(target, entry.name, { configurable: true, get: function () { record([]); return undefined; },
						set: function (value) { Object.defineProperty(target, entry.name, { value: value, configurable: true, writable: true }); } });
				} else target[entry.name] = function () {
					record(arguments);
					if (entry.policy === "reject") {
						const error = new Error("[unsupported] " + entry.id + " 尚未实现，操作未执行");
						error.code = "TAVERN_CAPABILITY_UNSUPPORTED";
						throw error;
					}
				};
				// Helper scripts also use the same APIs as bare window globals.
				if (entry.surface === "TavernHelper") Object.defineProperty(options.window, entry.name, {
					configurable: true, get: function () { return target[entry.name]; }, set: function (value) { target[entry.name] = value; }
				});
			}
		}

		function installTavernHelperFacade(options) {
			const nativeWorldInfoSnapshots = new WeakMap();
			const nativeWorldInfoByName = new Map();
			const functionTools = new Map();
			const { window, copy, context, request: call, Popup: HelperPopup } = options;
			const chatData = options.createChatData({ copy: copy, context: context, request: call });
			const extensionSettings = Object.assign(Object.create(null), copy(context().extensionSettings || {}));
			let savedExtensionSettings = copy(extensionSettings);
			let settingsTail = Promise.resolve();
			// Keep plugin-held object references stable when acknowledging persisted settings.
			function reconcileSettings(target, source) {
				for (const key of Object.keys(target)) if (!Object.prototype.hasOwnProperty.call(source, key)) delete target[key];
				for (const key of Object.keys(source)) {
					const value = source[key], previous = Object.prototype.hasOwnProperty.call(target, key) ? target[key] : undefined;
					if (value && previous && typeof value === "object" && typeof previous === "object" && Array.isArray(value) === Array.isArray(previous)) {
						reconcileSettings(previous, value);
						if (Array.isArray(previous)) previous.length = value.length;
					} else Object.defineProperty(target, key, { value: copy(value), enumerable: true, configurable: true, writable: true });
				}
			}
			function saveExtensionSettings() {
				// Serialize calls without an unload-sensitive debounce timer. Capture at execution
				// time so a burst of legacy fire-and-forget calls saves the newest edits.
				const task = settingsTail.catch(function () {}).then(async function () {
					const submitted = JSON.parse(JSON.stringify(extensionSettings));
					const result = await call("saveTavernExtensionSettings", { settings: submitted, expectedSettings: savedExtensionSettings });
					if (!result || !result.extensionSettings || result.updated === false) throw new Error("插件设置未保存");
					const remote = result.extensionSettings;
					for (const key of new Set(Object.keys(submitted).concat(Object.keys(remote)))) {
						// Edits made while the write was in flight stay dirty for the next call.
						if (JSON.stringify(extensionSettings[key]) !== JSON.stringify(submitted[key])) continue;
						if (Object.prototype.hasOwnProperty.call(remote, key)) {
							const patch = Object.create(null); patch[key] = remote[key];
							const current = Object.create(null);
							if (Object.prototype.hasOwnProperty.call(extensionSettings, key)) current[key] = extensionSettings[key];
							reconcileSettings(current, patch);
							Object.defineProperty(extensionSettings, key, { value: current[key], enumerable: true, configurable: true, writable: true });
						} else delete extensionSettings[key];
					}
					savedExtensionSettings = copy(remote);
					return copy(remote);
				});
				settingsTail = task;
				task.catch(function (error) { console.error(error); });
				return task;
			}
			// Both entry points reference the same functions; plugin wrappers stay visible to each other.
			const helper = {};
			const helperNames = ["getScriptId", "getScriptName", "getScriptInfo", "replaceScriptInfo", "getScriptButtons", "replaceScriptButtons", "updateScriptButtonsWith", "appendInexistentScriptButtons", "getButtonEvent", "getCharData", "getCurrentMessageId", "getLastMessageId", "getChatMessages", "setChatMessages", "createChatMessages", "getVariables", "getAllVariables", "replaceVariables", "insertOrAssignVariables", "insertVariables", "updateVariablesWith", "deleteVariable", "getTavernRegexes", "replaceTavernRegexes", "updateTavernRegexesWith", "importRawTavernRegex", "replaceWorldbook", "createWorldbookEntries", "deleteWorldbookEntries", "setLorebookEntries", "createLorebookEntries", "deleteLorebookEntries", "getLorebooks", "getWorldbookNames", "getCharWorldbookNames", "getWorldbook", "getLorebookEntries", "getCharLorebooks", "getCurrentCharPrimaryLorebook", "getLorebookSettings", "setLorebookSettings", "updateWorldbookWith", "getTavernHelperVersion", "substitudeMacros"];
			for (const name of helperNames) Object.defineProperty(helper, name, { enumerable: true, configurable: true, get: function () { return window[name]; }, set: function (value) { window[name] = value; } });
			window.TavernHelper = helper;
			const eventSource = { on: window.eventOn, once: window.eventOnce, off: window.eventOff, removeListener: window.eventOff, makeFirst: window.eventMakeFirst, makeLast: window.eventMakeLast, emit: window.eventEmit };
			const sillyTavern = {
				TavernHelper: helper,
				getContext: function () { return sillyTavern; },
				eventSource: eventSource,
				eventTypes: window.tavern_events,
				Popup: HelperPopup,
				POPUP_TYPE: Object.freeze({ DISPLAY: "display", TEXT: "text", CONFIRM: "confirm", INPUT: "input" }),
				POPUP_RESULT: Object.freeze({ AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null, CUSTOM1: 2 }),
				extensionSettings: extensionSettings,
				characters: [],
				characterId: 0,
				chatCompletionSettings: {},
				ToolManager: Object.freeze({ isToolCallingSupported: function () { return false; } }),
				isToolCallingSupported: function () { return false; },
				canPerformToolCalls: function () { return false; },
				registerFunctionTool: function (tool) {
					if (!tool || typeof tool !== "object" || Array.isArray(tool)) throw new TypeError("Function Tool 定义无效");
					const name = String(tool.name || "").trim();
					if (!name) throw new TypeError("Function Tool 名称不能为空");
					if (typeof tool.action !== "function") throw new TypeError("Function Tool action 必须是函数");
					if (!tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters)) throw new TypeError("Function Tool parameters 必须是 JSON Schema 对象");
					functionTools.set(name, tool);
				},
				unregisterFunctionTool: function (name) { functionTools.delete(String(name || "")); },
				getCurrentChatId: function () { return String(context().chatId || ""); },
				getCurrentLocale: function () { return "zh-CN"; },
				getCharacterCardFields: function () { return copy(context().character && (context().character.data || context().character) || {}); },
				loadWorldInfo: async function (name) {
					const result = await call("loadTavernWorldInfo", { name: name });
					const document = copy(result.worldInfo);
					nativeWorldInfoSnapshots.set(document, copy(document));
					nativeWorldInfoByName.set(String(name || "current"), copy(document));
					return document;
				},
				saveWorldInfo: async function (name, document) {
					const expected = nativeWorldInfoSnapshots.get(document) || nativeWorldInfoByName.get(String(name || "current"));
					if (!expected) throw new Error("保存前请先读取世界书");
					const result = await call("saveTavernWorldInfo", { name: name, worldInfo: copy(document), expectedWorldInfo: copy(expected) });
					if (!result || result.updated === false) throw new Error("世界书未保存");
					nativeWorldInfoSnapshots.set(document, copy(result.worldInfo));
					nativeWorldInfoByName.set(String(name || "current"), copy(result.worldInfo));
					context().worldbook = copy(result.worldbook);
				},
				callGenericPopup: function (content, type, title, options) { return new HelperPopup(content, type, title, options).show(); },
				saveChat: chatData.save,
				saveMetadata: chatData.save,
				saveMetadataDebounced: chatData.save,
				updateChatMetadata: chatData.updateMetadata,
				saveSettingsDebounced: saveExtensionSettings
			};
			Object.defineProperties(sillyTavern, {
				chatId: { enumerable: true, get: function () { return String(context().chatId || ""); } },
				name1: { enumerable: true, get: function () { return String(context().playerName || "你"); } },
				chat: { enumerable: true, get: chatData.chat },
				chatMetadata: { enumerable: true, get: chatData.metadata },
				name2: { enumerable: true, get: function () { return String(context().characterName || "角色"); } }
			});
			options.installCompatibility({ catalog: context().compatibilityCapabilities, surfaces: { TavernHelper: helper, SillyTavern: sillyTavern }, window: window, currentScript: options.currentScript, post: options.post });
			window.SillyTavern = Object.freeze(sillyTavern);
			window.getContext = sillyTavern.getContext;
			window.errorCatched = function (factory) { return function () { try { return factory.apply(this, arguments); } catch (error) { console.error(error); return {}; } }; };
			window.retrieveDisplayedMessage = function () { return window.jQuery ? window.jQuery() : []; };
			window.toastr = { success: console.info, info: console.info, warning: console.warn, error: console.error };
			return { sync: chatData.sync };
		}

		function tavernHelperScriptBootstrap(metadata, initialContext, modules) {
			try { void window.localStorage; }
			catch (_) {
				let values = Object.create(null);
				let keys = [];
				const storage = {
					getItem: function (key) { key = String(key); return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
					setItem: function (key, value) { key = String(key); if (!Object.prototype.hasOwnProperty.call(values, key)) keys.push(key); values[key] = String(value); },
					removeItem: function (key) { key = String(key); if (!Object.prototype.hasOwnProperty.call(values, key)) return; delete values[key]; keys.splice(keys.indexOf(key), 1); },
					clear: function () { values = Object.create(null); keys = []; },
					key: function (index) { return index >= 0 && index < keys.length ? keys[index] : null; }
				};
				Object.defineProperty(storage, "length", { get: function () { return keys.length; } });
				try { Object.defineProperty(window, "localStorage", { configurable: true, value: storage }); } catch (_) {}
			}
			let state = initialContext && typeof initialContext === "object" ? initialContext : {};
			const token = String(metadata.token || "");
			const officialMvuEnabled = metadata.officialMvu === true;
			let lorebookSettings = { selected_global_lorebooks: [] };
			const scriptList = (Array.isArray(metadata.scripts) ? metadata.scripts : [metadata]).map(function (script) {
				return {
					id: String(script && script.id || ""),
					name: String(script && script.name || script && script.id || ""),
					info: String(script && script.info || ""),
					buttons: Array.isArray(script && script.buttons) ? script.buttons : [],
					ready: false,
					failed: false
				};
			}).filter(function (script) { return script.id !== ""; });
			const scriptsById = Object.create(null);
			for (const script of scriptList) scriptsById[script.id] = script;
			let currentScriptId = scriptList[0] ? scriptList[0].id : "";
			let activeHostEventId = "";
			let facade;
			const transport = modules.createTransport({ parent: parent, token: token, copy: copy,
				identity: function () { return { eventId: activeHostEventId, scriptId: currentScript().id }; },
				listen: function (receive) { addEventListener("message", receive); },
				onContext: function (result, method) {
					const incoming = result.context;
					// An old RPC reply must not restore a context that the host has left.
					if (method && incoming && ((incoming.chatId && state.chatId && incoming.chatId !== state.chatId)
						|| Number(incoming.lifecycleRevision || 0) < Number(state.lifecycleRevision || 0))) return;
					if (incoming) state = Object.assign({}, state, copy(incoming));
					if (result.worldbook) state.worldbook = copy(result.worldbook);
					// Chat-data saves acknowledge their own submitted snapshot separately.
					if (incoming && facade && method !== "saveTavernChatData") facade.sync(state);
				},
				onEvent: function (data) {
					diagnosticCount = 0;
					const suppliedArgs = copy(data.args || []);
					const task = (async function () {
						const previousEventId = activeHostEventId;
						activeHostEventId = String(data.eventId || "");
						try {
							if (data.name === "mag_variable_update_ended" && suppliedArgs.length === 0) {
								const option = { type: "message", message_id: currentId() };
								const variables = getVariables(option);
								const before = JSON.stringify(variables);
								await events.emitHost(data.eventId, data.name, [variables]);
								if (JSON.stringify(variables) !== before) {
									localReplace(variables, option);
									await call("updateTavernHelperVariables", { option: option, variables: variables });
								}
								return [variables];
							}
							await events.emitHost(data.eventId, data.name, suppliedArgs);
							return suppliedArgs;
						} finally { activeHostEventId = previousEventId; }
					})();
					task.then(function (args) {
						if (data.eventId) parent.postMessage({ type: "dsh-tavern-helper-event-complete", token: token, eventId: data.eventId, args: copy(args || []) }, "*");
					}).catch(function (error) {
						console.error(error);
						if (data.eventId) parent.postMessage({ type: "dsh-tavern-helper-event-complete", token: token, eventId: data.eventId, scriptId: String(error && error.dshTavernScriptId || ""), error: String(error && error.message || error), args: suppliedArgs }, "*");
					});
				}
			});
			const call = transport.request;
			const events = modules.createEvents({ currentScript: currentScript, withScript: withScript,
				reportSubscriptions: reportSubscriptions, post: transport.post, document: window.document });
			function copy(value) {
				try { return structuredClone(value); }
				catch (_) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
			}
			function currentScript() { return scriptsById[currentScriptId] || scriptList[0] || { id: "", name: "", info: "", buttons: [] }; }
			async function withScript(scriptId, factory) {
				const previous = currentScriptId;
				currentScriptId = String(scriptId || previous || "");
				try { return await factory(); }
				finally { currentScriptId = previous; }
			}
			function stringHash(value, seed) {
				if (typeof value !== "string") return 0;
				let h1 = 0xdeadbeef ^ (Number(seed) || 0), h2 = 0x41c6ce57 ^ (Number(seed) || 0);
				for (let index = 0; index < value.length; index += 1) {
					const code = value.charCodeAt(index);
					h1 = Math.imul(h1 ^ code, 2654435761);
					h2 = Math.imul(h2 ^ code, 1597334677);
				}
				h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
				h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
				return 4294967296 * (2097151 & h2) + (h1 >>> 0);
			}
			function buttonEvent(name, scriptId) { return String(scriptId || currentScript().id) + "_" + stringHash(String(name || "")); }
			function reportSubscriptions() {
				parent.postMessage({
					type: "dsh-tavern-helper-subscriptions",
					token: token,
					names: events.names(),
					ready: scriptList.every(function (script) { return script.ready || script.failed; }),
					scripts: scriptList.map(function (script) { return { id: script.id, names: events.subscriptionsFor(script.id), ready: script.ready, failed: script.failed }; })
				}, "*");
			}
			function lastId() { return Math.max(-1, (state.messages || []).length - 1); }
			function normalizeId(value) {
				let id = Number(value);
				if (!Number.isFinite(id)) id = lastId();
				if (id < 0) id = (state.messages || []).length + id;
				return Math.max(0, Math.min(lastId(), id));
			}
			function currentId() { return lastId(); }
			function optionOf(option) {
				const value = option && typeof option === "object" ? copy(option) : { type: "message" };
				if (!value.type) value.type = "message";
				if (value.type === "message") {
					if (value.message_id === undefined || value.message_id === null || value.message_id === "latest") value.message_id = currentId();
				} else if (value.type === "script" && !value.script_id) value.script_id = currentScript().id;
				return value;
			}
			function messagesFor(target, options) {
				const all = state.messages || [];
				let items = [];
				if (target === undefined || target === null) items = [all[currentId()]];
				else if (typeof target === "string" && target.includes("-")) {
					const value = target.replace(/{{\s*lastMessageId\s*}}/gi, String(lastId()));
					const parts = value.split("-");
					const from = normalizeId(parts[0]);
					const to = normalizeId(parts[1]);
					for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) items.push(all[index]);
				} else items = [all[normalizeId(target)]];
				items = items.filter(Boolean);
				if (options && options.role && options.role !== "all") items = items.filter(function (item) { return item.role === options.role; });
				return copy(items);
			}
			function getVariables(option) {
				const resolved = optionOf(option);
				if (resolved.type === "global") return copy(state.globalVariables || {});
				if (resolved.type === "character") return copy(state.characterVariables || {});
				if (resolved.type === "chat") return copy(state.chatVariables || {});
				if (resolved.type === "script") return copy(state.scriptVariables && state.scriptVariables[resolved.script_id] || {});
				const message = (state.messages || [])[normalizeId(resolved.message_id)];
				return copy(message && message.variables && typeof message.variables === "object" ? message.variables : {});
			}
			function localReplace(variables, option) {
				const resolved = optionOf(option);
				if (resolved.type === "global") state.globalVariables = copy(variables);
				else if (resolved.type === "character") state.characterVariables = copy(variables);
				else if (resolved.type === "chat") state.chatVariables = copy(variables);
				else if (resolved.type === "script") {
					if (!state.scriptVariables || typeof state.scriptVariables !== "object") state.scriptVariables = {};
					state.scriptVariables[resolved.script_id] = copy(variables);
				} else {
					const message = (state.messages || [])[normalizeId(resolved.message_id)];
					if (message) {
						message.variables = copy(variables);
						if (Array.isArray(message.swipes_data)) message.swipes_data[message.swipe_id || 0] = copy(variables);
					}
				}
				return resolved;
			}
			function localSetMessages(patches) {
				(patches || []).forEach(function (patch) {
					const message = (state.messages || [])[normalizeId(patch.message_id)];
					if (!message) return;
					if (patch.swipe_id !== undefined) {
						message.swipe_id = Math.max(0, Math.min((message.swipes || []).length - 1, Number(patch.swipe_id) || 0));
						message.message = (message.swipes || [])[message.swipe_id] || message.message;
						message.mes = message.message;
					}
					if (patch.message !== undefined) {
						message.message = String(patch.message);
						message.mes = message.message;
						if (Array.isArray(message.swipes)) message.swipes[message.swipe_id || 0] = message.message;
					}
					if (patch.data !== undefined) {
						message.variables = copy(patch.data || {});
						if (Array.isArray(message.swipes_data)) message.swipes_data[message.swipe_id || 0] = copy(patch.data || {});
					}
					if (patch.swipes_data !== undefined) {
						message.swipes_data = copy(Array.isArray(patch.swipes_data) ? patch.swipes_data : []);
						message.variables = copy(message.swipes_data[message.swipe_id || 0] || {});
					}
				});
			}

			function regexGroups() {
				if (!state.regexScripts || typeof state.regexScripts !== "object") state.regexScripts = { global: [], character: [] };
				if (!Array.isArray(state.regexScripts.global)) state.regexScripts.global = [];
				if (!Array.isArray(state.regexScripts.character)) state.regexScripts.character = [];
				return state.regexScripts;
			}
			function helperRegex(script, scope) {
				const placements = Array.isArray(script.placement) ? script.placement.map(Number) : [];
				return {
					id: String(script.id || ""), script_name: String(script.name || script.scriptName || ""), enabled: script.enabled !== false,
					find_regex: String(script.findRegex || ""), trim_strings: copy(Array.isArray(script.trimStrings) ? script.trimStrings : []), replace_string: String(script.replaceString || ""),
					source: { user_input: placements.includes(1), ai_output: placements.includes(2), slash_command: placements.includes(3), world_info: placements.includes(5), reasoning: placements.includes(6) },
					destination: { display: script.markdownOnly === true, prompt: script.promptOnly === true }, run_on_edit: script.runOnEdit === true,
					min_depth: script.minDepth == null ? null : Number(script.minDepth), max_depth: script.maxDepth == null ? null : Number(script.maxDepth), scope: scope
				};
			}
			function internalRegex(regex) {
				const source = regex && regex.source || {}, destination = regex && regex.destination || {};
				return {
					id: String(regex && regex.id || ""), name: String(regex && (regex.script_name || regex.scriptName) || ""), enabled: !regex || (Object.prototype.hasOwnProperty.call(regex, "enabled") ? regex.enabled !== false : regex.disabled !== true),
					findRegex: String(regex && (regex.find_regex || regex.findRegex) || ""), trimStrings: copy(regex && (regex.trim_strings || regex.trimStrings) || []), replaceString: String(regex && (regex.replace_string || regex.replaceString) || ""),
					placement: Array.isArray(regex && regex.placement) ? copy(regex.placement) : [source.user_input && 1, source.ai_output && 2, source.slash_command && 3, source.world_info && 5, source.reasoning && 6].filter(Boolean),
					markdownOnly: regex && regex.markdownOnly === true || destination.display === true, promptOnly: regex && regex.promptOnly === true || destination.prompt === true, runOnEdit: regex && (regex.runOnEdit === true || regex.run_on_edit === true),
					substituteRegex: 0, minDepth: regex && (regex.min_depth ?? regex.minDepth) == null ? null : Number(regex.min_depth ?? regex.minDepth), maxDepth: regex && (regex.max_depth ?? regex.maxDepth) == null ? null : Number(regex.max_depth ?? regex.maxDepth)
				};
			}
			function rawRegex(script) {
				return {
					id: String(script.id || ""), scriptName: String(script.name || ""), disabled: script.enabled === false,
					findRegex: String(script.findRegex || ""), trimStrings: copy(script.trimStrings || []), replaceString: String(script.replaceString || ""),
					placement: copy(script.placement || []), markdownOnly: script.markdownOnly === true, promptOnly: script.promptOnly === true,
					runOnEdit: script.runOnEdit === true, substituteRegex: script.substituteRegex == null ? 0 : script.substituteRegex,
					minDepth: script.minDepth == null ? null : script.minDepth, maxDepth: script.maxDepth == null ? null : script.maxDepth
				};
			}

			window.getScriptId = function () { return currentScript().id; };
			window.getScriptName = function () { return currentScript().name; };
			window.getScriptInfo = function () { return currentScript().info; };
			window.replaceScriptInfo = function (value) { currentScript().info = String(value || ""); };
			window.getScriptButtons = function () { return copy(currentScript().buttons); };
			window.replaceScriptButtons = function (buttons) { currentScript().buttons = copy(Array.isArray(buttons) ? buttons : []); };
			window.updateScriptButtonsWith = async function (updater) { const next = await updater(copy(currentScript().buttons)); window.replaceScriptButtons(next); return copy(currentScript().buttons); };
			window.appendInexistentScriptButtons = function (buttons) {
				const next = copy(currentScript().buttons);
				for (const button of Array.isArray(buttons) ? buttons : []) if (!next.some(function (item) { return item && item.name === button.name; })) next.push(copy(button));
				window.replaceScriptButtons(next);
				return copy(next);
			};
			window.getButtonEvent = buttonEvent;
			window.getCharData = function () { return copy(state.character || null); };
			window.getCurrentMessageId = currentId;
			window.getLastMessageId = lastId;
			window.getChatMessages = messagesFor;
			window.getTavernRegexes = function (option) {
				const groups = regexGroups(), resolved = option && typeof option === "object" ? option : {};
				let items = [];
				if (resolved.type) {
					if (!Object.prototype.hasOwnProperty.call(groups, resolved.type)) throw new Error("不支持的酒馆正则类型: " + resolved.type);
					items = groups[resolved.type].map(function (script) { return helperRegex(script); });
				} else {
					const scope = resolved.scope || "all", enabled = resolved.enable_state || "all";
					if (!["all", "global", "character"].includes(scope)) throw new Error("无效的酒馆正则 scope: " + scope);
					if (!["all", "enabled", "disabled"].includes(enabled)) throw new Error("无效的酒馆正则 enable_state: " + enabled);
					if (scope === "all" || scope === "global") items.push.apply(items, groups.global.map(function (script) { return helperRegex(script, "global"); }));
					if (scope === "all" || scope === "character") items.push.apply(items, groups.character.map(function (script) { return helperRegex(script, "character"); }));
					if (enabled !== "all") items = items.filter(function (script) { return script.enabled === (enabled === "enabled"); });
				}
				return copy(items);
			};
			window.getVariables = getVariables;
			window.getAllVariables = function () {
				const merged = Object.assign({}, copy(state.globalVariables || {}), copy(state.characterVariables || {}), copy(state.chatVariables || {}), getVariables({ type: "script" }));
				for (const message of state.messages || []) Object.assign(merged, copy(message.variables || {}));
				return merged;
			};
			window.replaceVariables = function (variables, option) {
				const resolved = localReplace(copy(variables || {}), option);
				return call("updateTavernHelperVariables", { option: resolved, variables: copy(variables || {}) }).catch(function (error) { console.error(error); throw error; });
			};
			window.insertOrAssignVariables = function (variables, option) {
				const resolved = optionOf(option);
				const current = getVariables(resolved);
				const next = window._.mergeWith(current, copy(variables || {}), function (_left, right) {
					return Array.isArray(right) ? right : undefined;
				});
				return call("updateTavernHelperVariables", { option: resolved, variables: copy(next) }).then(function (result) {
					if (result && result.stale) throw new Error("聊天已变化，变量未保存");
					localReplace(next, resolved);
					return copy(next);
				});
			};
			window.insertVariables = function (variables, option) {
				const resolved = optionOf(option);
				const current = getVariables(resolved);
				const next = window._.mergeWith({}, copy(variables || {}), current, function (_left, right) {
					return Array.isArray(right) ? right : undefined;
				});
				return call("updateTavernHelperVariables", { option: resolved, variables: copy(next) }).then(function (result) {
					if (result && result.stale) throw new Error("聊天已变化，变量未保存");
					localReplace(next, resolved);
					return copy(next);
				});
			};
			window.updateVariablesWith = async function (updater, option) {
				const resolved = optionOf(option);
				const current = getVariables(resolved);
				let next = typeof updater === "function" ? await updater(copy(current)) : current;
				if (next === undefined) next = current;
				next = copy(next);
				localReplace(next, resolved);
				await call("updateTavernHelperVariables", { option: resolved, variables: next });
				return copy(next);
			};
			window.deleteVariable = async function (path, option) {
				const resolved = optionOf(option);
				const next = getVariables(resolved);
				window._.unset(next, String(path || ""));
				await window.replaceVariables(next, resolved);
				return copy(next);
			};
			window.setChatMessages = async function (patches) {
				const plain = copy(patches || []);
				localSetMessages(plain);
				return await call("updateTavernHelperMessages", { messages: plain });
			};
			window.createChatMessages = async function (messages, option) {
				const result = await call("createTavernHelperMessages", {
					messages: copy(Array.isArray(messages) ? messages : []),
					option: copy(option && typeof option === "object" ? option : {})
				});
				if (result && result.stale) throw new Error("聊天已变化，消息未创建");
			};
			window.getWorldbookNames = function () { return state.worldbook && state.worldbook.name ? [state.worldbook.name] : []; };
			window.getCharWorldbookNames = function () { return { primary: state.worldbook && state.worldbook.name || null, additional: [] }; };
			window.getWorldbook = async function (name) {
				if (state.worldbook && (name === "current" || name === state.worldbook.name)) return copy(state.worldbook.entries || []);
				const result = await call("getTavernHelperWorldbook", { name: name });
				state.worldbook = copy(result.worldbook);
				return copy(state.worldbook.entries || []);
			};
			function legacyWorldbookEntry(entry, index) {
				const extra = entry.extra || {};
				return {
					uid: entry.uid, display_index: extra.displayIndex === undefined ? index : extra.displayIndex,
					comment: entry.name, enabled: entry.enabled, type: entry.strategy.type,
					position: entry.position.type === "at_depth" ? "at_depth_as_" + entry.position.role : entry.position.type,
					depth: entry.position.type === "at_depth" ? entry.position.depth : null, order: entry.position.order,
					probability: entry.probability, content: entry.content, keys: copy(entry.strategy.keys),
					logic: entry.strategy.keys_secondary.logic, filters: copy(entry.strategy.keys_secondary.keys), scan_depth: entry.strategy.scan_depth,
					case_sensitive: extra.caseSensitive == null ? "same_as_global" : extra.caseSensitive,
					match_whole_words: extra.matchWholeWords == null ? "same_as_global" : extra.matchWholeWords,
					group: extra.group || "", exclude_recursion: entry.recursion.prevent_incoming, prevent_recursion: entry.recursion.prevent_outgoing,
					delay_until_recursion: entry.recursion.delay_until === null ? false : entry.recursion.delay_until,
					sticky: entry.effect.sticky, cooldown: entry.effect.cooldown, delay: entry.effect.delay,
					use_group_scoring: "same_as_global", automation_id: null, group_prioritized: false, group_weight: 100
				};
			}
			function legacyWorldbookPatch(patch, original) {
				const next = copy(original || {});
				function set(path, value) {
					const parts = path.split("."); let target = next;
					for (const key of parts.slice(0, -1)) target = target[key] || (target[key] = {});
					target[parts[parts.length - 1]] = copy(value);
				}
				const mappings = { uid: "uid", comment: "name", enabled: "enabled", content: "content", probability: "probability", type: "strategy.type", keys: "strategy.keys", filters: "strategy.keys_secondary.keys", logic: "strategy.keys_secondary.logic", scan_depth: "strategy.scan_depth", order: "position.order", exclude_recursion: "recursion.prevent_incoming", prevent_recursion: "recursion.prevent_outgoing", sticky: "effect.sticky", cooldown: "effect.cooldown", delay: "effect.delay", group: "extra.group", display_index: "extra.displayIndex" };
				for (const key of Object.keys(mappings)) if (Object.prototype.hasOwnProperty.call(patch, key)) set(mappings[key], patch[key]);
				for (const pair of [["case_sensitive", "caseSensitive"], ["match_whole_words", "matchWholeWords"]]) if (Object.prototype.hasOwnProperty.call(patch, pair[0])) set("extra." + pair[1], patch[pair[0]] === "same_as_global" ? null : patch[pair[0]]);
				if (patch.depth !== undefined && patch.depth !== null) set("position.depth", patch.depth);
				if (patch.position !== undefined) {
					const match = /^at_depth_as_(system|user|assistant)$/.exec(patch.position);
					set("position.type", match ? "at_depth" : patch.position);
					if (match) set("position.role", match[1]);
				}
				if (patch.delay_until_recursion !== undefined) set("recursion.delay_until", patch.delay_until_recursion === false ? null : patch.delay_until_recursion === true ? 1 : patch.delay_until_recursion);
				const unsupported = { use_group_scoring: "same_as_global", automation_id: null, group_prioritized: false, group_weight: 100 };
				for (const key of Object.keys(unsupported)) if (patch[key] !== undefined && patch[key] !== unsupported[key]) throw new Error("当前兼容层尚未支持世界书字段: " + key);
				return next;
			}
			function worldbookPayload(entries) {
				if (!Array.isArray(entries)) throw new TypeError("世界书条目必须是数组");
				// Convert RegExp before crossing the JSON host boundary.
				return entries.map(function (value) {
					const entry = copy(value);
					if (value.strategy && Array.isArray(value.strategy.keys)) entry.strategy.keys = value.strategy.keys.map(String);
					if (value.strategy && value.strategy.keys_secondary && Array.isArray(value.strategy.keys_secondary.keys)) entry.strategy.keys_secondary.keys = value.strategy.keys_secondary.keys.map(String);
					return entry;
				});
			}
			async function writeWorldbook(name, entries, expectedEntries) {
				const result = await call("replaceTavernHelperWorldbook", { name: name, entries: worldbookPayload(entries), expectedEntries: expectedEntries });
				state.worldbook = copy(result.worldbook);
				return copy(state.worldbook.entries || []);
			}
			async function freshWorldbook(name) {
				const result = await call("getTavernHelperWorldbook", { name: name });
				state.worldbook = copy(result.worldbook);
				return copy(state.worldbook.entries || []);
			}
			window.replaceWorldbook = async function (name, entries) {
				const current = await freshWorldbook(name);
				await writeWorldbook(name, entries, current);
			};
			window.updateWorldbookWith = async function (name, updater) {
				if (typeof updater !== "function") throw new TypeError("世界书更新器必须是函数");
				const current = await freshWorldbook(name), draft = copy(current);
				const next = await updater(draft);
				return await writeWorldbook(name, next === undefined ? draft : next, current);
			};
			window.createWorldbookEntries = async function (name, entries) {
				const additions = worldbookPayload(entries).map(function (entry) { delete entry.uid; return entry; });
				let previous;
				const worldbook = await window.updateWorldbookWith(name, function (current) { previous = new Set(current.map(function (entry) { return entry.uid; })); return current.concat(additions); });
				return { worldbook: worldbook, new_entries: worldbook.filter(function (entry) { return !previous.has(entry.uid); }) };
			};
			window.deleteWorldbookEntries = async function (name, predicate) {
				if (typeof predicate !== "function") throw new TypeError("世界书删除条件必须是函数");
				const deleted = [];
				const worldbook = await window.updateWorldbookWith(name, function (current) {
					return current.filter(function (entry) { if (!predicate(copy(entry))) return true; deleted.push(copy(entry)); return false; });
				});
				return { worldbook: worldbook, deleted_entries: deleted };
			};
			window.getLorebookEntries = async function (name) { return (await window.getWorldbook(name)).map(legacyWorldbookEntry); };
			window.setLorebookEntries = async function (name, patches) {
				const worldbook = await window.updateWorldbookWith(name, function (entries) {
					const known = new Set(entries.map(function (entry) { return entry.uid; }));
					for (const patch of patches) if (!known.has(patch.uid)) throw new Error("世界书条目不存在: " + patch.uid);
					return entries.map(function (entry) { for (const patch of patches) if (patch.uid === entry.uid) entry = legacyWorldbookPatch(patch, entry); return entry; });
				});
				return worldbook.map(legacyWorldbookEntry);
			};
			window.createLorebookEntries = async function (name, entries) {
				const result = await window.createWorldbookEntries(name, entries.map(function (entry) { return legacyWorldbookPatch(entry); }));
				return { entries: result.worldbook.map(legacyWorldbookEntry), new_uids: result.new_entries.map(function (entry) { return entry.uid; }) };
			};
			window.deleteLorebookEntries = async function (name, uids) {
				const result = await window.deleteWorldbookEntries(name, function (entry) { return uids.includes(entry.uid); });
				return { entries: result.worldbook.map(legacyWorldbookEntry), delete_occurred: result.deleted_entries.length > 0 };
			};
			window.getLorebooks = window.getWorldbookNames;
			window.getCharLorebooks = async function () { return window.getCharWorldbookNames(); };
			window.getCurrentCharPrimaryLorebook = function () { return window.getCharWorldbookNames().primary; };
			window.getLorebookSettings = function () { return copy(lorebookSettings); };
			window.setLorebookSettings = function (settings) { lorebookSettings = Object.assign({}, lorebookSettings, copy(settings || {})); return copy(lorebookSettings); };
			window.eventOn = function (name, handler) { return events.listen(name, handler); };
			window.eventMakeFirst = function (name, handler) { return events.listen(name, handler, "first"); };
			window.eventMakeLast = function (name, handler) { return events.listen(name, handler, "last"); };
			window.eventOnce = function (name, handler) { return events.listen(name, handler, null, true); };
			window.eventOff = events.off;
			window.eventRemoveListener = window.eventOff;
			window.eventEmit = events.emit;
			let resolveCompanionScriptsReady;
			window.__dshTavernCompanionScriptsReady = new Promise(function (resolve) { resolveCompanionScriptsReady = resolve; });
			window.__dshTavernResolveCompanionScriptsReady = function () {
				if (!resolveCompanionScriptsReady) return;
				const resolve = resolveCompanionScriptsReady;
				resolveCompanionScriptsReady = null;
				resolve();
			};
			window.__dshTavernHelperSetCurrentScript = function (scriptId) { if (scriptsById[String(scriptId)]) currentScriptId = String(scriptId); };
			window.__dshTavernHelperSubscriptionsReady = function (scriptId) { const script = scriptsById[String(scriptId || currentScript().id)]; if (script) script.ready = true; reportSubscriptions(); };
			window.__dshTavernHelperSubscriptionsFailed = function (scriptId, error) {
				const script = scriptsById[String(scriptId || currentScript().id)];
				if (script) script.failed = true;
				parent.postMessage({ type: "dsh-tavern-helper-script-runtime", token: token, scriptId: script && script.id || currentScript().id, level: "error", message: String(error && error.message || error || "人物卡脚本初始化失败") }, "*");
				reportSubscriptions();
			};
			window.tavern_events = {
				MESSAGE_SENT: "MESSAGE_SENT", MESSAGE_RECEIVED: "MESSAGE_RECEIVED", MESSAGE_UPDATED: "MESSAGE_UPDATED",
				MESSAGE_SWIPED: "MESSAGE_SWIPED", MESSAGE_DELETED: "MESSAGE_DELETED", MESSAGE_EDITED: "MESSAGE_EDITED",
				CHAT_CHANGED: "CHAT_CHANGED", CHAT_CREATED: "CHAT_CREATED", CHARACTER_PAGE_LOADED: "CHARACTER_PAGE_LOADED",
				GENERATE_BEFORE_COMBINE_PROMPTS: "GENERATE_BEFORE_COMBINE_PROMPTS"
			};
			if (!officialMvuEnabled && state.mvuEnabled !== false) window.Mvu = {
				events: { VARIABLE_INITIALIZED: "mag_variable_initialized", VARIABLE_UPDATE_STARTED: "mag_variable_update_started", COMMAND_PARSED: "mag_command_parsed", VARIABLE_UPDATE_ENDED: "mag_variable_update_ended", BEFORE_MESSAGE_UPDATE: "mag_before_message_update" },
				getMvuData: function (option) { return getVariables(option); },
				replaceMvuData: async function (value, option) { await window.updateVariablesWith(function () { return value; }, option); return copy(value); },
				parseMessage: async function () { throw new Error("当前兼容层尚未开放脚本内手动 MVU 重算"); }
			};
			window.waitGlobalInitialized = async function (name) {
				if (window[name] !== undefined) return window[name];
				return await new Promise(function (resolve) {
					const eventName = "global_" + String(name) + "_initialized";
					const listener = function () { window.eventOff(eventName, listener); resolve(window[name]); };
					window.eventOn(eventName, listener);
				});
			};
			window.getTavernHelperVersion = async function () { return "3.4.17"; };
			window.substitudeMacros = function (value) {
				return String(value || "")
					.replace(/{{\s*user\s*}}/gi, String(state.playerName || "你"))
					.replace(/{{\s*char\s*}}/gi, String(state.characterName || "角色"));
			};
			facade = modules.installFacade({ installCompatibility: modules.installCompatibility, currentScript: currentScript, post: transport.post, createChatData: modules.createChatData, window: window, copy: copy, request: call, context: function () { return state; },
				Popup: modules.createPopup({ document: window.document, parent: parent, token: token }) });
			let regexSaveTimer = null;
			async function persistGlobalRegexes() {
				if (regexSaveTimer !== null) { clearTimeout(regexSaveTimer); regexSaveTimer = null; }
				window.SillyTavern.extensionSettings.regex = regexGroups().global.map(rawRegex);
				await window.SillyTavern.saveSettingsDebounced();
				return window.getTavernRegexes({ type: "global" });
			}
			window.replaceTavernRegexes = async function (regexes, option) {
				const resolved = option && typeof option === "object" ? option : {};
				const items = Array.isArray(regexes) ? copy(regexes) : [];
				if (resolved.type && resolved.type !== "global") throw new Error("当前兼容层只允许脚本修改全局正则");
				if (!resolved.type && resolved.scope && !["all", "global"].includes(resolved.scope)) throw new Error("当前兼容层只允许脚本修改全局正则");
				const globals = resolved.type === "global" ? items : items.filter(function (item) { return item && item.scope === "global"; });
				if (!resolved.type && (!resolved.scope || resolved.scope === "all")) {
					const submittedCharacters = items.filter(function (item) { return item && item.scope === "character"; });
					const currentCharacters = window.getTavernRegexes({ scope: "character", enable_state: "all" });
					if (JSON.stringify(submittedCharacters) !== JSON.stringify(currentCharacters)) throw new Error("当前兼容层不允许脚本修改人物卡内置正则");
				}
				regexGroups().global = globals.map(internalRegex);
				await persistGlobalRegexes();
			};
			window.updateTavernRegexesWith = async function (updater, option) {
				if (typeof updater !== "function") throw new TypeError("酒馆正则更新器必须是函数");
				const current = window.getTavernRegexes(option), draft = copy(current);
				const updated = await updater(draft);
				const next = updated === undefined ? draft : updated;
				await window.replaceTavernRegexes(next, option);
				return window.getTavernRegexes(option);
			};
			window.importRawTavernRegex = function (filename, content) {
				try {
					const raw = JSON.parse(String(content || ""));
					if (!raw || typeof raw !== "object" || !raw.findRegex) return false;
					raw.id = "dsh-regex-" + Date.now() + "-" + Math.random().toString(16).slice(2);
					raw.scriptName = String(filename || "未命名正则");
					regexGroups().global.push(internalRegex(raw));
					if (regexSaveTimer !== null) clearTimeout(regexSaveTimer);
					regexSaveTimer = setTimeout(function () { regexSaveTimer = null; void persistGlobalRegexes().catch(function (error) { console.error(error); }); }, 50);
					return true;
				} catch (_) { return false; }
			};
			// MVU reports some rejected operations through warn/toastr without throwing.
			let diagnosticCount = 0;
			for (const level of ["warn", "error"]) {
				const original = console[level].bind(console);
				console[level] = function () {
					original.apply(null, arguments);
					if (diagnosticCount++ >= 50) return;
					try {
						const message = Array.from(arguments).map(function (value) { return typeof value === "string" ? value : value && value.message || "[structured diagnostic omitted]"; }).join(" ").slice(0, 4000);
						parent.postMessage({ type: "dsh-tavern-helper-diagnostic", token: token, eventId: activeHostEventId, scriptId: currentScript().id, level: level, message: message }, "*");
					} catch (_) {}
				};
			}
			window.toastr.warning = console.warn;
			window.toastr.error = console.error;
			const ready = Promise.all([
				import("/api/dsh-tavern/vendor/runtime-assets/zod/index.mjs"),
				import("/api/dsh-tavern/vendor/runtime-assets/yaml/index.mjs")
			]).then(function (modules) { window.z = modules[0]; window.YAML = modules[1]; return true; });
			window.__dshTavernHelperReady = ready;
			void ready.catch(function (error) {
				parent.postMessage({ type: "dsh-tavern-helper-bootstrap-failed", token: token, message: String(error && error.message || error || "人物卡脚本依赖加载失败") }, "*");
			});
			addEventListener("error", function (event) {
				const target = event && event.target;
				const resource = target && target !== window ? String(target.src || target.href || "") : "";
				const message = event && event.message ? String(event.message) : (resource ? "资源加载失败: " + resource : "人物卡脚本加载失败");
				parent.postMessage({ type: "dsh-tavern-helper-script-runtime", token: token, scriptId: currentScript().id, level: "error", message: message }, "*");
			});
			addEventListener("unhandledrejection", function (event) {
				parent.postMessage({ type: "dsh-tavern-helper-script-runtime", token: token, scriptId: currentScript().id, level: "error", message: String(event.reason && event.reason.message || event.reason || "人物卡脚本 Promise 失败") }, "*");
			});
			parent.postMessage({ type: "dsh-tavern-helper-script-ready", token: token }, "*");
		}

		// Only downloading is repeatable. Once evaluation starts, its effects are unknown.
		function createMvuBundleLoader(options) {
			const delays = options.retryDelays || [1000, 2000];
			let disposed = false, pending = null, resume = null, cancel = null;
			const loadId = "mvu-load-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
			let cycle = 0, attemptNumber = 0, diagnosticCount = 0;
			function observe(phase, extra) {
				try {
					if (!options.onDiagnostic || diagnosticCount++ >= 64) return;
					const result = options.onDiagnostic(Object.assign({ loadId: loadId, phase: phase, cycle: cycle, attempt: attemptNumber, at: Date.now() }, extra));
					if (result && typeof result.catch === "function") result.catch(function () {});
				} catch (_) {} // Observers must never alter loading, retries or the original error.
			}
			function responseDetails(response) {
				const details = {};
				try {
					if (Number.isFinite(response.status)) details.httpStatus = response.status;
					details.redirected = response.redirected === true;
					if (response.url) details.responsePath = new URL(response.url).pathname;
					if (response.headers) {
						details.contentType = String(response.headers.get("content-type") || "").slice(0, 120);
						const length = response.headers.get("content-length");
						if (length !== null && /^\d+$/.test(length)) details.contentLength = Number(length);
					}
				} catch (_) {}
				return details;
			}
			function bodyDetails(source) {
				const details = { receivedChars: source.length, bodyKind: source.length > 16384 ? "not-inspected-large" : "unclassified" };
				try {
					// Only inspect bounded error envelopes; never log source, body previews or JSON extras.
					if (source.length <= 16384) {
						if (source.trim() === "forbidden") details.bodyKind = "forbidden";
						else {
							const value = JSON.parse(source);
							details.bodyKind = "json";
							if (value && value.ok === false) {
								details.bodyKind = "json-error";
								if (typeof value.error === "string") details.serverError = value.error.slice(0, 2000);
							}
						}
					}
				} catch (_) {}
				return details;
			}
			async function readErrorBody(response) {
				const limit = 16384;
				if (!response.body || typeof response.body.getReader !== "function") {
					const text = typeof response.text === "function" ? await response.text() : "";
					return text.length <= limit ? text : "";
				}
				const reader = response.body.getReader(), decoder = new TextDecoder();
				let text = "", bytes = 0;
				try {
					while (true) {
						const chunk = await reader.read();
						if (chunk.done) return text + decoder.decode();
						bytes += chunk.value.byteLength;
						if (bytes > limit) return "";
						text += decoder.decode(chunk.value, { stream: true });
					}
				} finally { try { Promise.resolve(reader.cancel()).catch(function () {}); reader.releaseLock(); } catch (_) {} }
			}
			function check() { if (disposed) throw new Error("MVU loader disposed"); }
			function state(value) { if (!disposed && options.onState) options.onState(value); }
			function wait(delay) {
				return new Promise(function (resolve, reject) {
					let timer;
					function finish(error) { clearTimeout(timer); cancel = null; resume = null; if (error) reject(error); else resolve(); }
					cancel = function () { finish(new Error("MVU loader disposed")); };
					if (delay === null) resume = function () { finish(); };
					else timer = setTimeout(finish, delay);
				});
			}
			async function download(url) {
				const controller = new AbortController();
				const startedAt = Date.now();
				let details = {};
				let failureStep = "fetch";
				let timer;
				try {
					observe("download-started");
					return await Promise.race([
						Promise.resolve().then(async function () {
							check();
							const response = await options.fetch(url, { signal: controller.signal, cache: "no-store" });
							details = responseDetails(response);
							failureStep = "http-status";
							if (!disposed && !controller.signal.aborted) observe("download-response", details);
							failureStep = "response-body";
							const isJavaScript = /^(?:application|text)\/(?:x-)?(?:java|ecma)script(?:\s*;|$)/i.test(details.contentType || "");
							const source = response.ok && isJavaScript ? await response.text() : await readErrorBody(response);
							const body = bodyDetails(source);
							if (!disposed && !controller.signal.aborted) observe("download-completed", Object.assign({}, details, body, { durationMs: Date.now() - startedAt }));
							failureStep = "response-validation";
							if (!response.ok || !isJavaScript || body.bodyKind === "json-error" || body.bodyKind === "json" || body.bodyKind === "forbidden" || /^\s*<(?:!doctype\s+html|html)\b/i.test(source)) {
								const reason = body.serverError || (body.bodyKind === "forbidden" ? "访问被拒绝（forbidden）" : !response.ok ? "HTTP " + response.status : "响应不是 MVU JavaScript（Content-Type: " + (details.contentType || "未提供") + "）");
								throw new Error("MVU 下载失败：" + reason);
							}
							return source;
						}),
						new Promise(function (_resolve, reject) {
							cancel = function () { controller.abort(); reject(new Error("MVU loader disposed")); };
							timer = setTimeout(function () { controller.abort(); reject(new Error("MVU 下载超时")); }, options.timeoutMs || 10000);
						})
					]);
				} catch (error) {
					observe(disposed ? "disposed" : "download-failed", Object.assign({}, details, { failureStep: failureStep, durationMs: Date.now() - startedAt, errorName: String(error.name || ""), message: String(error.message || error).slice(0, 2000) }));
					throw error;
				} finally { clearTimeout(timer); cancel = null; }
			}
			async function run(url) {
				while (true) {
					cycle++;
					for (let attempt = 0; attempt <= delays.length; attempt++) {
						attemptNumber = attempt + 1;
						check();
						state({ phase: "loading", attempt: attempt + 1, canRetry: false });
						let source;
						try { source = await download(url); }
						catch (error) {
							check();
							if (attempt < delays.length) { observe("retry-scheduled", { delayMs: delays[attempt] }); await wait(delays[attempt]); continue; }
							const waiting = wait(null);
							observe("retry-exhausted");
							state({ phase: "failed", attempt: attempt + 1, canRetry: true, error: String(error.message || error).slice(0, 4000) });
							await waiting;
							break;
						}
						check();
						state({ phase: "evaluating", canRetry: false });
						// Never catch evaluation errors in the download retry loop.
						const startedAt = Date.now();
						observe("execution-started");
						try {
							const result = await options.evaluate(source);
							observe("execution-completed", { durationMs: Date.now() - startedAt });
							return result;
						} catch (error) {
							observe("execution-failed", { durationMs: Date.now() - startedAt, errorName: String(error.name || ""), message: String(error.message || error).slice(0, 2000) });
							throw error;
						}
					}
				}
			}
			return Object.freeze({
				load: function (url) { if (!pending) pending = run(url); return pending; },
				retry: function () { if (disposed || !resume) return false; observe("manual-retry"); resume(); return true; },
				dispose: function () { disposed = true; if (cancel) cancel(); }
			});
		}

		function loadTavernHelperModule(source) {
			return new Promise(function (resolve, reject) {
				const element = document.createElement("script");
				const completionKey = "__dshTavernModuleComplete_" + Math.random().toString(36).slice(2);
				let settled = false;
				function finish(error) {
					if (settled) return;
					settled = true;
					window.removeEventListener("error", onError);
					delete window[completionKey];
					element.remove();
					if (error) reject(error); else resolve();
				}
				function onError(event) {
					finish(event.error || new Error(event.message || "人物卡模块或依赖加载失败"));
				}
				window[completionKey] = function () { finish(); };
				window.addEventListener("error", onError);
				element.onerror = onError;
				element.type = "module";
				// Inline modules inherit srcdoc's document base. Native imports retain
				// bindings/re-exports and dynamic imports can resolve local cache URLs.
				// A completion footer waits for top-level await (a load event does not).
				element.textContent = String(source) + "\n;window[" + JSON.stringify(completionKey) + "]();\n";
				try { document.body.appendChild(element); } catch (error) { finish(error); }
			});
		}

		function buildTavernHelperScriptDocument(input) {
			const scripts = Array.isArray(input && input.scripts)
				? input.scripts
				: (input && input.script ? [input.script] : []);
			const metadata = {
				token: String(input && input.token || ""),
				officialMvu: scripts.some(function (script) { return script && script.system === "official-mvu"; }),
				scripts: scripts.map(function (script) {
					return {
						id: String(script && script.id || ""),
						name: String(script && script.name || ""),
						info: String(script && script.info || ""),
						buttons: Array.isArray(script && script.buttons) ? script.buttons : [],
						system: String(script && script.system || "")
					};
				})
			};
			const context = input && input.context && typeof input.context === "object" ? input.context : {};
			const safeMetadata = JSON.stringify(metadata).replace(/</g, "\\u003c");
			const safeContext = JSON.stringify(context).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
			const bootstrap = '(' + tavernHelperScriptBootstrap.toString() + ')(' + safeMetadata + ',' + safeContext + ',{'
				+ 'createTransport:' + createTavernHelperTransport.toString() + ','
				+ 'createEvents:' + createTavernHelperEventBus.toString() + ','
				+ 'createPopup:' + createTavernHelperPopup.toString() + ','
				+ 'installCompatibility:' + installTavernCompatibilityDiagnostics.toString() + ','
				+ 'createChatData:' + createTavernChatDataFacade.toString() + ','
				+ 'installFacade:' + installTavernHelperFacade.toString() + '});';
			const modules = scripts.map(function (script) {
				return { id: String(script && script.id || ""), system: String(script && script.system || ""), assetUrl: String(script && script.assetUrl || ""), content: String(script && script.content || "") };
			});
			const loaderSource = 'await window.__dshTavernHelperReady;\n'
				+ 'const loadModule=' + loadTavernHelperModule.toString() + ';\n'
				+ 'const createMvuLoader=' + createMvuBundleLoader.toString() + ';\n'
				+ 'const scripts=' + JSON.stringify(modules).replace(/</g, "\\u003c") + ';\n'
				+ 'const token=' + JSON.stringify(metadata.token) + ';\n'
				+ 'try{for(const script of scripts){window.__dshTavernHelperSetCurrentScript(script.id);try{'
				+ 'if(script.system==="official-mvu"&&script.assetUrl){const loader=createMvuLoader({fetch:window.fetch.bind(window),evaluate:loadModule,onDiagnostic(diagnostic){parent.postMessage({type:"dsh-tavern-mvu-load-diagnostic",token,diagnostic},"*");},onState(state){parent.postMessage({type:"dsh-tavern-mvu-load-state",token,state},"*");}});'
				+ 'const retry=event=>{if(event.source===parent&&event.data?.token===token&&event.data.type==="dsh-tavern-mvu-reload")loader.retry();};'
				+ 'window.addEventListener("message",retry);window.addEventListener("pagehide",()=>loader.dispose(),{once:true});'
				+ 'try{await loader.load(new URL(script.assetUrl,document.baseURI).href);}finally{window.removeEventListener("message",retry);}}else await loadModule(script.content);'
				+ 'if(script.system==="official-mvu")await window.waitGlobalInitialized("Mvu");window.__dshTavernHelperSubscriptionsReady(script.id);'
				+ '}catch(error){window.__dshTavernHelperSubscriptionsFailed(script.id,error);if(script.system==="official-mvu")break;}}}finally{window.__dshTavernResolveCompanionScriptsReady();}';
			const moduleUrl = "data:text/javascript;base64," + encodeTavernScriptSource(loaderSource);
			return '<!doctype html><html><head><meta charset="utf-8">'
				+ '<meta name="referrer" content="no-referrer">'
				+ '<meta http-equiv="Content-Security-Policy" content="default-src https: http: data: blob:; script-src \'unsafe-inline\' \'unsafe-eval\' https: http: data: blob:; connect-src https: http: wss: data: blob:; img-src https: http: data: blob:; style-src \'unsafe-inline\' https: http:; object-src \'none\'; base-uri \'none\'; form-action \'none\'">'
				+ tavernIconDependencies()
				+ tavernStaticAssetShim()
				+ tavernHelperScriptDependencies()
				+ '<script data-dsh-tavern-helper-script>' + bootstrap + '<\/script>'
				+ '</head><body><div id="extensions_settings2" hidden></div><div id="tavern_helper" hidden></div><script type="module" src="' + moduleUrl + '"><\/script></body></html>';
		}

		function createTavernHelperScriptRuntime(options) {
			const hostWindow = options && options.window || window;
			const hostDocument = options && options.document || document;
			const releaseHostStylesheetBridge = createTavernHostStylesheetBridge({ window: hostWindow });
			const invoke = options && options.rpc || rpc;
			const reportError = options && options.reportError || function (source, error) { tavernErrorHub.report(source, error); };
			const resolveError = options && options.resolveError || function (source, beforeAt) { tavernErrorHub.resolve(source, beforeAt); };
			const reportMutation = options && options.onMutation || function (sessionId) { liveTavernView.invalidate(sessionId); };
			const onReady = options && typeof options.onReady === "function" ? options.onReady : function () {};
			const onMvuLoadState = options && options.onMvuLoadState || function () {};
			const initializationTimeoutMs = Math.max(1000, Number(options && options.initializationTimeoutMs) || 15000);
			const eventTimeoutMs = Math.max(10, Number(options && options.eventTimeoutMs) || 15000);
			const records = new Map();
			const pendingEvents = new Map();
			const closedEventIds = new Set();
			const closedEventOrder = [];
			const reportedEventTimeouts = new Set();
			const allowedMethods = new Set(["updateTavernHelperVariables", "updateTavernHelperMessages", "createTavernHelperMessages", "getTavernHelperWorldbook", "replaceTavernHelperWorldbook", "saveTavernExtensionSettings", "loadTavernWorldInfo", "saveTavernWorldInfo", "saveTavernChatData"]);
			let activeSessionId = "";
			let root = null;
			let previous = null;
			let eventSequence = 0;
			let readinessKey = "";
			let announcedReadinessKey = "";
			function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
			function token() { return hostWindow.crypto && typeof hostWindow.crypto.randomUUID === "function" ? hostWindow.crypto.randomUUID() : String(Date.now()) + ":" + String(Math.random()); }
			function stringHash(value, seed) {
				if (typeof value !== "string") return 0;
				let h1 = 0xdeadbeef ^ (Number(seed) || 0), h2 = 0x41c6ce57 ^ (Number(seed) || 0);
				for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index); h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677); }
				h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
				h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
				return 4294967296 * (2097151 & h2) + (h1 >>> 0);
			}
			function buttonEvent(scriptId, name) { return String(scriptId) + "_" + stringHash(String(name || "")); }
			function closeEventId(eventId) {
				const id = String(eventId || "");
				if (!id || closedEventIds.has(id)) return;
				closedEventIds.add(id);
				closedEventOrder.push(id);
				while (closedEventOrder.length > 100) closedEventIds.delete(closedEventOrder.shift());
			}
			function maybeAnnounceReady() {
				if (!readinessKey || records.size === 0 || announcedReadinessKey === readinessKey) return;
				if (Array.from(records.values()).some(function (record) { return mvuInitializationError(record); })) return;
				if (Array.from(records.values()).some(function (record) { return !record.loaded || (!record.subscriptionsReady && !record.initializationFailed); })) return;
				announcedReadinessKey = readinessKey;
				Promise.resolve(onReady(activeSessionId)).catch(function (error) { reportError("人物卡脚本初始化", error); });
			}
			function settleInitialization(record, error, failurePhase) {
				if (record.initializationTimer) hostWindow.clearTimeout(record.initializationTimer);
				record.initializationTimer = null;
				if (error && !record.subscriptionsReady) {
					recordMvuLoadDiagnostic(record, { phase: failurePhase || "initialization-timeout", failureStep: record.mvuLoadState ? "initialization" : "bootstrap", message: String(error.message || error).slice(0, 2000) });
					if (record.scripts.has("__dsh_official_mvu__")) onMvuLoadState({ phase: "error", canRetry: false, error: String(error.message || error) });
					record.initializationFailed = true;
					const unfinished = Array.from(record.scripts.values()).filter(function (script) { return !script.subscriptionsReady && !script.initializationFailed; });
					for (const script of unfinished) { script.initializationFailed = true; script.initializationError = String(error && error.message || error).slice(0, 4000); }
					const message = String(error && error.message || error || "初始化失败");
					if (message !== record.lastRuntimeError) {
						record.lastRuntimeError = message;
						const source = unfinished.length === 1 ? "人物卡脚本「" + unfinished[0].name + "」" : "人物卡共享脚本沙箱";
						reportError(source, new Error(message));
					}
				}
				maybeAnnounceReady();
			}
			function ensureRoot() {
				if (root && root.isConnected !== false) return root;
				root = hostDocument.createElement("div");
				root.id = "dsh-tavern-helper-script-host";
				root.hidden = true;
				(hostDocument.body || hostDocument.documentElement).appendChild(root);
				return root;
			}
			function decorateHelperContext(value, fallback) {
				const context = clone(value && typeof value === "object" ? value : {});
				const previous = fallback && typeof fallback === "object" ? fallback : {};
				for (const key of ["character", "characterVariables", "chatId", "playerName", "characterName", "worldbook"]) {
					if (context[key] === undefined && previous[key] !== undefined) context[key] = clone(previous[key]);
				}
				if (!context.scriptVariables || typeof context.scriptVariables !== "object") context.scriptVariables = clone(previous.scriptVariables || {});
				context.playerName = String(context.playerName || "你");
				context.characterName = String(context.characterName || context.character && context.character.name || "角色");
				for (const message of Array.isArray(context.messages) ? context.messages : []) {
					message.is_user = message.role === "user";
					message.is_system = message.role === "system";
					if (!message.name) message.name = message.is_user ? context.playerName : context.characterName;
					message.mes = String(message.message || "");
				}
				return context;
			}
			function helperContext(view, scripts) {
				const context = clone(view && view.tavernHelper || {});
				if (!context.scriptVariables || typeof context.scriptVariables !== "object") context.scriptVariables = {};
				for (const script of scripts) if (!Object.prototype.hasOwnProperty.call(context.scriptVariables, script.id)) context.scriptVariables[script.id] = clone(script.data || {});
				const character = clone(view && view.card || null);
				if (character && typeof character === "object" && (!character.data || typeof character.data !== "object")) character.data = clone(character);
				context.character = character;
				context.chatId = String(view && view.chatId || "");
				context.playerName = String(view && view.playerName || "你");
				context.characterName = String(character && character.name || "角色");
				context.worldbook = clone(view && view.tavernHelperWorldbook || null);
				return decorateHelperContext(context);
			}
			function post(record, message) {
				if (records.get(record.id) !== record || !record.loaded || !record.frame.contentWindow) return;
				record.frame.contentWindow.postMessage(Object.assign({ token: record.token }, message), "*");
			}
			function snapshot(context) {
				const messages = Array.isArray(context && context.messages) ? context.messages : [];
				const latest = messages[messages.length - 1] || null;
				return {
					lifecycleRevision: Math.max(0, Number(context && context.lifecycleRevision) || 0),
					count: messages.length,
					latestId: latest ? Number(latest.message_id) : -1,
					latestRole: latest && latest.role || "",
					latestMessage: latest && latest.message || "",
					latestSwipe: latest ? Number(latest.swipe_id) || 0 : 0,
					latestVariables: JSON.stringify(latest && latest.variables || {})
				};
			}
			function eventsBetween(before, after) {
				if (!before) return [];
				if (after.lifecycleRevision !== before.lifecycleRevision) return [];
				if (after.count < before.count) return [{ name: "MESSAGE_DELETED", args: [before.latestId] }];
				if (after.count > before.count) {
					if (after.latestRole === "assistant") return [{ name: "MESSAGE_RECEIVED", args: [after.latestId] }];
					return [{ name: "MESSAGE_SENT", args: [after.latestId] }];
				}
				if (after.latestSwipe !== before.latestSwipe) return [{ name: "MESSAGE_SWIPED", args: [after.latestId] }];
				if (after.latestMessage !== before.latestMessage) return [{ name: "MESSAGE_EDITED", args: [after.latestId] }];
				if (after.latestVariables !== before.latestVariables) return [{ name: "mag_variable_update_ended", args: [] }];
				return [];
			}
			function flushCompatibility(record) {
				if (record.compatibilityTimer) hostWindow.clearTimeout(record.compatibilityTimer);
				record.compatibilityTimer = null;
				const calls = Array.from(record.compatibilityPending.values());
				record.compatibilityPending.clear();
				const task = record.compatibilityTail.then(async function () {
					for (let offset = 0; offset < calls.length; offset += 64) {
						await invoke("recordTavernCompatibilityCalls", { runtimeId: record.compatibilityId, calls: calls.slice(offset, offset + 64) }, record.sessionId);
					}
				});
				record.compatibilityTail = task.catch(function () {
					// Recording failures are visible, but must not break the plugin's safe no-op.
					reportError("兼容能力调用记录", new Error("缺失能力记录保存失败，部分调用可能未记录"));
				});
				return record.compatibilityTail;
			}
			function removeRecord(id) {
				const record = records.get(id);
				if (!record) return;
				void flushCompatibility(record);
				for (const [eventId, pending] of pendingEvents) {
					if (pending.record !== record) continue;
					hostWindow.clearTimeout(pending.timer);
					closeEventId(eventId);
					pendingEvents.delete(eventId);
					pending.reject(new Error("人物卡脚本运行时已重置，事件未完成"));
				}
				if (record.initializationTimer) hostWindow.clearTimeout(record.initializationTimer);
				if (record.mvuDataTimer) hostWindow.clearTimeout(record.mvuDataTimer);
				record.frame.remove();
				if (record.hostArtifacts) record.hostArtifacts.dispose();
				records.delete(id);
				announcedReadinessKey = "";
			}
			function closeRecordUi() {
				if (!root) return;
				root.hidden = true;
				for (const record of records.values()) record.frame.hidden = false;
			}
			function openRecordUi(record) {
				const container = ensureRoot();
				container.hidden = false;
				container.style.cssText = "position:fixed;inset:0;z-index:2300";
				for (const item of records.values()) item.frame.hidden = item !== record;
				record.frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:transparent";
			}
			function mvuInitializationError(record) {
				const core = record && record.scripts.get("__dsh_official_mvu__");
				return core && core.initializationFailed ? "MVU 模块加载失败：" + (core.initializationError || "初始化未完成") + "\n请刷新页面或重启酒馆后重试。" : record && record.mvuDataError || "";
			}
			function mvuDataReady(record) {
				return (Array.isArray(record.context && record.context.messages) ? record.context.messages : []).some(function (message) {
					const value = message && message.variables;
					return value && typeof value === "object" && !Array.isArray(value) && value.stat_data !== undefined && value.schema !== undefined;
				});
			}
			function syncMvuDataReadiness(record) {
				const core = record.scripts.get("__dsh_official_mvu__");
				if (!core || core.initializationFailed || !record.subscriptionsReady) return;
				const ready = mvuDataReady(record);
				if (ready) {
					if (record.mvuDataTimer) hostWindow.clearTimeout(record.mvuDataTimer);
					record.mvuDataTimer = null;
					record.mvuDataError = "";
				} else if (!record.mvuDataTimer && !record.mvuDataError) {
					record.mvuDataTimer = hostWindow.setTimeout(function () {
						record.mvuDataTimer = null;
						if (records.get(record.id) !== record || mvuDataReady(record)) return;
						record.mvuDataError = "MVU 脚本已加载，但初始变量尚未保存。请导出日志检查开场初始化；刷新页面后可重试。";
						recordMvuLoadDiagnostic(record, { phase: "initialization-timeout", failureStep: "initial-variables", message: record.mvuDataError });
						record.mvuLoadState = { phase: "error", canRetry: false, error: record.mvuDataError };
						onMvuLoadState(record.mvuLoadState);
					}, initializationTimeoutMs);
				}
				const phase = ready ? "ready" : record.mvuDataError ? "error" : "evaluating";
				if (!record.mvuLoadState || record.mvuLoadState.phase !== phase) {
					recordMvuLoadDiagnostic(record, { phase: ready ? "initialization-ready" : "initialization-waiting", failureStep: "initial-variables" });
					record.mvuLoadState = { phase: phase, canRetry: false, error: record.mvuDataError || "" };
					onMvuLoadState(record.mvuLoadState);
				}
			}
			function emitToRecord(record, name, args, context, diagnostics, hostEventId) {
				const initializationError = mvuInitializationError(record);
				if (initializationError) {
					if (diagnostics) diagnostics.push({ kind: "initialization", name: name, level: "error", ready: false, initializationFailed: true, scriptId: "__dsh_official_mvu__", message: initializationError });
					return Promise.reject(new Error(initializationError));
				}
				if (diagnostics) diagnostics.push({ kind: "dispatch", name: name, ready: record.subscriptionsReady, initializationFailed: record.initializationFailed, subscribed: record.subscriptions.has(String(name)) });
				if (!record.loaded || !record.subscriptionsReady || record.initializationFailed) return Promise.resolve(args);
				if (context && typeof context === "object") {
					record.context = decorateHelperContext(context, record.context);
					post(record, { type: "dsh-tavern-helper-context", context: record.context });
				}
				if (!record.subscriptions.has(String(name))) return Promise.resolve(args);
				const eventId = String(hostEventId || "") || "host-event-" + (++eventSequence);
				const startedAt = Date.now();
				return new Promise(function (resolve, reject) {
					const timer = hostWindow.setTimeout(function () {
						const pending = pendingEvents.get(eventId);
						pendingEvents.delete(eventId);
						closeEventId(eventId);
						const script = pending && record.scripts.get(String(pending.activeScriptId || ""));
						const source = script ? "人物卡脚本「" + script.name + "」" : "人物卡脚本「" + record.name + "」";
						const error = new Error((script ? "人物卡脚本「" + script.name + "」" : "共享脚本沙箱") + "处理事件「" + String(name) + "」超时（" + String(Date.now() - startedAt) + "ms）");
						const timeoutKey = record.id + "\n" + String(name);
						if (!reportedEventTimeouts.has(timeoutKey)) {
							reportedEventTimeouts.add(timeoutKey);
							reportError(source, error);
						}
						reject(error);
					}, eventTimeoutMs);
					pendingEvents.set(eventId, { record: record, resolve: resolve, reject: reject, timer: timer, name: String(name), activeScriptId: "", diagnostics: diagnostics });
					post(record, { type: "dsh-tavern-helper-event", eventId: eventId, name: name, args: clone(args) });
				});
			}
			async function emit(name, args, context, diagnostics, hostEventId) {
				let current = clone(Array.isArray(args) ? args : []);
				for (const record of records.values()) current = await emitToRecord(record, name, current, context, diagnostics, hostEventId);
				return current;
			}
			function clear() {
				Array.from(records.keys()).forEach(removeRecord);
				if (root) root.remove();
				root = null;
				previous = null;
				readinessKey = "";
				announcedReadinessKey = "";
				closedEventIds.clear();
				closedEventOrder.length = 0;
				onMvuLoadState(null);
			}
			function recordMvuLoadDiagnostic(record, diagnostic) {
				try {
					if (!record.scripts.has("__dsh_official_mvu__") || (record.mvuDiagnosticCount || 0) >= 80) return;
					if (!diagnostic || typeof diagnostic.phase !== "string" || JSON.stringify(diagnostic).length > 12000) return;
					record.mvuDiagnosticCount = (record.mvuDiagnosticCount || 0) + 1;
					if (diagnostic.loadId) record.mvuLoadId = String(diagnostic.loadId).slice(0, 100);
					const ua = String(hostWindow.navigator && hostWindow.navigator.userAgent || "");
					const browser = (ua.match(/\b(?:Edg|Chrome|HeadlessChrome|CriOS|Firefox|FxiOS|Version|AppleWebKit)\/[\d.]+/g) || []).join(" ").slice(0, 120);
					const platform = /Windows/i.test(ua) ? "Windows" : /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Macintosh/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "unknown";
					const data = Object.assign({}, diagnostic, { kind: "mvu-load", loadId: record.mvuLoadId || "", browser: browser, platform: platform, runtimeMode: record.trustedCardMode ? "trusted" : "sandbox" });
					Promise.resolve(invoke("recordMvuRuntimeDiagnostic", { diagnostic: data }, record.sessionId)).catch(function () {});
				} catch (_) {}
			}
			function createRecord(sessionId, scripts, context, trustedCardMode) {
				const container = ensureRoot();
				const frame = hostDocument.createElement("iframe");
				const fingerprint = scripts.map(function (script) { return script.id + "\n" + script.content; }).join("\n---\n") + "\ntrusted=" + String(trustedCardMode);
				const record = {
					id: "shared",
					sessionId: sessionId,
					name: "共享脚本沙箱",
					trustedCardMode: trustedCardMode,
					startedAt: Date.now(),
					fingerprint: fingerprint,
					token: token(),
					compatibilityId: token(),
					compatibilityCatalog: new Map((context.compatibilityCapabilities || []).map(function (entry) { return [entry.id, entry]; })),
					compatibilityPending: new Map(),
					compatibilityTail: Promise.resolve(),
					compatibilityTimer: null,
					hostArtifacts: trustedCardMode ? createTavernHostArtifactScope({ document: hostDocument }) : null,
					frame: frame,
					loaded: false,
					context: context,
					subscriptions: new Set(),
					subscriptionsReady: false,
					initializationFailed: false,
					initializationTimer: null,
					lastRuntimeError: "",
					scripts: new Map(scripts.map(function (script) { return [String(script.id), { id: String(script.id), name: String(script.name || script.id), loaded: false, subscriptionsReady: false, initializationFailed: false }]; }))
				};
				frame.title = "人物卡共享脚本沙箱";
				if (!trustedCardMode) frame.sandbox = "allow-scripts";
				frame.referrerPolicy = "no-referrer";
				frame.srcdoc = buildTavernHelperScriptDocument({ token: record.token, scripts: scripts, context: context });
				frame.addEventListener("load", function () {
					if (records.get(record.id) !== record) return;
					record.loaded = true;
					for (const script of record.scripts.values()) script.loaded = true;
					post(record, { type: "dsh-tavern-helper-context", context: record.context });
					if (!record.subscriptionsReady && !record.initializationFailed && !record.mvuLoadState) {
						record.initializationTimer = hostWindow.setTimeout(function () {
							settleInitialization(record, new Error("初始化超时（" + String(initializationTimeoutMs) + "ms）"));
						}, initializationTimeoutMs);
					}
					maybeAnnounceReady();
				});
				container.appendChild(frame);
				records.set(record.id, record);
				return record;
			}
			function scriptsForView(view) {
				const scripts = Array.isArray(view && view.tavernHelperScripts) ? view.tavernHelperScripts.slice() : [];
				const mvu = view && view.tavernMvuRuntime;
				if (mvu && mvu.owner === "official" && mvu.assetUrl) {
					scripts.unshift({
						id: "__dsh_official_mvu__",
						name: "官方 MVU Core",
						system: "official-mvu",
						assetUrl: String(mvu.assetUrl),
						content: 'await import(new URL(' + JSON.stringify(String(mvu.assetUrl)) + ', document.baseURI).href);',
						data: {}, buttons: [], info: ""
					});
				}
				return scripts;
			}
			function sync(sessionId, view) {
				const nextSessionId = String(sessionId || "");
				if (activeSessionId && activeSessionId !== nextSessionId) clear();
				activeSessionId = nextSessionId;
				const scripts = scriptsForView(view);
				const trustedCardMode = Boolean(view && view.tavernRuntimePolicy && view.tavernRuntimePolicy.trustedCardMode);
				readinessKey = scripts.length === 0 ? "" : nextSessionId + "\n" + scripts.map(function (script) { return script.id + "\n" + script.content; }).join("\n---\n") + "\ntrusted=" + String(trustedCardMode);
				if (scripts.length === 0) { clear(); activeSessionId = nextSessionId; return; }
				const context = helperContext(view, scripts);
				const nextSnapshot = snapshot(context);
				const officialOwner = Boolean(view && view.tavernMvuRuntime && view.tavernMvuRuntime.owner === "official");
				const queuedEvents = officialOwner ? [] : eventsBetween(previous, nextSnapshot);
				const fingerprint = scripts.map(function (script) { return script.id + "\n" + script.content; }).join("\n---\n") + "\ntrusted=" + String(trustedCardMode);
				let record = records.get("shared");
				if (record && record.fingerprint !== fingerprint) { removeRecord("shared"); record = null; }
				if (!record) record = createRecord(nextSessionId, scripts, context, trustedCardMode);
				else {
					record.context = context;
					post(record, { type: "dsh-tavern-helper-context", context: context });
					queuedEvents.forEach(function (event) {
						if (record.subscriptionsReady && record.subscriptions.has(String(event.name))) post(record, { type: "dsh-tavern-helper-event", name: event.name, args: event.args });
					});
				}
				previous = nextSnapshot;
				maybeAnnounceReady();
				syncMvuDataReadiness(record);
			}
			function receive(event) {
				const data = event && event.data;
				if (!data || !data.token) return;
				const record = Array.from(records.values()).find(function (item) { return item.token === data.token && event.source === item.frame.contentWindow; });
				if (!record) return;
				if (data.type === "dsh-tavern-mvu-load-diagnostic") { recordMvuLoadDiagnostic(record, data.diagnostic); return; }
				if (data.type === "dsh-tavern-mvu-load-state") {
					const core = record.scripts.get("__dsh_official_mvu__");
					if (!core || core.subscriptionsReady || core.initializationFailed) return;
					const state = data.state;
					if (!state || !["loading", "failed", "evaluating"].includes(state.phase)) return;
					// Bootstrap can report before the iframe load event (top-level await).
					record.loaded = true;
					if (record.mvuLoadState && record.mvuLoadState.phase === "evaluating") return;
					if (record.initializationTimer) hostWindow.clearTimeout(record.initializationTimer);
					record.initializationTimer = null;
					record.mvuLoadState = { phase: state.phase, canRetry: state.phase === "failed", attempt: Number(state.attempt) || 0, error: String(state.error || "").slice(0, 4000) };
					if (state.phase === "failed") invoke("recordMvuRuntimeDiagnostic", { diagnostic: { level: "error", scriptId: core.id, message: "MVU 下载重试耗尽，等待手动重新加载：" + record.mvuLoadState.error } }, record.sessionId).catch(function () {});
					if (state.phase === "evaluating") record.initializationTimer = hostWindow.setTimeout(function () { settleInitialization(record, new Error("MVU 初始化超时")); }, initializationTimeoutMs);
					onMvuLoadState(record.mvuLoadState);
					return;
				}
				if (data.type === "dsh-tavern-helper-compatibility") {
					const script = record.scripts.get(data.scriptId);
					const entry = record.compatibilityCatalog.get(data.capabilityId);
					if (!script || !entry || !Number.isSafeInteger(data.count) || data.count < 1) return;
					const key = script.id + "\n" + entry.id;
					const previous = record.compatibilityPending.get(key);
					if (!previous && record.compatibilityPending.size >= 512) { void flushCompatibility(record); }
					if (!previous || previous.count < data.count) record.compatibilityPending.set(key, {
						scriptId: script.id, scriptName: script.name, capabilityId: entry.id, count: data.count,
						argumentTypes: (Array.isArray(data.argumentTypes) ? data.argumentTypes : []).slice(0, 12).map(type => ["undefined", "null", "boolean", "number", "bigint", "string", "symbol", "function", "object"].includes(type) ? type : "unknown")
					});
					if (!record.compatibilityTimer) record.compatibilityTimer = hostWindow.setTimeout(function () { void flushCompatibility(record); }, 250);
					return;
				}
				if (data.type === "dsh-tavern-helper-diagnostic") {
					const diagnostic = { kind: "console", level: data.level === "error" ? "error" : "warn", scriptId: String(data.scriptId || ""), message: String(data.message || "").slice(0, 4000) };
					const pending = pendingEvents.get(String(data.eventId || ""));
					if (pending && pending.diagnostics) { if (pending.diagnostics.length < 50) pending.diagnostics.push(diagnostic); }
					else if (!data.eventId) invoke("recordMvuRuntimeDiagnostic", { diagnostic: diagnostic }, activeSessionId).catch(function () {});
					return;
				}
				if (data.type === "dsh-tavern-helper-ui-open") { openRecordUi(record); return; }
				if (data.type === "dsh-tavern-helper-ui-close") { closeRecordUi(); return; }
				if (data.type === "dsh-tavern-helper-subscriptions") {
					record.subscriptions = new Set((Array.isArray(data.names) ? data.names : []).map(String));
					const statuses = Array.isArray(data.scripts) ? data.scripts : [];
					for (const status of statuses) {
						const script = record.scripts.get(String(status && status.id || ""));
						if (!script) continue;
						script.subscriptionsReady = status.ready === true;
						script.initializationFailed = status.failed === true;
						if (script.subscriptionsReady && !script.initializationFailed) resolveError("人物卡脚本「" + script.name + "」", record.startedAt);
						if (script.id === "__dsh_official_mvu__" && (script.subscriptionsReady || script.initializationFailed)) {
							const phase = script.initializationFailed ? "initialization-failed" : "subscriptions-ready";
							if (record.mvuLastInitializationDiagnostic !== phase) recordMvuLoadDiagnostic(record, { phase: phase, message: mvuInitializationError(record) });
							record.mvuLastInitializationDiagnostic = phase;
							if (script.initializationFailed) {
								record.mvuLoadState = { phase: "error", canRetry: false, error: mvuInitializationError(record) };
								onMvuLoadState(record.mvuLoadState);
								settleInitialization(record);
							}
						}
					}
					if (statuses.length === 0 && record.scripts.size === 1 && data.ready === true) record.scripts.values().next().value.subscriptionsReady = true;
					if (data.ready === true) {
						record.initializationFailed = Boolean(record.scripts.get("__dsh_official_mvu__")?.initializationFailed);
						record.subscriptionsReady = !record.initializationFailed;
						if (!record.initializationFailed) resolveError("人物卡共享脚本沙箱", record.startedAt);
						settleInitialization(record);
					}
					syncMvuDataReadiness(record);
					return;
				}
				if (data.type === "dsh-tavern-helper-event-progress") {
					const pending = pendingEvents.get(String(data.eventId || ""));
					if (pending) pending.activeScriptId = data.phase === "completed" ? "" : String(data.scriptId || "");
					return;
				}
				if (data.type === "dsh-tavern-helper-event-complete") {
					const pending = pendingEvents.get(String(data.eventId || ""));
					if (!pending) return;
					pendingEvents.delete(String(data.eventId || ""));
					closeEventId(data.eventId);
					hostWindow.clearTimeout(pending.timer);
					if (data.error) {
						const script = record.scripts.get(String(data.scriptId || pending.activeScriptId || ""));
						const prefix = script ? "人物卡脚本「" + script.name + "」" : "共享脚本沙箱";
						const error = new Error(prefix + "处理事件「" + pending.name + "」失败：" + String(data.error));
						reportError(script ? "人物卡脚本「" + script.name + "」" : "人物卡共享脚本沙箱", error);
						pending.reject(error);
					} else pending.resolve(clone(Array.isArray(data.args) ? data.args : []));
					return;
				}
				if (data.type === "dsh-tavern-helper-bootstrap-failed") {
					const message = String(data.message || "人物卡脚本依赖加载失败");
					if (!record.subscriptionsReady && !record.initializationFailed) settleInitialization(record, new Error(message), "initialization-failed");
					return;
				}
				if (data.type === "dsh-tavern-helper-script-runtime") {
					const message = String(data.message || "人物卡脚本运行失败");
					const script = record.scripts.get(String(data.scriptId || ""));
					const source = script ? "人物卡脚本「" + script.name + "」" : "人物卡" + record.name;
					if (script && !script.subscriptionsReady) script.initializationError = message.slice(0, 4000);
					invoke("recordMvuRuntimeDiagnostic", { diagnostic: { level: "error", scriptId: String(data.scriptId || ""), message: message.slice(0, 4000) } }, activeSessionId).catch(function () {});
					if (message !== record.lastRuntimeError) { record.lastRuntimeError = message; reportError(source, new Error(message)); }
					return;
				}
				if (data.type !== "dsh-tavern-helper-call" || !allowedMethods.has(data.method)) return;
				if (data.eventId && closedEventIds.has(String(data.eventId))) {
					post(record, { type: "dsh-tavern-helper-response", requestId: data.requestId, ok: false, error: "事件已经结束，已拒绝迟到写入" });
					return;
				}
					let mutationArgs = data.args || {};
					if (data.method === "updateTavernHelperVariables" || data.method === "updateTavernHelperMessages" || data.method === "createTavernHelperMessages") {
						mutationArgs = Object.assign({}, mutationArgs, {
							eventId: String(data.eventId || ""),
							expectedLifecycleRevision: Math.max(0, Number(record.context && record.context.lifecycleRevision) || 0)
						});
				}
				invoke(data.method, mutationArgs, record.sessionId).then(function (result) {
					// Readiness follows acknowledged persistence, not an iframe's speculative variables.
					if (result && result.updated === true && !result.stale && !result.transactional && result.context && records.get(record.id) === record
						&& result.context.chatId === record.context.chatId
						&& Number(result.context.lifecycleRevision) === Number(record.context.lifecycleRevision)
						&& Number(result.context.stateRevision) >= Number(record.context.stateRevision)) {
						record.context = decorateHelperContext(result.context, record.context);
						syncMvuDataReadiness(record);
					}
					post(record, { type: "dsh-tavern-helper-response", requestId: data.requestId, ok: true, result: result });
					if ((data.method === "updateTavernHelperVariables" || data.method === "updateTavernHelperMessages" || data.method === "createTavernHelperMessages" || data.method === "replaceTavernHelperWorldbook" || data.method === "saveTavernExtensionSettings" || data.method === "saveTavernWorldInfo" || data.method === "saveTavernChatData") && result && result.updated !== false && result.stale !== true && records.get(record.id) === record) reportMutation(record.sessionId, data.method, result);
				}, function (error) {
					post(record, { type: "dsh-tavern-helper-response", requestId: data.requestId, ok: false, error: String(error && error.message || error) });
				});
			}
			hostWindow.addEventListener("message", receive);
			return Object.freeze({
				sync: sync,
				emit: emit,
				retryMvuLoad: function () {
					const record = records.get("shared");
					if (!record || !record.mvuLoadState || !record.mvuLoadState.canRetry) return false;
					record.mvuLoadState = { phase: "loading", canRetry: false, attempt: 1 };
					onMvuLoadState(record.mvuLoadState);
					post(record, { type: "dsh-tavern-mvu-reload" });
					return true;
				},
				flushCompatibilityDiagnostics: function () { return Promise.all(Array.from(records.values()).map(flushCompatibility)); },
				triggerButton: function (scriptId, name) {
					const record = records.get("shared");
					if (!record || !record.scripts.has(String(scriptId))) return Promise.reject(new Error("人物卡脚本尚未运行"));
					return emitToRecord(record, buttonEvent(scriptId, name), [], record.context);
				},
				dispose: function () { hostWindow.removeEventListener("message", receive); clear(); releaseHostStylesheetBridge(); },
				inspect: function () {
					const record = records.get("shared");
					const scripts = record ? Array.from(record.scripts.values()).map(function (script) { return { id: script.id, loaded: script.loaded, subscriptionsReady: script.subscriptionsReady, initializationFailed: script.initializationFailed }; }) : [];
					const initializationError = mvuInitializationError(record);
					return { sessionId: activeSessionId, frameCount: record ? 1 : 0, scriptIds: scripts.map(function (script) { return script.id; }), scripts: scripts, ...(record && record.scripts.has("__dsh_official_mvu__") ? { mvuDataReady: mvuDataReady(record) } : {}), ...(record && record.mvuLoadState ? { mvuLoadState: record.mvuLoadState } : {}), ...(initializationError ? { initializationError: initializationError } : {}) };
				}
			});
		}

		// The execution owner holds the lease, signal subscription and sandbox as one lifetime.
		// A new session (including A -> B -> A) gets a distinct lease identity.
		function createTavernScriptExecutionModule(options) {
			const hostWindow = options && options.window || window;
			const invoke = options && options.rpc || rpc;
			const signals = options && options.signals || tavernSessionSignals;
			const invalidate = options && options.invalidate || function (sessionId) { liveTavernView.invalidate(sessionId); };
			const createRuntime = options && options.createRuntime || createTavernHelperScriptRuntime;
			const requestTimeoutMs = Math.max(100, Number(options && (options.requestTimeoutMs || options.pollRequestTimeoutMs)) || 3000);
			const startHeartbeat = options && options.startHeartbeat || (typeof hostWindow.setInterval === "function" ? function (run, delay) { return hostWindow.setInterval(run, delay); } : null);
			const stopHeartbeat = options && options.stopHeartbeat || (typeof hostWindow.clearInterval === "function" ? function (timer) { hostWindow.clearInterval(timer); } : function () {});
			const heartbeatIntervalMs = Math.max(1000, Number(options && options.heartbeatIntervalMs) || 30000);
			let runtime = null;
			let lease = null;
			let workStop = null;
				let heartbeatTimer = null;
				let claimRetryTimer = null;
			let releaseBarrier = Promise.resolve();
			let releasesPending = 0;
			let claimBusy = null;
			let claimRequested = false;
			let claimRetryCount = 0;
			let active = false;
			let input = null;

			function inactiveView(view) {
				return Object.assign({}, view || {}, { tavernHelperScripts: [], tavernMvuRuntime: null });
			}
			function hasScriptRuntime(view) {
				return Boolean(
					(Array.isArray(view && view.tavernHelperScripts) && view.tavernHelperScripts.length > 0)
					|| (view && view.tavernMvuRuntime && view.tavernMvuRuntime.owner === "official")
				);
			}
			function releaseLease(previousLease) {
				if (!previousLease || !previousLease.sessionId) return Promise.resolve();
				releasesPending += 1;
				const request = Promise.resolve(invoke("releaseTavernHelperRuntime", { runtimeId: previousLease.id }, previousLease.sessionId, { keepalive: true }))
					.catch(function () {})
					.finally(function () { releasesPending -= 1; });
				releaseBarrier = Promise.all([releaseBarrier, request]).then(function () {});
				return request;
			}
			function dispose() {
				const previousLease = lease;
				lease = null;
				input = null;
				active = false;
					claimRequested = false;
					claimRetryCount = 0;
					if (claimRetryTimer !== null) hostWindow.clearTimeout(claimRetryTimer);
					claimRetryTimer = null;
				if (workStop) workStop();
				workStop = null;
				if (heartbeatTimer !== null) stopHeartbeat(heartbeatTimer);
				heartbeatTimer = null;
				if (runtime) runtime.dispose();
				runtime = null;
				if (options && options.onMvuLoadState) options.onMvuLoadState(null);
				releaseLease(previousLease);
			}
			function ensureRuntime(sessionId) {
				if (runtime) return runtime;
				lease = { sessionId: sessionId, id: hostWindow.crypto && typeof hostWindow.crypto.randomUUID === "function" ? hostWindow.crypto.randomUUID() : String(Date.now()) + ":" + String(Math.random()) };
				const currentLease = lease;
				runtime = createRuntime({
					window: hostWindow, rpc: invoke, onMutation: invalidate,
					onMvuLoadState: function (state) {
						if (lease !== currentLease) return;
						if (options && options.onMvuLoadState) options.onMvuLoadState(state);
						void claimWork();
					},
					onReady: function (readySessionId) {
						if (lease !== currentLease || !readySessionId || !input || input.sessionId !== readySessionId) return;
						const chatId = String(input.view && input.view.chatId || "");
						// MVU uses this identity to invalidate older asynchronous initialization.
						// An absent ID cancels the real chat's startup without initializing a replacement.
						if (!chatId) { void claimWork(); return; }
						return Promise.resolve(runtime.emit("CHAT_CHANGED", [chatId], input.view && input.view.tavernHelper)).finally(function () { void claimWork(); });
					}
				});
				if (signals && typeof signals.subscribe === "function") {
					workStop = signals.subscribe(sessionId, "runtime-work", function () { void claimWork(); }, function (error) { console.warn("Tavern Script signal 连接正在恢复", error); }, function () { void claimWork(); });
				}
				return runtime;
			}
				function invokeWithDeadline(method, currentLease, inspection, extra) {
				const Controller = hostWindow.AbortController;
				const controller = typeof Controller === "function" ? new Controller() : null;
				let deadlineTimer = null;
				const request = Promise.resolve().then(function () {
						return invoke(method, Object.assign({ runtimeId: currentLease.id, ready: tavernScriptRuntimeReady(inspection), ...(inspection.initializationError ? { initializationError: inspection.initializationError } : {}) }, extra || {}), currentLease.sessionId, controller ? { signal: controller.signal } : undefined);
				});
				const deadline = new Promise(function (_resolve, reject) {
					deadlineTimer = hostWindow.setTimeout(function () {
						if (controller) controller.abort();
						reject(new Error("Tavern Script Host 请求超时"));
					}, requestTimeoutMs);
				});
				return Promise.race([request, deadline]).finally(function () {
					if (deadlineTimer !== null) hostWindow.clearTimeout(deadlineTimer);
				});
				}
				function scheduleClaimRetry(currentLease) {
					if (lease !== currentLease || claimRetryTimer !== null || claimRetryCount >= 6) return;
					const delay = Math.min(2000, 250 * Math.pow(2, claimRetryCount++));
					claimRetryTimer = hostWindow.setTimeout(function () {
						claimRetryTimer = null;
						if (lease === currentLease) void claimWork();
					}, delay);
				}
				async function claimWork() {
				if (!lease || !runtime || !input || !input.sessionId || !hasScriptRuntime(input.view)) return;
				const currentLease = lease;
				const currentRuntime = runtime;
				if (claimBusy === currentLease) { claimRequested = true; return; }
				claimBusy = currentLease;
					let currentEvent = null;
					let leaseToken = "";
				const diagnostics = [];
				try {
					if (releasesPending > 0) await releaseBarrier;
					if (lease !== currentLease) return;
					const result = await invokeWithDeadline("claimTavernScriptWork", currentLease, currentRuntime.inspect());
					if (lease !== currentLease) {
						if (result && result.active) releaseLease(currentLease);
						return;
					}
					if (result && result.active) claimRetryCount = 0;
					else scheduleClaimRetry(currentLease);
					if (Boolean(result && result.active) !== active) {
						active = Boolean(result && result.active);
						currentRuntime.sync(input.sessionId, active ? input.view : inactiveView(input.view));
					}
						currentEvent = result && result.event;
						leaseToken = String(result && result.leaseToken || "");
						if (active && currentEvent) {
							const started = await invokeWithDeadline("startTavernScriptWork", currentLease, currentRuntime.inspect(), { eventId: currentEvent.id, leaseToken: leaseToken });
							if (!started || started.started !== true) throw new Error("Tavern Script 工作租约已失效");
							const args = await currentRuntime.emit(currentEvent.name, currentEvent.args, currentEvent.context, diagnostics, currentEvent.id);
							if (lease !== currentLease) return;
							await invoke("completeTavernHelperEvent", { eventId: currentEvent.id, leaseToken: leaseToken, args: args, runtimeId: currentLease.id, diagnostics: diagnostics }, currentLease.sessionId);
						}
				} catch (error) {
					if (lease !== currentLease) return;
					console.warn("Tavern Helper 生命周期同步失败", error);
					if (currentEvent) {
						try {
								await invoke("completeTavernHelperEvent", { eventId: currentEvent.id, leaseToken: leaseToken, args: currentEvent.args, error: String(error && error.message || error), runtimeId: currentLease.id, diagnostics: diagnostics }, currentLease.sessionId);
							} catch (completeError) { console.warn("Tavern Helper 失败回执同步失败", completeError); }
						}
						scheduleClaimRetry(currentLease);
				} finally {
					if (claimBusy === currentLease) claimBusy = null;
					if (lease === currentLease && claimRequested) { claimRequested = false; void claimWork(); }
				}
			}
			async function heartbeat() {
				if (!lease || !runtime || !input) return;
				const currentLease = lease;
				try {
					const result = await invokeWithDeadline("heartbeatTavernScriptRuntime", currentLease, runtime.inspect());
					if (lease === currentLease && Boolean(result && result.active) !== active) {
						active = Boolean(result && result.active);
						runtime.sync(input.sessionId, active ? input.view : inactiveView(input.view));
					}
				}
				catch (error) { if (lease === currentLease) console.warn("Tavern Script lease 心跳失败", error); }
			}
			function sync(sessionId, view) {
				const nextSessionId = String(sessionId || "");
				if (!nextSessionId || !hasScriptRuntime(view)) { dispose(); return; }
				if (input && input.sessionId !== nextSessionId) dispose();
				const currentRuntime = ensureRuntime(nextSessionId);
				input = { sessionId: nextSessionId, view: view };
				currentRuntime.sync(nextSessionId, active ? view : inactiveView(view));
				if (heartbeatTimer === null && startHeartbeat) heartbeatTimer = startHeartbeat(function () { void heartbeat(); }, heartbeatIntervalMs);
				void claimWork();
			}
			return Object.freeze({
				sync: sync, dispose: dispose,
				retryMvuLoad: function () { return Boolean(runtime && active && runtime.retryMvuLoad()); },
				triggerButton: function (scriptId, name) {
					if (!runtime || !active) return Promise.reject(new Error("人物卡脚本正在其他窗口运行，或尚未加载完成"));
					return runtime.triggerButton(scriptId, name);
				},
				inspect: function () { return { active: active, input: input, runtime: runtime && runtime.inspect() }; }
			});
		}

		function tavernScriptRuntimeReady(inspection) {
			if (inspection && (inspection.initializationError || inspection.mvuDataReady === false)) return false;
			const scripts = inspection && Array.isArray(inspection.scripts) ? inspection.scripts : [];
			return scripts.length > 0 && scripts.every(function (script) {
				if (script && script.id === "__dsh_official_mvu__" && script.initializationFailed === true) return false;
				return script && (script.subscriptionsReady === true || script.initializationFailed === true);
			});
		}

		// The selected game's executor belongs to the plugin, not its disposable header.
		// Descendant navigation shares its owner; unrelated games never share a sandbox.
		function createTavernScriptSessionOwner(options) {
			const hostWindow = options.window || window;
			const sessions = options.sessions;
			const views = options.liveView || liveTavernView;
			const transition = options.transition || tavernSessionTransition;
			const listeners = new Set();
			let snapshot = { sessionId: "", loadState: null };
			let current = null, stopView = null, stopSessions = null, stopTransition = null;
			let started = false, observing = false;
			const execution = (options.createExecution || createTavernScriptExecutionModule)({
				window: hostWindow, rpc: options.rpc || rpc,
				signals: options.signals || tavernSessionSignals,
				invalidate: function (sessionId) { views.invalidate(sessionId); },
				onMvuLoadState: function (state) { publish(current ? current.sessionId : "", state); }
			});
			function publish(sessionId, loadState) {
				if (snapshot.sessionId === sessionId && snapshot.loadState === loadState) return;
				snapshot = { sessionId: sessionId, loadState: loadState };
				listeners.forEach(function (listener) { listener(); });
			}
			function selectedOwner() {
				let id = String(sessions.list.getSnapshot().current || "");
				const seen = new Set();
				while (id) {
					if (seen.has(id) || seen.size >= 32) return "";
					seen.add(id);
					const address = sessions.subagentAddress(id);
					if (!address) return id;
					if (address.childSessionId !== id) return "";
					id = String(address.parentSessionId || "");
				}
				return "";
			}
			function release() {
				current = null;
				if (stopView) stopView();
				stopView = null;
				execution.dispose();
				publish("", null);
			}
			function syncView() {
				if (!current || transition.getSnapshot()) return;
				const state = current.viewState;
				if (state && state.phase === "ready") execution.sync(current.sessionId, state.view || {});
			}
			function select() {
				if (!observing) return;
				const sessionId = selectedOwner();
				if ((current ? current.sessionId : "") === sessionId) return;
				release();
				if (!sessionId) return;
				const record = { sessionId: sessionId, viewState: null };
				current = record;
				publish(sessionId, null);
				stopView = views.subscribe(sessionId, function (state) {
					// Identity, not just the id: an old A response must not enter a new A lifetime.
					if (current !== record) return;
					record.viewState = state;
					syncView();
				});
			}
			function resume() {
				if (!started || observing) return;
				observing = true;
				stopSessions = sessions.list.subscribe(select);
				stopTransition = transition.subscribe(syncView);
				select();
			}
			function suspend() {
				observing = false;
				if (stopSessions) stopSessions();
				if (stopTransition) stopTransition();
				stopSessions = stopTransition = null;
				release();
			}
			return Object.freeze({
				start: function () {
					if (started) return;
					started = true;
					hostWindow.addEventListener("pagehide", suspend);
					hostWindow.addEventListener("pageshow", resume);
					resume();
				},
				dispose: function () {
					started = false;
					hostWindow.removeEventListener("pagehide", suspend);
					hostWindow.removeEventListener("pageshow", resume);
					suspend();
				},
				subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
				getSnapshot: function () { return snapshot; },
				retryMvuLoad: function () { return execution.retryMvuLoad(); }
			});
		}

		function TavernScriptRuntime(props) {
			const owner = props.owner;
			const state = React.useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
			if (!state.sessionId || !state.loadState) return null;
			return React.createElement(TavernMvuLoadRecovery, { state: state.loadState, retry: owner.retryMvuLoad });
		}

		function TavernMvuLoadRecovery(props) {
			const state = props.state;
			if (!state || state.phase === "ready") return null;
			const failed = state.phase === "failed" || state.phase === "error";
			return React.createElement("div", { role: failed ? "alert" : "status", style: { padding: "8px 12px", fontSize: "13px", maxWidth: "min(420px, 80vw)" } },
				React.createElement("div", null, state.phase === "failed" ? "MVU 下载失败，已自动重试两次。变量结算已暂停，重新加载成功后会自动继续。" : state.phase === "error" ? "MVU 初始化失败，请刷新页面或重启酒馆。为避免重复修改变量，不自动重跑初始化。" : state.phase === "evaluating" ? "正在初始化 MVU…" : "正在加载 MVU…" + (state.attempt > 1 ? "（自动重试 " + (state.attempt - 1) + "/2）" : "")),
				failed && state.error ? React.createElement("div", { style: { opacity: 0.7, overflowWrap: "anywhere" } }, state.error) : null,
				state.canRetry ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", onClick: props.retry }, "重新加载 MVU") : null);
		}

		const TAVERN_FRAME_MAX_HEIGHT = 1200;
		function clampTavernFrameHeight(value) {
			return Math.max(48, Math.min(TAVERN_FRAME_MAX_HEIGHT, Math.ceil(Number(value) || 48)));
		}
		function estimatedTavernFrameHeight(content) {
			const chars = String(content || "").length;
			return clampTavernFrameHeight(Math.max(160, Math.min(1200, 160 + Math.ceil(chars / 80) * 18)));
		}
		function tavernFrameHeightKey(props) {
			return ["dsh-tavern-frame-height", String(props.sessionId || ""), String(props.turn || 0), String(props.partIndex || 0), String(String(props.content || "").length)].join(":");
		}
		function restoredTavernFrameHeight(key, content) {
			try {
				const saved = Number(window.sessionStorage.getItem(key));
				if (Number.isFinite(saved) && saved >= 48) return clampTavernFrameHeight(saved);
			} catch (_) {}
			return estimatedTavernFrameHeight(content);
		}

		function nextTavernFrameToken() {
			return window.crypto && typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID() : String(Date.now()) + ":" + String(Math.random());
		}

		function createTavernHelperContextUpdate(previous, next, previousTurn, nextTurn) {
			function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
			function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
			const target = next && typeof next === "object" ? next : null;
			if (!target) return null;
			const turn = Math.max(0, Number(nextTurn) || 0);
			if (!previous || Number(previous.version) !== Number(target.version) || Number(target.stateRevision) < Number(previous.stateRevision)) {
				// Recovery replaces the view's state too; notify read-only renderers after installation.
				return { version: 1, kind: "snapshot", stateRevision: Math.max(0, Number(target.stateRevision) || 0), turn: turn, context: clone(target), events: ["MESSAGE_UPDATED", "mag_variable_update_ended"] };
			}
			const operations = [];
			const beforeMessages = Array.isArray(previous.messages) ? previous.messages : [];
			const afterMessages = Array.isArray(target.messages) ? target.messages : [];
			const shared = Math.min(beforeMessages.length, afterMessages.length);
			let variablesChanged = false;
			for (let index = 0; index < shared; index += 1) {
				if (same(beforeMessages[index], afterMessages[index])) continue;
				operations.push({ op: "message.replace", index: index, value: clone(afterMessages[index]) });
				if (!same(beforeMessages[index] && beforeMessages[index].variables, afterMessages[index] && afterMessages[index].variables)) variablesChanged = true;
			}
			if (afterMessages.length > shared) operations.push({ op: "messages.append", values: clone(afterMessages.slice(shared)) });
			if (afterMessages.length < beforeMessages.length) operations.push({ op: "messages.truncate", length: afterMessages.length });
			for (const key of ["turnMessageIds", "chatVariables", "scriptVariables", "lifecycleRevision"]) {
				if (same(previous[key], target[key])) continue;
				operations.push({ op: "value.replace", key: key, value: clone(target[key]) });
				if (key === "chatVariables" || key === "scriptVariables") variablesChanged = true;
			}
			const stateRevision = Math.max(0, Number(target.stateRevision) || 0);
			if (operations.length === 0 && Number(previousTurn) === turn && Number(previous.stateRevision) === stateRevision) return null;
			const events = [];
			if (afterMessages.length > beforeMessages.length && afterMessages.slice(beforeMessages.length).some(function (message) { return message && message.role === "assistant"; })) events.push("MESSAGE_RECEIVED");
			if (operations.length > 0) events.push("MESSAGE_UPDATED");
			if (variablesChanged) events.push("mag_variable_update_ended");
			return { version: 1, kind: "patch", baseRevision: Math.max(0, Number(previous.stateRevision) || 0), stateRevision: stateRevision, turn: turn, operations: operations, events: events };
		}

		function applyTavernHelperContextUpdate(previous, update) {
			function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
			if (!update || Number(update.version) !== 1) throw new Error("不支持的 Helper Context 更新协议");
			if (update.kind === "snapshot") return { context: clone(update.context || {}), turn: Math.max(0, Number(update.turn) || 0), events: Array.isArray(update.events) ? update.events.slice() : [] };
			const before = previous && typeof previous === "object" ? previous : {};
			if (update.kind !== "patch" || Math.max(0, Number(before.stateRevision) || 0) !== Math.max(0, Number(update.baseRevision) || 0)) throw new Error("Helper Context 版本失配");
			const context = clone(before);
			if (!Array.isArray(context.messages)) context.messages = [];
			for (const operation of Array.isArray(update.operations) ? update.operations : []) {
				if (operation.op === "message.replace") context.messages[Math.max(0, Number(operation.index) || 0)] = clone(operation.value);
				else if (operation.op === "messages.append") context.messages.push(...clone(Array.isArray(operation.values) ? operation.values : []));
				else if (operation.op === "messages.truncate") context.messages.length = Math.max(0, Number(operation.length) || 0);
				else if (operation.op === "value.replace") context[operation.key] = clone(operation.value);
			}
			context.stateRevision = Math.max(0, Number(update.stateRevision) || 0);
			return { context: context, turn: Math.max(0, Number(update.turn) || 0), events: Array.isArray(update.events) ? update.events.slice() : [] };
		}

		// One transport per document: a loading iframe retains its bootstrap baseline.
		// State changes are coalesced until ready; recovery uses the same wire protocol.
		function createTavernFrameContextChannel(document) {
			let node = null;
			let ready = false;
			let current = { context: document.helperContext, turn: document.turn };
			return Object.freeze({
				attach: function (value) {
					node = value;
					if (!value) { ready = false; current = { context: document.helperContext, turn: document.turn }; }
				},
				accepts: function (event) { return Boolean(node && node.contentWindow && event.source === node.contentWindow && event.data && event.data.token === document.token); },
				element: function () { return node; },
				sync: function (context, turn, mode) {
					if (mode === "ready") ready = true;
					if (!ready || !node || !node.contentWindow || !context) return;
					const update = createTavernHelperContextUpdate(mode === "snapshot" ? null : current.context, context, current.turn, turn);
					if (!update) return;
					node.contentWindow.postMessage({ type: "dsh-tavern-helper-context-update", token: document.token, update: update }, "*");
					current = { context: context, turn: turn };
				}
			});
		}

		// Owns document replacement, authenticated frame messages and their cleanup.
		// React only renders the visible/pending documents and controls lazy activation.
		function createTavernMessageFrameLifecycle(initial, options) {
			const hostWindow = options && options.window || window;
			const invoke = options && options.rpc || rpc;
			const configuredSlashExecutor = options && options.executeSlash;
			const invalidate = options && options.invalidate || function (sessionId) { liveTavernView.invalidate(sessionId); };
			const channels = new Map();
			let props = initial;
			let frozenHelperContext = initial.helperContext;
			let helperContext = frozenHelperContext;
			let refreshRevision = 0;
			let runtimeTimer = null;
			let pendingRuntime = null;
			let listener = null;
			let lifetime = 0;
			let synchronizationKey = "";
			let lastFontSize = null;
			let documentInputs = null;
			let cachedDocumentKey = "";
			let desired = createDocument();
			let visible = desired;
			let pending = null;
			let height = restoredTavernFrameHeight(visible.heightKey, visible.content);
			function documentKey() {
				const values = [props.sessionId, props.content, props.persistent === true ? 0 : props.turn, props.observeMvuView, props.runtimeReporting, props.persistent, props.trustedCardMode, Boolean(props.helperContext), refreshRevision];
				if (!documentInputs || values.some(function (value, index) { return value !== documentInputs[index]; })) {
					documentInputs = values;
					cachedDocumentKey = JSON.stringify(values);
				}
				return cachedDocumentKey;
			}
			function createDocument() {
				const document = {
					key: documentKey(), token: nextTavernFrameToken(),
					helperContext: helperContext, turn: props.turn,
					heightKey: tavernFrameHeightKey(props), content: props.content,
					trustedCardMode: props.trustedCardMode, refreshRequested: false
				};
				document.html = buildTavernFrameDocument({ content: props.content, token: document.token, helperContext: helperContext, turn: props.turn, observeMvuView: props.observeMvuView, runtimeReporting: props.runtimeReporting, persistent: props.persistent });
				const channel = createTavernFrameContextChannel(document);
				// Stable callback identity preserves the per-document delta baseline.
				document.ref = function (node) {
					channel.attach(node);
					if (node) channels.set(document.token, channel);
					else channels.delete(document.token);
				};
				return document;
			}
			function snapshot() { return { visibleDocument: visible, pendingDocument: pending, height: height }; }
			function publish() { if (listener) listener(snapshot()); }
			function cancelRuntimeReport() {
				if (runtimeTimer !== null) hostWindow.clearTimeout(runtimeTimer);
				runtimeTimer = null;
				pendingRuntime = null;
			}
			function sendContext(document, mode) {
				const channel = document && channels.get(document.token);
				if (channel) channel.sync(helperContext, props.turn, mode);
			}
			function sendFontSize(document) {
				const body = hostWindow.document && hostWindow.document.body;
				if (!body || typeof hostWindow.getComputedStyle !== "function") return;
				const value = parseFloat(hostWindow.getComputedStyle(body).getPropertyValue("--dsh-content-font-size"));
				const fontSize = Number.isFinite(value) && value >= 8 && value <= 48 ? value : 14;
				if (!document && fontSize === lastFontSize) return;
				lastFontSize = fontSize;
				channels.forEach(function (channel, token) {
					if (document && token !== document.token) return;
					const node = channel.element();
					if (node && node.contentWindow) node.contentWindow.postMessage({ type: "dsh-tavern-font-size", token: token, fontSize: fontSize }, "*");
				});
			}
			function reconcile() {
				if (desired.key === visible.key) {
					if (pending) { pending = null; publish(); }
				} else if (!pending || pending.key !== desired.key) {
					pending = desired;
					publish();
				}
			}
			function update(next) {
				const sessionChanged = props.sessionId !== next.sessionId;
				if (sessionChanged || props.turn !== next.turn || props.partIndex !== next.partIndex) {
					lifetime++;
					cancelRuntimeReport();
				}
				props = next;
				if (sessionChanged || props.eager === true) frozenHelperContext = props.helperContext;
				helperContext = props.eager === true ? props.helperContext : frozenHelperContext;
				if (desired.key !== documentKey()) desired = createDocument();
				if (sessionChanged) {
					// Never keep an old conversation's page eligible for writes in a new one.
					channels.clear();
					visible = desired; pending = null;
					height = restoredTavernFrameHeight(visible.heightKey, visible.content);
					publish();
				} else reconcile();
				const contextKey = helperContext ? [helperContext.version, helperContext.stateRevision, helperContext.lifecycleRevision].map(function (value) { return String(Number(value) || 0); }).join(":") : "";
				const nextSynchronizationKey = visible.token + ":" + String(props.turn) + ":" + contextKey;
				// Height changes and parent rerenders must not rescan the message history.
				if (nextSynchronizationKey !== synchronizationKey) {
					synchronizationKey = nextSynchronizationKey;
					sendContext(visible);
				}
			}
			function rememberHeight(document, value) {
				height = value;
				try { hostWindow.sessionStorage.setItem(document.heightKey, value); } catch (_) {}
			}
			function receive(event) {
				const data = event && event.data;
				const channel = data && channels.get(data.token);
				if (!channel || !channel.accepts(event)) return;
				const sourceDocument = visible.token === data.token ? visible : (pending && pending.token === data.token ? pending : null);
				if (!sourceDocument) return;
				const requestProps = props;
				const requestLifetime = lifetime;
				function current() { return lifetime === requestLifetime && channels.get(data.token) === channel && (visible === sourceDocument || pending === sourceDocument); }
				if (data.type === "dsh-tavern-status-stale" && props.persistent === true && sourceDocument.key === desired.key && !sourceDocument.refreshRequested) {
					sourceDocument.refreshRequested = true;
					refreshRevision++;
					desired = createDocument();
					reconcile();
					return;
				}
				if (data.type === "dsh-tavern-frame-ready") {
					sendFontSize(sourceDocument);
					sendContext(sourceDocument, "ready");
					if (sourceDocument === pending && pending.key === desired.key) {
						rememberHeight(pending, pending.height || restoredTavernFrameHeight(pending.heightKey, pending.content));
						visible = pending; pending = null;
						publish();
					}
				} else if (data.type === "dsh-tavern-frame-height") {
					sourceDocument.height = clampTavernFrameHeight(data.height);
					if (sourceDocument === visible) { rememberHeight(visible, sourceDocument.height); publish(); }
				} else if (data.type === "dsh-tavern-helper-context-request") {
					sendContext(sourceDocument, "snapshot");
				} else if (data.type === "dsh-tavern-mvu-view-used" && props.observeMvuView !== false && props.sessionId && props.turn > 0) {
					invoke("captureDisplayRuntime", { turn: props.turn, partIndex: props.partIndex, runtime: { capturedAt: Date.now(), mvuViewUsed: true } }, props.sessionId).then(function (result) {
						if (current() && result && result.captured === true) invalidate(requestProps.sessionId);
					}, function () {});
				} else if (data.type === "dsh-tavern-frame-runtime" && props.runtimeReporting !== false && props.sessionId && props.turn > 0) {
					pendingRuntime = data.runtime;
					if (runtimeTimer === null) runtimeTimer = hostWindow.setTimeout(function () {
						runtimeTimer = null;
						const runtime = pendingRuntime; pendingRuntime = null;
						if (current()) invoke("captureDisplayRuntime", { turn: requestProps.turn, partIndex: requestProps.partIndex, runtime: runtime }, requestProps.sessionId).catch(function () {});
					}, 1000);
				} else if (data.type === "dsh-tavern-helper-call" && props.sessionId) {
					const allowedMethods = new Set(["updateTavernHelperVariables", "updateTavernHelperMessages", "getTavernHelperWorldbook", "replaceTavernHelperWorldbook"]);
					if (data.method === "triggerTavernSlash") {
						const executeSlash = configuredSlashExecutor || requestProps.executeSlash;
						if (typeof executeSlash !== "function") return;
						executeSlash(String(data.args && data.args.line || ""), props.sessionId).then(function (result) {
							return invoke("getSession", {}, props.sessionId).then(function (snapshot) {
								const context = snapshot && snapshot.view && snapshot.view.tavernHelper;
								if (context) helperContext = context;
								return Object.assign({}, result || {}, context ? { context: context } : {});
							});
						}).then(function (result) {
							if (current()) event.source.postMessage({ type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: true, result: result }, "*");
						}, function (error) {
							if (current()) event.source.postMessage({ type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: false, error: String(error && error.message || error) }, "*");
						});
						return;
					}
					if (!allowedMethods.has(data.method)) return;
					const args = Object.assign({}, data.args || {}, { sessionId: props.sessionId, expectedLifecycleRevision: Math.max(0, Number(helperContext && helperContext.lifecycleRevision) || 0) });
					invoke(data.method, args, props.sessionId).then(function (result) {
						if (current()) event.source.postMessage({ type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: true, result: result }, "*");
					}, function (error) {
						if (current()) event.source.postMessage({ type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: false, error: String(error && error.message || error) }, "*");
					});
				}
			}
			return Object.freeze({
				update: update, snapshot: snapshot,
				start: function (onChange) {
					listener = onChange;
					hostWindow.addEventListener("message", receive);
					let fontObserver = null;
					if (hostWindow.document && typeof hostWindow.MutationObserver === "function") {
						fontObserver = new hostWindow.MutationObserver(function () { sendFontSize(); });
						[hostWindow.document.documentElement, hostWindow.document.body].filter(Boolean).forEach(function (node) { fontObserver.observe(node, { attributes: true, attributeFilter: ["style", "class"] }); });
					}
					return function () {
						if (fontObserver) fontObserver.disconnect();
						listener = null; lifetime++;
						hostWindow.removeEventListener("message", receive);
						cancelRuntimeReport();
					};
				}
			});
		}

		function TavernMessageFrame(props) {
			const slotRef = React.useRef(null);
			const lifecycleRef = React.useRef(null);
			if (!lifecycleRef.current) lifecycleRef.current = createTavernMessageFrameLifecycle(props);
			const lifecycle = lifecycleRef.current;
			const [state, setState] = React.useState(lifecycle.snapshot);
			const visibleDocument = state.visibleDocument;
			const pendingDocument = state.pendingDocument;
			const height = state.height;
			const [activated, setActivated] = React.useState(props.eager === true);
			React.useEffect(function () { return lifecycle.start(setState); }, [lifecycle]);
			React.useEffect(function () { lifecycle.update(props); });
			React.useEffect(function () {
				if (props.eager === true) { setActivated(true); return; }
				if (activated || typeof window.IntersectionObserver !== "function") { setActivated(true); return; }
				let observer = null;
				const timer = window.setTimeout(function () {
					if (!slotRef.current) return;
					observer = new window.IntersectionObserver(function (entries) {
						if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
						setActivated(true);
						observer.disconnect();
					}, { rootMargin: "240px 0px" });
					observer.observe(slotRef.current);
				}, 120);
				return function () { window.clearTimeout(timer); if (observer) observer.disconnect(); };
			}, [activated, props.eager]);
			function renderFrame(document, hidden) {
				if (!document) return null;
				const pendingHeight = document.height || height;
				return React.createElement("iframe", {
					key: document.token,
					ref: document.ref,
					className: "dsh-tavern-message-frame",
					title: hidden ? "正在准备人物卡消息界面" : "人物卡消息界面",
					"aria-hidden": hidden || undefined,
					sandbox: document.trustedCardMode ? undefined : "allow-scripts",
					referrerPolicy: "no-referrer",
					loading: "lazy",
					srcDoc: document.html,
					style: hidden
						? { position: "absolute", left: 0, top: 0, width: "100%", height: pendingHeight + "px", opacity: 0, pointerEvents: "none" }
						: { height: height + "px", overflow: height >= TAVERN_FRAME_MAX_HEIGHT ? "auto" : "hidden" }
				});
			}
			const frames = activated ? [renderFrame(visibleDocument, false), renderFrame(pendingDocument, true)] : null;
			return React.createElement("div", { ref: slotRef, className: "dsh-tavern-message-frame-slot", style: { position: "relative", height: height + "px" } }, frames);
		}

		function tavernProjectionForTurn(view, turn) {
			if (!view || !isPlayMode(view.mode) || !Array.isArray(view.replyProjections)) return null;
			for (let index = view.replyProjections.length - 1; index >= 0; index -= 1) {
				const projection = view.replyProjections[index];
				if (Number(projection && projection.turn) === Number(turn)) return Number(projection.version) === 1 || Number(projection.version) === 2 ? projection : null;
			}
			return null;
		}

		function tavernStoryTurnForDshTurn(view, turn) {
			const mappings = view && view.regeneratedDshTurns && typeof view.regeneratedDshTurns === "object" ? view.regeneratedDshTurns : {};
			for (const storyTurn of Object.keys(mappings)) {
				if (Number(mappings[storyTurn]) === Number(turn)) return Number(storyTurn);
			}
			return Number(turn);
		}

		function tavernMvuReceiptForTurn(view, turn) {
			const receipts = view && Array.isArray(view.mvuReceipts) ? view.mvuReceipts : [];
			for (let index = receipts.length - 1; index >= 0; index -= 1) {
				if (Number(receipts[index] && receipts[index].turn) === Number(turn)) return receipts[index].receipt || null;
			}
			return null;
		}

		function TavernMvuReceipt(props) {
			const h = React.createElement;
			const [retrying, setRetrying] = React.useState(false);
			const receipt = props.receipt || {};
			const changes = Array.isArray(receipt.changes) ? receipt.changes : [];
			// MVU display/delta mirrors and schema maintenance stay in receipts for diagnostics,
			// but are not extra gameplay changes worth showing to players.
			const sideEffects = (Array.isArray(receipt.sideEffects) ? receipt.sideEffects : []).filter(function (change) {
				return !/^\/(?:delta_data|display_data|schema)(?:\/|$)/.test(String(change && change.path || ""));
			});
			const failures = Array.isArray(receipt.failures) ? receipt.failures : [];
			const status = ["pending", "updated", "partial", "error", "stale", "interrupted", "unchanged"].includes(receipt.status) ? receipt.status : "unchanged";
			const sideEffectSuffix = sideEffects.length > 0 ? " · 人物卡联动 " + sideEffects.length + " 项" : "";
			const labels = {
				pending: "变量结算中…",
				interrupted: "变量结算已中断",
				updated: (changes.length > 0 ? "变量已更新 · " + changes.length + " 项" : "变量已更新 · 旧记录无明细") + sideEffectSuffix,
				partial: "变量部分更新 · " + changes.length + " 项成功 · " + failures.length + " 项失败" + sideEffectSuffix,
				error: "变量更新失败 · " + failures.length + " 项" + sideEffectSuffix,
				stale: "变量结算已过期，未覆盖当前状态",
				unchanged: (sideEffects.length > 0 ? "Agent 未更新变量" : "本轮变量未更新") + sideEffectSuffix
			};
			const operationLabels = { set: "设置", replace: "设置", add: "新增", delta: "增减", insert: "新增", delete: "删除", remove: "删除", move: "移动" };
			const summary = h("div", { className: "dsh-tavern-mvu-receipt-summary" }, h("span", { className: "dsh-tavern-mvu-receipt-dot" }), h("span", null, labels[status]));
			async function retry() {
				if (retrying) return;
				setRetrying(true);
				try {
					await rpc("retrySettlement", { turn: props.turn }, props.sessionId);
					liveTavernView.invalidate(props.sessionId);
				} catch (error) { tavernErrorHub.report("重试变量结算", error); }
				finally { setRetrying(false); }
			}
			const retryButton = (status === "error" || status === "stale" || status === "interrupted" || status === "partial")
				? h("button", { type: "button", className: "dsh-tavern-mvu-retry", disabled: retrying, onClick: retry }, retrying ? "重试中…" : "重试变量结算")
				: null;
			const hasDetails = String(receipt.summary || "") !== "" || changes.length > 0 || sideEffects.length > 0 || failures.length > 0 || retryButton;
			if (!hasDetails) return h("div", { className: "dsh-tavern-mvu-receipt", "data-status": status }, summary);
			return h("details", { className: "dsh-tavern-mvu-receipt", "data-status": status },
				h("summary", { className: "dsh-tavern-mvu-receipt-summary" }, h("span", { className: "dsh-tavern-mvu-receipt-dot" }), h("span", null, labels[status])),
				h("div", { className: "dsh-tavern-mvu-receipt-body" },
					receipt.summary ? h("div", { className: "dsh-tavern-mvu-receipt-reason" }, "原因：" + String(receipt.summary)) : null,
					changes.map(function (change, index) { return h("div", { key: "change:" + index, className: "dsh-tavern-mvu-change" },
						h("div", { className: "dsh-tavern-mvu-change-path" }, (operationLabels[change.operation] || "更新") + " " + String(change.path || "/")),
						h("div", { className: "dsh-tavern-mvu-change-values" }, String(change.before) + " → " + String(change.after))
					); }),
					sideEffects.length > 0 ? h("div", { className: "dsh-tavern-mvu-side-effect-title" }, "人物卡脚本联动") : null,
					sideEffects.map(function (change, index) { return h("div", { key: "side-effect:" + index, className: "dsh-tavern-mvu-change", "data-origin": "card-script" },
						h("div", { className: "dsh-tavern-mvu-change-path" }, (operationLabels[change.operation] || "更新") + " " + String(change.path || "/")),
						h("div", { className: "dsh-tavern-mvu-change-values" }, String(change.before) + " → " + String(change.after))
					); }),
					failures.map(function (failure, index) {
						const operation = operationLabels[failure.operation] || String(failure.operation || "操作");
						const path = String(failure.path || failure.command || "/");
						return h("div", { key: "failure:" + index, className: "dsh-tavern-mvu-failure" }, "失败：" + operation + " " + path + "：" + String(failure.message || "未知错误"));
					}),
					(status === "error" || status === "partial") && Array.isArray(receipt.runtimeDiagnostics) ? receipt.runtimeDiagnostics.filter(function (item) { return item && item.message && ["warn", "error"].includes(item.level); }).slice(-3).map(function (item, index) { return h("div", { key: "runtime:" + index, className: "dsh-tavern-mvu-failure" }, "运行时：" + String(item.message)); }) : null,
					retryButton
				)
			);
		}

		function htmlPartHasPresentation(value) {
			const source = String(value || "").trim();
			if (!source) return false;
			if (/<(?:script|style|link|iframe|object|embed|img|picture|video|audio|canvas|svg|br|hr|input|button|select|textarea|progress|meter)\b/i.test(source)) return true;
			const withoutComments = source.replace(/<!--[\s\S]*?-->/g, "");
			if (withoutComments.replace(/<[^>]*>/g, "").trim() !== "") return true;
			const openingTags = withoutComments.match(/<[a-z][\w:-]*(?:\s[^<>]*?)?\/?\s*>/gi) || [];
			return openingTags.some(function (tag) {
				return /^<[a-z][\w:-]*\s+[^>]*>/i.test(tag) && !/^<[a-z][\w:-]*\s*\/?>$/i.test(tag);
			});
		}

		function projectionPartsOf(projection) {
			if (!projection) return [];
			if (Array.isArray(projection.parts)) return projection.parts.filter(function (part) {
				if (!part || (part.kind !== "markdown" && part.kind !== "html")) return false;
				if (part.kind === "html") return htmlPartHasPresentation(part.content !== undefined ? part.content : part.html || "");
				return String(part.text || "").trim() !== "";
			});
			if (projection.mode === "html" || projection.mode === "rich") {
				const content = String(projection.html || projection.text || "");
				return htmlPartHasPresentation(content) ? [{ kind: "html", content: content }] : [];
			}
			return [{ kind: "markdown", text: String(projection.text || "") }];
		}

		function renderTavernProjection(projection, options) {
			const h = React.createElement;
			return projectionPartsOf(projection).map(function (part, index) {
				if (part.kind === "markdown") return h(DshUi.MarkdownText, { key: index, text: String(part.text || ""), streaming: options.streaming, labels: { code: options.codeLabels, footnotes: "脚注" }, codeLabels: options.codeLabels, fileMentions: options.mentions });
				const content = String(part.content !== undefined ? part.content : part.html || "");
				return h(TavernMessageFrame, { key: index, content: content, sessionId: options.sessionId, turn: options.turn, partIndex: index, helperContext: options.helperContext, trustedCardMode: options.trustedCardMode, eager: options.eagerFrame, executeSlash: options.executeSlash });
			});
		}

		function renderTavernAssistantBlocks(input) {
			const h = React.createElement;
			const blocks = Array.isArray(input.blocks) ? input.blocks : [];
			const translate = typeof input.t === "function" ? input.t : function (key, values) {
				if (key === "copy") return "复制";
				if (key === "copied") return "已复制";
				if (key === "message.stopped") return "已停止";
				if (key === "message.unknownBlock") return "未知消息块";
				if (key === "json.truncated") return "内容过长（共 " + String(values && values.total || 0) + " 项）";
				return key;
			};
			const codeLabels = { copyLabel: translate("copy"), copiedLabel: translate("copied") };
			const rendered = [];
			let projected = false;
			for (let index = 0; index < blocks.length; index += 1) {
				const block = blocks[index];
				if (!block) continue;
				if (block.kind === "text") {
					if (input.projection && projected) continue;
					const projection = input.projection;
					if (projection) rendered.push(h(React.Fragment, { key: index }, renderTavernProjection(projection, { streaming: input.streaming, codeLabels: codeLabels, mentions: input.mentions, sessionId: input.sessionId, turn: input.turn, helperContext: input.helperContext, trustedCardMode: input.trustedCardMode, eagerFrame: input.eagerFrame, executeSlash: input.executeSlash })));
					else rendered.push(h(DshUi.MarkdownText, { key: index, text: String(block.text || ""), streaming: input.streaming, labels: { code: codeLabels, footnotes: "脚注" }, codeLabels: codeLabels, fileMentions: input.mentions }));
					projected = true;
					continue;
				}
				if (block.kind === "reasoning") {
					rendered.push(h("details", { key: index, className: "dsh-tavern-assistant-reasoning", open: input.streaming && index === blocks.length - 1 }, h("summary", null, input.streaming && index === blocks.length - 1 ? "思考中…" : "思考过程"), h("pre", null, String(block.text || ""))));
					continue;
				}
				if (block.kind === "image") {
					const start = index;
					const group = [block];
					while (index + 1 < blocks.length && blocks[index + 1] && blocks[index + 1].kind === "image") { group.push(blocks[index + 1]); index += 1; }
					rendered.push(h(React.Fragment, { key: start }, input.renderMessageImages({ images: group.map(function (item) { return { attachment: item.attachment }; }), align: "start" })));
					continue;
				}
				if (block.kind !== "tool-call") rendered.push(h(DshUi.JsonBlock, { key: index, label: translate("message.unknownBlock"), payload: block.block || block, truncatedLabel: function (total) { return translate("json.truncated", { total: total }); } }));
			}
			if (input.projection && !projected) {
				rendered.push(h(React.Fragment, { key: "projection" }, renderTavernProjection(input.projection, { streaming: false, codeLabels: codeLabels, mentions: input.mentions, sessionId: input.sessionId, turn: input.turn, helperContext: input.helperContext, trustedCardMode: input.trustedCardMode, eagerFrame: input.eagerFrame, executeSlash: input.executeSlash })));
			}
			if (input.interrupted) rendered.push(h("span", { key: "stopped", className: "dsh-tavern-assistant-stopped" }, translate("message.stopped")));
			return rendered;
		}

		function userContentParts(content) {
			const texts = [];
			const images = [];
			const rest = [];
			for (const block of Array.isArray(content) ? content : []) {
				if (block && block.type === "text" && typeof block.text === "string") texts.push(block.text);
				else if (block && block.type === "image" && block.attachment !== undefined) images.push({ attachment: block.attachment });
				else if (block) rest.push(block);
			}
			return { text: texts.join(""), images: images, rest: rest };
		}

		function tavernUserTextForTurn(view, turn, content) {
			const fallback = userContentParts(content).text;
			const sources = view && view.inputSources;
			const key = String(Number(turn) || 0);
			if (!sources || !Object.prototype.hasOwnProperty.call(sources, key)) return fallback;
			return String(sources[key] === undefined || sources[key] === null ? "" : sources[key]);
		}

		function createTavernFrameSlashExecutor(ctx, hostWindow) {
			hostWindow = hostWindow || window;
			return function (line, sessionId) {
				const match = /^\/send\s+([\s\S]+)\|\/trigger\s*$/.exec(String(line || ""));
				if (!match || !match[1].trim()) return Promise.reject(new Error("消息界面只允许调用 /send …|/trigger"));
				const actx = ctx.sessions.scope(sessionId);
				const conversation = ctx.get("conversation");
				if (!actx || !conversation) return Promise.reject(new Error("当前对话输入框不可用"));
				const input = conversation.input.for(actx);
				const sessions = ctx.sessions.list;
				return new Promise(function (resolve, reject) {
					let observedRun = false;
					let settled = false;
					let stop = function () {};
					let timer = null;
					function finish(error) {
						if (settled) return;
						settled = true;
						hostWindow.clearTimeout(timer);
						stop();
						if (error) reject(error); else resolve({ submitted: true });
					}
					function inspect() {
						const summary = sessions.getSnapshot().byId[sessionId];
						if (!summary) { finish(new Error("当前对话已关闭")); return; }
						if (summary.running === true) observedRun = true;
						else if (observedRun) finish();
					}
					stop = sessions.subscribe(inspect);
					timer = hostWindow.setTimeout(function () { finish(new Error("等待开局生成完成超时")); }, 15 * 60 * 1000);
					try {
						input.setDraft(match[1]);
						input.submit("queue");
						inspect();
					} catch (error) { finish(error); }
				});
			};
		}

		const tavernSessionTransition = (function () {
			let active = null;
			const listeners = new Set();
			function publish(next) {
				if (active === next) return;
				active = next;
				listeners.forEach(function (listener) { listener(); });
			}
			return {
				begin: function (preview) { publish(preview && typeof preview === "object" ? preview : {}); },
				end: function () { publish(null); },
				getSnapshot: function () { return active; },
				subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; }
			};
		})();

		const tavernConversationForkRequests = (function () {
			let handler = null;
			return Object.freeze({
				bind: function (next) {
					handler = next;
					return function () { if (handler === next) handler = null; };
				},
				request: function (input) {
					if (typeof handler !== "function") return Promise.reject(new Error("分叉功能尚未就绪，请刷新页面后重试"));
					return Promise.resolve(handler(input));
				}
			});
		})();

		function createTavernAssistantRendererFeatureModule() {
			function TavernUserNodeView(props) {
				const data = props.node.data;
				const location = props.node.location;
				const turnRef = location && (location.kind === "turn" || location.kind === "step") ? location.turn : null;
				const turn = turnRef ? Number(turnRef.turn) : 0;
				const liveState = useLiveTavernView(props.sessionId, String(data.time || ""));
				const parts = userContentParts(data.content);
				const text = tavernUserTextForTurn(liveState.view, turn, data.content);
				const [copied, setCopied] = React.useState(false);
				const copyTimer = React.useRef(null);
				React.useEffect(function () { return function () { if (copyTimer.current !== null) window.clearTimeout(copyTimer.current); }; }, []);
				function copy() {
					DshUi.writeClipboard(text).then(function (ok) {
						if (!ok) return;
						setCopied(true);
						if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
						copyTimer.current = window.setTimeout(function () { copyTimer.current = null; setCopied(false); }, 1000);
					});
				}
				const renderedImages = parts.images.length > 0 ? props.renderMessageImages({ images: parts.images, align: "end" }) : null;
				const extras = parts.rest.map(function (block, index) {
					return React.createElement("div", { key: index, className: "dsh-tavern-user-extra" }, React.createElement(DshUi.JsonBlock, { label: typeof props.t === "function" ? props.t("message.extraBlock") : "附加内容", payload: block, truncatedLabel: function (total) { return "内容过长（共 " + String(total) + " 项）"; } }));
				});
				const time = Number.isFinite(Number(data.time)) ? new Date(Number(data.time)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
				return React.createElement("div", { className: "dsh-tavern-user-row" },
					React.createElement("div", { className: "dsh-tavern-user-stack" }, renderedImages, (text !== "" || extras.length > 0) ? React.createElement("div", { className: "dsh-tavern-user-bubble" }, React.createElement(DshUi.MessageText, { text: text }), extras) : null),
					React.createElement("div", { className: "dsh-tavern-user-actions" }, time ? React.createElement("span", null, time) : null, React.createElement(DshUi.Tooltip, { label: copied ? "已复制" : "复制", side: "bottom" }, React.createElement("button", { type: "button", className: "dsh-tavern-user-copy", "aria-label": copied ? "已复制" : "复制", onClick: copy }, React.createElement(copied ? DshUi.IconCheckOutline16 : DshUi.IconCopyOutline16, null))))
				);
			}
			function SceneIllustration(props) {
				const state = useSceneImageRecord(props.sessionId, props.turn);
				const [error, setError] = React.useState("");
				const [selected, setSelected] = React.useState("");
				const [busy, setBusy] = React.useState(false);
				const [adjusting, setAdjusting] = React.useState(false);
				const [instruction, setInstruction] = React.useState("");
				const [referenceDraft, setReferenceDraft] = React.useState(null);
				const requestRef = React.useRef(null);
				const versions = state && state.versions || [];
				const version = versions.find(function (item) { return item.id === selected; }) || versions[versions.length - 1];
				const index = version ? versions.findIndex(function (item) { return item.id === version.id; }) : -1;
				const lastId = versions.length ? versions[versions.length - 1].id : "";
				React.useEffect(function () { setSelected(lastId); setError(""); }, [lastId]);
				React.useEffect(function () {
					if (state && ["failed", "cancelled"].includes(state.status) && state.kind === "adjust" && state.instruction) {
						setSelected(state.baseVersionId); setInstruction(state.instruction); setAdjusting(true);
					}
				}, [state && state.requestId, state && state.status]);
				function notify() { window.dispatchEvent(new CustomEvent("dsh-tavern-image-changed", { detail: { sessionId: props.sessionId } })); }
				async function retrySave() {
					if (busy || !state || state.status === "running") return;
					setBusy(true); setError("");
					try { await rpc("retrySceneImageSave", { turn: props.turn, key: state.key, requestId: state.requestId }, props.sessionId); }
					catch (e) { setError(String(e.message || e)); }
					finally { setBusy(false); notify(); }
				}
				async function cancelImage() {
					if (busy || !state || state.status !== "running" || state.cancelRequestedAt) return;
					setBusy(true); setError("");
					try { await rpc("cancelSceneImage", { turn: props.turn, key: state.key, requestId: state.requestId }, props.sessionId); }
					catch (e) { setError(String(e.message || e)); }
					finally { setBusy(false); notify(); }
				}
				async function generate(kind) {
					if (!version || busy || state.status === "running") return;
					const confirmNewRequestId = sceneImagePurchaseConfirmation(state);
					if (confirmNewRequestId === false) return;
					if (requestRef.current && requestRef.current.id === state.requestId && ["failed", "cancelled"].includes(state.status)) requestRef.current = null;
					setBusy(true); setError("");
					const signature = kind + ":" + version.id + ":" + instruction;
					if (!requestRef.current || requestRef.current.signature !== signature) requestRef.current = { signature: signature, id: sceneImageRequestId() };
					try {
						await rpc("generateSceneImage", { turn: props.turn, key: state.key, kind: kind, versionId: version.id, instruction: kind === "adjust" ? instruction : "", requestId: requestRef.current.id, confirmNewRequestId: confirmNewRequestId }, props.sessionId);
						requestRef.current = null; setAdjusting(false); setInstruction("");
					} catch (e) { setError(String(e.message || e)); }
					finally { setBusy(false); notify(); }
				}
				function openReference() {
					const people = version.referencePeople || [];
					setReferenceDraft({ key: state.key, versionId: version.id, gateway: state.reference.gateway, service: state.reference.service, personId: version.referenceSingle && people.length === 1 ? people[0].id : "" });
				}
				async function setReference(enabled, personId) {
					if (!version || locked) return;
					if (enabled && (!referenceDraft || referenceDraft.key !== state.key || referenceDraft.versionId !== version.id || !referenceDraft.personId)) return;
					setBusy(true); setError("");
					try { await rpc("setSceneImageReference", { turn: props.turn, key: state.key, versionId: version.id, consent: enabled ? referenceDraft.gateway : state.reference.gateway, personId: enabled ? referenceDraft.personId : personId, enabled: enabled }, props.sessionId); setReferenceDraft(null); }
					catch (e) { setError(String(e.message || e)); }
					finally { setBusy(false); notify(); }
				}
				const url = version ? "/api/dsh-tavern/scene-image?" + new URLSearchParams({ sessionId: props.sessionId, turn: String(props.turn), key: state.key, versionId: version.id }).toString() : "";
				if (!state || state.status === "idle") return null;
				const locked = busy || state.status === "running" || state.recovery === "save";
				const referencePeople = version && version.referencePeople || [];
				const referenceBindings = state.reference && state.reference.bindings ? state.reference.bindings.filter(function (binding) { return version && binding.versionId === version.id; }) : [];
				const canBindReference = state.enabled && state.reference && state.reference.supported && referencePeople.length > 0;
				const showReference = referenceDraft && version && referenceDraft.key === state.key && referenceDraft.versionId === version.id;
				return React.createElement("div", { className: "dsh-tavern-illustration" },
					url ? React.createElement("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, React.createElement("img", { src: url, alt: "本段场景插画", loading: "lazy", onError: function () { setError("图片加载失败，请刷新后重试"); } })) : null,
					version ? React.createElement("div", { className: "dsh-tavern-image-actions" },
						versions.length > 1 ? React.createElement(React.Fragment, null,
							React.createElement("button", { type: "button", className: "dsh-tavern-btn", "aria-label": "上一张插图", disabled: index <= 0, onClick: function () { setSelected(versions[index - 1].id); } }, "‹"),
							React.createElement("span", null, String(index + 1) + " / " + String(versions.length)),
							React.createElement("button", { type: "button", className: "dsh-tavern-btn", "aria-label": "下一张插图", disabled: index >= versions.length - 1, onClick: function () { setSelected(versions[index + 1].id); } }, "›")
						) : null,
						state.enabled ? React.createElement(React.Fragment, null,
							React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: locked, onClick: function () { setAdjusting(true); } }, "重画")
						) : null
					) : null,
					canBindReference || referenceBindings.length ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: locked, onClick: openReference }, referenceBindings.length ? "管理造型参考" : "用作造型参考") : null,
					version && state.enabled && version.profile && version.profile !== state.profile ? React.createElement("span", { role: "status" }, "将按新渠道重新整理画面，可能产生文字模型费用。") : null,
					state.referenceWarning || state.reference && state.reference.warning ? React.createElement("span", { role: "status" }, state.referenceWarning || state.reference.warning) : null,
					showReference ? React.createElement("div", { className: "dsh-tavern-image-adjust dsh-tavern-image-reference", role: "region", "aria-label": "造型参考" },
						canBindReference ? React.createElement(React.Fragment, null,
							React.createElement("label", null, "参考人物", React.createElement("select", { value: referenceDraft.personId, disabled: locked, onChange: function (event) { setReferenceDraft(Object.assign({}, referenceDraft, { personId: event.target.value })); } },
								React.createElement("option", { value: "" }, "请选择图中人物"),
								referencePeople.map(function (person) { return React.createElement("option", { key: person.id, value: person.id }, person.name + (person.description ? " · " + person.description : "") + (referencePeople.filter(function (other) { return other.name === person.name; }).length > 1 ? " · " + person.id.slice(-8) : "")); })
							)),
							React.createElement("p", null, "确认图片中的所选人物。整张图会发送给：" + referenceDraft.service + "。从当前游戏进度起用于该人物的造型参考，不自动绑定其他人；仅辅助外貌一致，不保证锁脸，也不沿用旧服装。"),
							referenceDraft.gateway !== state.reference.gateway ? React.createElement("p", { role: "status" }, "渠道配置已变化，请关闭后重新选择参考图。") : null,
							React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: locked || !referenceDraft.personId || referenceDraft.gateway !== state.reference.gateway, onClick: function () { return setReference(true); } }, "确认使用")
						) : null,
						referenceBindings.map(function (binding) { return React.createElement("button", { key: binding.personId, type: "button", className: "dsh-tavern-btn", disabled: locked, onClick: function () { return setReference(false, binding.personId); } }, "取消「" + binding.name + "」的参考"); }),
						React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { setReferenceDraft(null); } }, "关闭参考设置")
					) : null,
					adjusting && state.enabled ? React.createElement("div", { className: "dsh-tavern-image-adjust", role: "region", "aria-label": "重画插图" },
						React.createElement("label", null, "重画意见（选填）", React.createElement("textarea", { value: instruction, maxLength: 2000, placeholder: "留空直接重画；例如：改成雨夜，镜头拉近", onChange: function (event) { setInstruction(event.target.value); }, disabled: locked })),
						React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: locked, onClick: function () { return generate(instruction.trim() ? "adjust" : "repaint"); } }, "开始重画"),
						React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { setAdjusting(false); } }, "取消")
					) : null,
					state.status === "running" ? React.createElement("span", { role: "status" }, sceneImageStageLabel(state)) : null,
					state.status === "running" ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || Boolean(state.cancelRequestedAt), onClick: cancelImage }, state.cancelRequestedAt ? "正在取消…" : "取消生图") : null,
					state.recovery === "save" && state.status !== "running" ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: retrySave }, "重试保存") : null,
					error || state && state.error ? React.createElement("span", { role: "alert", className: "dsh-tavern-settings-error" }, error || state.error) : null
				);
			}
			function TavernAssistantNodeView(props) {
				const data = props.node.data;
				const turnRef = props.node.location.kind === "turn" || props.node.location.kind === "step" ? props.node.location.turn : null;
				const turn = turnRef ? Number(turnRef.turn) : 0;
				const settled = data.status !== "running";
				const revision = String(data.status || "") + ":" + String(data.finalNode && data.finalNode.seq || "");
				const liveState = useLiveTavernView(props.sessionId, revision);
				const storyTurn = tavernStoryTurnForDshTurn(liveState.view, turn);
				const sessionTransitioning = React.useSyncExternalStore(tavernSessionTransition.subscribe, tavernSessionTransition.getSnapshot, tavernSessionTransition.getSnapshot);
					const projection = settled ? tavernProjectionForTurn(liveState.view, storyTurn) : null;
					const mvuReceipt = settled ? tavernMvuReceiptForTurn(liveState.view, storyTurn) : null;
					const latestProjectionTurn = liveState.view && Array.isArray(liveState.view.replyProjections) ? liveState.view.replyProjections.reduce(function (latest, item) { return Math.max(latest, Number(item && item.turn) || 0); }, 0) : 0;
				const tail = props.useTurnData("turn-tail");
				const owner = React.useMemo(function () {
					if (!turnRef || turnRef.status !== "closed" || !data.finalNode || !tail || !tail.closing || tail.closing.finalNode.seq !== data.finalNode.seq) return undefined;
					return { turn: turnRef, seq: data.finalNode.seq, openFile: props.openFile };
				}, [turnRef, data.finalNode, tail, props.openFile]);
				const mentions = React.useMemo(function () { return owner === undefined ? undefined : props.fileMentions(owner); }, [owner, props.fileMentions]);
				const rendered = sessionTransitioning ? (sessionTransitioning.projection ? [
					React.createElement(React.Fragment, { key: "opening-preview" }, renderTavernProjection(sessionTransitioning.projection, { streaming: false, codeLabels: { copyLabel: "复制", copiedLabel: "已复制" }, mentions: [], sessionId: "", turn: 1, helperContext: null, trustedCardMode: sessionTransitioning.trustedCardMode === true })),
					React.createElement("div", { key: "switching", className: "dsh-tavern-session-switching", role: "status" }, "正在完成游戏初始化…")
				] : [React.createElement("div", { key: "switching", className: "dsh-tavern-session-switching", role: "status" }, "正在完成游戏初始化…")]) : renderTavernAssistantBlocks({
					blocks: data.blocks,
					streaming: data.status === "running",
					interrupted: data.status === "interrupted",
					projection: projection,
					helperContext: liveState.view && liveState.view.tavernHelper,
					trustedCardMode: Boolean(liveState.view && liveState.view.tavernRuntimePolicy && liveState.view.tavernRuntimePolicy.trustedCardMode),
					eagerFrame: storyTurn > 0 && storyTurn === latestProjectionTurn,
					executeSlash: props.executeSlash,
					sessionId: props.sessionId,
					turn: storyTurn,
					renderMessageImages: props.renderMessageImages,
					mentions: mentions,
					t: props.t
				});
				if (!(data.status === "running" || data.status === "interrupted" || rendered.length > 0)) return null;
				const mvuReceiptNode = mvuReceipt ? React.createElement(TavernMvuReceipt, { receipt: mvuReceipt, sessionId: props.sessionId, turn: storyTurn }) : null;
				const sceneImagesEnabled = Boolean(liveState.view && liveState.view.releaseCapabilities && liveState.view.releaseCapabilities.sceneImages);
				const illustration = sceneImagesEnabled && settled && projection && !sessionTransitioning ? React.createElement(SceneIllustration, { key: props.sessionId + ":" + storyTurn + ":" + JSON.stringify(projection), sessionId: props.sessionId, turn: storyTurn }) : null;
				return React.createElement("div", { className: "dsh-tavern-assistant", "data-streaming": data.status === "running" || undefined }, rendered, illustration, mvuReceiptNode);
			}
			function TavernForkAssistantAction(props) {
				const liveState = useLiveTavernView(props.sessionId, String(props.messageId || ""));
				const [forking, setForking] = React.useState(false);
				const view = liveState.view;
				const latestTurn = view && Array.isArray(view.debugTurns) ? Number(view.debugTurns[0] && view.debugTurns[0].turn) || 0 : 0;
				const canFork = view && isPlayMode(view.mode) && latestTurn > 0 && String(view.latestAssistantMessageId || "") === String(props.messageId || "");
				if (!canFork) return null;
				async function fork() {
					if (forking) return;
					setForking(true);
					try { await tavernConversationForkRequests.request({ sessionId: props.sessionId, turn: latestTurn }); }
					catch (error) { tavernErrorHub.report("分叉对话", error); }
					finally { setForking(false); }
				}
				return React.createElement(DshUi.Tooltip, { label: forking ? "正在分叉…" : "从当前进度分叉", side: "bottom" },
					React.createElement("button", { type: "button", className: "dsh-tavern-message-fork", "aria-label": "从当前进度分叉", disabled: forking, onClick: fork },
						React.createElement(DshUi.IconBranchOutline16, null)));
			}
			function register(input) {
				const scriptOwner = createTavernScriptSessionOwner({ sessions: input.ctx.sessions });
				const executeSlash = createTavernFrameSlashExecutor(input.ctx);
				input.ctx.effect(function () {
					scriptOwner.start();
					return function () { scriptOwner.dispose(); };
				}, "dsh-tavern: game script owner");
				input.ctx.effect(function () {
					return input.slots.inject("conversation.session.header.actions", function () { return input.slots.register({
						name: "conversation.session.header.actions", id: "dsh-tavern-script-runtime", order: -140, label: "人物卡脚本运行时"
					}, function () { return React.createElement(TavernScriptRuntime, { owner: scriptOwner }); }); });
				}, "dsh-tavern: conversation script lifecycle");
				input.ctx.effect(function () {
					return input.slots.inject("conversation.chat.node", function () { return input.slots.register({
						name: "conversation.chat.node",
						key: "assistant-step",
						priority: -1
					}, function (props) { return React.createElement(TavernAssistantNodeView, Object.assign({}, props, { executeSlash: executeSlash })); }); });
				}, "dsh-tavern: inline assistant renderer");
				input.ctx.effect(function () {
					return input.slots.inject("conversation.chat.node", function () { return input.slots.register({
						name: "conversation.chat.node",
						key: "user",
						priority: -1
					}, TavernUserNodeView); });
				}, "dsh-tavern: raw user message renderer");
				input.ctx.effect(function () {
					return input.slots.inject("conversation.chat.assistant-actions", function () { return input.slots.register({
						name: "conversation.chat.assistant-actions", id: "dsh-tavern-fork", order: 20,
						inject: function (sessionId) { return { sessionId: sessionId }; }
					}, TavernForkAssistantAction); });
				}, "dsh-tavern: conversation fork action");
			}
			return Object.freeze({ register: register });
		}

		function createTavernShellFeatureModule() {
		function TavernSidebar(props) {
			function TavernCardListContent(props) {
				const card = props.card;
				const image = card && card.hasImage ? React.createElement("img", {
					className: "dsh-tavern-card-thumb",
					src: "/api/dsh-tavern/card-image?path=" + encodeURIComponent(card.path),
					alt: "",
					loading: "lazy",
					onError: function (event) { event.currentTarget.hidden = true; }
				}) : null;
				return React.createElement(React.Fragment, null, image, React.createElement("span", { className: "dsh-tavern-card-list-copy" },
					React.createElement("b", null, card.name),
					React.createElement("span", null, props.detail),
					props.extra ? React.createElement("span", null, props.extra) : null
				));
			}

			const collapsed = props.collapsed;
			const current = props.useSessions(function (state) { return state.current; });
			const summaries = props.useSessions(function (state) { return state.byId; });
			const workspaceId = props.useWorkspaces(function (state) { return props.conversationHost.workspaceId(state, current); });
			const [cards, setCards] = React.useState([]);
			const [initialResources, setInitialResources] = React.useState([]);
			const [selectedInitialResources, setSelectedInitialResources] = React.useState({});
			const [history, setHistory] = React.useState([]);
			const [picking, setPicking] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = usePersistentError("左侧栏操作");
			const [uiMode, setUiMode] = React.useState("play");
			const [requestMode, setRequestMode] = React.useState("dsh");
			const compatibilityAvailable = false;
			const [trustedCardMode, setTrustedCardMode] = React.useState(true);
			const [cardEntry, setCardEntry] = React.useState("");
			const [openingPicker, setOpeningPicker] = React.useState(null);
			const [pendingOpen, setPendingOpen] = React.useState(null);
			const [menuSession, setMenuSession] = React.useState(null);
			const [updateStatus, setUpdateStatus] = React.useState({ phase: "loading", host: "cli" });
			const updateStartedAtRef = React.useRef(0);
			const updateRecoveryRef = React.useRef({ sawOffline: false, reloading: false });
			const lastModeSession = React.useRef(null);
			const fileRef = React.useRef(null);
			const initialImportRef = React.useRef(null);
			const playWorkspaceIdRef = React.useRef(workspaceId);
			const playWorkspaceResolverRef = React.useRef(null);
			const playPrewarmRef = React.useRef(null);
			const sessionListRecoveryRef = React.useRef(null);
			playWorkspaceIdRef.current = workspaceId;
			if (playWorkspaceResolverRef.current === null) {
				playWorkspaceResolverRef.current = createPlayWorkspaceResolver({
					currentWorkspaceId: function () { return playWorkspaceIdRef.current; },
					resourceRoot: function () { return call("getResourceWorkspace"); },
					createWorkspace: function (input) { return props.workspaces.create(input); }
				});
			}
			if (playPrewarmRef.current === null) {
				playPrewarmRef.current = createConversationPrewarmModule({
					sessionIds: function () { return Object.keys(props.sessions.list.getSnapshot().byId || {}); },
					resolveWorkspace: playWorkspaceResolverRef.current,
					connectWorkspace: function (targetWorkspaceId) { return props.conversationHost.connectWorkspace(targetWorkspaceId); },
					archiveSession: async function (sessionId) {
						try { await props.workspaces.archiveSession(sessionId); }
						catch (error) { if (!isMissingSessionArchiveError(error)) throw error; }
					},
					report: function (timing) {
						if (timing.phase === "ready") console.info("dsh-tavern: 游戏 Session 预热完成", timing.elapsedMs + "ms", timing.created ? "新建" : "复用");
						else if (timing.phase === "failed") console.warn("dsh-tavern: 游戏 Session 预热失败，将在开始时重试", timing.error);
						else if (timing.phase === "cleanup-failed") console.warn("dsh-tavern: 未使用的预热 Session 清理失败", timing.error);
					}
				});
			}
			if (sessionListRecoveryRef.current === null) {
				sessionListRecoveryRef.current = createSessionListRecoveryModule({
					summary: function (sessionId) { return props.sessions.list.getSnapshot().byId[sessionId]; },
					binding: function (sessionId) { return props.sessions.binding(sessionId); },
					refresh: function () { return typeof props.sessions.refresh === "function" ? props.sessions.refresh() : Promise.resolve(); },
					open: function (sessionId) { props.sessions.open(sessionId); },
					isUnknownSession: isUnknownSessionSelectError
				});
			}
			const currentSummary = current ? summaries[current] : null;
			const readyTavernSession = current && summaries[current] && summaries[current].blank === false && history.some(function (entry) { return entry.sessionId === current && isPlayMode(entry.mode); }) ? current : "";
			const readyCardSession = current && summaries[current] && summaries[current].blank === false && history.some(function (entry) { return entry.sessionId === current && entry.mode === "card"; }) ? current : "";
			React.useEffect(function () {
				if (!current || !summaries[current] || !props.sessions.binding(current)) return;
				const latest = tavernErrorHub.getSnapshot()[0];
				if (!latest || latest.source !== "左侧栏操作") return;
				if (latest.message === "DSH Session 列表同步超时，请刷新页面后重试：" + current) setError("");
			}, [current, summaries]);
			function call(method, args) { return rpc(method, args); }
			function isMissingUpdateApiError(error) {
				return String(error && error.message || error || "").indexOf("未知方法: getUpdateStatus") >= 0;
			}
			function notifyDataChanged(kinds) {
				notifyTavernDataChanged(kinds, "sidebar");
			}
			function refresh() {
				return Promise.all([call("listCards"), call("listSessions")]).then(function (all) {
					const sessions = (all[1].sessions || []).filter(function (item) { return item.requestMode !== "sillytavern"; });
					const nextTrustedCardMode = !all[1].capabilities || all[1].capabilities.trustedCardMode !== false;
					setCards(all[0].cards || []); setHistory(sessions); setTrustedCardMode(nextTrustedCardMode); publishSessionModes(sessions);
					setRequestMode("dsh");
					window.localStorage.removeItem("dsh-tavern-request-mode");
					tavernErrorHub.resolve("左侧栏");
				}, function (err) { tavernErrorHub.report("左侧栏", err); });
			}
			React.useEffect(function () {
				function refreshSettings() { void refresh(); }
				window.addEventListener("dsh-tavern-settings-changed", refreshSettings);
				return function () { window.removeEventListener("dsh-tavern-settings-changed", refreshSettings); };
			}, [props.sessionId]);
			React.useEffect(function () {
				refresh();
				function onData(event) { if (tavernDataChangeAffects(event, ["cards", "sessions"], "sidebar")) refresh(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				return function () { window.removeEventListener("dsh-tavern-data-changed", onData); };
			}, []);
			React.useEffect(function () {
				if (!current) return;
				return tavernCoordination.subscribe(current, function () {});
			}, [current]);
			React.useEffect(function () {
				return function () { playPrewarmRef.current.cancel(); };
			}, []);
			React.useEffect(function () {
				let stopped = false;
				let received = false;
				let pending = false;
				let failures = 0;
				async function refreshUpdateStatus() {
					if (stopped || pending) return;
					pending = true;
					try {
						const result = await call("getUpdateStatus");
						if (!stopped && result && result.status) {
							received = true;
							failures = 0;
							tavernErrorHub.resolve("更新状态");
							const status = result.status;
							const completedInThisPage = status.phase === "completed" && updateStartedAtRef.current > 0 && Number(status.completedAt || 0) >= updateStartedAtRef.current;
							setUpdateStatus(status.phase === "completed" && !completedInThisPage ? { ...status, phase: "idle", host: status.host || "cli" } : status);
						}
					} catch (err) {
							if (stopped) return;
							failures += 1;
							// Only this read-only poll gets a startup grace period. Never replay startUpdate.
							if ((err && err.retryable || err instanceof TypeError) && failures < 3) return;
							if (isMissingUpdateApiError(err)) {
								if (!received) setUpdateStatus({ phase: "restart-required", host: "desktop" });
							} else {
								if (!received) setUpdateStatus({ phase: "failed", host: "cli", error: String(err && err.message || err) });
								tavernErrorHub.report("更新状态", err);
							}
						} finally { pending = false; }
				}
				refreshUpdateStatus();
				const timer = window.setInterval(refreshUpdateStatus, 2500);
				return function () { stopped = true; window.clearInterval(timer); };
			}, []);
			React.useEffect(function () {
				if (updateStatus.phase !== "running" || updateStatus.host === "desktop") return;
				let stopped = false;
				const recovery = updateRecoveryRef.current;
				async function probeRestartedService() {
					try {
						const response = await window.fetch(window.location.origin + "/?tavern-update-probe=" + Date.now(), { cache: "no-store" });
						if (!stopped && response.ok && recovery.sawOffline && !recovery.reloading) {
							recovery.reloading = true;
							window.location.reload();
						}
					} catch (error) {
						if (!stopped) recovery.sawOffline = true;
					}
				}
				probeRestartedService();
				const timer = window.setInterval(probeRestartedService, 400);
				return function () { stopped = true; window.clearInterval(timer); };
			}, [updateStatus.phase, updateStatus.host]);
			React.useEffect(function () {
				if (!currentSummary || currentSummary.blank) return;
				notifyDataChanged(["sessions"]);
			}, [current, currentSummary]);
			React.useEffect(function () {
				if (!current || lastModeSession.current === current) return;
				const item = history.filter(function (entry) { return entry.sessionId === current; })[0];
				if (!item) return;
				lastModeSession.current = current;
				setUiMode(groupOfMode(item.mode));
				if (isPlayMode(item.mode)) setRequestMode(compatibilityAvailable && item.requestMode === "sillytavern" ? "sillytavern" : "dsh");
			}, [current, history, compatibilityAvailable]);
			React.useEffect(function () {
				if (!openingPicker || !openingPicker.card) return;
				let stopped = false;
				const cardPath = openingPicker.card.path;
				const userName = String(openingPicker.userName || "你").trim() || "你";
				const timer = window.setTimeout(async function () {
					try {
						const response = await call("getCardOpenings", { path: cardPath, userName: userName, requestMode: compatibilityAvailable && requestMode === "sillytavern" ? "sillytavern" : "dsh" });
						if (stopped) return;
						setOpeningPicker(function (current) {
							if (!current || current.card.path !== cardPath || (String(current.userName || "你").trim() || "你") !== userName) return current;
							const openings = response.openings || [];
							const selected = current.openings && current.openings[current.index];
							const selectedIndex = selected ? openings.findIndex(function (item) { return item.id === selected.id; }) : -1;
							return Object.assign({}, current, { openings: openings, index: selectedIndex >= 0 ? selectedIndex : 0, trustedCardMode: response.trustedCardMode });
						});
					} catch (err) { if (!stopped) setError(String(err && err.message || err)); }
				}, 250);
				return function () { stopped = true; window.clearTimeout(timer); };
			}, [openingPicker && openingPicker.card && openingPicker.card.path, openingPicker && openingPicker.userName, requestMode, compatibilityAvailable]);
			React.useEffect(function () {
				if (!readyTavernSession || typeof props.openStatusTab !== "function") return;
				props.openStatusTab(readyTavernSession);
			}, [readyTavernSession]);
			React.useEffect(function () {
				if (!readyCardSession) return;
				if (typeof props.openCardLibraryTab === "function") props.openCardLibraryTab(readyCardSession);
				if (typeof props.openPresetLibraryTab === "function") props.openPresetLibraryTab(readyCardSession);
				if (typeof props.openWorldBookLibraryTab === "function") props.openWorldBookLibraryTab(readyCardSession);
				if (typeof props.openResourcesTab === "function") props.openResourcesTab(readyCardSession);
			}, [readyCardSession]);
			function openPicker() {
				playPrewarmRef.current.cancel();
				setMenuSession(null);
				setCardEntry("");
				setOpeningPicker(null);
				setError("");
				setPicking(true);
				void call("preparePlayStart").catch(function (error) { console.warn("dsh-tavern: 游戏启动资源预热失败，将在开始时读取", error); });
			}
			function closePicker() {
				playPrewarmRef.current.cancel();
				setPicking(false);
				setCardEntry("");
				setOpeningPicker(null);
			}
			async function loadInitialResources(task) {
				let resources = [];
					if (task === "worldbook") {
						const response = await call("listWorldBooks");
						resources = (response.standalone || []).concat(response.embedded || []).map(function (item) {
							return { kind: "worldbook", path: item.kind === "card" ? item.cardPath : item.path, title: item.name, detail: item.kind === "card" ? "人物卡内置 · " + item.cardName : "独立世界书" };
						});
					} else if (task === "preset") {
						const response = await call("listPresets");
						resources = (response.presets || []).map(function (item) { return { kind: "preset", path: item.path, title: item.title, detail: "作为编辑目标引用，不会在当前 Agent 中运行" }; });
					} else {
						const response = await call("listResources");
						resources = (response.resources || []).map(function (item) { return Object.assign({}, item, { kind: "source" }); });
					}
				return resources;
			}
			async function openResourcePicker(task) {
				setBusy(true); setError("");
				try {
					setInitialResources(await loadInitialResources(task));
					setSelectedInitialResources({});
					setCardEntry(task);
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function importInitialResource(file, task) {
				if (!file || !task) return;
				setBusy(true); setError("");
				try {
					const payload = await parseTextResourceFile(file);
					if (task === "worldbook") await call("importWorldBook", { payload: payload });
					else if (task === "preset") await call("importPreset", { payload: payload });
					else await call("importSource", { payload: payload });
					notifyDataChanged([task === "worldbook" ? "worldbooks" : (task === "preset" ? "presets" : "scripts")]);
					setInitialResources(await loadInitialResources(task));
					setSelectedInitialResources({});
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function toggleInitialResource(item) {
				const key = item.kind + ":" + item.path;
				setSelectedInitialResources(function (current) {
					const next = cardEntry === "script" || cardEntry === "worldbook" || cardEntry === "preset" ? {} : Object.assign({}, current);
					if (next[key]) delete next[key];
					else next[key] = { kind: item.kind, path: item.path, title: item.title };
					return next;
				});
			}
			async function ensureTavernPreset(sessionId, request) {
				await props.conversationHost.ensurePreset(sessionId, request);
			}
			async function archiveCurrentBlankSession(protectedSessionId) {
				const currentSummary = current ? summaries[current] : null;
				if (!current || !currentSummary || !currentSummary.blank) return;
				if (current === protectedSessionId) return;
				// DSH's blank flag does not mean an existing Tavern opening can be discarded.
				if (history.some(function (entry) { return entry.sessionId === current; })) return;
				try { await props.workspaces.archiveSession(current); }
				catch (archiveError) { if (!isMissingSessionArchiveError(archiveError)) throw archiveError; }
			}
			async function waitForSessionSummary(sessionId) {
				await sessionListRecoveryRef.current.wait(sessionId);
			}
			function isUnknownSessionSelectError(error) {
				return /sessions\.select: unknown session/i.test(String(error && error.message || error || ""));
			}
			async function openSessionWhenReady(sessionId) {
				await sessionListRecoveryRef.current.open(sessionId);
				setError("");
			}
			async function finishPendingOpen(pending) {
				await openSessionWhenReady(pending.sessionId);
				setPendingOpen(null);
				setUiMode(groupOfMode(pending.targetMode));
				publishSessionMode(pending.sessionId, pending.targetMode);
				window.dispatchEvent(new CustomEvent("dsh-tavern-session-changed", { detail: { sessionId: pending.sessionId } }));
				if (pending.targetMode === "card") {
					if (pending.debugSource) await call("attachPlayChatDebug", { targetSessionId: pending.sessionId, sourceSessionId: pending.debugSource.sourceSessionId, turn: pending.debugSource.turn });
					if (typeof props.openCardLibraryTab === "function") props.openCardLibraryTab(pending.sessionId);
					if (typeof props.openPresetLibraryTab === "function") props.openPresetLibraryTab(pending.sessionId);
					if (typeof props.openWorldBookLibraryTab === "function") props.openWorldBookLibraryTab(pending.sessionId);
					if (typeof props.openResourcesTab === "function") props.openResourcesTab(pending.sessionId);
					if (pending.task) await props.injectTaskPrompt(pending.sessionId, pending.task, pending.label, pending.card, (pending.selectedResources || []).length > 0);
					(pending.selectedResources || []).forEach(function (resource) { props.appendMention(pending.sessionId, resource.kind, resource.path, resource.title); });
				} else if (typeof props.openStatusTab === "function") props.openStatusTab(pending.sessionId);
				setOpeningPicker(null); setPicking(false); setCardEntry("");
				await refresh();
			}
			const conversationLifecycle = createConversationLifecycleModule({
				archiveCurrent: archiveCurrentBlankSession,
				resolveWorkspace: async function (request) {
					if (request.kind !== "card") return playWorkspaceResolverRef.current();
					const resourceRoot = await call("getResourceWorkspace");
					const resourceWorkspace = await props.workspaces.create({ path: resourceRoot.path });
					return resourceWorkspace.workspaceId;
				},
				connectWorkspace: function (targetWorkspaceId) { return props.conversationHost.connectWorkspace(targetWorkspaceId); },
				waitForSession: waitForSessionSummary,
				ensurePreset: ensureTavernPreset,
				createChat: function (request, sessionId) {
					return call("startChat", {
						path: request.card && request.card.path ? request.card.path : "",
						sessionId: sessionId,
						mode: request.targetMode,
						openingId: request.openingId || "",
						userName: request.userName || "你",
						requestMode: compatibilityAvailable && request.requestMode === "sillytavern" ? "sillytavern" : "dsh"
					});
				},
				rememberPending: setPendingOpen,
				finishOpen: finishPendingOpen
			});
			async function retryPendingOpen() {
				if (!pendingOpen) return;
				setBusy(true); setError("");
				try { await finishPendingOpen(pendingOpen); }
				catch (err) { setError("重新连接 Session 失败：" + String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function newConversation(card, requestedMode, openingId, userName) {
				const targetMode = requestedMode || (uiMode === "play" ? playModeOfCard(card) : "card");
				const startedAt = Date.now();
				const previousOpeningPicker = openingPicker;
				const transitionOpening = previousOpeningPicker && previousOpeningPicker.openings ? previousOpeningPicker.openings.filter(function (item) { return item.id === openingId; })[0] : null;
				tavernSessionTransition.begin({ projection: transitionOpening && transitionOpening.projection, trustedCardMode: previousOpeningPicker && previousOpeningPicker.trustedCardMode === true });
				setBusy(true); setError("");
				try {
					const resolvedUserName = String(userName || "你").trim() || "你";
					let preparedSessionId = "";
					try { preparedSessionId = await playPrewarmRef.current.claim(card && card.path); }
					catch (prewarmError) { console.warn("dsh-tavern: 预热 Session 不可用，改为正常创建", prewarmError); }
					await conversationLifecycle.start({ kind: "play", targetMode: targetMode, card: card, openingId: openingId || "", userName: resolvedUserName, requestMode: compatibilityAvailable && requestMode === "sillytavern" ? "sillytavern" : "dsh", preparedSessionId: preparedSessionId });
					if (targetMode !== "card") window.localStorage.setItem("dsh-tavern-player-name", resolvedUserName);
					console.info("dsh-tavern: 开始游戏完成", (Date.now() - startedAt) + "ms", preparedSessionId ? "预热命中" : "即时创建");
				} catch (err) { setOpeningPicker(previousOpeningPicker); setError(String(err && err.phase || "创建对话") + "失败：" + String(err && err.message || err)); }
				finally { tavernSessionTransition.end(); setBusy(false); }
			}
			async function preparePlayConversation(card) {
				setBusy(true); setError("");
				playPrewarmRef.current.begin({ key: card.path, kind: "play" });
				try {
					const userName = window.localStorage.getItem("dsh-tavern-player-name") || "你";
					const response = await call("getCardOpenings", { path: card.path, userName: userName, requestMode: compatibilityAvailable && requestMode === "sillytavern" ? "sillytavern" : "dsh" });
					const openings = response.openings || [];
					setOpeningPicker({ card: card, openings: openings, index: 0, userName: userName, trustedCardMode: response.trustedCardMode });
				} catch (err) { playPrewarmRef.current.cancel(); setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function importCard(file) {
				setBusy(true); setError("");
				try { const payload = await parseCardFile(file); await call("importCard", { payload: payload }); await refresh(); notifyDataChanged(["cards"]); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function newCardConversation(card, task, label, selectedResources, debugSource) {
				setBusy(true); setError("");
				try {
					await conversationLifecycle.start({
						kind: "card", targetMode: "card", card: card,
						pending: { task: task, label: label, card: card, selectedResources: selectedResources || [], debugSource: debugSource || null }
					});
				} catch (err) { setError(String(err && err.phase || "创建对话") + "失败：" + String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			React.useEffect(function () {
				function onOpenUserProfileTask() {
					newCardConversation(null, "user-profile", "建立用户画像");
				}
				window.addEventListener("dsh-tavern-open-user-profile-task", onOpenUserProfileTask);
				return function () { window.removeEventListener("dsh-tavern-open-user-profile-task", onOpenUserProfileTask); };
			});
			React.useEffect(function () {
				function onDebugPlayChat(event) {
					const detail = event && event.detail ? event.detail : {};
					Promise.resolve().then(async function () {
						const target = await call("getPlayChatDebugTarget", { sessionId: detail.sourceSessionId });
						await newCardConversation(target.card, "debug-play", "调试游玩对话", [], { sourceSessionId: detail.sourceSessionId, turn: detail.turn });
						if (typeof detail.resolve === "function") detail.resolve();
					}).catch(function (error) {
						setError("打开卡片调试失败：" + String(error && error.message || error));
						if (typeof detail.reject === "function") detail.reject(error);
					});
				}
				window.addEventListener("dsh-tavern-debug-play-chat", onDebugPlayChat);
				return function () { window.removeEventListener("dsh-tavern-debug-play-chat", onDebugPlayChat); };
			});
			React.useEffect(function () {
				function onEditPreset(event) {
					const detail = event && event.detail ? event.detail : {};
					if (!detail.path) return;
					newCardConversation(null, "preset", "修改预设", [{ kind: "preset", path: detail.path, title: detail.title || detail.path }]);
				}
				window.addEventListener("dsh-tavern-edit-preset", onEditPreset);
				return function () { window.removeEventListener("dsh-tavern-edit-preset", onEditPreset); };
			});
			function formatTime(ts) {
				if (!ts) return "";
				const d = new Date(ts); return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
			}
			async function switchMode(nextMode) {
				playPrewarmRef.current.cancel();
				setUiMode(nextMode); setPicking(false); setMenuSession(null);
				const first = history.filter(function (item) {
					if (groupOfMode(item.mode) !== nextMode) return false;
					if (nextMode !== "play") return true;
					return (item.requestMode === "sillytavern" ? "sillytavern" : "dsh") === requestMode;
				})[0];
				if (first) {
					try { await openSessionWhenReady(first.sessionId); }
					catch (err) { setError("打开 Session 失败：" + String(err && err.message || err)); }
				}
				else if (nextMode === "card") openPicker();
				else openPicker();
			}
			async function switchPlayRequestMode(nextRequestMode) {
				if (!compatibilityAvailable && nextRequestMode === "sillytavern") return;
				playPrewarmRef.current.cancel();
				setUiMode("play"); setPicking(false); setMenuSession(null); setBusy(true); setError("");
				setRequestMode(nextRequestMode);
				window.localStorage.setItem("dsh-tavern-request-mode", nextRequestMode);
				try {
					const target = history.filter(function (item) {
						return isPlayMode(item.mode) && (item.requestMode === "sillytavern" ? "sillytavern" : "dsh") === nextRequestMode;
					})[0];
					if (!target) { props.sessions.clear(); openPicker(); return; }
					if (target.sessionId !== current) await openSessionWhenReady(target.sessionId);
				} catch (err) { setError("切换对话列表失败：" + String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function renameConversation(item, currentTitle) {
				setMenuSession(null);
				const title = window.prompt("重命名对话", currentTitle || item.cardName + "的新对话");
				if (title === null || !title.trim() || title.trim() === currentTitle) return;
				setBusy(true); setError("");
				try { await props.renameSession(item.sessionId, title.trim()); await refresh(); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function isMissingSessionArchiveError(error) {
				const message = String(error && error.message || error || "").toLowerCase();
				return message.indexOf("session-not-found") >= 0 || (message.indexOf("cannot archive session") >= 0 && message.indexOf("no such session") >= 0);
			}
			async function deleteConversation(item, currentTitle) {
				setMenuSession(null);
				if (!window.confirm("确定删除对话“" + (currentTitle || item.cardName + "的新对话") + "”吗？\n删除后将从酒馆历史中移除。")) return;
				setBusy(true); setError("");
				try {
					try { await props.archiveSession(item.sessionId); }
					catch (archiveError) { if (!isMissingSessionArchiveError(archiveError)) throw archiveError; }
					await call("deleteChat", { chatId: item.chatId });
					if (current === item.sessionId) {
						const next = history.filter(function (entry) {
							if (entry.sessionId === item.sessionId || groupOfMode(entry.mode) !== uiMode) return false;
							if (uiMode !== "play") return true;
							return (entry.requestMode === "sillytavern" ? "sillytavern" : "dsh") === requestMode;
						})[0];
						if (next) await openSessionWhenReady(next.sessionId);
						else { props.sessions.clear(); openPicker("cards"); }
					}
					await refresh();
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function forkConversation(item, currentTitle, turn) {
				setMenuSession(null);
				setBusy(true); setError("");
				let targetSessionId = "";
				let forkCreated = false;
				try {
					targetSessionId = await props.conversationHost.forkSession(item.sessionId);
					await call("forkChat", {
						chatId: item.chatId,
						sessionId: item.sessionId,
						targetSessionId: targetSessionId,
						turn: Number(turn) || 0
					});
					forkCreated = true;
					const forkTitle = (currentTitle || item.cardName + "的新对话") + " · 分支";
					try { await props.renameSession(targetSessionId, forkTitle); }
					catch (renameError) { console.warn("dsh-tavern: 分叉已创建，但自动命名失败", renameError); }
					const pending = { sessionId: targetSessionId, targetMode: item.mode };
					setPendingOpen(pending);
					await finishPendingOpen(pending);
				} catch (err) {
					if (targetSessionId && !forkCreated) {
						try { await props.archiveSession(targetSessionId); }
						catch (archiveError) { if (!isMissingSessionArchiveError(archiveError)) console.warn("dsh-tavern: 清理分叉目标 Session 失败", archiveError); }
					}
					setError("分叉对话失败：" + String(err && err.message || err));
				} finally { setBusy(false); }
			}
			React.useEffect(function () {
				return tavernConversationForkRequests.bind(function (request) {
					if (busy) throw new Error("当前有其他操作正在进行，请稍后再分叉");
					const item = history.find(function (entry) { return entry.sessionId === request.sessionId && isPlayMode(entry.mode); });
					if (!item) throw new Error("找不到当前游玩存档");
					const summary = summaries[item.sessionId];
					const title = item.title || (summary && summary.displayTitle ? summary.displayTitle : item.cardName + "的新对话");
					return forkConversation(item, title, request.turn);
				});
			}, [history, summaries, busy]);
			async function exportCard(card) {
				try {
					const res = await call("exportCard", { path: card.path });
					const blob = new Blob([JSON.stringify(res.document, null, 2)], { type: "application/json" });
					const url = URL.createObjectURL(blob);
					const a = document.createElement("a");
					a.href = url; a.download = (card.name || "人物卡") + ".json";
					document.body.appendChild(a); a.click(); a.remove();
					URL.revokeObjectURL(url);
				} catch (err) { setError(String(err && err.message || err)); }
			}
			async function checkUpdate() {
				if (updateStatus.phase === "checking" || updateStatus.phase === "running") return;
				setUpdateStatus({ ...updateStatus, phase: "checking", host: updateStatus.host || "cli", checkedAt: Date.now(), error: "" });
				try {
					const result = await call("checkUpdate");
					if (result && result.status) setUpdateStatus(result.status);
				} catch (err) {
					setUpdateStatus({ ...updateStatus, phase: "check-failed", host: updateStatus.host || "cli", error: String(err && err.message || err) });
					tavernErrorHub.report("检查更新", err);
				}
			}
			async function performUpdate() {
				if (updateStatus.phase !== "update-available") return;
				if (!window.confirm("更新期间会短暂断开，人物卡、资料和对话数据不会受到影响。\n确定更新到 GitHub 最新版吗？")) return;
				updateStartedAtRef.current = Date.now();
				setUpdateStatus({ ...updateStatus, phase: "running", host: updateStatus.host || "cli", startedAt: updateStartedAtRef.current });
				try {
					const result = await call("startUpdate");
					if (result && result.status) setUpdateStatus(result.status);
				} catch (err) {
					setUpdateStatus({ phase: "failed", host: updateStatus.host || "cli", error: String(err && err.message || err) });
					tavernErrorHub.report("插件更新", err);
				}
			}
			const h = React.createElement;
			if (collapsed) return h(React.Fragment, null,
				h(TavernErrorCenter),
				h("div", { className: "dsh-tavern-sidebar collapsed" },
					h("button", { className: "dsh-tavern-side-icon", title: "展开侧栏", onClick: props.toggleSidebar }, "🍺"),
					h("button", { className: "dsh-tavern-side-icon", title: "新建对话（跟随当前模式）", onClick: function () { props.toggleSidebar(); window.setTimeout(function () { openPicker("cards"); }, 180); } }, "＋")
				)
			);
			const visibleHistory = history.filter(function (item) {
				if (groupOfMode(item.mode) !== uiMode) return false;
				if (uiMode !== "play") return true;
				return (item.requestMode === "sillytavern" ? "sillytavern" : "dsh") === requestMode;
			});
			const rows = visibleHistory.map(function (item) {
				const summary = summaries[item.sessionId];
				const title = item.title || (summary && summary.displayTitle ? summary.displayTitle : (item.cardName + "的新对话"));
				return h("div", { key: item.sessionId, className: "dsh-tavern-side-row" + (current === item.sessionId ? " active" : "") },
					h("button", { className: "dsh-tavern-side-row-main", onClick: async function () {
					try {
						if (summary && summary.blank) await call("ensureOpening", { sessionId: item.sessionId });
						await openSessionWhenReady(item.sessionId);
					} catch (err) { setError(String(err && err.message || err)); }
				} },
					h("div", { className: "dsh-tavern-side-row-name" }, title),
					h("div", { className: "dsh-tavern-side-row-meta" }, h("span", null, item.mode === "card" ? (item.cardPath ? ("已创建：" + item.cardName) : "尚未创建正式人物卡") : (modeLabel(item.mode || "story") + " · " + item.cardName)), h("span", null, formatTime(summary ? summary.updatedAt : item.updatedAt)))
					),
					h("button", { className: "dsh-tavern-side-row-more", title: "对话操作", "aria-expanded": menuSession === item.sessionId ? "true" : "false", onClick: function () { setMenuSession(menuSession === item.sessionId ? null : item.sessionId); } }, "⋯"),
					menuSession === item.sessionId ? h("div", { className: "dsh-tavern-side-row-menu" },
						h("button", { disabled: busy, onClick: function () { renameConversation(item, title); } }, "重命名"),
						h("button", { className: "danger", disabled: busy, onClick: function () { deleteConversation(item, title); } }, "删除")
					) : null
				);
			});
			const selectedOpening = openingPicker && openingPicker.openings[openingPicker.index];
			const pickerError = error ? h("div", { className: "dsh-tavern-picker-error", role: "alert" },
				h("div", null, error),
				pendingOpen ? h("button", { className: "dsh-tavern-btn", disabled: busy, style: { marginTop: "8px" }, onClick: retryPendingOpen }, "重新连接已创建的 Session") : null
			) : null;
			const openingChoice = openingPicker ? h(React.Fragment, null,
				h("div", { className: "dsh-tavern-card-picker-head" }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { playPrewarmRef.current.cancel(); setOpeningPicker(null); } }, "← 返回"), h("span", null, openingPicker.card.name + " · 游戏准备"), h("span", { className: "dsh-tavern-spacer" }), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: closePicker }, "关闭")),
				busy && selectedOpening ? h("div", {
					key: "starting-" + selectedOpening.id,
					className: "dsh-tavern-greeting-preview",
					role: "region",
					"aria-label": openingPicker.card.name + "开场白预览"
				}, renderTavernProjection(selectedOpening.projection, {
					streaming: false,
					codeLabels: { copyLabel: "复制", copiedLabel: "已复制" },
					mentions: [],
					sessionId: "",
					turn: 1,
					helperContext: null,
					trustedCardMode: openingPicker.trustedCardMode
				})) : null,
				busy ? h("div", { className: "dsh-tavern-session-switching", role: "status" }, "正在完成游戏初始化…") : null,
					selectedOpening && selectedOpening.usesUser ? h(React.Fragment, null,
						h("label", { className: "dsh-tavern-player-name" }, h("span", null, "故事中的玩家称呼（可选）"), h("input", { value: openingPicker.userName || "你", maxLength: 80, autoFocus: true, placeholder: "你", disabled: busy, onChange: function (event) { setOpeningPicker(Object.assign({}, openingPicker, { userName: event.target.value })); } })),
						h("div", { className: "dsh-tavern-player-name-help" }, "可以填写姓名、昵称或身份；不填则使用“你”。开场白预览会随之更新。")
					) : null,
				openingPicker.openings.length > 1 ? h("div", { className: "dsh-tavern-greeting-nav" },
					h("button", { className: "dsh-tavern-btn", disabled: busy, "aria-label": "上一条开场白", onClick: function () { setOpeningPicker(Object.assign({}, openingPicker, { index: (openingPicker.index - 1 + openingPicker.openings.length) % openingPicker.openings.length })); } }, "←"),
					h("div", { className: "dsh-tavern-greeting-count" }, (openingPicker.index + 1) + " / " + openingPicker.openings.length),
					h("button", { className: "dsh-tavern-btn", disabled: busy, "aria-label": "下一条开场白", onClick: function () { setOpeningPicker(Object.assign({}, openingPicker, { index: (openingPicker.index + 1) % openingPicker.openings.length })); } }, "→")
				) : (openingPicker.openings.length === 0 ? h("div", { className: "dsh-tavern-side-empty" }, "这张人物卡没有开场白，将从空白场景开始。") : null),
				!busy && selectedOpening && openingPicker.openings.length > 1 ? h("div", {
					key: selectedOpening.id,
					className: "dsh-tavern-greeting-preview",
					role: "region",
					"aria-label": openingPicker.card.name + "开场白预览"
				}, renderTavernProjection(selectedOpening.projection, {
					streaming: false,
					codeLabels: { copyLabel: "复制", copiedLabel: "已复制" },
					mentions: [],
					sessionId: "",
					turn: 1,
					helperContext: selectedOpening.helperContext,
					trustedCardMode: openingPicker.trustedCardMode
				})) : null,
				h("div", { className: "dsh-tavern-picker-foot" }, h("button", { className: "dsh-tavern-question-primary", disabled: busy || (openingPicker.openings.length > 0 && !selectedOpening), onClick: function () { newConversation(openingPicker.card, null, selectedOpening ? selectedOpening.id : "", openingPicker.userName || "你"); } }, selectedOpening && openingPicker.openings.length > 1 ? "以此开场" : "开始游戏"))
			) : null;
			const playPicker = h("div", { className: "dsh-tavern-card-picker", role: "dialog", "aria-modal": "true", "aria-label": openingPicker ? "游戏准备" : "选择人物卡开始游玩" }, pickerError, openingPicker ? openingChoice : h(React.Fragment, null,
				h("div", { className: "dsh-tavern-card-picker-head" }, h("span", null, "选择人物卡 · 开始游玩"), h("span", { className: "dsh-tavern-spacer" }), h(MobileCardImportButton, { inputRef: fileRef, disabled: busy, onImported: async function () { await refresh(); notifyDataChanged(["cards"]); } }), h("button", { className: "dsh-tavern-btn", onClick: closePicker }, "关闭")),
				h("input", { ref: fileRef, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importCard(f); e.target.value = ""; } }),
				cards.length ? h(React.Fragment, null, h("div", { className: "dsh-tavern-side-empty", style: { padding: "4px 6px" } }, "已绑定剧本的人物卡将自动按剧本推进；未绑定的按自由故事推进。剧本绑定在“卡片模式”中管理。"), cards.map(function (card) { return h("div", { key: card.path, className: "dsh-tavern-card-pick-wrap" },
					h("button", { className: "dsh-tavern-card-pick" + (card.hasImage ? " with-image" : ""), disabled: busy, onClick: function () { preparePlayConversation(card); } }, h(TavernCardListContent, { card: card, detail: card.script ? ("剧本：" + card.script.title) : "自由故事（未绑定剧本）" })),
					h("button", { className: "dsh-tavern-script-file", disabled: busy, title: "从人物卡库删除", onClick: function () { if (window.confirm("从人物卡库删除“" + card.name + "”吗？\n人物卡工作版和原版都会删除，已有对话会保留。")) call("deleteCard", { path: card.path }).then(refresh, function (err) { setError(String(err && err.message || err)); }); } }, "删除"),
					h("button", { className: "dsh-tavern-script-file", disabled: busy, title: "导出为 SillyTavern 兼容 JSON", onClick: function () { exportCard(card); } }, "导出")
				); })) : h("div", { className: "dsh-tavern-empty" }, "还没有人物卡。\n点“导入人物卡”添加 PNG/JSON 卡片。")
			));
			const cardEditRows = cards.length ? cards.map(function (card) { return h("div", { key: card.path, className: "dsh-tavern-card-pick-wrap" },
				h("button", { className: "dsh-tavern-card-pick" + (card.hasImage ? " with-image" : ""), disabled: busy, onClick: function () { newCardConversation(card, "edit", "修改人物卡"); } }, h(TavernCardListContent, { card: card, detail: "选择这张人物卡开始修改" }))
			); }) : h("div", { className: "dsh-tavern-empty" }, "还没有人物卡，可先在空白工作台中创建。");
			const cardMvuRows = cards.length ? cards.map(function (card) { return h("div", { key: card.path, className: "dsh-tavern-card-pick-wrap" },
				h("button", { className: "dsh-tavern-card-pick" + (card.hasImage ? " with-image" : ""), disabled: busy, onClick: function () { newCardConversation(card, "mvu", "把人物卡转成 MVU 版"); } }, h(TavernCardListContent, { card: card, detail: "转换为 MVU 后，状态栏绝对不会掉格式" }))
			); }) : h("div", { className: "dsh-tavern-empty" }, "还没有人物卡，可先导入一张需要转换的卡。");
			const chosenInitialResources = Object.keys(selectedInitialResources).map(function (key) { return selectedInitialResources[key]; });
			function initialResourceGroup(title, items) {
				return h(React.Fragment, null,
					h("div", { className: "dsh-tavern-picker-group" }, title + " · " + items.length),
					items.length ? items.map(function (item) {
						const key = item.kind + ":" + item.path;
						const selected = !!selectedInitialResources[key];
						return h("button", { key: item.kind + ":" + item.path, className: "dsh-tavern-card-pick" + (selected ? " selected" : ""), "aria-pressed": selected ? "true" : "false", disabled: busy, onClick: function () { toggleInitialResource(item); } }, h("b", null, (selected ? "✓ " : "") + item.title), h("span", null, item.detail || (item.chunkCount ? item.chunkCount + " 块" : "可作为人物卡参考资料")));
					}) : h("div", { className: "dsh-tavern-side-empty", style: { padding: "8px" } }, "暂无")
				);
			}
				const initialResourceTitle = cardEntry === "worldbook" ? "世界书" : cardEntry === "preset" ? "预设" : "剧本";
			const initialResourcePicker = initialResources.length ? h(React.Fragment, null,
				initialResourceGroup(initialResourceTitle, initialResources),
				h("div", { className: "dsh-tavern-picker-foot" }, h("button", { className: "dsh-tavern-question-primary", disabled: busy || !chosenInitialResources.length, onClick: function () {
						if (cardEntry === "script") newCardConversation(null, "script", "修改剧本", chosenInitialResources);
					else if (cardEntry === "worldbook") newCardConversation(null, "worldbook", "修改世界书", chosenInitialResources);
					else if (cardEntry === "preset") newCardConversation(null, "preset", "修改预设", chosenInitialResources);
						else newCardConversation(null, "extract", "从剧本新建人物卡", chosenInitialResources);
				} }, "用已选 " + chosenInitialResources.length + (cardEntry === "script" || cardEntry === "extract" ? " 份剧本开始" : " 项开始")))
			) : h("div", { className: "dsh-tavern-empty" }, "暂无可选" + initialResourceTitle + "，可点击右上角导入。");
			const initialImportLabel = cardEntry === "worldbook" ? "导入世界书" : cardEntry === "preset" ? "导入预设" : cardEntry === "extract" || cardEntry === "script" ? "导入剧本" : "";
			const initialImportAccept = cardEntry === "worldbook" || cardEntry === "preset" ? ".json,application/json" : ".txt,.md,.json,.epub,text/plain,text/markdown,application/json,application/epub+zip";
			const cardPicker = h("div", { className: "dsh-tavern-card-picker", role: "dialog", "aria-modal": "true", "aria-label": "选择卡片工作台起始任务" }, pickerError,
				h("div", { className: "dsh-tavern-card-picker-head" }, cardEntry ? h("button", { className: "dsh-tavern-btn", onClick: function () { setCardEntry(""); } }, "← 返回") : h("span", null, "选择起始任务"), cardEntry === "extract" ? h("span", null, "选择初始剧本（至少 1 份）") : cardEntry === "mvu" ? h("span", null, "选择要转换的人物卡") : cardEntry === "script" || cardEntry === "worldbook" || cardEntry === "preset" ? h("span", null, "选择一个编辑目标") : null, h("span", { className: "dsh-tavern-spacer" }), cardEntry === "edit" || cardEntry === "mvu" ? h(MobileCardImportButton, { inputRef: fileRef, disabled: busy, onImported: async function () { await refresh(); notifyDataChanged(["cards"]); } }) : null, initialImportLabel ? h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { initialImportRef.current && initialImportRef.current.click(); } }, initialImportLabel) : null, h("button", { className: "dsh-tavern-btn", onClick: closePicker }, "关闭")),
				h("input", { ref: fileRef, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importCard(f); e.target.value = ""; } }),
				h("input", { ref: initialImportRef, type: "file", accept: initialImportAccept, style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importInitialResource(f, cardEntry); e.target.value = ""; } }),
					cardEntry === "edit" ? cardEditRows : cardEntry === "mvu" ? cardMvuRows : cardEntry === "extract" || cardEntry === "script" || cardEntry === "worldbook" || cardEntry === "preset" ? initialResourcePicker : h(React.Fragment, null,
						h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { setCardEntry("edit"); } }, h("b", null, "修改人物卡"), h("span", null, "先选择人物卡，再追加修改任务提示词")),
						h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { setCardEntry("mvu"); } }, h("b", null, "把人物卡转成 MVU 版"), h("span", null, "转换为 MVU 后，状态栏绝对不会掉格式")),
						h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { openResourcePicker("extract"); } }, h("b", null, "从剧本新建人物卡"), h("span", null, "先选择至少一份剧本，再进入工作台")),
						h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { openResourcePicker("script"); } }, h("b", null, "修改剧本"), h("span", null, "先选择一份剧本，再进入工作台修改工作版")),
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { openResourcePicker("worldbook"); } }, h("b", null, "修改世界书"), h("span", null, "先选择一本世界书，再进入工作台按条目修改")),
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { openResourcePicker("preset"); } }, h("b", null, "修改预设"), h("span", null, "先选择一个预设，交给卡片 Agent 阅读和修改")),
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { newCardConversation(null); } }, h("b", null, "空白开始"), h("span", null, "不追加任务提示词，自由使用完整卡片 Agent"))
				)
			);
			const updateMessage = updateStatus.phase === "checking"
				? "正在通过 jsDelivr 检查最新构建…"
				: updateStatus.phase === "up-to-date"
					? "✓ 未发现更新构建"
				: updateStatus.phase === "update-available"
					? "发现新构建 " + ((updateStatus.latestCommit || "").slice(0, 7) || updateStatus.latestVersion || "")
				: updateStatus.phase === "running"
				? "正在下载并安装，期间页面可能暂时断开… 如果较长时间仍未更新完成，建议重新安装一次；检测到 Git 时只会下载运行所需代码。"
				: updateStatus.phase === "installed-restart-required"
					? (updateStatus.error || "程序文件已更新，但自动重启失败。请手动重启 DSH Tavern。")
				: updateStatus.phase === "restart-required"
					? "请重启 DSH Desktop 以加载新版插件。"
				: updateStatus.phase === "completed"
					? (updateStatus.host === "desktop"
						? "更新完成，请重启 DSH Desktop。"
						: updateStatus.host === "android"
							? "Android 更新完成，3088 服务已重启；如移动端界面未更新，请重启 DSHA。"
							: "更新完成，请刷新页面。")
					: updateStatus.phase === "failed" || updateStatus.phase === "check-failed"
						? (updateStatus.error || "更新失败，请稍后重试。")
						: "尚未检查更新";
			const currentVersionLabel = updateStatus.currentVersion && updateStatus.currentVersion !== "unknown" ? "v" + updateStatus.currentVersion : "版本未知";
			const currentCommitLabel = (updateStatus.currentCommit || "").slice(0, 7) || "构建未知";
			const updateHostLabel = updateStatus.host === "desktop" ? "Desktop 版" : (updateStatus.host === "android" ? "Android 版" : "命令行版");
			const checkingOrRunning = updateStatus.phase === "checking" || updateStatus.phase === "running" || updateStatus.phase === "loading";
			const updateActions = updateStatus.phase === "update-available"
				? h("div", { className: "dsh-tavern-update-actions" },
					h("button", { className: "dsh-tavern-update-button", onClick: checkUpdate }, "检查更新"),
					h("button", { className: "dsh-tavern-update-button primary", onClick: performUpdate }, "进行更新"))
				: h("div", { className: "dsh-tavern-update-actions" },
					h("button", { className: "dsh-tavern-update-button", disabled: checkingOrRunning || updateStatus.phase === "restart-required" || updateStatus.phase === "installed-restart-required", onClick: checkUpdate }, updateStatus.phase === "checking" ? "正在检查…" : (updateStatus.phase === "running" ? "正在更新…" : (updateStatus.phase === "installed-restart-required" ? "请手动重启" : (updateStatus.phase === "restart-required" ? "重启 Desktop 后可用" : "检查更新")))));
			return h(React.Fragment, null, h(TavernErrorCenter), h("div", { className: "dsh-tavern-sidebar", style: { position: "relative", width: props.embedded ? "100%" : props.width + "px" } },
				h("div", { className: "dsh-tavern-side-head" }, h("div", { className: "dsh-tavern-side-brand" }, "🍺 DSH Tavern"), props.embedded ? null : h("button", { className: "dsh-tavern-side-icon", title: "收起侧栏", onClick: props.toggleSidebar }, "◧")),
				h("div", { className: "dsh-tavern-mode-switch" },
					h("button", { className: uiMode === "play" && requestMode === "dsh" ? "active" : "", disabled: busy, onClick: function () { switchPlayRequestMode("dsh"); } }, "游玩"),
					h("button", { className: uiMode === "card" ? "active" : "", disabled: busy, onClick: function () { switchMode("card"); } }, "卡片")
				),
				h("button", { className: "dsh-tavern-side-new", disabled: busy, onClick: function () { openPicker(); } }, uiMode === "play" ? "＋ 选择人物卡 · 新开游玩" : "＋ 新建卡片工作台对话"),
				h("div", { className: "dsh-tavern-side-title" }, uiMode === "play" ? "游玩历史" : "卡片历史"),
				h("div", { className: "dsh-tavern-side-list" }, rows.length ? rows : h("div", { className: "dsh-tavern-side-empty" }, uiMode === "play" ? "还没有游玩对话。\n选择人物卡开始；绑定剧本的卡会按剧本推进。" : "还没有卡片工作台对话。\n可以空白开始，再按需添加人物卡和剧本。")),
				!picking && error ? h("div", { className: "dsh-tavern-dock-error", role: "alert" }, error) : null,
				h("div", { className: "dsh-tavern-update" },
					h("div", { className: "dsh-tavern-update-identity" }, "DSH Tavern " + currentVersionLabel + " · " + currentCommitLabel + " · " + updateHostLabel),
					updateActions,
					h("div", { className: "dsh-tavern-update-status" + (updateStatus.phase === "failed" || updateStatus.phase === "check-failed" ? " error" : "") }, updateMessage)
				),
				picking ? h("div", { className: "dsh-tavern-picker-overlay", onMouseDown: function (event) { if (event.target === event.currentTarget) closePicker(); } }, uiMode === "play" ? playPicker : cardPicker) : null
			));
		}

		function register(input) {
			const ctx = input.ctx;
			const slots = input.slots;
			const uiConversation = ctx.get("uiConversation") || ctx.get("conversation");
			ctx.effect(function () {
				document.body.classList.add("dsh-tavern-shell-active");
				return function () { document.body.classList.remove("dsh-tavern-shell-active"); };
			}, "dsh-tavern: shell marker");
			ctx.effect(() => slots.inject("sidebar.workspaces", () => slots.register(
				{ name: "sidebar.workspaces", priority: -1 },
				function (props) { return React.createElement(TavernSidebar, Object.assign({}, props, {
					collapsed: !props.wide,
					embedded: true,
					sessions: ctx.sessions,
					workspaces: ctx.workspaces,
					conversationHost: createConversationHostAdapter(ctx),
					renameSession: async function (sessionId, title) {
						const session = ctx.sessions.binding(sessionId)?.session;
						if (session === undefined) throw new Error("找不到该对话");
						const result = await session.rename(title);
						if (!result.ok) throw new Error(result.error.message);
					},
					archiveSession: function (sessionId) { return ctx.workspaces.archiveSession(sessionId); },
					toggleSidebar: function () { if (props.wide) ctx.layout.toggleSidebar(); else props.expandSidebar(); },
					openStatusTab: function (sessionId) { ctx.betterSidebar.openTab({ type: "dsh-tavern:status" }, { sessionId: sessionId }); },
					openCardLibraryTab: function (sessionId) { ctx.betterSidebar.openTab({ type: "dsh-tavern:cards" }, { sessionId: sessionId }); ctx.betterSidebar.updateTab("dsh-tavern:cards", { meta: null }); },
					openPresetLibraryTab: function (sessionId) { ctx.betterSidebar.openTab({ type: "dsh-tavern:presets" }, { sessionId: sessionId }); },
					openWorldBookLibraryTab: function (sessionId) { ctx.betterSidebar.openTab({ type: "dsh-tavern:worldbooks" }, { sessionId: sessionId }); },
					openResourcesTab: function (sessionId) { ctx.betterSidebar.openTab({ type: "dsh-tavern:resources" }, { sessionId: sessionId }); },
					appendMention: input.appendMention,
					injectTaskPrompt: input.injectTaskPrompt
				})); }
			)), "dsh-tavern: Tavern workspace browser");
		}
		return Object.freeze({ register: register });
		}
		const tavernShellFeature = createTavernShellFeatureModule();

		function sceneImageRequestId() {
			// LAN HTTP deployments may not expose crypto.randomUUID. This identifies a
			// request, not an authentication secret; no secure-context API is required.
			return "scene-" + Date.now() + "-" + Math.random().toString(36).slice(2) + "-" + Math.random().toString(36).slice(2);
		}
		function sceneImageStageLabel(record) {
			return record && record.cancelRequestedAt ? "正在取消…" : record && record.stage === "queued" ? "排队等待生图…" : record && record.stage === "saving" ? "保存图片…" : record && record.stage === "generating" ? "生成图片…" : "整理画面…";
		}
		function sceneImagePurchaseConfirmation(record) {
			if (!record || record.outcome !== "unconfirmed" || record.providerTask) return undefined;
			return window.confirm("上一次生图结果未确认，服务可能已经计费。仍要重新请求一张图片吗？这可能再次产生费用。") ? record.requestId : false;
		}
		function useSceneImageRecord(sessionId, turn) {
			const [state, setState] = React.useState(null);
			React.useEffect(function () {
				let active = true, timer, revision = 0;
				setState(null);
				if (!sessionId || !turn) return;
				async function refresh(event) {
					if (event && event.detail && event.detail.sessionId !== sessionId) return;
					const requested = ++revision;
					window.clearTimeout(timer);
					try {
						const result = await rpc("sceneImageStatus", { turn: turn }, sessionId);
						if (!active || requested !== revision) return;
						setState(result.illustration);
						if (result.illustration.status === "running") timer = window.setTimeout(refresh, 1500);
					} catch (e) {
						if (active && requested === revision) setState(function (previous) { return previous ? Object.assign({}, previous, { error: String(e.message || e) }) : null; });
					}
				}
				void refresh();
				window.addEventListener("dsh-tavern-image-changed", refresh);
				window.addEventListener("dsh-tavern-image-settings-changed", refresh);
				window.addEventListener("focus", refresh);
				return function () { active = false; window.clearTimeout(timer); window.removeEventListener("dsh-tavern-image-changed", refresh); window.removeEventListener("dsh-tavern-image-settings-changed", refresh); window.removeEventListener("focus", refresh); };
			}, [sessionId, turn]);
			return state;
		}
		function SceneImageAction(props) {
			const [settings, setSettings] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const requestRef = React.useRef(null);
			const state = useSceneImageRecord(props.sessionId, props.turn);
			React.useEffect(function () {
				let active = true, revision = 0;
				async function refresh() {
					const request = ++revision;
					try { const result = await rpc("getSceneImageSettings"); if (active && revision === request) setSettings(result.settings); }
					catch (_) { if (active && revision === request) setSettings(null); }
				}
				void refresh();
				const timer = window.setInterval(refresh, 15000);
				window.addEventListener("dsh-tavern-image-settings-changed", refresh);
				window.addEventListener("focus", refresh);
				return function () { active = false; window.clearInterval(timer); window.removeEventListener("dsh-tavern-image-settings-changed", refresh); window.removeEventListener("focus", refresh); };
			}, []);
			async function generate() {
				if (!settings || !settings.enabled || !settings.ready || settings.migrationPending || !state || busy || props.running || state.status === "running" || state.recovery === "save" || state.versions && state.versions.length) return;
				const confirmNewRequestId = sceneImagePurchaseConfirmation(state);
				if (confirmNewRequestId === false) return;
				if (requestRef.current && requestRef.current.id === state.requestId && ["failed", "cancelled"].includes(state.status)) requestRef.current = null;
				setBusy(true); setError("");
				if (!requestRef.current || requestRef.current.key !== state.key) requestRef.current = { key: state.key, id: sceneImageRequestId() };
				try { await rpc("generateSceneImage", { turn: props.turn, key: state.key, requestId: requestRef.current.id, confirmNewRequestId: confirmNewRequestId }, props.sessionId); requestRef.current = null; }
				catch (e) { setError(String(e.message || e)); }
				finally { setBusy(false); window.dispatchEvent(new CustomEvent("dsh-tavern-image-changed", { detail: { sessionId: props.sessionId } })); }
			}
			if (!settings || settings.enabled !== true) return null;
			const unavailable = settings.migrationPending ? "旧生图配置待迁移，请在设置中点击「保存并启用」。" : !settings.ready ? "生图配置未完成，请在设置中补全并保存。" : "";
			const working = state && state.status === "running";
			return React.createElement(React.Fragment, null,
				React.createElement("button", { type: "button", className: "dsh-tavern-choice-trigger", title: unavailable || undefined, disabled: Boolean(unavailable) || !state || props.running || busy || working || state.recovery === "save" || state.versions && state.versions.length > 0, onClick: generate }, busy ? "整理画面…" : working ? sceneImageStageLabel(state) : state && state.recovery === "save" ? "图片待保存" : state && state.outcome === "unconfirmed" ? state.providerTask ? "查询原任务" : "重新生图" : state && state.status === "failed" && !state.versions.length ? "重试生图" : "生图"),
				unavailable ? React.createElement("span", { role: "status", className: "dsh-tavern-settings-desc" }, unavailable) : null,
				error ? React.createElement("span", { role: "alert", className: "dsh-tavern-settings-error" }, error) : null
			);
		}
		function SceneImageSettings() {
			const [form, setForm] = React.useState(null);
			const [dirty, setDirty] = React.useState(false);
			const [key, setKey] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [notice, setNotice] = React.useState("");
			const [connection, setConnection] = React.useState(null);
			const [models, setModels] = React.useState([]);
			const [modelNotice, setModelNotice] = React.useState("");
			const [checking, setChecking] = React.useState("");
			// Follow the saved enable state until the user expands or closes the form.
			const [expanded, setExpanded] = React.useState(null);
			const opened = expanded === null ? Boolean(form && form.enabled) : expanded;
			React.useEffect(function () {
				let active = true;
				rpc("getSceneImageSettings").then(function (result) { if (active) setForm(result.settings); }, function (e) { if (active) setNotice(String(e.message || e)); });
				return function () { active = false; };
			}, []);
			async function save(patch) {
				setBusy(true); setNotice("");
				try {
					const channel = form.channels.find(function (item) { return item.id === form.provider; });
					const input = patch ? Object.assign({ provider: form.provider }, patch) : { provider: form.provider, style: form.style, apiKey: key };
					if (!patch) channel.fields.forEach(function (field) { input[field] = form[field]; });
					if (!patch && form.provider === "comfyui") input.workflow = form.workflow;
					let result = await rpc("saveSceneImageSettings", input); setForm(result.settings); setKey(""); setDirty(false);
					window.dispatchEvent(new CustomEvent("dsh-tavern-image-settings-changed"));
					if (!patch && result.settings.ready && !result.settings.enabled) {
						result = await rpc("saveSceneImageSettings", { provider: result.settings.provider, enabled: true });
						setForm(result.settings);
					}
					setNotice(result.settings.enabled ? "已保存并启用" : "已保存，请补全配置后启用");
					window.dispatchEvent(new CustomEvent("dsh-tavern-image-settings-changed"));
					return true;
				}
				catch (e) { setNotice(String(e.message || e)); return false; }
				finally { setBusy(false); }
			}
			async function toggle(enabled) {
				if (enabled) {
					setExpanded(true); setNotice("");
					if (form.ready && !dirty && form.provider === form.activeProvider) {
						if (!await save({ enabled: true })) setExpanded(false);
					}
					return;
				}
				setBusy(true); setNotice("");
				try {
					// Disable the saved active channel, not a different unsaved preview.
					await rpc("saveSceneImageSettings", { enabled: false });
					setForm(function (current) { return Object.assign({}, current, { enabled: false }); });
					setExpanded(false);
					window.dispatchEvent(new CustomEvent("dsh-tavern-image-settings-changed"));
				} catch (e) { setNotice(String(e.message || e)); }
				finally { setBusy(false); }
			}
			async function chooseChannel(provider) {
				setBusy(true); setNotice("");
				setConnection(null); setModels([]); setModelNotice("");
				try {
					const result = await rpc("getSceneImageSettings", { provider });
					setForm(result.settings); setKey(""); setDirty(true);
					setNotice("已读取此渠道配置；配置完成后点击保存并启用。未保存的修改不保留。");
				} catch (e) { setNotice(String(e.message || e)); }
				finally { setBusy(false); }
			}
			const selectedChannel = form && (form.channels || []).find(function (item) { return item.id === form.provider; });
			const modelOptions = Array.from(new Set((selectedChannel && selectedChannel.models || []).concat(models)));
			function resetConnection() { setConnection(null); setModels([]); setModelNotice(""); }
			async function inspectConnection(listModels) {
				setBusy(true); setChecking(listModels ? "models" : "connection"); setNotice("");
				if (listModels) setModelNotice(""); else setConnection(null);
				try {
					const result = await rpc(listModels ? "listSceneImageModels" : "testSceneImageConnection", { provider: form.provider, baseURL: form.baseURL, authType: form.authType, username: form.username, apiKey: key });
					if (listModels) { setModels(result.models || []); setModelNotice(result.message); }
					else setConnection(result);
				} catch (e) {
					if (listModels) setModelNotice(String(e.message || e));
					else setConnection({ status: "failed", message: String(e.message || e) });
				} finally { setBusy(false); setChecking(""); }
			}
			async function importWorkflow(event) {
				const file = event.target.files && event.target.files[0];
				if (!file) return;
				setBusy(true); setNotice("");
				try {
					if (file.size > 512000) throw new Error("工作流文件不能超过 500 KB");
					let workflow; try { workflow = JSON.parse(await file.text()); } catch (e) { throw new Error("工作流不是有效 JSON 文件"); }
					setForm(function (current) { return Object.assign({}, current, { workflow: workflow }); }); setDirty(true);
					setNotice("已选择工作流，保存后将校验；不会请求生图。请只导入可信维护者提供的文件。");
				} catch (e) { setNotice(String(e.message || e)); }
				finally { setBusy(false); event.target.value = ""; }
			}
			function channelField(field) {
				if (field === "username" && form.authType !== "basic") return null;
				const labels = { baseURL: "API 根地址", model: "生图模型名称", size: "图片尺寸／分辨率", aspectRatio: "画面比例", authType: "服务鉴权", username: "鉴权用户名" };
				function change(event) { const value = event.target.value; setDirty(true); if (["baseURL", "authType", "username"].includes(field)) resetConnection(); if (field === "authType") setKey(""); setForm(function (current) { return Object.assign({}, current, { [field]: value }, field === "authType" ? { hasKey: false } : {}); }); }
				const control = field === "authType" ? React.createElement("select", { value: form[field], disabled: busy, onChange: change }, [ ["none", "无需鉴权"], ["basic", "用户名和密码"], ["bearer", "Bearer Token（反向代理）"] ].map(function (option) { return React.createElement("option", { key: option[0], value: option[0] }, option[1]); }))
					: React.createElement("input", { value: form[field], disabled: busy, onChange: change });
				return React.createElement("label", { key: field }, labels[field] || field, control);
			}
			return React.createElement("div", { className: "dsh-tavern-settings-group" },
				React.createElement("label", { className: "dsh-tavern-settings-row" },
					React.createElement("span", { className: "dsh-tavern-settings-copy" },
						React.createElement("span", { className: "dsh-tavern-settings-title" }, "开启场景生图"),
						React.createElement("span", { className: "dsh-tavern-settings-desc" }, opened && form && !form.enabled ? "请完成下方配置并保存后启用，不会自动生成图片。" : "开启后可手动为剧情配图；关闭保留配置和已有图片。")),
					React.createElement("span", { className: "dsh-tavern-settings-switch" },
						React.createElement("input", { type: "checkbox", role: "switch", "aria-label": "开启场景生图", "aria-expanded": opened, checked: Boolean(form && form.enabled), disabled: !form || busy, onChange: function (event) { return toggle(event.target.checked); } }),
						React.createElement("span", { className: "dsh-tavern-settings-track", "aria-hidden": "true" }))),
				opened ? React.createElement("div", { className: "dsh-tavern-image-settings" },
					React.createElement("p", { className: "dsh-tavern-settings-intro" }, "配置并启用后，在输入框上方点「生图」。连接测试不生成图片；实际生图可能产生费用。"),
					form ? React.createElement("label", null, "提供商", React.createElement("select", { value: form.provider, disabled: busy, onChange: function (e) { return chooseChannel(e.target.value); } }, (form.channels || []).map(function (item) { return React.createElement("option", { key: item.id, value: item.id }, item.label); }))) : null,
					selectedChannel ? React.createElement("p", null, selectedChannel.hint) : null,
					form && form.migrationPending ? React.createElement("p", { role: "status" }, "检测到旧配置。保存后将迁入生图模块；旧密钥不会显示或发送到新地址。") : null,
					selectedChannel ? selectedChannel.fields.filter(function (field) { return ["baseURL", "authType", "username"].includes(field); }).map(channelField) : null,
					form && form.provider !== "dsh-image-gen" && !(["webui", "comfyui"].includes(form.provider) && form.authType === "none") ? React.createElement("label", null, (form.authType === "basic" ? "鉴权密码" : "API Key") + (form.hasKey ? "（已配置，留空保留；更换地址需重新填写）" : ""), React.createElement("input", { type: "password", autoComplete: "new-password", value: key, disabled: busy, onChange: function (e) { setKey(e.target.value); setDirty(true); resetConnection(); } })) : null,
					form && form.provider === "dsh-image-gen" ? React.createElement("div", null,
						React.createElement("p", { role: "status" }, form.pluginError || (form.pluginReady ? "已读取插件配置：" + form.pluginProvider + " / " + form.model + " · " + form.aspectRatio + " · " + form.size + "。未验证 Key 或执行生图。" : "请先在 dsh-image-gen 插件设置中配置云端渠道和 Key。")),
						React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { return chooseChannel("dsh-image-gen"); } }, "刷新插件配置"))
						: React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: !form || busy || !form.baseURL, onClick: function () { return inspectConnection(false); } }, checking === "connection" ? "验证中…" : "测试连接与鉴权"),
					connection ? React.createElement("span", { role: "status", "data-connection-status": connection.status }, connection.message) : null,
					connection && connection.httpStatus ? React.createElement("details", null,
						React.createElement("summary", null, "连接诊断"),
						React.createElement("p", null, "HTTP " + connection.httpStatus + " · 只读检查路径：" + (connection.probePath || "/") + "。未调用生图接口；根路径返回 404 不代表生图接口不可用。")) : null,
					selectedChannel && form.provider !== "dsh-image-gen" && selectedChannel.fields.includes("model") ? React.createElement("div", null,
						React.createElement("label", null, "生图模型", React.createElement("input", { list: "dsh-tavern-image-models", value: form.model || "", placeholder: "选择或输入模型名称", disabled: busy, onChange: function (e) { const value = e.target.value; setDirty(true); setForm(function (current) { return Object.assign({}, current, { model: value }); }); } })),
						React.createElement("datalist", { id: "dsh-tavern-image-models" }, modelOptions.map(function (model) { return React.createElement("option", { key: model, value: model }, model); })),
						selectedChannel.canListModels ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || !form.baseURL, onClick: function () { return inspectConnection(true); } }, checking === "models" ? "获取中…" : "获取模型列表") : React.createElement("p", null, "此渠道使用预设或手动填写模型；连接测试不验证模型。"),
						modelNotice ? React.createElement("span", { role: "status" }, modelNotice) : null) : null,
					form && form.provider === "comfyui" ? React.createElement("div", null,
						React.createElement("p", null, form.workflow ? "工作流：" + (form.workflow.name || "已选择，待保存校验") : "尚未导入工作流"),
						React.createElement("label", null, "导入工作流", React.createElement("input", { type: "file", accept: ".json,application/json", disabled: busy, onChange: importWorkflow }))) : null,
					form ? React.createElement("details", null,
					React.createElement("summary", null, "绘图选项（风格、尺寸）"),
					selectedChannel && form.provider !== "dsh-image-gen" ? selectedChannel.fields.filter(function (field) { return ["size", "aspectRatio"].includes(field); }).map(channelField) : null,
					form ? React.createElement("label", null, "风格预设", React.createElement("select", { value: form.style.preset, disabled: busy, onChange: function (e) { const value = e.target.value; setDirty(true); setForm(function (current) { return Object.assign({}, current, { style: Object.assign({}, current.style, { preset: value }) }); }); } }, (form.stylePresets || []).map(function (preset) { return React.createElement("option", { key: preset.id, value: preset.id }, preset.label); }))) : null,
					form ? React.createElement("label", null, "补充描述／标签（选填）", React.createElement("textarea", { value: form.style.custom, rows: 2, maxLength: 2000, placeholder: "例如：低饱和、柔和光线、胶片质感", disabled: busy, onChange: function (e) { const value = e.target.value; setDirty(true); setForm(function (current) { return Object.assign({}, current, { style: Object.assign({}, current.style, { custom: value }) }); }); } })) : null) : null,
					React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: !form || busy, onClick: function () { return save(); } }, busy && !checking ? "保存中…" : form && form.enabled ? "保存生图设置" : "保存并启用")
				) : null,
				notice ? React.createElement("div", { role: "status", className: "dsh-tavern-settings-desc" }, notice) : null
			);
		}
		const EMPTY_PROJECTION_FACE = Object.freeze({ subscribe: function () { return function () {}; }, getSnapshot: function () { return null; } });

		function backgroundModelLabel(selection, catalog) {
			if (!selection || !selection.provider || !selection.model) return "";
			const groups = Array.isArray(catalog) ? catalog : [];
			const group = groups.find(function (item) { return item && item.provider === selection.provider; });
			const model = group && Array.isArray(group.models) ? group.models.find(function (item) { return item && item.id === selection.model; }) : null;
			return (group && (group.providerName || group.provider) || selection.provider) + ": " + (model && (model.name || model.id) || selection.model);
		}

		function TavernBackgroundModelLabel(props) {
			const sessionId = String(props.sessionId || "");
			const binding = sessionId && props.sessions ? props.sessions.binding(sessionId) : null;
			const subagentFace = binding ? binding.session.projections.faceOf("subagent") : EMPTY_PROJECTION_FACE;
			const modelFace = binding ? binding.session.projections.faceOf("modelSelection") : EMPTY_PROJECTION_FACE;
			const identity = React.useSyncExternalStore(
				function (listener) { return subagentFace.subscribe(listener); },
				function () { return subagentFace.getSnapshot(); },
				function () { return subagentFace.getSnapshot(); }
			);
			const modelState = React.useSyncExternalStore(
				function (listener) { return modelFace.subscribe(listener); },
				function () { return modelFace.getSnapshot(); },
				function () { return modelFace.getSnapshot(); }
			);
			const [catalog, setCatalog] = React.useState([]);
			const isTavernBackground = Boolean(props.sessions && props.sessions.subagentAddress(sessionId)) && identity && identity.label === "酒馆后台 Agent";
			React.useEffect(function () {
				let active = true;
				if (!isTavernBackground) return function () { active = false; };
				rpc("getTavernSettings").then(function (result) {
					if (active) setCatalog(Array.isArray(result.modelCatalog) ? result.modelCatalog : []);
				}, function () {});
				return function () { active = false; };
			}, [isTavernBackground]);
			if (!isTavernBackground) return null;
			const selection = modelState && (modelState.next || modelState.lastUsed);
			const label = backgroundModelLabel(selection, catalog);
			if (!label) return null;
			return React.createElement("div", {
				className: "dsh-tavern-background-model",
				title: label + "（由 DSH Tavern 在本局开局时固定）",
				"aria-label": "后台模型：" + label
			}, React.createElement("span", null, label));
		}

		function TavernSettingsSection() {
			const [state, setState] = React.useState({ loading: true, busy: false, webSearchEnabled: false, backgroundModel: null, modelCatalog: [], sceneImages: false, error: "" });
			React.useEffect(function () {
				let active = true;
				rpc("getTavernSettings").then(function (result) {
					if (active) setState({ loading: false, busy: false, webSearchEnabled: Boolean(result.settings && result.settings.webSearchEnabled), backgroundModel: result.settings && result.settings.backgroundModel || null, modelCatalog: Array.isArray(result.modelCatalog) ? result.modelCatalog : [], sceneImages: Boolean(result.releaseCapabilities && result.releaseCapabilities.sceneImages), error: "" });
				}, function (error) {
					if (active) setState(function (current) { return Object.assign({}, current, { loading: false, busy: false, error: String(error && error.message || error) }); });
				});
				return function () { active = false; };
			}, []);
			async function setWebSearchEnabled(enabled) {
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "" }); });
				try {
					const result = await rpc("updateTavernSettings", { patch: { webSearchEnabled: enabled } });
					setState(function (current) { return Object.assign({}, current, { loading: false, busy: false, webSearchEnabled: Boolean(result.settings && result.settings.webSearchEnabled), error: "" }); });
					window.dispatchEvent(new CustomEvent("dsh-tavern-settings-changed"));
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (error) {
					setState(function (current) { return Object.assign({}, current, { busy: false, error: String(error && error.message || error) }); });
				}
			}
			async function setBackgroundModel(value) {
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "" }); });
				try {
					const backgroundModel = value === "" ? null : JSON.parse(value);
					const result = await rpc("updateTavernSettings", { patch: { backgroundModel: backgroundModel } });
					setState(function (current) { return Object.assign({}, current, { loading: false, busy: false, backgroundModel: result.settings && result.settings.backgroundModel || null, error: "" }); });
					window.dispatchEvent(new CustomEvent("dsh-tavern-settings-changed"));
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (error) {
					setState(function (current) { return Object.assign({}, current, { busy: false, error: String(error && error.message || error) }); });
				}
			}
			return React.createElement("div", { className: "dsh-tavern-settings-section" },
				React.createElement("p", { className: "dsh-tavern-settings-intro" }, "设置新游戏的默认选项。"),
				React.createElement("div", { className: "dsh-tavern-settings-group" },
					React.createElement("label", { className: "dsh-tavern-settings-row" },
						React.createElement("span", { className: "dsh-tavern-settings-copy" },
							React.createElement("span", { className: "dsh-tavern-settings-title" }, "开启联网搜索"),
							React.createElement("span", { className: "dsh-tavern-settings-desc" }, "开启后，新建游戏的前台与后台 Agent 都可以按需联网搜索。能力在开局时固化，修改此设置不会影响已有游戏。")
						),
						React.createElement("span", { className: "dsh-tavern-settings-switch" },
							React.createElement("input", { type: "checkbox", checked: state.webSearchEnabled, disabled: state.loading || state.busy, onChange: function (event) { void setWebSearchEnabled(event.target.checked); }, "aria-label": "开启联网搜索" }),
							React.createElement("span", { className: "dsh-tavern-settings-track", "aria-hidden": "true" })
						)
					),
					React.createElement("label", { className: "dsh-tavern-settings-row dsh-tavern-settings-model-row" },
						React.createElement("span", { className: "dsh-tavern-settings-copy" },
							React.createElement("span", { className: "dsh-tavern-settings-title" }, "后台模型"),
							React.createElement("span", { className: "dsh-tavern-settings-desc" }, "供候选项、MVU 与姿势结算共用。新游戏开局时固化，已有游戏不受影响。")
						),
						React.createElement("select", { className: "dsh-tavern-settings-select", value: state.backgroundModel ? JSON.stringify(state.backgroundModel) : "", disabled: state.loading || state.busy, onChange: function (event) { void setBackgroundModel(event.target.value); }, "aria-label": "后台模型" },
							React.createElement("option", { value: "" }, "跟随前台（开局时）"),
							state.modelCatalog.flatMap(function (group) { return (group.models || []).map(function (model) {
								const value = JSON.stringify({ provider: group.provider, model: model.id });
								return React.createElement("option", { key: group.provider + ":" + model.id, value: value }, (group.providerName || group.provider) + " · " + (model.name || model.id));
							}); })
						)
					)
				),
				state.sceneImages ? React.createElement(SceneImageSettings, null) : null,
				state.error ? React.createElement("div", { className: "dsh-tavern-settings-error", role: "alert" }, "保存失败：" + state.error) : null
			);
		}

		function UserPreferenceProfileTab(props) {
			const h = React.createElement;
			const sessionId = props.scope && props.scope.sessionId || "";
			const [record, setRecord] = React.useState(null);
			const [currentConversation, setCurrentConversation] = React.useState(null);
			const [editing, setEditing] = React.useState(false);
			const [injectionText, setInjectionText] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = usePersistentError("用户画像");
			function applyResult(result) {
				const next = result && result.userProfile || null;
				setRecord(next);
				if (result && Object.prototype.hasOwnProperty.call(result, "currentConversation")) setCurrentConversation(result.currentConversation || null);
				if (!editing && next && next.confirmed) {
					setInjectionText(String(next.confirmed.injectionText || ""));
				}
			}
			async function refresh() {
				try {
					applyResult(await rpc("getUserPreferenceProfile", { sessionId: sessionId }, sessionId));
					setError("");
				} catch (err) { setError(String(err && err.message || err)); }
			}
			React.useEffect(function () {
				refresh();
				function onData(event) { if (tavernDataChangeAffects(event, ["user-profile", "sessions"], "user-profile")) refresh(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				return function () { window.removeEventListener("dsh-tavern-data-changed", onData); };
			}, [sessionId]);
			function openAgentTask() {
				window.dispatchEvent(new CustomEvent("dsh-tavern-open-user-profile-task"));
			}
			async function toggleDefault() {
				if (!record || !record.hasConfirmed || busy) return;
				setBusy(true); setError("");
				try {
					const result = await rpc("setUserPreferenceProfileDefaultEnabled", { enabled: record.defaultEnabled !== true }, sessionId);
					applyResult(result);
					notifyTavernDataChanged(["user-profile"], "user-profile");
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function beginEdit() {
				if (!record || !record.confirmed) return;
				setInjectionText(String(record.confirmed.injectionText || ""));
				setEditing(true);
			}
			async function saveEdit() {
				if (!injectionText.trim() || busy) return;
				if (!window.confirm("保存后将成为新的已确认用户画像，仅影响以后新开的游戏。继续吗？")) return;
				setBusy(true); setError("");
				try {
					const result = await rpc("updateUserPreferenceProfile", { expectedRevision: record.confirmedRevision, summary: record.confirmed.summary, injectionText: injectionText }, sessionId);
					applyResult(result);
					setEditing(false);
					notifyTavernDataChanged(["user-profile"], "user-profile");
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			const header = h("div", { className: "dsh-tavern-status-head" },
				h("div", { className: "dsh-tavern-status-title" }, "用户画像"),
				h("div", { className: "dsh-tavern-user-profile-meta" }, record && record.hasConfirmed ? "已确认版本 v" + record.confirmedRevision : "尚未建立")
			);
			if (record === null) return h("div", { className: "dsh-tavern-user-profile" }, header, h("div", { className: "dsh-tavern-user-profile-body" }, error ? h("div", { className: "dsh-card-error" }, error) : h("div", { className: "dsh-tavern-status-empty" }, "正在读取用户画像…")));
			if (!record.hasConfirmed) return h("div", { className: "dsh-tavern-user-profile" }, header,
				h("div", { className: "dsh-tavern-user-profile-body" },
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					h("div", { className: "dsh-tavern-status-empty" }, record.hasDraft ? "已有未确认草案，可交给卡片 Agent 继续核对。" : "通过分批访谈建立长期游玩与写作偏好。"),
					h("div", { className: "dsh-tavern-user-profile-actions" }, h("button", { className: "dsh-tavern-script-primary", onClick: openAgentTask }, record.hasDraft ? "继续核对用户画像" : "开始建立用户画像"))
			));
			const confirmed = record.confirmed || {};
			const dimensions = Array.isArray(confirmed.dimensions) ? confirmed.dimensions : [];
			const rawAnswers = Array.isArray(confirmed.rawAnswers) ? confirmed.rawAnswers : [];
			return h("div", { className: "dsh-tavern-user-profile" }, header,
				h("div", { className: "dsh-tavern-user-profile-body" },
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					record.hasDraft ? h("div", { className: "dsh-tavern-extension-note" }, "存在尚未确认的新草案；当前仍使用已确认版本。") : null,
					currentConversation ? h("div", { className: "dsh-tavern-extension-note" }, "当前游戏：" + (currentConversation.enabled ? "已启用画像 v" + currentConversation.revision : "未启用画像") + "。本局创建后保持冻结。") : null,
					h("div", { className: "dsh-tavern-user-profile-switch" },
					h("span", null, h("b", null, "新游戏默认启用"), h("small", null, "仅在此处开启或关闭；只影响以后新开的游戏，不改变当前游戏。")),
					h("button", { className: "dsh-tavern-prompt-state is-toggle " + (record.defaultEnabled ? "on" : "off"), disabled: busy, onClick: toggleDefault, "aria-pressed": record.defaultEnabled === true }, record.defaultEnabled ? "已开启" : "已关闭")
				),
					editing ? h("div", { className: "dsh-tavern-user-profile-editor" },
						h("div", { className: "dsh-tavern-status-label", style: { marginTop: "14px" } }, "实际生效的偏好"),
						h("textarea", { value: injectionText, onChange: function (event) { setInjectionText(event.target.value); } }),
						h("div", { className: "dsh-tavern-user-profile-meta" }, "这次修改只影响以后新开的游戏，不改写已有 Session。"),
						h("div", { className: "dsh-tavern-user-profile-actions" },
							h("button", { className: "dsh-tavern-script-primary", disabled: busy || !injectionText.trim(), onClick: saveEdit }, "保存并确认修改"),
							h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { setEditing(false); } }, "取消")
						)
					) : h(React.Fragment, null,
						h("div", { className: "dsh-tavern-status-label", style: { marginTop: "14px" } }, "实际生效的偏好"),
						h("div", { className: "dsh-tavern-user-profile-text" }, String(confirmed.injectionText || "")),
						dimensions.length ? h("details", null,
							h("summary", null, "偏好维度 · " + dimensions.length),
							dimensions.map(function (item, index) {
								return h("div", { key: item.id || index, className: "dsh-tavern-user-profile-dimension" },
									h("b", null, String(item.label || item.id || "偏好")),
									h("p", null, String(item.conclusion || "")),
									h("div", { className: "dsh-tavern-user-profile-meta" }, "置信度：" + String(item.confidence || "uncertain") + (item.evidence ? " · 依据：" + String(item.evidence) : ""))
								);
							})
						) : null,
						rawAnswers.length ? h("details", null,
							h("summary", null, "原始回答 · " + rawAnswers.length),
							rawAnswers.map(function (item, index) {
								return h("div", { key: index, className: "dsh-tavern-user-profile-dimension" },
									h("b", null, String(item.question || "问题")),
									h("p", null, String(item.answer || ""))
								);
							})
						) : null,
						h("div", { className: "dsh-tavern-user-profile-actions" },
							h("button", { className: "dsh-tavern-script-primary", onClick: beginEdit }, "直接修改"),
							h("button", { className: "dsh-tavern-btn", onClick: openAgentTask }, "交给卡片 Agent 调查/修改")
						)
					)
			));
		}

		function createUserPreferenceProfileFeatureModule() {
			function register(input) {
				const ctx = input.ctx;
				return ctx.effect(() => ctx.betterSidebar.registerTab({
					id: "dsh-tavern:user-profile",
					title: "用户画像",
					order: 3,
					single: true,
					component: UserPreferenceProfileTab
				}), "dsh-tavern: Better Sidebar user profile tab");
			}
			return Object.freeze({ register: register });
		}
		const userPreferenceProfileFeature = createUserPreferenceProfileFeatureModule();

		function SystemPromptSidebarTab() {
			const h = React.createElement;
			const [state, setState] = React.useState({ loading: true, busy: false, prompts: [], drafts: {}, error: "", notice: "" });
			const importInput = React.useRef(null);
			function accept(result, notice) {
				const value = result && result.systemPrompts || {};
				setState({ loading: false, busy: false, prompts: Array.isArray(value.prompts) ? value.prompts : [], drafts: {}, error: "", notice: notice || "" });
			}
			async function load() {
				try { accept(await rpc("getSystemPrompts"), ""); }
				catch (error) { setState(function (current) { return Object.assign({}, current, { loading: false, error: String(error && error.message || error) }); }); }
			}
			React.useEffect(function () { void load(); }, []);
			function draft(item) { return Object.prototype.hasOwnProperty.call(state.drafts, item.name) ? state.drafts[item.name] : String(item.text || ""); }
			function edit(name, value) { setState(function (current) { return Object.assign({}, current, { drafts: Object.assign({}, current.drafts, { [name]: value }), error: "", notice: "" }); }); }
			async function save(item) {
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "", notice: "" }); });
				try { accept(await rpc("updateSystemPrompt", { name: item.name, text: draft(item) }), "已保存，将从下一次相关调用开始生效。"); }
				catch (error) { setState(function (current) { return Object.assign({}, current, { busy: false, error: String(error && error.message || error) }); }); }
			}
			async function restore(item) {
				if (!item.customized) { edit(item.name, String(item.text || "")); return; }
				if (!window.confirm("恢复“" + item.label + "”的系统默认内容？")) return;
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "", notice: "" }); });
				try { accept(await rpc("updateSystemPrompt", { name: item.name, text: null }), "已恢复该项默认内容。"); }
				catch (error) { setState(function (current) { return Object.assign({}, current, { busy: false, error: String(error && error.message || error) }); }); }
			}
			async function restoreAll() {
				if (!window.confirm("恢复全部系统提示词为当前版本默认内容？此操作会清除全部自定义修改。")) return;
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "", notice: "" }); });
				try { accept(await rpc("resetSystemPrompts"), "全部系统提示词已恢复默认。"); }
				catch (error) { setState(function (current) { return Object.assign({}, current, { busy: false, error: String(error && error.message || error) }); }); }
			}
			async function importFile(file) {
				if (!file || !window.confirm("导入将覆盖当前整套系统提示词，是否继续？")) return;
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "", notice: "" }); });
				try { accept(await rpc("importSystemPrompts", { payload: await parseTextResourceFile(file) }), "整套系统提示词已导入并生效。"); }
				catch (error) { setState(function (current) { return Object.assign({}, current, { busy: false, error: String(error && error.message || error) }); }); }
			}
			async function exportFile() {
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "", notice: "" }); });
				try {
					const result = await rpc("exportSystemPrompts");
					const blob = new Blob([result.text], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a");
					link.href = url; link.download = result.name || "dsh-tavern-system-prompts.json"; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
					setState(function (current) { return Object.assign({}, current, { busy: false, notice: "已导出当前整套系统提示词。" }); });
				} catch (error) { setState(function (current) { return Object.assign({}, current, { busy: false, error: String(error && error.message || error) }); }); }
			}
			function row(item) {
				const value = draft(item); const dirty = value !== String(item.text || "");
				return h("details", { key: item.name, className: "dsh-tavern-prompt-row role-system" },
					h("summary", { className: "dsh-tavern-prompt-head" }, h("span", { className: "dsh-tavern-prompt-role" }, "SYSTEM"), h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, item.label), h("span", null, item.description)), h("span", { className: "dsh-tavern-prompt-state " + (item.customized ? "on" : "off") }, item.customized ? "已修改" : "默认")),
					h("div", { className: "dsh-tavern-prompt-editor" },
						h("label", { className: "dsh-tavern-prompt-editor-field full" }, "内容", h("textarea", { value: value, disabled: state.busy, onChange: function (event) { edit(item.name, event.target.value); }, "aria-label": item.label })),
						h("div", { className: "dsh-tavern-prompt-editor-actions" }, h("button", { className: "dsh-tavern-btn", disabled: state.busy || (!item.customized && !dirty), onClick: function () { void restore(item); } }, "恢复默认"), h("button", { className: "dsh-tavern-btn", disabled: state.busy || !dirty || value.trim() === "", onClick: function () { void save(item); } }, "保存此项"))));
			}
			return h("div", { className: "dsh-tavern-presets" },
				h("div", { className: "dsh-tavern-status-head dsh-tavern-system-prompt-head" },
					h("div", { className: "dsh-tavern-status-title" }, "系统提示词"),
					h("div", { className: "dsh-tavern-question-sub" }, "DSH Tavern 当前使用的唯一一套内置提示词"),
					h("div", { className: "dsh-tavern-system-prompt-top-actions" }, h("button", { className: "dsh-tavern-btn", disabled: state.busy, onClick: function () { importInput.current && importInput.current.click(); } }, "导入 JSON"), h("button", { className: "dsh-tavern-btn", disabled: state.busy, onClick: function () { void exportFile(); } }, "导出 JSON"), h("input", { ref: importInput, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; void importFile(file); event.target.value = ""; } }))),
				h("div", { className: "dsh-tavern-preset-detail dsh-tavern-system-prompt-body" },
					h("div", { className: "dsh-tavern-system-prompt-warning", role: "note" }, "警告：修改系统提示词可能导致正文生成异常、人物卡指令冲突、后台任务失败或输出格式失效。不了解其作用时请保持默认；出现问题时请恢复默认。"),
					h("div", { className: "dsh-tavern-preset-detail-actions" }, h("button", { className: "dsh-tavern-btn danger", disabled: state.busy || !state.prompts.some(function (item) { return item.customized; }), onClick: function () { void restoreAll(); } }, "全部恢复默认")),
					state.notice ? h("div", { className: "dsh-tavern-system-prompt-status", role: "status" }, state.notice) : null,
					state.error ? h("div", { className: "dsh-tavern-dock-error", role: "alert" }, state.error) : null,
					state.loading ? h("div", { className: "dsh-tavern-status-empty" }, "正在读取系统提示词…") : state.prompts.map(row)));
		}

		function createResourcesLibraryFeatureModule() {
			function TavernResourcesTab(props) {
				const [resources, setResources] = React.useState({ resources: [] });
				const [cards, setCards] = React.useState([]);
				const [selectedCardPaths, setSelectedCardPaths] = React.useState({});
				const [view, setView] = React.useState(null);
				const [openedScript, setOpenedScript] = React.useState(null);
				const [error, setError] = usePersistentError("剧本库");
			const [busy, setBusy] = React.useState(false);
			const sourceInput = React.useRef(null);
			function refresh() {
					return Promise.all([rpc("listResources", {}, props.sessionId), rpc("getSession", { sessionId: props.sessionId }, props.sessionId)]).then(function (all) {
						setResources(all[0] || { resources: [] });
						setView(all[1] && all[1].view ? all[1].view : null);
						setCards(all[0] && all[0].cards || []);
					setError("");
				}, function (err) { setError(String(err && err.message || err)); });
			}
			async function importSourceResource(file) {
				if (!file) return;
				setBusy(true); setError("");
				try { await rpc("importSource", { payload: await parseTextResourceFile(file) }, props.sessionId); await refresh(); notifyTavernDataChanged(["scripts"], "resources"); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
				async function openScript(item) {
					setBusy(true); setError("");
					try {
						const result = await rpc("getResource", { path: item.path }, props.sessionId);
						setOpenedScript({ path: item.path, title: item.title, text: result.text || "" });
					} catch (err) { setError(String(err && err.message || err)); }
					finally { setBusy(false); }
				}
			React.useEffect(function () {
				refresh();
				function onData(event) { if (tavernDataChangeAffects(event, ["scripts", "cards", "sessions"], "resources")) refresh(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				return function () { window.removeEventListener("dsh-tavern-data-changed", onData); };
			}, [props.sessionId]);
			const h = React.createElement;
				if (view && view.mode !== "card") return h("div", { className: "dsh-tavern-empty" }, "剧本库只用于卡片工作台。");
			const mounted = view && view.workspace && Array.isArray(view.workspace.mountedResources) ? view.workspace.mountedResources : [];
			function isMounted(kind, path) {
				return mounted.some(function (item) { return item && item.kind === kind && item.path === path; });
			}
			async function renameResource(item, label) {
				const current = item.path.split("/").pop();
				const name = window.prompt("重命名文件", current);
				if (name === null || !name.trim() || name.trim() === current) return;
				setBusy(true); setError("");
				try { await rpc("renameResource", { path: item.path, name: name.trim() }, props.sessionId); await refresh(); notifyTavernDataChanged(["scripts", "cards", "sessions"], "resources"); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
				async function deleteResource(item) {
					if (!window.confirm("删除剧本“" + item.title + "”吗？\n工作版和原版都会删除。")) return;
				setBusy(true); setError("");
				try { await rpc("deleteResource", { path: item.path }, props.sessionId); await refresh(); notifyTavernDataChanged(["scripts", "cards", "sessions"], "resources"); }
				catch (err) { setError(String(err && err.message || err)); }
					finally { setBusy(false); }
				}
				async function bindScriptToCard(item) {
					const cardPath = selectedCardPaths[item.path] || "";
					if (!cardPath) return;
					setBusy(true); setError("");
					try { await rpc("bindScript", { cardPath: cardPath, path: item.path }, props.sessionId); await refresh(); notifyTavernDataChanged(["scripts", "cards"], "resources"); }
					catch (err) { setError(String(err && err.message || err)); }
					finally { setBusy(false); }
				}
				async function unbindScriptFromCard(item, boundCard) {
					if (!window.confirm("解除剧本《" + item.title + "》与人物卡“" + boundCard.name + "”的绑定吗？")) return;
					setBusy(true); setError("");
					try { await rpc("deleteScript", { cardPath: boundCard.path }, props.sessionId); await refresh(); notifyTavernDataChanged(["scripts", "cards"], "resources"); }
					catch (err) { setError(String(err && err.message || err)); }
					finally { setBusy(false); }
				}
				function row(kind, item) {
					const path = item.path;
					const label = item.title;
					const boundCard = kind === "source" && Array.isArray(item.boundCards) ? item.boundCards[0] : null;
					const availableCards = cards.filter(function (card) { return card.script == null; });
					const meta = (item.chunkCount ? item.chunkCount + " 块 · " : "") + (boundCard ? "已绑定：" + boundCard.name : "未绑定");
					const on = isMounted(kind, path);
					const name = h("button", { className: "dsh-tavern-resource-name dsh-tavern-resource-open", title: "查看工作版：" + label, onClick: function () { openScript(item); } }, label);
					const binding = boundCard
						? h("div", { className: "dsh-tavern-resource-binding" }, h("span", { className: "dsh-tavern-resource-meta" }, "专属人物卡：" + boundCard.name), h("button", { className: "dsh-tavern-resource-at", disabled: busy, onClick: function () { unbindScriptFromCard(item, boundCard); } }, "解绑"))
						: h("div", { className: "dsh-tavern-resource-binding" }, h("select", { value: selectedCardPaths[item.path] || "", disabled: busy || !availableCards.length, onChange: function (event) { const cardPath = event.target.value; setSelectedCardPaths(function (current) { return Object.assign({}, current, { [item.path]: cardPath }); }); } }, h("option", { value: "" }, availableCards.length ? "选择未绑定人物卡" : "暂无未绑定人物卡"), availableCards.map(function (card) { return h("option", { key: card.path, value: card.path }, card.name); })), h("button", { className: "dsh-tavern-resource-at", disabled: busy || !selectedCardPaths[item.path], onClick: function () { bindScriptToCard(item); } }, "绑定人物卡"));
					return h("div", { key: path, className: "dsh-tavern-resource-row" },
					name,
					meta ? h("span", { className: "dsh-tavern-resource-meta" }, meta) : null,
					h("button", { className: "dsh-tavern-resource-at", disabled: busy, title: "重命名真实文件", onClick: function () { renameResource(item, label); } }, "重命名"),
						h("button", { className: "dsh-tavern-resource-at", disabled: busy, title: "删除剧本", onClick: function () { deleteResource(item); } }, "删除"),
						h("button", { className: "dsh-tavern-resource-at" + (on ? " mounted" : ""), title: on ? "再次在对话中引用" : "在对话中引用", onClick: function () { props.appendMention(kind, path, label); } }, "在对话中引用"),
						binding
				);
			}
			function group(title, kind, items, actions) {
				return h("section", { className: "dsh-tavern-resource-group" },
					h("div", { className: "dsh-tavern-resource-group-title" }, h("span", null, title + " · " + items.length), actions || null),
					items.length ? items.map(function (item) { return row(kind, item); }) : h("div", { className: "dsh-tavern-status-empty" }, "暂无")
				);
			}
				if (openedScript) return h("div", { className: "dsh-tavern-resources" },
					h("div", { className: "dsh-tavern-status-head" }, h("button", { className: "dsh-tavern-btn", onClick: function () { setOpenedScript(null); } }, "← 返回剧本库"), h("div", { className: "dsh-tavern-status-title" }, openedScript.title)),
					error ? h("div", { className: "dsh-tavern-dock-error" }, error) : h("pre", { className: "dsh-tavern-resource-body dsh-tavern-script-preview" }, openedScript.text)
				);
				const sourceActions = h("div", { className: "dsh-tavern-resource-actions" }, h("button", { className: "dsh-tavern-resource-import", disabled: busy, onClick: function () { sourceInput.current && sourceInput.current.click(); } }, "导入剧本"), h("input", { ref: sourceInput, type: "file", accept: ".txt,.md,.json,.epub,text/plain,text/markdown,application/json,application/epub+zip", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importSourceResource(file); event.target.value = ""; } }));
				return h("div", { className: "dsh-tavern-resources" },
						h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "剧本库"), h("div", { className: "dsh-tavern-question-sub" }, "查看、修改并绑定人物卡")),
					h("div", { className: "dsh-tavern-resource-body" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null, group("剧本", "source", resources.resources || [], sourceActions))
			);
		}
		function register(input) {
			const ctx = input.ctx;
			const appendMention = input.appendMention;
			return ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:resources",
					title: "剧本库",
				order: 7,
				single: true,
				component: function (props) {
					return React.createElement(TavernResourcesTab, {
						sessionId: props.scope.sessionId,
						appendMention: function (kind, path, label) { appendMention(props.scope.sessionId, kind, path, label); },
					});
				}
			}), "dsh-tavern: Better Sidebar resources tab");
		}
		return Object.freeze({ register: register });
		}
		const resourcesLibraryFeature = createResourcesLibraryFeatureModule();

		function groupPresetEntriesByPhase(preset) {
			const result = { front: [], middle: [], back: [], unassigned: [] };
			const phaseByEntryKey = new Map();
			const draft = preset && preset.dshPreset && typeof preset.dshPreset === "object" ? preset.dshPreset : {};
			["front", "middle", "back"].forEach(function (phase) {
				(Array.isArray(draft[phase]) ? draft[phase] : []).forEach(function (entry) {
					const key = String(entry && (entry.id || entry.entryKey) || "");
					if (key) phaseByEntryKey.set(key, phase);
				});
			});
			(Array.isArray(preset && preset.entries) ? preset.entries : []).forEach(function (entry) {
				const phase = phaseByEntryKey.get(String(entry && entry.entryKey || ""));
				result[phase || "unassigned"].push(entry);
			});
			return result;
		}


			function createExternalPresetAndBypassPlanFeatureModule() {
			function usePresetCatalog(sessionId, errorSink) {
				const [catalog, setCatalog] = React.useState({ presets: [], activePresetPath: "", activePresetTitle: "", sessionMode: "" });
				function refresh() {
					return Promise.all([rpc("listPresets", {}, sessionId), rpc("getSession", { sessionId: sessionId }, sessionId)]).then(function (all) {
						const result = all[0] || {}; const view = all[1] && all[1].view;
						const next = { presets: result.presets || [], activePresetPath: result.activePresetPath || "", activePresetTitle: result.activePresetTitle || "", sessionMode: view && view.mode || "" };
						setCatalog(next); if (errorSink) errorSink(""); return next;
					}, function (err) { if (errorSink) errorSink(String(err && err.message || err)); return null; });
				}
				React.useEffect(function () {
					refresh(); function onData(event) { if (tavernDataChangeAffects(event, ["presets", "sessions"], "presets")) refresh(); }
					window.addEventListener("dsh-tavern-data-changed", onData);
					return function () { window.removeEventListener("dsh-tavern-data-changed", onData); };
				}, [sessionId]);
				return [catalog, refresh];
			}

			function ExternalPresetLibraryTab(props) {
				const [error, setError] = usePersistentError("预设库");
				const [catalog, refresh] = usePresetCatalog(props.scope.sessionId, setError);
				const [detailPath, setDetailPath] = React.useState("");
				const [preset, setPreset] = React.useState(null);
				const [entryDrafts, setEntryDrafts] = React.useState({});
				const [regexDrafts, setRegexDrafts] = React.useState({});
				const [busy, setBusy] = React.useState(false);
				const importInput = React.useRef(null);
				const h = React.createElement;
				async function importFile(file) {
					if (!file) return; setBusy(true); setError("");
					try { await rpc("importPreset", { payload: await parseTextResourceFile(file) }, props.scope.sessionId); await refresh(); notifyTavernDataChanged(["presets"], "presets"); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function selectPreset(path) {
					setBusy(true); setError("");
					try { await rpc("selectPreset", { path: path }, props.scope.sessionId); await refresh(); notifyTavernDataChanged(["presets", "sessions"], "presets"); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function loadPreset(path) {
					setBusy(true); setError("");
					try { const result = await rpc("getPreset", { path: path }, props.scope.sessionId); setPreset(result.preset || null); setEntryDrafts({}); setRegexDrafts({}); setDetailPath(path); }
					catch (err) { setError(String(err && err.message || err)); }
					finally { setBusy(false); }
				}
				function entryValue(entry) { return { name: String(entry.name || ""), role: String(entry.role || "system"), content: String(entry.content || ""), enabled: entry.enabled === true }; }
				function regexValue(script) { return { name: String(script.name || ""), findRegex: String(script.findRegex || ""), replaceString: String(script.replaceString || ""), enabled: script.enabled === true }; }
				function entryDraft(entry) { return Object.assign({}, entryValue(entry), entryDrafts[entry.entryKey] || {}); }
				function regexDraft(script) { return Object.assign({}, regexValue(script), regexDrafts[script.regexKey] || {}); }
				function updateEntryDraft(entry, patch) { setEntryDrafts(function (current) { return Object.assign({}, current, { [entry.entryKey]: Object.assign({}, entryValue(entry), current[entry.entryKey] || {}, patch) }); }); }
				function updateRegexDraft(script, patch) { setRegexDrafts(function (current) { return Object.assign({}, current, { [script.regexKey]: Object.assign({}, regexValue(script), current[script.regexKey] || {}, patch) }); }); }
				async function savePresetEntry(entry) {
					if (!preset) return; setBusy(true); setError("");
					const draft = entryDraft(entry);
					try { await rpc("updatePresetEntry", { path: preset.path, entryKey: entry.entryKey, patch: { name: draft.name, role: draft.role, content: draft.content, enabled: draft.enabled } }, props.scope.sessionId); const result = await rpc("getPreset", { path: preset.path }, props.scope.sessionId); setPreset(result.preset || null); setEntryDrafts(function (current) { const next = Object.assign({}, current); delete next[entry.entryKey]; return next; }); await refresh(); notifyTavernDataChanged(["presets", "sessions"], "presets"); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function savePresetRegex(script) {
					if (!preset) return; setBusy(true); setError("");
					const draft = regexDraft(script);
					try { const result = await rpc("updatePresetRegex", { path: preset.path, regexKey: script.regexKey, patch: { name: draft.name, findRegex: draft.findRegex, replaceString: draft.replaceString, enabled: draft.enabled } }, props.scope.sessionId); setPreset(result.preset || null); setRegexDrafts(function (current) { const next = Object.assign({}, current); delete next[script.regexKey]; return next; }); await refresh(); notifyTavernDataChanged(["presets", "sessions"], "presets"); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function togglePresetEntry(entry) {
					if (!preset || entry.marker === true || !entry.edit || !Array.isArray(entry.edit.enabledPaths) || entry.edit.enabledPaths.length === 0) return;
					const enabled = entry.enabled !== true; setBusy(true); setError("");
					try { await rpc("updatePresetEntry", { path: preset.path, entryKey: entry.entryKey, patch: { enabled: enabled } }, props.scope.sessionId); const result = await rpc("getPreset", { path: preset.path }, props.scope.sessionId); setPreset(result.preset || null); setEntryDrafts(function (current) { if (!Object.prototype.hasOwnProperty.call(current, entry.entryKey)) return current; return Object.assign({}, current, { [entry.entryKey]: Object.assign({}, current[entry.entryKey], { enabled: enabled }) }); }); await refresh(); notifyTavernDataChanged(["presets", "sessions"], "presets"); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function togglePresetRegex(script) {
					if (!preset) return; const enabled = script.enabled !== true; setBusy(true); setError("");
					try { const result = await rpc("updatePresetRegex", { path: preset.path, regexKey: script.regexKey, patch: { enabled: enabled } }, props.scope.sessionId); setPreset(result.preset || null); setRegexDrafts(function (current) { if (!Object.prototype.hasOwnProperty.call(current, script.regexKey)) return current; return Object.assign({}, current, { [script.regexKey]: Object.assign({}, current[script.regexKey], { enabled: enabled }) }); }); await refresh(); notifyTavernDataChanged(["presets", "sessions"], "presets"); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function rename(item) {
					const current = item.path.split("/").pop(); const name = window.prompt("重命名外部预设", current);
					if (name === null || !name.trim() || name.trim() === current) return;
					setBusy(true); setError("");
					try {
						const result = await rpc("renameResource", { path: item.path, name: name.trim() }, props.scope.sessionId);
						if (item.path === catalog.activePresetPath) await rpc("selectPreset", { path: result.resource.path }, props.scope.sessionId);
						await refresh(); if (detailPath === item.path) await loadPreset(result.resource.path); notifyTavernDataChanged(["presets", "sessions"], "presets");
					}
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function exportFile(item) {
					setBusy(true); setError("");
					try {
						const result = await rpc("exportPreset", { path: item.path }, props.scope.sessionId);
						const blob = new Blob([result.text], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a");
						link.href = url; link.download = result.name || "preset.json"; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
					} catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function remove(item) {
					if (!window.confirm("删除外部预设“" + item.title + "”吗？\n工作版和原版都会删除；已有对话保留。")) return;
					setBusy(true); setError("");
					try {
						if (item.path === catalog.activePresetPath) await rpc("selectPreset", { path: "" }, props.scope.sessionId);
						await rpc("deletePreset", { path: item.path }, props.scope.sessionId); setDetailPath(""); setPreset(null); await refresh(); notifyTavernDataChanged(["presets", "sessions"], "presets");
					}
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				const inCardMode = catalog.sessionMode === "card";
				function entryRow(entry) {
					const draft = entryDraft(entry); const editable = entry.marker !== true && entry.edit && entry.edit.promptPath; const toggleable = entry.marker !== true && entry.edit && Array.isArray(entry.edit.enabledPaths) && entry.edit.enabledPaths.length > 0; const dirty = JSON.stringify(draft) !== JSON.stringify(entryValue(entry));
					const state = toggleable ? h("button", { type: "button", role: "switch", className: "dsh-tavern-prompt-state is-toggle " + (entry.enabled ? "on" : "off"), disabled: busy, title: entry.enabled ? "点击停用此条目" : "点击启用此条目", "aria-label": entry.name + "启用状态", "aria-checked": entry.enabled === true, onClick: function (event) { event.preventDefault(); event.stopPropagation(); togglePresetEntry(entry); } }) : h("span", { className: "dsh-tavern-prompt-state " + (entry.enabled ? "on" : "off"), title: "系统占位状态只读" }, entry.enabled ? "启用" : "停用");
					return h("details", { key: entry.entryKey, className: "dsh-tavern-prompt-row role-" + String(entry.role || "system") },
						h("summary", { className: "dsh-tavern-prompt-head dsh-tavern-preset-entry-head" }, h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, entry.name), h("span", null, String(entry.content || "").replace(/\s+/g, " ").trim() || (entry.marker ? "系统占位" : "空条目"))), state),
						editable ? h("div", { className: "dsh-tavern-prompt-editor" },
							h("label", { className: "dsh-tavern-prompt-editor-field" }, "名称", h("input", { type: "text", value: draft.name, disabled: busy, onChange: function (event) { updateEntryDraft(entry, { name: event.target.value }); } })),
							h("label", { className: "dsh-tavern-prompt-editor-field" }, "角色", h("select", { value: draft.role, disabled: busy, onChange: function (event) { updateEntryDraft(entry, { role: event.target.value }); } }, h("option", { value: "system" }, "system"), h("option", { value: "user" }, "user"), h("option", { value: "assistant" }, "assistant"))),
							h("label", { className: "dsh-tavern-prompt-editor-field full" }, "内容", h("textarea", { value: draft.content, disabled: busy, onChange: function (event) { updateEntryDraft(entry, { content: event.target.value }); } })),
							h("label", { className: "dsh-tavern-prompt-editor-toggle" }, h("input", { type: "checkbox", checked: draft.enabled, disabled: busy, onChange: function (event) { updateEntryDraft(entry, { enabled: event.target.checked }); } }), "启用此条目"),
							h("div", { className: "dsh-tavern-prompt-editor-actions" }, h("button", { className: "dsh-tavern-btn", disabled: busy || !dirty, onClick: function () { savePresetEntry(entry); } }, "保存此条目")))
						: h("div", null, h("div", { className: "dsh-tavern-extension-note" }, "这是由兼容运行时填充的系统占位，不能在这里编辑。"), h("pre", { className: "dsh-tavern-prompt-content" }, entry.content || "[由运行时提供的占位]")));
				}
				function regexRow(script) {
					const draft = regexDraft(script); const dirty = JSON.stringify(draft) !== JSON.stringify(regexValue(script));
					const state = h("button", { type: "button", role: "switch", className: "dsh-tavern-prompt-state is-toggle " + (script.enabled ? "on" : "off"), disabled: busy, title: script.enabled ? "点击停用此正则" : "点击启用此正则", "aria-label": script.name + "启用状态", "aria-checked": script.enabled === true, onClick: function (event) { event.preventDefault(); event.stopPropagation(); togglePresetRegex(script); } });
					return h("details", { key: script.regexKey, className: "dsh-tavern-prompt-row role-regex" },
						h("summary", { className: "dsh-tavern-prompt-head" }, h("span", { className: "dsh-tavern-prompt-role" }, "REGEX"), h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, script.name), h("span", null, script.findRegex || "空查找规则")), state),
						h("div", { className: "dsh-tavern-prompt-editor" },
							h("label", { className: "dsh-tavern-prompt-editor-field full" }, "名称", h("input", { type: "text", value: draft.name, disabled: busy, onChange: function (event) { updateRegexDraft(script, { name: event.target.value }); } })),
							h("label", { className: "dsh-tavern-prompt-editor-field full" }, "查找规则", h("textarea", { value: draft.findRegex, disabled: busy, onChange: function (event) { updateRegexDraft(script, { findRegex: event.target.value }); } })),
							h("label", { className: "dsh-tavern-prompt-editor-field full" }, "替换内容", h("textarea", { value: draft.replaceString, disabled: busy, onChange: function (event) { updateRegexDraft(script, { replaceString: event.target.value }); } })),
							h("label", { className: "dsh-tavern-prompt-editor-toggle" }, h("input", { type: "checkbox", checked: draft.enabled, disabled: busy, onChange: function (event) { updateRegexDraft(script, { enabled: event.target.checked }); } }), "启用此正则"),
							h("div", { className: "dsh-tavern-prompt-editor-actions" }, h("button", { className: "dsh-tavern-btn", disabled: busy || !dirty, onClick: function () { savePresetRegex(script); } }, "保存此正则"))));
				}
				function phaseSection(phase, title, description, entries) {
					return h("section", { className: "dsh-tavern-preset-phase phase-" + phase, "aria-label": title },
						h("div", { className: "dsh-tavern-preset-phase-head" }, h("div", null, h("div", { className: "dsh-tavern-preset-phase-title" }, title), h("div", { className: "dsh-tavern-preset-phase-description" }, description)), h("span", { className: "dsh-tavern-preset-phase-count" }, entries.length + " 项")),
						entries.length ? entries.map(entryRow) : h("div", { className: "dsh-tavern-preset-phase-empty" }, "此段暂无提示词"));
				}
				if (preset && preset.path === detailPath) {
					const entryGroups = groupPresetEntriesByPhase(preset);
					return h("div", { className: "dsh-tavern-presets" },
					h("div", { className: "dsh-tavern-status-head" }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { setDetailPath(""); setPreset(null); } }, "← 返回预设库"), h("div", { className: "dsh-tavern-status-title" }, preset.title)),
					h("div", { className: "dsh-tavern-preset-detail" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null,
						h("div", { className: "dsh-tavern-preset-summary" }, h("b", null, "编辑前／中／后三段预设"), h("p", null, "三段代表提示词进入前台请求的真实位置；点击条目展开编辑，保存后下一轮游玩直接生效。"), h("p", null, "预设用于游玩正文；从 SillyTavern 导入的预设，效果可能与原酒馆不同。"), h("p", null, "卡片模式中的引用只供 Agent 阅读和编辑，后台 Agent 也不会运行预设。")),
						h("div", { className: "dsh-tavern-preset-detail-actions" }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { exportFile(preset); } }, "导出"), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { rename(preset); } }, "重命名"), h("button", { className: "dsh-tavern-btn danger", disabled: busy, onClick: function () { remove(preset); } }, "删除")),
						h("div", { className: "dsh-tavern-preset-section-title" }, "提示词三段 · " + (preset.entries || []).length + " 个源条目"),
						phaseSection("front", "前段", "位于系统上下文和历史之前；适合稳定身份、世界前提与总体规则。", entryGroups.front),
						phaseSection("middle", "中段", "位于历史之后、本轮输入之前；适合深度注入和临近当前回合的提醒。", entryGroups.middle),
						phaseSection("back", "后段", "并入本轮输入末尾；距离本轮任务最近，适合最终写作约束与输出格式。", entryGroups.back),
						entryGroups.unassigned.length ? h("details", { className: "dsh-tavern-preset-unassigned" }, h("summary", null, "未进入三段 · " + entryGroups.unassigned.length + " 项"), h("p", null, "这些是由宿主提供的材料占位，或未被 prompt_order 编排的条目，不会作为三段预设文本注入。"), entryGroups.unassigned.map(entryRow)) : null,
						h("div", { className: "dsh-tavern-preset-section-title" }, "正则脚本 · " + (preset.extractableRegexScripts || []).length), (preset.extractableRegexScripts || []).map(regexRow)));
				}
				return h("div", { className: "dsh-tavern-presets" },
					h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "预设库"), h("div", { className: "dsh-tavern-question-sub" }, "管理外部预设；日常调整优先改卡或使用 Guide"), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { importInput.current && importInput.current.click(); } }, "导入外部预设"), h("input", { ref: importInput, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importFile(file); event.target.value = ""; } })),
					h("div", { className: "dsh-tavern-preset-list" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null,
						h("label", { className: "dsh-tavern-preset-selector" }, h("span", null, "当前使用的预设"), h("select", { value: catalog.activePresetPath, disabled: busy, onChange: function (event) { selectPreset(event.target.value); } }, h("option", { value: "" }, "不使用外部预设（默认）"), catalog.presets.filter(function (item) { return item.valid === true && item.recognized === true; }).map(function (item) { return h("option", { key: item.path, value: item.path }, item.title); }))),
						h("div", { className: "dsh-tavern-preset-summary dsh-tavern-external-preset-notice" },
						h("strong", null, catalog.activePresetPath ? "当前预设：" + catalog.activePresetTitle : "当前使用内置设置"),
						h("p", { className: "dsh-tavern-preset-warning" }, h("strong", null, "使用建议："), "建议保留内置预设。要调整文风、叙事方式或写作规则，优先在卡片模式中写入人物卡，或在游玩中通过 Guide 注入要求。外部预设会参与前台请求并可能改变系统行为，仅在明确了解其内容和影响时使用。"),
						h("p", null, "支持导入 SillyTavern 预设；在游玩中按 DSH Tavern 的方式应用，效果可能与原酒馆不同。"),
						h("p", null, "修改预设后，下一轮游玩请求直接生效；卡片模式中的引用仅供 Agent 阅读和编辑，后台 Agent 不运行预设。")),
					catalog.presets.length ? catalog.presets.map(function (item) {
						return h("div", { key: item.path, className: "dsh-tavern-preset-row" },
								h("div", { className: "dsh-tavern-preset-row-head" }, h("button", { className: "dsh-tavern-preset-row-main", disabled: busy, title: "查看并编辑预设", onClick: function () { loadPreset(item.path); } }, h("b", null, item.title), h("span", null, "前 " + Number(item.phaseCounts && item.phaseCounts.front || 0) + " · 中 " + Number(item.phaseCounts && item.phaseCounts.middle || 0) + " · 后 " + Number(item.phaseCounts && item.phaseCounts.back || 0) + " · 正则 " + item.regexCount))),
							inCardMode ? h("div", { className: "dsh-tavern-preset-row-actions" }, h("button", { className: "dsh-tavern-resource-at", disabled: busy, onClick: function () { props.appendMention("preset", item.path, item.title); } }, "在对话中引用")) : null
						);
					}) : h("div", { className: "dsh-tavern-status-empty" }, "还没有外部预设。请先导入。")));
			}

			function register(input) {
				const ctx = input.ctx;
				const appendMention = input.appendMention;
				return ctx.effect(function () {
					const dispose = ctx.betterSidebar.registerTab({ id: "dsh-tavern:presets", title: "预设库", order: 4, single: true, component: function (props) { return React.createElement(ExternalPresetLibraryTab, { scope: props.scope, appendMention: function (kind, path, label) { appendMention(props.scope.sessionId, kind, path, label); } }); } });
					return function () { if (typeof dispose === "function") dispose(); };
				}, "dsh-tavern: preset library");
			}
			return Object.freeze({ register: register });
			}
			const presetLibraryFeature = createExternalPresetAndBypassPlanFeatureModule();

		function groupWorldBookEditorEntries(entries) {
			const groups = { constant: [], dynamic: [] };
			for (const [index, entry] of (entries || []).entries()) {
				groups[entry && entry.constant === true ? "constant" : "dynamic"].push({ entry: entry, index: index });
			}
			return groups;
		}

		function createWorldBookLibraryFeatureModule() {
		function WorldBookEditor(props) {
			const initial = props.record && props.record.view ? props.record.view : { displayName: "", description: "", entries: [], diagnostics: [] };
			const [draft, setDraft] = React.useState(function () { return JSON.parse(JSON.stringify(initial)); });
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = usePersistentError("世界书编辑");
			React.useEffect(function () { setDraft(JSON.parse(JSON.stringify(initial))); }, [props.record]);
			const h = React.createElement;
			function updateEntry(index, patch) {
				const entries = (draft.entries || []).slice();
				entries[index] = Object.assign({}, entries[index], patch);
				setDraft(Object.assign({}, draft, { entries: entries }));
			}
			function addEntry() {
				const entries = (draft.entries || []).concat([{
					ref: "new:" + Date.now() + ":" + Math.random(), comment: "新条目", title: "新条目", content: "", enabled: true,
					primaryKeys: [], secondaryKeys: [], constant: false, selective: false, selectiveLogic: 0, order: 100,
					position: initial.format === "sillytavern-worldbook" ? 0 : "after_char", depth: 4, role: 0,
					probabilityEnabled: true, probability: 100, caseSensitive: false, matchWholeWords: false,
				}]);
				setDraft(Object.assign({}, draft, { entries: entries }));
			}
			function removeEntry(index) {
				const entry = (draft.entries || [])[index];
				const title = entry && (entry.comment || entry.title) || "未命名条目";
				if (!window.confirm("删除世界书条目“" + title + "”？\n保存世界书后才会正式删除。")) return;
				setDraft(Object.assign({}, draft, { entries: (draft.entries || []).filter(function (_entry, itemIndex) { return itemIndex !== index; }) }));
			}
			function entryPatch(entry) {
				return {
					comment: entry.comment, content: entry.content, enabled: entry.enabled, primaryKeys: entry.primaryKeys,
					secondaryKeys: entry.secondaryKeys, constant: entry.constant, selective: entry.selective,
					selectiveLogic: entry.selectiveLogic, vectorized: entry.vectorized, order: entry.order,
					displayIndex: entry.displayIndex, position: entry.position, depth: entry.depth, role: entry.role,
					probabilityEnabled: entry.probabilityEnabled, probability: entry.probability, scanDepth: entry.scanDepth,
					caseSensitive: entry.caseSensitive, matchWholeWords: entry.matchWholeWords,
					excludeRecursion: entry.excludeRecursion, preventRecursion: entry.preventRecursion, group: entry.group,
				};
			}
			async function save() {
				setBusy(true); setError("");
				try {
					const before = new Map((initial.entries || []).map(function (entry) { return [entry.ref, entry]; }));
					const after = new Map((draft.entries || []).filter(function (entry) { return !String(entry.ref).startsWith("new:"); }).map(function (entry) { return [entry.ref, entry]; }));
					const operations = [];
					before.forEach(function (_entry, ref) { if (!after.has(ref)) operations.push({ op: "delete", ref: ref }); });
					(draft.entries || []).forEach(function (entry) {
						const patch = entryPatch(entry);
						if (String(entry.ref).startsWith("new:")) operations.push({ op: "add", entry: patch });
						else if (JSON.stringify(patch) !== JSON.stringify(entryPatch(before.get(entry.ref)))) operations.push({ op: "update", ref: entry.ref, patch: patch });
					});
					const update = { operations: operations };
					if (draft.displayName !== initial.displayName) update.name = draft.displayName;
					if (draft.description !== initial.description) update.description = draft.description;
					const result = await rpc("updateWorldBook", { source: props.record.source, update: update }, props.sessionId);
					props.onSaved(result); notifyTavernDataChanged(["worldbooks", "cards"], "worldbooks");
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function textList(value) { return (value || []).join(", "); }
			function parseList(value) { return String(value || "").split(/[,，\n]/).map(function (item) { return item.trim(); }).filter(Boolean); }
			function numeric(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
			function entryRow(entry, index) {
				return h("details", { key: entry.ref, className: "dsh-tavern-worldbook-entry", defaultOpen: String(entry.ref).startsWith("new:") },
					h("summary", { className: "dsh-tavern-worldbook-entry-head" }, entry.comment || entry.title || "未命名条目"),
					h("div", { className: "dsh-tavern-worldbook-entry-body" },
						h("div", { className: "dsh-tavern-worldbook-entry-actions" },
							h("button", { className: "dsh-tavern-worldbook-kind", onClick: function () { updateEntry(index, { constant: !entry.constant }); } }, entry.constant ? "常驻" : "非常驻")
						),
						h("div", { className: "dsh-tavern-card-field" }, h("label", null, "标题 / 备注"), h("input", { value: entry.comment || "", onChange: function (event) { updateEntry(index, { comment: event.target.value, title: event.target.value }); } })),
						entry.constant ? null : h("div", { className: "dsh-tavern-card-field" }, h("label", null, "主触发词"), h("input", { value: textList(entry.primaryKeys), placeholder: "逗号分隔；支持 /pattern/flags", onChange: function (event) { updateEntry(index, { primaryKeys: parseList(event.target.value) }); } })),
						h("div", { className: "dsh-tavern-card-field" }, h("label", null, "内容"), h("textarea", { className: "large", value: entry.content || "", onChange: function (event) { updateEntry(index, { content: event.target.value }); } })),
						h("details", null, h("summary", null, "兼容字段"),
							entry.constant ? null : h("div", { className: "dsh-tavern-card-field" }, h("label", null, "二级触发词"), h("input", { value: textList(entry.secondaryKeys), placeholder: "逗号分隔", onChange: function (event) { updateEntry(index, { secondaryKeys: parseList(event.target.value) }); } })),
							h("div", { className: "dsh-tavern-worldbook-checks" },
							h("label", null, h("input", { type: "checkbox", checked: entry.enabled !== false, onChange: function (event) { updateEntry(index, { enabled: event.target.checked }); } }), "启用"),
							h("label", null, h("input", { type: "checkbox", checked: entry.selective === true, onChange: function (event) { updateEntry(index, { selective: event.target.checked }); } }), "使用二级条件"),
							h("label", null, h("input", { type: "checkbox", checked: entry.caseSensitive === true, onChange: function (event) { updateEntry(index, { caseSensitive: event.target.checked }); } }), "区分大小写"),
							h("label", null, h("input", { type: "checkbox", checked: entry.matchWholeWords === true, onChange: function (event) { updateEntry(index, { matchWholeWords: event.target.checked }); } }), "整词匹配")
						),
						h("div", { className: "dsh-tavern-worldbook-grid" },
							h("label", null, "排序", h("input", { type: "number", value: entry.order, onChange: function (event) { updateEntry(index, { order: numeric(event.target.value, 100) }); } })),
							h("label", null, "展示顺序", h("input", { type: "number", value: entry.displayIndex, onChange: function (event) { updateEntry(index, { displayIndex: numeric(event.target.value, index) }); } })),
							h("label", null, "注入位置", h("input", { value: entry.position, onChange: function (event) { updateEntry(index, { position: initial.format === "sillytavern-worldbook" ? numeric(event.target.value, 0) : event.target.value }); } })),
							h("label", null, "深度", h("input", { type: "number", value: entry.depth, onChange: function (event) { updateEntry(index, { depth: numeric(event.target.value, 4) }); } })),
							h("label", null, "概率 %", h("input", { type: "number", min: 0, max: 100, value: entry.probability, onChange: function (event) { updateEntry(index, { probability: numeric(event.target.value, 100) }); } })),
							h("label", null, "包含组", h("input", { value: entry.group || "", onChange: function (event) { updateEntry(index, { group: event.target.value }); } }))
						),
						h("div", { className: "dsh-tavern-worldbook-checks" },
							h("label", null, h("input", { type: "checkbox", checked: entry.probabilityEnabled !== false, onChange: function (event) { updateEntry(index, { probabilityEnabled: event.target.checked }); } }), "启用概率"),
							h("label", null, h("input", { type: "checkbox", checked: entry.vectorized === true, onChange: function (event) { updateEntry(index, { vectorized: event.target.checked }); } }), "向量候选"),
							h("label", null, h("input", { type: "checkbox", checked: entry.excludeRecursion === true, onChange: function (event) { updateEntry(index, { excludeRecursion: event.target.checked }); } }), "不被递归触发"),
							h("label", null, h("input", { type: "checkbox", checked: entry.preventRecursion === true, onChange: function (event) { updateEntry(index, { preventRecursion: event.target.checked }); } }), "不触发递归")
						)
						),
						h("div", { className: "dsh-tavern-worldbook-danger-zone" },
							h("button", { className: "dsh-tavern-worldbook-del", onClick: function () { removeEntry(index); } }, "删除条目")
						)
					)
				);
			}
			function entryGroup(label, description, items) {
				return h("section", { className: "dsh-tavern-worldbook-group" },
					h("div", { className: "dsh-tavern-worldbook-group-head" }, h("b", null, label + " · " + items.length), h("span", null, description)),
					items.length ? items.map(function (item) { return entryRow(item.entry, item.index); }) : h("div", { className: "dsh-tavern-worldbook-empty" }, "暂无" + label)
				);
			}
			const entryGroups = groupWorldBookEditorEntries(draft.entries);
			return h("div", { className: "dsh-tavern-library" },
				h("div", { className: "dsh-tavern-status-head" }, h("button", { className: "dsh-tavern-btn", onClick: props.onBack }, "← 返回世界书库"), h("div", { className: "dsh-tavern-status-title" }, draft.displayName || "未命名世界书"), h("div", { className: "dsh-tavern-question-sub" }, props.record.source.kind === "card" ? "人物卡内置 · " + props.record.source.cardName : "独立世界书"), props.actions),
				h("div", { className: "dsh-tavern-worldbook-editor" },
					props.bindingPanel,
					h("div", { className: "dsh-tavern-card-field" }, h("label", null, "世界书名称"), h("input", { value: draft.displayName || "", onChange: function (event) { setDraft(Object.assign({}, draft, { displayName: event.target.value })); } })),
					h("div", { className: "dsh-tavern-card-field" }, h("label", null, "说明"), h("textarea", { value: draft.description || "", onChange: function (event) { setDraft(Object.assign({}, draft, { description: event.target.value })); } })),
					h("div", { className: "dsh-tavern-worldbook-summary" }, draft.entries.length + " 个条目 · " + draft.entries.filter(function (entry) { return entry.enabled !== false; }).length + " 个启用。未知字段与 extensions 会原样保留；尚未实现的酒馆运行语义不会在这里伪装成已支持。"),
					(initial.diagnostics || []).map(function (item, index) { return h("div", { key: index, className: "dsh-tavern-dock-error" }, item.message); }),
					h("div", { className: "dsh-tavern-worldbook-head" }, h("span", { className: "dsh-tavern-worldbook-title" }, "条目"), h("button", { className: "dsh-tavern-worldbook-add", onClick: addEntry }, "＋ 新增条目")),
					entryGroup("常驻条目", "始终进入上下文", entryGroups.constant),
					entryGroup("非常驻条目", "按触发词匹配", entryGroups.dynamic),
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					h("div", { className: "dsh-tavern-worldbook-editor-actions" }, h("button", { className: "dsh-card-primary", disabled: busy, onClick: save }, busy ? "保存中…" : "保存世界书"))
				)
			);
		}

		function WorldBookLibraryTab(props) {
			const [catalog, setCatalog] = React.useState(null);
			const [catalogWarning, setCatalogWarning] = React.useState("");
			const [record, setRecord] = React.useState(null);
			const [associations, setAssociations] = React.useState(null);
			const [selectedCardPath, setSelectedCardPath] = React.useState("");
			const [loading, setLoading] = React.useState(true);
			const [recordLoading, setRecordLoading] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [bindingBusy, setBindingBusy] = React.useState(false);
			const [error, setError] = usePersistentError("世界书库");
			const importInput = React.useRef(null);
			const refreshModule = React.useRef(null);
			const requestedSource = props.tab && props.tab.meta && props.tab.meta.worldBookSource ? props.tab.meta.worldBookSource : null;
			const sessionMode = useTavernSessionMode(props.scope.sessionId);
			const h = React.createElement;
			if (!refreshModule.current) refreshModule.current = createWorldBookLibraryRefreshModule({
				load: function () { return rpcWithTimeout("listWorldBooks", {}, props.scope.sessionId); },
				onValue: function (result) { setCatalog(result || { standalone: [], embedded: [] }); setCatalogWarning(worldBookCatalogDiagnostic(result)); },
				onError: function (err) { setError(String(err && err.message || err)); },
				onBusyChange: setLoading
			});
			function refresh() {
				setError("");
				refreshModule.current.request();
				return refreshModule.current.whenIdle();
			}
			function load(source) {
				if (!source) { setRecord(null); setAssociations(null); setSelectedCardPath(""); return Promise.resolve(); }
				setRecordLoading(true); setError("");
				return Promise.all([
					rpcWithTimeout("getWorldBook", { source: source }, props.scope.sessionId),
					rpcWithTimeout("getWorldBookAssociations", { source: source }, props.scope.sessionId)
				]).then(function (results) {
					const relations = results[1] && results[1].associations ? results[1].associations : { cards: [], boundCards: [], conflict: false };
					setRecord(results[0]); setAssociations(relations);
					setSelectedCardPath(relations.boundCards && relations.boundCards[0] ? relations.boundCards[0].path : relations.cards && relations.cards[0] ? relations.cards[0].path : "");
				}, function (err) {
					setRecord(null); setAssociations(null); setSelectedCardPath(""); setError(String(err && err.message || err));
				}).finally(function () { setRecordLoading(false); });
			}
			function reloadAssociations(source) {
				return rpcWithTimeout("getWorldBookAssociations", { source: source }, props.scope.sessionId).then(function (result) {
					const relations = result && result.associations ? result.associations : { cards: [], boundCards: [], conflict: false };
					setAssociations(relations);
					setSelectedCardPath(relations.boundCards && relations.boundCards[0] ? relations.boundCards[0].path : relations.cards && relations.cards[0] ? relations.cards[0].path : "");
					return relations;
				});
			}
			React.useEffect(function () {
				refresh();
				function onData(event) { if (tavernDataChangeAffects(event, ["worldbooks", "cards"], "worldbooks")) refresh(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				return function () {
					window.removeEventListener("dsh-tavern-data-changed", onData);
					refreshModule.current.dispose();
				};
			}, []);
			React.useEffect(function () { if (requestedSource) load(requestedSource); }, [JSON.stringify(requestedSource)]);
			function clear() { setRecord(null); setAssociations(null); setSelectedCardPath(""); props.ctx.betterSidebar.updateTab(props.tab.id, { meta: null }); }
			async function importFile(file) { if (!file) return; setBusy(true); setError(""); try { const result = await rpc("importWorldBook", { payload: await parseTextResourceFile(file) }, props.scope.sessionId); await refresh(); await load({ kind: "standalone", path: result.worldBook.path }); notifyTavernDataChanged(["worldbooks"], "worldbooks"); } catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); } }
			async function rename() { if (!record || record.source.kind !== "standalone") return; const current = record.source.path.split("/").pop(); const name = window.prompt("重命名世界书文件", current); if (name === null || !name.trim() || name.trim() === current) return; setBusy(true); try { const result = await rpc("renameResource", { path: record.source.path, name: name.trim() }, props.scope.sessionId); await refresh(); await load({ kind: "standalone", path: result.resource.path }); } catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); } }
			async function remove() { if (!record || record.source.kind !== "standalone" || !window.confirm("删除世界书“" + record.view.displayName + "”吗？\n工作版和原版都会删除。")) return; setBusy(true); try { await rpc("deleteWorldBook", { path: record.source.path }, props.scope.sessionId); clear(); await refresh(); notifyTavernDataChanged(["worldbooks", "cards"], "worldbooks"); } catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); } }
			async function exportFile() { if (!record) return; try { const result = await rpc("exportWorldBook", { source: record.source }, props.scope.sessionId); const item = result.worldBook; const blob = new Blob([JSON.stringify(item.document, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = (item.name || "世界书") + ".json"; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); } catch (err) { setError(String(err && err.message || err)); } }
			async function bindCard() {
				if (!record || !selectedCardPath || !associations) return;
				const target = (associations.cards || []).find(function (card) { return card.path === selectedCardPath; });
				if (!target) return;
				if (target.binding && target.binding.kind !== "none" && !target.bound) {
					const oldName = target.binding.name || (target.binding.kind === "embedded" ? "人物卡自带世界书" : "原世界书");
					if (!window.confirm("人物卡“" + target.name + "”当前绑定“" + oldName + "”。\n要替换为当前世界书吗？")) return;
				}
				setBindingBusy(true); setError("");
				try {
					await rpc("bindWorldBook", { cardPath: selectedCardPath, source: record.source }, props.scope.sessionId);
					await reloadAssociations(record.source); notifyTavernDataChanged(["worldbooks", "cards"], "worldbooks");
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBindingBusy(false); }
			}
			async function unbindCard(cardPath) {
				if (!record || !cardPath) return;
				setBindingBusy(true); setError("");
				try {
					await rpc("unbindWorldBook", { cardPath: cardPath }, props.scope.sessionId);
					await reloadAssociations(record.source); notifyTavernDataChanged(["worldbooks", "cards"], "worldbooks");
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBindingBusy(false); }
			}
			function bindingPanel() {
				if (!associations) return h("div", { className: "dsh-tavern-worldbook-note" }, "正在读取人物卡绑定关系…");
				const boundCards = associations.boundCards || [];
				const cards = associations.cards || [];
				return h("section", { className: "dsh-tavern-worldbook-note" },
					h("div", { className: "dsh-tavern-worldbook-title" }, "绑定人物卡"),
					associations.conflict ? h("div", { className: "dsh-tavern-dock-error" }, "该世界书已经绑定人物卡：" + boundCards.map(function (card) { return card.name; }).join("、") + "。这是旧数据冲突，请逐一解绑后重新绑定。") : null,
					boundCards.length ? boundCards.map(function (card) { return h("div", { key: card.path, className: "dsh-tavern-script-row" }, h("span", null, "当前绑定：" + (card.name || card.path)), h("button", { className: "dsh-tavern-btn", disabled: bindingBusy, onClick: function () { unbindCard(card.path); } }, bindingBusy ? "处理中…" : "解绑")); }) : h("div", { className: "dsh-tavern-question-sub" }, "尚未绑定人物卡。"),
					boundCards.length ? null : cards.length ? h("div", { className: "dsh-tavern-script-row" },
						h("select", { value: selectedCardPath, disabled: bindingBusy, onChange: function (event) { setSelectedCardPath(event.target.value); } }, cards.map(function (card) { const suffix = card.binding && card.binding.kind !== "none" ? "（将替换：" + (card.binding.name || "人物卡自带世界书") + "）" : ""; return h("option", { key: card.path, value: card.path }, (card.name || card.path) + suffix); })),
						h("button", { className: "dsh-card-primary", disabled: bindingBusy || !selectedCardPath, onClick: bindCard }, bindingBusy ? "绑定中…" : "绑定人物卡")
					) : h("div", { className: "dsh-tavern-question-sub" }, "暂无可绑定的人物卡。")
				);
			}
			if (recordLoading) return h("div", { className: "dsh-tavern-library" }, h("div", { className: "dsh-tavern-empty" }, "正在读取世界书…"));
			if (record) {
				const actions = h("div", { className: "dsh-tavern-library-head-actions" }, h("button", { className: "dsh-tavern-btn", onClick: exportFile }, "导出"), record.source.kind === "standalone" ? h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: rename }, "重命名文件") : null, record.source.kind === "standalone" ? h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: remove }, "删除") : null);
				return h(WorldBookEditor, { record: record, sessionId: props.scope.sessionId, onBack: clear, actions: actions, bindingPanel: bindingPanel(), onSaved: function (result) { setRecord(result); refresh(); } });
			}
			function row(item) { const source = item.kind === "card" ? { kind: "card", cardPath: item.cardPath } : { kind: "standalone", path: item.path }; const resourcePath = item.kind === "card" ? item.cardPath : item.path; return h("div", { key: resourcePath, className: "dsh-tavern-card-pick-wrap" }, h("button", { className: "dsh-tavern-library-card", onClick: function () { load(source); } }, h("b", null, item.name), h("span", null, item.entryCount + " 条 · " + item.enabledCount + " 条启用" + (item.diagnostics ? " · " + item.diagnostics + " 个诊断" : "")), item.cardName ? h("span", null, "来自人物卡：" + item.cardName) : null), sessionMode === "card" ? h("button", { className: "dsh-tavern-resource-at", title: "在对话中引用", onClick: function () { props.appendMention("worldbook", resourcePath, item.name); } }, "在对话中引用") : null); }
			function group(title, items) { return h("section", { className: "dsh-tavern-resource-group" }, h("div", { className: "dsh-tavern-resource-group-title" }, h("span", null, title + " · " + items.length)), items.length ? items.map(row) : h("div", { className: "dsh-tavern-status-empty" }, "暂无")); }
			return h("div", { className: "dsh-tavern-library" }, h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "世界书库"), h("div", { className: "dsh-tavern-question-sub" }, "独立世界书与人物卡内置世界书共用编辑界面"), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { importInput.current && importInput.current.click(); } }, "导入世界书"), h("input", { ref: importInput, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importFile(file); event.target.value = ""; } })), h("div", { className: "dsh-tavern-resource-body" },
				h("div", { className: "dsh-tavern-worldbook-note" }, "常驻条目随人物卡进入稳定前缀；非常驻条目按关键词确定性匹配，每轮最多注入 3 条，实际注入后冷却 10 个剧情回合。世界书不再调用后台 Agent。尚未支持的酒馆字段仍会原样保留。"),
				loading && !catalog ? h("div", { className: "dsh-tavern-empty" }, "正在读取世界书…") : null,
				error ? h("div", { className: "dsh-tavern-dock-error" }, error, h("button", { className: "dsh-tavern-btn", onClick: refresh }, "重新读取")) : null,
				catalogWarning ? h("div", { className: "dsh-tavern-dock-error" }, catalogWarning) : null,
				catalog ? group("独立世界书", catalog.standalone || []) : null,
				catalog ? group("人物卡内置世界书", catalog.embedded || []) : null));
		}
		function register(input) {
			const ctx = input.ctx;
			const appendMention = input.appendMention;
			return ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:worldbooks",
				title: "世界书库",
				order: 6,
				single: true,
				component: function (props) { return React.createElement(WorldBookLibraryTab, Object.assign({}, props, { appendMention: function (kind, path, label) { appendMention(props.scope.sessionId, kind, path, label); } })); }
			}), "dsh-tavern: Better Sidebar worldbook library tab");
		}
		return Object.freeze({ register: register });
		}
		const worldBookLibraryFeature = createWorldBookLibraryFeatureModule();

		function createCardLibraryFeatureModule() {
		function CardLibraryTab(props) {
			function TavernCardListContent(props) {
				const card = props.card;
				const image = card && card.hasImage ? React.createElement("img", {
					className: "dsh-tavern-card-thumb",
					src: "/api/dsh-tavern/card-image?path=" + encodeURIComponent(card.path),
					alt: "",
					loading: "lazy",
					onError: function (event) { event.currentTarget.hidden = true; }
				}) : null;
				return React.createElement(React.Fragment, null, image, React.createElement("span", { className: "dsh-tavern-card-list-copy" },
					React.createElement("b", null, card.name),
					React.createElement("span", null, props.detail),
					props.extra ? React.createElement("span", null, props.extra) : null
				));
			}

			const [cards, setCards] = React.useState([]);
			const [selectedPath, setSelectedPath] = React.useState("");
			const [card, setCard] = React.useState(null);
			const [loading, setLoading] = React.useState(false);
			const [query, setQuery] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = usePersistentError("人物卡库");
			const importInput = React.useRef(null);
			const cardRequest = React.useRef(0);
			const visibleRef = React.useRef(Boolean(props.visible));
			const refreshModule = React.useRef(null);
			visibleRef.current = Boolean(props.visible);
			if (!refreshModule.current) refreshModule.current = createCardLibraryRefreshModule();
			const sessionMode = useTavernSessionMode(props.scope.sessionId);
			const requestedPath = props.tab && props.tab.meta && typeof props.tab.meta.cardPath === "string" ? props.tab.meta.cardPath : "";
			function refreshCards() {
				return rpcWithTimeout("listCards", {}).then(function (result) { setCards(result.cards || []); setError(""); return result.cards || []; }, function (err) { if (visibleRef.current) setError(String(err && err.message || err)); return []; });
			}
			function loadCard(path) {
				if (!path) { setSelectedPath(""); setCard(null); setLoading(false); return Promise.resolve(); }
				return refreshModule.current.load(path, function () {
					const request = ++cardRequest.current;
					if (path !== selectedPath) setCard(null);
					setSelectedPath(path); setLoading(true); setError("");
					return rpcWithTimeout("getCard", { path: path }).then(function (result) {
						if (request !== cardRequest.current) return;
						const next = result.card || null;
						setCard(function (current) { return JSON.stringify(current) === JSON.stringify(next) ? current : next; });
					}, function (err) {
						if (request !== cardRequest.current) return;
						setError(String(err && err.message || err)); setCard(null);
					}).finally(function () { if (request === cardRequest.current) setLoading(false); });
				});
			}
			React.useEffect(function () {
				if (!props.visible) return function () { cardRequest.current += 1; refreshModule.current.dispose(); };
				refreshCards();
				function onData(event) {
					if (!tavernDataChangeAffects(event, ["cards"], "cards")) return;
					refreshCards().then(function (items) {
						if (!selectedPath) return;
						if (!items.some(function (item) { return item.path === selectedPath; })) { setSelectedPath(""); setCard(null); return; }
						loadCard(selectedPath);
					});
				}
				function onActivate() { refreshModule.current.activate(function () { if (selectedPath) loadCard(selectedPath); else refreshCards(); }); }
				function onVisibility() { if (document.visibilityState === "visible") onActivate(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				window.addEventListener("focus", onActivate);
				document.addEventListener("visibilitychange", onVisibility);
				return function () {
					window.removeEventListener("dsh-tavern-data-changed", onData);
					window.removeEventListener("focus", onActivate);
					document.removeEventListener("visibilitychange", onVisibility);
					refreshModule.current.dispose();
				};
			}, [selectedPath, props.visible]);
			React.useEffect(function () {
				if (props.visible && requestedPath && requestedPath !== selectedPath) loadCard(requestedPath);
			}, [requestedPath, selectedPath, props.visible]);
			function clearCard() {
				cardRequest.current += 1;
				setSelectedPath("");
				setCard(null);
				setLoading(false);
				props.ctx.betterSidebar.updateTab(props.tab.id, { meta: null });
			}
			async function importCardFile(file) {
				if (!file) return;
				setBusy(true); setError("");
				try { const result = await rpc("importCard", { payload: await parseCardFile(file) }); await refreshCards(); await loadCard(result.card.path); notifyTavernDataChanged(["cards"], "cards"); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function renameCard() {
				if (!card) return;
				const current = card.path.split("/").pop();
				const name = window.prompt("重命名人物卡文件", current);
				if (name === null || !name.trim() || name.trim() === current) return;
				setBusy(true); setError("");
				try { const result = await rpc("renameResource", { path: card.path, name: name.trim() }); await refreshCards(); await loadCard(result.resource.path); notifyTavernDataChanged(["cards", "sessions"], "cards"); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function deleteCardFile() {
				if (!card || !window.confirm("从人物卡库删除“" + card.name + "”吗？\n人物卡工作版和原版都会删除，已有对话会保留。")) return;
				setBusy(true); setError("");
				try { await rpc("deleteCard", { path: card.path }); setSelectedPath(""); setCard(null); await refreshCards(); notifyTavernDataChanged(["cards", "sessions"], "cards"); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function exportCardFile() {
				if (!card) return;
				try {
					const result = await rpc("exportCard", { path: card.path });
					const blob = new Blob([JSON.stringify(result.document, null, 2)], { type: "application/json" });
					const url = URL.createObjectURL(blob); const link = document.createElement("a");
					link.href = url; link.download = (card.name || "人物卡") + ".json"; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
				} catch (err) { setError(String(err && err.message || err)); }
			}
			const h = React.createElement;
			if (selectedPath) {
				if (!card) return h("div", { className: "dsh-tavern-library" }, h("div", { className: "dsh-tavern-status-head" }, h("button", { className: "dsh-tavern-btn", onClick: clearCard }, "← 返回人物卡库")), loading ? h("div", { className: "dsh-tavern-empty" }, "正在读取人物卡…") : error ? h("div", { className: "dsh-tavern-dock-error" }, error, h("button", { className: "dsh-tavern-btn", onClick: function () { loadCard(selectedPath); } }, "重新读取")) : h("div", { className: "dsh-tavern-empty" }, "人物卡读取失败", h("button", { className: "dsh-tavern-btn", onClick: function () { loadCard(selectedPath); } }, "重新读取")));
				return h(CardFieldsPanel, { view: { card: card }, library: true, busy: busy, onBack: clearCard, onAttach: sessionMode === "card" ? function () { props.appendMention(card.path, card.name); } : null, onOpenWorldBook: props.openWorldBook, onRename: renameCard, onExport: exportCardFile, onDelete: deleteCardFile, onSaved: function (saved) { setCard(Object.assign({}, saved, { path: selectedPath })); refreshCards(); } });
			}
			const needle = query.trim().toLocaleLowerCase();
			const visible = cards.filter(function (item) { return !needle || (item.name + " " + item.path).toLocaleLowerCase().includes(needle); });
			return h("div", { className: "dsh-tavern-library" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "人物卡库"), h("div", { className: "dsh-tavern-question-sub" }, cards.length + " 张人物卡"), h("div", { className: "dsh-tavern-library-head-actions" }, h(MobileCardImportButton, { inputRef: importInput, disabled: busy, onImported: async function (imported) { await refreshCards(); await loadCard(imported.path); notifyTavernDataChanged(["cards"], "cards"); } }), h("input", { ref: importInput, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importCardFile(file); event.target.value = ""; } }))),
				h("input", { className: "dsh-tavern-library-search", value: query, placeholder: "搜索名称或文件名", onChange: function (event) { setQuery(event.target.value); } }),
				h("div", { className: "dsh-tavern-resource-body" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null, visible.length ? visible.map(function (item) { return h("div", { key: item.path, className: "dsh-tavern-library-card-row" },
					h("button", { className: "dsh-tavern-library-card" + (item.hasImage ? " with-image" : ""), onClick: function () { loadCard(item.path); } }, h(TavernCardListContent, { card: item, detail: item.path.split("/").pop(), extra: item.script ? "已绑定剧本：" + item.script.title : "" })),
					sessionMode === "card" ? h("button", { className: "dsh-tavern-resource-at", title: "在对话中引用", onClick: function () { props.appendMention(item.path, item.name); } }, "在对话中引用") : null
				); }) : h("div", { className: "dsh-tavern-empty" }, needle ? "没有匹配的人物卡" : "还没有人物卡") )
			);
		}

		function CardFieldsPanel(props) {
			const [draft, setDraft] = React.useState({});
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = usePersistentError("人物卡详情");
			const [script, setScript] = React.useState(null);
			const [availableResources, setAvailableResources] = React.useState([]);
			const [scriptCatalogLoaded, setScriptCatalogLoaded] = React.useState(false);
			const [scriptCatalogLoading, setScriptCatalogLoading] = React.useState(false);
			const [selectedScriptPath, setSelectedScriptPath] = React.useState("");
			const [scriptBusy, setScriptBusy] = React.useState(false);
			const [scriptError, setScriptError] = usePersistentError("剧本管理");
			const [worldBookBinding, setWorldBookBinding] = React.useState(null);
			const [availableWorldBooks, setAvailableWorldBooks] = React.useState([]);
			const [worldBookCatalogLoaded, setWorldBookCatalogLoaded] = React.useState(false);
			const [worldBookCatalogLoading, setWorldBookCatalogLoading] = React.useState(false);
			const [worldBookCatalogWarning, setWorldBookCatalogWarning] = React.useState("");
			const [selectedWorldBook, setSelectedWorldBook] = React.useState("");
			const [worldBookBusy, setWorldBookBusy] = React.useState(false);
			const [worldBookError, setWorldBookError] = usePersistentError("世界书绑定");
			const scriptFileRef = React.useRef(null);
			const worldBookDetailsRef = React.useRef(null);
			const worldBookCatalogRequestRef = React.useRef(null);
			const cardPath = props.view.card.path;
			function call(method, args) { return rpc(method, args); }
			function worldBookChoiceValue(item) {
				if (!item) return "";
				return item.kind === "card" ? "card:" + item.cardPath : "standalone:" + item.path;
			}
			function worldBookChoiceSource(value) {
				if (value.indexOf("card:") === 0) return { kind: "card", cardPath: value.slice(5) };
				if (value.indexOf("standalone:") === 0) return { kind: "standalone", path: value.slice(11) };
				return null;
			}
			function loadScript() {
				if (!cardPath) return;
				call("getScriptInfo", { path: cardPath }).then(function (result) {
					const currentScript = result.script || null;
					setScript(currentScript);
					setSelectedScriptPath(currentScript ? currentScript.path : "");
					setScriptError("");
				}, function (err) { setScriptError(String(err && err.message || err)); });
			}
			function loadScriptCatalog() {
				if (!cardPath || scriptCatalogLoaded || scriptCatalogLoading) return;
				setScriptCatalogLoading(true);
				call("listResources").then(function (result) {
					setAvailableResources(result.resources || []);
					setScriptCatalogLoaded(true);
					setScriptError("");
				}, function (err) { setScriptError(String(err && err.message || err)); })
					.finally(function () { setScriptCatalogLoading(false); });
			}
			function loadWorldBookBinding() {
				if (!cardPath) return;
				call("getWorldBookBinding", { cardPath: cardPath }).then(function (result) {
					const binding = result.binding || { kind: "none", source: null, name: "" };
					setWorldBookBinding(binding);
					setSelectedWorldBook(binding.source ? worldBookChoiceValue(binding.source) : "");
					setWorldBookError("");
				}, function (err) { setWorldBookError(String(err && err.message || err)); });
			}
			function loadWorldBookCatalog(force) {
				if (!cardPath || (!force && worldBookCatalogLoaded)) return Promise.resolve();
				if (worldBookCatalogRequestRef.current) return worldBookCatalogRequestRef.current;
				setWorldBookError("");
				setWorldBookCatalogLoading(true);
				const request = rpcWithTimeout("listWorldBooks", {}).then(function (result) {
					setAvailableWorldBooks((result.standalone || []).concat(result.embedded || []));
					setWorldBookCatalogLoaded(true);
					setWorldBookCatalogWarning(worldBookCatalogDiagnostic(result));
					setWorldBookError("");
				}, function (err) { setWorldBookError(String(err && err.message || err)); })
					.finally(function () {
						if (worldBookCatalogRequestRef.current !== request) return;
						worldBookCatalogRequestRef.current = null;
						setWorldBookCatalogLoading(false);
					});
				worldBookCatalogRequestRef.current = request;
				return request;
			}
			React.useEffect(function () {
				const card = props.view.card;
				setDraft({
					name: card.name || "", tags: (card.tags || []).join(", "), description: card.description || "", personality: card.personality || "", scenario: card.scenario || "",
					first_mes: card.first_mes || "", alternate_greetings: (card.alternate_greetings || []).join("\n---\n"), mes_example: card.mes_example || "", system_prompt: card.system_prompt || "",
					post_history_instructions: card.post_history_instructions || "", creator_notes: card.creator_notes || ""
				});
			}, [props.view.card]);
			React.useEffect(function () {
				setAvailableResources([]); setScriptCatalogLoaded(false); setScriptCatalogLoading(false);
				setAvailableWorldBooks([]); setWorldBookCatalogLoaded(false); setWorldBookCatalogLoading(false);
				setWorldBookCatalogWarning("");
				loadScript();
				loadWorldBookBinding();
			}, [cardPath]);
			React.useEffect(function () {
				function onWorldBookDataChanged(event) {
					if (!tavernDataChangeAffects(event, ["worldbooks", "cards"])) return;
					setAvailableWorldBooks([]);
					setWorldBookCatalogLoaded(false);
					if (worldBookDetailsRef.current && worldBookDetailsRef.current.open) loadWorldBookCatalog(true);
				}
				window.addEventListener("dsh-tavern-data-changed", onWorldBookDataChanged);
				return function () { window.removeEventListener("dsh-tavern-data-changed", onWorldBookDataChanged); };
			}, [cardPath]);
			function field(name, value) { setDraft(Object.assign({}, draft, { [name]: value })); }
			async function save() {
				setBusy(true); setError("");
				try {
					const next = Object.assign({}, draft, { tags: draft.tags.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean), alternate_greetings: draft.alternate_greetings.split(/\n---+\n/).map(function (x) { return x.trim(); }).filter(Boolean) });
					const source = props.view.card || {};
					const baseline = {
						name: source.name || "", tags: source.tags || [], description: source.description || "", personality: source.personality || "", scenario: source.scenario || "",
						first_mes: source.first_mes || "", alternate_greetings: source.alternate_greetings || [], mes_example: source.mes_example || "", system_prompt: source.system_prompt || "",
						post_history_instructions: source.post_history_instructions || "", creator_notes: source.creator_notes || ""
					};
					const patch = {};
					Object.keys(next).forEach(function (key) { if (JSON.stringify(next[key]) !== JSON.stringify(baseline[key])) patch[key] = next[key]; });
					const res = await call("updateCard", { path: cardPath, patch: patch });
					props.onSaved(res.card);
					notifyTavernDataChanged(["cards", "sessions"], "cards");
				} catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
			}
			async function importScriptFile(file) {
				if (!cardPath || !file) return;
				setScriptBusy(true); setScriptError("");
				try {
					const res = await call("importScript", { cardPath: cardPath, payload: await parseTextResourceFile(file) });
					setScript(res.script || null);
					setSelectedScriptPath(res.script ? res.script.path : "");
					notifyTavernDataChanged(["scripts", "cards"], "cards");
					loadScript();
				} catch (err) { setScriptError(String(err && err.message || err)); }
				finally { setScriptBusy(false); }
			}
			async function bindSelectedScript() {
				if (!cardPath || !selectedScriptPath) return;
				setScriptBusy(true); setScriptError("");
				try {
					const res = await call("bindScript", { cardPath: cardPath, path: selectedScriptPath });
					setScript(res.script || null);
					notifyTavernDataChanged(["scripts", "cards"], "cards");
				} catch (err) { setScriptError(String(err && err.message || err)); }
				finally { setScriptBusy(false); }
			}
			async function deleteScript() {
				if (!script || !window.confirm("解除剧本《" + (script.title || "未命名") + "》绑定？\n已有剧本会话保留，新会话将按自由故事推进。")) return;
				setScriptBusy(true); setScriptError("");
				try {
					await call("deleteScript", { cardPath: cardPath });
					setScript(null);
					setSelectedScriptPath("");
					notifyTavernDataChanged(["scripts", "cards"], "cards");
				} catch (err) { setScriptError(String(err && err.message || err)); }
				finally { setScriptBusy(false); }
			}
			async function bindSelectedWorldBook() {
				if (!cardPath || !selectedWorldBook) return;
				setWorldBookBusy(true); setWorldBookError("");
				try {
					const source = worldBookChoiceSource(selectedWorldBook);
					if (!source) throw new Error("请选择世界书");
					const result = await call("bindWorldBook", { cardPath: cardPath, source: source });
					setWorldBookBinding(result.binding || null);
					notifyTavernDataChanged(["worldbooks", "cards"], "cards");
				} catch (err) { setWorldBookError(String(err && err.message || err)); }
				finally { setWorldBookBusy(false); }
			}
			async function unbindWorldBook() {
				if (!cardPath) return;
				setWorldBookBusy(true); setWorldBookError("");
				try {
					const result = await call("unbindWorldBook", { cardPath: cardPath });
					setWorldBookBinding(result.binding || null); setSelectedWorldBook("");
					notifyTavernDataChanged(["worldbooks", "cards"], "cards");
				} catch (err) { setWorldBookError(String(err && err.message || err)); }
				finally { setWorldBookBusy(false); }
			}
			function F(name, label, large) { return React.createElement("div", { className: "dsh-tavern-card-field" }, React.createElement("label", null, label), name === "name" || name === "tags" ? React.createElement("input", { value: draft[name] || "", onChange: function (e) { field(name, e.target.value); } }) : React.createElement("textarea", { className: large ? "large" : "", value: draft[name] || "", onChange: function (e) { field(name, e.target.value); } })); }
			const h = React.createElement;
			const worldBookEntries = props.view.card.character_book && Array.isArray(props.view.card.character_book.entries) ? props.view.card.character_book.entries : [];
			const cardExtensions = props.view.card.extensions || {};
			const cardRegexScripts = cardExtensions.regexScripts || [];
			const helperScripts = cardExtensions.helperScripts || [];
			const mvuResources = cardExtensions.mvuResources || [];
			const otherExtensions = cardExtensions.otherExtensions || [];
			const extensionCount = Number(cardExtensions.extensionCount) || 0;
			function extensionSectionTitle(title, count) {
				return count ? h("div", { className: "dsh-tavern-preset-section-title" }, title + " · " + count) : null;
			}
			function extensionTags(items) {
				return h("span", { className: "dsh-tavern-prompt-tags" }, items.filter(Boolean).map(function (item, index) { return h("span", { key: index, className: "dsh-tavern-prompt-tag" }, item); }));
			}
			function regexExtensionRow(item, index) {
				const placement = item.placement && item.placement.length ? item.placement.join(", ") : "未设置";
				const snippet = String(item.findRegex || "").replace(/\s+/g, " ").trim() || "空查找规则";
				const metadata = [
					"placement: [" + placement + "]", "promptOnly: " + Boolean(item.promptOnly), "markdownOnly: " + Boolean(item.markdownOnly),
					"runOnEdit: " + Boolean(item.runOnEdit), "substituteRegex: " + String(item.substituteRegex === null ? "null" : item.substituteRegex),
					"minDepth: " + String(item.minDepth === null ? "null" : item.minDepth), "maxDepth: " + String(item.maxDepth === null ? "null" : item.maxDepth),
					"trimStrings: " + JSON.stringify(item.trimStrings || [])
				].join("\n");
				return h("details", { key: item.ref || item.id || index, className: "dsh-tavern-prompt-row role-regex" },
					h("summary", { className: "dsh-tavern-prompt-head" },
						h("span", { className: "dsh-tavern-prompt-role" }, "REGEX"),
						h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, item.name), h("span", null, snippet), extensionTags(["位置 " + placement, item.promptOnly ? "仅提示词" : "", item.markdownOnly ? "仅 Markdown" : "", item.runOnEdit ? "编辑时运行" : ""])),
						h("span", { className: "dsh-tavern-prompt-state" + (item.enabled ? "" : " off") }, item.enabled ? "已启用" : "已关闭")
					),
					h("div", { className: "dsh-tavern-regex-body" },
						h("div", { className: "dsh-tavern-regex-label" }, "查找正则"), h("pre", { className: "dsh-tavern-regex-code" }, item.findRegex || "（空）"),
						h("div", { className: "dsh-tavern-regex-label" }, "替换内容"), h("pre", { className: "dsh-tavern-regex-code" }, item.replaceString || "（空）"),
						h("div", { className: "dsh-tavern-regex-meta" }, metadata)
					)
				);
			}
			function helperScriptRow(item, index) {
				const snippet = String(item.content || "").replace(/\s+/g, " ").trim() || "空脚本";
				return h("details", { key: item.ref || item.id || index, className: "dsh-tavern-prompt-row role-script" },
					h("summary", { className: "dsh-tavern-prompt-head" },
						h("span", { className: "dsh-tavern-prompt-role" }, "SCRIPT"),
						h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, item.name), h("span", null, snippet), extensionTags([item.type, item.buttonCount ? item.buttonCount + " 个按钮" : "", item.chars + " 字"])),
						h("span", { className: "dsh-tavern-prompt-state" + (item.enabled ? "" : " off") }, item.enabled ? "已启用" : "已关闭")
					),
					h("div", { className: "dsh-tavern-regex-body" },
						h("div", { className: "dsh-tavern-regex-label" }, "脚本内容"), h("pre", { className: "dsh-tavern-regex-code" }, item.content || "（空）"),
						item.dataText ? h("div", null, h("div", { className: "dsh-tavern-regex-label" }, "脚本配置"), h("pre", { className: "dsh-tavern-regex-code" }, item.dataText)) : null,
						item.info ? h("div", null, h("div", { className: "dsh-tavern-regex-label" }, "说明"), h("pre", { className: "dsh-tavern-regex-code" }, item.info)) : null,
						item.exportWith !== null ? h("div", { className: "dsh-tavern-regex-meta" }, "export_with: " + JSON.stringify(item.exportWith)) : null
					)
				);
			}
			function otherExtensionRow(item, index) {
				return h("details", { key: item.ref || item.name || index, className: "dsh-tavern-prompt-row role-extension" },
					h("summary", { className: "dsh-tavern-prompt-head" }, h("span", { className: "dsh-tavern-prompt-role" }, "EXT"), h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, item.name), h("span", null, item.type + " · " + item.chars + " 字")), h("span", { className: "dsh-tavern-mvu-state" }, "只读")),
					h("pre", { className: "dsh-tavern-prompt-content" }, item.text || "（空）")
				);
			}
			const extensionPanel = h("div", { className: "dsh-tavern-card-extensions" },
				h("div", { className: "dsh-tavern-extension-note" }, "这里只读取人物卡工作区中的完整扩展数据，不执行任何卡内脚本。MVU 按名称和内容识别，用于帮助定位相关资源，不代表已经完整解析其运行逻辑。"),
				extensionSectionTitle("正则脚本", cardRegexScripts.length), cardRegexScripts.map(regexExtensionRow),
				extensionSectionTitle("Tavern Helper 脚本", helperScripts.length), helperScripts.map(helperScriptRow),
				extensionSectionTitle("MVU 相关资源", mvuResources.length),
				mvuResources.length ? h("div", { className: "dsh-tavern-mvu-list" }, mvuResources.map(function (item, index) { return h("div", { key: item.ref || index, className: "dsh-tavern-mvu-row" }, h("span", { className: "dsh-tavern-mvu-kind" }, item.kindLabel), h("span", { className: "dsh-tavern-mvu-name", title: item.name }, item.name), h("span", { className: "dsh-tavern-mvu-state" }, item.enabled ? "已启用" : "已关闭")); })) : null,
				extensionSectionTitle("其他扩展", otherExtensions.length), otherExtensions.map(otherExtensionRow),
				extensionCount === 0 && mvuResources.length === 0 ? h("div", { className: "dsh-tavern-worldbook-empty" }, "这张人物卡没有可展示的扩展内容") : null
			);
			const selectableResources = availableResources.filter(function (item) { return !Array.isArray(item.boundCards) || item.boundCards.length === 0 || item.boundCards.some(function (boundCard) { return boundCard.path === cardPath; }); });
			const scriptPanel = h("div", { className: "dsh-tavern-script-row" },
				h("div", { className: "dsh-tavern-script-info" }, script ? h("span", null, h("b", null, "当前剧本："), script.title + " · " + script.chunkCount + " 块 · " + script.sourceChars + " 字") : h("span", null, "未绑定剧本；游玩时按自由故事推进")),
				h("select", { value: selectedScriptPath, disabled: scriptBusy || scriptCatalogLoading || !scriptCatalogLoaded || !selectableResources.length, onChange: function (event) { setSelectedScriptPath(event.target.value); } }, h("option", { value: "" }, scriptCatalogLoading ? "正在读取剧本库…" : "选择已有剧本"), selectableResources.map(function (item) { return h("option", { key: item.path, value: item.path }, item.title); })),
				h("button", { className: script ? "dsh-tavern-script-file" : "dsh-tavern-script-primary", disabled: scriptBusy || !selectedScriptPath || !!(script && script.path === selectedScriptPath), onClick: bindSelectedScript }, script ? "更换绑定" : "绑定"),
				h("input", { ref: scriptFileRef, type: "file", accept: ".txt,.md,.epub,text/plain,text/markdown,application/epub+zip", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importScriptFile(f); e.target.value = ""; } }),
				h("button", { className: "dsh-tavern-script-file", disabled: scriptBusy, onClick: function () { scriptFileRef.current && scriptFileRef.current.click(); } }, "导入新剧本并绑定"),
				script ? h("button", { className: "dsh-tavern-script-file", disabled: scriptBusy, onClick: deleteScript }, "解绑") : null
			);
			const scriptHero = h("details", { className: "dsh-tavern-script-hero", onToggle: function (event) { if (event.currentTarget.open) loadScriptCatalog(); } },
				h("summary", { className: "dsh-tavern-script-hero-title" }, script ? ("剧本模式 · " + script.title) : "剧本模式 · 未绑定"),
				h("div", { className: "dsh-tavern-script-hero-help" }, "绑定剧本后，新开的游玩对话会自动进入剧本模式。Agent 按剧情进度分段读取当前片段并围绕它续写，每轮完成后推进阅读位置；不会一次载入整本剧本，也不要求玩家照原文行动。更换或解绑会影响所有使用这张人物卡的剧本对话。"),
				scriptPanel,
				scriptError ? h("div", { className: "dsh-card-error" }, scriptError) : null
			);
			const hasWorldBookBinding = Boolean(worldBookBinding && worldBookBinding.kind !== "none");
			const ownWorldBook = props.view.card.character_book;
			const ownWorldBookName = String(ownWorldBook && ownWorldBook.name || "").trim() || String(props.view.card.name || "").trim() || cardPath;
			const worldBookChoices = availableWorldBooks.filter(function (item) { return !(item.kind === "card" && item.cardPath === cardPath); });
			const worldBookPanel = h("div", { className: "dsh-tavern-worldbook" },
				h("div", { className: "dsh-tavern-worldbook-note" }, hasWorldBookBinding ? "当前绑定：" + (worldBookBinding.name || "世界书不可用") : "当前未绑定世界书。人物卡有自带世界书时默认绑定自带内容。"),
				h("div", { className: "dsh-tavern-script-row" },
					hasWorldBookBinding ? null : h("select", { value: selectedWorldBook, disabled: worldBookBusy || worldBookCatalogLoading, onChange: function (event) { setSelectedWorldBook(event.target.value); } },
						h("option", { value: "" }, worldBookCatalogLoading ? "正在读取世界书库…" : "选择世界书"),
						ownWorldBook && typeof ownWorldBook === "object" ? h("option", { value: worldBookChoiceValue({ kind: "card", cardPath: cardPath }) }, ownWorldBookName + "（当前人物卡）") : null,
						worldBookChoices.map(function (item) { const value = worldBookChoiceValue(item); return h("option", { key: value, value: value }, item.kind === "card" ? item.name + "（人物卡：" + item.cardName + "）" : item.name + "（独立世界书）"); })
					),
					hasWorldBookBinding ? null : h("button", { className: "dsh-tavern-script-primary", disabled: worldBookBusy || !selectedWorldBook, onClick: bindSelectedWorldBook }, worldBookBusy ? "处理中…" : "绑定"),
					hasWorldBookBinding ? h("button", { className: "dsh-tavern-script-file", disabled: worldBookBusy, onClick: unbindWorldBook }, "解绑") : null,
					hasWorldBookBinding ? h("button", { className: "dsh-tavern-worldbook-add", disabled: worldBookBusy, onClick: function () { if (typeof props.onOpenWorldBook === "function") props.onOpenWorldBook(worldBookBinding.source); } }, "打开世界书") : null
				),
				worldBookError ? h("div", { className: "dsh-card-error" },
					worldBookError,
					h("button", { className: "dsh-tavern-btn", disabled: worldBookCatalogLoading, onClick: function () { loadWorldBookCatalog(true); } }, worldBookCatalogLoading ? "正在读取…" : "重新读取")
				) : null,
				worldBookCatalogWarning ? h("div", { className: "dsh-card-error" }, worldBookCatalogWarning) : null
			);
			return h("aside", { className: "dsh-tavern-status" },
				h("div", { className: "dsh-tavern-status-head" },
					props.onBack ? h("button", { className: "dsh-tavern-btn", onClick: props.onBack }, "← 返回人物卡库") : null,
					h("div", { className: "dsh-tavern-status-role" }, props.view.card.name),
					h("div", { className: "dsh-tavern-question-sub" }, props.view.card.path ? props.view.card.path.split("/").pop() : ""),
					props.library ? h("div", { className: "dsh-tavern-library-head-actions" }, props.onAttach ? h("button", { className: "dsh-tavern-btn", onClick: props.onAttach }, "在对话中引用") : null, h("button", { className: "dsh-tavern-btn", onClick: props.onRename }, "重命名文件"), h("button", { className: "dsh-tavern-btn", onClick: props.onExport }, "导出"), h("button", { className: "dsh-tavern-btn", onClick: props.onDelete }, "删除")) : null
				),
				scriptHero,
				h("div", { className: "dsh-tavern-card-fields" },
					h("details", { className: "dsh-tavern-card-advanced", open: true }, h("summary", null, "基本信息"), F("name", "角色名称"), F("tags", "标签"), F("description", "角色描述", true), F("personality", "性格"), F("scenario", "场景设定"), F("first_mes", "开场白", true), F("alternate_greetings", "备选开场白（--- 分隔）"), F("system_prompt", "系统提示"), F("post_history_instructions", "历史后指令"), F("mes_example", "对话示例", true), F("creator_notes", "创作者备注")),
					h("details", { ref: worldBookDetailsRef, className: "dsh-tavern-card-advanced", onToggle: function (event) { if (event.currentTarget.open) loadWorldBookCatalog(); } }, h("summary", null, "世界书 · " + worldBookEntries.length + " 条"), worldBookPanel),
					h("details", { className: "dsh-tavern-card-advanced" }, h("summary", null, "扩展内容 · " + extensionCount + " 项"), extensionPanel),
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					h("div", { className: "dsh-tavern-card-save" }, h("button", { className: "dsh-card-primary", disabled: busy, onClick: save }, busy ? "保存中…" : "保存字段"))
				)
			);
		}
		function register(input) {
			const ctx = input.ctx;
			const appendMention = input.appendMention;
			return ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:cards",
				title: "人物卡库",
				order: 3,
				single: true,
				component: function (props) {
					return React.createElement(CardLibraryTab, Object.assign({}, props, {
						appendMention: function (path, label) { appendMention(props.scope.sessionId, "card", path, label); },
						openWorldBook: function (source) {
							ctx.betterSidebar.openTab({ type: "dsh-tavern:worldbooks" }, { sessionId: props.scope.sessionId });
							ctx.betterSidebar.updateTab("dsh-tavern:worldbooks", { meta: { worldBookSource: source } });
						}
					}));
				}
			}), "dsh-tavern: Better Sidebar card library tab");
		}
		return Object.freeze({ register: register });
		}
		const cardLibraryFeature = createCardLibraryFeatureModule();

		function TavernPersistentStatusRuntime(props) {
			const view = props.view;
			const statusView = view && isPlayMode(view.mode) ? view.tavernStatusView : null;
			if (!statusView || !statusView.content || !view.tavernHelper) return null;
			return React.createElement("section", {
				className: "dsh-tavern-status-runtime",
				"data-status-view-id": String(statusView.viewId || "primary"),
				"data-template-revision": String(statusView.templateRevision || "")
			}, React.createElement(TavernMessageFrame, {
				content: String(statusView.content),
				sessionId: props.sessionId,
				turn: Math.max(1, Number(statusView.targetTurn) || 1),
				partIndex: Math.max(0, Number(statusView.sourcePartIndex) || 0),
				helperContext: view.tavernHelper,
				trustedCardMode: Boolean(view.tavernRuntimePolicy && view.tavernRuntimePolicy.trustedCardMode),
				eager: true,
				persistent: true,
				observeMvuView: false,
				runtimeReporting: false
			}));
		}

		function latestTavernAssistantMessageId(snapshot) {
			// alpha.2 keeps message projections on Chat, separate from Session lifecycle.
			const nodes = snapshot && snapshot.legacy && snapshot.legacy.nodes || [];
			for (let index = nodes.length - 1; index >= 0; index -= 1) {
				if (nodes[index].kind === "assistant" && nodes[index].messageId) return nodes[index].messageId;
			}
			return null;
		}

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
		// One owner for persisted suppression and legacy browser-only history records.
		// Kept in the loader bundle so DSH needs no new browser module protocol.
		function createTurnHistoryProjection(options) {
			options = options || {};
			const root = options.root || function () { return document; };
			const storage = options.storage || function () { return window.localStorage; };
		const HIDDEN_TURNS_KEY = "dsh-tavern-hidden-turns";
		const ROLLED_BACK_TURNS_KEY = "dsh-tavern-rolled-back-turns";
		const HIDDEN_REGEN_USER_TURNS_KEY = "dsh-tavern-hidden-regen-user-turns";
		function forgetHiddenTurn(storageKey, sessionId, turn) {
			try {
				const all = JSON.parse(storage().getItem(storageKey) || "{}");
				const list = Array.isArray(all[sessionId]) ? all[sessionId].filter(function (item) { return Number(item) !== Number(turn); }) : [];
				if (list.length) all[sessionId] = list;
				else delete all[sessionId];
				storage().setItem(storageKey, JSON.stringify(all));
			} catch (err) {}
		}
		function hideUserForTurnTail(tail) {
			if (!tail) return;
			let sib = tail.previousElementSibling;
			while (sib) {
				const kind = sib.getAttribute("data-chat-flow-kind");
				if (kind === "user") {
					sib.style.display = "none";
					break;
				}
				if (kind === "turn-tail") break;
				sib = sib.previousElementSibling;
			}
		}
		function applyHiddenRegenUserTurns(sessionId) {
			try {
				const all = JSON.parse(storage().getItem(HIDDEN_REGEN_USER_TURNS_KEY) || "{}");
				const turns = all[sessionId];
				if (!Array.isArray(turns) || turns.length === 0) return;
				const set = new Set(turns.map(String));
				const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
				for (let i = 0; i < tails.length; i++) {
					const tail = tails[i];
					if (!set.has(tailTurnOf(tail))) continue;
					hideUserForTurnTail(tail);
				}
			} catch (err) {}
		}
		function hideTurnTail(el) {
			if (!el) return;
			el.style.display = "none";
			let sib = el.previousElementSibling;
			while (sib) {
				const kind = sib.getAttribute("data-chat-flow-kind");
				if (kind === "user" || kind === "turn-tail") break;
				sib.style.display = "none";
				sib = sib.previousElementSibling;
			}
		}
		function showTurnTail(el) {
			if (!el) return;
			el.style.display = "";
			let sib = el.previousElementSibling;
			while (sib) {
				const kind = sib.getAttribute("data-chat-flow-kind");
				if (kind === "user" || kind === "turn-tail") break;
				sib.style.display = "";
				sib = sib.previousElementSibling;
			}
		}
		function hideTurnTailWithUser(el) {
			if (!el) return;
			el.style.display = "none";
			const turn = el.getAttribute("data-chat-turn");
			let sib = el.previousElementSibling;
			while (sib) {
				const kind = sib.getAttribute("data-chat-flow-kind");
				if (kind === "turn-tail") break;
				const siblingTurn = sib.getAttribute("data-chat-turn");
				if (turn && siblingTurn && siblingTurn !== turn) break;
				// System prompts precede the user row. Hide through the turn boundary,
				// not just through its input; alpha also supplies explicit ownership.
				sib.style.display = "none";
				sib = sib.previousElementSibling;
			}
		}
		function tailTurnOf(el) {
			if (!el) return "";
			if (el.getAttribute("data-turn-tail")) return el.getAttribute("data-turn-tail");
			const inner = el.querySelector("[data-turn-tail]");
			return inner ? inner.getAttribute("data-turn-tail") : "";
		}
		function applyHiddenTurns(sessionId) {
			try {
				const all = JSON.parse(storage().getItem(HIDDEN_TURNS_KEY) || "{}");
				const turns = all[sessionId];
				if (!Array.isArray(turns) || turns.length === 0) return;
				const set = new Set(turns.map(String));
				const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
				for (let i = 0; i < tails.length; i++) {
					const tail = tails[i];
					if (!set.has(tailTurnOf(tail))) continue;
					hideTurnTail(tail);
				}
			} catch (err) {}
		}
		function applyRolledBackTurns(sessionId) {
			try {
				const all = JSON.parse(storage().getItem(ROLLED_BACK_TURNS_KEY) || "{}");
				const turns = all[sessionId];
				if (!Array.isArray(turns) || turns.length === 0) return;
				const set = new Set(turns.map(String));
				const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
				for (let i = 0; i < tails.length; i++) {
					const tail = tails[i];
					if (!set.has(tailTurnOf(tail))) continue;
					hideTurnTailWithUser(tail);
				}
			} catch (err) {}
		}
		function applySuppressedDshTurns(turns, regeneratedDshTurns) {
			const set = new Set((Array.isArray(turns) ? turns : []).map(String));
			if (set.size === 0) return;
			const visibleRegenerations = new Set(Object.values(regeneratedDshTurns && typeof regeneratedDshTurns === "object" ? regeneratedDshTurns : {}).map(String));
			const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
			for (let i = 0; i < tails.length; i++) {
				const tail = tails[i];
				const turn = tailTurnOf(tail);
				if (!set.has(turn)) continue;
				if (visibleRegenerations.has(turn)) {
					showTurnTail(tail);
					hideUserForTurnTail(tail);
				} else hideTurnTailWithUser(tail);
			}
		}
		function applyRegeneratedDshTurns(regeneratedDshTurns) {
			const mappings = regeneratedDshTurns && typeof regeneratedDshTurns === "object" ? regeneratedDshTurns : {};
			const hiddenStoryTurns = new Set(Object.keys(mappings).map(String));
			if (hiddenStoryTurns.size === 0) return;
			const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
			for (let i = 0; i < tails.length; i++) {
				const tail = tails[i];
				if (hiddenStoryTurns.has(tailTurnOf(tail))) hideTurnTail(tail);
			}
		}
			function apply(sessionId, turns, regeneratedDshTurns) {
				applySuppressedDshTurns(turns, regeneratedDshTurns);
				applyRegeneratedDshTurns(regeneratedDshTurns);
				applyHiddenTurns(sessionId);
				applyRolledBackTurns(sessionId);
				applyHiddenRegenUserTurns(sessionId);
			}
			function regenerated(sessionId, view, tail) {
				const adopted = view && view.adopted;
				if (adopted && Number(adopted.hiddenTurn) > 0) forgetHiddenTurn(HIDDEN_TURNS_KEY, sessionId, Number(adopted.hiddenTurn));
				if (adopted && Number(adopted.syntheticTurn) > 0) forgetHiddenTurn(HIDDEN_REGEN_USER_TURNS_KEY, sessionId, Number(adopted.syntheticTurn));
				apply(sessionId, view && view.suppressedDshTurns, view && view.regeneratedDshTurns);
			}
			function rolledBack(sessionId, view) {
				apply(sessionId, view && view.suppressedDshTurns, view && view.regeneratedDshTurns);
			}
			return Object.freeze({ apply: apply, regenerated: regenerated, rolledBack: rolledBack });
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

		function createPlayControlsFeatureModule() {
			const historyProjection = createTurnHistoryProjection();
			function TavernConversationExportAction(props) {
				const [available, setAvailable] = React.useState(false);
				const [busy, setBusy] = React.useState(false);
				React.useEffect(function () {
					let stopped = false;
					rpc("getSession", {}, props.sessionId).then(function (result) {
						if (!stopped) setAvailable(Boolean(result && result.view));
					}, function () { if (!stopped) setAvailable(false); });
					return function () { stopped = true; };
				}, [props.sessionId]);
				if (!available) return null;
				async function exportText() {
					setBusy(true);
					try {
						const snapshot = props.sessions.list.getSnapshot();
						const summary = snapshot.byId && snapshot.byId[props.sessionId];
						const result = await rpc("exportConversation", { title: summary && summary.displayTitle || "" }, props.sessionId);
						const blob = new Blob(["\uFEFF", result.text], { type: "text/plain;charset=utf-8" });
						const url = URL.createObjectURL(blob);
						const link = document.createElement("a");
						link.href = url; link.download = result.filename || "对话记录.txt";
						document.body.appendChild(link); link.click(); link.remove();
						URL.revokeObjectURL(url);
					} catch (err) { tavernErrorHub.report("导出纯对话", err); }
					finally { setBusy(false); }
				}
				async function exportLogs() {
					setBusy(true);
					try {
						const result = await rpc("exportTavernLogs", {}, props.sessionId);
						const bytes = Uint8Array.from(atob(result.base64), function (value) { return value.charCodeAt(0); });
						const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
						const link = document.createElement("a");
						link.href = url; link.download = result.filename;
						document.body.appendChild(link); link.click(); link.remove();
						window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
					} catch (err) { tavernErrorHub.report("导出日志", err); }
					finally { setBusy(false); }
				}
				return React.createElement(React.Fragment, null,
					React.createElement("style", null, 'body:has([data-tavern-log-export]) button[class*="_sessionLogButton"]{display:none!important}.dsh-tavern-log-export{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary);padding:6px 12px;height:32px;font:inherit;font-size:13px;cursor:pointer}.dsh-tavern-log-export:disabled{cursor:wait;opacity:.6}'),
					React.createElement("button", { className: "dsh-tavern-log-export", "data-tavern-log-export": "", disabled: busy, "aria-label": "日志", "aria-busy": busy, title: "下载 Session、MVU 与生图日志；含私人剧情，分享前请检查隐私", onClick: exportLogs }, "日志",
						React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, React.createElement("path", { d: "M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4" }))),
					React.createElement("button", { className: "dsh-tavern-export-action", disabled: busy, title: "导出只包含玩家与角色正文的 TXT", onClick: exportText }, "纯对话 TXT ↓"));
			}

			function TavernCompactionAction(props) {
				const [busy, setBusy] = React.useState(false);
				const [resultLabel, setResultLabel] = React.useState("");
				const [resultTitle, setResultTitle] = React.useState("");
				const running = props.useSession(function (snapshot) { return snapshot.running; });
				async function executeTarget(sessionId, missingMessage) {
					if (!sessionId) return { status: "skipped", message: missingMessage };
					try {
						const result = await props.executeCompact(sessionId);
						if (!result.ok) throw new Error(result.error && result.error.message ? result.error.message : "无法执行上下文压缩");
						if (result.value === undefined) throw new Error("当前会话不支持 /compact");
						if (result.value.result && result.value.result.kind === "error") throw new Error(result.value.result.text || "上下文压缩失败");
						return { status: "succeeded", message: result.value.result && result.value.result.text || "压缩完成" };
					} catch (error) {
						return { status: "failed", message: String(error && error.message || error) };
					}
				}
				async function compactContext() {
					setBusy(true);
					setResultLabel("");
					setResultTitle("");
					try {
						const prepared = await rpc("prepareCompaction", {}, props.sessionId);
						const plan = prepared.plan;
						const foreground = await executeTarget(plan.foregroundSessionId, "没有前台 Session");
						const background = plan.backgroundSessionId
							? (await rpc("compactBackground", { operationId: plan.operationId }, props.sessionId)).result
							: { status: "skipped", message: "没有后台 Session" };
						const completed = await rpc("completeCompaction", { operationId: plan.operationId, foreground: foreground, background: background }, props.sessionId);
						setResultTitle("前台：" + foreground.message + "；后台：" + background.message);
						if (completed.result.status === "completed") setResultLabel(plan.backgroundSessionId ? "前台和后台已压缩" : "前台已压缩");
						else if (completed.result.status === "partial") {
							setResultLabel("部分成功");
							throw new Error("上下文压缩部分成功。前台：" + foreground.message + "；后台：" + background.message);
						} else throw new Error("上下文压缩失败。前台：" + foreground.message + "；后台：" + background.message);
					} catch (err) { tavernErrorHub.report("压缩上下文", err); }
					finally { setBusy(false); }
				}
				return React.createElement("button", { className: props.inMenu ? "" : "dsh-tavern-choice-trigger", role: props.inMenu ? "menuitem" : undefined, disabled: busy || running, title: resultTitle || "前台使用剧情提示词、后台使用 DSH 内置提示词并联合压缩", onClick: compactContext }, busy ? "压缩中…" : (resultLabel || "压缩上下文"));
			}

			function TavernPlayerNameAction(props) {
				const [view, setView] = React.useState(null);
				const [busy, setBusy] = React.useState(false);
				React.useEffect(function () {
					let stopped = false;
					rpc("getSession", {}, props.sessionId).then(function (result) {
						if (!stopped) setView(result.view || null);
					}, function () { if (!stopped) setView(null); });
					return function () { stopped = true; };
				}, [props.sessionId]);
				if (!view || view.mode === "card") return null;
				async function renamePlayer() {
					const next = window.prompt("修改故事中的玩家称呼\n仅影响之后生成的内容，不会重写历史消息。", view.playerName || "你");
					if (next === null) return;
					setBusy(true);
					try {
						const result = await rpc("setPlayerName", { userName: next }, props.sessionId);
						setView(Object.assign({}, view, { playerName: result.playerName || "你" }));
						window.localStorage.setItem("dsh-tavern-player-name", result.playerName || "你");
						notifyTavernDataChanged(["sessions"], "play-controls");
					} catch (err) { tavernErrorHub.report("玩家称呼", err); }
					finally { setBusy(false); }
				}
				const presetName = view.runtimePreset && view.runtimePreset.name ? view.runtimePreset.name : "无";
				return React.createElement(React.Fragment, null,
					React.createElement("button", { className: "dsh-tavern-player-action", disabled: busy, title: "修改之后内容中的玩家称呼", onClick: renamePlayer }, "玩家：" + (view.playerName || "你")),
					React.createElement("span", { className: "dsh-tavern-preset-status", title: view.runtimePreset && view.runtimePreset.id ? view.runtimePreset.id : "当前没有选择外部预设" }, "当前预设：" + presetName)
				);
			}

			// 暂时保留自研手机实现，但不从产品界面挂载；现阶段优先兼容人物卡自带手机。
			function TavernPhone(props) {
				const h = React.createElement;
				const [page, setPage] = React.useState("home");
				const [contactId, setContactId] = React.useState("");
				const [draft, setDraft] = React.useState("");
				const [busy, setBusy] = React.useState(false);
				const [phone, setPhone] = React.useState(props.view.phoneChat || { contacts: [], threads: [] });
				const [optimistic, setOptimistic] = React.useState("");
				const messagesRef = React.useRef(null);
				React.useEffect(function () { setPhone(props.view.phoneChat || { contacts: [], threads: [] }); }, [props.view.phoneChat]);
				const contacts = Array.isArray(phone.contacts) ? phone.contacts : [];
				const contact = contacts.find(function (item) { return item.id === contactId; }) || null;
				const thread = (Array.isArray(phone.threads) ? phone.threads : []).find(function (item) { return item.contactId === contactId; }) || { messages: [] };
				React.useEffect(function () {
					const element = messagesRef.current;
					if (element) element.scrollTop = element.scrollHeight;
				}, [contactId, thread.messages.length, optimistic, busy]);
				function clock() {
					const date = new Date();
					return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
				}
				function openContact(next) { setContactId(next.id); setPage("chat"); setDraft(""); }
				async function send() {
					const text = draft.trim();
					if (!contact || !text || busy) return;
					const requestId = "phone-" + Date.now() + "-" + Math.random().toString(36).slice(2);
					setDraft(""); setOptimistic(text); setBusy(true);
					try {
						const result = await rpc("sendPhoneMessage", { contactId: contact.id, text: text, requestId: requestId }, props.sessionId);
						setPhone(result.phoneChat || phone);
						setOptimistic("");
						liveTavernView.invalidate(props.sessionId);
					} catch (error) {
						setOptimistic("");
						tavernErrorHub.report("手机聊天", error);
						liveTavernView.invalidate(props.sessionId);
					} finally { setBusy(false); }
				}
				function timeLabel(value) {
					if (!value) return "";
					const date = new Date(value);
					return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
				}
				let content;
				if (page === "home") {
					content = h("div", { className: "dsh-tavern-phone-home" },
						h("button", { className: "dsh-tavern-phone-app", onClick: function () { setPage("contacts"); }, "aria-label": "打开消息" },
							h("span", { className: "dsh-tavern-phone-app-icon", "aria-hidden": "true" }),
							h("span", { className: "dsh-tavern-phone-app-label" }, "消息")
						)
					);
				} else if (page === "contacts") {
					content = h("div", { className: "dsh-tavern-phone-page" },
						h("div", { className: "dsh-tavern-phone-nav" }, h("button", { onClick: function () { setPage("home"); } }, "‹ 主屏"), h("strong", null, "消息"), h("span", null)),
						contacts.length ? h("div", { className: "dsh-tavern-phone-contact-list" }, contacts.map(function (item) {
							const itemThread = (phone.threads || []).find(function (value) { return value.contactId === item.id; }) || {};
							return h("button", { key: item.id, className: "dsh-tavern-phone-contact", onClick: function () { openContact(item); } },
								h("span", { className: "dsh-tavern-phone-avatar" }, item.name.slice(0, 1)),
								h("span", { className: "dsh-tavern-phone-contact-copy" }, h("span", { className: "dsh-tavern-phone-contact-name" }, item.name), h("span", { className: "dsh-tavern-phone-contact-preview" }, itemThread.preview || (item.main ? "开始聊天" : "尚无消息"))),
								h("time", { className: "dsh-tavern-phone-contact-time" }, timeLabel(itemThread.updatedAt))
							);
						})) : h("div", { className: "dsh-tavern-phone-empty" }, "暂时没有可聊天的人物。人物卡主角或后台建立的人物设计会出现在这里。")
					);
				} else {
					const messages = Array.isArray(thread.messages) ? thread.messages : [];
					content = h("div", { className: "dsh-tavern-phone-page" },
						h("div", { className: "dsh-tavern-phone-nav" }, h("button", { onClick: function () { setPage("contacts"); } }, "‹ 消息"), h("strong", null, contact ? contact.name : "联系人"), h("span", null)),
						h("div", { ref: messagesRef, className: "dsh-tavern-phone-messages" },
							messages.length || optimistic ? messages.map(function (message) {
								return h("div", { key: message.id, className: "dsh-tavern-phone-bubble " + message.role + " " + message.status }, message.text, message.status === "failed" ? h("span", { className: "dsh-tavern-phone-message-error" }, message.error || "发送失败") : null);
							}).concat(optimistic ? [h("div", { key: "optimistic", className: "dsh-tavern-phone-bubble user pending" }, optimistic)] : []) : h("div", { className: "dsh-tavern-phone-empty" }, "发一条消息，开始这段独立私聊。")
						),
						h("div", { className: "dsh-tavern-phone-compose" },
							h("textarea", { rows: 1, value: draft, maxLength: 1200, disabled: busy || !contact, placeholder: busy ? "对方正在回复…" : "输入消息", onChange: function (event) { setDraft(event.target.value); }, onKeyDown: function (event) { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } } }),
							h("button", { disabled: busy || !contact || draft.trim() === "", onClick: send, "aria-label": "发送消息" }, busy ? "…" : "↑")
						)
					);
				}
				return h("aside", { className: "dsh-tavern-status dsh-tavern-phone-host" },
					h("div", { className: "dsh-tavern-phone-toolbar" }, h("button", { className: "dsh-tavern-phone-exit", onClick: props.onClose }, "退出手机视图")),
					h("div", { className: "dsh-tavern-phone-device" }, h("div", { className: "dsh-tavern-phone-island", "aria-hidden": "true" }), h("div", { className: "dsh-tavern-phone-screen" }, h("div", { className: "dsh-tavern-phone-statusbar" }, h("span", null, clock()), h("span", { className: "dsh-tavern-phone-status-icons" }, "▮▮ ᴡɪғɪ ▰")), content, h("div", { className: "dsh-tavern-phone-indicator", "aria-hidden": "true" })))
				);
			}

			function TavernStatusPanel(props) {
			const [error, setError] = usePersistentError("酒馆状态");
			const [guideDraft, setGuideDraft] = React.useState("");
			const [guideBusy, setGuideBusy] = React.useState(false);
			const [guideError, setGuideError] = usePersistentError("Guide");
			const [debugBusy, setDebugBusy] = React.useState(false);
			const [settlementRetryBusy, setSettlementRetryBusy] = React.useState(false);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const stateKey = String(running) + ":" + String(latestMessageId || "");
			const liveState = useLiveTavernView(props.sessionId, stateKey);
			const view = liveState.view;
			const loadState = liveState.phase;
			const missingCard = isMissingTavernCardError(liveState.error);
			const debugTurns = view && Array.isArray(view.debugTurns) ? view.debugTurns : [];
			const latestDebugTurn = Number(debugTurns[0] && debugTurns[0].turn) || 0;
			React.useEffect(function () {
				setError(missingCard ? "" : (liveState.error || ""));
			}, [liveState.error, missingCard]);
			async function openDebugger() {
				if (!latestDebugTurn || debugBusy) return;
				setDebugBusy(true);
				try { await openPlayChatDebugWorkspace(props.sessionId, latestDebugTurn); }
				catch (error) { tavernErrorHub.report("交给卡片 Agent 调试", error); }
				finally { setDebugBusy(false); }
			}
			async function addGuide() {
				const text = guideDraft.trim();
				if (!text) return;
				setGuideBusy(true); setGuideError("");
				try {
					await rpc("addGuide", { text: text }, props.sessionId);
					liveTavernView.invalidate(props.sessionId);
					setGuideDraft("");
				} catch (err) { setGuideError(String(err && err.message || err)); }
				finally { setGuideBusy(false); }
			}
			async function removeGuide(index) {
				setGuideBusy(true); setGuideError("");
				try {
					await rpc("deleteGuide", { index: index }, props.sessionId);
					liveTavernView.invalidate(props.sessionId);
				} catch (err) { setGuideError(String(err && err.message || err)); }
				finally { setGuideBusy(false); }
			}
			async function retrySettlement() {
				if (!view || settlementRetryBusy) return;
				setSettlementRetryBusy(true);
				try {
					await rpc("retrySettlement", { turn: view.settlementTurn }, props.sessionId);
					liveTavernView.invalidate(props.sessionId);
				} catch (retryError) { tavernErrorHub.report("重试后台结算", retryError); }
				finally { setSettlementRetryBusy(false); }
			}
			function characterDesignTime(ts) {
				if (!ts) return "";
				const date = new Date(ts);
				return (date.getMonth() + 1) + "/" + date.getDate() + " " + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
			}
			const h = React.createElement;
			if (!view) return h("aside", { className: "dsh-tavern-status" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "状态栏")),
				h("div", { className: "dsh-tavern-status-body" },
					h("div", { className: "dsh-tavern-status-empty" }, missingCard ? "人物卡已删除，酒馆状态不可用；已有对话仍可查看。" : (loadState === "retrying" ? "正在重新连接酒馆状态…" : (error || (loadState === "loading" ? "正在加载酒馆状态…" : "选择人物卡后，这里会显示持续状态。")))),
					loadState === "retrying" || missingCard ? h("button", { className: "dsh-tavern-btn", onClick: function () { liveTavernView.invalidate(props.sessionId); } }, "重新加载") : null
				)
			);
			if (view.mode === "card") return null;
			const statusText = view.settleStatus === "running" ? "正在执行后台结算" : (view.settleStatus === "error" ? "后台结算失败" : "后台结算已完成");
			return h("aside", { className: "dsh-tavern-status" },
				h("div", { className: "dsh-tavern-status-head" },
					h("div", { className: "dsh-tavern-status-title" }, "酒馆状态"),
					h("div", { className: "dsh-tavern-status-role" }, view.card.name),
					(view.card.tags || []).length ? h("div", { className: "dsh-tavern-status-tags" }, (view.card.tags || []).slice(0, 8).map(function (tag) { return h("span", { key: tag, className: "dsh-tavern-status-tag" }, tag); })) : null,
					h("div", { className: "dsh-tavern-status-settle" }, h("span", { className: "dsh-tavern-status-dot " + (view.settleStatus || "idle") }), statusText)
				),
					h("div", { className: "dsh-tavern-status-body" },
					h(TavernCardAppDock, { sessionId: props.sessionId }),
					view.settleStatus === "error" ? h("div", { className: "dsh-card-error" },
						h("div", null, view.settleError || "后台结算失败，请重试。"),
						h("button", { className: "dsh-tavern-btn", disabled: settlementRetryBusy, onClick: retrySettlement }, settlementRetryBusy ? "重试中…" : "重试后台结算")
					) : null,
					view.worldBookError ? h("div", { className: "dsh-card-error" }, "世界书召回失败：" + view.worldBookError) : null,
					view.foregroundError ? h("div", { className: "dsh-card-error" }, view.foregroundError.message || "前台正文生成失败，请重新生成本轮正文。") : null,
					view.tavernStatusView && view.tavernStatusView.content && view.tavernHelper ? h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "人物卡状态栏"),
						h(TavernPersistentStatusRuntime, { sessionId: props.sessionId, view: view })
					) : null,
					(view.presentationWarnings || []).map(function (warning, index) {
						return h("div", { className: "dsh-card-error", key: "presentation-warning-" + index }, warning);
					}),
					h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "正则加载不对？前端美化不对？内容生成不对？"),
						h("div", { className: "dsh-tavern-debug-panel" },
							h("button", { className: "dsh-tavern-debug-open", disabled: debugBusy || !latestDebugTurn, onClick: openDebugger }, debugBusy ? "正在打开卡片 Agent…" : "交给卡片 Agent 调试")
						)
					),
					view.mode === "script" && view.scriptProgress ? h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "剧本进度"),
						h("div", { className: "dsh-tavern-status-now" }, (view.scriptProgress.title || "剧本") + " · 游标 " + Math.min(view.scriptProgress.cursor + 1, view.scriptProgress.totalChunks) + "/" + view.scriptProgress.totalChunks + " · 已召回 " + view.scriptProgress.recalledCount + " 块")
					) : null,
					view.mode === "script" && view.scriptPreview ? h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "剧本预览"),
						h("div", { className: "dsh-tavern-script-preview" },
							(view.scriptPreview.upcoming || []).map(function (chunk, index) {
								return h("div", { key: chunk.id || index, className: "dsh-tavern-script-chunk" },
									h("span", { className: "dsh-tavern-script-chunk-label" }, (index === 0 ? "当前召回" : "后续") + " · 第 " + (chunk.order + 1) + " 块"),
									h("div", { className: "dsh-tavern-script-chunk-text" }, chunk.text)
								);
							})
						)
					) : null,
					h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "Guide（注入上下文）"),
						h("div", { className: "dsh-tavern-guide-list" },
							(view.guides || []).length ? (view.guides || []).map(function (guide, index) {
								return h("div", { key: guide.id || index, className: "dsh-tavern-guide-item" },
									h("div", { className: "dsh-tavern-guide-text" }, guide.text),
									h("button", { className: "dsh-tavern-worldbook-del", disabled: guideBusy, onClick: function () { removeGuide(index); } }, "删除")
								);
							}) : h("div", { className: "dsh-tavern-status-empty" }, "暂无 Guide。添加后会自动注入正文和候选项生成。")
						),
						h("div", { className: "dsh-tavern-guide-add" },
							h("textarea", { className: "dsh-tavern-regen-input", rows: 2, value: guideDraft, placeholder: "例如：多用短句，多写心理活动，对话不要超过三句", onChange: function (e) { setGuideDraft(e.target.value); } }),
							h("button", { className: "dsh-card-primary", disabled: guideBusy || guideDraft.trim() === "", onClick: addGuide }, guideBusy ? "保存中…" : "添加 Guide")
						),
						guideError ? h("div", { className: "dsh-card-error" }, guideError) : null
					),
					h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "人物设计档案（" + ((view.characterDesigns && view.characterDesigns.characters || []).length) + "）"),
						h("div", { className: "dsh-tavern-character-designs" },
							(view.characterDesigns && view.characterDesigns.characters || []).length ? view.characterDesigns.characters.map(function (character, index) {
								const summary = character.identity || character.narrativeRole || "已建立完整人物设计";
								const aliases = Array.isArray(character.aliases) && character.aliases.length ? character.aliases.join("、") : "";
								return h("details", { key: character.name || index, className: "dsh-tavern-character-design" },
									h("summary", null,
										h("span", null,
											h("span", { className: "dsh-tavern-character-design-name" }, character.name),
											h("span", { className: "dsh-tavern-character-design-summary", title: summary }, summary)
									),
									character.updatedAt ? h("time", { className: "dsh-tavern-character-design-meta", dateTime: new Date(character.updatedAt).toISOString() }, characterDesignTime(character.updatedAt)) : h("span", { className: "dsh-tavern-character-design-meta" }, "查看")
								),
									h("div", { className: "dsh-tavern-character-design-body" },
										aliases ? h("div", { className: "dsh-tavern-character-design-row" }, h("b", null, "别名"), h("p", null, aliases)) : null,
										(character.sections || []).map(function (section) {
											return h("div", { key: section.key, className: "dsh-tavern-character-design-row" }, h("b", null, section.label), h("p", null, section.text));
										})
									)
								);
							}) : h("div", { className: "dsh-tavern-status-empty" }, "后台发现重要人物需要补全设计后，档案会自动出现在这里。")
						)
					),
					h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "人物姿势"),
						view.posture ? h("div", { className: "dsh-tavern-status-now" }, view.posture) : h("div", { className: "dsh-tavern-status-empty" }, "等待第一轮状态结算")
					)
				)
			);
		}

		function TavernCardAppDock(props) {
			const slotRef = React.useRef(null);
			const controllerRef = React.useRef(null);
			const presence = React.useSyncExternalStore(tavernCardAppPresence.subscribe, tavernCardAppPresence.inspect);
			React.useEffect(function () {
				if (!slotRef.current) return;
				const controller = createTavernCardAppDock({ document: document, slot: slotRef.current, sessionId: props.sessionId, onChange: tavernCardAppPresence.change });
				controllerRef.current = controller;
				return function () { controllerRef.current = null; controller.dispose(); };
			}, []);
			return React.createElement("section", { className: "dsh-tavern-status-section dsh-tavern-card-app-section", hidden: !presence.attached },
				React.createElement("div", { className: "dsh-tavern-card-app-head" },
					React.createElement("div", { className: "dsh-tavern-status-label" }, "人物卡应用"),
					React.createElement("button", { className: "dsh-tavern-btn", disabled: !presence.attached, onClick: function () { if (controllerRef.current) controllerRef.current.open(); } }, presence.attached ? "打开手机" : "恢复中…")
				),
				presence.recovering ? React.createElement("div", { className: "dsh-tavern-card-app-recovering", role: "status" }, "正在恢复人物卡应用…") : null,
				React.createElement("div", { ref: slotRef, className: "dsh-tavern-card-app-slot" })
			);
		}

		function TavernStatusTab(props) {
			const binding = React.useSyncExternalStore(
				function (listener) { return props.sessions.list.subscribe(listener); },
				function () { return props.sessions.binding(props.sessionId); },
				function () { return props.sessions.binding(props.sessionId); }
			);
			const h = React.createElement;
			if (!binding) return h("aside", { className: "dsh-tavern-status" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "酒馆状态")),
				h("div", { className: "dsh-tavern-status-body" }, h("div", { className: "dsh-tavern-status-empty" }, "正在连接当前会话…"))
			);
			function useSession(selector) {
				return React.useSyncExternalStore(
					function (listener) { return binding.session.subscribe(listener); },
					function () { return selector(binding.session.getSnapshot()); },
					function () { return selector(binding.session.getSnapshot()); }
				);
			}
			const chat = resolveConversationChatBinding(props.uiConversation, binding);
			function useChat(selector) {
				return React.useSyncExternalStore(
					function (listener) { return chat.subscribe(listener); },
					function () { return selector(chat.getSnapshot()); },
					function () { return selector(chat.getSnapshot()); }
				);
			}
			return h(TavernStatusPanel, { sessionId: props.sessionId, useSession: useSession, useChat: useChat });
		}

		const candidatePanel = { value: null, listeners: new Set() };
		function setCandidatePanel(value) {
			candidatePanel.value = value;
			candidatePanel.listeners.forEach(function (listener) { listener(value); });
		}
		function useCandidatePanel() {
			const [value, setValue] = React.useState(candidatePanel.value);
			React.useEffect(function () { candidatePanel.listeners.add(setValue); return function () { candidatePanel.listeners.delete(setValue); }; }, []);
			return value;
		}
		function readyCandidatePanel(sessionId, messageId, candidates) {
			const value = candidates && typeof candidates === "object" ? candidates : {};
			return {
				sessionId: sessionId,
				messageId: messageId,
				phase: "ready",
				choices: Array.isArray(value.choices) ? value.choices : [],
				traceSessionId: String(value.traceSessionId || ""),
				traceMode: value.traceMode === "continuable" ? "continuable" : "one-shot",
				error: ""
			};
		}
		function candidateRequestId() { return "candidate-request-" + Date.now() + "-" + Math.random().toString(36).slice(2); }
		async function submitCandidateTask(sessionId, messageId, guidance) {
			const requestId = candidateRequestId();
			let lastError = null;
			for (let attempt = 0; attempt < 3; attempt += 1) {
				const controller = new AbortController();
				const timer = window.setTimeout(function () { controller.abort(); }, 2000);
				try {
					const result = await rpc("submitTask", { kind: "candidate", requestId: requestId, messageId: messageId, guidance: guidance || "" }, sessionId, { signal: controller.signal });
					const view = coordinationView(result, sessionId);
					tavernCoordination.setView(sessionId, view);
					return view.task;
				} catch (error) {
					lastError = error;
					const message = String(error && error.message || "");
					if (!(error && error.name === "AbortError") && !/failed to fetch|networkerror|signal timed out/i.test(message)) throw error;
				} finally { window.clearTimeout(timer); }
				await new Promise(function (resolve) { window.setTimeout(resolve, 250); });
			}
			tavernCoordination.invalidate(sessionId);
			throw lastError || new Error("持久任务提交失败");
		}

		const regenPanel = { value: null, listeners: new Set() };
		function setRegenPanel(value) {
			regenPanel.value = value;
			regenPanel.listeners.forEach(function (listener) { listener(value); });
		}
		function useRegenPanel() {
			const [value, setValue] = React.useState(regenPanel.value);
			React.useEffect(function () { regenPanel.listeners.add(setValue); return function () { regenPanel.listeners.delete(setValue); }; }, []);
			return value;
		}

		const candidateGuidePanel = { value: null, listeners: new Set() };
		function setCandidateGuidePanel(value) {
			candidateGuidePanel.value = value;
			candidateGuidePanel.listeners.forEach(function (listener) { listener(value); });
		}
		function useCandidateGuidePanel() {
			const [value, setValue] = React.useState(candidateGuidePanel.value);
			React.useEffect(function () { candidateGuidePanel.listeners.add(setValue); return function () { candidateGuidePanel.listeners.delete(setValue); }; }, []);
			return value;
		}

		async function submitBodyRegeneration(sessionId, panel, guidance) {
			const res = await rpc("regenBody", { guidance: String(guidance || "").trim() }, sessionId);
			applyBodyRegenerationResult({ liveTavernView: liveTavernView, historyProjection: historyProjection, sessionId: sessionId, view: res.view, tail: panel.tail });
			setCandidatePanel(null);
		}

		function CandidateAction(props) {
			const [busy, setBusy] = React.useState(false);
			const candidatePanelState = useCandidatePanel();
			const regenPanelState = useRegenPanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const frontRunning = props.useSession(function (snapshot) { return snapshot.running === true; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const rollbackViewState = useLiveTavernView(props.sessionId, String(frontRunning) + ":" + String(latestMessageId || ""));
			const activityState = useTavernCoordination(props.sessionId, String(frontRunning) + ":" + String(latestMessageId || ""));
			const activity = describeTavernActivity(activityState.view && activityState.view.activity);
			const settlementActive = activity.role === "settlement" && (activity.phase === "pending" || activity.phase === "running");
			const canRollback = rollbackViewState.view && rollbackViewState.view.canRollback === true;
			const candidateTask = activityState.view && activityState.view.task;
			const taskForMessage = candidateTask && candidateTask.kind === "candidate" && candidateTask.input && String(candidateTask.input.messageId || "") === String(props.messageId || "") ? candidateTask : null;
			const taskBusy = !!(taskForMessage && taskForMessage.busy);
			const regenBusy = regenPanelState !== null && regenPanelState.sessionId === props.sessionId && regenPanelState.phase === "loading";
			const projectedTaskRef = React.useRef("");
			React.useEffect(function () {
				if (!taskForMessage) return;
				const projection = String(taskForMessage.taskId || "") + ":" + String(taskForMessage.version || 0) + ":" + String(taskForMessage.status || "");
				if (projectedTaskRef.current === projection) return;
				projectedTaskRef.current = projection;
				if (taskForMessage.busy) {
					setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "loading", choices: [], error: "" });
					return;
				}
				if (taskForMessage.status === "succeeded" && taskForMessage.result && taskForMessage.result.candidates) {
					setCandidatePanel(readyCandidatePanel(props.sessionId, props.messageId, taskForMessage.result.candidates));
					setCandidateGuidePanel(null);
					return;
				}
				if (taskForMessage.terminal) {
					setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "error", choices: [], error: String(taskForMessage.error || "候选生成未完成") });
				}
			}, [props.sessionId, props.messageId, taskForMessage && taskForMessage.taskId, taskForMessage && taskForMessage.version, taskForMessage && taskForMessage.status]);
			const reconciledActivityRef = React.useRef("");
			React.useEffect(function () {
				if (!activityState.view || activity.busy) return;
				const revision = activity.phase + ":" + String(activityState.view.updatedAt || 0);
				if (reconciledActivityRef.current === revision) return;
				reconciledActivityRef.current = revision;
				liveTavernView.invalidate(props.sessionId);
				if (typeof props.refreshSessions === "function") Promise.resolve(props.refreshSessions()).catch(function () {});
			}, [props.sessionId, props.refreshSessions, activity.phase, activity.busy, activityState.view && activityState.view.updatedAt]);
			async function generate(force, guidance) {
				if (busy || activity.busy) return;
				setBusy(true);
				setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "loading", choices: [], error: "" });
				try {
					await submitCandidateTask(props.sessionId, props.messageId, guidance);
				} catch (err) { tavernErrorHub.report("候选项生成", err); setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "error", choices: [], error: String(err && err.message || err) }); }
				finally { setBusy(false); liveTavernView.invalidate(props.sessionId); tavernCoordination.invalidate(props.sessionId); }
			}
			function regenerationPanelFor(event, phase) {
				const tail = event && event.currentTarget ? event.currentTarget.closest('[data-chat-flow-kind="turn-tail"]') : null;
				return { sessionId: props.sessionId, phase: phase, guidance: "", text: "", error: "", tail: tail };
			}
			function openRegeneration(event) {
				if (!canRollback || frontRunning || (activity.busy && !settlementActive) || regenBusy) return;
				setCandidatePanel(null);
				setRegenPanel(regenerationPanelFor(event, "input"));
			}
			const h = React.createElement;
			const isScript = sessionMode === "script";
			const hasReadyPanel = candidatePanelState !== null && candidatePanelState.sessionId === props.sessionId && candidatePanelState.messageId === props.messageId && candidatePanelState.phase === "ready";
			const hasLoadingPanel = candidatePanelState !== null && candidatePanelState.sessionId === props.sessionId && candidatePanelState.messageId === props.messageId && candidatePanelState.phase === "loading";
			if (!isPlayMode(sessionMode) || latestMessageId !== props.messageId) return null;
			return h(React.Fragment, null,
				h("button", { className: "dsh-tavern-choice-trigger", disabled: busy || taskBusy || activity.busy || settlementActive || regenBusy, title: settlementActive ? "当前正文正在后台结算，请等待完成" : (activity.busy ? activity.blockReason : (hasReadyPanel ? "重新生成候选项（可先填写意见）" : (isScript ? "手动生成候选项；由于跟随剧本，只有一个推荐候选项" : "手动生成候选项"))), onClick: function () {
					setRegenPanel(null);
					if (hasReadyPanel) {
						const previous = candidatePanelState;
						setCandidatePanel(null);
						setCandidateGuidePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "input", error: "", previous: previous });
					} else {
						generate(false);
					}
				} }, settlementActive ? "后台结算中…" : (activity.busy ? activity.label : ((busy || taskBusy) ? "生成中…" : (hasReadyPanel ? "重新生成候选项" : "生成候选项")))),
				canRollback ? h("button", { className: "dsh-tavern-choice-trigger", disabled: frontRunning || (activity.busy && !settlementActive) || regenBusy, title: settlementActive ? "重新生成将取消当前正文的后台结算" : (activity.busy ? activity.blockReason : "可选择填写意见，再重新生成并替换当前正文"), onClick: openRegeneration }, regenBusy ? "重生成中…" : "重新生成正文") : null
			);
		}

		function TavernRollbackAction(props) {
			const [rolling, setRolling] = React.useState(false);
			const regenPanelState = useRegenPanel();
			const frontRunning = props.useSession(function (snapshot) { return snapshot.running === true; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const rollbackViewState = useLiveTavernView(props.sessionId, "rollback:" + String(frontRunning) + ":" + String(latestMessageId || ""));
			const activityState = useTavernCoordination(props.sessionId, "rollback:" + String(frontRunning) + ":" + String(latestMessageId || ""));
			const activity = describeTavernActivity(activityState.view && activityState.view.activity);
			const settlementActive = activity.role === "settlement" && (activity.phase === "pending" || activity.phase === "running");
			const canRollback = rollbackViewState.view && rollbackViewState.view.canRollback === true;
			const regenBusy = regenPanelState !== null && regenPanelState.sessionId === props.sessionId && regenPanelState.phase === "loading";
			const blocked = rolling || frontRunning || regenBusy || activity.busy || settlementActive;
			async function rollback() {
				if (!canRollback || blocked) return;
				if (!window.confirm("回退本轮？\n将删除你最近一次输入和这段 LLM 输出，并同步回退故事状态与剧本游标。")) return;
				setRolling(true);
				try {
					const result = await rpc("rollbackTurn", {}, props.sessionId);
					historyProjection.rolledBack(props.sessionId, result && result.view);
					setCandidatePanel(null);
					setRegenPanel(null);
					setCandidateGuidePanel(null);
					notifyTavernDataChanged(["sessions"], "play-controls");
					if (result && result.view && result.view.rollbackWarning) tavernErrorHub.report("回退脚本联动", new Error(result.view.rollbackWarning));
				} catch (err) {
					tavernErrorHub.report("回退本轮", err);
				} finally { setRolling(false); liveTavernView.invalidate(props.sessionId); tavernCoordination.invalidate(props.sessionId); }
			}
			if (!canRollback) return null;
			return React.createElement("button", { className: "danger", role: "menuitem", disabled: blocked, title: blocked ? "请等待当前生成或后台处理完成后再回退" : "删除最近一次用户输入和这段 LLM 输出", onClick: rollback }, rolling ? "回退中…" : "回退本轮");
		}

		function TavernMoreActions(props) {
			const [open, setOpen] = React.useState(false);
			const root = React.useRef(null);
			React.useEffect(function () {
				if (!open) return;
				function closeOutside(event) { if (!root.current || !root.current.contains(event.target)) setOpen(false); }
				function closeOnEscape(event) { if (event.key === "Escape") setOpen(false); }
				document.addEventListener("pointerdown", closeOutside, true);
				document.addEventListener("keydown", closeOnEscape);
				return function () { document.removeEventListener("pointerdown", closeOutside, true); document.removeEventListener("keydown", closeOnEscape); };
			}, [open]);
			return React.createElement("div", { className: "dsh-tavern-more-actions", ref: root },
				React.createElement("button", { type: "button", className: "dsh-tavern-choice-trigger", "aria-haspopup": "menu", "aria-expanded": open, onClick: function () { setOpen(function (value) { return !value; }); } }, "更多 ▾"),
				React.createElement("div", { className: "dsh-tavern-more-menu", role: "menu", hidden: !open, onClick: function (event) { if (event.target && event.target.closest && event.target.closest("button:not(:disabled)")) setOpen(false); } },
					React.createElement(TavernRollbackAction, props),
					React.createElement(TavernCompactionAction, Object.assign({}, props, { inMenu: true })))
			);
		}

		function CandidateDockActions(props) {
			const sessionMode = useTavernSessionMode(props.sessionId);
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const running = props.useSession(function (snapshot) { return snapshot.running === true; });
			const live = useLiveTavernView(props.sessionId, String(running) + ":" + String(latestMessageId || ""));
			const imageTurn = live.view && Array.isArray(live.view.replyProjections) ? live.view.replyProjections.reduce(function (latest, item) { return Math.max(latest, Number(item.turn) || 0); }, 0) : 0;
			const h = React.createElement;
			if (!sessionMode) return null;
			return h("div", { className: "dsh-tavern-dock-actions" },
				isPlayMode(sessionMode) && latestMessageId ? React.createElement(CandidateAction, Object.assign({}, props, { messageId: latestMessageId })) : null,
				isPlayMode(sessionMode) && live.view && live.view.releaseCapabilities && live.view.releaseCapabilities.sceneImages ? React.createElement(SceneImageAction, { key: props.sessionId + ":" + imageTurn, sessionId: props.sessionId, turn: imageTurn, running: running }) : null,
				isPlayMode(sessionMode) ? React.createElement(TavernMoreActions, props) : React.createElement(TavernCompactionAction, props)
			);
		}

		function SupersededTurnErrors(props) {
			const marker = React.useRef(null);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const state = useLiveTavernView(props.sessionId, "suppression:" + String(latestMessageId || "") + ":" + String(running));
			const turns = state.view && state.view.suppressedDshErrorTurns || [];
			const revision = turns.join(",");
			React.useEffect(function () {
				const root = marker.current && marker.current.closest("[data-conversation-scroll]");
				if (!root) return;
				const projection = createSupersededErrorProjection(root);
				const apply = function () { projection.apply(turns); };
				apply();
				const observer = new window.MutationObserver(apply);
				observer.observe(root, { childList: true, subtree: true });
				return function () { observer.disconnect(); projection.dispose(); };
			}, [props.sessionId, revision]);
			return React.createElement("span", { ref: marker, hidden: true, "data-tavern-error-projection": props.sessionId });
		}
		function TurnHistoryProjection(props) {
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const suppressionState = useLiveTavernView(props.sessionId, "suppression:" + String(latestMessageId || "") + ":" + String(running));
			const suppressedDshTurns = suppressionState.view && Array.isArray(suppressionState.view.suppressedDshTurns) ? suppressionState.view.suppressedDshTurns : [];
			const suppressedDshTurnsRevision = suppressedDshTurns.join(",");
			const regeneratedDshTurns = suppressionState.view && suppressionState.view.regeneratedDshTurns || {};
			const regeneratedDshTurnsRevision = JSON.stringify(regeneratedDshTurns);
			React.useEffect(function () {
				let frame = null;
				function applyProjectionState() {
					frame = null;
					historyProjection.apply(props.sessionId, suppressedDshTurns, regeneratedDshTurns);
				}
				function scheduleProjection() {
					if (frame === null) frame = window.requestAnimationFrame(applyProjectionState);
				}
				scheduleProjection();
				const observer = new window.MutationObserver(scheduleProjection);
				observer.observe(document.body, { childList: true, subtree: true });
				return function () { observer.disconnect(); if (frame !== null) window.cancelAnimationFrame(frame); };
			}, [props.sessionId, latestMessageId, running, suppressedDshTurnsRevision, regeneratedDshTurnsRevision]);
			return null;
		}
		function CandidateQuestion(props) {
			const panel = useCandidatePanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const [selected, setSelected] = React.useState(-1);
			const [expanded, setExpanded] = React.useState(false);
			React.useEffect(function () {
				setSelected(sessionMode === "script" && panel && Array.isArray(panel.choices) && panel.choices.length === 1 ? 0 : -1);
				setExpanded(panel !== null && panel.phase === "error");
			}, [panel, sessionMode]);
			if (panel && panel.sessionId === props.sessionId && panel.phase === "error") {
				return React.createElement("div", { className: "dsh-tavern-choice-error dsh-tavern-candidate-error-banner" },
					"候选项生成失败：" + (panel.error || "未知错误") + "。请点上方“生成候选项”重试。"
				);
			}
			if (!isPlayMode(sessionMode) || !panel || panel.sessionId !== props.sessionId || panel.messageId !== latestMessageId || running) {
				return null;
			}
			const h = React.createElement;
			const count = (panel.choices || []).length;
			const isScript = sessionMode === "script";
			const heading = "接下来的行动";
			const summary = panel.phase === "loading" ? "正在生成…" : (panel.error ? "生成失败" : (isScript ? "1 个候选 · 跟随剧本，只有一个推荐候选项" : count + " 个候选项"));
			return h("div", { className: "dsh-tavern-question dsh-tavern-candidate-question" + (expanded ? "" : " collapsed") },
				h("div", { className: "dsh-tavern-question-head", onClick: function () { setExpanded(!expanded); } }, h("span", null, heading), h("span", { className: "dsh-tavern-question-sub" }, summary), h("button", { className: "dsh-tavern-question-close", title: expanded ? "收起" : "展开", onClick: function (event) { event.stopPropagation(); setExpanded(!expanded); } }, expanded ? "⌃" : "⌄")),
				expanded && panel.phase === "loading" ? h("div", { className: "dsh-tavern-question-sub" }, "正在生成候选项…") : null,
				expanded && panel.error ? h("div", { className: "dsh-tavern-choice-error" }, "候选项生成失败，请点回复下方的“生成候选项”重试") : null,
				expanded ? h("div", { className: "dsh-tavern-question-body" }, (panel.choices || []).map(function (choice, index) {
					const item = choice !== null && typeof choice === "object" ? choice : { type: "action", text: String(choice) };
					const label = item.type === "scene" ? "场景变化" : "人物行为";
					return h("button", { key: index, className: "dsh-tavern-question-option" + (selected === index ? " selected" : ""), onClick: function () { setSelected(index); } },
						h("span", { className: "dsh-tavern-question-radio" }),
						h("span", { className: "dsh-tavern-question-text" },
							h("span", { className: "dsh-tavern-question-tag dsh-tavern-question-tag-" + item.type }, label),
							h("span", null, item.text)
						)
					);
				})) : null,
				expanded && panel.phase === "ready" ? h("button", { className: "dsh-tavern-question-free", onClick: function () {
					window.requestAnimationFrame(function () {
						const input = document.querySelector("[data-composer-card] textarea");
						if (input) input.focus();
					});
				} }, "✎ 自由行动（直接在下方输入）") : null,
				expanded && panel.phase === "ready" && panel.traceSessionId ? h("button", { className: "dsh-tavern-question-free", title: panel.traceMode === "continuable" ? "打开持续存在的后台 Agent" : "打开后台候选任务的推理与工具调用记录", onClick: async function () {
					try {
						await props.sessions.refreshSubagents(panel.sessionId);
						props.sessions.openSubagent({ parentSessionId: panel.sessionId, childSessionId: panel.traceSessionId, mode: panel.traceMode });
					} catch (err) {
						tavernErrorHub.report("后台 Agent 轨迹", "无法打开后台 Agent 轨迹：" + String(err && err.message || err));
					}
				} }, panel.traceMode === "continuable" ? "查看后台 Agent" : "查看后台候选任务轨迹") : null,
				expanded && panel.phase === "ready" && panel.choices && panel.choices.length ? h("div", { className: "dsh-tavern-question-foot" },
					h("button", { className: "dsh-tavern-question-primary", disabled: selected < 0, onClick: function () {
						if (selected < 0) return;
						const item = panel.choices[selected];
						const choice = item !== null && typeof item === "object" ? item : { type: "action", text: String(item) };
						const marked = choice.type === "scene" ? "【场景变化】" + choice.text : choice.text;
						props.inputActions.setDraft(marked);
						setCandidatePanel(null);
					} }, "填入输入框")
				) : null
			);
		}

		function CandidateGuidePanel(props) {
			const panel = useCandidateGuidePanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const [guidance, setGuidance] = React.useState("");
			const h = React.createElement;
			if (!isPlayMode(sessionMode) || running || !panel || panel.sessionId !== props.sessionId || panel.messageId !== latestMessageId) {
				return null;
			}
			const isScript = sessionMode === "script";
			async function generateGuided() {
				const guide = guidance.trim();
				const messageId = panel.messageId;
				setCandidateGuidePanel({ sessionId: props.sessionId, messageId: messageId, phase: "loading", error: "", previous: panel.previous });
				try {
					setCandidatePanel({ sessionId: props.sessionId, messageId: messageId, phase: "loading", choices: [], error: "" });
					await submitCandidateTask(props.sessionId, messageId, guide);
					setCandidateGuidePanel(null);
				} catch (err) {
					tavernErrorHub.report("候选项重新生成", err);
					setCandidateGuidePanel({ sessionId: props.sessionId, messageId: messageId, phase: "input", error: String(err && err.message || err), previous: panel.previous });
				}
			}
			function cancel() {
				setCandidateGuidePanel(null);
				if (panel.previous) setCandidatePanel(panel.previous);
			}
			const body = panel.phase === "loading"
				? h("div", { className: "dsh-tavern-question-sub" }, "正在重新生成候选项…")
				: h(React.Fragment, null,
					panel.error ? h("div", { className: "dsh-tavern-choice-error" }, panel.error) : null,
					h("textarea", {
						className: "dsh-tavern-regen-input",
						rows: 2,
						value: guidance,
						placeholder: isScript ? "对候选的要求（可选）：例如“侧重角色行动”“直接开新场景”" : "对候选的要求（可选）：例如“多点暧昧动作”“场景换到白天户外”“新场景换一批人物”",
						onChange: function (e) { setGuidance(e.target.value); }
					}),
					h("div", { className: "dsh-tavern-question-foot" },
						h("button", { className: "dsh-tavern-question-primary", disabled: panel.phase === "loading", onClick: generateGuided }, "按此意见重新生成"),
						h("button", { className: "dsh-tavern-question-free", onClick: cancel }, "取消")
					)
				);
			return h("div", { className: "dsh-tavern-question" },
				h("div", { className: "dsh-tavern-question-head" }, h("span", null, "重新生成候选项"), h("span", { className: "dsh-tavern-question-sub" }, isScript ? "可填写意见；由于跟随剧本，只会重新生成一个推荐候选项" : "可填写意见，行动候选与场景候选通用")),
				body
			);
		}

		function RegenPanel(props) {
			const panel = useRegenPanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const [guidance, setGuidance] = React.useState("");
			const h = React.createElement;
			if (!isPlayMode(sessionMode) || running || !panel || panel.sessionId !== props.sessionId) return null;
			async function generate() {
				const guide = guidance.trim();
				setRegenPanel(Object.assign({}, panel, { phase: "loading", error: "" }));
				try {
					await submitBodyRegeneration(props.sessionId, panel, guide);
					setRegenPanel(null);
				} catch (err) {
					tavernErrorHub.report("正文重新生成", err);
					setRegenPanel(Object.assign({}, panel, { phase: "error", error: String(err && err.message || err) }));
				}
			}
			const body = panel.phase === "loading"
				? h("div", { className: "dsh-tavern-question-sub" }, "正在重新生成正文…")
				: h(React.Fragment, null,
						panel.error ? h("div", { className: "dsh-tavern-choice-error" }, panel.error) : null,
						h("textarea", {
							className: "dsh-tavern-regen-input",
							rows: 2,
							value: guidance,
							placeholder: "指导意见（可选）：例如“写得更长，侧重心理描写”",
							onChange: function (e) { setGuidance(e.target.value); }
						}),
						h("div", { className: "dsh-tavern-question-foot" },
							h("button", { className: "dsh-tavern-question-primary", disabled: panel.phase === "loading", onClick: generate }, "生成并替换正文"),
							h("button", { className: "dsh-tavern-question-free", onClick: function () { setRegenPanel(null); } }, "取消")
						)
					);
			return h("div", { className: "dsh-tavern-question" },
				h("div", { className: "dsh-tavern-question-head" }, h("span", null, "重新生成正文"), h("span", { className: "dsh-tavern-question-sub" }, "生成后直接替换当前正文")),
				body
			);
		}
		function register(input) {
			const ctx = input.ctx;
			const slots = input.slots;
			const uiConversation = ctx.get("uiConversation") || ctx.get("conversation");
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:status",
				title: "酒馆状态",
				order: 7,
				single: true,
				createTab: function () {
					return { tab: { id: "dsh-tavern:status", type: "dsh-tavern:status", title: "酒馆状态" }, patch: { panelOpen: true } };
				},
				component: function (props) {
					return React.createElement(TavernStatusTab, { sessions: ctx.sessions, uiConversation: uiConversation, sessionId: props.scope.sessionId });
				}
			}), "dsh-tavern: Better Sidebar status tab");
			ctx.effect(() => slots.inject("conversation.session.header.actions", () => slots.register(
				{ name: "conversation.session.header.actions", id: "dsh-tavern-player-name", order: 15 },
				TavernPlayerNameAction
			)), "dsh-tavern: player name header action");
			ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
				{ name: "conversation.session.header.utilities", id: "dsh-tavern-conversation-export", order: 90 },
				function (props) { return React.createElement(TavernConversationExportAction, Object.assign({}, props, { sessions: ctx.sessions })); }
			)), "dsh-tavern: conversation text export utility");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-candidate-actions", order: -130, label: "候选项操作" },
				function (props) { return React.createElement(CandidateDockActions, Object.assign({}, props, {
					refreshSessions: function () { return typeof ctx.sessions.refresh === "function" ? ctx.sessions.refresh() : Promise.resolve(); },
					executeCompact: function (sessionId) { return ctx.remote.commands.execute(sessionId, "/compact", []); }
				})); }
			)), "dsh-tavern: candidate dock actions");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-question", order: -120, label: "下一步行动" },
				function (props) { return React.createElement(React.Fragment, null,
					React.createElement(SupersededTurnErrors, Object.assign({}, props, { key: props.sessionId })),
					React.createElement(TurnHistoryProjection, Object.assign({}, props, { key: "history:" + props.sessionId })),
					React.createElement(CandidateQuestion, Object.assign({}, props, { sessions: ctx.sessions }))
				); }
			)), "dsh-tavern: candidate question panel");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-candidate-guide", order: -115, label: "重新生成候选项" },
				function (props) { return React.createElement(CandidateGuidePanel, props); }
			)), "dsh-tavern: candidate guide panel");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-regen", order: -110, label: "重新生成正文" },
				function (props) { return React.createElement(RegenPanel, props); }
			)), "dsh-tavern: regen body panel");
		}
		return Object.freeze({ register: register });
		}
		const playControlsFeature = createPlayControlsFeatureModule();
		const assistantRendererFeature = createTavernAssistantRendererFeatureModule();

		const inject = ["slots", "sessions", "workspaces", "layout", "connection", "conversation", "betterSidebar", "remote", "remote.commands", "tavernSessionSignals"];

		function apply(ctx) {
			const slots = ctx.slots;
			if (slots === undefined) return;
			const signals = ctx.tavernSessionSignals;
			if (!signals || typeof signals.subscribe !== "function") throw new Error("DSH Tavern Remote 状态流不可用");
			tavernSessionSignals = signals;
			ctx.effect(function () { return function () { if (tavernSessionSignals === signals) tavernSessionSignals = undefined; }; }, "dsh-tavern: remote session signals");
			ctx.effect(function () { return tavernRuntimeGenerationMonitor.start(); }, "dsh-tavern: runtime generation monitor");
			function reconcileLibraryTabTitles() {
				if (!ctx.betterSidebar || typeof ctx.betterSidebar.getSnapshot !== "function" || typeof ctx.betterSidebar.updateTab !== "function") return;
				const snapshot = ctx.betterSidebar.getSnapshot();
				const state = snapshot.state;
				if (!state) return;
				const retiredTabs = [];
				const expectedTitles = {
					"dsh-tavern:user-profile": "用户画像",
					"dsh-tavern:cards": "人物卡库",
					"dsh-tavern:presets": "预设库",
					"dsh-tavern:worldbooks": "世界书库",
					"dsh-tavern:resources": "剧本库"
				};
				function visit(node) {
					if (!node) return;
					if (node.kind === "split") {
						(node.children || []).forEach(visit);
						return;
					}
					(node.tabs || []).forEach(function (tab) {
						if (tab.type === "dsh-tavern:boundary-prompts" || tab.type === "dsh-tavern:bypass-plans") { retiredTabs.push(tab.id); return; }
						const title = expectedTitles[tab.type];
						if (title && tab.title !== title) ctx.betterSidebar.updateTab(tab.id, { title: title });
					});
				}
				visit(state.splits);
				visit(state.bottomSplits);
				if (typeof ctx.betterSidebar.closeTab === "function") retiredTabs.forEach(function (tabId) { ctx.betterSidebar.closeTab(tabId, snapshot.sessionId ? { sessionId: snapshot.sessionId } : undefined); });
			}
			function appendMention(sessionId, kind, path, label) {
				try {
					const actx = ctx.sessions.scope(sessionId);
					const conversation = ctx.get("conversation");
					if (!actx || !conversation) throw new Error("当前对话输入框不可用");
					const input = conversation.input.for(actx);
					const safePath = String(path || "").replace(/\\/g, "/").replace(/["\r\n]/g, "");
					const safeLabel = String(label || safePath.split("/").pop() || "世界书").replace(/[\]\r\n]/g, "");
					const mention = kind === "worldbook" ? "@[" + safeLabel + "](tavern-worldbook:" + encodeURIComponent(safePath) + ")" : "@\"" + safePath + "\"";
					const draft = input.state.getSnapshot().draft;
					input.setDraft(draft.trim() === "" ? mention : draft + (/\s$/.test(draft) ? "" : " ") + mention);
				} catch (err) {
					console.warn("dsh-tavern: resource mention failed", err);
					tavernErrorHub.report("在对话中引用", err);
				}
			}
			async function injectTaskPrompt(sessionId, task, label, card, hasInitialResources) {
				const actx = ctx.sessions.scope(sessionId);
				const conversation = ctx.get("conversation");
				if (!actx || !conversation) throw new Error("当前对话输入框不可用");
				const input = conversation.input.for(actx);
				const targetPath = card && card.path ? String(card.path).replace(/\\/g, "/").replace(/["\r\n]/g, "") : "";
				if (task === "mvu") {
					if (!targetPath) throw new Error("MVU 转换缺少目标人物卡");
					input.setDraft(
						"/tavern-card-to-mvu\n\n【目标人物卡】\n@\"" + targetPath + "\"\n\n" +
						"把这张人物卡转换为独立的 MVU 版本；保留剧情设定与状态栏视觉风格，同时移除原卡自带的候选项生成提示、按钮、正则和专用脚本，统一使用 DSH Tavern 内置候选项。"
					);
					return;
				}
				if (task === "user-profile") {
					input.setDraft(
						"/tavern-user-profile\n\n通过分批提问了解我的长期游玩与写作偏好。可以提供差异明确的参考选项，也允许我自由回答或跳过；信息足够后形成画像草案让我核对，只有我明确确认后才保存。"
					);
					return;
				}
				const result = await rpc("getCardTaskPrompt", { task: task }, sessionId);
				const draft = String(input.state.getSnapshot().draft || "");
				const supplement = draft;
				const targetSection = targetPath ? "\n\n【目标人物卡】\n@\"" + targetPath + "\"" : "";
				const resourceSection = hasInitialResources ? (task === "worldbook" || task === "preset" || task === "script" ? "\n\n【编辑目标】\n" : "\n\n【初始剧本】\n") : "";
				const taskText = "【卡片任务：" + label + "】" + targetSection + "\n\n" + String(result && result.text || "").trim() + resourceSection;
				input.setDraft(taskText + supplement);
			}
			playControlsFeature.register({ ctx: ctx, slots: slots });
			assistantRendererFeature.register({ ctx: ctx, slots: slots });
			ctx.effect(function () {
				return slots.inject("conversation.input.right", function () { return slots.register({
					name: "conversation.input.right",
					id: "dsh-tavern-background-model",
					order: 100
				}, function (props) { return React.createElement(TavernBackgroundModelLabel, Object.assign({}, props, { sessions: ctx.sessions })); }); });
			}, "dsh-tavern: background model label");
			ctx.effect(function () {
				return slots.inject("settings.section", function () { return slots.register({
					name: "settings.section",
					id: "dsh-tavern",
					order: 110,
					label: function () { return "DSH Tavern"; }
				}, TavernSettingsSection); });
			}, "dsh-tavern: settings section");
			ctx.effect(function () {
				const dispose = ctx.betterSidebar.registerTab({ id: "dsh-tavern:system-prompts", title: "系统提示词", order: 5, single: true, component: SystemPromptSidebarTab });
				return function () { if (typeof dispose === "function") dispose(); };
			}, "dsh-tavern: system prompt sidebar tab");
			userPreferenceProfileFeature.register({ ctx: ctx });
			presetLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
			resourcesLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
			worldBookLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
			cardLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
			ctx.effect(function () {
				reconcileLibraryTabTitles();
				if (typeof ctx.betterSidebar.subscribeState !== "function") return;
				return ctx.betterSidebar.subscribeState(reconcileLibraryTabTitles);
			}, "dsh-tavern: reconcile persisted library tab titles");
			ctx.effect(function () {
				function invalidateLiveView(event) { if (tavernDataChangeAffects(event, ["sessions", "cards", "presets", "worldbooks", "scripts"], "live-view")) liveTavernView.invalidate(); }
				window.addEventListener("dsh-tavern-data-changed", invalidateLiveView);
				return function () { window.removeEventListener("dsh-tavern-data-changed", invalidateLiveView); };
			}, "dsh-tavern: live Tavern view invalidation");
			tavernShellFeature.register({ ctx: ctx, slots: slots, appendMention: appendMention, injectTaskPrompt: injectTaskPrompt });
		}

		exports.TavernMessageFrame = TavernMessageFrame;
		exports.createTavernMessageFrameLifecycle = createTavernMessageFrameLifecycle;
		exports.createTavernScriptExecutionModule = createTavernScriptExecutionModule;
		exports.createTavernScriptSessionOwner = createTavernScriptSessionOwner;
		exports.createMvuBundleLoader = createMvuBundleLoader;
		exports.TavernMvuLoadRecovery = TavernMvuLoadRecovery;
		exports.apply = apply;
		exports.createTurnHistoryProjection = createTurnHistoryProjection;
		exports.createSupersededErrorProjection = createSupersededErrorProjection;
		exports.inject = inject;
		exports.buildOpeningPreviewDocument = buildOpeningPreviewDocument;
		exports.buildTavernFrameDocument = buildTavernFrameDocument;
		exports.createTavernHelperTransport = createTavernHelperTransport;
		exports.createTavernHelperEventBus = createTavernHelperEventBus;
		exports.buildTavernHelperScriptDocument = buildTavernHelperScriptDocument;
		exports.createTavernHostStylesheetBridge = createTavernHostStylesheetBridge;
		exports.createTavernCardAppPresence = createTavernCardAppPresence;
		exports.createTavernCardAppDock = createTavernCardAppDock;
		exports.createTavernHelperScriptRuntime = createTavernHelperScriptRuntime;
		exports.tavernScriptRuntimeReady = tavernScriptRuntimeReady;
		exports.clampTavernFrameHeight = clampTavernFrameHeight;
		exports.createTavernHelperContextUpdate = createTavernHelperContextUpdate;
		exports.applyTavernHelperContextUpdate = applyTavernHelperContextUpdate;
		exports.projectionPartsOf = projectionPartsOf;
		exports.tavernStoryTurnForDshTurn = tavernStoryTurnForDshTurn;
		exports.tavernMvuReceiptForTurn = tavernMvuReceiptForTurn;
		exports.tavernUserTextForTurn = tavernUserTextForTurn;
		exports.createTavernFrameSlashExecutor = createTavernFrameSlashExecutor;
		exports.createWorldBookLibraryRefreshModule = createWorldBookLibraryRefreshModule;
		exports.groupWorldBookEditorEntries = groupWorldBookEditorEntries;
		exports.groupPresetEntriesByPhase = groupPresetEntriesByPhase;
		exports.createCardLibraryRefreshModule = createCardLibraryRefreshModule;
		exports.tavernDataChangeAffects = tavernDataChangeAffects;
		exports.createLiveTavernViewModule = createLiveTavernViewModule;
		exports.applyBodyRegenerationResult = applyBodyRegenerationResult;
		exports.createTavernCoordinationEventModule = createTavernCoordinationEventModule;
		exports.describeTavernActivity = describeTavernActivity;
		exports.createPlayWorkspaceResolver = createPlayWorkspaceResolver;
		exports.createSessionListRecoveryModule = createSessionListRecoveryModule;
		exports.createConversationLifecycleModule = createConversationLifecycleModule;
		exports.createConversationHostAdapter = createConversationHostAdapter;
		exports.createConversationPrewarmModule = createConversationPrewarmModule;
		exports.resolveConversationChatBinding = resolveConversationChatBinding;
		exports.createResourcesLibraryFeatureModule = createResourcesLibraryFeatureModule;
		exports.createPresetLibraryFeatureModule = createExternalPresetAndBypassPlanFeatureModule;
		exports.createWorldBookLibraryFeatureModule = createWorldBookLibraryFeatureModule;
		exports.createCardLibraryFeatureModule = createCardLibraryFeatureModule;
		exports.createPlayControlsFeatureModule = createPlayControlsFeatureModule;
		exports.createTavernAssistantRendererFeatureModule = createTavernAssistantRendererFeatureModule;
		exports.createTavernShellFeatureModule = createTavernShellFeatureModule;
		exports.createTavernRuntimeGenerationMonitor = createTavernRuntimeGenerationMonitor;
		return module.exports;
	}
});
