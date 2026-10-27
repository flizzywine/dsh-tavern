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
	const avatar = tavernCastAvatar(data, name, emotion);
	return preferAvatar ? avatar || sprite : sprite || avatar;
}
// The speaker's avatar alone (the stage's face window shows no full figure): this mood's, the character's, or the card's own.
function tavernCastAvatar(data, name, emotion) {
	const character = tavernCastCharacter(data.cast, name);
	return character && (character.avatars || {})[emotion] || character && character.avatarUrl || (name === data.card.name ? data.card.imageUrl : "") || "";
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
	// 逐字显示 (stage-typewriter.js): the line types out at the reader's 文字速度; the cue waits until it is typed.
	// 分页 (stage-pager.js): a line longer than the box shows card by card (`card`: the shown card's text; `more`: a card follows).
	const next = props.art && (index < beats.length - 1 || props.more) ? h("span", { className: "dsh-tavern-stage-next" + (props.typed ? "" : " is-waiting"), "aria-hidden": true }) : null;
	const lamp = props.art ? h("span", { className: "dsh-tavern-stage-lamp", "aria-hidden": true }) : null;
	const nameRef = React.useRef(null);
	useTavernStageNameFit(nameRef, beat && beat.kind === "line" ? beat.speaker : "", props.art);
	// The skin's face window (art.portrait, stage-skin.js stageSkinPortraitArt): the speaker's avatar on a line page; empty on
	// narration and for a speaker without one, so no empty frame shows.
	const side = props.art && props.art.marks["data-fk-skin-portrait"] ? h(TavernStageSide, { face: beat && beat.kind === "line" ? tavernCastAvatar(data, beat.speaker, beat.emotion) : "",
		name: beat && beat.kind === "line" ? beat.speaker : "", nameArc: props.art.faceName }) : null;
	// 物品: this page's item (one at most) waits unseen, its picture already loading; the page's playback shows it once.
	const item = (data.turns.at(-1)?.performances || []).find(event => event.op === "item.play" && event.at === index + 1);
	// 旁白逐行 (stage-narration.js): a skin's art.narration.lines brings a narration card in line by line instead of glyph by glyph.
	const typer = beat && beat.kind === "narration" && props.narrationLines ? TavernStageNarrationLines : TavernStageTypewriter;
	return h("div", { ref: props.sceneRef, className: "dsh-tavern-stage-scene", onClick: props.onAdvance },
		h("div", { className: "dsh-tavern-stage-backdrop" + (scene.backdrop ? " is-scene" : ""), style: scene.background ? { "--dsh-stage-backdrop": "url(\"" + scene.background + "\")" } : undefined }),
		h("div", { className: "dsh-tavern-stage-figures" }, scene.figures.map(function (figure) {
			const name = figure.name;
			const speaker = beat && tavernCastCharacter(data.cast, beat.speaker);
			const speaking = beat && (speaker ? speaker.name : beat.speaker) === name;
			return h(TavernStageFigure, { key: name, name: name, url: figure.url, dim: beat && beat.kind === "line" && !speaking });
		})),
		item ? h(TavernStageItem, { key: index + ":" + item.item, item }) : null,
		// 画面效果 (features/stage-effects.js): over the scene, under the text box; idle it shows nothing.
		h("div", { className: "dsh-tavern-stage-fx", "aria-hidden": true },
			h("div", { className: "dsh-tavern-stage-fx-cover" }), h("div", { className: "dsh-tavern-stage-fx-vignette" }), h("div", { className: "dsh-tavern-stage-fx-wave" })),
		// is-speaking: the page's line is being read aloud (a skin's art.portrait.frame.speaking frame shows then).
		beat ? h("div", { className: "dsh-tavern-stage-textbox" + (beat.kind === "narration" ? " is-narration" : "") + (props.speaking && beat.kind === "line" ? " is-speaking" : "") },
			side,
			beat.kind === "line" ? h("div", { className: "dsh-tavern-stage-name" }, h("b", { ref: nameRef, "data-text": beat.speaker }, beat.speaker),
				TAVERN_CAST_EMOTIONS[beat.emotion] && beat.emotion !== "neutral" ? h("span", { className: "dsh-tavern-cast-emotion" }, TAVERN_CAST_EMOTIONS[beat.emotion]) : null) : null,
			h("div", { key: index, ref: props.textRef, className: "dsh-tavern-stage-text" + (beat.kind === "narration" ? " is-narration" : "") },
				h(typer, { key: props.visit, text: props.card ?? beat.text, speed: props.textSpeed, reveal: props.reveal, lines: props.narrationLines, instant: props.typed, onDone: props.onTyped }), next),
			lamp, props.footer || null, props.dock || null)
			: h("div", { className: "dsh-tavern-stage-textbox is-empty" }, props.empty || "还没有可以演出的正文", props.dock || null));
}

