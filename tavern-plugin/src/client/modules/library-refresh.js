function createCardLibraryRefreshModule(options) {
	const settings = options || {};
	const schedule = typeof settings.schedule === "function" ? settings.schedule : function (run, delay) { return window.setTimeout(run, delay); };
	const cancel = typeof settings.cancel === "function" ? settings.cancel : function (timer) { window.clearTimeout(timer); };
	const activationDelayMs = Number(settings.activationDelayMs) >= 0 ? Number(settings.activationDelayMs) : 100;
	const activeLoads = new Map();
	let activationTimer = null;
	function activate(run) {
		if (activationTimer !== null) cancel(activationTimer);
		activationTimer = schedule(function () {
			activationTimer = null;
			run();
		}, activationDelayMs);
	}
	function load(key, run) {
		const id = String(key || "");
		if (activeLoads.has(id)) return activeLoads.get(id);
		let loaded;
		try { loaded = run(); }
		catch (error) { return Promise.reject(error); }
		let request;
		request = Promise.resolve(loaded).finally(function () { if (activeLoads.get(id) === request) activeLoads.delete(id); });
		activeLoads.set(id, request);
		return request;
	}
	function dispose() {
		if (activationTimer !== null) cancel(activationTimer);
		activationTimer = null;
	}
	return Object.freeze({ activate: activate, load: load, dispose: dispose });
}

function createWorldBookLibraryRefreshModule(options) {
	if (!options || typeof options.load !== "function") throw new Error("世界书库刷新缺少 load adapter");
	let active = null;
	let queued = false;
	let disposed = false;
	let idleWaiters = [];
	function resolveIdle() {
		if (active || queued) return;
		const waiters = idleWaiters;
		idleWaiters = [];
		waiters.forEach(function (resolve) { resolve(); });
	}
	function start() {
		if (disposed) return Promise.resolve();
		if (typeof options.onBusyChange === "function") options.onBusyChange(true);
		let loaded;
		try { loaded = options.load(); }
		catch (error) { loaded = Promise.reject(error); }
		const request = Promise.resolve(loaded).then(function (value) {
			if (!disposed && typeof options.onValue === "function") options.onValue(value);
		}, function (error) {
			if (!disposed && typeof options.onError === "function") options.onError(error);
		}).finally(function () {
			if (active !== request) return;
			active = null;
			if (queued && !disposed) {
				queued = false;
				start();
				return;
			}
			if (typeof options.onBusyChange === "function") options.onBusyChange(false);
			resolveIdle();
		});
		active = request;
		return request;
	}
	return Object.freeze({
		request: function () {
			if (disposed) return Promise.resolve();
			if (active) { queued = true; return active; }
			return start();
		},
		whenIdle: function () {
			if (!active && !queued) return Promise.resolve();
			return new Promise(function (resolve) { idleWaiters.push(resolve); });
		},
		dispose: function () {
			disposed = true;
			queued = false;
			if (typeof options.onBusyChange === "function") options.onBusyChange(false);
			resolveIdle();
		}
	});
}
