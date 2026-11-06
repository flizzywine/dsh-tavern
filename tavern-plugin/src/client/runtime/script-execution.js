		function createTavernScriptExecutionModule(options) {
			const hostWindow = options && options.window || window;
			const invoke = options && options.rpc || rpc;
			const signals = options && options.signals || tavernSessionSignals;
			const invalidate = options && options.invalidate || function (sessionId) { liveTavernView.invalidate(sessionId); };
			const createRuntime = options && options.createRuntime || createTavernHelperScriptRuntime;
			const requestTimeoutMs = Math.max(100, Number(options && (options.requestTimeoutMs || options.pollRequestTimeoutMs)) || 15000);
			const startHeartbeat = options && options.startHeartbeat || (typeof hostWindow.setInterval === "function" ? function (run, delay) { return hostWindow.setInterval(run, delay); } : null);
			const stopHeartbeat = options && options.stopHeartbeat || (typeof hostWindow.clearInterval === "function" ? function (timer) { hostWindow.clearInterval(timer); } : function () {});
			const heartbeatIntervalMs = Math.max(1000, Number(options && options.heartbeatIntervalMs) || 10000);
			let foreground = true;
			let runtime = null;
			let lease = null;
			// A visible desktop page executes card scripts itself; a hidden page
			// or a phone lets the server run them (the page keeps its card UI).
			const mobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(String(hostWindow.navigator && hostWindow.navigator.userAgent || ""));
			function pageActive() {
				const documentState = hostWindow.document && hostWindow.document.visibilityState;
				return foreground && !mobileDevice && documentState !== "hidden";
			}
			let stopVisibility = null;
			let workStop = null;
				let heartbeatTimer = null;
				let claimRetryTimer = null;
			let releaseBarrier = Promise.resolve();
			let releasesPending = 0;
			let claimBusy = null;
            let delivery = null;
			let claimRequested = false;
			let claimRetryCount = 0;
			let active = false;
			let ownershipKnown = false;
			let input = null;

			function runtimeView(view) {
				if (active) return view;
				// Wait for the first claim before evaluating any scripts. Once another
				// browser owns settlement, this page still needs its own interactive UI.
				if (!ownershipKnown) return Object.assign({}, view || {}, { tavernHelperScripts: [], tavernMvuRuntime: null });
				return Object.assign({}, view || {}, { tavernScriptRuntimeMode: "viewer", tavernMvuRuntime: null });
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
			// Card scripts read the card's worldbook and MVU applies its [InitVar]
			// entry inside the chat-level initialization that CHAT_CHANGED triggers.
			// MVU runs that initialization once and skips it when the chat identity
			// or its own enablement is not ready yet, so an opening could be read
			// with no initial variables until the player sent a first message. While
			// MVU reports that its initial variables are still missing, announce the
			// chat again a bounded number of times so the scripts re-run it.
			let chatAnnouncements = 0;
			let chatAnnounceTimer = null;
			let chatAnnounceWaiting = false;
			const chatAnnounceDelays = [1500, 4000, 9000];
			function cancelChatAnnouncements() {
				chatAnnounceWaiting = false;
				chatAnnouncements = 0;
				if (chatAnnounceTimer !== null) hostWindow.clearTimeout(chatAnnounceTimer);
				chatAnnounceTimer = null;
			}
			function announceChat(force) {
				if (!active || !runtime || !input) return Promise.resolve();
				const chatId = String(input.view && input.view.chatId || "");
				if (!chatId) return Promise.resolve();
				const context = input.view && input.view.tavernHelper;
				if (force !== true) return Promise.resolve(runtime.emit("CHAT_CHANGED", [chatId], context));
				// MVU remembers the chat it last initialized and ignores a repeated
				// CHAT_CHANGED for that same chat, so announcing the current chat again
				// cannot re-run its chat-level initialization. Announce an identity it
				// cannot adopt first — that only resets the chat it tracks, because its
				// own current-chat guard rejects the transition — and then the real chat,
				// which performs a genuine re-initialization and applies [InitVar].
				return Promise.resolve()
					.then(function () { return runtime.emit("CHAT_CHANGED", [""], context); })
					.then(function () { return runtime.emit("CHAT_CHANGED", [chatId], context); });
			}
			function scheduleChatAnnouncement() {
				if (chatAnnounceTimer !== null || !chatAnnounceWaiting) return;
				if (!active || !runtime || !input) return;
				if (chatAnnouncements >= chatAnnounceDelays.length) return;
				const delay = chatAnnounceDelays[chatAnnouncements];
				chatAnnouncements += 1;
				chatAnnounceTimer = hostWindow.setTimeout(function () {
					chatAnnounceTimer = null;
					Promise.resolve()
						.then(function () { return announceChat(true); })
						.catch(function () {})
						.then(function () {
							void claimWork();
							scheduleChatAnnouncement();
						});
				}, delay);
			}
			function dispose() {
				cancelChatAnnouncements();
				const previousLease = lease;
				lease = null;
                delivery = null;
				input = null;
				active = false;
				ownershipKnown = false;
					claimRequested = false;
					claimRetryCount = 0;
					if (claimRetryTimer !== null) hostWindow.clearTimeout(claimRetryTimer);
					claimRetryTimer = null;
				if (workStop) workStop();
				workStop = null;
				if (heartbeatTimer !== null) stopHeartbeat(heartbeatTimer);
				heartbeatTimer = null;
				if (stopVisibility) stopVisibility();
				stopVisibility = null;
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
					window: hostWindow, rpc: invoke, onMutation: invalidate, foreground: foreground, executeSlash: options.executeSlash,
					onMvuLoadState: function (state) {
						if (lease !== currentLease) return;
						if (options && options.onMvuLoadState) options.onMvuLoadState(state);
						void claimWork();
						// "evaluating" means MVU is loaded and subscribed but its initial
						// variables are still unsaved; "error" here is that same wait having
						// timed out. Both mean the chat-level initialization needs another run.
						const phase = String(state && state.phase || "");
						if (phase === "ready") cancelChatAnnouncements();
						else if (phase === "evaluating" || phase === "error") {
							chatAnnounceWaiting = true;
							scheduleChatAnnouncement();
						}
					},
					onReady: function (readySessionId) {
						if (lease !== currentLease || !active || !readySessionId || !input || input.sessionId !== readySessionId) return;
						if (!String(input.view && input.view.chatId || "")) { void claimWork(); return; }
						return announceChat().finally(function () { void claimWork(); });
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
					if (lease !== currentLease || claimRetryTimer !== null) return;
					const delay = Math.min(2000, 250 * Math.pow(2, Math.min(3, claimRetryCount++)));
					claimRetryTimer = hostWindow.setTimeout(function () {
						claimRetryTimer = null;
						if (lease === currentLease) void claimWork();
					}, delay);
				}
            function recoverExecution(work) {
                if (delivery !== work || lease !== work.lease) return;
                const next = input;
                dispose();
                if (next) sync(next.sessionId, next.view);
            }
            async function deliverWork(work) {
                if (delivery !== work || lease !== work.lease || work.busy) return;
                work.busy = true;
                const identity = { eventId: work.event.id, leaseToken: work.token };
                try {
                    if (work.query || (work.phase === "executing" && !work.receipt)) {
                        const state = await invokeWithDeadline("getTavernScriptWorkState", work.lease, work.runtime.inspect(), Object.assign({}, identity, {
                            keepAlive: Boolean(work.receipt || (work.runtime.eventResponsive && work.runtime.eventResponsive(work.event.id)))
                        }));
                        if (delivery !== work) return;
                        work.query = false;
                        if (state && state.phase === "completed") { delivery = null; scheduleClaimRetry(work.lease); return; }
                        if (!state || state.phase === "unknown") { recoverExecution(work); return; }
                    }
                    if (work.phase === "starting") {
                        const started = await invokeWithDeadline("startTavernScriptWork", work.lease, work.runtime.inspect(), identity);
                        if (delivery !== work) return;
                        if (!started || !started.started) { recoverExecution(work); return; }
                        work.phase = "executing";
                        Promise.resolve().then(function () {
                            return work.runtime.emit(work.event.name, work.event.args, work.event.context, work.diagnostics, work.event.id);
                        }).then(function (args) {
                            work.receipt = Object.assign({}, identity, { args: args, diagnostics: work.diagnostics });
                        }, function (error) {
                            if (error && error.code === "TAVERN_SCRIPT_RUNTIME_UNREACHABLE") { recoverExecution(work); return; }
                            work.receipt = Object.assign({}, identity, { args: work.event.args, error: String(error && error.message || error), diagnostics: work.diagnostics });
                        }).then(function () { if (delivery === work) void deliverWork(work); });
                    }
                    if (work.receipt && delivery === work) {
                        work.phase = "receipt";
                        // Retry this exact outcome. A lost HTTP response is not a script failure.
                        work.query = true;
                        const result = await invokeWithDeadline("completeTavernHelperEvent", work.lease, work.runtime.inspect(), work.receipt);
                        if (delivery !== work) return;
                        if (result && result.completed === true) { delivery = null; scheduleClaimRetry(work.lease); }
                        else if (result && result.completed === false) recoverExecution(work);
                    }
                } catch (error) {
                    if (delivery === work) console.warn("Tavern Script 回执待确认，将查询同一任务", error);
                } finally {
                    work.busy = false;
                    if (delivery === work) scheduleClaimRetry(work.lease);
                    else if (options && options.onIdle) options.onIdle();
                }
            }
				async function claimWork() {
				if (!lease || !runtime || !input || !input.sessionId || !hasScriptRuntime(input.view)) return;
				const currentLease = lease;
				const currentRuntime = runtime;
                if (delivery && delivery.lease === currentLease) { void deliverWork(delivery); return; }
				if (claimBusy === currentLease) { claimRequested = true; return; }
				claimBusy = currentLease;
					let currentEvent = null;
					let leaseToken = "";
				const diagnostics = [];
				try {
					if (releasesPending > 0) await releaseBarrier;
					if (lease !== currentLease) return;
					// A ready viewer cannot advertise settlement readiness: promotion
					// rebuilds the sandbox with the official core before accepting work.
					const inspection = ownershipKnown && !active ? { scripts: [] } : currentRuntime.inspect();
					const result = await invokeWithDeadline("claimTavernScriptWork", currentLease, inspection, {contextBaseline: inspection.contextBaseline || {workContextVersion:1,full:true}, foreground: foreground, pageActive: pageActive()});
					if (lease !== currentLease) {
						if (result && result.active) releaseLease(currentLease);
						return;
					}
					if (result && result.active) claimRetryCount = 0;
					else scheduleClaimRetry(currentLease);
					if (!ownershipKnown || Boolean(result && result.active) !== active) {
						ownershipKnown = true;
						active = Boolean(result && result.active);
						currentRuntime.sync(input.sessionId, runtimeView(input.view));
					}
						currentEvent = result && result.event;
						leaseToken = String(result && result.leaseToken || "");
                        if (active && currentEvent) {
                            delivery = { lease: currentLease, runtime: currentRuntime, event: currentEvent, token: leaseToken, diagnostics: diagnostics, phase: "starting", busy: false };
                            void deliverWork(delivery);
                        }
				} catch (error) {
					if (lease !== currentLease) return;
					console.warn("Tavern Helper 生命周期同步失败", error);

						scheduleClaimRetry(currentLease);
				} finally {
					if (claimBusy === currentLease) claimBusy = null;
					if (lease === currentLease && claimRequested) { claimRequested = false; void claimWork(); }
                        else if (options && options.onIdle) options.onIdle();
				}
			}
			function sync(sessionId, view) {
				const nextSessionId = String(sessionId || "");
				if (!nextSessionId || !hasScriptRuntime(view)) { dispose(); return; }
				if (input && input.sessionId !== nextSessionId) dispose();
				const currentRuntime = ensureRuntime(nextSessionId);
				input = { sessionId: nextSessionId, view: view };
				currentRuntime.sync(nextSessionId, runtimeView(view));
				// Claim also renews the lease and recovers work when its signal was lost.
				if (heartbeatTimer === null && startHeartbeat) heartbeatTimer = startHeartbeat(function () { void claimWork(); }, heartbeatIntervalMs);
				if (stopVisibility === null && hostWindow.document && typeof hostWindow.document.addEventListener === "function") {
					const onVisibility = function () { void claimWork(); };
					hostWindow.document.addEventListener("visibilitychange", onVisibility);
					stopVisibility = function () { hostWindow.document.removeEventListener("visibilitychange", onVisibility); };
				}
				void claimWork();
			}
			return Object.freeze({
				sync: sync, dispose: dispose,
                setForeground: function (value) { const changed = foreground !== value; foreground = value; if (runtime && runtime.setForeground) runtime.setForeground(value); if (changed && lease) void claimWork(); },
				retryMvuLoad: function () { return Boolean(runtime && active && runtime.retryMvuLoad()); },
				triggerButton: function (scriptId, name) {
					if (!runtime || !ownershipKnown) return Promise.reject(new Error("人物卡脚本尚未加载完成"));
					return runtime.triggerButton(scriptId, name);
				},
				inspect: function () { return { active: active, busy: Boolean(delivery || claimBusy), input: input, runtime: runtime && runtime.inspect() }; }
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
		// Descendants share their owner; unfinished games retain separate sandboxes until idle.
		// @include full-template-executor.js

		// @include modules/session-resource-retention.js
		const tavernSessionRetention = createTavernSessionRetention({ window: window });

		function createTavernScriptSessionOwner(options) {
			const hostWindow = options.window || window;
			const sessions = options.sessions;
			const views = options.liveView || liveTavernView;
			const transition = options.transition || tavernSessionTransition;
			const retention = options.retention || (options.window ? createTavernSessionRetention({ window: hostWindow, now: options.now, durationMs: options.retentionMs }) : tavernSessionRetention);
			const listeners = new Set(), records = new Map();
			let snapshot = { sessionId: "", loadState: null };
			let current = null, stopSessions = null, stopTransition = null;
			let started = false, observing = false;
			function publish() {
				snapshot = { sessionId: current ? current.sessionId : "", loadState: current ? current.loadState : null };
				listeners.forEach(function (listener) { listener(); });
			}
			function selectedOwner() {
				let id = String(tavernMainSessionId(sessions) || "");
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
			function release(record) {
				if (records.get(record.sessionId) !== record) return;
				records.delete(record.sessionId);
				if (record.stopRetention) record.stopRetention();
				if (record.stopView) record.stopView();
				if (views.evict) views.evict(record.sessionId);
				record.execution.dispose();
				record.templatePanel.dispose();
			}
			function retire(record) {
                if (records.get(record.sessionId) !== record) return;
                retention.busy(record.sessionId, function () {
                    const state = record.viewState, view = state && state.view || {}, activity = view.activity || {};
                    return !record.fresh || !state || (state.phase !== "ready" && state.phase !== "unavailable")
                        || sessions.list.getSnapshot().byId?.[record.sessionId]?.running === true
                        || activity.busy || activity.phase === "pending" || activity.phase === "running"
                        || view.settleStatus === "running" || record.execution.inspect().busy;
                });
            }
			function syncView(record) {
				if (records.get(record.sessionId) !== record) return;
				if (current === record && transition.getSnapshot()) return;
				const state = record.viewState;
				if (state && state.phase === "ready") {
					const view = state.view || {};
					// Cold getSession may ship stub Helper floors; wait for hydration before scripts.
					if (!view.historyWindow?.onDemand && !view.tavernHelper?.historyAccess && (view.historyWindow || view.tavernHelper && view.tavernHelper.messagesPending)) {
						retire(record);
						return;
					}
					record.execution.sync(record.sessionId, view);
					record.templatePanel.sync(record.sessionId, view);
				}
				retire(record);
			}
			function createRecord(sessionId) {
				const record = { sessionId: sessionId, viewState: null, loadState: null, fresh: false, foregroundRunning: sessions.list.getSnapshot().byId?.[sessionId]?.running === true, stopView: null };
				record.templatePanel = createServerTemplatePanel({ window: hostWindow, rpc: options.rpc || rpc, isActive: () => current === record && tavernMainSessionId(sessions) === record.sessionId });
				record.execution = (options.createExecution || createTavernScriptExecutionModule)({
					window: hostWindow, rpc: options.rpc || rpc, executeSlash: options.executeSlash,
					signals: options.signals || tavernSessionSignals,
					invalidate: function (id) { views.invalidate(id); },
					onIdle: function () { retire(record); },
					onMvuLoadState: function (state) {
						record.loadState = state;
						if (current === record) publish();
					}
				});
				records.set(sessionId, record);
				record.stopRetention = retention.hold(sessionId, record, function () { release(record); });
				return record;
			}
			function select() {
				if (!observing) return;
				const sessionId = selectedOwner();
				// Foreground completion can start settlement before its view signal
				// arrives. Refresh before retiring a retained executor.
				records.forEach(function (record) {
					const running = sessions.list.getSnapshot().byId?.[record.sessionId]?.running === true;
					if (record.foregroundRunning && !running && record !== current) {
						record.fresh = false;
						views.invalidate(record.sessionId);
					}
					record.foregroundRunning = running;
					retire(record);
				});
				if ((current ? current.sessionId : "") === sessionId) {
                    // Child agents keep the root executor alive, but its card UI
                    // belongs only to the actual root conversation surface.
                    const visible = tavernMainSessionId(sessions) === sessionId;
                    if (current?.execution.setForeground) current.execution.setForeground(visible);
                    if (current && !visible) current.templatePanel.close();
                    return;
                }
				const previous = current;
                if (previous) previous.templatePanel.close();
                if (previous && previous.execution.setForeground) previous.execution.setForeground(false);
				retention.select(sessionId);
				hostWindow.__dshTavernSelectedSessionId = sessionId;
				current = sessionId ? records.get(sessionId) || createRecord(sessionId) : null;
                if (current && current.execution.setForeground) current.execution.setForeground(tavernMainSessionId(sessions) === sessionId);
				if (previous) {
					// Do not retire from a cached idle view: the settlement-start
					// notification may still be in flight when navigation happens.
					previous.fresh = false;
					retire(previous);
					views.invalidate(previous.sessionId);
				}
				if (current && !current.stopView) {
					const record = current;
					record.stopView = views.subscribe(sessionId, function (state) {
						if (records.get(sessionId) !== record) return;
						record.viewState = state;
						record.fresh = true;
						syncView(record);
					});
				}
				publish();
			}
			function resume() {
				if (!started || observing) return;
				observing = true;
				stopSessions = sessions.list.subscribe(select);
				stopTransition = transition.subscribe(function () { records.forEach(syncView); });
				select();
			}
			function suspend() {
				observing = false;
				if (stopSessions) stopSessions();
				if (stopTransition) stopTransition();
				stopSessions = stopTransition = null;
				current = null;
				retention.select("");
				hostWindow.__dshTavernSelectedSessionId = "";
				retention.clear();
				records.forEach(release);
				publish();
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
				retryMvuLoad: function () { return Boolean(current && current.execution.retryMvuLoad()); }
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
				failed && state.error ? React.createElement("div", { style: { color: "var(--fork-ink-2, inherit)", overflowWrap: "anywhere" } }, state.error) : null,
				state.canRetry ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", onClick: props.retry }, "重新加载 MVU") : null);
		}
