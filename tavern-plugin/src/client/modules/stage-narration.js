// 旁白 (features/stage-narration.js, tavern.css 「stage narration」): a skin that declares art.narration reads its narration
// pages without the text box - the lines over the darkened scene (screen), or in a band along the bottom while the page shows
// a picture (band), so the narration does not cover it. A skin without art.narration keeps its own narration box.
// The layout of the page on screen: none unless the skin declares art.narration and the page is narration; a fast-forward
// keeps the box (150 ms pages must not flip the veil and the band). band: the page's item has a picture and this visit plays
// it (a page turn or a new body: a skip and a restored page never show it). The page's events do not change during a
// visit, so the layout holds for the whole line. The skin's art.narration.layout wins over the picture: box keeps the box
// (none), free is always centred, band always the strip.
function stageNarrationLayout({ narration, beat, skipping, mode, events, at }) {
	if (!narration || !beat || beat.kind !== "narration" || skipping || narration.layout === "box") return undefined;
	if (narration.layout) return narration.layout === "free" ? "screen" : "band";
	const picture = (mode === "page" || mode === "live") && (events || []).some(event => event.op === "item.play" && event.at === at && event.image);
	return picture ? "band" : "screen";
}

// art.narration.lines: the visual lines of a card, from each glyph's measured top (one entry per glyph, in order). A glyph
// on a new top starts a line; a line break stays with the line it ends.
function stageNarrationLineRuns(glyphs, tops) {
	const lines = [];
	let top = null;
	glyphs.forEach((glyph, i) => {
		if (!lines.length || tops[i] !== top) { lines.push(""); top = tops[i]; }
		lines[lines.length - 1] += glyph;
	});
	return lines;
}
