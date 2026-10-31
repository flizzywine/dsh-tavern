// Stage helpers: the galgame stage's top-level pure functions and hooks (gal-stage.js includes this source inside its
// module factory; Node tests require it or evaluate it beside their stubs). Runtime neighbours (typewriter pages, bubble
// characters, React) are read only when called.
// galIsSuperseded(...) reads the host projection; never changes its visibility or history.
function galIsSuperseded(view, nativeTurn, storyTurn) {
    const mappings = view && view.regeneratedDshTurns || {};
    const replacement = Number(mappings[storyTurn]);
    if (replacement > 0) return Number(nativeTurn) !== replacement;
    // Replacement native turns are also suppressed by the host, but remain our authoritative source.
    if (Object.values(mappings).some(turn => Number(turn) === Number(nativeTurn))) return false;
    return (view && view.suppressedDshTurns || []).some(turn => Number(turn) === Number(nativeTurn));
}

// Plain reading text for the text box: markdown decorations off, line breaks kept.
function galPlain(text) { return stagePagePlain(text); }
// Narration: one page per paragraph; a long paragraph splits at sentence ends.
// Paragraph blocks, counted exactly like the host director (lib/domain/stage-director.js
// stageParagraphs): blank lines split; HTML blocks, rules and empty blocks do not count.
function galBlocks(text) {
    return String(text || "").split(/\n\s*\n/).filter(block => block.trim() && !/^\s*</.test(block) && !/^\s*[-*_]{3,}\s*$/.test(block));
}
// One source index for chat entries, stage pages and history rows. Pagination never adds paragraphs.
function galParagraphs(parts, base = 0) {
    const units = [];
    let para = base;
    parts.forEach(function (part, partIndex) {
        if (part.units) {units.push(...part.units);return;}
        (part.segments || []).forEach(function (segment, index) {
            const lastSegment = partIndex === parts.length - 1 && index === part.segments.length - 1;
            if (segment.kind === "markdown") {
                const blocks = galBlocks(segment.text);
                blocks.forEach((block, b) => units.push({ kind: "narration", block, text: galPlain(block), para: ++para, index,
                    pending: Boolean(lastSegment && part.streaming && b === blocks.length - 1) }));
            } else {
                units.push({ kind: "line", para: ++para, index, alias: segment.alias, name: segment.name, mood: segment.mood,
                    text: segment.thought ? "（" + segment.text + (segment.streaming ? "" : "）") : segment.text,
                    thought: segment.thought, pending: Boolean(segment.streaming), voice: part.voices && part.voices[index] || null });
            }
        });
    });
    return units;
}
// Each page carries its source paragraph number (para, from 1) for the director's cues.
function galPages(parts) {
    return galParagraphs(parts).flatMap(function (unit) {
        const { block, index, ...page } = unit;
        if (unit.kind !== "narration") return [page];
        const texts = stagePageCards(unit).map(card => card.text);
        return texts.map((text, n) => ({ ...page, text, pending: page.pending && n === texts.length - 1 }));
    });
}
// Display only (classic text box): a spoken line reads 「…」. Text that already opens with a bracket
// (a thought's （…）, a quote the model wrote itself) is left alone; the closing bracket waits until
// the line has finished streaming.
function galQuoted(text, pending) {
    const value = String(text || "").replace(/^\s+/, "");
    if (!value || /^[「『（(【〈《“"‘'［\[]/.test(value)) return value;
    return "「" + value + (pending || /」$/.test(value) ? "" : "」");
}
// the skin's stage projection - where figures
// stand, how many are drawn, the framing, whether listeners dim, whether figures draw at all. The one reader for every
// display mode (skin, film, classic, phone): a display mode changes chrome, never who stands where. A skin that leaves
// maxFigures out draws at most 3, and so does a built-in theme with no pack
// skin document (classic and the other built-ins too).
function stageSkinFigures(skin) {
    return { slots: skin?.figureSlots, max: skin?.maxFigures ?? 3, framing: skin?.figures, dimListeners: skin?.dimListeners !== false, shown: skin?.figures?.mode !== "none" };
}
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { galIsSuperseded, galPlain, galBlocks, galParagraphs, galPages, galQuoted, stageSkinFigures };
