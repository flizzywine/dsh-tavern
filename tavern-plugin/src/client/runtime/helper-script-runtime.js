		function createTavernHelperScriptRuntime(options) {
            let foreground = !options || options.foreground !== false;
			const hostWindow = options && options.window || window;
			const hostDocument = options && options.document || document;
			const releaseHostStylesheetBridge = createTavernHostStylesheetBridge({ window: hostWindow });
			const invoke = options && options.rpc || rpc;
			const reportError = options && options.reportError || function (source, error) { tavernErrorHub.report(source, error); };
			const resolveError = options && options.resolveError || function (source, beforeAt) { tavernErrorHub.resolve(source, beforeAt); };
			const notifyMutation = options && options.onMutation || function (sessionId) { liveTavernView.invalidate(sessionId); };
			const mutationCoalesceMs = Math.max(0, options && options.mutationCoalesceMs !== undefined && options.mutationCoalesceMs !== null ? Number(options.mutationCoalesceMs) : 400);
			const onReady = options && typeof options.onReady === "function" ? options.onReady : function () {};
			const onMvuLoadState = options && options.onMvuLoadState || function () {};
			const initializationTimeoutMs = Math.max(1000, Number(options && options.initializationTimeoutMs) || 15000);
			const eventTimeoutMs = Math.max(10, Number(options && options.eventTimeoutMs) || 15000);
			// Card scripts often debounce derived writes with setTimeout after MESSAGE_RECEIVED.
			// Keep mvu-work events open briefly so those writes still join the settlement.
			const mvuWorkEventPrefix = "mvu-work:";
			const mvuWorkEventDeferQuietMs = Math.max(0, Number(options && options.mvuWorkEventDeferQuietMs) || 350);
			const mvuWorkEventDeferMaxMs = Math.max(mvuWorkEventDeferQuietMs, Number(options && options.mvuWorkEventDeferMaxMs) || 3000);
			const now = options && options.now || Date.now;
			const records = new Map();
			const pendingEvents = new Map();
			const pendingMutationSessions = new Map();
			const closedEventIds = new Set();
			const closedEventOrder = [];
			const structuralMutationMethods = new Set(["updateTavernHelperPrompts", "updateTavernHelperMessages", "createTavernHelperMessages", "replaceTavernHelperWorldbook", "patchTavernHelperWorldbook", "saveTavernExtensionSettings", "saveTavernWorldInfo", "saveTavernChatData"]);
			const allowedMethods = new Set(["getTavernHelperContext", "generateTavernHelper", "generateTavernHelperRaw", "stopTavernHelperGeneration", "stopAllTavernHelperGeneration", "updateTavernHelperPrompts", "updateTavernHelperVariables", "updateTavernHelperMessages", "createTavernHelperMessages", "getTavernHelperWorldbook", "replaceTavernHelperWorldbook", "patchTavernHelperWorldbook", "saveTavernExtensionSettings", "loadTavernWorldInfo", "saveTavernWorldInfo", "saveTavernChatData"]);
			let activeSessionId = "";
			let root = null;
			let previous = null;
			let eventSequence = 0;
			let readinessKey = "";
			let announcedReadinessKey = "";
			let suppressedCompactMutations = 0;
			function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
			function token() { return hostWindow.crypto && typeof hostWindow.crypto.randomUUID === "function" ? hostWindow.crypto.randomUUID() : String(Date.now()) + ":" + String(Math.random()); }
			function recordInitializing(record) {
				return Boolean(record && record.suppressCompactViewRefresh);
			}
			function clearPendingMutation(sessionId) {
				const pending = pendingMutationSessions.get(sessionId);
				if (!pending) return null;
				if (pending.timer !== null) hostWindow.clearTimeout(pending.timer);
				pendingMutationSessions.delete(sessionId);
				return pending;
			}
			function reportMutation(sessionId, method, result) {
				const id = String(sessionId || "");
				if (!id) return;
				const compactVariable = method === "updateTavernHelperVariables" && result && result.contextDelta;
				if (compactVariable && recordInitializing(records.get("shared"))) {
					suppressedCompactMutations += 1;
					return;
				}
				if (structuralMutationMethods.has(method) || (method === "updateTavernHelperVariables" && !compactVariable) || mutationCoalesceMs === 0) {
					clearPendingMutation(id);
					notifyMutation(id, method, result);
					return;
				}
				clearPendingMutation(id);
				const entry = { method: method, result: result, timer: null };
				entry.timer = hostWindow.setTimeout(function () {
					if (pendingMutationSessions.get(id) !== entry) return;
					pendingMutationSessions.delete(id);
					notifyMutation(id, entry.method, entry.result);
				}, mutationCoalesceMs);
				pendingMutationSessions.set(id, entry);
			}
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
				const readySessionId = activeSessionId;
				const refreshAfterSuppress = suppressedCompactMutations > 0;
				suppressedCompactMutations = 0;
				for (const record of records.values()) record.suppressCompactViewRefresh = false;
				Promise.resolve(onReady(readySessionId)).catch(function (error) { reportError("人物卡脚本初始化", error); });
				if (readySessionId && refreshAfterSuppress) {
					clearPendingMutation(readySessionId);
					notifyMutation(readySessionId, "initialization-ready", null);
				}
			}
			function settleInitialization(record, error, failurePhase) {
				if (record.initializationTimer) hostWindow.clearTimeout(record.initializationTimer);
				record.initializationTimer = null;
				if (error && !record.subscriptionsReady) {
					recordMvuLoadDiagnostic(record, { phase: failurePhase || "initialization-timeout", failureStep: record.mvuLoadState ? "initialization" : "bootstrap", message: String(error.message || error).slice(0, 2000) });
					if (record.scripts.has("__dsh_official_mvu__")) onMvuLoadState({ phase: "error", canRetry: false, error: String(error.message || error) });
					record.initializationFailed = true;
					record.suppressCompactViewRefresh = false;
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
				for (const key of ["character", "characterResourceAccess", "characterVariables", "chatId", "playerName", "characterName", "worldbook"]) {
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
                context.messages = applyTavernVariableReceipt.indexApi.from(context.messages || []);
				return context;
			}
			function helperContext(view, scripts) {
				const context = clone(view && view.tavernHelper || {});
				if (!context.scriptVariables || typeof context.scriptVariables !== "object") context.scriptVariables = {};
				for (const script of scripts) if (!Object.prototype.hasOwnProperty.call(context.scriptVariables, script.id)) context.scriptVariables[script.id] = clone(script.data || {});
				const character = clone(view && view.card || null);
				if (character && typeof character === "object" && (!character.data || typeof character.data !== "object")) character.data = clone(character);
				context.character = character;
                context.characterResourceAccess = view && view.cardResourceAccess || null;
				context.chatId = String(view && view.chatId || "");
				context.playerName = String(view && view.playerName || "你");
				context.characterName = String(character && character.name || "角色");
				if (!Object.prototype.hasOwnProperty.call(context, "worldbook")) context.worldbook = clone(view && view.tavernHelperWorldbook || null);
				return decorateHelperContext(context);
			}
			function post(record, message) {
				if (records.get(record.id) !== record || !record.loaded || !record.frame.contentWindow) return;
				if (message.context && applyTavernVariableReceipt.indexApi.info(message.context.messages)) {
                    message = {...message, context:{...message.context, messages:Array.from(message.context.messages)}};
                }
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
				record.compatibilityTail = task.catch(function (error) {
					// Best-effort diagnostics (like recordMvuRuntimeDiagnostic): the player can't act on a
					// failed write, e.g. after the session was deleted or the server restarted.
					console.warn("dsh-tavern: 兼容能力调用记录保存失败，部分调用可能未记录", error);
				});
				return record.compatibilityTail;
			}
			function removeRecord(id) {
				const record = records.get(id);
				if (!record) return;
				void flushCompatibility(record);
                for (const [generationId, job] of record.helperGenerations || []) {
                    job.cancel();
                    if (job.started) void Promise.resolve(invoke("stopTavernHelperGeneration", {generationId, generationToken:job.generationToken, pending:true}, record.sessionId)).catch(function () {});
                }
				for (const [eventId, pending] of pendingEvents) {
					if (pending.record !== record) continue;
					hostWindow.clearTimeout(pending.timer);
					if (pending.deferTimer) hostWindow.clearTimeout(pending.deferTimer);
					closeEventId(eventId);
					pendingEvents.delete(eventId);
					pending.reject(new Error("人物卡脚本运行时已重置，事件未完成"));
				}
				if (record.initializationTimer) hostWindow.clearTimeout(record.initializationTimer);
				if (record.trustedCardMode) releaseTavernHostJQueryHandlers(hostWindow, record.frame.contentWindow);
				if (record.releaseStorage) record.releaseStorage(); // revoke before detaching the card sandbox
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
                // A blank opening has no floor yet; MVU initializes it in the chat scope.
                const initial = record.context?.chatVariables;
                if (!record.context?.messages?.length) return initial?.stat_data !== undefined && initial?.schema !== undefined;
                const info = applyTavernVariableReceipt.indexApi.info(record.context?.messages);
                return info ? info.eligible > 0 : (record.context?.messages || []).some(message =>
                    message?.variables?.stat_data !== undefined && message?.variables?.schema !== undefined);
            }
			function syncMvuDataReadiness(record) {
				const core = record.scripts.get("__dsh_official_mvu__");
				if (!core || core.initializationFailed || !record.subscriptionsReady) return;
				const ready = mvuDataReady(record);
				if (ready) {
					record.mvuDataError = "";
				}
                // pending initialization writes are not failures merely because they are slow.
				const phase = ready ? "ready" : record.mvuDataError ? "error" : "evaluating";
				if (!record.mvuLoadState || record.mvuLoadState.phase !== phase) {
					recordMvuLoadDiagnostic(record, { phase: ready ? "initialization-ready" : "initialization-waiting", failureStep: "initial-variables" });
					record.mvuLoadState = { phase: phase, canRetry: false, error: record.mvuDataError || "" };
					onMvuLoadState(record.mvuLoadState);
				}
			}
			async function emitToRecord(record, name, args, context, diagnostics, hostEventId) {
				const initializationError = mvuInitializationError(record);
				if (initializationError) {
					if (diagnostics) diagnostics.push({ kind: "initialization", name: name, level: "error", ready: false, initializationFailed: true, scriptId: "__dsh_official_mvu__", message: initializationError });
					return Promise.reject(new Error(initializationError));
				}
				if (diagnostics) diagnostics.push({ kind: "dispatch", name: name, ready: record.subscriptionsReady, initializationFailed: record.initializationFailed, subscribed: record.subscriptions.has(String(name)) });
				if (!record.loaded || !record.subscriptionsReady || record.initializationFailed) return Promise.resolve(args);
				if (context && typeof context === "object" && context.contextWindow) {
                    // A bounded event context: recent rows at their absolute ids; older
                    // rows stay stubs that the history lease reads on demand.
                    const range = context.contextWindow.historyWindow, helper = context.contextWindow.tavernHelper || {};
                    const messages = Array.from({ length: Number(range && range.messageCount) || 0 }, function (_, message_id) { return { message_id: message_id, stub: true }; });
                    for (const row of Array.isArray(helper.messages) ? helper.messages : []) messages[row.message_id] = row;
                    context = Object.assign({}, helper, { messages: messages });
                }
				if (context && typeof context === "object") {
                    if (context.contextDelta) {
                        const next = applyTavernVariableReceipt(record.context, context.contextDelta);
                        if (next === null) {
                            const snapshot = await invoke("getTavernHelperContext", {eventId:hostEventId}, record.sessionId);
                            if (records.get(record.id) !== record) throw new Error("脚本运行时已失效");
                            record.context = decorateHelperContext(snapshot.context, record.context);
                            post(record,{type:"dsh-tavern-helper-context",context:record.context});
                        } else {
                            record.context=next;
                            post(record,{type:"dsh-tavern-helper-context",contextDelta:context.contextDelta});
                        }
                    } else {
                        record.context = decorateHelperContext(context, record.context);
                        post(record, { type: "dsh-tavern-helper-context", context: record.context });
                    }
				}
				if (name !== "DSH_VARIABLE_EDIT" && !record.subscriptions.has(String(name))) return Promise.resolve(args);
				const eventId = String(hostEventId || "") || "host-event-" + (++eventSequence);
				const startedAt = now();
				return new Promise(function (resolve, reject) {
                    const envelope = { type: "dsh-tavern-helper-event", eventId: eventId, name: name, args: clone(args) };
                    const probeIntervalMs = Math.min(1000, eventTimeoutMs / 3);
                    const timer = hostWindow.setTimeout(function check() {
                        const pending = pendingEvents.get(eventId);
                        if (!pending) return;
                        // A suspended page sends no probes, so its silence says nothing about
                        // the sandbox: discount the stall and probe before judging.
                        const stalledMs = now() - pending.probeDueAt - probeIntervalMs;
                        if (stalledMs > 0) pending.contactAt = Math.min(now(), pending.contactAt + stalledMs + probeIntervalMs);
                        // A responsive sandbox may execute indefinitely. Probe the same
                        // identity: a lost completion replays its receipt, never its handler.
                        if (now() - pending.contactAt >= eventTimeoutMs) {
                            pendingEvents.delete(eventId);
                            closeEventId(eventId);
                            const script = record.scripts.get(String(pending.activeScriptId || ""));
                            const source = script ? "人物卡脚本「" + script.name + "」" : "共享脚本沙箱";
                            const error = new Error(source + "处理事件「" + String(name) + "」时沙箱失联，状态尚未确认");
                            error.code = "TAVERN_SCRIPT_RUNTIME_UNREACHABLE";
                            if (pending.writeError) { error.cause = pending.writeError; error.message += "；此前宿主调用失败：" + pending.writeError.message; }
                            if (diagnostics && diagnostics.length < 50) diagnostics.push({ kind: "runtime-unreachable", name: String(name), causeCode: String(pending.writeError?.code || ""), elapsedMs: now() - startedAt });
                            reportError(script ? source : "人物卡共享脚本沙箱", error);
                            reject(error);
                            return;
                        }
                        post(record, { type: "dsh-tavern-helper-event-query", eventId: eventId });
                        pending.probeDueAt = now() + probeIntervalMs;
                        pending.timer = hostWindow.setTimeout(check, probeIntervalMs);
                    }, probeIntervalMs);
                    pendingEvents.set(eventId, { record: record, resolve: resolve, reject: reject, timer: timer, envelope: envelope, contactAt: startedAt, probeDueAt: startedAt + probeIntervalMs, probeIntervalMs: probeIntervalMs, name: String(name), activeScriptId: "", diagnostics: diagnostics });
                    post(record, envelope);
				});
			}
			// The host renderer announces a settled message DOM; scripts that decorate
			// messages (SillyTavern CHARACTER_MESSAGE_RENDERED) apply their edits then.
			if (typeof hostWindow.addEventListener === "function") hostWindow.addEventListener("dsh-tavern-message-rendered", function (event) {
				const detail = event && event.detail || {};
				for (const record of records.values()) {
					if (record.sessionId !== String(detail.sessionId || "") || !record.trustedCardMode) continue;
					emitToRecord(record, "character_message_rendered", [Number(detail.messageId)]).catch(function () {});
				}
			});
			async function emit(name, args, context, diagnostics, hostEventId) {
				let current = clone(Array.isArray(args) ? args : []);
				for (const record of records.values()) current = await emitToRecord(record, name, current, context, diagnostics, hostEventId);
				return current;
			}
			function clear() {
				for (const sessionId of Array.from(pendingMutationSessions.keys())) clearPendingMutation(sessionId);
				suppressedCompactMutations = 0;
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
			function createRecord(sessionId, scripts, context, trustedCardMode, viewer) {
				const container = ensureRoot();
				const frame = hostDocument.createElement("iframe");
				const fingerprint = scripts.map(function (script) { return script.id + "\n" + script.content; }).join("\n---\n") + "\ntrusted=" + String(trustedCardMode) + "\nviewer=" + String(viewer) + "\ncard=" + String(context.frameStorageScope && context.frameStorageScope.cardPath || ""); // card changes revoke the sandbox capability
				const record = {
					id: "shared",
					sessionId: sessionId,
					name: "共享脚本沙箱",
					trustedCardMode: trustedCardMode,
					startedAt: Date.now(),
					fingerprint: fingerprint,
					suppressCompactViewRefresh: true,
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
				frame.__dshTavernSessionId = sessionId;
                frame.__dshTavernHostArtifacts = record.hostArtifacts;
				frame.title = "人物卡共享脚本沙箱";
				if (!trustedCardMode) frame.sandbox = "allow-scripts";
				frame.referrerPolicy = "no-referrer";
				record.storage = forkFrameStorage.capability({ sessionId: sessionId, cardPath: context.frameStorageScope && context.frameStorageScope.cardPath }, hostWindow); // owner-only storage grant
				frame.srcdoc = buildTavernHelperScriptDocument({ frameStorage: record.storage, token: record.token, scripts: scripts, context: context, trustedCardMode: trustedCardMode, deferContext: true });
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
				record.releaseStorage = forkFrameStorage.register(frame, record.storage); // contentWindow exists only after insertion
				records.set(record.id, record);
                if (record.hostArtifacts) record.hostArtifacts.setVisible(foreground);
				return record;
			}
			function scriptsForView(view) {
				const scripts = Array.isArray(view && view.tavernHelperScripts) ? view.tavernHelperScripts.slice() : [];
				const mvu = view && view.tavernScriptRuntimeMode !== "viewer" && view.tavernMvuRuntime;
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
            function refreshContext(record, context) {
                const api = applyTavernVariableReceipt.indexApi, before = record.context;
                const changed = before && before.chatId === context.chatId
                    && before.lifecycleRevision === context.lifecycleRevision
                    && before.messages.length <= context.messages.length
                    ? api.changed(before.messages,context.messages) : null;
                record.context = context;
                if (changed === null) { post(record,{type:"dsh-tavern-helper-context",context}); return; }
                const header = {...context}; delete header.messages;
                if (header.turnMessageIds === before.turnMessageIds) delete header.turnMessageIds;
                post(record,{type:"dsh-tavern-helper-context",contextDelta:{
                    version:2,kind:"committed",chatId:context.chatId,lifecycleRevision:context.lifecycleRevision,
                    baseRevision:before.stateRevision,stateRevision:context.stateRevision,messageCount:context.messages.length,header,
                    messages:changed.map(id=>context.messages[id])
                }});
            }
			function sync(sessionId, view) {
				const nextSessionId = String(sessionId || "");
				if (activeSessionId && activeSessionId !== nextSessionId) clear();
				activeSessionId = nextSessionId;
				const scripts = scriptsForView(view);
				const viewer = Boolean(view && view.tavernScriptRuntimeMode === "viewer");
				const trustedCardMode = Boolean(view && view.tavernRuntimePolicy && view.tavernRuntimePolicy.trustedCardMode);
				readinessKey = scripts.length === 0 ? "" : nextSessionId + "\n" + scripts.map(function (script) { return script.id + "\n" + script.content; }).join("\n---\n") + "\ntrusted=" + String(trustedCardMode) + "\nviewer=" + String(viewer);
				if (scripts.length === 0) { clear(); activeSessionId = nextSessionId; return; }
                let record = records.get("shared");
                const source = view?.tavernHelper;
                const sourceIndex = createSessionViewReader.indexApi;
                const sourceChanges = record && source && record.sourceHelper
                    && view.chatId === record.context.chatId
                    && String(view.playerName || "你") === record.committedContext?.playerName
                    && String(view.card?.name || "角色") === record.committedContext?.characterName
                    && Array.isArray(source.messages) && Array.isArray(record.sourceHelper.messages)
                    && record.sourceHelper.lifecycleRevision === source.lifecycleRevision
                    && record.sourceHelper.messages.length <= source.messages.length
                    ? sourceIndex.changed(record.sourceHelper.messages,source.messages) : null;
                let context;
                if (sourceChanges !== null && record.committedContext) {
                    const helper = {...source,messages:sourceChanges.map(id=>source.messages[id])};
                    const sameTurns = source.turnMessageIds === record.sourceHelper.turnMessageIds;
                    if (sameTurns) delete helper.turnMessageIds;
                    const partial = helperContext({...view,tavernHelper:helper},scripts);
                    context = {...partial,messages:applyTavernVariableReceipt.indexApi.update(record.committedContext.messages,
                        sourceChanges.map((id,at)=>[id,partial.messages[at]]),source.messages.length)};
                    if (sameTurns) context.turnMessageIds = record.committedContext.turnMessageIds;
                } else context = helperContext(view,scripts);
				const nextSnapshot = snapshot(context);
				const officialOwner = Boolean(view && view.tavernMvuRuntime && view.tavernMvuRuntime.owner === "official");
				// Viewers mirror committed data without replaying settlement callbacks.
				const queuedEvents = officialOwner || viewer ? [] : eventsBetween(previous, nextSnapshot);
				const fingerprint = scripts.map(function (script) { return script.id + "\n" + script.content; }).join("\n---\n") + "\ntrusted=" + String(trustedCardMode) + "\nviewer=" + String(viewer) + "\ncard=" + String(context.frameStorageScope && context.frameStorageScope.cardPath || "");
				if (record && record.fingerprint !== fingerprint) { removeRecord("shared"); record = null; }
				if (!record) record = createRecord(nextSessionId, scripts, context, trustedCardMode, viewer);
				else {
                    if (record.context.transaction && pendingEvents.has(record.context.transaction.eventId)
                        && Number(context.lifecycleRevision || 0) === Number(record.context.lifecycleRevision || 0)) {
                        // A committed view refresh must not replace an executing draft.
                        record.deferredContext = context;
                    } else {
                        record.deferredContext = null;
                        refreshContext(record,context);
                    }
					queuedEvents.forEach(function (event) {
						if (record.subscriptionsReady && record.subscriptions.has(String(event.name))) post(record, { type: "dsh-tavern-helper-event", name: event.name, args: event.args });
					});
				}
                record.sourceHelper = source;
                record.committedContext = context;
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
                            // the core deadline must not time out companion imports or variable RPCs.
                            if (record.initializationTimer) hostWindow.clearTimeout(record.initializationTimer);
                            record.initializationTimer = null;
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
                if (data.type === "dsh-tavern-helper-event-state") {
                    const pending = pendingEvents.get(String(data.eventId || ""));
                    if (pending && pending.record === record) {
                        pending.contactAt = now();
                        if (data.phase === "unknown") post(record, pending.envelope);
                    }
                    return;
                }
				if (data.type === "dsh-tavern-helper-event-progress") {
					const pending = pendingEvents.get(String(data.eventId || ""));
					if (pending && pending.record === record) { pending.contactAt = now(); pending.activeScriptId = data.phase === "completed" ? "" : String(data.scriptId || ""); }
					return;
				}
				if (data.type === "dsh-tavern-helper-event-complete") {
					const eventId = String(data.eventId || "");
					const pending = pendingEvents.get(eventId);
					if (!pending || pending.record !== record || pending.finishing) {
                        if (closedEventIds.has(eventId)) post(record, { type: "dsh-tavern-helper-event-ack", eventId: eventId });
                        return;
                    }
                    pending.contactAt = now();
					pending.completeData = data;
					pending.completedAt = now();
					const finish = function () {
						if (pendingEvents.get(eventId) !== pending) return;
						if (pending.deferTimer) { hostWindow.clearTimeout(pending.deferTimer); pending.deferTimer = null; }
						pending.finishing = true;
						pending.armDeferredClose = null;
						pendingEvents.delete(eventId);
						closeEventId(eventId);
						hostWindow.clearTimeout(pending.timer);
                        post(record, { type: "dsh-tavern-helper-event-ack", eventId: eventId });
                        if (record.deferredContext) {
                            const committed = record.deferredContext;
                            record.deferredContext = null;
                            refreshContext(record,committed);
                        }
						const completeData = pending.completeData || data;
						if (completeData.error) {
							const script = record.scripts.get(String(completeData.scriptId || pending.activeScriptId || ""));
							const prefix = script ? "人物卡脚本「" + script.name + "」" : "共享脚本沙箱";
							const error = new Error(prefix + "处理事件「" + pending.name + "」失败：" + String(completeData.error));
							if (typeof completeData.errorCode === "string" && completeData.errorCode) error.code = completeData.errorCode;
							if (pending.diagnostics && pending.diagnostics.length < 50) pending.diagnostics.push({ kind: "event-error", name: pending.name, scriptId: String(completeData.scriptId || pending.activeScriptId || ""), errorCode: String(error.code || "") });
							reportError(script ? "人物卡脚本「" + script.name + "」" : "人物卡共享脚本沙箱", error);
							pending.reject(error);
						} else if (pending.writeError) pending.reject(pending.writeError);
						else pending.resolve(clone(Array.isArray(completeData.args) ? completeData.args : []));
					};
					const settleWritesThenFinish = function () {
						if (pending.writeError || !pending.writes || pending.writes.size === 0) finish();
						else Promise.all(Array.from(pending.writes)).then(finish, finish);
					};
					const armDeferredClose = function () {
						if (pendingEvents.get(eventId) !== pending || pending.finishing) return;
						if (pending.deferTimer) hostWindow.clearTimeout(pending.deferTimer);
						const elapsed = now() - pending.completedAt;
						if (elapsed >= mvuWorkEventDeferMaxMs) {
							settleWritesThenFinish();
							return;
						}
						pending.deferTimer = hostWindow.setTimeout(function () {
							pending.deferTimer = null;
							if (pendingEvents.get(eventId) !== pending || pending.finishing) return;
							if (pending.writes && pending.writes.size > 0) {
								Promise.all(Array.from(pending.writes)).then(armDeferredClose, armDeferredClose);
								return;
							}
							settleWritesThenFinish();
						}, Math.min(mvuWorkEventDeferQuietMs, mvuWorkEventDeferMaxMs - elapsed));
					};
					pending.armDeferredClose = armDeferredClose;
					if (data.error) {
						pending.finishing = true;
						settleWritesThenFinish();
					} else if (eventId.indexOf(mvuWorkEventPrefix) === 0) {
						armDeferredClose();
					} else {
						pending.finishing = true;
						settleWritesThenFinish();
					}
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
					invoke("recordMvuRuntimeDiagnostic", { diagnostic: { level: "error", scriptId: String(data.scriptId || ""), message: message.slice(0, 4000), moduleFailure: data.moduleFailure } }, activeSessionId).catch(function () {});
					const errorKey = String(data.scriptId || "") + "\n" + message;
					if (!record.runtimeErrorKeys) record.runtimeErrorKeys = new Set();
					if (!record.runtimeErrorKeys.has(errorKey)) {
						if (record.runtimeErrorKeys.size >= 200) record.runtimeErrorKeys.delete(record.runtimeErrorKeys.values().next().value);
						record.runtimeErrorKeys.add(errorKey);
						const error = new Error(message);
						if (data.moduleFailure && data.moduleFailure.phase === "module-load") error.dshTavernModuleFailure = sanitizeTavernModuleFailure(data.moduleFailure);
						reportError(source, error);
					}
					return;
				}
                if (data.type === "dsh-tavern-helper-call" && data.method === "triggerTavernSlash") {
                    // Wait for earlier persistence, but do not put generation on the
                    // RPC tail: its MVU events must be able to issue their own writes.
                    Promise.resolve(record.rpcTail).catch(function () {}).then(function () {
                        if (!foreground || records.get(record.id) !== record) throw new Error("对话已切换，人物卡命令未执行；请返回原对话重试");
                        if (data.lifecycleRevision !== undefined && Number(data.lifecycleRevision) !== Number(record.context?.lifecycleRevision || 0)) throw new Error("存档版本已变化，人物卡命令未执行");
                        if (data.eventId && (closedEventIds.has(String(data.eventId)) || pendingEvents.get(String(data.eventId))?.finishing)) {
                            throw Object.assign(new Error("事件已经结束，人物卡命令未执行"), { code: "TAVERN_SCRIPT_EVENT_CLOSED" });
                        }
                        if (typeof options.executeSlash !== "function") throw new Error("当前对话命令入口尚未就绪");
                        return options.executeSlash(String(data.args?.line || ""), record.sessionId, data.eventId ? { waitForCompletion: false } : undefined);
                    }).then(function (result) {
                        post(record, { type: "dsh-tavern-helper-response", requestId: data.requestId, ok: true,
                            result: typeof result === "string" ? { pipe: result } : result });
                    }, function (error) {
                        post(record, { type: "dsh-tavern-helper-response", requestId: data.requestId, ok: false,
                            error: String(error.message || error), errorCode: String(error.code || "") });
                    });
                    return;
                }
                if (data.type === "dsh-tavern-helper-call" && data.method === "submitTavernHelperInput") {
                    Promise.resolve().then(function () {
                        if (!foreground || records.get(record.id) !== record) throw new Error("对话已切换，开局消息未发送；请返回原对话重试");
                        if (data.lifecycleRevision !== undefined && Number(data.lifecycleRevision) !== Number(record.context?.lifecycleRevision || 0)) throw new Error("存档版本已变化，开局消息未发送");
                        if (typeof options.executeSlash !== "function") throw new Error("当前对话发送入口尚未就绪");
                        return options.executeSlash("", record.sessionId, { inputText: String(data.args?.text || "") });
                    }).then(function (result) {
                        post(record, { type:"dsh-tavern-helper-response", requestId:data.requestId, ok:true, result:result });
                    }, function (error) {
                        reportError("人物卡发送消息", error);
                        post(record, { type:"dsh-tavern-helper-response", requestId:data.requestId, ok:false, error:String(error.message || error) });
                    });
                    return;
                }
                if (data.type !== "dsh-tavern-helper-call") return;
                if (!allowedMethods.has(data.method)) {
                    post(record, { type: "dsh-tavern-helper-response", requestId: data.requestId, ok: false,
                        error: "当前人物卡不支持 Helper 方法: " + String(data.method || ""), errorCode: "UNSUPPORTED_HELPER_METHOD" });
                    return;
                }
                if (data.method === "stopTavernHelperGeneration" || data.method === "stopAllTavernHelperGeneration") {
                    const all = data.method === "stopAllTavernHelperGeneration", id = String(data.args?.generationId || "");
                    let cancelledLocal = false;
                    const stopArgs = Object.assign({}, data.args || {}), pendingGenerations = [];
                    for (const [generationId, job] of record.helperGenerations || []) {
                        if (!all && generationId !== id) continue;
                        if (!all && stopArgs.generationToken && stopArgs.generationToken !== job.generationToken) continue;
                        pendingGenerations.push({generationId, generationToken:job.generationToken});
                        if (!all) Object.assign(stopArgs, {generationToken:job.generationToken, pending:true});
                        job.cancel(); cancelledLocal = true;
                    }
                    if (all) stopArgs.pendingGenerations = (stopArgs.pendingGenerations || []).concat(pendingGenerations);
                    Promise.resolve().then(() => invoke(data.method, stopArgs, record.sessionId)).then(function (result) {
                        post(record, {type:"dsh-tavern-helper-response", requestId:data.requestId, ok:true,
                            result:Object.assign({}, result, {stopped:cancelledLocal || result?.stopped === true})});
                    }, function (error) {
                        post(record, {type:"dsh-tavern-helper-response", requestId:data.requestId, ok:false, error:String(error.message || error)});
                    });
                    return;
                }
				if (data.eventId && (closedEventIds.has(String(data.eventId)) || pendingEvents.get(String(data.eventId))?.finishing)) {
					post(record, { type: "dsh-tavern-helper-response", requestId: data.requestId, ok: false, error: "事件已经结束，已拒绝迟到写入", errorCode: "TAVERN_SCRIPT_EVENT_CLOSED" });
					return;
				}
					let mutationArgs = Object.assign({}, data.args || {}, { apiCallOrigin: { scriptId: String(data.scriptId || ""), scriptName: String(record.scripts.get(String(data.scriptId || ""))?.name || ""), eventId: String(data.eventId || ""), requestId: String(data.requestId || "") } });
					if (data.method === "updateTavernHelperPrompts" || data.method === "updateTavernHelperVariables" || data.method === "updateTavernHelperMessages" || data.method === "createTavernHelperMessages") {
						mutationArgs = Object.assign({}, mutationArgs, {
							eventId: String(data.eventId || ""),
							expectedLifecycleRevision: Math.max(0, Number(data.lifecycleRevision !== undefined ? data.lifecycleRevision : record.context && record.context.lifecycleRevision) || 0)
						});
				}
				const promptOperation = data.method === "updateTavernHelperPrompts" && mutationArgs.operation;
				const batchKey = JSON.stringify([data.scriptId, data.eventId, mutationArgs.expectedLifecycleRevision]);
				const queued = record.queuedPromptBatch;
				let rpcTask;
                if (data.method === "generateTavernHelper" || data.method === "generateTavernHelperRaw") {
                    const config = mutationArgs.config || {}, generationId = String(config.generation_id || "dsh-rpc-" + token());
                    mutationArgs = Object.assign({}, mutationArgs, {generationToken:mutationArgs.generationToken || token(), config:Object.assign({}, config, {generation_id:generationId})});
                    const jobs = record.helperGenerations || (record.helperGenerations = new Map());
                    if (jobs.has(generationId)) rpcTask = Promise.reject(new Error("生成编号正在使用: " + generationId));
                    else {
                        let rejectCancelled;
                        const cancelled = new Promise(function (_resolve, reject) { rejectCancelled = reject; });
                        const job = {started:false, cancelled:false, generationToken:mutationArgs.generationToken, cancel:function () {
                            if (job.cancelled) return;
                            job.cancelled = true;
                            rejectCancelled(new Error("生成已取消"));
                        }};
                        jobs.set(generationId, job);
                        // Respect earlier mutations, but don't put a long model job
                        // in the mutation queue: cancellation must reach it immediately.
                        const generation = (record.rpcTail || Promise.resolve()).catch(function () {}).then(function () {
                            if (job.cancelled || records.get(record.id) !== record) throw new Error("生成已取消");
                            if (data.lifecycleRevision !== undefined && Number(data.lifecycleRevision) !== Number(record.context?.lifecycleRevision || 0)) throw new Error("存档版本已变化，生成已取消");
                            job.started = true;
                            return invoke(data.method, mutationArgs, record.sessionId);
                        });
                        rpcTask = Promise.race([generation, cancelled]).finally(function () { if (jobs.get(generationId) === job) jobs.delete(generationId); });
                    }
                } else if (promptOperation && queued && queued.key === batchKey && queued.operations.length < 64) {
					queued.operations.push(promptOperation);
					// Every caller receives persistence confirmation, but refresh the host once.
					rpcTask = queued.task.then(function (result) { return Object.assign({}, result, { updated: false }); });
				} else {
					record.queuedPromptBatch = null;
					const batch = promptOperation ? { key: batchKey, operations: [promptOperation] } : null;
					if (batch) mutationArgs.operation = { kind: "batch", operations: batch.operations };
					rpcTask = (record.rpcTail || Promise.resolve()).catch(function () {}).then(function () {
						if (record.queuedPromptBatch === batch) record.queuedPromptBatch = null;
						if (records.get(record.id) !== record) throw new Error("脚本运行时已失效");
						if (data.eventId && closedEventIds.has(String(data.eventId))) throw Object.assign(new Error("事件已经结束，已拒绝迟到写入"), { code: "TAVERN_SCRIPT_EVENT_CLOSED" });
						return Promise.resolve(invoke(data.method, mutationArgs, record.sessionId)).then(async function (result) {
                            if (!result || !result.contextDelta || records.get(record.id) !== record) return result;
                            const next = applyTavernVariableReceipt(record.context, result.contextDelta);
                            if (next === null) {
                                const snapshot = await invoke("getTavernHelperContext", result.contextDelta.version === 2 ? {eventId:result.contextDelta.eventId} : {}, record.sessionId);
                                record.context = decorateHelperContext(snapshot.context, record.context);
                                return Object.assign({}, result, { contextDelta: undefined, context: snapshot.context });
                            }
                            record.context = next;
                            syncMvuDataReadiness(record);
                            return result;
                        });
					});
					record.rpcTail = rpcTask;
					if (batch) { batch.task = rpcTask; record.queuedPromptBatch = batch; }
				}
				const writeOwner = pendingEvents.get(String(data.eventId || ""));
				if (writeOwner && writeOwner.record === record) {
					if (!writeOwner.writes) writeOwner.writes = new Set();
					const receipt = rpcTask.then(function (result) {
						if (result && result.stale) throw new Error("聊天已变化，事件写入未保存");
					}).catch(function (error) { if (!writeOwner.writeError) writeOwner.writeError = error; });
					writeOwner.writes.add(receipt);
					receipt.then(function () { writeOwner.writes.delete(receipt); });
					if (typeof writeOwner.armDeferredClose === "function") writeOwner.armDeferredClose();
				}

				rpcTask.then(function (result) {
					if (records.get(record.id) === record && result && !result.stale) {
						const pending = pendingEvents.get(String(data.eventId || ""));
						if (pending && pending.record === record) {
							pending.contactAt = now();
						}
					}
					// Readiness follows acknowledged persistence, not an iframe's speculative variables.
					if (result && result.updated === true && !result.stale && !result.transactional && result.context && records.get(record.id) === record
						&& result.context.chatId === record.context.chatId
						&& Number(result.context.lifecycleRevision) === Number(record.context.lifecycleRevision)
						&& Number(result.context.stateRevision) >= Number(record.context.stateRevision)) {
						record.context = decorateHelperContext(result.context, record.context);
						syncMvuDataReadiness(record);
					}
					post(record, { type: "dsh-tavern-helper-response", requestId: data.requestId, ok: true, result: result });
					if ((data.method === "updateTavernHelperPrompts" || data.method === "updateTavernHelperVariables" || data.method === "updateTavernHelperMessages" || data.method === "createTavernHelperMessages" || data.method === "replaceTavernHelperWorldbook" || data.method === "patchTavernHelperWorldbook" || data.method === "saveTavernExtensionSettings" || data.method === "saveTavernWorldInfo" || data.method === "saveTavernChatData") && result && !result.transactional && result.updated !== false && result.stale !== true && records.get(record.id) === record) reportMutation(record.sessionId, data.method, result.contextDelta ? Object.assign({}, result, { context: record.context }) : result);
				}, function (error) {
					post(record, { type: "dsh-tavern-helper-response", requestId: data.requestId, ok: false, error: String(error && error.message || error), errorCode: String(error && error.code || "") });
				});
			}
			hostWindow.addEventListener("message", receive);
			return Object.freeze({
				sync: sync,
                setForeground: function (value) { foreground = value; for (const record of records.values()) if (record.hostArtifacts) record.hostArtifacts.setVisible(value); },
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
                // An overdue probe means the page itself stalled; the watchdog re-probes before judging.
                eventResponsive: function (eventId) { const pending = pendingEvents.get(eventId); return Boolean(pending && (now() - pending.contactAt < eventTimeoutMs || now() - pending.probeDueAt > pending.probeIntervalMs)); },
				dispose: function () { hostWindow.removeEventListener("message", receive); clear(); releaseHostStylesheetBridge(); },
				inspect: function () {
					const record = records.get("shared");
					const scripts = record ? Array.from(record.scripts.values()).map(function (script) { return { id: script.id, loaded: script.loaded, subscriptionsReady: script.subscriptionsReady, initializationFailed: script.initializationFailed }; }) : [];
					const initializationError = mvuInitializationError(record);
					const baseline=record && record.context;
                    const contextBaseline=baseline ? {workContextVersion:1,appendContextVersion:1,chatId:baseline.chatId,stateRevision:baseline.stateRevision,
                        lifecycleRevision:Number(baseline.lifecycleRevision)||0,messageCount:(baseline.messages||[]).length,
                        transaction:baseline.transaction,historyWindowVersion:baseline.historyAccess?1:undefined,complete:!baseline.messagesPending && (applyTavernVariableReceipt.indexApi.info(baseline.messages)?.complete ?? false)} : {workContextVersion:1,full:true};
                    return { contextBaseline:contextBaseline, sessionId: activeSessionId, frameCount: record ? 1 : 0, scriptIds: scripts.map(function (script) { return script.id; }), scripts: scripts, ...(record && record.scripts.has("__dsh_official_mvu__") ? { mvuDataReady: mvuDataReady(record) } : {}), ...(record && record.mvuLoadState ? { mvuLoadState: record.mvuLoadState } : {}), ...(initializationError ? { initializationError: initializationError } : {}) };
				}
			});
		}
