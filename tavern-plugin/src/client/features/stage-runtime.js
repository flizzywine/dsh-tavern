// Resolve static presentation once per accepted snapshot, not in each stage view.
function stageRuntimeScene(data) {
	return { background: data.background || data.card.imageUrl || "", backdrop: Boolean(data.background),
		figures: data.stage.figures.map(figure => ({ name: figure.speaker, url: tavernCastImage(data, figure.speaker, figure.emotion) })) };
}

// Shared with the cast editor; image selection is not a second scene projection.
function tavernCastImage(data, name, emotion, preferAvatar) {
	const character = tavernCastCharacter(data.cast, name);
	const sprites = character ? character.sprites || {} : {};
	const sprite = sprites[emotion] || sprites.neutral || Object.values(sprites)[0] || "";
	const avatar = character && (character.avatars || {})[emotion] || character && character.avatarUrl || (name === data.card.name ? data.card.imageUrl : "");
	return preferAvatar ? avatar || sprite : sprite || avatar;
}

function watchStageRuntime(sessionId, binding, refresh) {
	let authority = null, running = binding.session.getSnapshot().running;
	const wake = () => refresh();
	const selection = liveTavernView.select(sessionId, [["chatId"], ["card", "path"], ["suppressedDshTurns"], ["regeneratedDshTurns"], ["settlementTurn"], ["updatedAt"]]);
	const stops = [selection.subscribe(() => {
		const view = selection.getSnapshot().view;
		if (!view) return;
		// An adopted regeneration replaces text, not the scene's authority domain.
		const withdrawn = (view.suppressedDshTurns || []).filter(turn => !Object.values(view.regeneratedDshTurns || {}).includes(turn));
		const next = JSON.stringify([view.chatId, view.card?.path, withdrawn]);
		const reset = authority !== null && authority !== next;
		authority = next; refresh(reset);
	}), binding.session.subscribe(() => {
		const next = binding.session.getSnapshot().running;
		if (next !== running) { running = next; wake(); }
	}), tavernCoordination.subscribe(sessionId, wake), tavernSessionSignals.subscribe(sessionId, "cast", wake, undefined, wake)];
	for (const event of ["dsh-tavern-settings-changed", "focus"]) window.addEventListener(event, wake);
	// Reconcile missed notifications without creating a director job or writing history.
	const timer = window.setInterval(() => { if (!document.hidden) wake(); }, 5000);
	return () => {
		stops.forEach(stop => stop()); window.clearInterval(timer);
		for (const event of ["dsh-tavern-settings-changed", "focus"]) window.removeEventListener(event, wake);
	};
}
const tavernStageRuntime = createStageRuntimeSessions({
	read: (id, signal) => rpc("castStage", { count: 5 }, id, { signal }), project: stageRuntimeScene, watch: watchStageRuntime
});
function useTavernStageRuntime(sessionId) {
	const subscribe = React.useCallback(fn => tavernStageRuntime.subscribe(sessionId, fn), [sessionId]);
	const snapshot = React.useCallback(() => tavernStageRuntime.getSnapshot(sessionId), [sessionId]);
	return React.useSyncExternalStore(subscribe, snapshot, snapshot);
}

// The stage scene, in Tavern's look or a plugin's registerStageView.
function TavernStageFigure(props) {
	const [failed, setFailed] = React.useState("");
	const h = React.createElement;
	const url = failed === props.url ? "" : props.url;
	return h("div", { className: "dsh-tavern-stage-figure" + (props.dim ? " is-dim" : ""), "data-speaker": props.name },
		h("div", { className: "dsh-tavern-stage-figure-body" },
			url ? h("img", { key: url, src: url, alt: props.name, onError: function () { setFailed(props.url); } })
				: h("span", { className: "dsh-tavern-stage-figure-letter", style: { "--dsh-cast-hue": tavernCastHue(props.name) } }, Array.from(props.name)[0] || "?")));
}

