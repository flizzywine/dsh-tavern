// The story read aloud (tavernUi.readingUnits, apiVersion 9): what a story reply reads. Pure functions; story-reading.js
// speaks them. It is the stage's own reading of a reply (the one authority, owner 11-16): parseBubbles → galParagraphs. A
// narration paragraph is read in the reading voice; an @bubble line in its figure's voice; HTML blocks, rules and markup
// are not read. A narration paragraph longer than READING_LONG splits at the body's sentence ends
// (splitTavernProseSentences), so the first sound never waits for a whole long paragraph.
const READING_LONG = 120;
const readingSpoken = text => /[\p{L}\p{N}]/u.test(text);
// Sentences of one paragraph, joined back while a piece stays short (a few short sentences read as one).
function readingPieces(text) {
    const pieces = [];
    for (const sentence of splitTavernProseSentences(text)) {
        const last = pieces.length - 1;
        if (last >= 0 && pieces[last].length + sentence.length <= READING_LONG / 2) pieces[last] += sentence;
        else pieces.push(sentence);
    }
    return pieces;
}
// A story row (tavernStoryTranscriptRows) → its reading units, in order: {key, row, floor, n, para, kind, text, segment?}.
// `text` is what the page shows (a reader finds the unit on the page by it); `para` groups the pieces of one paragraph.
function readingRowUnits(row) {
    const segments = parseBubbles(row.text, false), units = [];
    galParagraphs([{segments}]).forEach(function (unit, para) {
        if (unit.kind === 'line') {
            if (readingSpoken(unit.text)) units.push({kind:'line', para, text:unit.text, segment:segments[unit.index]});
            return;
        }
        const text = unit.text.trim();
        for (const piece of text.length > READING_LONG ? readingPieces(text) : [text]) if (readingSpoken(piece)) units.push({kind:'narration', para, text:piece.trim()});
    });
    return units.map((unit, n) => ({...unit, key:JSON.stringify([row.key, n]), row:row.key, floor:row.floorNo, n}));
}
// Every finished reply of a story, in order (a reading stops at the end of the newest finished one).
function readingUnits(rows) {
    return rows.filter(row => row.role === 'assistant' && !row.streaming && row.text).flatMap(readingRowUnits);
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {READING_LONG, readingPieces, readingRowUnits, readingUnits};
