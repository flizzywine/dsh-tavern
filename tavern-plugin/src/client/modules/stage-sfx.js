// 音效 (docs/design/cast-presentation.md「舞台 core（19/N）：音效」): the stage's one-shot sound player. A cue plays its
// entry's audio once through the page's AudioContext at the entry's 音量 (0..1). A sound rings out across page turns, but
// at most 10 s, then fades out over 0.5 s; at most six sound at once (a further cue is dropped). Decoded sounds are kept by
// URL (the newest 16), so a page's cues decode before its visit plays them. stop() ends every sound, including one still
// decoding.
// context(): the page's AudioContext (or null); output(ctx): where the sounds go, the layer's bus (features/stage-audio.js;
// the context's destination by default); clock: { setTimeout, clearTimeout } on wall time. Bytes are read with the
// BGM transport's bounded reader (modules/stage-music.js stageMusicBytes). sounding(on): true when the first sound starts, false
// when the last one ends (the stage's 避让, features/stage-audio.js).
const STAGE_SFX_LIMITS = Object.freeze({ playMs: 10000, fadeMs: 500, voices: 6, cached: 16 });
function createStageSfx({ context, fetch, clock, output = ctx => ctx.destination, sounding = () => {} }) {
	const buffers = new Map(), shots = new Set();
	let epoch = 0;
	function decode(url) {
		const known = buffers.get(url);
		if (known) { buffers.delete(url); buffers.set(url, known); return known; }
		const ctx = context();
		if (!ctx) return Promise.resolve(null);
		const pending = fetch(url).then(response => {
			if (!response.ok) throw new Error("Sound fetch failed: " + response.status);
			return stageMusicBytes(response);
		}).then(bytes => ctx.decodeAudioData(bytes));
		// A failed read is not kept: the next visit asks again.
		pending.catch(() => { if (buffers.get(url) === pending) buffers.delete(url); });
		buffers.set(url, pending);
		while (buffers.size > STAGE_SFX_LIMITS.cached) buffers.delete(buffers.keys().next().value);
		return pending;
	}
	function release(shot) {
		if (!shots.delete(shot)) return;
		clock.clearTimeout(shot.timer);
		shot.source.onended = null;
		try { shot.source.stop(); } catch (_) {}
		shot.source.disconnect(); shot.gain.disconnect();
		if (!shots.size) sounding(false);
	}
	return {
		prepare(url) { if (url) decode(url).catch(() => {}); },
		// Resolves true once the sound starts, false when it cannot (no audio, a failed read, six already sounding, stopped).
		async play(url, volume = 1) {
			if (!url || shots.size >= STAGE_SFX_LIMITS.voices) return false;
			const mine = epoch;
			let buffer = null;
			try { buffer = await decode(url); } catch (_) { return false; }
			const ctx = context();
			if (!buffer || !ctx || mine !== epoch || shots.size >= STAGE_SFX_LIMITS.voices) return false;
			const level = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
			const gain = ctx.createGain(), source = ctx.createBufferSource();
			gain.gain.value = level; source.buffer = buffer;
			source.connect(gain); gain.connect(output(ctx));
			const shot = { source, gain, timer: 0 };
			shots.add(shot);
			source.onended = () => release(shot);
			source.start();
			if (shots.size === 1) sounding(true);
			if (ctx.state === "suspended") ctx.resume().catch(() => {});
			shot.timer = clock.setTimeout(() => {
				gain.gain.setValueAtTime(level, ctx.currentTime);
				gain.gain.linearRampToValueAtTime(0, ctx.currentTime + STAGE_SFX_LIMITS.fadeMs / 1000);
				shot.timer = clock.setTimeout(() => release(shot), STAGE_SFX_LIMITS.fadeMs);
			}, STAGE_SFX_LIMITS.playMs);
			return true;
		},
		stop() { epoch++; for (const shot of [...shots]) release(shot); },
		sounding: () => shots.size
	};
}
