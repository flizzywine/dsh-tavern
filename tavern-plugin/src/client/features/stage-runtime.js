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
	const next = props.art && index < beats.length - 1 ? h("span", { className: "dsh-tavern-stage-next", "aria-hidden": true }) : null;
	const lamp = props.art ? h("span", { className: "dsh-tavern-stage-lamp", "aria-hidden": true }) : null;
	const nameRef = React.useRef(null);
	useTavernStageNameFit(nameRef, beat && beat.kind === "line" ? beat.speaker : "", props.art);
	// The skin's face window (art.portrait, stage-skin.js stageSkinPortraitArt): the speaker's avatar on a line page; empty on
	// narration and for a speaker without one, so no empty frame shows.
	const side = props.art && props.art.marks["data-fk-skin-portrait"] ? h(TavernStageSide, { face: beat && beat.kind === "line" ? tavernCastAvatar(data, beat.speaker, beat.emotion) : "",
		name: beat && beat.kind === "line" ? beat.speaker : "", nameArc: props.art.faceName }) : null;
	// 物品: this page's item (one at most) waits unseen, its picture already loading; the page's playback shows it once.
	const item = (data.turns.at(-1)?.performances || []).find(event => event.op === "item.play" && event.at === index + 1);
	return h("div", { ref: props.sceneRef, className: "dsh-tavern-stage-scene", onClick: props.onAdvance },
		h("div", { className: "dsh-tavern-stage-backdrop" + (scene.backdrop ? " is-scene" : ""), style: scene.background ? { "--dsh-stage-backdrop": "url(\"" + scene.background + "\")" } : undefined }),
		h("div", { className: "dsh-tavern-stage-figures" }, scene.figures.map(function (figure) {
			const name = figure.name;
			const speaker = beat && tavernCastCharacter(data.cast, beat.speaker);
			const speaking = beat && (speaker ? speaker.name : beat.speaker) === name;
			return h(TavernStageFigure, { key: name, name: name, url: figure.url, dim: beat && beat.kind === "line" && !speaking });
		})),
		item ? h(TavernStageItem, { key: index + ":" + item.item, item }) : null,
		// is-speaking: the page's line is being read aloud (a skin's art.portrait.frame.speaking frame shows then).
		beat ? h("div", { className: "dsh-tavern-stage-textbox" + (beat.kind === "narration" ? " is-narration" : "") + (props.speaking && beat.kind === "line" ? " is-speaking" : "") },
			side,
			beat.kind === "line" ? h("div", { className: "dsh-tavern-stage-name" }, h("b", { ref: nameRef, "data-text": beat.speaker }, beat.speaker),
				TAVERN_CAST_EMOTIONS[beat.emotion] && beat.emotion !== "neutral" ? h("span", { className: "dsh-tavern-cast-emotion" }, TAVERN_CAST_EMOTIONS[beat.emotion]) : null) : null,
			h("div", { key: index, className: "dsh-tavern-stage-text" + (beat.kind === "narration" ? " is-narration" : "") }, beat.text, next),
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

function playTavernStagePerformance(root, event, id) {
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
	if (!root || still) return null;
	const target = event.op === "screen.play" ? root : Array.from(root.querySelectorAll("[data-speaker]")).find(function (node) { return node.dataset.speaker === event.actor; });
	if (!target) return null;
	const frames = event.op === "screen.play" ? ["none", "translateX(-3px)", "translateX(3px)", "translateX(-2px)", "none"]
		: event.motion === "nod" ? ["none", "translateY(2%)", "none", "translateY(1%)", "none"] : ["none", "translateY(-6%)", "none"];
	return target.animate(frames.map(function (transform) { return { transform: transform }; }), { id: "stage:" + id, duration: event.op === "screen.play" ? 450 : 650, easing: "ease-in-out" });
}

// 音效 (modules/stage-sfx.js): one page-wide one-shot player on the page's AudioContext, shared with the BGM transport.
const tavernStageSfx = createStageSfx({ context: () => tavernStageAudio.context(), fetch: (url, init) => window.fetch(url, init),
	clock: { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: id => window.clearTimeout(id) } });
// 环境音 (castStage `ambience`): the state's loop for the place or weather on a second BGM transport (modules/stage-music.js) on the
// same AudioContext, so it sounds alongside the BGM. Only the open stage plays it; it follows the state across pages and turns.
const tavernStageAmbience = createStageMusic({ context: () => tavernStageAudio.context(), fetch: (url, init) => window.fetch(url, init),
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
	const icons = React.useMemo(() => stageSkinControlIcons(skinDocument, artFiles), [skinDocument, artFiles]);
	// 入场演出 (stage-entrance.js) plays over the stage as it opens; the stage is drawn under it all along.
	const entrance = useTavernStageEntrance(data && data.entrance, Boolean(data));
	const sceneRef = React.useRef(null), readingOn = React.useRef(reading.on);
	readingOn.current = reading.on;
	// A channel that can ready its voices (Fish /v1/warm, when its service offers it) is asked once as the stage opens.
	React.useEffect(() => { if (reading.prepares) rpc("speechPrepare", {}, id).catch(() => {}); }, [id, reading.prepares]);
	// While a line is read aloud (from its request until it ends or is stopped); a newer reading owns the flag.
	const [speaking, setSpeaking] = React.useState(false), spoken = React.useRef(0);
	const [draft, setDraft] = React.useState(""), [sending, setSending] = React.useState(false);
	const session = () => props.sessions?.binding(id)?.session;
	const running = React.useSyncExternalStore(fn => session()?.subscribe(fn) || (() => {}), () => session()?.getSnapshot().running === true);
	React.useEffect(() => tavernStageRuntime.attach(id, {
		animate: (event, key) => playTavernStagePerformance(sceneRef.current, event, key),
		speech: { on: () => readingOn.current, stop: () => { spoken.current++; setSpeaking(false); tavernSpeech.stop(); },
			speak: beat => {
				const mine = ++spoken.current, done = tavernSpeech.speak(tavernBeatSpeech(id, beat));
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
	// A control the skin draws (quickMenu.icons: back = ‹, auto, skip) shows its icon on the skin's button body; the others keep
	// their own words. Every control keeps its action, name and keys.
	const control = (action, label, glyph, attributes, on) => {
		const icon = icons[action];
		return h("button", { type: "button", "data-action": action, ...attributes, ...(icon ? { "aria-label": label, title: label, className: (attributes.className || "") + " has-icon" } : null) },
			icon ? tavernStageControlIcon(icon, on, attributes.disabled) : glyph);
	};
	const footer = h("div", { className: "dsh-tavern-stage-controls", onClick: event => event.stopPropagation() },
		control("back", "上一句", "‹", { onClick: () => step(-1), disabled: reader.index <= 0, "aria-label": "上一句" }),
		h("span", { className: "dsh-tavern-stage-progress" }, beats.length ? (reader.index + 1) + " / " + beats.length : ""),
		h("button", { type: "button", onClick: () => step(1), disabled: atEnd, "aria-label": "下一句" }, "›"),
		control("auto", "自动", "自动", { className: reader.auto ? "is-on" : "", onClick: () => tavernStageRuntime.setAuto(id, !reader.auto), "aria-pressed": reader.auto }, reader.auto),
		control("skip", "跳过", "跳过", { onClick: () => tavernStageRuntime.page(id, beats.length - 1, "skip") }),
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
		h(TavernStageSceneView, { scene, view: choice.view, sessionId: id, data, beats, index: reader.index, sceneRef, onAdvance: () => step(1), footer, art, speaking, dock: docked ? input : null }),
		docked ? null : input, entrance.element);
}

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
