// 分页 (modules/stage-pager.js): the text box's pager. It measures the stage's real text element - a hidden clone with its
// class and width, in the same parent - and cuts each page near the one shown (the page and its neighbours) into cards of at
// most STAGE_PAGE_LINES lines, fewer when the box holds fewer (a phone's box). New text is measured before paint; a resize,
// a skin change and fonts that finish loading measure again; a page's cards are cached by text, width and font.
// `offset` (characters into the page) says which card shows, so a re-measured page keeps the reader's place.
// -> { textRef, cards, card }: the text element's ref, the shown page's cards and the shown card.
function useTavernStagePager(pages, index, offset, look) {
	const [element, setElement] = React.useState(null);
	const textRef = React.useCallback(node => setElement(node), []);
	const [layout, setLayout] = React.useState(null);
	const cache = React.useMemo(() => tavernStagePagerCache(256), []);
	const texts = JSON.stringify(pages.map(page => page.text));
	const indexRef = React.useRef(index);
	indexRef.current = index;
	const measureNow = React.useRef(null);
	React.useLayoutEffect(function () {
		if (!element) return undefined;
		let scheduled = 0;
		const clone = element.cloneNode(false);
		clone.removeAttribute("id"); clone.setAttribute("aria-hidden", "true");
		Object.assign(clone.style, { position: "fixed", left: "-100000px", top: "0", height: "auto", maxHeight: "none", minHeight: "0", boxSizing: "border-box", visibility: "hidden", overflow: "visible", pointerEvents: "none", animation: "none" });
		// Every card keeps room for the page cue where a skin flows it after the line (an inline cue); placed on the box it takes none.
		const cue = document.createElement("span");
		cue.className = "dsh-tavern-stage-next";
		function measure() {
			if (scheduled) return;
			scheduled = requestAnimationFrame(function () { scheduled = 0; run(); });
		}
		function run() {
			const width = element.clientWidth;
			if (!width) return;
			const own = getComputedStyle(element), lineHeight = parseFloat(own.lineHeight), fontSize = parseFloat(own.fontSize);
			// Without the stage stylesheet there is no fixed-height box to paginate.
			if (!(lineHeight > 0)) return;
			// The text area: its own height in a box that sizes it (经典), or the art box's cap (max-height) where it grows with its lines.
			const cap = parseFloat(own.maxHeight), area = (cap > 0 ? cap : element.clientHeight) - parseFloat(own.paddingTop) - parseFloat(own.paddingBottom);
			const lines = Math.min(STAGE_PAGE_LINES, stageBoxRoom(area, lineHeight, fontSize));
			clone.style.width = width + "px";
			clone.textContent = "";
			clone.appendChild(cue);
			element.parentNode.appendChild(clone);
			try {
				const font = [own.fontFamily, own.fontWeight, own.fontStyle, own.fontStretch, own.fontSize, own.letterSpacing, own.lineHeight, own.wordBreak, own.overflowWrap, own.whiteSpace, own.padding, getComputedStyle(cue).display, lines].join("|");
				const fits = text => {
					clone.textContent = text + (/[\r\n]$/.test(text) ? "\u200b" : "");
					clone.appendChild(cue);
					return clone.offsetHeight <= lineHeight * lines + 0.5;
				};
				const near = at => Math.abs(at - indexRef.current) <= 1;
				const next = { width, font, texts: pages.map(page => page.text), cards: pages.map((page, at) => near(at) ? cache.get(page.text, width, font, () => stagePagerCards(page.text, fits)) : null) };
				setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
			} finally { clone.remove(); }
		}
		measureNow.current = run;
		run();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		window.addEventListener("resize", measure);
		const fonts = document.fonts;
		function fontsLoaded() { cache.clear(); measure(); }
		if (fonts) fonts.addEventListener("loadingdone", fontsLoaded);
		return () => { measureNow.current = null; cancelAnimationFrame(scheduled); clone.remove(); observer.disconnect(); window.removeEventListener("resize", measure); if (fonts) fonts.removeEventListener("loadingdone", fontsLoaded); };
	}, [element, texts, look]);
	// A page turn measures its new neighbourhood before paint (cached pages cost no text layout).
	React.useLayoutEffect(function () { if (measureNow.current) measureNow.current(); }, [index]);
	const page = pages[index];
	// Before its text is measured a page is one card.
	const measured = page && layout && layout.texts[index] === page.text ? layout.cards[index] : null;
	const cards = measured || [{ text: page ? page.text : "", start: 0, end: Array.from(page ? page.text : "").length }];
	return { textRef, cards, card: stageCardAt(cards, offset) };
}
function tavernStagePagerCache(limit) {
	const entries = new Map();
	return {
		clear() { entries.clear(); },
		get(text, width, font, measure) {
			const key = JSON.stringify([text, width, font]);
			if (entries.has(key)) { const value = entries.get(key); entries.delete(key); entries.set(key, value); return value; }
			const value = measure();
			entries.set(key, value);
			while (entries.size > limit) entries.delete(entries.keys().next().value);
			return value;
		}
	};
}
