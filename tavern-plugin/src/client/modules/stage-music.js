// The stage's BGM transport (docs/design/cast-presentation.md「背景音乐」): one decoded buffer per live track, looped
// natively by the audio render thread; crossfades between tracks, pause/resume and a fading stop.
// Loop points (asset-library music loopStart/loopEnd, seconds of decoded PCM): the intro plays once, then
// [loopStart, loopEnd) repeats. Without them the silent head and tail are trimmed and one short equal-power
// overlap is baked into the tail, so the native loop wraps with no timer or decode at the seam.
function stageMusicLoop(buffer, points = {}) {
	const rate = buffer.sampleRate, length = buffer.length;
	if (points.loopStart !== undefined && points.loopEnd <= buffer.duration && points.loopStart < points.loopEnd) {
		return { offset: 0, start: points.loopStart, end: points.loopEnd, fallback: false };
	}
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
	const audible = i => channels.some(channel => Math.abs(channel[i]) > .001);
	let start = 0, end = length;
	while (start < end && !audible(start)) start++;
	while (end > start && !audible(end - 1)) end--;
	if (start === end) return { offset: 0, start: 0, end: buffer.duration, fallback: true };
	const overlap = Math.min(Math.round(rate * .04), Math.floor((end - start) / 4));
	const tails = channels.map(channel => channel.slice(end - overlap, end));
	for (let i = 0; i < overlap; i++) {
		const phase = i / Math.max(1, overlap - 1) * Math.PI / 2;
		for (const channel of channels) channel[end - overlap + i] = channel[end - overlap + i] * Math.cos(phase) + channel[start + i] * Math.sin(phase);
	}
	return { offset: start / rate, start: (start + overlap) / rate, end: end / rate, fallback: true,
		restore() { channels.forEach((channel, i) => channel.set(tails[i], end - overlap)); } };
}
// Bounded read: a track is decoded whole, so its bytes are capped before decoding.
async function stageMusicBytes(response) {
	const limit = 60 * 1024 * 1024, reader = response.body?.getReader();
	if (!reader) {
		const bytes = await response.arrayBuffer();
		if (bytes.byteLength > limit) throw new Error("Music exceeds decode limit");
		return bytes;
	}
	const chunks = []; let length = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > limit) { await reader.cancel(); throw new Error("Music exceeds decode limit"); }
			chunks.push(value);
		}
	} finally { reader.releaseLock(); }
	const bytes = new Uint8Array(length); let at = 0;
	for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
	return bytes.buffer;
}

