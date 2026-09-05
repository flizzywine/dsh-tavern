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
	function initialState() { return { phase: "idle", view: null, error: "", updatedAt: 0 }; }
	function recordFor(sessionId) {
		const id = String(sessionId || "");
		if (!records.has(id)) records.set(id, { id: id, state: initialState(), listeners: new Set(), timer: null, watchdog: null, loading: false, reloadRequested: false, optimisticBusy: false });
		return records.get(id);
	}
	function publish(record, state) {
		record.state = state;
		record.listeners.forEach(function (listener) { listener(state); });
	}
	function schedule(record, delay) {
		if (record.listeners.size === 0) return;
		if (record.timer !== null) cancelTimer(record.timer);
		record.timer = scheduleTimer(function () {
			record.timer = null;
			void refresh(record);
		}, delay);
	}
	async function refresh(record) {
		if (record.listeners.size === 0) return;
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
			const view = result && result.view ? result.view : null;
			if (pollWhileBusy && record.optimisticBusy && !shouldPoll(view)) {
				schedule(record, 200);
				return;
			}
			if (shouldPoll(view)) record.optimisticBusy = false;
			publish(record, { phase: "ready", view: view, error: "", updatedAt: Date.now() });
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
	return {
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
				invalidate(sessionId);
			};
		},
		subscribe: function (sessionId, listener) {
			const record = recordFor(sessionId);
			record.listeners.add(listener);
			listener(record.state);
			schedule(record, 0);
			if (record.watchdog === null) {
				record.watchdog = startWatchdog(function () {
					if (record.listeners.size > 0 && ((pollWhileBusy && shouldPoll(record.state.view)) || idlePollIntervalMs > 0)) void refresh(record);
				}, watchdogIntervalMs);
			}
			return function () {
				record.listeners.delete(listener);
				if (record.listeners.size === 0) {
					if (record.timer !== null) { cancelTimer(record.timer); record.timer = null; }
					if (record.watchdog !== null) { stopWatchdog(record.watchdog); record.watchdog = null; }
				}
			};
		},
		invalidate: invalidate
	};
}
