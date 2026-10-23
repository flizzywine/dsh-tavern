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
				if (!entry) { entry = { version: 0, generation: 0, enabled: true, characters: [], turns: new Map(), queued: new Set(), timer: null, listeners: new Set(), stop: null }; entries.set(sessionId, entry); }
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
						if (Array.isArray(result.characters)) entry.characters = result.characters;
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
			if (typeof window.addEventListener === "function") {
				window.addEventListener("dsh-tavern-settings-changed", function () { Array.from(entries.keys()).forEach(invalidate); });
				window.addEventListener("dsh-tavern-cast-assets-changed", function () { Array.from(entries.keys()).forEach(invalidate); });
			}
			return {
				subscribe: subscribe, load: load,
				version: function (sessionId) { return entries.get(sessionId) ? entries.get(sessionId).version : 0; },
				generation: function (sessionId) { return entries.get(sessionId) ? entries.get(sessionId).generation : 0; },
				characters: function (sessionId) { const entry = entries.get(sessionId); return entry ? entry.characters : []; },
				lines: function (sessionId, turn) { const entry = entries.get(sessionId); return entry && entry.turns.get(turn) || null; }
			};
		})();

		function useTavernCast(sessionId, turn, enabled) {
			const active = Boolean(enabled && sessionId && turn > 0);
			const subscribe = React.useCallback(function (listener) { return active ? tavernCastStore.subscribe(sessionId, listener) : function () {}; }, [sessionId, active]);
			// Subscribe to this floor's lines only: another floor's lines arriving (one request per
			// newly mounted floor) must not re-render every floor of a long game (#249).
			const lines = React.useSyncExternalStore(subscribe, function () { return active ? tavernCastStore.lines(sessionId, turn) : null; });
			const generation = React.useSyncExternalStore(subscribe, function () { return active ? tavernCastStore.generation(sessionId) : 0; });
			React.useEffect(function () { if (active && lines === null) tavernCastStore.load(sessionId, turn); }, [sessionId, turn, active, lines, generation]);
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
			// A click shows the picture full size.
			if (props.imageUrl && !failed) {
				const open = function (event) { event.stopPropagation(); openSceneImagePreview(props.imageUrl, event.currentTarget, null, null, null, name ? name + "的头像" : "头像"); };
				return React.createElement("img", { className: "dsh-tavern-cast-avatar is-zoomable", src: props.imageUrl, alt: "", loading: "lazy", role: "button", tabIndex: 0, "aria-label": "放大" + (name ? name + "的" : "") + "头像", title: "点击放大",
					onClick: open, onKeyDown: function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(event); } }, onError: function () { setFailed(true); } });
			}
			return React.createElement("span", { className: "dsh-tavern-cast-avatar dsh-tavern-cast-avatar-letter", "aria-hidden": true, style: { "--dsh-cast-hue": tavernCastHue(name) } }, Array.from(name)[0] || "?");
		}

		function TavernCastSpeak(props) {
			const speech = useTavernSpeechSettings();
			return speech && speech.enabled ? React.createElement(TavernSpeakButton, props) : null;
		}

		// The picture beside a line: the speaker's avatar for its emotion, that emotion's sprite, their avatar, the card image.
		function tavernCastLineAvatar(cast, name, emotion) {
			const character = tavernCastCharacter(cast.characters, name);
			const avatars = character && character.avatars || {}, sprites = character && character.sprites || {};
			return avatars[emotion] || sprites[emotion] || character && character.avatarUrl || (cast.characterName && name === cast.characterName ? cast.characterImageUrl : "");
		}

		/** Render text with annotated lines as speaker rows; falls back to the plain renderer. */
		function renderTavernCastText(text, key, renderText, cast) {
			const segments = cast && tavernCastSegments(text, cast.lines);
			if (!segments) return renderText(text, key);
			const h = React.createElement;
			return h(React.Fragment, { key: key }, segments.map(function (segment, index) {
				if (segment.kind === "text") return segment.text.trim() ? renderText(segment.text, index) : null;
				return h("div", { key: index, className: "dsh-tavern-cast-line" },
					h(TavernCastAvatar, { speaker: segment.speaker, imageUrl: tavernCastLineAvatar(cast, segment.speaker, segment.emotion) }),
					h("div", { className: "dsh-tavern-cast-body" },
						h("div", { className: "dsh-tavern-cast-head" },
							h("span", { className: "dsh-tavern-cast-name", style: { "--dsh-cast-hue": tavernCastHue(segment.speaker) } }, segment.speaker),
							TAVERN_CAST_EMOTIONS[segment.emotion] && segment.emotion !== "neutral" ? h("span", { className: "dsh-tavern-cast-emotion" }, TAVERN_CAST_EMOTIONS[segment.emotion]) : null,
							cast.sessionId ? h(TavernCastSpeak, { sessionId: cast.sessionId, speaker: segment.speaker, text: segment.quotes.join(" "), emotion: segment.emotion }) : null),
						renderText(segment.text, "text")));
			}));
		}

		// Cast material (sprites, avatars, voices) for the stage, edited in 舞台素材.
		function readTavernFile(file) {
			return new Promise(function (resolve, reject) {
				const reader = new FileReader();
				reader.onload = function () { resolve(String(reader.result).replace(/^data:[^,]*,/, "")); };
				reader.onerror = function () { reject(reader.error || new Error("读取文件失败")); };
				reader.readAsDataURL(file);
			});
		}

		function TavernCastManager(props) {
			const h = React.createElement;
			const data = props.data;
			const [busy, setBusy] = React.useState(false);
			const [notice, setNotice] = React.useState("");
			const [emotion, setEmotion] = React.useState("neutral");
			const speakers = [];
			function add(name) {
				if (!name || name === data.player) return;
				const character = tavernCastCharacter(data.cast, name);
				const label = character ? character.name : name;
				if (speakers.indexOf(label) < 0) speakers.push(label);
			}
			add(data.card.name);
			(data.cast || []).forEach(function (character) { add(character.name); });
			(data.turns || []).forEach(function (turn) { (turn.lines || []).forEach(function (line) { add(line.speaker); }); });
			async function run(method, args, done) {
				setBusy(true); setNotice("");
				try { const result = await rpc(method, args, props.sessionId); props.onCast(result.cast); window.dispatchEvent(new CustomEvent("dsh-tavern-cast-assets-changed")); setNotice(done(result)); }
				catch (error) { setNotice("失败：" + String(error.message || error)); }
				finally { setBusy(false); }
			}
			function pick(accept, handle) {
				const input = document.createElement("input");
				input.type = "file"; input.accept = accept;
				input.onchange = function () { const file = input.files && input.files[0]; if (file) void handle(file); };
				input.click();
			}
			function upload(name, slot) {
				pick("image/png,image/jpeg,image/webp,image/gif", async function (file) {
					const data64 = await readTavernFile(file);
					await run("castSetImage", { name: name, slot: slot, data: data64 }, function () { return "已保存 " + name + " 的" + (slot === "avatar" ? "头像" : TAVERN_CAST_EMOTIONS[slot] + "立绘"); });
				});
			}
			function importPack() {
				pick(".zip,application/zip", async function (file) {
					const data64 = await readTavernFile(file);
					await run("castImportSpritePack", { data: data64 }, function (result) { return "导入 " + result.imported + " 张立绘（" + result.characters.join("、") + "）" + (result.skipped ? "，跳过 " + result.skipped + " 个文件" : ""); });
				});
			}
			return h("section", { className: "dsh-tavern-cast-manager" },
				h("div", { className: "dsh-tavern-cast-manager-head" }, h("strong", null, "角色素材"),
					h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: importPack }, "导入 ST 立绘包")),
				h("p", { className: "dsh-tavern-settings-desc" }, "立绘按情绪命名（joy.png、sadness.png…）。单人立绘包导入给「" + (data.card.name || "主角") + "」，多人立绘包按文件夹名对应人物。"),
				h("label", { className: "dsh-tavern-cast-manager-emotion" }, "上传立绘的情绪",
					h("select", { value: emotion, onChange: function (event) { setEmotion(event.target.value); } },
						Object.keys(TAVERN_CAST_EMOTIONS).map(function (key) { return h("option", { key: key, value: key }, TAVERN_CAST_EMOTIONS[key] + " · " + key); }))),
				h("ul", null, speakers.map(function (name) {
					const character = tavernCastCharacter(data.cast, name);
					const count = character ? Object.keys(character.sprites || {}).length : 0;
					return h("li", { key: name, className: "dsh-tavern-cast-manager-row" },
						h(TavernCastAvatar, { speaker: name, imageUrl: tavernCastImage(data, name, "neutral", true) }),
						h("span", { className: "dsh-tavern-cast-manager-name" }, name, h("small", null, count ? count + " 张立绘" : "暂无立绘")),
						h(TavernCastVoiceField, { sessionId: props.sessionId, name: name, character: character, busy: busy,
							onSave: function (provider, voice) { void run("castSetVoice", { name: name, provider: provider, voice: voice }, function () { return voice ? "已保存 " + name + " 的声音" : "已清除 " + name + " 的声音"; }); } }),
						h("button", { type: "button", disabled: busy, onClick: function () { upload(name, "avatar"); } }, "换头像"),
						h("button", { type: "button", disabled: busy, onClick: function () { upload(name, emotion); } }, "加" + TAVERN_CAST_EMOTIONS[emotion] + "立绘"),
						character && !character.plugin ? h("button", { type: "button", disabled: busy, onClick: function () { void run("castRemoveCharacter", { name: character.name }, function () { return "已清除 " + character.name + " 的素材"; }); } }, "清除") : null);
				})),
				notice ? h("p", { role: "status", className: "dsh-tavern-settings-desc" }, notice) : null);
		}
