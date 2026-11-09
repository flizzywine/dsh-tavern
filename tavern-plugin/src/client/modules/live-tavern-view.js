function createLiveTavernViewModule(options) {
	if (!options || typeof options.load !== "function") throw new Error("Live Tavern View 缺少 load adapter");
	const records = new Map();
	const shouldPoll = typeof options.shouldPoll === "function" ? options.shouldPoll : function (view) { return view && view.settleStatus === "running"; };
	const isTerminalError = typeof options.isTerminalError === "function" ? options.isTerminalError : function () { return false; };
	const scheduleTimer = typeof options.schedule === "function" ? options.schedule : function (run, delay) { return window.setTimeout(run, delay); };
	const cancelTimer = typeof options.cancel === "function" ? options.cancel : function (timer) { window.clearTimeout(timer); };
	const startWatchdog = typeof options.startWatchdog === "function" ? options.startWatchdog : function (run, delay) { return window.setInterval(run, delay); };
	const stopWatchdog = typeof options.stopWatchdog === "function" ? options.stopWatchdog : function (timer) { window.clearInterval(timer); };
	const watchdogIntervalMs = Number(options.watchdogIntervalMs) > 0 ? Number(options.watchdogIntervalMs) : 1000;
	const loadTimeoutMs = Number(options.loadTimeoutMs) > 0 ? Number(options.loadTimeoutMs) : 0;
	const timeoutRetryDelayMs = Number(options.timeoutRetryDelayMs) > 0 ? Number(options.timeoutRetryDelayMs) : 0;
	const idlePollIntervalMs = Number(options.idlePollIntervalMs) > 0 ? Number(options.idlePollIntervalMs) : 0;
	const pollWhileBusy = options.pollWhileBusy !== false;
	const cacheRetentionMs = Number(options.cacheRetentionMs) || 0;
	function initialState() { return { phase: "idle", view: null, error: "", updatedAt: 0 }; }
	function recordFor(sessionId) {
		const id = String(sessionId || "");
		if (!records.has(id)) {
			const record = { id: id, state: initialState(), listeners: new Set(), passiveListeners: 0, paths: dependencyNode(), watchdog: null, optimisticBusy: false, eviction: null, refresh: null, seededView: undefined, emptyReads: 0 };
			record.refresh = createRefresh(record);
			records.set(id, record);
		}
		return records.get(id);
	}
	function dependencyNode() { return { exact: new Set(), all: new Set(), children: new Map() }; }
	function register(root, paths, listener) {
		const nodes = new Set(), leaves = new Set(), edges = [];
		paths.forEach(function (path) {
			let node = root; nodes.add(node);
			path.forEach(function (key) {
				key = String(key);
				if (!node.children.has(key)) node.children.set(key, dependencyNode());
				edges.push([node, key]); node = node.children.get(key); nodes.add(node);
			});
			leaves.add(node);
		});
		nodes.forEach(node => node.all.add(listener));
		leaves.forEach(node => node.exact.add(listener));
		return function () {
			nodes.forEach(node => node.all.delete(listener));
			leaves.forEach(node => node.exact.delete(listener));
			for (let i = edges.length - 1; i >= 0; i--) {
				const [parent, key] = edges[i];
				if (parent.children.get(key)?.all.size === 0) parent.children.delete(key);
			}
		};
	}
	function affected(root, paths) {
		const listeners = new Set(root.exact);
		paths.forEach(function (path) {
			let node = root;
			for (const key of path) {
				node = node.children.get(String(key));
				if (!node) return;
				node.exact.forEach(listener => listeners.add(listener));
			}
			node.all.forEach(listener => listeners.add(listener));
		});
		return listeners;
	}
	function addReceiptStatePaths(paths, before, after) {
		if (Boolean(before?.activity?.busy) !== Boolean(after?.activity?.busy)) paths.push(["$receiptBusy"]);
		if (!Object.is(before?.settlementTurn, after?.settlementTurn)) {
			paths.push(["$settlementOwner", String(before?.settlementTurn)], ["$settlementOwner", String(after?.settlementTurn)]);
		}
	}
	function publish(record, state, result) {
		if (records.get(record.id) !== record) return;
		// A confirmed no-op should not wake every mounted history component.
		// In this opt-in mode updatedAt records the last published state change.
		if (options.deduplicateViews === true && record.state.phase === state.phase
			&& record.state.view === state.view && record.state.error === state.error) return;
		let listeners = record.listeners;
		if (result && result.viewBase === record.state.view && result.viewDelta
			&& record.state.phase === state.phase && record.state.error === state.error) {
			const delta = result.viewDelta;
			const paths = delta.set.map(entry => entry[0]).concat(delta.remove);
			if (paths.some(path => path[0] === "regeneratedDshTurns")) {
				if (Array.isArray(result.storyChanges)) for (const turn of result.storyChanges) paths.push(["$storyHostTurn", String(turn)]);
				else paths.push(["$storyHostTurn"]);
			}
			if (paths.some(path => path[0] === "replyProjections")) {
				const change = result.projectionChanges;
				if (change) {
					for (const turn of change.turns) paths.push(["$projectionTurn", String(turn)]);
					if (change.beforeLatest !== change.afterLatest) {
						paths.push(["$projectionLatestTurn", String(change.beforeLatest)], ["$projectionLatestTurn", String(change.afterLatest)]);
					}
				} else paths.push(["$projectionTurn"], ["$projectionLatestTurn"]);
			}
			// Virtual turn dependencies are separate from positional array paths.
			// Legacy/whole-array edits cannot prove turn locality and invalidate all.
			if (paths.some(path => path[0] === "mvuReceipts")) paths.push(["$mvuReceiptTurn"]);
			if (delta.receiptDelta && (delta.receiptDelta.set.length || delta.receiptDelta.remove.length)) {
				paths.push(["mvuReceipts"]);
				for (const row of delta.receiptDelta.set) paths.push(["$mvuReceiptTurn", String(row.turn)]);
				for (const turn of delta.receiptDelta.remove) paths.push(["$mvuReceiptTurn", String(turn)]);
			}
			if (Boolean(record.state.view?.tavernHelper) !== Boolean(state.view?.tavernHelper)) paths.push(["$helperAvailable"]);
			addReceiptStatePaths(paths, record.state.view, state.view);
			listeners = affected(record.paths, paths);
		} else if (options.deduplicateViews === true && record.state.view && state.view
			&& record.state.phase === state.phase && record.state.error === state.error) {
			// The identity-based mode already requires immutable published views.
			// Hydration and local replacements preserve unrelated field identities:
			// route those updates without enumerating history or all subscribers.
			const before = record.state.view, after = state.view;
			const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
			const paths = [];
			for (const key of keys) if (Object.prototype.hasOwnProperty.call(before, key) !== Object.prototype.hasOwnProperty.call(after, key)
				|| !Object.is(before[key], after[key])) paths.push([key]);
			if (paths.some(path => path[0] === "regeneratedDshTurns")) paths.push(["$storyHostTurn"]);
			if (paths.some(path => path[0] === "replyProjections")) paths.push(["$projectionTurn"], ["$projectionLatestTurn"]);
			if (paths.some(path => path[0] === "mvuReceipts")) paths.push(["$mvuReceiptTurn"]);
			if (Boolean(record.state.view?.tavernHelper) !== Boolean(state.view?.tavernHelper)) paths.push(["$helperAvailable"]);
			addReceiptStatePaths(paths, record.state.view, state.view);
			listeners = affected(record.paths, paths);
		}
		record.state = state;
		listeners.forEach(function (listener) { listener(state); });
	}
	function createRefresh(record) {
		return createSessionRefreshController({
			now: options.now, schedule: scheduleTimer, cancel: cancelTimer, loadTimeoutMs,
			onStart: function () {
				if (record.state.view === null) publish(record, Object.assign({}, record.state, { phase: "loading", error: "" }));
			},
			load: function (scope) {
				// startChat already projected this exact new chat. Consume that view through
				// the normal publish path instead of immediately repeating getSession.
				if (record.seededView !== undefined) {
					const result = record.seededView;
					record.seededView = undefined;
					return result;
				}
				if (record.pendingSeed) return record.pendingSeed.promise;
				return options.load(record.id, { signal: scope.signal });
			},
			onResult: async function (result, scope) {
				let view = result && result.view ? result.view : null;
				// 还没有会话 id 的时候没有任何东西可读：不建记录、不排重试。
				// 以前这条路径会每 1.5 秒发一次 getSession，服务端 200 回一个空视图。
				if (!record.id) {
					publish(record, { phase: "idle", view: null, error: "", updatedAt: record.state.updatedAt });
					return;
				}
				// 「读到了、但没有视图」不是 ready：那只是这一次没读到。标成 ready 之后
				// 这里既没有轮询（pollWhileBusy:false）也没有看门狗（idlePollIntervalMs:0），
				// 谁都不会再来读一次，按钮就一直灰着说「还没有可重新生成的正文」——
				// 玩家只能靠点开「更多」（那里的菜单项一挂载就 invalidate）把它救回来。
				// 重试几次；再读不到就停手，别把读取钉在轮询上。
				if (view === null) {
					record.emptyReads += 1;
					// 服务端明说「这个会话还没有存档」（no-session / no-chat）时，存档正在被建出来，
					// 等它；没带原因的空结果只当作偶发，读几次就停手。
					// no-chat：会话在，存档正在建，值得等。no-session：这个 id 在 DSH 里还没被
					// 加载出来（可能随后就出现），只短等几轮，不能把轮询钉死在一个空 id 上。
					const reason = String(result && result.emptyReason || "");
					const limit = reason === "no-chat" ? 40 : reason === "no-session" ? 4 : 5;
					const delay = reason === "no-chat" ? 1500 : reason === "no-session" ? 1000 : (timeoutRetryDelayMs > 0 ? timeoutRetryDelayMs : 1500);
					if (record.emptyReads <= limit) {
						publish(record, { phase: "retrying", view: record.state.view, error: "", updatedAt: record.state.updatedAt });
						return { retry: delay };
					}
					// 读到底也没有视图：把原因留在 state 上，界面说「这一局还没有开始」，
					// 而不是拿空视图去解释「没有可重新生成的正文」。
					publish(record, { phase: record.state.view ? "ready" : "unavailable", view: record.state.view, error: reason || "empty-view", updatedAt: record.state.updatedAt });
					return;
				}
				record.emptyReads = 0;
				if (pollWhileBusy && record.optimisticBusy && !shouldPoll(view)) return { delay: 200 };
				if (shouldPoll(view)) record.optimisticBusy = false;
				publish(record, { phase: "ready", view: view, error: "", updatedAt: Date.now() }, result);
				if (!scope.isCurrent()) return;
				if (view && !view.historyWindow?.onDemand && !view.tavernHelper?.historyAccess && (view.historyWindow || view.tavernHelper && view.tavernHelper.messagesPending) && typeof options.hydrateHelperMessages === "function") {
					try {
						view = await options.hydrateHelperMessages(record.id, view, { signal: scope.signal }) || view;
						if (!scope.isCurrent()) return;
						publish(record, { phase: "ready", view: view, error: "", updatedAt: Date.now() });
					} catch (hydrateError) {
						if (!scope.isCurrent()) return;
						publish(record, { phase: "retrying", view: view, error: String(hydrateError && hydrateError.message || hydrateError || "补全历史变量失败"), updatedAt: Date.now() });
						return { retry: 1500 };
					}
				}
				if (pollWhileBusy && shouldPoll(view)) return { delay: 200 };
				if (idlePollIntervalMs > 0) return { delay: idlePollIntervalMs };
			},
			onError: function (error, scope) {
				if (!scope.timedOut && isTerminalError(error)) {
					publish(record, { phase: "unavailable", view: null, error: String(error && error.message || error || ""), updatedAt: record.state.updatedAt });
					return null;
				}
				publish(record, { phase: "retrying", view: record.state.view, error: scope.timedOut ? "" : String(error && error.message || error || ""), updatedAt: record.state.updatedAt });
				return { retry: scope.timedOut && timeoutRetryDelayMs > 0
					? timeoutRetryDelayMs
					: (pollWhileBusy && shouldPoll(record.state.view) ? 300 : (idlePollIntervalMs > 0 ? Math.min(1500, idlePollIntervalMs) : 1500)) };
			}
		});
	}
	function invalidate(sessionId) {
		const targets = sessionId === undefined || sessionId === null || sessionId === "" ? Array.from(records.values()) : [recordFor(sessionId)];
		targets.forEach(function (record) {
			// Passive plugin observers share the visible panel's record but never own a
			// network read. The first real reader loads and later invalidations resume.
			if (record.listeners.size === record.passiveListeners) return;
			record.refresh.request();
		});
	}
	function evict(sessionId) {
		const record = records.get(String(sessionId || ""));
		if (!record || record.listeners.size) return false;
		records.delete(record.id);
		record.refresh.stop();
		if (record.eviction !== null) cancelTimer(record.eviction);
		if (record.watchdog !== null) stopWatchdog(record.watchdog);
		return true;
	}

	return {
		// Each selection owns a stable snapshot, including missing-property semantics.
		select: function (sessionId, paths) {
			const module = this;
			paths = paths.map(path => path.map(String));
			if (paths.some(path => path.length === 0)) return {
				getSnapshot: function () { return module.getSnapshot(sessionId); },
				subscribe: function (notify) { return module.subscribe(sessionId, notify); }
			};
			// A selected parent already includes its children. Never write a child
			// through a borrowed parent object while constructing the projection.
			paths = paths.filter((path, i, all) => !all.some((parent, j) =>
				(j < i || parent.length < path.length) && parent.length <= path.length
				&& parent.every((key, depth) => path[depth] === key)));
			let previous = null, values = null;
			function snapshot() {
				const state = module.getSnapshot(sessionId);
				const next = paths.map(function (path) {
					let value = state.view, present = value != null;
					for (const key of path) {
						present = value != null && Object.prototype.hasOwnProperty.call(value, key);
						if (!present) return [false, undefined];
						value = value[key];
					}
					return [present, value];
				});
				if (previous && previous.phase === state.phase && previous.error === state.error
					&& (previous.view === null) === (state.view === null)
					&& next.every((entry, i) => entry[0] === values[i][0] && Object.is(entry[1], values[i][1]))) return previous;
				const view = state.view === null ? null : Object.create(null);
				if (view) paths.forEach(function (path, i) {
					if (!next[i][0]) return;
					let target = view;
					path.slice(0, -1).forEach(key => { target = target[key] || (target[key] = Object.create(null)); });
					target[path[path.length - 1]] = next[i][1];
				});
				values = next;
				return previous = Object.assign({}, state, { view: view });
			}
			return { getSnapshot: snapshot, subscribe: function (notify) { return module.subscribe(sessionId, notify, paths); } };
		},
		evict: evict,
		getSnapshot: function (sessionId) { return recordFor(sessionId).state; },
		expectSeed: function (sessionId) {
			const record = recordFor(sessionId);
			if (record.pendingSeed) return;
			let resolve;
			const promise = new Promise(function (done) { resolve = done; });
			record.pendingSeed = { promise: promise, resolve: resolve };
			record.seededView = undefined;
			record.refresh.replace();
			if (record.listeners.size) record.refresh.request();
		},
		cancelSeed: function (sessionId) {
			const record = recordFor(sessionId), pending = record.pendingSeed;
			if (!pending) return;
			record.pendingSeed = null;
			record.refresh.replace();
			pending.resolve(null);
			if (record.listeners.size > record.passiveListeners) record.refresh.request();
		},
		seed: function (sessionId, view) {
			// 没有视图就没有可种的东西：种一个空视图会让这一局在别人眼里「没有正文」，
			// 而 phase 还是 ready，再没人去重读。
			if (view === null || view === undefined) return;
			const record = recordFor(sessionId);
			const revisionOf = function (value) { return Number((value && value.historyWindow && value.historyWindow.revision) ?? (value && value.tavernHelper && value.tavernHelper.stateRevision)); };
			const nextRevision = revisionOf(view), currentRevision = revisionOf(record.state.view);
			if (record.state.view && Number.isSafeInteger(nextRevision) && Number.isSafeInteger(currentRevision) && nextRevision < currentRevision) {
				if (record.pendingSeed) { const pending = record.pendingSeed; record.pendingSeed = null; pending.resolve({ view: record.state.view }); }
				return;
			}
			const result = { view: view };
			if (record.pendingSeed) { const pending = record.pendingSeed; record.pendingSeed = null; pending.resolve(result); }
			// A story/startChat response is already a complete first-paint view for
			// its consumer. Publish it now; the subscriber's scheduled first refresh
			// consumes seededView and therefore performs no duplicate getSession.
			record.refresh.replace();
			record.seededView = result;
			publish(record, { phase: "ready", view: view, error: "", updatedAt: Date.now() }, result);
			if (record.listeners.size) record.refresh.request();
		},
		setView: function (sessionId, view) {
			const record = recordFor(sessionId);
			// 调用方拿回来的结果偶尔没有 view（失败、被取消、只回了一行状态）。那不是
			// 「这一局没有正文」：当真视图 publish 进去，phase 还是 ready，之后没人再读，
			// 按钮就会一直说「还没有可重新生成的正文」。宁可丢掉这次写入，再读一次。
			if (view === null || view === undefined) {
				if (record.listeners.size > record.passiveListeners) record.refresh.request();
				return function () {};
			}
			if (record.pendingSeed) { const pending = record.pendingSeed; record.pendingSeed = null; pending.resolve({ view: view }); }
			record.seededView = undefined;
			record.refresh.replace();
			const owner = {};
			record.optimisticOwner = owner;
			record.optimisticBusy = shouldPoll(view);
			publish(record, { phase: "ready", view: view, error: "", updatedAt: Date.now() });
			if (pollWhileBusy && shouldPoll(view)) record.refresh.request();
			let released = false;
			return function () {
				if (released) return;
				released = true;
				if (record.optimisticOwner !== owner) return;
				record.optimisticBusy = false;
				if (records.get(record.id) === record) invalidate(sessionId);
			};
		},
		subscribe: function (sessionId, listener, paths, options) {
			const record = recordFor(sessionId);
			if (record.eviction !== null) { cancelTimer(record.eviction); record.eviction = null; }
			const deferred = options && options.deferLoad === true;
			const firstSubscriber = record.listeners.size === 0;
			const firstEagerSubscriber = !deferred && record.listeners.size === record.passiveListeners;
			const unregister = register(record.paths, paths || [[]], listener);
			record.listeners.add(listener);
			if (deferred) record.passiveListeners++;
			listener(record.state);
			if (firstSubscriber) record.refresh.start();
			if (firstEagerSubscriber) record.refresh.request();
			if (record.watchdog === null && (pollWhileBusy || idlePollIntervalMs > 0)) {
				record.watchdog = startWatchdog(function () {
					if (record.listeners.size > record.passiveListeners && ((pollWhileBusy && shouldPoll(record.state.view)) || idlePollIntervalMs > 0)) void record.refresh.refresh();
				}, watchdogIntervalMs);
			}
			return function () {
				unregister();
				record.listeners.delete(listener);
				if (deferred) record.passiveListeners = Math.max(0, record.passiveListeners - 1);
				if (record.listeners.size === 0) {
					record.optimisticBusy = false;
					record.optimisticOwner = null;
					if (cacheRetentionMs > 0 && record.eviction === null) record.eviction = scheduleTimer(function () {
						record.eviction = null;
						if (records.get(record.id) === record) evict(record.id);
					}, cacheRetentionMs);
					record.refresh.stop();
					if (record.watchdog !== null) { stopWatchdog(record.watchdog); record.watchdog = null; }
				}
			};
		},
		invalidate: invalidate
	};
}
