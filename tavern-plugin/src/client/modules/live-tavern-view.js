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
		if (!records.has(id)) records.set(id, { id: id, state: initialState(), listeners: new Set(), paths: dependencyNode(), timer: null, watchdog: null, loading: false, reloadRequested: false, optimisticBusy: false, eviction: null, controller: null });
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
	function schedule(record, delay) {
		if (records.get(record.id) !== record || record.listeners.size === 0) return;
		if (record.timer !== null) cancelTimer(record.timer);
		record.timer = scheduleTimer(function () {
			record.timer = null;
			void refresh(record);
		}, delay);
	}
	async function refresh(record) {
		if (records.get(record.id) !== record || record.listeners.size === 0) return;
		if (record.loading) { record.reloadRequested = true; return; }
		record.loading = true;
		if (record.state.view === null) publish(record, Object.assign({}, record.state, { phase: "loading", error: "" }));
		let deadlineExpired = false;
		try {
			let deadlineTimer = null;
			let controller = null;
			let load = null;
			if (loadTimeoutMs > 0) {
				controller = new AbortController();
				record.controller = controller;
				load = Promise.race([
					Promise.resolve(options.load(record.id, { signal: controller.signal })),
					new Promise(function (_resolve, reject) {
						deadlineTimer = scheduleTimer(function () {
							deadlineExpired = true;
							controller.abort();
							reject(new Error("Tavern 状态同步超时"));
						}, loadTimeoutMs);
					})
				]);
			} else load = options.load(record.id, {});
			let result = null;
			try { result = await load; }
			finally { if (deadlineTimer !== null) cancelTimer(deadlineTimer); }
			if (records.get(record.id) !== record) return;
			let view = result && result.view ? result.view : null;
			if (pollWhileBusy && record.optimisticBusy && !shouldPoll(view)) {
				schedule(record, 200);
				return;
			}
			if (shouldPoll(view)) record.optimisticBusy = false;
			publish(record, { phase: "ready", view: view, error: "", updatedAt: Date.now() }, result);
			if (view && view.tavernHelper && view.tavernHelper.messagesPending && typeof options.hydrateHelperMessages === "function") {
				try {
					view = await options.hydrateHelperMessages(record.id, view) || view;
					if (records.get(record.id) !== record) return;
					publish(record, { phase: "ready", view: view, error: "", updatedAt: Date.now() });
				} catch (hydrateError) {
					if (records.get(record.id) !== record) return;
					publish(record, { phase: "retrying", view: view, error: String(hydrateError && hydrateError.message || hydrateError || "补全历史变量失败"), updatedAt: Date.now() });
					schedule(record, 1500);
					return;
				}
			}
			if (pollWhileBusy && shouldPoll(view)) schedule(record, 200);
			else if (idlePollIntervalMs > 0) schedule(record, idlePollIntervalMs);
		} catch (error) {
			const terminal = !deadlineExpired && isTerminalError(error);
			if (terminal) publish(record, { phase: "unavailable", view: null, error: String(error && error.message || error || ""), updatedAt: record.state.updatedAt });
			else {
				publish(record, { phase: "retrying", view: record.state.view, error: deadlineExpired ? "" : String(error && error.message || error || ""), updatedAt: record.state.updatedAt });
				const retryDelay = deadlineExpired && timeoutRetryDelayMs > 0
					? timeoutRetryDelayMs
					: (pollWhileBusy && shouldPoll(record.state.view) ? 300 : (idlePollIntervalMs > 0 ? Math.min(1500, idlePollIntervalMs) : 1500));
				schedule(record, retryDelay);
			}
		} finally {
			record.loading = false;
			record.controller = null;
			if (record.reloadRequested) { record.reloadRequested = false; schedule(record, 0); }
		}
	}
	function invalidate(sessionId) {
		const targets = sessionId === undefined || sessionId === null || sessionId === "" ? Array.from(records.values()) : [recordFor(sessionId)];
		targets.forEach(function (record) {
			if (record.loading) record.reloadRequested = true;
			else schedule(record, 0);
		});
	}
	function evict(sessionId) {
		const record = records.get(String(sessionId || ""));
		if (!record || record.listeners.size) return false;
		records.delete(record.id);
		if (record.timer !== null) cancelTimer(record.timer);
		if (record.eviction !== null) cancelTimer(record.eviction);
		if (record.watchdog !== null) stopWatchdog(record.watchdog);
		if (record.controller) record.controller.abort();
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
		setView: function (sessionId, view) {
			const record = recordFor(sessionId);
			record.optimisticBusy = shouldPoll(view);
			publish(record, { phase: "ready", view: view, error: "", updatedAt: Date.now() });
			if (pollWhileBusy && shouldPoll(view)) schedule(record, 0);
			let released = false;
			return function () {
				if (released) return;
				released = true;
				record.optimisticBusy = false;
				if (records.get(record.id) === record) invalidate(sessionId);
			};
		},
		subscribe: function (sessionId, listener, paths) {
			const record = recordFor(sessionId);
			if (record.eviction !== null) { cancelTimer(record.eviction); record.eviction = null; }
			const firstSubscriber = record.listeners.size === 0;
			const unregister = register(record.paths, paths || [[]], listener);
			record.listeners.add(listener);
			listener(record.state);
			if (firstSubscriber) schedule(record, 0);
			if (record.watchdog === null && (pollWhileBusy || idlePollIntervalMs > 0)) {
				record.watchdog = startWatchdog(function () {
					if (record.listeners.size > 0 && ((pollWhileBusy && shouldPoll(record.state.view)) || idlePollIntervalMs > 0)) void refresh(record);
				}, watchdogIntervalMs);
			}
			return function () {
				unregister();
				record.listeners.delete(listener);
				if (record.listeners.size === 0) {
					if (cacheRetentionMs > 0 && record.eviction === null) record.eviction = scheduleTimer(function () {
						record.eviction = null;
						if (records.get(record.id) === record) evict(record.id);
					}, cacheRetentionMs);
					if (record.timer !== null) { cancelTimer(record.timer); record.timer = null; }
					if (record.watchdog !== null) { stopWatchdog(record.watchdog); record.watchdog = null; }
				}
			};
		},
		invalidate: invalidate
	};
}