// context(): the page's AudioContext (or null). A track's voice is input -> fade envelope -> the entry's volume
// (its authored 0..1 trim) -> output. clock: { now, setTimeout, clearTimeout } on wall time, so fades finish in a
// hidden window too.
function createStageMusic({ context, fetch, clock }) {
	let a = null, b = null, current = "", currentIdentity = null, fade = 0, handoff = null, stopping = null, failure = null;
	const listeners = new Set();
	let decoding = Promise.resolve();
	const emit = () => listeners.forEach(fn => fn());
	const trimOf = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
	function voice(ctx, volume) {
		const input = ctx.createGain(), envelope = ctx.createGain(), trim = ctx.createGain();
		input.connect(envelope); envelope.connect(trim); trim.connect(ctx.destination);
		envelope.gain.value = 0; trim.gain.value = trimOf(volume);
		let level = 0;
		return { input,
			level(value) { if (value === undefined) return level; level = value; envelope.gain.setValueAtTime(value, ctx.currentTime); },
			trim(value) { trim.gain.value = trimOf(value); },
			release() { input.disconnect(); envelope.disconnect(); trim.disconnect(); } };
	}
	const level = (track, value) => track?.voice ? track.voice.level(value) : 0;
	function position(track) {
		if (!track) return 0;
		let time = track.offset + (track.source ? track.context.currentTime - track.started : 0);
		if (track.loop && time >= track.loop.end) time = track.loop.start + (time - track.loop.start) % (track.loop.end - track.loop.start);
		return time;
	}
	function pause(track) {
		if (!track) return;
		track.offset = position(track); track.paused = true;
		if (track.source) { track.source.stop(); track.source.disconnect(); track.source.buffer = null; track.source = null; }
	}
	function release(track) {
		if (!track) return;
		track.cancel.abort(); pause(track); track.voice?.release(); track.voice = null; track.buffer = null; track.loop = null;
	}
	function start(track) {
		if (!track || !track.buffer || track.source || track !== a) return;
		const ctx = track.context, source = ctx.createBufferSource();
		source.buffer = track.buffer; source.loop = true; source.loopStart = track.loop.start; source.loopEnd = track.loop.end;
		source.connect(track.voice.input); source.start(0, track.offset);
		track.source = source; track.started = ctx.currentTime; track.paused = false;
		if (ctx.state === "suspended") ctx.resume().catch(() => {});
	}
	function settle() {
		clock.clearTimeout(fade);
		release(b); b = null;
		handoff?.(); handoff = null; stopping = null;
	}
	function configure(track, points) {
		if (!track || track.points.loopStart === points.loopStart && track.points.loopEnd === points.loopEnd) return;
		track.points = { loopStart: points.loopStart, loopEnd: points.loopEnd };
		if (!track.buffer) return;
		const wasPaused = track.paused;
		// Started sources hold their PCM; a point edit also replaces any baked tail.
		pause(track); track.loop.restore?.(); track.loop = stageMusicLoop(track.buffer, track.points);
		track.offset = position(track); track.paused = wasPaused;
		if (!wasPaused) start(track);
	}
	return {
		subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
		get() { return { current, identity: currentIdentity, paused: !a || a.paused, error: failure, position: position(a), loopStart: a?.loop?.start, loopEnd: a?.loop?.end }; },
		// The same identity only resumes (a renewed lease URL is the same track); a new one crossfades in.
		play(url, snap = false, identity, { fadeMs = 1200, volume, loopStart, loopEnd } = {}) {
			if (!url) return this.stop();
			identity ??= url;
			if (identity === currentIdentity && current && !failure) { this.trim(volume, { loopStart, loopEnd }); this.resume(); return; }
			if (a && !a.buffer && b) { release(a); a = b; b = null; }
			settle();
			if (a && !a.buffer) { release(a); a = null; }
			b = a;
			const track = { cancel: new AbortController(), paused: false, offset: 0, source: null, buffer: null, points: { loopStart, loopEnd } };
			a = track; current = url; currentIdentity = identity; failure = null;
			const complete = new Promise(resolve => { handoff = resolve; });
			// Decoding is not abortable: loads run one at a time, so rapid picks never pile up decoded buffers.
			decoding = decoding.then(async () => {
				if (track.cancel.signal.aborted) return;
				try {
					const ctx = context();
					if (!ctx) throw new Error("Web Audio unavailable");
					track.context = ctx;
					const response = await fetch(url, { signal: track.cancel.signal });
					if (!response.ok) throw new Error("Music fetch failed: " + response.status);
					const bytes = await stageMusicBytes(response);
					const buffer = await ctx.decodeAudioData(bytes);
					if (track !== a || track.cancel.signal.aborted) return;
					if (buffer.duration > 900 || buffer.numberOfChannels > 2 || buffer.length * buffer.numberOfChannels * 4 > 384 * 1024 * 1024) throw new Error("Unsupported music decode size");
					track.buffer = buffer; track.loop = stageMusicLoop(buffer, track.points); track.offset = track.loop.offset;
					track.voice = voice(ctx, volume);
					if (!track.paused) start(track);
					const previous = b, from = level(previous);
					if (snap || fadeMs === 0 || track.paused) { level(track, 1); settle(); emit(); return; }
					const at = clock.now();
					function step() {
						const t = Math.min(1, (clock.now() - at) / Math.max(1, fadeMs));
						level(previous, from * (1 - t)); level(track, t);
						if (t < 1) fade = clock.setTimeout(step, 16);
						else { settle(); emit(); }
					}
					fade = clock.setTimeout(step, 16); emit();
				} catch (error) {
					if (track !== a || track.cancel.signal.aborted) return;
					failure = String(error.message || error); release(track); a = null; settle(); emit();
				}
			});
			emit(); return complete;
		},
		pause() { if (!current) return; settle(); level(a, 1); pause(a); emit(); },
		resume() { if (!a) return; a.paused = false; start(a); emit(); },
		trim(volume, points) { a?.voice?.trim(volume); if (points) configure(a, points); },
		// A stop fades out over 1.2 s (a new track may interrupt it); snap stops at once.
		stop(snap = true) {
			if (!snap && stopping) return stopping;
			clock.clearTimeout(fade); handoff?.(); handoff = null; stopping = null;
			const tracks = [a, b].filter(Boolean), levels = tracks.map(track => level(track));
			tracks.forEach(track => track.cancel.abort());
			current = ""; currentIdentity = null; failure = null;
			const finish = () => { tracks.forEach(release); a = b = null; handoff?.(); handoff = null; stopping = null; emit(); };
			if (snap || tracks.every(track => !track.source)) { finish(); return; }
			stopping = new Promise(resolve => { handoff = resolve; });
			const at = clock.now();
			function step() {
				const t = Math.min(1, (clock.now() - at) / 1200);
				tracks.forEach((track, i) => level(track, levels[i] * (1 - t)));
				if (t < 1) fade = clock.setTimeout(step, 16); else finish();
			}
			fade = clock.setTimeout(step, 16); emit(); return stopping;
		}
	};
}
