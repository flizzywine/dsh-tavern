		// The stage (docs/design/cast-presentation.md): another view of the same story. A small
		// stage in the right panel, expandable to a full-screen visual-novel reader. It only reads
		// the story text, its dialogue annotations and the card's character material.
		const tavernCastSettings = (function () {
			let enabled = null, loading = null;
			const listeners = new Set();
			function load() {
				if (loading) return loading;
				loading = rpc("getTavernSettings").then(function (result) { enabled = result.settings && result.settings.castPresentation === true; },
					function () { enabled = false; }).finally(function () { loading = null; listeners.forEach(function (listener) { listener(); }); });
				return loading;
			}
			if (typeof window.addEventListener === "function") window.addEventListener("dsh-tavern-settings-changed", function () { void load(); });
			return {
				subscribe: function (listener) { listeners.add(listener); if (enabled === null) void load(); return function () { listeners.delete(listener); }; },
				get: function () { return enabled === true; }
			};
		})();
		function useTavernCastEnabled() {
			return React.useSyncExternalStore(tavernCastSettings.subscribe, tavernCastSettings.get);
		}

		function useTavernCastStage(sessionId) {
			const live = useLiveTavernView(sessionId, "cast-stage", [["settlementTurn"], ["updatedAt"]]);
			const turnKey = live.view ? String(live.view.settlementTurn || 0) + ":" + String(live.view.updatedAt || 0) : "";
			const [state, setState] = React.useState({ data: null, error: "" });
			const [version, setVersion] = React.useState(0);
			React.useEffect(function () {
				let stop = function () {};
				try { if (tavernSessionSignals && typeof tavernSessionSignals.subscribe === "function") stop = tavernSessionSignals.subscribe(sessionId, "cast", function () { setVersion(function (value) { return value + 1; }); }); } catch (_) {}
				const onSettings = function () { setVersion(function (value) { return value + 1; }); };
				window.addEventListener("dsh-tavern-settings-changed", onSettings);
				return function () { stop(); window.removeEventListener("dsh-tavern-settings-changed", onSettings); };
			}, [sessionId]);
			const refresh = React.useCallback(function () { setVersion(function (value) { return value + 1; }); }, []);
			React.useEffect(function () {
				let active = true;
				rpc("castStage", { count: 5 }, sessionId).then(function (data) { if (active) setState({ data: data, error: "" }); },
					function (error) { if (active) setState(function (current) { return { data: current.data, error: String(error.message || error) }; }); });
				return function () { active = false; };
			}, [sessionId, turnKey, version]);
			return Object.assign({}, state, { refresh: refresh, setData: function (data) { setState({ data: data, error: "" }); } });
		}

		/** A turn as reading beats: narration paragraphs and annotated lines, in order. */
		function tavernStageBeats(turn) {
			const segments = tavernCastSegments(turn.text, turn.lines) || [{ kind: "text", text: turn.text }];
			const beats = [];
			segments.forEach(function (segment) {
				if (segment.kind === "line") beats.push({ kind: "line", text: segment.text.trim(), speaker: segment.speaker, emotion: segment.emotion, quotes: segment.quotes || [], turn: turn.turn });
				else segment.text.split("\n").map(function (row) { return row.trim(); }).filter(Boolean).forEach(function (row) { beats.push({ kind: "narration", text: row, turn: turn.turn }); });
			});
			return beats;
		}

		function tavernCastCharacter(cast, name) {
			return (cast || []).find(function (item) { return item.name === name || (item.aliases || []).indexOf(name) >= 0; }) || null;
		}
		// The best image for a character in an emotion: that sprite, then calm, any sprite, the avatar.
		function tavernCastImage(data, name, emotion, preferAvatar) {
			const character = tavernCastCharacter(data.cast, name);
			const sprites = character ? character.sprites || {} : {};
			const sprite = sprites[emotion] || sprites.neutral || Object.values(sprites)[0] || "";
			const avatar = character && character.avatarUrl || (name === data.card.name ? data.card.imageUrl : "");
			return preferAvatar ? avatar || sprite : sprite || avatar;
		}

		function TavernStageFigure(props) {
			const [failed, setFailed] = React.useState("");
			const h = React.createElement;
			const url = failed === props.url ? "" : props.url;
			return h("div", { className: "dsh-tavern-stage-figure" + (props.speaking ? " is-speaking" : "") + (props.dim ? " is-dim" : ""), "data-speaker": props.name },
				h("div", { className: "dsh-tavern-stage-figure-body" },
					url ? h("img", { key: url, src: url, alt: props.name, onError: function () { setFailed(props.url); } })
						: h("span", { className: "dsh-tavern-stage-figure-letter", style: { "--dsh-cast-hue": tavernCastHue(props.name) } }, Array.from(props.name)[0] || "?")));
		}

		/** One stage frame: who is on stage at this beat, and the text box. */
		function TavernStageScene(props) {
			const h = React.createElement;
			const data = props.data, beats = props.beats, index = props.index;
			const beat = beats[index] || null;
			const present = [], emotions = new Map();
			for (let at = 0; at <= index && at < beats.length; at += 1) {
				const item = beats[at];
				if (item.kind !== "line" || item.speaker === data.player) continue;
				if (present.indexOf(item.speaker) < 0) present.push(item.speaker);
				emotions.set(item.speaker, item.emotion);
			}
			const shown = present.slice(-3);
			return h("div", { className: "dsh-tavern-stage-scene" + (props.fullscreen ? " is-fullscreen" : ""), onClick: props.onAdvance },
				data.background ? h("div", { className: "dsh-tavern-stage-backdrop is-scene", style: { "--dsh-stage-backdrop": "url(\"" + data.background + "\")" } })
					: h("div", { className: "dsh-tavern-stage-backdrop", style: data.card.imageUrl ? { "--dsh-stage-backdrop": "url(\"" + data.card.imageUrl + "\")" } : undefined }),
				h("div", { className: "dsh-tavern-stage-figures" }, shown.map(function (name) {
					return h(TavernStageFigure, { key: name, name: name, url: tavernCastImage(data, name, emotions.get(name)), speaking: beat && beat.speaker === name, dim: beat && beat.kind === "line" && beat.speaker !== name });
				})),
				beat ? h("div", { className: "dsh-tavern-stage-textbox" },
					beat.kind === "line" ? h("div", { className: "dsh-tavern-stage-name", style: { "--dsh-cast-hue": tavernCastHue(beat.speaker) } }, beat.speaker,
						TAVERN_CAST_EMOTIONS[beat.emotion] && beat.emotion !== "neutral" ? h("span", { className: "dsh-tavern-cast-emotion" }, TAVERN_CAST_EMOTIONS[beat.emotion]) : null) : null,
					h("div", { key: index, className: "dsh-tavern-stage-text" + (beat.kind === "narration" ? " is-narration" : "") }, beat.text),
					props.footer || null)
					: h("div", { className: "dsh-tavern-stage-textbox is-empty" }, props.empty || "还没有可以演出的正文"));
		}

		/** The stage data as plugins see it (tavernUi.getStage). */
		function tavernStagePublicData(data) {
			return { enabled: data.enabled !== false, player: data.player, card: data.card, background: data.background || "", characters: data.cast || [], turns: data.turns || [] };
		}

		// The look of the stage: Tavern's own, or a plugin's registerStageView; remembered per browser.
		// With no choice made, a plugin view is used: installing one is asking for it.
		const TAVERN_STAGE_VIEW_KEY = "dsh-tavern-stage-view";
		const TAVERN_STAGE_BUILTIN = "dsh-tavern:builtin";
		function useTavernStageView() {
			useTavernUiExtensions();
			const [chosen, setChosen] = React.useState(function () { try { return window.localStorage.getItem(TAVERN_STAGE_VIEW_KEY) || ""; } catch (_) { return ""; } });
			const views = tavernUiExtensions.stageViews();
			const view = chosen === TAVERN_STAGE_BUILTIN ? null : views.find(function (entry) { return entry.key === chosen; }) || views[0] || null;
			function choose(key) {
				setChosen(key);
				try { window.localStorage.setItem(TAVERN_STAGE_VIEW_KEY, key); } catch (_) {}
			}
			return { views: views, view: view, choose: choose };
		}

		function TavernStageViewSwitch(props) {
			const h = React.createElement;
			if (!props.choice.views.length) return null;
			const current = props.choice.view ? props.choice.view.key : TAVERN_STAGE_BUILTIN;
			return h("select", { className: "dsh-tavern-stage-view-switch", value: current, "aria-label": "舞台样式", onChange: function (event) { props.choice.choose(event.target.value); } },
				[{ key: TAVERN_STAGE_BUILTIN, label: "内置" }].concat(props.choice.views).map(function (entry) {
					return h("option", { key: entry.key, value: entry.key }, entry.owner ? entry.label + "（" + entry.owner + "）" : entry.label);
				}));
		}

		function TavernStagePluginScene(props) {
			const rendered = props.view.render(props.input);
			return rendered === null || rendered === undefined ? props.fallback : rendered;
		}

		/** The scene in the chosen look; a plugin view that fails or returns null shows Tavern's own. */
		function TavernStageSceneView(props) {
			const builtin = React.createElement(TavernStageScene, props);
			if (!props.view) return builtin;
			const beat = props.beats[props.index] || null;
			const input = { gameId: props.sessionId, stage: tavernStagePublicData(props.data), beats: props.beats, index: props.index, beat: beat,
				fullscreen: Boolean(props.fullscreen), advance: props.onAdvance, footer: props.footer || null };
			return React.createElement(tavernPluginBoundary(), { key: props.view.key, owner: props.view.owner, fallback: builtin },
				React.createElement(TavernStagePluginScene, { view: props.view, input: input, fallback: builtin }));
		}

		function useTavernStageReader(data, startAtLatestLine) {
			const turns = data && Array.isArray(data.turns) ? data.turns : [];
			const latest = turns.length ? turns[turns.length - 1] : null;
			const beats = React.useMemo(function () { return latest ? tavernStageBeats(latest) : []; }, [latest && latest.turn, latest && latest.text, latest && JSON.stringify(latest.lines)]);
			const initial = function () {
				if (!startAtLatestLine) return 0;
				for (let at = beats.length - 1; at >= 0; at -= 1) if (beats[at].kind === "line") return at;
				return Math.max(0, beats.length - 1);
			};
			const [index, setIndex] = React.useState(initial);
			const key = latest ? latest.turn + ":" + beats.length : "";
			React.useEffect(function () { setIndex(initial()); }, [key]);
			return { beats: beats, index: Math.min(index, Math.max(0, beats.length - 1)), setIndex: setIndex, turn: latest && latest.turn };
		}

		// Reading the stage aloud: a per-browser choice, effective while voicing is on.
		const TAVERN_STAGE_READ_KEY = "dsh-tavern-stage-read";
		function useTavernStageReading() {
			const speech = useTavernSpeechSettings();
			const [reading, setReading] = React.useState(function () { try { return window.localStorage.getItem(TAVERN_STAGE_READ_KEY) === "1"; } catch (_) { return false; } });
			function toggle() {
				const next = !reading;
				setReading(next);
				if (!next) tavernSpeech.stop();
				try { window.localStorage.setItem(TAVERN_STAGE_READ_KEY, next ? "1" : "0"); } catch (_) {}
			}
			React.useEffect(function () { return function () { tavernSpeech.stop(); }; }, []);
			const available = Boolean(speech && speech.enabled);
			return { available: available, on: available && reading, toggle: toggle };
		}
		function tavernBeatSpeech(sessionId, beat) {
			return beat.kind === "line" ? { sessionId: sessionId, speaker: beat.speaker, text: (beat.quotes || []).join(" ") || beat.text, emotion: beat.emotion }
				: { sessionId: sessionId, text: beat.text, narration: true };
		}
		function TavernStageReadButton(props) {
			if (!props.reading.available) return null;
			return React.createElement("button", { type: "button", className: props.reading.on ? "is-on" : "", "aria-pressed": props.reading.on, onClick: props.reading.toggle }, "朗读");
		}

		function TavernStageFullscreen(props) {
			const h = React.createElement;
			const reader = useTavernStageReader(props.data, false);
			const [auto, setAuto] = React.useState(false);
			const reading = useTavernStageReading();
			const [draft, setDraft] = React.useState("");
			const [sending, setSending] = React.useState(false);
			const atEnd = reader.index >= reader.beats.length - 1;
			function step(delta) { reader.setIndex(function (value) { return Math.max(0, Math.min(reader.beats.length - 1, value + delta)); }); }
			React.useEffect(function () {
				function onKey(event) {
					if (event.target && /^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return;
					if (event.key === "Escape") { event.stopPropagation(); props.onClose(); }
					else if (event.key === "ArrowRight" || event.key === " " || event.key === "Enter") { event.preventDefault(); step(1); }
					else if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
				}
				document.addEventListener("keydown", onKey, true);
				return function () { document.removeEventListener("keydown", onKey, true); };
			}, [reader.beats.length]);
			// Each beat is read when reading is on; auto play turns the page when it was heard, or after a time by its length.
			React.useEffect(function () {
				const beat = reader.beats[reader.index];
				let active = true, timer = null;
				const delay = Math.max(1500, Math.min(10000, 400 + 70 * Array.from(beat ? beat.text : "").length));
				const turn = function (wait) { if (active && auto && !atEnd) timer = window.setTimeout(function () { step(1); }, wait); };
				if (reading.on && beat) tavernSpeech.speak(tavernBeatSpeech(props.sessionId, beat)).then(function (heard) { turn(heard ? 400 : delay); });
				else turn(delay);
				return function () { active = false; if (timer !== null) window.clearTimeout(timer); };
			}, [auto, reader.index, reader.turn, reader.beats, atEnd, reading.on, props.sessionId]);
			async function send(event) {
				event.preventDefault();
				const text = draft.trim();
				if (!text || sending) return;
				setSending(true);
				try { await props.onSubmit(text); setDraft(""); }
				catch (error) { tavernErrorHub.report("舞台发送", error); }
				finally { setSending(false); }
			}
			const footer = h("div", { className: "dsh-tavern-stage-controls", onClick: function (event) { event.stopPropagation(); } },
				h("button", { type: "button", onClick: function () { step(-1); }, disabled: reader.index <= 0, "aria-label": "上一句" }, "‹"),
				h("span", { className: "dsh-tavern-stage-progress" }, reader.beats.length ? (reader.index + 1) + " / " + reader.beats.length : ""),
				h("button", { type: "button", onClick: function () { step(1); }, disabled: atEnd, "aria-label": "下一句" }, "›"),
				h("button", { type: "button", className: auto ? "is-on" : "", onClick: function () { setAuto(!auto); }, "aria-pressed": auto }, "自动"),
				h(TavernStageReadButton, { reading: reading }),
				h("span", { className: "dsh-tavern-spacer" }),
				h("button", { type: "button", onClick: props.onClose }, "退出舞台"));
			return h("div", { className: "dsh-tavern-stage-overlay", role: "dialog", "aria-modal": "true", "aria-label": "舞台" },
				h(TavernStageSceneView, { view: props.view, sessionId: props.sessionId, data: props.data, beats: reader.beats, index: reader.index, fullscreen: true, onAdvance: function () { step(1); }, footer: footer }),
				atEnd ? h("form", { className: "dsh-tavern-stage-input", onSubmit: send },
					h("input", { value: draft, onChange: function (event) { setDraft(event.target.value); }, placeholder: props.generating ? "正在生成下一轮…" : "接下来做什么？", "aria-label": "舞台输入", disabled: sending }),
					h("button", { type: "submit", disabled: sending || !draft.trim() }, sending ? "发送中…" : "发送")) : null);
		}

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
				try { const result = await rpc(method, args, props.sessionId); props.onCast(result.cast); setNotice(done(result)); }
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
						character ? h("button", { type: "button", disabled: busy, onClick: function () { void run("castRemoveCharacter", { name: character.name }, function () { return "已清除 " + character.name + " 的素材"; }); } }, "清除") : null);
				})),
				notice ? h("p", { role: "status", className: "dsh-tavern-settings-desc" }, notice) : null);
		}

		function TavernStageTab(props) {
			const h = React.createElement;
			const enabled = useTavernCastEnabled();
			const stage = useTavernCastStage(props.sessionId);
			const reader = useTavernStageReader(stage.data, true);
			const [fullscreen, setFullscreen] = React.useState(false);
			const choice = useTavernStageView();
			const reading = useTavernStageReading();
			const beat = reader.beats[reader.index];
			React.useEffect(function () {
				if (reading.on && beat && !fullscreen) void tavernSpeech.speak(tavernBeatSpeech(props.sessionId, beat));
			}, [reader.index, reader.turn, reader.beats, reading.on, fullscreen, props.sessionId]);
			const data = stage.data;
			if (!data) return h("aside", { className: "dsh-tavern-status dsh-tavern-stage-tab", "aria-label": "舞台" }, h("p", { className: "dsh-tavern-settings-desc" }, stage.error || "正在读取舞台…"));
			return h("aside", { className: "dsh-tavern-status dsh-tavern-stage-tab", "aria-label": "舞台" },
				h("div", { className: "dsh-tavern-status-head" }, h("strong", null, "舞台"),
					h(TavernStageViewSwitch, { choice: choice }),
					h("button", { type: "button", className: "dsh-tavern-btn", onClick: function () { setFullscreen(true); } }, "全屏舞台")),
				h("div", { className: "dsh-tavern-status-body dsh-tavern-stage-body" },
				!enabled ? h("p", { className: "dsh-tavern-settings-desc" }, "在「设置 → DSH Tavern → 显示与交互」打开「对话头像」后，后台会标注每句台词的说话人和情绪，舞台才会换人、换表情。") : null,
				h(TavernStageSceneView, { view: choice.view, sessionId: props.sessionId, data: data, beats: reader.beats, index: reader.index, onAdvance: function () { reader.setIndex(function (value) { return Math.min(reader.beats.length - 1, value + 1); }); },
					footer: h("div", { className: "dsh-tavern-stage-controls", onClick: function (event) { event.stopPropagation(); } },
						h("button", { type: "button", "aria-label": "上一句", disabled: reader.index <= 0, onClick: function () { reader.setIndex(function (value) { return Math.max(0, value - 1); }); } }, "‹"),
						h("span", { className: "dsh-tavern-stage-progress" }, reader.beats.length ? (reader.index + 1) + " / " + reader.beats.length : ""),
						h("button", { type: "button", "aria-label": "下一句", disabled: reader.index >= reader.beats.length - 1, onClick: function () { reader.setIndex(function (value) { return Math.min(reader.beats.length - 1, value + 1); }); } }, "›"),
						h(TavernStageReadButton, { reading: reading })) }),
				h(TavernCastManager, { sessionId: props.sessionId, data: data, onCast: function (cast) { stage.setData(Object.assign({}, data, { cast: cast })); } })),
				fullscreen ? require("react-dom").createPortal(h(TavernStageFullscreen, { view: choice.view, sessionId: props.sessionId, data: data, generating: props.generating, onSubmit: function (text) { return props.submit(props.sessionId, text); }, onClose: function () { setFullscreen(false); } }), document.body) : null);
		}
