function createTavernRuntimeGenerationMonitor(options) {
	const settings = options || {};
	const load = typeof settings.load === "function" ? settings.load : function () { return Promise.resolve(null); };
	const refresh = typeof settings.refresh === "function" ? settings.refresh : function () {};
	const schedule = typeof settings.schedule === "function" ? settings.schedule : function (run, delay) { return window.setTimeout(run, delay); };
	const cancel = typeof settings.cancel === "function" ? settings.cancel : function (timer) { window.clearTimeout(timer); };
	const intervalMs = Math.max(5000, Number(settings.intervalMs) || 30000);
	let observed = "";
	let timer = null;
	let started = false;
	let refreshing = false;
	function observe(value) {
		const next = String(value || "");
		if (!next) return false;
		if (!observed) { observed = next; return false; }
		if (next === observed || refreshing) return false;
		observed = next;
		refreshing = true;
		Promise.resolve().then(refresh).catch(function (error) {
			refreshing = false;
			console.warn("DSH Tavern 前端自动刷新失败", error);
		});
		return true;
	}
	function queue() {
		if (!started || timer !== null) return;
		timer = schedule(check, intervalMs);
	}
	function check() {
		timer = null;
		return Promise.resolve().then(load).then(function (result) {
			observe(result && result.runtimeGeneration);
		}, function () {}).finally(queue);
	}
	function stop() {
		started = false;
		if (timer !== null) cancel(timer);
		timer = null;
	}
	return Object.freeze({
		observe: observe,
		start: function () { if (!started) { started = true; void check(); } return stop; },
		stop: stop,
		inspect: function () { return { observed: observed, refreshing: refreshing, started: started }; }
	});
}
