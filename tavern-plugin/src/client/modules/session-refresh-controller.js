// One owner for a session's asynchronous reads. Notifications request work;
// accepted replacements revoke it. Neither notification storms nor watchdogs
// may shorten the retry deadline or let retired work publish into a new lifetime.
function createSessionRefreshController(options) {
	const now = options.now || Date.now;
	const schedule = options.schedule || ((run, delay) => window.setTimeout(run, delay));
	const cancel = options.cancel || (timer => window.clearTimeout(timer));
	let active = false, epoch = 0, operation = null, timer = null, timerAt = 0;
	let requested = false, retryAt = 0;
	function clearTimer() {
		const previous = timer;
		timer = null;
		if (previous !== null) cancel(previous.handle);
	}
	function revoke() {
		epoch++;
		clearTimer();
		requested = false;
		retryAt = 0;
		const previous = operation;
		operation = null;
		if (previous) {
			if (previous.deadline !== null) cancel(previous.deadline);
			previous.controller.abort();
		}
	}
	function request(delay = 0) {
		if (!active) return;
		if (operation) { requested = true; return; }
		const due = Math.max(now() + Math.max(0, delay), retryAt);
		// Keep an earlier wake-up: frequent invalidations cannot starve a read.
		if (timer !== null && timerAt <= due) return;
		clearTimer();
		timerAt = due;
		const pending = { handle: null };
		timer = pending;
		pending.handle = schedule(function () {
			if (timer !== pending) return;
			timer = null;
			void run();
		}, Math.max(0, due - now()));
	}
	async function run() {
		if (!active) return;
		if (operation) { requested = true; return; }
		if (now() < retryAt) { request(); return; }
		clearTimer();
		const task = { epoch, controller: new AbortController(), deadline: null };
		operation = task;
		const current = () => active && operation === task && task.epoch === epoch;
		let timedOut = false, next = null;
		const scope = { signal: task.controller.signal, isCurrent: () => current() && !timedOut };
		let abort;
		try {
			const cancelled = new Promise(function (_resolve, reject) {
				abort = () => reject(new Error(timedOut ? "Tavern 状态同步超时" : "Tavern 状态同步已取消"));
				task.controller.signal.addEventListener("abort", abort, { once: true });
			});
			if (options.loadTimeoutMs > 0) task.deadline = schedule(function () {
				if (!current()) return;
				timedOut = true;
				task.controller.abort();
			}, options.loadTimeoutMs);
			const loading = Promise.race([Promise.resolve().then(() => {
				if (!current()) throw new Error("会话读取已取消");
				return options.load(scope);
			}), cancelled]);
			if (options.onStart) options.onStart(scope);
			const result = await loading;
			if (!current()) return;
			// Hydration is part of this read's lifetime and deadline too.
			next = await Promise.race([options.onResult(result, scope), cancelled]);
			if (!current()) return;
			retryAt = next && next.retry !== undefined ? now() + next.retry : 0;
		} catch (error) {
			if (!current()) return;
			next = options.onError(error, { ...scope, timedOut });
			if (!current()) return;
			if (next && next.retry !== undefined) retryAt = now() + next.retry;
			else { retryAt = 0; requested = false; }
		} finally {
			if (task.deadline !== null) cancel(task.deadline);
			if (abort) task.controller.signal.removeEventListener("abort", abort);
			// A retired task must not clear or reschedule its successor.
			if (operation === task) {
				operation = null;
				const pending = requested;
				requested = false;
				if (pending) request();
				else if (next) request(next.retry === undefined ? next.delay : next.retry);
			}
		}
	}
	return {
		start() { if (!active) { active = true; epoch++; } },
		stop() { active = false; revoke(); },
		replace: revoke,
		request,
		// Watchdogs use the same scheduling/backoff gate as ordinary wake-ups.
		refresh: run
	};
}
