		// Background music: one looping track for the page. Plugins say which track plays; the player
		// owns the on/off switch (kept in this browser), so every card's music obeys the same switch.
		const TAVERN_MUSIC_KEY = "dsh-tavern-music-enabled";
		const tavernMusic = (function () {
			let enabled = true;
			try { enabled = window.localStorage.getItem(TAVERN_MUSIC_KEY) !== "off"; } catch (_) {}
			let track = null, audio = null, snapshot = { enabled: enabled, track: null };
			const listeners = new Set(), fades = new WeakMap();
			function publish() { snapshot = { enabled: enabled, track: track }; Array.from(listeners).forEach(function (listener) { listener(); }); }
			function fade(element, target, done) {
				const token = {}; fades.set(element, token);
				const step = function () {
					if (fades.get(element) !== token) return;
					const level = forkStageAudio.level(element);
					if (Math.abs(target - level) <= 0.05) { fades.delete(element); forkStageAudio.level(element, target); if (done) done(); return; }
					forkStageAudio.level(element, Math.min(1, Math.max(0, level + Math.sign(target - level) * 0.05)));
					setTimeout(step, 60);
				};
				step();
			}
			function release() {
				const previous = audio;
				audio = null;
				if (previous) fade(previous, 0, function () { previous.pause(); forkStageAudio.release(previous); });
			}
			function start() {
				if (!enabled || !track || audio || typeof Audio !== "function") return;
				// pauses while DSH Tavern is not in front (foreground.js).
				const element = new Audio(track.url);
				element.loop = true;
				element.volume = 0;
				forkStageAudio.bind(element, "music", track.url, { loudness: track.loudness });
				audio = element;
				element.play().then(function () { if (audio === element) fade(element, track ? track.volume : 0.45); }, function () {});
			}
			return {
				// The same url keeps playing; a new one fades in; an empty one fades out.
				play: function (url, options) {
					const next = typeof url === "string" && url ? url : "";
					if ((track ? track.url : "") === next) return;
					release();
					const volume = options && Number(options.volume);
					track = next ? { url: next, loudness: options?.loudness || { v: 1, lufs: -10, peak: 0 }, title: options && typeof options.title === "string" ? options.title : "", volume: volume >= 0 && volume <= 1 ? volume : 0.45 } : null;
					start();
					publish();
				},
				stop: function () { if (!track) return; release(); track = null; publish(); },
				setEnabled: function (value) {
					enabled = value !== false;
					try { window.localStorage.setItem(TAVERN_MUSIC_KEY, enabled ? "on" : "off"); } catch (_) {}
					if (enabled) start(); else release();
					publish();
				},
				subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
				get: function () { return snapshot; }
			};
		})();
