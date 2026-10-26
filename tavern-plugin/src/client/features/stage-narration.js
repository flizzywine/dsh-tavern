// 旁白逐行 (the skin's art.narration.lines, modules/stage-narration.js): a narration card comes in visual line by visual line
// instead of glyph by glyph - each line fades in over `fade` s, rising `rise` design px, `stagger` s after the one before.
// The card's lines are measured (each glyph's top, in a hidden copy at the text area's width) once fonts are ready and again
// when its text, the fonts or the area's size change, never in an animation frame; the clock starts once, so a re-measure
// does not restart it. A finished card (the first click, a skip, a restored page), the system's reduced motion and 文字速度 0
// show every line at once. It reports done (onDone, data-typed) once its last line has faded in, as the typewriter does.
// props: { text, lines: { fade, stagger, rise? }, speed, instant, onDone() }.
function TavernStageNarrationLines(props) {
	const h = React.createElement, ref = React.useRef(null), clock = React.useRef(null);
	const fontsReady = useTavernStageFontsReady();
	const [lines, setLines] = React.useState([]), [visible, setVisible] = React.useState(0);
	const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
	const instant = Boolean(props.instant) || still || props.speed === 0;
	const { fade, stagger, rise = 0 } = props.lines;
	const onDone = React.useRef(props.onDone);
	onDone.current = props.onDone;
	React.useLayoutEffect(function () {
		const node = ref.current;
		if (!fontsReady || !node) return undefined;
		const parent = node.parentElement;
		function measure() {
			const probe = document.createElement("span"), style = getComputedStyle(parent);
			Object.assign(probe.style, { display: "block", position: "absolute", visibility: "hidden", pointerEvents: "none", whiteSpace: "pre-wrap",
				width: (parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) + "px" });
			probe.textContent = props.text;
			parent.appendChild(probe);
			const glyphs = stageGlyphs(props.text), range = document.createRange(), text = probe.firstChild, tops = [];
			let offset = 0;
			for (const glyph of glyphs) {
				range.setStart(text, offset); range.setEnd(text, offset += glyph.length);
				tops.push(Math.round(range.getBoundingClientRect().top));
			}
			probe.remove();
			const result = stageNarrationLineRuns(glyphs, tops);
			setLines(old => old.join("\u0000") === result.join("\u0000") ? old : result);
		}
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(parent);
		document.fonts?.addEventListener("loadingdone", measure);
		return () => { observer.disconnect(); document.fonts?.removeEventListener("loadingdone", measure); };
	}, [props.text, fontsReady]);
	React.useEffect(function () {
		if (!lines.length) return undefined;
		if (clock.current === null) clock.current = performance.now();
		const show = count => { setVisible(count); if (count === lines.length && onDone.current) onDone.current(); };
		if (instant) { show(lines.length); return undefined; }
		const timers = lines.map((_, i) => setTimeout(() => show(i + 1), Math.max(0, clock.current + (i * stagger + fade) * 1000 - performance.now())));
		return () => timers.forEach(timer => clearTimeout(timer));
	}, [lines, instant, fade, stagger]);
	return h("span", { ref, className: "dsh-tavern-stage-type dsh-tavern-stage-lines", "data-instant": instant ? "" : undefined, "data-typed": lines.length && visible >= lines.length ? "" : undefined },
		lines.map((line, i) => h("span", { key: i, className: "dsh-tavern-stage-line",
			style: { "--nar-fade": fade + "s", "--nar-delay": i * stagger + "s", "--nar-rise": "calc(" + rise + " * var(--nar-u))" } }, line)));
}
