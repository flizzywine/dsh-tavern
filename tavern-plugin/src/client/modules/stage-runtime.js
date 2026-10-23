// The reading position belongs to the session: closing and reopening the stage returns to
// the same page. A new body opens on its first page live; the first read only restores.
const EMPTY_STAGE_READER = Object.freeze({ key: "", index: 0, visit: 0, mode: "refresh", auto: false });
const stageReaderPages = data => data?.turns.at(-1)?.pages || [];
function nextStageReader(reader, previous, data) {
	const key = data.turns.at(-1)?.key || "";
	if (key !== reader.key) return { ...reader, key, index: 0, visit: reader.visit + 1, mode: previous ? "live" : "refresh" };
	const last = Math.max(0, stageReaderPages(data).length - 1);
	return reader.index > last ? { ...reader, index: last } : reader;
}

// A read-only session snapshot. Refresh never clears accepted presentation.
const EMPTY_STAGE_RUNTIME = Object.freeze({ data: null, scene: null, reader: EMPTY_STAGE_READER, pending: false, error: "" });
function createStageRuntimeStore({ read, project, changed }) {
	let state = EMPTY_STAGE_RUNTIME, revision = 0, dirty = false, disposed = false, flight = null, request = null;
	function publish(next) { state = next; changed(); }
	function move(reader) { if (!disposed) publish({ ...state, reader: { ...state.reader, ...reader } }); }
	async function drain() {
		while (dirty && !disposed) {
			dirty = false;
			const token = revision;
			request = new AbortController();
			try {
				const value = await read(request.signal);
				if (disposed || token !== revision) continue;
				const data = JSON.stringify(value) === JSON.stringify(state.data) ? state.data : value;
				const candidate = data === state.data ? state.scene : project(data);
				const scene = JSON.stringify(candidate) === JSON.stringify(state.scene) ? state.scene : candidate;
				const reader = data === state.data ? state.reader : nextStageReader(state.reader, state.data, data);
				publish({ data, scene, reader, pending: false, error: "" });
			} catch (error) {
				if (!disposed && token === revision) publish({ ...state, pending: false, error: String(error.message || error) });
			}
		}
	}
	const store = {
		getSnapshot: () => state,
		refresh(reset = false) {
			if (disposed) return Promise.resolve();
			revision++; dirty = true;
			if (reset) { request?.abort(); state = { ...EMPTY_STAGE_RUNTIME, reader: { ...EMPTY_STAGE_READER, visit: state.reader.visit } }; }
			if (!state.pending) publish({ ...state, pending: true, error: "" });
			if (!flight) flight = Promise.resolve().then(drain).finally(() => { flight = null; if (dirty && !disposed) return store.refresh(); });
			return flight;
		},
		// Every page turn is a new visit; skip and restore are visits that never play.
		page(value, mode = "page") {
			const current = state.reader.index, last = Math.max(0, stageReaderPages(state.data).length - 1);
			const index = Math.max(0, Math.min(last, typeof value === "function" ? value(current) : value));
			if (index !== current || mode !== "page") move({ index, visit: state.reader.visit + 1, mode });
		},
		setAuto(auto) { if (state.reader.auto !== auto) move({ auto }); },
		restore() { move({ visit: state.reader.visit + 1, mode: "refresh", auto: false }); },
		dispose() { disposed = true; dirty = false; revision++; request?.abort(); publish(EMPTY_STAGE_RUNTIME); }
	};
	return store;
}

