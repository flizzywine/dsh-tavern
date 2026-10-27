		// Dialogue avatars (docs/design/cast-presentation.md): the story model writes each spoken line as a dialogue bubble
		// naming its speaker, shown as that speaker's row from the moment the line starts streaming (32/N). The chat reads
		// the rows from the text alone; a turn's stored lines are for the stage and plugins.
		const TAVERN_CAST_EMOTIONS = CAST_EMOTIONS;

		// One request per session for the floors mounted together; refetched on the 'cast' signal.
		const tavernCastStore = (function () {
			const entries = new Map(), none = Object.freeze([]);
			function entryFor(sessionId) {
				let entry = entries.get(sessionId);
				// `shown`: 对话气泡 as the host last answered (null before its first answer); `asked`: a request is out or answered.
				if (!entry) { entry = { version: 0, generation: 0, enabled: true, shown: null, asked: false, characters: [], turns: new Map(), queued: new Set(), timer: null, listeners: new Set(), stop: null }; entries.set(sessionId, entry); }
				return entry;
			}
			function notify(entry) { entry.version += 1; Array.from(entry.listeners).forEach(function (listener) { listener(); }); }
			function invalidate(sessionId) {
				const entry = entries.get(sessionId);
				if (!entry) return;
				entry.enabled = true;
				entry.asked = false;
				entry.turns = new Map();
					entry.generation += 1;
				notify(entry);
			}
			// `turn` 0 asks only for the session's switch and characters (a reply still streaming has no lines yet).
			function load(sessionId, turn) {
				const entry = entryFor(sessionId);
				if (turn ? !entry.enabled || entry.turns.has(turn) : entry.asked) return;
				if (turn) entry.queued.add(turn);
				entry.asked = true;
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
						entry.shown = entry.enabled;
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
				shown: function (sessionId) { const entry = entries.get(sessionId); return entry ? entry.shown : null; },
				characters: function (sessionId) { const entry = entries.get(sessionId); return entry ? entry.characters : none; },
				lines: function (sessionId, turn) { const entry = entries.get(sessionId); return entry && entry.turns.get(turn) || null; }
			};
		})();

		/**
		 * A floor's cast: null while 对话气泡 is off or not yet known; else the session's characters and, once the turn is
		 * settled, its lines (`[]` without any). A reply still streaming asks only for the switch and the characters.
		 */
		function useTavernCast(sessionId, turn, enabled, settled) {
			const active = Boolean(enabled && sessionId && turn > 0), linesActive = active && Boolean(settled);
			const subscribe = React.useCallback(function (listener) { return active ? tavernCastStore.subscribe(sessionId, listener) : function () {}; }, [sessionId, active]);
			// Subscribe to this floor's lines only: another floor's lines arriving (one request per
			// newly mounted floor) must not re-render every floor of a long game (#249).
			const lines = React.useSyncExternalStore(subscribe, function () { return linesActive ? tavernCastStore.lines(sessionId, turn) : null; });
			const shown = React.useSyncExternalStore(subscribe, function () { return active ? tavernCastStore.shown(sessionId) : null; });
			const characters = React.useSyncExternalStore(subscribe, function () { return active ? tavernCastStore.characters(sessionId) : null; });
			const generation = React.useSyncExternalStore(subscribe, function () { return active ? tavernCastStore.generation(sessionId) : 0; });
			React.useEffect(function () {
				if (linesActive && lines === null) tavernCastStore.load(sessionId, turn);
				else if (active && !linesActive) tavernCastStore.load(sessionId, 0);
			}, [sessionId, turn, active, linesActive, lines, generation]);
			return React.useMemo(function () { return shown ? { characters: characters, lines: lines || [] } : null; }, [shown, characters, lines]);
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

		function TavernCastRow(props) {
			const h = React.createElement, cast = props.cast;
			return h("div", { className: "dsh-tavern-cast-line" },
				h(TavernCastAvatar, { speaker: props.speaker, imageUrl: tavernCastLineAvatar(cast, props.speaker, props.emotion) }),
				h("div", { className: "dsh-tavern-cast-body" },
					h("div", { className: "dsh-tavern-cast-head" },
						h("span", { className: "dsh-tavern-cast-name", style: { "--dsh-cast-hue": tavernCastHue(props.speaker) } }, props.speaker),
						TAVERN_CAST_EMOTIONS[props.emotion] && props.emotion !== "neutral" ? h("span", { className: "dsh-tavern-cast-emotion" }, TAVERN_CAST_EMOTIONS[props.emotion]) : null,
						// A line still streaming has nothing to read aloud yet.
						cast.sessionId && props.speech ? h(TavernCastSpeak, { sessionId: cast.sessionId, speaker: props.speaker, text: props.speech, emotion: props.emotion }) : null),
					props.children));
		}

		/**
		 * Text with its dialogue bubbles as speaker rows, while it streams too: a bubble is its speaker's row as soon as its
		 * text starts (an unfinished thought has no closing bracket yet), and a last line still too short to read shows
		 * nothing. Without speakers (对话气泡 off) each bubble reads as `name：“line”`; the raw markup never shows.
		 */
		function renderTavernDialogueText(text, key, renderText, cast, streaming) {
			const h = React.createElement;
			const source = String(text ?? ""), segments = source.indexOf("@") >= 0 ? parseBubbles(source, streaming) : null;
			if (!cast || !segments || !segments.some(function (segment) { return segment.kind === "bubble"; })) return renderText(segments ? dialogueBubblePlainText(segments) : source, key);
			return h(React.Fragment, { key: key }, segments.map(function (segment, index) {
				if (segment.kind === "markdown") return renderText(segment.text, index);
				const speaker = bubbleSpeaker(segment), character = tavernCastCharacter(cast.characters, speaker);
				return h(TavernCastRow, { key: index, cast: cast, speaker: speaker, emotion: bubbleEmotion(segment.mood), speech: bubbleSpeech(segment, voiceTranslates(character && character.voiceLanguage)) },
					renderText(segment.thought ? "（" + segment.text + (segment.streaming ? "" : "）") : segment.text, "text"));
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
				try { const result = await rpc(method, args, props.sessionId); props.onCast(result.cast); window.dispatchEvent(new CustomEvent("dsh-tavern-cast-assets-changed")); setNotice(done(result)); return true; }
				catch (error) { setNotice("失败：" + String(error.message || error)); return false; }
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
			// A reference clip with what it says (配音 22/N); the words come first, then the file.
			function addReference(name, text, done) {
				pick("audio/wav,audio/x-wav,audio/mpeg,audio/ogg,audio/flac,.wav,.mp3,.ogg,.flac", async function (file) {
					const data64 = await readTavernFile(file);
					await run("castAddVoiceReference", { name: name, text: text, data: data64 }, function () { done(); return "已为 " + name + " 加上参考音频"; });
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
							onSave: function (provider, voice) { void run("castSetVoice", { name: name, provider: provider, voice: voice }, function () { return voice ? "已保存 " + name + " 的声音" : "已清除 " + name + " 的声音"; }); },
							onSource: function (provider, clone) { void run("castSetVoiceSource", { name: name, provider: provider, clone: clone }, function () { return "已保存 " + name + " 的配音来源"; }); },
							onLanguage: function (language) { void run("castSetVoiceLanguage", { name: name, language: language }, function () { return "已保存 " + name + " 的配音语言"; }); } }),
						h("button", { type: "button", disabled: busy, onClick: function () { upload(name, "avatar"); } }, "换头像"),
						h("button", { type: "button", disabled: busy, onClick: function () { upload(name, emotion); } }, "加" + TAVERN_CAST_EMOTIONS[emotion] + "立绘"),
						character && !character.plugin ? h("button", { type: "button", disabled: busy, onClick: function () { void run("castRemoveCharacter", { name: character.name }, function () { return "已清除 " + character.name + " 的素材"; }); } }, "清除") : null,
						h(TavernCastVoiceSource, { name: name, character: character, busy: busy,
							onAdd: function (text, done) { addReference(name, text, done); },
							onRemove: function (file) { void run("castRemoveVoiceReference", { name: name, file: file }, function () { return "已删除 " + name + " 的一段参考音频"; }); } }));
				})),
				notice ? h("p", { role: "status", className: "dsh-tavern-settings-desc" }, notice) : null);
		}