// The face window (tavern.css 「stage skin: art portrait」): the speaker's avatar, cut in on a new speaker (no slide or fade, as a
// framed window does); .is-on only while there is a face. The frame's arc name is decoration: the box's plate keeps the name
// for screen readers.
function TavernStageSide(props) {
	const h = React.createElement, [failed, setFailed] = React.useState("");
	const face = props.face && failed !== props.face ? props.face : "";
	return h("div", { className: "dsh-tavern-stage-side" + (face ? " is-on" : ""), "aria-hidden": true },
		face ? h("img", { key: face, className: "dsh-tavern-stage-side-img", src: face, alt: "", draggable: false, onError: () => setFailed(props.face) }) : null,
		face && props.nameArc && props.name ? h(TavernStageSideName, { arc: props.nameArc, name: props.name }) : null);
}

// art.portrait.frame.name: the speaker's name set along the frame's circle, in the frame image's own px (the svg covers the side,
// which is the frame): the glyphs' middles on the circle, centred on its lowest (or highest) point. Any name stays inside the
// span's arc: set smaller first, down to .72; then its tracking closed, down to -.04em; then smaller again to the skin's min
// (on a phone, narrow.nameMin CSS px); past that pressed to the arc. Legibility: bed = a soft dark band under the run (its own
// blurred layer), engrave = a dark copy above and a light one below, shadow = an offset outlined copy behind, stroke = an
// outline under the ink (a gradient down the glyphs). The plain caption beside it is the phone's one line (name below).
function TavernStageSideName(props) {
	const h = React.createElement, a = props.arc, name = String(props.name);
	const id = "dsh-face-name-" + React.useId().replace(/[^a-z0-9]/gi, "");
	const ink = React.useRef(null), [fit, setFit] = React.useState({ name: "", scale: 1, spacing: a.spacing, press: 0 });
	const top = a.side === "top", room = a.r * a.span * Math.PI / 180;
	React.useLayoutEffect(() => {
		const text = ink.current;
		if (!text) return undefined;
		let live = true;
		// The run measured at full size in the glyphs' own face (a canvas: the svg's run is already fitted); it scales with the size.
		const measure = () => {
			const context = live && document.createElement("canvas").getContext("2d");
			if (!context) return;
			context.font = a.weight + " " + a.font + "px " + getComputedStyle(text).fontFamily;
			const glyphs = context.measureText(name).width, gaps = Array.from(name).length * a.font, run = em => glyphs + em * gaps;
			let scale = 1, spacing = a.spacing;
			// a phone's own floor (narrow.nameMin, CSS px): the frame px it takes at the side's drawn scale
			const k = text.ownerSVGElement?.getScreenCTM()?.a || 0;
			const phone = a.narrowMin && k > 0 && matchMedia("(max-width: 640px)").matches ? a.narrowMin / k : 0;
			const floor = Math.min(1, Math.max(a.min || a.font * .25, phone) / a.font);
			if (run(spacing) > room) scale = Math.max(.72, floor, room / run(spacing));
			if (run(spacing) * scale > room) spacing = Math.max(-.04, Math.min(spacing, (room / scale - glyphs) / gaps));
			if (run(spacing) * scale > room) scale = Math.max(floor, Math.min(scale, room / run(spacing)));
			scale = Math.round(scale * 1000) / 1000; spacing = Math.round(spacing * 1000) / 1000;
			const press = run(spacing) * scale > room + .5 ? Math.round(room) : 0;
			setFit(previous => previous.name === name && previous.scale === scale && previous.spacing === spacing && previous.press === press ? previous : { name, scale, spacing, press });
		};
		measure();
		document.fonts.ready.then(measure);
		// the side's drawn scale changes with the viewport (a phone's floor is in CSS px)
		if (a.narrowMin) window.addEventListener("resize", measure);
		return () => { live = false; window.removeEventListener("resize", measure); };
	}, [name, room, a.narrowMin]);
	const scale = fit.name === name ? fit.scale : 1, press = fit.name === name ? fit.press : 0, spacing = fit.name === name ? fit.spacing : a.spacing;
	const point = angle => [a.x + a.r * Math.cos(angle * Math.PI / 180), a.y + a.r * Math.sin(angle * Math.PI / 180)].map(value => Math.round(value * 100) / 100).join(" ");
	// Left to right: under the middle the way runs counter-clockwise (the glyphs' tops toward the centre), over it clockwise.
	const from = top ? 270 - a.span / 2 : 90 + a.span / 2, to = top ? 270 + a.span / 2 : 90 - a.span / 2;
	const path = "M" + point(from) + " A" + a.r + " " + a.r + " 0 " + (a.span > 180 ? 1 : 0) + " " + (top ? 1 : 0) + " " + point(to);
	const size = a.font * scale, shift = Math.round(a.font * .045 * 100) / 100;
	const layer = (key, fill, dy, extra) => h("text", { key, ref: key === "ink" ? ink : undefined, className: "dsh-tavern-stage-side-name-" + key, fill, transform: dy ? "translate(0 " + dy + ")" : undefined,
		textLength: press || undefined, lengthAdjust: press ? "spacingAndGlyphs" : undefined, dominantBaseline: "central", textAnchor: "middle",
		"data-fit": scale + " " + spacing, style: { fontSize: size + "px", fontWeight: a.weight, letterSpacing: spacing + "em" }, ...extra }, h("textPath", { href: "#" + id, startOffset: "50%" }, name));
	const outline = color => a.stroke ? { stroke: color, strokeWidth: a.stroke.width * 2, strokeLinejoin: "round", paintOrder: "stroke fill" } : {};
	return h(React.Fragment, null,
		h("svg", { className: "dsh-tavern-stage-side-name", viewBox: "0 0 " + a.view[0] + " " + a.view[1], "aria-hidden": true, focusable: "false" },
			h("defs", null, h("path", { id, d: path, fill: "none" }),
				h("linearGradient", { id: id + "-ink", x1: 0, y1: 0, x2: 0, y2: 1 }, h("stop", { offset: 0, stopColor: a.ink[0] }), h("stop", { offset: 1, stopColor: a.ink[1] || a.ink[0] })),
				a.bed ? h("filter", { id: id + "-bed", x: "-25%", y: "-60%", width: "150%", height: "220%" }, h("feGaussianBlur", { stdDeviation: Math.round(a.bed.width * 25) / 100 }),
					h("feComponentTransfer", null, h("feFuncA", { type: "linear", slope: a.bed.alpha }))) : null),
			a.bed ? layer("bed", a.bed.color, 0, { stroke: a.bed.color, strokeWidth: Math.max(0, a.bed.width - size), strokeLinejoin: "round", filter: "url(#" + id + "-bed)" }) : null,
			a.engrave ? layer("dark", a.engrave.dark, -shift) : null,
			a.engrave ? layer("light", a.engrave.light, shift) : null,
			a.shadow ? layer("shadow", a.shadow.color, 0, { transform: "translate(" + a.shadow.dx + " " + a.shadow.dy + ")", ...outline(a.shadow.color) }) : null,
			layer("ink", "url(#" + id + "-ink)", 0, a.stroke ? outline(a.stroke.color) : undefined)),
		h("span", { className: "dsh-tavern-stage-side-caption", style: { "--name-len": Array.from(name).length } }, name));
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

// The item showcase: the picture and its name over the scene, above the text box; it never takes a click.
function TavernStageItem(props) {
	const h = React.createElement, [failed, setFailed] = React.useState(false);
	return h("div", { className: "dsh-tavern-stage-item", "aria-hidden": true },
		props.item.image && !failed ? h("img", { src: props.item.image, alt: "", onError: () => setFailed(true) }) : null,
		h("strong", null, props.item.item));
}

function playTavernStagePerformance(root, event, id, skin) {
	// A sound plays with reduced motion too, and rings out on its own after the page turns (the player is not handed it).
	if (event.op === "sfx.play") { void tavernStageSfx.play(event.audio, event.volume); return null; }
	const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	// An item tells the player something, so it shows with reduced motion too (a fade, no movement).
	if (event.op === "item.play") {
		const node = root && root.querySelector(".dsh-tavern-stage-item");
		if (!node) return null;
		const lift = ["translate(-50%, 12px) scale(.94)", "translate(-50%, 0)", "translate(-50%, 0)", "translate(-50%, -6px)"];
		return node.animate([0, 1, 1, 0].map((opacity, at) => ({ opacity, transform: still ? "translateX(-50%)" : lift[at], offset: [0, .14, .86, 1][at] })),
			{ id: "stage:" + id, duration: 2800, easing: "ease-out" });
	}
	if (event.op === "screen.play") return playTavernStageScreenEffect(root, event, id, skin, still);
	if (!root || still) return null;
	const target = Array.from(root.querySelectorAll("[data-speaker]")).find(function (node) { return node.dataset.speaker === event.actor; });
	if (!target) return null;
	const frames = event.motion === "nod" ? ["none", "translateY(2%)", "none", "translateY(1%)", "none"] : ["none", "translateY(-6%)", "none"];
	return target.animate(frames.map(function (transform) { return { transform: transform }; }), { id: "stage:" + id, duration: 650, easing: "ease-in-out" });
}

// 音效 (modules/stage-sfx.js): one page-wide one-shot player on the page's AudioContext, shared with the BGM transport.
// While one sounds, the layers below it dip (避让, features/stage-audio.js).
const tavernStageSfx = createStageSfx({ context: () => tavernStageAudio.context(), fetch: (url, init) => window.fetch(url, init), output: ctx => tavernStageAudio.output(ctx, "sfx"),
	sounding: on => tavernStageAudio.duck("sfx", on),
	clock: { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: id => window.clearTimeout(id) } });
// 环境音 (castStage `ambience`): the state's loop for the place or weather on a second BGM transport (modules/stage-music.js) on the
// same AudioContext, so it sounds alongside the BGM. Only the open stage plays it; it follows the state across pages and turns.
const tavernStageAmbience = createStageMusic({ context: () => tavernStageAudio.context(), fetch: (url, init) => window.fetch(url, init), output: ctx => tavernStageAudio.output(ctx, "ambience"),
	clock: { now: () => performance.now(), setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: id => window.clearTimeout(id) } });

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
	const speech = useTavernSpeechSettings(), on = Boolean(speech && speech.enabled);
	const channel = on ? speech.providers.find(item => item.id === speech.provider) : null;
	return { on, prepares: Boolean(channel && channel.prepares) };
}
// What a line page's voice says (as dialogue-bubbles.js bubbleSpeech): its voice text, else its words unless the speaker's
// 配音语言 is not 中文; '' says nothing. The stage, its backlog and the chat rows read the same rule.
function tavernPageSpeech(page, data) {
	const character = tavernCastCharacter(data && data.cast, page.speaker);
	return page.voice !== undefined ? page.voice : voiceTranslates(character && character.voiceLanguage) ? "" : (page.quotes || []).join(" ") || page.text;
}
function tavernBeatSpeech(sessionId, beat, data) {
	return beat.kind === "line" ? { sessionId: sessionId, speaker: beat.speaker, text: tavernPageSpeech(beat, data), emotion: beat.emotion }
		: { sessionId: sessionId, text: beat.text, narration: true };
}

