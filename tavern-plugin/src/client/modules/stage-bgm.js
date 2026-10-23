// The BGM player (docs/design/cast-presentation.md「背景音乐」). One page-wide owner decides what the music transport
// plays for the selected game, in the stage and in chat alike, so opening or leaving the fullscreen stage never
// restarts or doubles a track. 导演选曲 on: the director's accepted track; off: the player's pick (the director's
// choices are still recorded). The mode, the pick and pause last for that game only (localStorage by session id,
// never on the card); the default (follow the director, playing) is not stored.
const TAVERN_BGM_STORAGE = "dsh-tavern-bgm-sessions", TAVERN_BGM_KEEP = 32;
// Previous / next walk the whole list in its order and wrap; from outside the list they enter at an end.
function stageBgmStep(tracks, key, delta) {
	if (!tracks.length) return null;
	const at = tracks.findIndex(track => track.key === key);
	return tracks[at < 0 ? (delta > 0 ? 0 : tracks.length - 1) : (at + delta + tracks.length) % tracks.length];
}
function stageBgmSearch(tracks, query) {
	const q = String(query || "").trim().toLowerCase();
	return q ? tracks.filter(track => (track.name + "\n" + (track.pack || "")).toLowerCase().includes(q)) : tracks;
}

// music: the transport (createStageMusic). sessions: the stage runtime ({ getSnapshot(id), subscribe(id, fn) }), whose
// data carries the stage switch (enabled), the BGM switch (musicEnabled) and the director's track (music); a skip
// (reader mode) snaps instead of fading.
// read(id): the game's track list, { tracks }.
function createStageBgm({ music, sessions, read, storage, now = Date.now }) {
	const listeners = new Set(), lists = new Map();
	let active = null, unsubscribe = null, input = null, snapshot = null;
	let mine = { follow: true, manual: null, paused: false }, recent = [], playback = 0, retried = "", error = false;
	function saved() { try { return JSON.parse(storage?.getItem(TAVERN_BGM_STORAGE) || "{}") || {}; } catch (_) { return {}; } }
	function remember() {
		const all = saved();
		if (!active) return;
		if (mine.follow && !mine.paused) delete all[active];
		else all[active] = { follow: mine.follow, manual: mine.manual, paused: mine.paused, at: now() };
		for (const id of Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(TAVERN_BGM_KEEP)) delete all[id];
		try { storage?.setItem(TAVERN_BGM_STORAGE, JSON.stringify(all)); } catch (_) {}
	}
	// Music plays on the stage: it needs the stage (enabled) and the BGM switch (musicEnabled).
	function inputs(state) {
		const data = state?.data || null, available = !!data && data.enabled !== false;
		return { available, enabled: available && data.musicEnabled !== false,
			card: data?.card?.imageUrl || null, snap: state?.reader?.mode === "skip", cue: data?.music || null };
	}
	const same = (a, b) => !!a && !!b && a.available === b.available && a.enabled === b.enabled && a.card === b.card && a.snap === b.snap &&
		a.cue?.identity === b.cue?.identity && a.cue?.url === b.cue?.url && a.cue?.volume === b.cue?.volume && a.cue?.loopStart === b.cue?.loopStart && a.cue?.loopEnd === b.cue?.loopEnd;
	function target() {
		if (!active || !input?.enabled) return null;
		if (mine.follow) return input.cue && { ...input.cue, source: "director" };
		const pick = mine.manual;
		if (!pick) return null;
		const track = lists.get(active)?.tracks.find(item => item.key === pick.key);
		if (track) return { ...track, source: "manual" };
		// A pick outside the list (the director's track when 导演选曲 went off) keeps that track's own URL.
		const retained = input.cue?.identity === pick.identity ? input.cue : recent.findLast(item => item.identity === pick.identity);
		return { ...pick, url: retained?.url, volume: retained?.volume, loopStart: retained?.loopStart, loopEnd: retained?.loopEnd, source: "manual" };
	}
	function view() {
		const list = lists.get(active), current = target();
		return Object.freeze({ sessionId: active, available: !!input?.available, enabled: !!input?.enabled,
			follow: mine.follow, paused: mine.paused, error, loading: !!list?.loading, tracks: list?.tracks || [],
			cue: input?.cue ? { key: input.cue.key, name: input.cue.name } : null,
			current: current ? { key: current.key, name: current.name, source: current.source } : null });
	}
	function publish() { snapshot = view(); listeners.forEach(fn => fn()); }
	function apply() {
		const goal = target(), playing = music.get();
		publish();
		if (!goal || mine.paused && playing.identity !== goal.identity) {
			playback++;
			// Only the director's own stop fades out; switching off, pausing and skipping stop at once.
			music.stop(!(!goal && input?.enabled && mine.follow && !mine.paused && !input.snap));
			return;
		}
		if (mine.paused) { music.pause(); return; }
		if (playing.identity === goal.identity && playing.current && !playing.error) {
			music.trim(goal.volume, { loopStart: goal.loopStart, loopEnd: goal.loopEnd }); music.resume(); return;
		}
		if (!goal.url) { music.stop(); error = true; publish(); return; }
		if (error) { error = false; publish(); }
		recent = [...recent.filter(item => item.identity !== goal.identity), goal].slice(-4);
		const epoch = ++playback;
		const done = music.play(goal.url, input.snap, goal.identity, { volume: goal.volume, loopStart: goal.loopStart, loopEnd: goal.loopEnd });
		const settled = () => {
			if (epoch !== playback || !music.get().error) { if (epoch === playback) retried = ""; return; }
			// A pick whose lease went stale gets one fresh list; a second failure is shown.
			if (goal.source === "manual" && retried !== goal.identity) { retried = goal.identity; void load(active); }
			else { error = true; publish(); }
		};
		if (done) done.then(settled); else settled();
	}
	async function load(id) {
		const previous = lists.get(id)?.tracks || [];
		lists.set(id, { tracks: previous, loading: true });
		if (id === active) publish();
		let tracks = previous;
		try { tracks = (await read(id))?.tracks || []; } catch (_) { /* Keep the last list; what plays keeps playing. */ }
		lists.set(id, { tracks, loading: false });
		if (id !== active) return;
		// A pick that left the card's packs (and no longer sounds) hands back to the director.
		const pick = mine.manual;
		if (!mine.follow && pick && !tracks.some(track => track.key === pick.key) && music.get().identity !== pick.identity) {
			mine = { ...mine, follow: true, manual: null }; remember();
		}
		apply();
	}
	function changed() {
		const next = inputs(sessions.getSnapshot(active));
		if (same(next, input)) return;
		const previous = input;
		input = next;
		// Another card (or a withdrawn context) is a new authority: what played stops, the list is read again.
		if (next.card !== previous?.card) { playback++; music.stop(); if (next.card) { void load(active); return; } }
		apply();
	}
	function set(next) { mine = { ...mine, ...next }; remember(); apply(); }
	return {
		subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
		get: () => snapshot ||= view(),
		// The game the main view shows, or null.
		activate(id) {
			id = id || null;
			if (id === active) return;
			unsubscribe?.(); unsubscribe = null;
			const value = id ? saved()[id] : null;
			mine = { follow: value?.follow !== false, manual: value?.follow === false && value.manual || null, paused: !!value?.paused };
			retried = ""; error = false; active = id;
			input = inputs(id ? sessions.getSnapshot(id) : null);
			if (!id) { apply(); return; }
			unsubscribe = sessions.subscribe(id, changed);
			void load(id);
		},
		// The list may have changed (the panel opens): read it again; a stale pick re-resolves from it.
		invalidate() { if (active) void load(active); },
		pick(key) {
			const track = lists.get(active)?.tracks.find(item => item.key === key);
			if (track) set({ follow: false, manual: { key: track.key, name: track.name, identity: track.identity }, paused: false });
		},
		step(delta) {
			const next = stageBgmStep(lists.get(active)?.tracks || [], snapshot?.current?.key || input?.cue?.key || "", delta);
			if (next) this.pick(next.key);
		},
		// On: jump to the director's current track. Off: keep what plays as the pick.
		follow(on) {
			const cue = target();
			set(on ? { follow: true, manual: null } : { follow: false, manual: cue ? { key: cue.key, name: cue.name, identity: cue.identity } : null });
		},
		pause(paused) { set({ paused: !!paused }); },
		dispose() {
			unsubscribe?.(); unsubscribe = null; active = null; input = null; playback++;
			music.stop(); listeners.clear();
		}
	};
}