// While a view is attached, its session plays the current page: one-shots, reading aloud and
// auto paging. Detaching releases every timer, voice and animation, and whatever else the view
// holds (`release`). The stage's BGM is not the view's: the BGM player follows the selected game
// in chat and stage alike (modules/stage-bgm.js).
function createStageRuntimePlayer({ store, animate, speech, release = () => {}, schedule = setTimeout, cancel = clearTimeout }) {
	const performances = createStagePerformancePlayback({ play: animate, schedule, cancel });
	let attached = true, plan = "", spoken = "", heard = Promise.resolve(false), timer = null, token = 0;
	function halt() { token++; if (timer !== null) cancel(timer); timer = null; }
	function update() {
		if (!attached) return;
		const { data, reader } = store.getSnapshot();
		const latest = data?.turns.at(-1), pages = latest?.pages || [], beat = pages[reader.index];
		performances.update({ id: reader.key + ":" + reader.visit, at: reader.index + 1, mode: data ? reader.mode : "refresh", events: latest?.performances || [] });
		const voice = data && beat && reader.mode !== "skip" && speech.on() ? JSON.stringify([reader.key, reader.visit, beat]) : "";
		if (!voice && spoken) { spoken = ""; speech.stop(); }
		const atEnd = reader.index >= pages.length - 1, next = JSON.stringify([voice, reader.visit, reader.auto, atEnd]);
		if (next === plan) return;
		plan = next; halt();
		const current = token, auto = reader.auto && !atEnd;
		const delay = Math.max(1500, Math.min(10000, 400 + 70 * Array.from(beat ? beat.text : "").length));
		if (voice && voice !== spoken) { spoken = voice; heard = speech.speak(beat); }
		// Auto paging waits for the line to be heard, or for a time by its length.
		(voice ? heard : Promise.resolve(false)).then(ok => {
			if (auto && current === token) timer = schedule(() => { timer = null; store.page(index => index + 1); }, ok ? 400 : delay);
		});
	}
	function detach() {
		if (!attached) return;
		attached = false; halt(); performances.dispose(); release();
		if (spoken) speech.stop();
	}
	return { update, detach };
}

// The game the main view shows (a subagent's view is not a game); the BGM player follows it too.
function selectedStageSession(snapshot) {
	const rows = snapshot.byId || {};
	const selected = Object.values(rows).find(row => row.retainedBy?.mainView > 0)?.id || snapshot.current;
	return selected && rows[selected]?.origin !== "subagent" ? selected : null;
}

// Native bindings own stores, not React mounts. Only open the selected session;
// keep previously opened sessions until removal, and retire replaced bindings.
function createStageRuntimeSessions({ read, project, watch }) {
	const records = new Map(), listeners = new Map();
	function notify(id) { for (const fn of listeners.get(id) || []) fn(); }
	function release(id) {
		const record = records.get(id);
		record.player?.detach(); record.stop(); records.delete(id); record.store.dispose();
	}
	return {
		getSnapshot: id => records.get(id)?.store.getSnapshot() || EMPTY_STAGE_RUNTIME,
		subscribe(id, fn) {
			if (!listeners.has(id)) listeners.set(id, new Set());
			listeners.get(id).add(fn);
			return () => { const set = listeners.get(id); set.delete(fn); if (!set.size) listeners.delete(id); };
		},
		refresh: id => records.get(id)?.store.refresh(),
		page: (id, value, mode) => records.get(id)?.store.page(value, mode),
		setAuto: (id, auto) => records.get(id)?.store.setAuto(auto),
		sync: id => records.get(id)?.player?.update(),
		// One attached view plays a session. Reopening restores its page without replaying it.
		attach(id, view) {
			const record = records.get(id);
			if (!record) return () => {};
			record.player?.detach();
			const player = record.player = createStageRuntimePlayer({ store: record.store, ...view });
			record.store.restore();
			return () => { player.detach(); if (record.player === player) record.player = null; };
		},
		start(sessions) {
			function reconcile() {
				const snapshot = sessions.list.getSnapshot(), rows = snapshot.byId || {};
				const selected = selectedStageSession(snapshot);
				for (const id of records.keys()) if (!rows[id] && id !== selected) release(id);
				const ids = new Set(records.keys());
				if (selected) ids.add(selected);
				for (const id of ids) {
					const binding = sessions.binding(id), previous = records.get(id);
					if (previous?.binding === binding) continue;
					if (previous) release(id);
					if (!binding) continue;
					const store = createStageRuntimeStore({ read: signal => read(id, signal), project, changed: () => { record.player?.update(); notify(id); } });
					const record = { binding, store, player: null, stop() {} };
					records.set(id, record);
					record.stop = watch(id, binding, reset => store.refresh(reset));
					void store.refresh();
				}
			}
			const stop = sessions.list.subscribe(reconcile);
			reconcile();
			return () => { stop(); for (const id of records.keys()) release(id); };
		}
	};
}
