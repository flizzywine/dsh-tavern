		// Plugin music (tavernUi.playMusic): one looping track for the page. Plugins say which track plays; the player
		// owns the on/off switch (kept in this browser), so every plugin's music obeys the same switch. The stage's own
		// BGM is the BGM player's (modules/stage-bgm.js), not this one.
		const TAVERN_MUSIC_KEY = "dsh-tavern-music-enabled";
		const tavernMusic = (function () {
			let enabled = true;
			try { enabled = window.localStorage.getItem(TAVERN_MUSIC_KEY) !== "off"; } catch (_) {}
			let track = null, audio = null, snapshot = { enabled: enabled, track: null };
			const listeners = new Set();
			function publish() { snapshot = { enabled: enabled, track: track }; Array.from(listeners).forEach(function (listener) { listener(); }); }
			function fade(element, target, done) {
				const step = function () {
					if (Math.abs(target - element.volume) <= 0.05) { element.volume = target; if (done) done(); return; }
					element.volume = Math.min(1, Math.max(0, element.volume + Math.sign(target - element.volume) * 0.05));
					setTimeout(step, 60);
				};
				step();
			}
			function release() {
				const previous = audio;
				audio = null;
				if (previous) fade(previous, 0, function () { previous.pause(); });
			}
			function start() {
				if (!enabled || !track || audio || typeof Audio !== "function") return;
				const element = new Audio(track.url);
				element.loop = true;
				element.volume = 0;
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
					track = next ? { url: next, title: options && typeof options.title === "string" ? options.title : "", volume: volume >= 0 && volume <= 1 ? volume : 0.45 } : null;
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
		function useTavernMusic() {
			return React.useSyncExternalStore(tavernMusic.subscribe, tavernMusic.get);
		}

		/** The plugin music switch beside the stage; shown only while a plugin's track is meant to play. */
		function TavernMusicToggle() {
			const h = React.createElement;
			const music = useTavernMusic();
			if (!music.track) return null;
			const label = music.enabled ? "关闭音乐" : "打开音乐";
			return h("button", { type: "button", className: music.enabled ? "is-on" : "", "aria-pressed": music.enabled, "aria-label": label,
				title: (music.track.title ? "♪ " + music.track.title + "\n" : "") + label,
				onClick: function () { tavernMusic.setEnabled(!music.enabled); } }, music.enabled ? "♪ 音乐" : "♪ 静音");
		}
