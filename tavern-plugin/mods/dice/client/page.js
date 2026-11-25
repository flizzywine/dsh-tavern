// A ruling the card's own page performs (the rules' actions[].page, rules-engine.js; the record carries page): on the
// stage the page plays it in place of the record's card - a sheet's boxes being marked and struck, not a table of changes.
// The stage plays the page (the overlay prop cardPage.perform, status-panel.cjs Performance); this part says when and
// with what: the records of the latest round that arrive live while the reply runs, each when the reader comes to its
// place in the text (place.js), as a check's show. Records due together are one performance, in order (two points of
// time spent in one breath play as two steps of one scene). The cue: {action, steps: [{params, changes}]} - each change
// a row the player may see ({path, label, from?, to?}, secret ones left out).
//
// Once only: a record that was already there when the stage mounted (reload, history) or that arrives while nothing
// plays live does not perform, and its card stays away on the stage too (the page itself shows where things stand).
// A performance the stage cannot give (no such page, the page failed to read) gives the record's card back
// (checkPageFallback in check.js).
function checkPageCue(records) {
    const first = records[0];
    return { action: first.action, label: first.label, steps: records.map(record => ({ params: record.params || {},
        changes: checkShown(record, record.changes || []).map(row => Object.assign({ path: row.path, label: row.label }, "from" in row ? { from: row.from } : {}, "to" in row ? { to: row.to } : {})) })) };
}
// Due records in arrival order, cut into runs of the same page and action (one cue each).
function checkPageRuns(records) {
    const runs = [];
    for (const record of records) {
        const last = runs[runs.length - 1];
        if (last && last[0].page === record.page && last[0].action === record.action) last.push(record); else runs.push([record]);
    }
    return runs;
}
// A record without a place (called before any text) waits for the reader to come to its round (its first page), not
// the moment it arrives, and for its first words (units): a page performing over the 'writing' wait would be over
// before the story says what it is.
const checkPageState = (record, place, turn) => !record.at && place && (place.turn !== turn || !(place.units > 0)) ? "wait" : dicePlaceState(record, place, turn);
function checkPageQueue() {
    let items = [];
    return {
        add(list, turn) { items = items.concat(list.map(value => ({ value, turn }))); },
        take(place) {
            const due = items.filter(item => checkPageState(item.value, place, item.turn) === "now");
            items = items.filter(item => !due.includes(item));
            return due.map(item => item.value);
        }
    };
}
function CheckPagePerform(props) {
    const seen = React.useRef(null), latest = React.useRef(props), chain = React.useRef(Promise.resolve());
    latest.current = props;
    const key = props.useChat(showLatestKey);
    const placeKey = dicePlaceKey(props.place);
    React.useLayoutEffect(() => {
        if (!seen.current || seen.current.session !== props.sessionId) seen.current = { session: props.sessionId, ids: null, queue: checkPageQueue() };
        if (!key) return;
        const records = showKeyRecords(key), s = seen.current;
        const fresh = s.ids ? records.filter(record => !s.ids.has(record.callId)) : [];
        // The first snapshot this stage sees is history: nothing in it performs.
        if (!s.ids) s.ids = new Set();
        for (const record of records) s.ids.add(record.callId);
        const now = latest.current, arrived = fresh.filter(checkPaged);
        if (arrived.length && now.running) s.queue.add(arrived, Number(key.slice(0, key.indexOf("|"))));
        const due = s.queue.take(now.place);
        if (!due.length || !now.live) return;
        const stage = now.cardPage;
        if (!stage) { checkPageFallback.add(due.map(record => record.callId)); return; }
        for (const run of checkPageRuns(due)) {
            const ids = run.map(record => record.callId);
            checkPerforming.hold(ids);
            chain.current = chain.current.then(() => stage.perform(run[0].page, checkPageCue(run)).catch(error => {
                console.warn("卡页面演出没能播放：" + (error && error.message || error));
                checkPageFallback.add(ids);
            }).then(() => checkPerforming.release(ids)));
        }
    }, [key, props.sessionId, placeKey]);
    return null;
}
