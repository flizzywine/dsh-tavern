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
// Gaze direction on screen for a member: -1 left, 0 viewer, 1 right; null when not directed.
function galGaze(look, x, others) {
    if (!look) return null;
    if (look === "away") return x > 0.5 ? 1 : -1;
    const target = others[look];
    if (target == null || Math.abs(target - x) < 0.01) return 0;
    return target > x ? 1 : -1;
}
// where the current line's speaker stands, for skins that point at
// them (a bubble tail). The speaker is the alias the single resolver gave the line (bubbleCharacter); its place is
// where the scene reports the figure's body is drawn (layout.body: the picture's body centre through the figure's own
// transform and the settled camera, sampled once the figure stands still), else - a DOM stand-in, or before the first
// settled sample - the reported layout slot (galFigureLayout x) moved by the settled camera; times the reported stage
// width, so nothing is measured here. Spoken lines and inner monologue (both kind "line") anchor; narration, a speaker
// that is not drawn on stage (parked, no sprite or stand-in), a CG or the open phone does not -> null.
function galSpeakerAnchor({ line, speaker, layout, drawn, covered }) {
    if (covered || !line || line.kind !== "line" || !speaker || !layout || !(layout.width > 0) || !layout.x || !(speaker in layout.x) || !drawn(speaker)) return null;
    // Under a close-up (or any framed shot) the camera's settled goal moves the figure on screen: (x - fx) * zoom + ax.
    const c = layout.camera, slot = Number(layout.x[speaker]), body = layout.body?.[speaker];
    const x = Number.isFinite(body) ? body : c && c.zoom > 0 ? (slot - c.fx) * c.zoom + c.ax : slot;
    // A speaker framed out (or left as a sliver at the edge) has no anchor.
    if (!Number.isFinite(x) || x < 0.04 || x > 0.96) return null;
    // Three sides, like the original's three balloons (textLeft / textCenter / textRight): the middle fifth is the centre.
    return { x: Math.round(x * layout.width), width: Math.round(layout.width), u: Math.round(x * 1000) / 1000, side: x < 0.4 ? "left" : x > 0.6 ? "right" : "center" };
}
// who stays visible when the viewport or the skin's maxFigures cannot show the whole
// cast (gal-scene.js galFigureLayout). Deterministic for a page: the speaker, the close-up actor, the most recent
// other speakers, then stage order. Display only. Nothing persistent outranks recency: with two speakers
// alternating, each page shows the same pair (a gaze target ranked here swapped in on every other page).
function galFigurePriority(cast, first) {
    const out = [];
    for (const id of first.concat(cast)) if (id && cast.includes(id) && !out.includes(id)) out.push(id);
    return out;
}
// the skin's stage projection - where figures
// stand, how many are drawn, the framing, whether listeners dim, whether figures draw at all. The one reader for every
// display mode (skin, film, classic, phone): a display mode changes chrome, never who stands where. A skin that leaves
// maxFigures out draws at most 3, and so does a built-in theme with no pack
// skin document (classic and the other built-ins too).
function stageSkinFigures(skin) {
    return { slots: skin?.figureSlots, max: skin?.maxFigures ?? 3, framing: skin?.figures, dimListeners: skin?.dimListeners !== false, shown: skin?.figures?.mode !== "none" };
}
// Speakers before the page, most recent first: this turn's earlier pages, then the earlier turns' pages (newest first).
function galRecentSpeakers(pages, page, earlier, aliasOf, limit = 6) {
    const out = [];
    const scan = (list, from) => {
        for (let i = from; list && i >= 0 && out.length < limit; i--) {
            const alias = list[i]?.kind === "line" ? aliasOf(list[i]) : "";
            if (alias && !out.includes(alias)) out.push(alias);
        }
    };
    scan(pages, page - 1);
    for (const list of earlier) scan(list, list ? list.length - 1 : -1);
    return out;
}
// whom a performance's speaker shot frames on
// this page and on which side. speakers: the on-stage speaker of every page from the shot's first page in this round to
// this one ('' for narration or a speaker not on stage, which keeps the shot). alternate: the first subject stands left, a
// new subject takes the other side, the same one keeps it; anchor: the side of the subject's ordinary stage slot (slotOf).
// Only the names in page order decide, so history, skip and refresh frame the same page the same way. Nobody yet: null.
function galShotSubject(speakers, rule, slotOf) {
    let alias = "", side = "";
    for (const id of speakers) {
        if (!id || id === alias) continue;
        side = rule === "anchor" ? (slotOf(id) > 0.5 ? "right" : "left") : !alias ? "left" : side === "left" ? "right" : "left";
        alias = id;
    }
    return alias ? { alias, side } : null;
}
// The shot's framing for a side: the declared side, else the other side mirrored (x, roll); roll omitted = 0.
function galShotSide(shot, side) {
    const other = side === "left" ? "right" : "left", own = shot.head[side], mirror = shot.head[other];
    const roll = shot.roll?.[side] ?? (shot.roll?.[other] !== undefined ? -shot.roll[other] : 0);
    return { head: own || [1 - mirror[0], mirror[1], mirror[2]], roll };
}
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { galIsSuperseded, galPlain, galBlocks, galParagraphs, galPages, galQuoted, galGaze, galSpeakerAnchor, galFigurePriority, stageSkinFigures, galRecentSpeakers, galShotSubject, galShotSide };
