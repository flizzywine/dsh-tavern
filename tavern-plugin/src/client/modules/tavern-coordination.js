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
		const connection = record.connection;
		record.connection = null;
		if (connection && connection.handle) connection.handle.close();
	}
	function connect(record) {
		if (record.listeners.size === 0 || record.connection !== null) return;
		const owner = { handle: null };
		record.connection = owner;
		const current = () => record.connection === owner && record.listeners.size > 0;
		owner.handle = options.connect(record.id, {
			message: function (view) {
				if (!current()) return;
				publish(record, { phase: "ready", view: view || null, error: "", updatedAt: Date.now() });
				if (current() && typeof options.onView === "function") options.onView(record.id, view || null);
			},
			error: function (error) {
				if (!current()) return;
				publish(record, { phase: "retrying", view: record.state.view, error: String(error && error.message || ""), updatedAt: record.state.updatedAt });
			}
		});
		if (!current()) { owner.handle?.close(); return; }
		// Reconcile even when subscribe synchronously replays a cached snapshot.
		if (owner.handle && typeof owner.handle.refresh === "function") owner.handle.refresh();
	}
	function invalidate(sessionId) {
		const targets = sessionId === undefined || sessionId === null || sessionId === "" ? Array.from(records.values()) : [recordFor(sessionId)];
		targets.forEach(function (record) {
			if (record.connection?.handle && typeof record.connection.handle.refresh === "function") {
				record.connection.handle.refresh();
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
			record.connection?.handle?.supersede?.();
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

// HTTP and signal snapshots share the same publication owner. Reconnect always
// requests an authoritative HTTP baseline after any synchronous cached replay.
function createTavernCoordinationConnection(options) {
	let active = true, reconcile = true;
	const view = options.view || (result => result);
	const controller = createSessionRefreshController({
		now: options.now, schedule: options.schedule, cancel: options.cancel,
		loadTimeoutMs: options.loadTimeoutMs === undefined ? 10000 : options.loadTimeoutMs,
		load: scope => options.load({ signal: scope.signal }),
		onResult(result) {
			reconcile = false;
			options.handlers.message(view(result));
		},
		onError(error) {
			options.handlers.error(error);
			return { retry: options.retryDelayMs || 5000 };
		}
	});
	controller.start();
	const stop = options.subscribe(function (signal) {
		if (!active) return;
		if (signal && signal.snapshot) {
			controller.replace();
			options.handlers.message(view(signal.snapshot));
			if (reconcile) controller.request();
		} else controller.request();
	}, function (error) {
		if (!active) return;
		options.handlers.error(error);
		controller.request();
	}, function () {
		if (!active) return;
		reconcile = true;
		controller.replace();
		controller.request();
	});
	return {
		refresh: () => controller.request(),
		supersede: () => { reconcile = false; controller.replace(); },
		close() { if (!active) return; active = false; controller.stop(); stop(); }
	};
}
