// 逐字显示 (features/stage-typewriter.js): a page's line is typed out glyph by glyph, at the reader's 文字速度
// (CONFIG › 文字, modules/stage-runtime.js `textSpeed`, milliseconds per glyph; 0 shows the whole line at once).
// A glyph is a grapheme (an emoji with its modifiers or a letter with its marks is one step).
const STAGE_GLYPH_SEGMENTER = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
function stageGlyphs(text) {
	const value = String(text || "");
	return STAGE_GLYPH_SEGMENTER ? Array.from(STAGE_GLYPH_SEGMENTER.segment(value), part => part.segment) : Array.from(value);
}
// Extra glyph steps to wait after glyphs[index]: after a sentence end (also behind its closing quote, 。」) and a
// line break, a shorter one after a comma; none inside a run of punctuation or at the end.
function stageGlyphPause(glyphs, index) {
	const closers = /^[」』）)】〉》”"’'］\]]$/u, next = glyphs[index + 1];
	if (next === undefined || closers.test(next) || /^[、，,。．.！!？?…‥：:；;～~—―]$/u.test(next)) return 0;
	let at = index;
	while (at > 0 && closers.test(glyphs[at])) at--;
	const glyph = glyphs[at];
	if (glyph === "\n" || /^[。．.！？!?…‥]$/u.test(glyph) && (glyph !== "." || /^\s$/.test(next))) return 5;
	if (/^[、，,；;：:～~]$/u.test(glyph)) return 2;
	if (/^[—―]$/u.test(glyph)) return 1;
	return 0;
}
// Milliseconds before glyphs[index + 1] shows: one step at the reader's speed, plus the pause after glyphs[index].
function stageGlyphDelay(glyphs, index, speed) {
	return speed * (1 + (index >= 0 ? stageGlyphPause(glyphs, index) : 0));
}
// How long a glyph fades in (tavern.css 「stage typewriter」 dsh-tavern-stage-glyph-in).
const STAGE_GLYPH_FADE_MS = 220;