/** One stage frame: who is on stage at this beat, and the text box. */
function TavernStageScene(props) {
	const h = React.createElement;
	const data = props.data, beats = props.beats, index = props.index;
	const beat = beats[index] || null;
	const scene = props.scene;
	// The skin's art layer draws the page cue and the auto lamp on its box image (stage-skin.js stageSkinArt).
	// The cue ends the lines (an inline cue flows after them; a placed one stands on the box). The input docks on the box
	// (`dock`), standing above its image however tall the box grows.
	const next = props.art && index < beats.length - 1 ? h("span", { className: "dsh-tavern-stage-next", "aria-hidden": true }) : null;
	const lamp = props.art ? h("span", { className: "dsh-tavern-stage-lamp", "aria-hidden": true }) : null;
	const nameRef = React.useRef(null);
	useTavernStageNameFit(nameRef, beat && beat.kind === "line" ? beat.speaker : "", props.art);
	return h("div", { ref: props.sceneRef, className: "dsh-tavern-stage-scene", onClick: props.onAdvance },
		h("div", { className: "dsh-tavern-stage-backdrop" + (scene.backdrop ? " is-scene" : ""), style: scene.background ? { "--dsh-stage-backdrop": "url(\"" + scene.background + "\")" } : undefined }),
		h("div", { className: "dsh-tavern-stage-figures" }, scene.figures.map(function (figure) {
			const name = figure.name;
			const speaker = beat && tavernCastCharacter(data.cast, beat.speaker);
			const speaking = beat && (speaker ? speaker.name : beat.speaker) === name;
			return h(TavernStageFigure, { key: name, name: name, url: figure.url, dim: beat && beat.kind === "line" && !speaking });
		})),
		beat ? h("div", { className: "dsh-tavern-stage-textbox" + (beat.kind === "narration" ? " is-narration" : "") },
			beat.kind === "line" ? h("div", { className: "dsh-tavern-stage-name" }, h("b", { ref: nameRef, "data-text": beat.speaker }, beat.speaker),
				TAVERN_CAST_EMOTIONS[beat.emotion] && beat.emotion !== "neutral" ? h("span", { className: "dsh-tavern-cast-emotion" }, TAVERN_CAST_EMOTIONS[beat.emotion]) : null) : null,
			h("div", { key: index, className: "dsh-tavern-stage-text" + (beat.kind === "narration" ? " is-narration" : "") }, beat.text, next),
			lamp, props.footer || null, props.dock || null)
			: h("div", { className: "dsh-tavern-stage-textbox is-empty" }, props.empty || "还没有可以演出的正文", props.dock || null));
}

// A name longer than its plate's room (an art plate: tavern.css 「stage skin: art」) is set smaller to fit, down to .6, instead of
// losing its end. Padding and spacing do not scale with the face, so it narrows in a few measured steps (fractional px: the
// glyph run plus padding against the box), again once fonts load and whenever the plate resizes.
function useTavernStageNameFit(ref, name, art) {
	React.useLayoutEffect(() => {
		const b = ref.current;
		if (!b || !art) return undefined;
		const fit = () => {
			b.style.removeProperty("--stage-name-fit");
			const range = document.createRange();
			let scale = 1;
			for (let i = 0; i < 4 && scale > .6; i++) {
				const style = getComputedStyle(b), vertical = style.writingMode.startsWith("vertical");
				range.selectNodeContents(b);
				const extent = vertical ? "height" : "width";
				const padding = vertical ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
				const over = (range.getBoundingClientRect()[extent] + padding) / Math.max(1, b.getBoundingClientRect()[extent]);
				if (over <= 1.001) break;
				scale = Math.max(.6, Math.floor(1000 * scale / over - 10) / 1000);
				b.style.setProperty("--stage-name-fit", String(scale));
			}
		};
		fit();
		let live = true;
		document.fonts.ready.then(() => { if (live) fit(); });
		const observer = new ResizeObserver(fit);
		observer.observe(b.parentElement);
		return () => { live = false; observer.disconnect(); };
	}, [name, art]);
}

/** The stage data as plugins see it (tavernUi.getStage). */
function tavernStagePublicData(data) {
	return { enabled: data.enabled !== false, player: data.player, card: data.card, background: data.background || "", music: data.music, stage: data.stage, characters: data.cast || [], turns: data.turns || [] };
}

// The look of the stage: Tavern's own, or a plugin's registerStageView; remembered per browser.
// With no choice made, a plugin view is used: installing one is asking for it.
function useTavernStageView(sessionId) {
	return useTavernPluginViewChoice(tavernUiExtensions.stageViews(), "dsh-tavern-stage-view", sessionId);
}

function TavernStageViewSwitch(props) {
	if (!props.choice.views.length) return null;
	return React.createElement(TavernPluginViewSwitch, { choice: props.choice, label: "舞台样式", className: "dsh-tavern-stage-view-switch" });
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
		fullscreen: true, advance: props.onAdvance, footer: props.footer || null };
	return React.createElement(tavernPluginBoundary(), { key: props.view.key, owner: props.view.owner, fallback: builtin },
		React.createElement(TavernStagePluginScene, { view: props.view, input: input, fallback: builtin }));
}

