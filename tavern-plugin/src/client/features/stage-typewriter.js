// 逐字显示: the stage's text box types its line out (modules/stage-typewriter.js), each glyph fading in. The whole line is laid
// out from the start (the glyphs not shown yet are transparent), so nothing re-wraps while it types and a screen reader reads
// the whole line. Only the glyphs still fading in are separate elements; the shown text is one run and the rest another, so a
// settled line paints exactly as plain text. props: { text, speed (ms per glyph; 0 or instant: all at once), instant, onDone() }.
function TavernStageTypewriter(props) {
	const h = React.createElement;
	const speed = props.speed == null ? STAGE_READING_DEFAULTS.textSpeed : props.speed;
	const instant = Boolean(props.instant) || !(speed > 0);
	const glyphs = React.useMemo(() => stageGlyphs(props.text), [props.text]);
	const fontsReady = useTavernStageFontsReady();
	const [shown, setShown] = React.useState(instant ? glyphs.length : 0);
	const visible = instant ? glyphs.length : Math.min(shown, glyphs.length);
	const [settled, setSettled] = React.useState(-1);
	const onDone = React.useRef(props.onDone);
	onDone.current = props.onDone;
	React.useEffect(function () {
		if (visible >= glyphs.length && onDone.current) onDone.current();
		if (instant || !fontsReady || visible >= glyphs.length) {
			const timer = setTimeout(() => setSettled(visible), STAGE_GLYPH_FADE_MS + 40);
			return () => clearTimeout(timer);
		}
		const timer = setTimeout(() => setShown(visible + 1), stageGlyphDelay(glyphs, visible - 1, speed));
		return () => clearTimeout(timer);
	}, [visible, glyphs, instant, fontsReady, speed]);
	// Glyphs before `settled` finished fading earlier, so they join the shown run.
	const tail = Math.ceil(STAGE_GLYPH_FADE_MS / Math.max(1, speed)) + 1;
	const done = instant ? visible : Math.min(visible, Math.max(0, settled, visible - tail));
	return h("span", { className: "dsh-tavern-stage-type" + (instant ? " is-instant" : ""), "data-typed": visible >= glyphs.length ? "" : undefined },
		done > 0 ? h("span", { key: "shown", className: "dsh-tavern-stage-type-shown" }, glyphs.slice(0, done).join("")) : null,
		glyphs.slice(done, visible).map((glyph, index) => h("span", { key: done + index, className: "dsh-tavern-stage-glyph" }, glyph)),
		visible < glyphs.length ? h("span", { key: "rest", className: "dsh-tavern-stage-type-rest" }, glyphs.slice(visible).join("")) : null);
}

// Typing starts once the page's fonts have loaded (a glyph laid out in a fallback face would move when the font arrives), or
// after 800 ms whatever they do.
function useTavernStageFontsReady() {
	const fonts = typeof document !== "undefined" ? document.fonts : null;
	const [ready, setReady] = React.useState(() => !fonts || fonts.status === "loaded");
	React.useEffect(function () {
		if (ready) return undefined;
		let live = true;
		const done = () => { if (live) setReady(true); };
		fonts.ready.then(done, done);
		const timer = setTimeout(done, 800);
		return () => { live = false; clearTimeout(timer); };
	}, []);
	return ready;
}

// CONFIG › 文字's preview: a sample line typed at the chosen speed, then held for the auto wait (as a silent page would be),
// then again. The next-page cue shows while it waits.
const STAGE_CONFIG_SAMPLE = "夕阳把走廊染成了橘色。她停下脚步，回头看了你一眼。";
function TavernStageConfigPreview(props) {
	const h = React.createElement, reading = props.reading;
	const [round, setRound] = React.useState(0), [done, setDone] = React.useState(false);
	React.useEffect(function () { setDone(false); setRound(n => n + 1); }, [reading.textSpeed, reading.autoWait, reading.autoSpeed]);
	React.useEffect(function () {
		if (!done) return undefined;
		const timer = setTimeout(() => { setDone(false); setRound(n => n + 1); }, Math.min(6000, stageAutoDelay(reading, false, STAGE_CONFIG_SAMPLE)));
		return () => clearTimeout(timer);
	}, [done]);
	return h("div", { className: "dsh-tavern-stage-config-preview", "aria-hidden": true },
		h("span", { className: "dsh-tavern-stage-config-preview-name" }, "预览"),
		h("div", { className: "dsh-tavern-stage-config-preview-text" },
			h(TavernStageTypewriter, { key: round, text: STAGE_CONFIG_SAMPLE, speed: reading.textSpeed, onDone: () => setDone(true) }),
			done ? h("i", { className: "dsh-tavern-stage-config-preview-next" }) : null));
}
