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

// The reader's pace (CONFIG › 文字 / 声音, features/stage-config.js), this browser's: autoWait = auto paging's pause after a
// line's voice ends; a silent page waits its reading time (by its length) shifted by the same amount; autoSpeed divides
// both waits - a voice is never sped up or cut short. voiceRate: every voice plays this much faster, pitch kept. textSpeed:
// milliseconds per typed glyph (逐字显示, features/stage-typewriter.js; 0 = the whole line at once); auto paging's wait starts
// once the line is typed. The defaults are the stage's own timing.
const STAGE_AUTO = Object.freeze({ wait: 400, speed: 1 });
const STAGE_READING_DEFAULTS = Object.freeze({ textSpeed: 28, autoWait: STAGE_AUTO.wait, autoSpeed: STAGE_AUTO.speed, voiceRate: 1 });
const STAGE_READING_LIMITS = Object.freeze({ textSpeed: [0, 80, 2], autoWait: [0, 3000, 100], autoSpeed: [0.5, 3, 0.1], voiceRate: [0.8, 2, 0.1] }); // [min, max, step]
function stageReadingPrefs(saved) {
	const out = { ...STAGE_READING_DEFAULTS };
	if (!saved || typeof saved !== "object") return out;
	for (const key of Object.keys(STAGE_READING_LIMITS)) {
		const [min, max, step] = STAGE_READING_LIMITS[key], value = Number(saved[key]);
		if (saved[key] !== null && saved[key] !== "" && Number.isFinite(value)) out[key] = Math.max(min, Math.min(max, Number((Math.round(value / step) * step).toFixed(3))));
	}
	return out;
}
// Milliseconds auto paging waits on a page: after its voice was heard, or (silent) for its reading time.
function stageAutoDelay(reading, voiced, text) {
	const hold = Math.max(1500, Math.min(10000, 400 + 70 * Array.from(text || "").length));
	return Math.round((voiced ? reading.autoWait : Math.max(0, hold + reading.autoWait - STAGE_AUTO.wait)) / reading.autoSpeed);
}

// While a view is attached, its session plays the current page: one-shots, reading aloud and
// auto paging. Detaching releases every timer, voice and animation, and whatever else the view
// holds (`release`). The stage's BGM is not the view's: the BGM player follows the selected game
// in chat and stage alike (modules/stage-bgm.js). reading(): the reader's pace (above); held(): auto paging waits while it
// is true (the page's line is still typing, or CONFIG / the backlog is open) and starts the page's wait afresh after.
// 分页 (modules/stage-pager.js): card() = the card of the page on screen, { at, last, text, share } (null: the page is one
// card); auto paging walks a page's cards (nextCard()) before it turns the page. Each card waits its own reading time; on a
// voiced page a card that is not the last turns when the voice reaches its share of the page (speech.progress(), the share
// heard: 0..1 or null), and the last waits autoWait after the voice ends.
function createStageRuntimePlayer({ store, animate, speech, release = () => {}, schedule = setTimeout, cancel = clearTimeout, reading = () => STAGE_READING_DEFAULTS, held = () => false,
	card = () => null, nextCard = () => {} }) {
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
		const shown = beat ? card() : null, last = !shown || shown.last;
		const atEnd = reader.index >= pages.length - 1, paused = held(), next = JSON.stringify([voice, reader.visit, reader.auto, atEnd, paused, shown && [shown.at, shown.last, shown.text]]);
		if (next === plan) return;
		plan = next; halt();
		const current = token, auto = reader.auto && !(atEnd && last) && !paused;
		const turn = () => { timer = null; if (last) store.page(index => index + 1); else nextCard(); };
		if (voice && voice !== spoken) { spoken = voice; heard = speech.speak(beat); }
		let ended = false;
		if (auto && voice && !last && speech.progress) {
			const follow = () => {
				timer = null;
				if (current !== token || ended) return;
				const at = speech.progress();
				if (at !== null && at >= shown.share) turn(); else timer = schedule(follow, 80);
			};
			follow();
		}
		// Auto paging waits for the line to be heard, or for a time by its length.
		(voice ? heard : Promise.resolve(false)).then(ok => {
			ended = true;
			if (!auto || current !== token) return;
			if (timer !== null) cancel(timer);
			timer = schedule(turn, stageAutoDelay(reading(), ok && last, shown ? shown.text : beat ? beat.text : ""));
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