function playTavernStagePerformance(root, event, id) {
	if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
	const target = event.op === "screen.play" ? root : Array.from(root.querySelectorAll("[data-speaker]")).find(function (node) { return node.dataset.speaker === event.actor; });
	if (!target) return null;
	const frames = event.op === "screen.play" ? ["none", "translateX(-3px)", "translateX(3px)", "translateX(-2px)", "none"]
		: event.motion === "nod" ? ["none", "translateY(2%)", "none", "translateY(1%)", "none"] : ["none", "translateY(-6%)", "none"];
	return target.animate(frames.map(function (transform) { return { transform: transform }; }), { id: "stage:" + id, duration: event.op === "screen.play" ? 450 : 650, easing: "ease-in-out" });
}

// The art layer's frames slots (art.textbox.next / lamp `frames`): each plays its sheet's cells while it shows, looping or once;
// reduced motion keeps the rest cell the stylesheet draws. The cue restarts on each page, the lamp when auto paging starts.
function useTavernStageArtFrames(sceneRef, art, index, auto) {
	React.useEffect(() => {
		const root = sceneRef.current;
		if (!root || !art || !Object.keys(art.frames).length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
		const played = Object.entries(art.frames).map(([slot, sheet]) => {
			const node = root.querySelector(".dsh-tavern-stage-" + slot);
			return node && (slot !== "lamp" || auto) ? node.animate(sheet.keys, { duration: sheet.ms, iterations: sheet.loop ? Infinity : 1, easing: "step-end", fill: "forwards" }) : null;
		});
		return () => played.forEach(animation => animation && animation.cancel());
	}, [art, index, auto]);
}

// The stage reads each line aloud while 配音 is on (舞台设置 › 基础设置); there is no second switch.
function useTavernStageReading() {
	const speech = useTavernSpeechSettings();
	return { on: Boolean(speech && speech.enabled) };
}
function tavernBeatSpeech(sessionId, beat) {
	return beat.kind === "line" ? { sessionId: sessionId, speaker: beat.speaker, text: (beat.quotes || []).join(" ") || beat.text, emotion: beat.emotion }
		: { sessionId: sessionId, text: beat.text, narration: true };
}

// The fullscreen stage only shows its session: page, auto paging and playback belong to the
// session runtime, which releases them when the view closes and restores the page on reopen.
function TavernStageScreen(props) {
	const h = React.createElement, id = props.sessionId;
	const { data, scene, reader } = useTavernStageRuntime(id);
	const reading = useTavernStageReading(), choice = useTavernStageView(id);
	// The stage is drawn in a skin, a data document read by the one generic interpreter (stage-skin.js): the one this card
	// resolves to (stage-skin-choice.js, castStage `skin`); 经典 until it arrives.
	// A pack skin's art layer draws from its bundle (castStage `skin.base`) once its images have loaded.
	const skinDocument = data && data.skin && data.skin.document || BUILTIN_STAGE_SKINS.classic;
	const skin = React.useMemo(() => stageSkinRoot(skinDocument), [JSON.stringify(skinDocument)]);
	const artFiles = useStageSkinArtFiles(data && data.skin && data.skin.document ? data.skin : null);
	const art = React.useMemo(() => stageSkinArt(skinDocument, artFiles), [skinDocument === BUILTIN_STAGE_SKINS.classic ? "" : JSON.stringify(skinDocument), artFiles]);
	const sceneRef = React.useRef(null), readingOn = React.useRef(reading.on);
	readingOn.current = reading.on;
	const [draft, setDraft] = React.useState(""), [sending, setSending] = React.useState(false);
	const session = () => props.sessions?.binding(id)?.session;
	const running = React.useSyncExternalStore(fn => session()?.subscribe(fn) || (() => {}), () => session()?.getSnapshot().running === true);
	React.useEffect(() => tavernStageRuntime.attach(id, {
		animate: (event, key) => playTavernStagePerformance(sceneRef.current, event, key),
		speech: { on: () => readingOn.current, speak: beat => tavernSpeech.speak(tavernBeatSpeech(id, beat)), stop: () => tavernSpeech.stop() },
		// A plugin's music (tavernUi.playMusic) ends with the stage view; the stage's BGM does not.
		release: () => tavernMusic.stop()
	}), [id]);
	React.useEffect(() => { tavernStageRuntime.sync(id); }, [id, reading.on]);
	useTavernStageArtFrames(sceneRef, art, reader.index, reader.auto);
	const latest = data.turns[data.turns.length - 1];
	const beats = React.useMemo(() => latest ? latest.pages.map(page => ({ turn: latest.turn, ...page })) : [], [latest]);
	const atEnd = reader.index >= beats.length - 1, step = delta => tavernStageRuntime.page(id, index => index + delta);
	React.useEffect(() => {
		function onKey(event) {
			if (event.target && /^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return;
			// The BGM panel's keys are its own (its Esc closes only the panel).
			if (event.target && event.target.closest && event.target.closest(".dsh-tavern-bgm-panel")) return;
			if (event.key === "Escape") { event.stopPropagation(); props.onClose(); }
			else if (event.key === "ArrowRight" || event.key === " " || event.key === "Enter") { event.preventDefault(); step(1); }
			else if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
		}
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [id, props.onClose]);
	async function send(event) {
		event.preventDefault();
		const text = draft.trim();
		if (!text || sending) return;
		setSending(true);
		try { await props.submit(id, text); setDraft(""); }
		catch (error) { tavernErrorHub.report("舞台发送", error); }
		finally { setSending(false); }
	}
	const footer = h("div", { className: "dsh-tavern-stage-controls", onClick: event => event.stopPropagation() },
		h("button", { type: "button", onClick: () => step(-1), disabled: reader.index <= 0, "aria-label": "上一句" }, "‹"),
		h("span", { className: "dsh-tavern-stage-progress" }, beats.length ? (reader.index + 1) + " / " + beats.length : ""),
		h("button", { type: "button", onClick: () => step(1), disabled: atEnd, "aria-label": "下一句" }, "›"),
		h("button", { type: "button", className: reader.auto ? "is-on" : "", onClick: () => tavernStageRuntime.setAuto(id, !reader.auto), "aria-pressed": reader.auto }, "自动"),
		h("button", { type: "button", onClick: () => tavernStageRuntime.page(id, beats.length - 1, "skip") }, "跳过"),
		h(TavernBgmStage, { sessionId: id }),
		h(TavernMusicToggle, null),
		h("span", { className: "dsh-tavern-spacer" }),
		h("button", { type: "button", onClick: props.onClose }, "退出舞台"));
	const generating = props.generating ?? running;
	const input = atEnd ? h("form", { className: "dsh-tavern-stage-input", onSubmit: send, onClick: event => event.stopPropagation() },
		h("input", { value: draft, onChange: event => setDraft(event.target.value), placeholder: generating ? "正在生成下一轮…" : "接下来做什么？", "aria-label": "舞台输入", disabled: sending }),
		h("button", { type: "submit", disabled: sending || !draft.trim() }, sending ? "发送中…" : "发送")) : null;
	// With the skin's art the input docks on Tavern's own box (above its image); a plugin view keeps it under the scene.
	const docked = Boolean(art) && !choice.view;
	return h("div", { className: "dsh-tavern-stage-overlay", role: "dialog", "aria-modal": "true", "aria-label": "舞台", ...skin,
		...(art ? { ...art.marks, style: { ...skin.style, ...art.tokens } } : null), "data-stage-auto": reader.auto ? "" : undefined },
		h(TavernStageSceneView, { scene, view: choice.view, sessionId: id, data, beats, index: reader.index, sceneRef, onAdvance: () => step(1), footer, art, dock: docked ? input : null }),
		docked ? null : input);
}

// Two entries open the same fullscreen stage: the chat header's 「舞台」 and 酒馆状态's 「全屏舞台」.
function TavernStageEntry(props) {
	const stage = useTavernStageRuntime(props.sessionId);
	const [opened, setOpened] = React.useState(false);
	const close = React.useCallback(() => setOpened(false), []);
	if (!stage.data || stage.data.enabled === false) return null;
	const h = React.createElement, open = () => setOpened(true);
	return h(React.Fragment, null,
		props.header ? h("button", { type: "button", className: "dsh-tavern-btn dsh-tavern-stage-toggle", title: "全屏舞台", "aria-label": "舞台", onClick: open },
			h("svg", { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false" },
				h("path", { d: "M3.5 4.5h17M5 4.5c0 4 1.8 6.5 4.5 7.5M19 4.5c0 4-1.8 6.5-4.5 7.5M3.5 19.5h17M7 19.5v-3.5h10v3.5" })),
			h("span", null, "舞台")) : h("button", { type: "button", className: "dsh-tavern-btn", onClick: open }, "全屏舞台"),
		opened ? require("react-dom").createPortal(h(TavernStageScreen, { ...props, onClose: close }), document.body) : null);
}

// 酒馆状态 keeps only the stage entry; its settings live in 舞台设置, 舞台素材 and 配音 (stage-settings.js).
function TavernStageStatus(props) {
	const stage = useTavernStageRuntime(props.sessionId);
	if (!stage.data || stage.data.enabled === false) return null;
	return React.createElement("section", { className: "dsh-tavern-status-section", "aria-label": "舞台" }, React.createElement(TavernStageEntry, props));
}
