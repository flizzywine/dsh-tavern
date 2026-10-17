		// Dialogue avatars (docs/design/cast-presentation.md): settlement annotates who says each
		// quoted line; a paragraph holding an annotated line is shown as that speaker's line.
		const TAVERN_CAST_EMOTIONS = { admiration: "钦佩", amusement: "逗乐", anger: "生气", annoyance: "烦躁", approval: "赞同", caring: "关心",
			confusion: "困惑", curiosity: "好奇", desire: "渴望", disappointment: "失望", disapproval: "不满", disgust: "嫌弃",
			embarrassment: "害羞", excitement: "兴奋", fear: "害怕", gratitude: "感激", grief: "悲痛", joy: "开心",
			love: "爱慕", nervousness: "紧张", neutral: "平静", optimism: "期待", pride: "得意", realization: "恍然",
			relief: "释然", remorse: "懊悔", sadness: "难过", surprise: "惊讶" };

		// One request per session for the floors mounted together; refetched on the 'cast' signal.
		const tavernCastStore = (function () {
			const entries = new Map();
			function entryFor(sessionId) {
				let entry = entries.get(sessionId);
				if (!entry) { entry = { version: 0, generation: 0, enabled: true, turns: new Map(), queued: new Set(), timer: null, listeners: new Set(), stop: null }; entries.set(sessionId, entry); }
				return entry;
			}
			function notify(entry) { entry.version += 1; Array.from(entry.listeners).forEach(function (listener) { listener(); }); }
			function invalidate(sessionId) {
				const entry = entries.get(sessionId);
				if (!entry) return;
				entry.enabled = true;
				entry.turns = new Map();
					entry.generation += 1;
				notify(entry);
			}
			function load(sessionId, turn) {
				const entry = entryFor(sessionId);
				if (!entry.enabled || entry.turns.has(turn)) return;
				entry.queued.add(turn);
				if (entry.timer !== null) return;
				entry.timer = window.setTimeout(function () {
					entry.timer = null;
					const generation = entry.generation;
						const turns = Array.from(entry.queued);
					entry.queued.clear();
					turns.forEach(function (item) { entry.turns.set(item, null); });
					rpc("castForTurns", { turns: turns }, sessionId).then(function (result) {
						if (entries.get(sessionId) !== entry || entry.generation !== generation) return;
						entry.enabled = result.enabled !== false;
						turns.forEach(function (item) { entry.turns.set(item, Array.isArray(result.turns && result.turns[item]) ? result.turns[item] : []); });
						notify(entry);
					}, function () {
							if (entries.get(sessionId) !== entry || entry.generation !== generation) return;
							turns.forEach(function (item) { entry.turns.delete(item); });
						});
				}, 0);
			}
			function subscribe(sessionId, listener) {
				const entry = entryFor(sessionId);
				entry.listeners.add(listener);
				if (!entry.stop) {
					let stop = function () {};
					try {
						if (tavernSessionSignals && typeof tavernSessionSignals.subscribe === "function") stop = tavernSessionSignals.subscribe(sessionId, "cast", function () { invalidate(sessionId); });
					} catch (_) {}
					entry.stop = stop;
				}
				return function () {
					entry.listeners.delete(listener);
					if (!entry.listeners.size) { entry.stop(); if (entry.timer !== null) window.clearTimeout(entry.timer); entries.delete(sessionId); }
				};
			}
			if (typeof window.addEventListener === "function") window.addEventListener("dsh-tavern-settings-changed", function () { Array.from(entries.keys()).forEach(invalidate); });
			return {
				subscribe: subscribe, load: load,
				version: function (sessionId) { return entries.get(sessionId) ? entries.get(sessionId).version : 0; },
				lines: function (sessionId, turn) { const entry = entries.get(sessionId); return entry && entry.turns.get(turn) || null; }
			};
		})();

		function useTavernCast(sessionId, turn, enabled) {
			const active = Boolean(enabled && sessionId && turn > 0);
			const subscribe = React.useCallback(function (listener) { return active ? tavernCastStore.subscribe(sessionId, listener) : function () {}; }, [sessionId, active]);
			const version = React.useSyncExternalStore(subscribe, function () { return active ? tavernCastStore.version(sessionId) : 0; });
			React.useEffect(function () { if (active) tavernCastStore.load(sessionId, turn); }, [sessionId, turn, active, version]);
			const lines = active ? tavernCastStore.lines(sessionId, turn) : null;
			return lines && lines.length ? lines : null;
		}

		/** Split text into narration runs and lines holding an annotated quote, matched in order. */
		function tavernCastSegments(text, lines) {
			const source = String(text || "");
			if (!lines || !lines.length || /^\s*(```|~~~)/m.test(source)) return null;
			let cursor = 0;
			const segments = [];
			let narration = [];
			let matched = 0;
			function flush() { if (narration.length) { segments.push({ kind: "text", text: narration.join("\n") }); narration = []; } }
			for (const row of source.split("\n")) {
				let speaker = null;
				const quotes = [];
				for (const range of findTavernQuoteRanges(row)) {
					const quote = row.slice(range[0] + 1, range[1] - 1).trim();
					for (let index = cursor; index < lines.length; index += 1) {
						if (String(lines[index].quote || "").trim() !== quote) continue;
						if (!speaker) speaker = lines[index];
						quotes.push(quote);
						cursor = index + 1;
						matched += 1;
						break;
					}
				}
				if (speaker && row.trim()) { flush(); segments.push({ kind: "line", text: row, speaker: speaker.speaker, emotion: speaker.emotion, quotes: quotes }); }
				else narration.push(row);
			}
			flush();
			return matched ? segments : null;
		}

		function tavernCastHue(name) {
			let hash = 0;
			for (const char of String(name)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
			return hash % 360;
		}

		function TavernCastAvatar(props) {
			const [failed, setFailed] = React.useState(false);
			const name = String(props.speaker || "");
			if (props.imageUrl && !failed) return React.createElement("img", { className: "dsh-tavern-cast-avatar", src: props.imageUrl, alt: "", loading: "lazy", onError: function () { setFailed(true); } });
			return React.createElement("span", { className: "dsh-tavern-cast-avatar dsh-tavern-cast-avatar-letter", "aria-hidden": true, style: { "--dsh-cast-hue": tavernCastHue(name) } }, Array.from(name)[0] || "?");
		}

		function TavernCastSpeak(props) {
			const speech = useTavernSpeechSettings();
			return speech && speech.enabled ? React.createElement(TavernSpeakButton, props) : null;
		}

		/** Render text with annotated lines as speaker rows; falls back to the plain renderer. */
		function renderTavernCastText(text, key, renderText, cast) {
			const segments = cast && tavernCastSegments(text, cast.lines);
			if (!segments) return renderText(text, key);
			const h = React.createElement;
			return h(React.Fragment, { key: key }, segments.map(function (segment, index) {
				if (segment.kind === "text") return segment.text.trim() ? renderText(segment.text, index) : null;
				const own = cast.characterName && segment.speaker === cast.characterName;
				return h("div", { key: index, className: "dsh-tavern-cast-line" },
					h(TavernCastAvatar, { speaker: segment.speaker, imageUrl: own ? cast.characterImageUrl : "" }),
					h("div", { className: "dsh-tavern-cast-body" },
						h("div", { className: "dsh-tavern-cast-head" },
							h("span", { className: "dsh-tavern-cast-name", style: { "--dsh-cast-hue": tavernCastHue(segment.speaker) } }, segment.speaker),
							TAVERN_CAST_EMOTIONS[segment.emotion] && segment.emotion !== "neutral" ? h("span", { className: "dsh-tavern-cast-emotion" }, TAVERN_CAST_EMOTIONS[segment.emotion]) : null,
							cast.sessionId ? h(TavernCastSpeak, { sessionId: cast.sessionId, speaker: segment.speaker, text: segment.quotes.join(" "), emotion: segment.emotion }) : null),
						renderText(segment.text, "text")));
			}));
		}
