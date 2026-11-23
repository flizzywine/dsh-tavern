'use strict';
// Text marks: a mod command that marks words of its beat's paragraph for display (the manifest command's
// textMark {quote}, mods/declarations.js; the director's submit tool admits only words quoted verbatim from that paragraph,
// stage-asset-pack-validation.js). The story text itself stays as written - saved, sent to the model, edited as written;
// each view projects the marks over the words it shows. One authority for which marks a paragraph has, where they fall
// in the text a view shows, the text a voice reads without them and when a voice reading the whole line reaches them.
const stageTextMarks = (() => {
// direction: a director record view ({phase, through, entries: [{at, ops}]}); kinds: the declared text marks
// [{modId, command, quote}]. -> the paragraph's marks in record order, [{modId, commandId, params, quote, index, kind}];
// index counts the paragraph's marks (第几处), the identity a mark keeps across views.
function textMarksAt(direction, para, kinds) {
    if (!kinds?.length || !direction || !['partial', 'done'].includes(direction.phase) || !(para <= direction.through)) return [];
    const out = [];
    for (const entry of direction.entries || []) {
        if (entry.at !== para) continue;
        for (const op of entry.ops || []) {
            const kind = op.op === 'mod.command' && kinds.find(row => row.modId === op.modId && row.command === op.commandId);
            const quote = kind && op.params?.[kind.quote];
            if (typeof quote === 'string' && quote.length) out.push({modId: op.modId, commandId: op.commandId, params: op.params, quote, index: out.length, kind});
        }
    }
    return out;
}
// Where the marks fall in text: every occurrence of each quote, the earlier mark first where two overlap.
// -> [{start, end, mark}] in text order (UTF-16 offsets).
function textMarkRanges(text, marks) {
    const value = String(text || ''), out = [];
    for (const mark of marks || []) {
        if (!mark.quote) continue;
        for (let at = value.indexOf(mark.quote); at >= 0; at = value.indexOf(mark.quote, at + mark.quote.length)) {
            const end = at + mark.quote.length;
            if (!out.some(row => at < row.end && end > row.start)) out.push({start: at, end, mark});
        }
    }
    return out.sort((a, b) => a.start - b.start);
}
// Where a skin's highlight words (skin textStyle.highlight {ink, words: [{text, caseless?, whole?, except?}]}) fall in `text`:
// -> [{start, end}] in text order, none overlapping each other or `taken` (ranges already drawn by a mod). Display only - it
// never touches the text, and a voice, a copy or a save keeps the words as written. `whole` skips a match inside a longer number
// or word (13, 30, 3.5, threesome); `except` lists longer phrases whose occurrences keep the word plain (三角机构 for 三).
const HIGHLIGHT_ALNUM = /[0-9A-Za-z\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/, HIGHLIGHT_DIGIT = /[0-9\uFF10-\uFF19]/, HIGHLIGHT_POINT = /[.,\uFF0C\uFF0E]/;
function textHighlightRanges(text, highlight, taken = []) {
    const value = String(text || ''), out = [];
    if (!highlight?.words?.length || !value) return out;
    const folded = value.toLowerCase().length === value.length ? value.toLowerCase() : value;
    const find = (needle, caseless) => {
        const hay = caseless ? folded : value, key = caseless ? needle.toLowerCase() : needle, at = [];
        for (let i = hay.indexOf(key); i >= 0 && key; i = hay.indexOf(key, i + key.length)) at.push([i, i + key.length]);
        return at;
    };
    for (const word of highlight.words) {
        const except = (word.except || []).flatMap(phrase => find(phrase, word.caseless));
        for (const [start, end] of find(word.text, word.caseless)) {
            if (except.some(([from, to]) => from <= start && end <= to)) continue;
            if (word.whole) {
                const before = value[start - 1] || '', after = value[end] || '';
                if (HIGHLIGHT_ALNUM.test(before) || HIGHLIGHT_ALNUM.test(after)) continue;
                if (HIGHLIGHT_POINT.test(after) && HIGHLIGHT_DIGIT.test(value[end + 1] || '')) continue;
                if (HIGHLIGHT_POINT.test(before) && HIGHLIGHT_DIGIT.test(value[start - 2] || '')) continue;
            }
            if (!out.some(row => start < row.end && end > row.start) && !taken.some(row => start < row.end && end > row.start)) out.push({start, end});
        }
    }
    return out.sort((a, b) => a.start - b.start);
}
// The view's draw marks [{start, end, render}] with the skin's highlight words added: `taken` (a mod's marks) keep their words,
// the highlights only colour (no tap, no voice cover). h: the view's createElement.
function textMarksHighlighted(text, highlight, taken, h) {
    if (!highlight) return taken;
    const own = textHighlightRanges(text, highlight, taken).map(range => ({start: range.start, end: range.end,
        render: (words, key) => h('span', {key, className: 'fork-gal-hl', style: {color: highlight.ink}}, words)}));
    return own.length ? [...taken, ...own].sort((a, b) => a.start - b.start) : taken;
}// A paragraph laid out as several pages: the marks are found in the pages joined (a quote may run over a page break),
// then cut to page `index`. pages: the paragraph's page texts in order. -> ranges in that page's text; a range cut at a
// page edge keeps its mark and says which part it is ({head, tail}: it starts / ends on this page).
function textMarkPageRanges(pages, index, marks) {
    let base = 0;
    for (let i = 0; i < index; i++) base += String(pages[i] || '').length;
    const length = String(pages[index] || '').length, out = [];
    for (const row of textMarkRanges(pages.join(''), marks)) {
        const start = Math.max(row.start, base), end = Math.min(row.end, base + length);
        if (start < end) out.push({start: start - base, end: end - base, mark: row.mark, head: row.start >= base, tail: row.end <= base + length});
    }
    return out;
}
// Ranges moved into another text that shows `text` at `shift` (a quoted line, a subtitle card), cut to [shift, shift + length).
function textMarkShift(ranges, shift, length) {
    return ranges.flatMap(row => {
        const start = Math.max(0, row.start - shift), end = Math.min(length, row.end - shift);
        return start < end ? [{...row, start, end, head: row.head !== false && row.start - shift >= 0, tail: row.tail !== false && row.end - shift <= length}] : [];
    });
}
// [{text}] plain runs and [{text, range}] marked runs, in order.
function textMarkSegments(text, ranges) {
    const value = String(text || ''), out = [];
    let at = 0;
    for (const range of ranges || []) {
        if (range.start > at) out.push({text: value.slice(at, range.start)});
        out.push({text: value.slice(range.start, range.end), range});
        at = range.end;
    }
    if (at < value.length) out.push({text: value.slice(at)});
    return out;
}
// text[from, to) as plain strings and its marks drawn: marks [{start, end, render(text, key)}] in order (a mark cut by the
// range draws the part inside it).
function textMarkNodes(text, from, to, marks, key = 'm') {
    const value = String(text || '');
    if (!marks?.length) return [value.slice(from, to)];
    const out = [];
    let at = from;
    for (const [i, mark] of marks.entries()) {
        const start = Math.max(mark.start, from), end = Math.min(mark.end, to);
        if (start >= end || start < at) continue;
        if (start > at) out.push(value.slice(at, start));
        out.push(mark.render(value.slice(start, end), key + i));
        at = end;
    }
    if (at < to) out.push(value.slice(at, to));
    return out;
}
// How long a voice dwells on a character, in syllables: a CJK character (or kana, hangul) is one, a Latin letter about a
// third; a comma or colon is heard as a short pause, a full stop as a longer one.
function speakingWeight(c) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(c)) return 1;
    if (/[\p{L}\p{N}]/u.test(c)) return 0.35;
    if (/[。！？.!?…]/u.test(c)) return 2.5;
    if (/[，、；：,;:—]/u.test(c)) return 1.5;
    return /\s/u.test(c) ? 0.2 : 0.3;
}
// Where ranges of `text` are heard while a voice reads it whole, as shares of its length: [{...range, from, to}] (0..1),
// estimated from the speaking weight of the characters before and inside each range (no word timings needed).
function textMarkTimes(text, ranges) {
    const value = String(text || ''), sums = [0];
    for (let i = 0; i < value.length; i++) sums.push(sums[i] + speakingWeight(value[i]));
    const total = sums[value.length] || 1;
    return (ranges || []).map(range => ({...range, from: sums[range.start] / total, to: sums[range.end] / total}));
}
// A voice that reads `text` whole over the words a view covers. cover: {text: the words the view shows, ranges: the marks
// there (textMarkPageRanges), place: where their taps are kept}. -> {maskedText: what a voice no mixer reaches (browser
// speech) reads instead, masks(): read as the line starts, the spans still shut {spans: [[from, to]], noise: the first
// mark's cover sound} or null}; false when the voice reads other words (a translation): it cannot be covered.
function textMarkVoice(text, cover) {
    const value = String(text || '');
    const found = value === cover.text ? cover.ranges : textMarkRanges(value, [...new Set(cover.ranges.map(row => row.mark))]);
    if (!found.length) return false;
    const times = textMarkTimes(value, found);
    return {maskedText: textMarkSegments(value, found).filter(row => !row.range).map(row => row.text).join(''),
        masks: () => {
            const shut = times.filter(row => !row.mark.kind.open?.(cover.place, row.mark.index));
            return shut.length ? {spans: shut.map(row => [row.from, row.to]), noise: shut[0].mark.kind.noise} : null;
        }};
}
return {textMarksAt, textMarkRanges, textHighlightRanges, textMarksHighlighted, textMarkPageRanges, textMarkShift, textMarkSegments, textMarkNodes, textMarkTimes, textMarkVoice};
})();
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = stageTextMarks;