// This machine's reading pace (CONFIG › 文字 / 声音, stage-config.js): autoWait, autoSpeed and voiceRate
// (modules/stage-runtime.js stageReadingPrefs); auto paging reads it at each wait, every voice plays at voiceRate.
const tavernStageReadingPrefs = (function () {
	const KEY = "dsh-tavern-stage-reading";
	const listeners = new Set();
	let cached = null;
	function get() {
		if (!cached) { let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {} cached = stageReadingPrefs(saved); }
		return cached;
	}
	tavernSpeech.tune({ rate: get().voiceRate });
	return {
		get,
		set(patch) {
			cached = stageReadingPrefs({ ...get(), ...patch });
			try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch (_) {}
			tavernSpeech.tune({ rate: cached.voiceRate });
			listeners.forEach(fn => fn());
		},
		subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
	};
})();
function useTavernStageReadingPrefs() { return React.useSyncExternalStore(tavernStageReadingPrefs.subscribe, tavernStageReadingPrefs.get); }

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
	// Its font roles resolve against the font library (features/font-library.js) once that is listed.
	const fontLibrary = useTavernFontLibrary();
	const skin = React.useMemo(() => stageSkinRoot(skinDocument, fontLibrary), [JSON.stringify(skinDocument), fontLibrary]);
	const artFiles = useStageSkinArtFiles(data && data.skin && data.skin.document ? data.skin : null);
	const art = React.useMemo(() => stageSkinArt(skinDocument, artFiles), [skinDocument === BUILTIN_STAGE_SKINS.classic ? "" : JSON.stringify(skinDocument), artFiles]);
	const icons = React.useMemo(() => stageSkinControlIcons(skinDocument, artFiles), [skinDocument, artFiles]);
	useStageSkinFonts(data && data.skin && data.skin.document ? data.skin : null, skinDocument, fontLibrary);
	// 避让 (stage-audio.js): the skin may set how far a voice or a sound effect lowers the layers below it; the engine's amounts
	// return when the stage closes.
	const duckBy = JSON.stringify(skinDocument.duck || null);
	React.useEffect(() => { tavernStageAudio.duckBy(JSON.parse(duckBy)); return () => tavernStageAudio.duckBy(null); }, [duckBy]);
	// 入场演出 (stage-entrance.js) plays over the stage as it opens; the stage is drawn under it all along.
	const entrance = useTavernStageEntrance(data && data.entrance, Boolean(data));
	const sceneRef = React.useRef(null), readingOn = React.useRef(reading.on), skinRef = React.useRef(skinDocument), dataRef = React.useRef(null);
	readingOn.current = reading.on; skinRef.current = skinDocument;
	// Whose 配音语言 decides what a page says (tavernPageSpeech): as the stage last read it.
	dataRef.current = data;
	// A channel that can ready its voices (Fish /v1/warm, when its service offers it) is asked once as the stage opens.
	React.useEffect(() => { if (reading.prepares) rpc("speechPrepare", {}, id).catch(() => {}); }, [id, reading.prepares]);
	// While a line is read aloud (from its request until it ends or is stopped); a newer reading owns the flag.
	const [speaking, setSpeaking] = React.useState(false), spoken = React.useRef(0);
	// 回合末选项 (stage-choices.js): the latest reply the round's candidates belong to.
	const messageId = props.choices.useMessageId(id);
	// CONFIG (stage-config.js): the stage owns its open state; while it is open auto paging waits and the stage's keys are
	// CONFIG's. Closing returns focus to what opened it.
	const [config, setConfig] = React.useState(null), configOpen = React.useRef(false), configOpener = React.useRef(null);
	configOpen.current = Boolean(config);
	const openConfig = (tab, opener) => { configOpener.current = opener || null; setConfig({ tab }); };
	const closeConfig = () => {
		setConfig(null);
		const opener = configOpener.current; configOpener.current = null;
		if (opener && opener.isConnected) opener.focus({ preventScroll: true });
	};
	// 履历 (stage-backlog.js): open like CONFIG - auto paging waits and the stage's keys are the backlog's. L, the control bar's
	// 履历 or a wheel up open it; Esc, L, right click, ✕ or a wheel down past its end close it, focus back on what opened it.
	// A wheel gesture that just closed it does not also turn a page.
	const [backlog, setBacklog] = React.useState(false), backlogOpen = React.useRef(false), backlogOpener = React.useRef(null), backlogClosedAt = React.useRef(0);
	backlogOpen.current = backlog;
	const openBacklog = opener => { backlogOpener.current = opener || null; setBacklog(true); };
	const closeBacklog = () => { backlogClosedAt.current = Date.now(); setBacklog(false); };
	// After the stage's controls show again (they are hidden under the backlog).
	React.useEffect(() => {
		if (backlog) return;
		const opener = backlogOpener.current; backlogOpener.current = null;
		if (opener && opener.isConnected) opener.focus({ preventScroll: true });
	}, [backlog]);
	// 逐字显示: each visit of a page types its line (stage-typewriter.js) at CONFIG › 文字 › 文字速度. The first click, page key, wheel
	// step or › finishes the line, the next turns the page; auto paging waits until it is typed. A skip, a restored page (the
	// stage reopened, a rollback), a backlog jump and a plugin's stage view show the whole line at once.
	const prefs = useTavernStageReadingPrefs();
	// The skin's textFx (modules/stage-typewriter.js stageSkinReveal): how its glyphs come in, on the reader's speed.
	const reveal = React.useMemo(() => stageSkinReveal(skinDocument, prefs.textSpeed), [JSON.stringify(skinDocument.textFx), skinDocument.photosensitive, prefs.textSpeed]);
	const visit = reader.key + ":" + reader.visit;
	// 分页 (stage-pager.js): a page whose line the box cannot hold shows card by card. The click, key, wheel step or › that
	// turns the page first walks its cards, ‹ walks them back (into the previous page's last card), auto paging reads each card,
	// 跳过 fast-forwards through them (below). Each card types out; a skip, a restored page or a backlog jump shows the card it
	// lands on whole. `spot`: the card shown in this visit (its start, in characters, so a re-measured page keeps it) and how
	// many cards it has turned through; a page turn (a new visit) starts on its first card.
	const [spot, setSpot] = React.useState({ visit: "", offset: 0, turns: 0 });
	const here = spot.visit === visit ? spot : { visit, offset: 0, turns: 0 };
	const latest = data.turns[data.turns.length - 1];
	const beats = React.useMemo(() => latest ? latest.pages.map(page => ({ turn: latest.turn, ...page })) : [], [latest]);
	const pager = useTavernStagePager(beats, reader.index, here.offset, art || skin);
	const cards = pager.cards, card = pager.card, lastCard = card >= cards.length - 1;
	const cardKey = visit + ":" + here.turns;
	// 跳过 (the control, or Ctrl held): a fast-forward, not a jump. Every STAGE_SKIP_CARD_MS it shows the next card whole - a
	// page's first card on a skip visit, which plays no voice and no performance - until the round's last card; auto paging
	// is off meanwhile. The control turns it on and off; Ctrl held (after a short arm delay, so Ctrl shortcuts do not skip)
	// runs it until released. Any other key, click or wheel stops it, and that input does only that (skipStopped).
	const [skipLatch, setSkipLatch] = React.useState(false), [skipHeld, setSkipHeld] = React.useState(false);
	const skipping = skipLatch || skipHeld, skippingRef = React.useRef(false), skipStopped = React.useRef(false), skipPossible = React.useRef(false);
	skippingRef.current = skipping;
	const [typedVisit, setTypedVisit] = React.useState("");
	const typed = typedVisit === cardKey || here.turns === 0 && (reader.mode === "skip" || reader.mode === "refresh") || Boolean(choice.view) || skipping;
	const typedRef = React.useRef(typed), visitRef = React.useRef(cardKey), shownRef = React.useRef(null);
	typedRef.current = typed; visitRef.current = cardKey;
	shownRef.current = { reader, visit, turns: here.turns, cards, card, last: lastCard };
	// The next visit (a page turn, a skip) opens on its last card.
	const landLast = () => { const now = shownRef.current.reader; setSpot({ visit: now.key + ":" + (now.visit + 1), offset: Infinity, turns: 0 }); };
	const showCard = at => { const now = shownRef.current; setSpot({ visit: now.visit, offset: now.cards[at].start, turns: now.turns + 1 }); };
	const session = () => props.sessions?.binding(id)?.session;
	const running = React.useSyncExternalStore(fn => session()?.subscribe(fn) || (() => {}), () => session()?.getSnapshot().running === true);
	React.useEffect(() => tavernStageRuntime.attach(id, {
		animate: (event, key) => playTavernStagePerformance(sceneRef.current, event, key, skinRef.current),
		reading: () => tavernStageReadingPrefs.get(), held: () => configOpen.current || backlogOpen.current || !typedRef.current,
		card: () => { const now = shownRef.current; return now.cards.length > 1 ? { at: now.card, last: now.last, text: now.cards[now.card].text, share: stageCardVoiceShare(now.cards, now.card) } : null; },
		nextCard: () => { const now = shownRef.current; if (!now.last) showCard(now.card + 1); },
		speech: { on: () => readingOn.current, progress: () => tavernSpeech.progress(), stop: () => { spoken.current++; setSpeaking(false); tavernSpeech.stop(); },
			speak: beat => {
				const mine = ++spoken.current, done = tavernSpeech.speak(tavernBeatSpeech(id, beat, dataRef.current));
				setSpeaking(true);
				Promise.resolve(done).finally(() => { if (spoken.current === mine) setSpeaking(false); });
				return done;
			} },
		// A plugin's music (tavernUi.playMusic), the stage's sound effects and its ambience end with the stage view; the BGM does not.
		release: () => { tavernMusic.stop(); tavernStageSfx.stop(); tavernStageAmbience.stop(); }
	}), [id]);
	// 音效 off (舞台设置 › 基础设置) silences a sound still ringing; the turn's cues decode ahead of their pages.
	const sfxOn = data ? data.sfxEnabled !== false : true;
	React.useEffect(() => { if (!sfxOn) tavernStageSfx.stop(); }, [sfxOn]);
	const cues = (data && data.turns.at(-1)?.performances || []).filter(event => event.op === "sfx.play").map(event => event.audio);
	React.useEffect(() => { cues.forEach(url => tavernStageSfx.prepare(url)); }, [cues.join("\n")]);
	// 环境音: the same identity keeps playing (a renewed lease too), a new one crossfades in, the director's stop (or a lamp switched
	// off) fades out; 环境音 or 舞台模式 off and a skip stop at once. While the stage reads its data again (a rollback) what plays goes on.
	const ambienceOn = data ? data.enabled !== false && data.ambienceEnabled !== false : null, ambience = ambienceOn && data.ambience || null;
	React.useEffect(() => {
		if (ambienceOn === null) return;
		if (ambience) tavernStageAmbience.play(ambience.url, reader.mode === "skip", ambience.identity, { volume: ambience.volume });
		else tavernStageAmbience.stop(!ambienceOn || reader.mode === "skip");
	}, [ambienceOn, ambience && ambience.identity, ambience && ambience.url, ambience && ambience.volume]);
	React.useEffect(() => { tavernStageRuntime.sync(id); }, [id, reading.on, Boolean(config), backlog, typed, card, cards[card].text, lastCard]);
	useTavernStageArtFrames(sceneRef, art, reader.index, reader.auto);
	const atEnd = reader.index >= beats.length - 1, step = delta => tavernStageRuntime.page(id, index => index + delta);
	skipPossible.current = !(atEnd && lastCard);
	const stopSkip = () => { setSkipLatch(false); setSkipHeld(false); };
	// The control: on ends auto paging, a second press stops it.
	const toggleSkip = () => { tavernStageRuntime.setAuto(id, false); setSkipLatch(value => !value); };
	// One card a step, each shown whole (the card it lands on stays typed when the fast-forward stops there). It ends on the
	// round's last card; CONFIG or the backlog open pauses it.
	React.useEffect(() => {
		if (!skipping) return undefined;
		if (atEnd && lastCard) { stopSkip(); return undefined; }
		if (config || backlog) return undefined;
		const timer = setTimeout(() => {
			const now = shownRef.current;
			if (!now.last) { setTypedVisit(now.visit + ":" + (now.turns + 1)); showCard(now.card + 1); }
			else tavernStageRuntime.page(id, index => index + 1, "skip");
		}, STAGE_SKIP_CARD_MS);
		return () => clearTimeout(timer);
	}, [skipping, atEnd, lastCard, Boolean(config), backlog, cardKey]);
	// 旁白 (modules/stage-narration.js): a skin's art.narration lays a narration page out without the box (tavern.css 「stage narration」).
	const narration = skinDocument.art && skinDocument.art.narration || null;
	const narrationLayout = stageNarrationLayout({ narration, beat: beats[reader.index], skipping, mode: reader.mode, events: latest ? latest.performances : [], at: reader.index + 1 });
	const skipHoldBlocked = Boolean(config) || backlog;
	React.useEffect(() => {
		if (skipHoldBlocked) { setSkipHeld(false); return undefined; }
		let timer = 0;
		const cancel = () => { clearTimeout(timer); timer = 0; setSkipHeld(false); };
		// Any other key, click or wheel stops a fast-forward (the control's own press toggles it instead); advance(), back()
		// and the wheel then drop that input instead of turning a card.
		function interrupt(event) {
			const own = event && event.type === "pointerdown" && event.target && typeof event.target.closest === "function" && event.target.closest(STAGE_SKIP_CONTROL);
			const running = skippingRef.current && !own;
			skipStopped.current = running;
			cancel();
			if (running) setSkipLatch(false);
		}
		function onDown(event) {
			if (event.key !== "Control") { interrupt(event); return; }
			if (event.repeat || timer || event.altKey || event.shiftKey || event.metaKey) return;
			const target = event.target;
			if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
			timer = setTimeout(() => { timer = 0; if (!skipPossible.current) return; tavernStageRuntime.setAuto(id, false); setSkipHeld(true); }, STAGE_SKIP_HOLD_MS);
		}
		function onUp(event) { if (event.key === "Control") cancel(); }
		function onHidden() { if (document.hidden) cancel(); }
		window.addEventListener("keydown", onDown, true);
		window.addEventListener("keyup", onUp, true);
		window.addEventListener("wheel", interrupt, true);
		window.addEventListener("pointerdown", interrupt, true);
		window.addEventListener("blur", cancel);
		document.addEventListener("visibilitychange", onHidden);
		return () => {
			clearTimeout(timer); setSkipHeld(false); skipStopped.current = false;
			window.removeEventListener("keydown", onDown, true);
			window.removeEventListener("keyup", onUp, true);
			window.removeEventListener("wheel", interrupt, true);
			window.removeEventListener("pointerdown", interrupt, true);
			window.removeEventListener("blur", cancel);
			document.removeEventListener("visibilitychange", onHidden);
		};
	}, [skipHoldBlocked, id]);
	// A click, → / Space / Enter, a wheel step or ›: finish the line still typing, else the next card, else the next page.
	const advance = () => {
		if (skipStopped.current) { skipStopped.current = false; return; }
		const now = shownRef.current;
		if (!typedRef.current) setTypedVisit(visitRef.current);
		else if (!now.last) showCard(now.card + 1);
		else step(1);
	};
	// ← / ‹: the card before, else the previous page's last card.
	const back = () => {
		if (skipStopped.current) { skipStopped.current = false; return; }
		const now = shownRef.current;
		if (now.card > 0) showCard(now.card - 1);
		else if (now.reader.index > 0) { landLast(); step(-1); }
	};
	React.useEffect(() => {
		function onKey(event) {
			if (configOpen.current) return;
			if (event.target && /^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return;
			// The BGM panel's keys are its own (its Esc closes only the panel).
			if (event.target && event.target.closest && event.target.closest(".dsh-tavern-bgm-panel")) return;
			const letter = !event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1 ? event.key.toLowerCase() : "";
			// The backlog keeps the keyboard (arrows / Page keys scroll it; Enter on a row jumps).
			if (backlogOpen.current) {
				if ((event.key === "Escape" || letter === "l") && !event.repeat) { event.preventDefault(); event.stopPropagation(); closeBacklog(); }
				return;
			}
			if (letter === "l") { event.preventDefault(); if (!event.repeat) openBacklog(null); }
			else if (event.key === "Escape") { event.stopPropagation(); props.onClose(); }
			// Enter / Space on a choice press it; they turn no page.
			else if ((event.key === " " || event.key === "Enter") && event.target && event.target.closest && event.target.closest(".dsh-tavern-stage-choices")) return;
			else if (event.key === "ArrowRight" || event.key === " " || event.key === "Enter") { event.preventDefault(); advance(); }
			else if (event.key === "ArrowLeft") { event.preventDefault(); back(); }
		}
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [id, props.onClose]);
	// A control the skin draws (quickMenu.icons: back = ‹, auto, skip) shows its icon on the skin's button body; the others keep
	// their own words. Every control keeps its action, name and keys.
	const control = (action, label, glyph, attributes, on) => {
		const icon = icons[action];
		return h("button", { type: "button", "data-action": action, ...attributes, ...(icon ? { "aria-label": label, title: label, className: (attributes.className || "") + " has-icon" } : null) },
			icon ? tavernStageControlIcon(icon, on, attributes.disabled) : glyph);
	};
	const footer = h("div", { className: "dsh-tavern-stage-controls", onClick: event => event.stopPropagation() },
		control("back", "上一句", "‹", { onClick: back, disabled: reader.index <= 0 && card === 0, "aria-label": "上一句" }),
		h("span", { className: "dsh-tavern-stage-progress" }, beats.length ? (reader.index + 1) + " / " + beats.length : ""),
		h("button", { type: "button", onClick: advance, disabled: atEnd && lastCard, "aria-label": "下一句" }, "›"),
		control("auto", "自动", "自动", { className: reader.auto ? "is-on" : "", onClick: () => { setSkipLatch(false); tavernStageRuntime.setAuto(id, !reader.auto); }, "aria-pressed": reader.auto }, reader.auto),
		control("skip", "跳过", "跳过", { className: skipping ? "is-on" : "", onClick: toggleSkip, "aria-pressed": skipping, title: "跳过（按住 Ctrl 快进）" }, skipping),
		control("backlog", "履历", "履历", { title: "履历（L / 滚轮向上）", onClick: event => openBacklog(event.currentTarget) }),
		h(TavernBgmStage, { sessionId: id }),
		h(TavernMusicToggle, null),
		h(TavernStageSoundEntry, { openConfig }),
		h("span", { className: "dsh-tavern-spacer" }),
		h("button", { type: "button", onClick: props.onClose }, "退出舞台"));
	const generating = props.generating ?? running;
	// The round's last card ends on the choice menu (stage-choices.js); its waits take the box's place. It docks on Tavern's
	// own box (above the box, or its image); a plugin view keeps it under the scene.
	const input = h(TavernStageChoices, { key: id, sessionId: id, flow: props.choices, messageId, running: generating, atEnd: atEnd && lastCard,
		submit: text => props.submit(id, text), lines: skinDocument.waitLines || STAGE_WAIT_LINES });
	const docked = !choice.view;
	// The stage's wheel (modules/stage-backlog.js stageWheelDecision): up opens the backlog, down turns a page. An open CONFIG or
	// backlog keeps its own wheel; the BGM panel scrolls its list.
	const wheelGesture = React.useRef(null);
	function wheel(event) {
		if (configOpen.current || backlogOpen.current || Date.now() - backlogClosedAt.current < 450) return;
		if (event.target && event.target.closest && event.target.closest(".dsh-tavern-bgm-panel")) return;
		if (skipStopped.current) { skipStopped.current = false; return; } // this notch only stopped a fast-forward
		const decision = stageWheelDecision(wheelGesture.current, { now: Date.now(), deltaY: event.deltaY, deltaMode: event.deltaMode, typed: typedRef.current });
		wheelGesture.current = decision.state;
		if (decision.action === "backlog") openBacklog(null);
		else if (decision.action === "advance" || decision.action === "finish") advance();
	}
	// A row of the latest turn: auto paging stops and the stage shows that page (the current one: back to the stage as it was).
	function jumpBack(page, turn) {
		closeBacklog();
		if (!latest || turn !== latest.turn) return;
		tavernStageRuntime.setAuto(id, false);
		// the page shows its first card whole: a turn is the next visit; the current page stays this one and goes back to its first card
		if (page === reader.index) { setSpot({ visit, offset: 0, turns: here.turns + 1 }); setTypedVisit(visit + ":" + (here.turns + 1)); }
		else setTypedVisit(reader.key + ":" + (reader.visit + 1) + ":0");
		tavernStageRuntime.page(id, page);
	}
	return h("div", { className: "dsh-tavern-stage-overlay", role: "dialog", "aria-modal": "true", "aria-label": "舞台", ...skin,
		...(art ? { ...art.marks, style: { ...skin.style, ...art.tokens } } : null), "data-narration-layout": narrationLayout, "data-stage-auto": reader.auto ? "" : undefined, "data-stage-backlog": backlog ? "" : undefined, onWheel: wheel },
		h(TavernStageSceneView, { scene, view: choice.view, sessionId: id, data, beats, index: reader.index, sceneRef, onAdvance: advance, footer, art, speaking, dock: docked ? input : null,
			visit: cardKey, typed, textSpeed: prefs.textSpeed, reveal, narrationLines: narration && narration.lines, onTyped: () => setTypedVisit(cardKey), textRef: pager.textRef, card: cards[card].text, more: !lastCard }),
		docked ? null : input,
		config ? h(TavernStageConfigScreen, { tab: config.tab, onClose: closeConfig,
			tests: { voice: reading.on && beats[reader.index] ? () => tavernSpeech.speak(tavernBeatSpeech(id, beats[reader.index], data)) : null } }) : null,
		backlog ? h(TavernStageBacklog, { sessionId: id, data, page: reader.index, onJump: jumpBack, onClose: closeBacklog }) : null,
		entrance.element);
}

// 跳过 shows a card every 150 ms, each painted fully before the next: 9 frames at 60 Hz, long enough to see each card as a
// distinct frame, short enough for a 40-card round in about 6 s. Ctrl must be held 160 ms before it skips.
const STAGE_SKIP_CARD_MS = 150, STAGE_SKIP_HOLD_MS = 160;
const STAGE_SKIP_CONTROL = '[data-action="skip"]';

// A drawn control (stageSkinControlIcons): the icon (its `on` image while it runs) alone, or on the skin's button body - its
// normal / on / disabled image by state and the hover image over it under the pointer and keyboard focus - in the glyph box.
function tavernStageControlIcon(icon, on, disabled) {
	const h = React.createElement;
	const glyph = h("img", { key: "icon", className: "dsh-tavern-stage-control-icon", src: on && icon.on || icon.image, alt: "", draggable: false });
	const body = icon.button;
	if (!body) return glyph;
	const [x, y, w, height] = body.glyph;
	return h("span", { className: "dsh-tavern-stage-control-art", "aria-hidden": true, "data-hover": body.hover ? "" : undefined, "data-disabled": body.disabled ? "" : undefined,
		style: { "--qm-aspect": body.aspect, "--qm-gx": x, "--qm-gy": y, "--qm-gw": w, "--qm-gh": height } },
		h("img", { key: "body", className: "dsh-tavern-stage-control-body", src: disabled && body.disabled || on && body.on || body.normal, alt: "", draggable: false }),
		body.hover && !disabled ? h("img", { key: "hover", className: "dsh-tavern-stage-control-body is-hover", src: on && body.on || body.hover, alt: "", draggable: false }) : null,
		glyph);
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
