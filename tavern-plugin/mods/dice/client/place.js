// When a record shows on the stage: where its call stands in the reply's text. A call the body model makes partway through
// its reply records `at` (check-tool.js), the stage paragraphs written before it; its result is met where the text goes on,
// on the first page of paragraph at + 1. The stage reports where the reader stands (props.place {turn, para, first, end,
// start, units, streaming, running}: controller.cjs; para the page's paragraph, first its first page, end the complete
// round's last page, start the round's first page, units its paragraphs so far). A record of round `turn` is
//   "now"  - the reader has come to its place (the complete round's last page counts: nothing followed the call); or it
//            has no place: a call before any text (no at), or no stage position (a lease reads) - it shows as it arrives;
//   "wait" - its place is further on, or the reader is elsewhere while a reply is being written.
function dicePlaceState(record, place, turn) {
    if (!record.at || !place) return "now";
    if (place.turn === turn) return place.para > record.at || place.end ? "now" : "wait";
    return place.running || place.streaming ? "wait" : "now";
}
// Whether the record has a place in the text of the round the reader is on (one the reader may not have come to yet).
const dicePlaced = (record, place, turn) => Boolean(record.at && place && place.turn === turn);
// The overlays' dependency on the reader's place: what dicePlaceState reads.
const dicePlaceKey = place => place ? JSON.stringify([place.turn, place.para, place.first, place.end, place.start, place.units, place.streaming, place.running]) : "";

// The live records an overlay holds until they are due: those of round `turn` that arrive while a reply runs (add) wait
// until dicePlaceState says now (take). One per overlay and session; the first snapshot a stage sees is history and adds
// none. recordOf(item): the record of a queued item.
function dicePlaceQueue(recordOf = item => item) {
    let items = [];
    return {
        add(list, turn) { items = items.concat(list.map(value => ({ value, turn }))); },
        take(place) {
            const due = items.filter(item => dicePlaceState(recordOf(item.value), place, item.turn) === "now");
            items = items.filter(item => !due.includes(item));
            return due.map(item => item.value);
        }
    };
}
// A round's rolls that replay where the settled history page (or a clip export's replay) stands: a placed one on the first
// page of its paragraph (on the last page when no paragraph followed its call), the others on the round's first page.
const diceReplayHere = (records, place, turn) => records.filter(record => dicePlaced(record, place, turn)
    ? place.first && place.para === record.at + 1 || place.end && place.units <= record.at : !place || place.start);
