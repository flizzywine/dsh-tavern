		// 台词朗读 (plugins' speak()): the host resolves each line in its voice (speechForLine: a voice-service
		// audio URL or a browser system voice) and the one stage voice player (voice.js voicePlayer) plays it, so it follows the
		// master/voice volume and ducking, and any newer line — a bubble's voice too — stops the one being said.
		// speak resolves true when it was heard to the end.
		const tavernSpeech = (function () {
			const OWNER = "tavern-speech";
			let current = null;
			// Read-only counters for live inspect (forkTavernSpeechDiagnostics): line requests, clips the shared player started,
			// the last clips (system speech or a voice-service clip, the stage mixer as it started, heard to the end, how long),
			// and the player state right after the last stop.
			const stats = { requests: 0, started: 0, clips: [], lastStop: null };
			function clipRecord(entry) {
				const mix = forkStageAudio.diagnostics(), track = mix.tracks.find(t => t.layer === "voice");
				const clip = { browserSpeech: Boolean(entry.audio.browserSpeech), at: Date.now(), heard: null, ms: null,
					stage: { speaking: mix.speaking, voice: mix.prefs.voice, master: mix.prefs.master, effective: track ? track.effective : null, duck: track ? track.duck : null, musicDuckDb: mix.ducking.music?.db ?? null } };
				stats.clips = stats.clips.slice(-7).concat([clip]);
				return clip;
			}
			function playerState() {
				const now = voicePlayer.get();
				if (now?.owner !== OWNER) return now ? "other" : "idle";
				return now.loading ? "loading" : now.audio && !now.audio.paused ? "playing" : "paused";
			}
			function stop(owner) {
				if (!current || owner && current.owner !== owner) return;
				const lease = current; current = null; lease.cancelled = true;
				if (voicePlayer.get()?.owner === OWNER) voicePlayer.stopPlayback();
				stats.lastStop = { requests: stats.requests, player: playerState() };
			}
			function diagnostics() {
				const now = voicePlayer.get(), mine = now?.owner === OWNER;
				return { requests: stats.requests, started: stats.started, active: Boolean(current), player: playerState(),
					browserSpeech: mine && now.audio ? Boolean(now.audio.browserSpeech) : null,
					clips: stats.clips.map(c => ({ browserSpeech: c.browserSpeech, heard: c.heard, ms: c.ms, stage: { speaking: c.stage.speaking, voice: c.stage.voice, master: c.stage.master, effective: c.stage.effective, duck: c.stage.duck, musicDuckDb: c.stage.musicDuckDb } })),
					lastStop: stats.lastStop ? { requests: stats.lastStop.requests, player: stats.lastStop.player } : null };
			}
			if (typeof window !== "undefined") window.forkTavernSpeechDiagnostics = diagnostics;
			// One clip through the player: true when it ended on its own, false when stopped, replaced or unplayable.
			function playClip(lease, descriptor, input) {
				return new Promise(function (resolve) {
					let entry = null, ended = false, off = null, clip = null;
					const finish = function (heard) { if (clip && clip.heard === null) { clip.heard = heard; clip.ms = Date.now() - clip.at; } off?.(); off = null; resolve(heard); };
					const check = function () { if (entry && (voicePlayer.get() !== entry || lease.cancelled)) finish(ended && !lease.cancelled); };
					off = voicePlayer.subscribe(check);
					voicePlayer.play(descriptor, input).then(function (started) {
						const now = voicePlayer.get();
						if (!started || lease.cancelled || now?.owner !== OWNER || now.id !== input.id) { finish(false); return; }
						entry = now; stats.started++; clip = clipRecord(entry);
						const onended = entry.audio.onended;
						entry.audio.onended = function () { ended = true; onended?.(); };
					});
				});
			}
			async function speak(input) {
				stop();
				const lines = [{ text: String(input.text || "").trim(), narration: input.narration === true }].filter(line => line.text);
				if (!lines.length) return false;
				const lease = { owner: input.owner, cancelled: false };
				current = lease;
				let heardAny = false;
				try {
					for (const [index, line] of lines.entries()) {
						stats.requests++;
						const reply = await rpc("speechForLine", { speaker: input.speaker || "", text: line.text, emotion: input.emotion || "neutral", narration: line.narration === true }, input.sessionId);
						if (lease.cancelled || !reply) return false;
						// Narration stays silent while the narrator is off; the dialogue goes on.
						if (reply.skip) { if (reply.reason === "narration" || reply.reason === "empty") continue; return false; }
						const text = reply.text || line.text;
						const descriptor = reply.browser ? { available: true, browser: { voice: reply.voice || "", ...(reply.rate === undefined ? {} : { rate: reply.rate }) }, language: "zh-CN" } : { available: true, url: reply.url, loudness: reply.loudness };
						const heard = await playClip(lease, descriptor, { owner: OWNER, id: String(index), text, mood: input.emotion || "neutral",
							cacheKey: JSON.stringify([OWNER, reply.browser ? "browser:" + (reply.voice || "") + ":" + (reply.rate || "") : reply.url, text]) });
						if (!heard) return false;
						heardAny = true;
					}
					return heardAny;
				} catch (error) {
					if (!lease.cancelled) tavernErrorHub.report("配音", error);
					return false;
				} finally {
					if (current === lease) current = null;
				}
			}
			return { speak: speak, stop: stop, diagnostics: diagnostics };
		})();
