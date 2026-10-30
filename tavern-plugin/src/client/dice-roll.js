// the tavern_roll results
// of a round. The only record is the round's native tool/result (its text block is the result JSON); nothing is stored.
// Every place reads one short line 「<check>检定 · <roll> · <tier>」: never the attempt, the difficulty or
// the target. The chat floor shows the round's rolls above its story text. On the stage the strip is a one-shot (owner
// 2026-10-20): only a roll arriving live (or in a clip export's replay of its round, dice-throw.js) shows, on the
// page it lands on, and fades out for good when the reader moves on; history, reload and skip never bring it back. The
// stage's record is the round's 履历 line (diceBacklogEntries). A hidden roll stays covered until the player peeks
// (local UI state only) and never reaches the 履历.

const DICE_TIER = { critical: "大成功", success: "成功", costly: "代价成功", failure: "失败", fumble: "大失败" };
// The line's words; a roll stored before tavern_roll had `check` reads 「检定 · …」.
const diceCheckName = roll => (roll.check || "") + "检定";
const diceTierWord = roll => DICE_TIER[roll.tier] || roll.tier;
function diceText(roll) { return diceCheckName(roll) + " · " + roll.roll + " · " + diceTierWord(roll); }
// The same line as elements: the tier in its tier colour (data-tier on an ancestor).
function diceLine(h, roll) {
    return [h("span", { key: "name", className: "fork-roll-name" }, diceCheckName(roll)), " · ",
        h("span", { key: "value", className: "fork-roll-value" }, String(roll.roll)), " · ",
        h("span", { key: "tier", className: "fork-roll-tier" }, diceTierWord(roll))];
}

// One pass per chat snapshot (the node store is shared and mutable; the snapshot object is new on each change):
// native turn -> { rolls (JSON key, call order), last (the turn's latest assistant step key) }.
const diceIndexCache = new WeakMap();
function diceIndex(snapshot) {
    let index = diceIndexCache.get(snapshot);
    if (index) return index;
    index = new Map();
    const lastSeq = new Map(), rolls = new Map();
    for (const node of snapshot.nodes.values()) {
        const turn = Number(node.location && node.location.turn && node.location.turn.turn) || 0;
        if (!turn) continue;
        if (node.kind === "assistant-step") {
            if (!lastSeq.has(turn) || node.anchorSeq >= lastSeq.get(turn)) { lastSeq.set(turn, node.anchorSeq); index.set(turn, { last: node.key, rolls: "" }); }
            continue;
        }
        const root = node.kind === "tool-call" ? node.data.root : null;
        if (!root || root.kind !== "tool-result" || root.isError || !root.call || root.call.name !== "tavern_roll") continue;
        const text = (root.content || []).find(block => block && block.type === "text");
        if (!text) continue;
        if (!rolls.has(turn)) rolls.set(turn, []);
        rolls.get(turn).push([root.seq, root.callId, text.text]);
    }
    for (const [turn, list] of rolls) {
        if (!index.has(turn)) index.set(turn, { last: null, rolls: "" });
        index.get(turn).rolls = JSON.stringify(list.sort((a, b) => a[0] - b[0]).map(row => [row[1], row[2]]));
    }
    diceIndexCache.set(snapshot, index);
    return index;
}

// nodeKey: a chat floor shows the round's rolls only in the turn's latest assistant step (the one that closes it, or
// the one streaming now), so a multi-step round shows them once. The stage passes no key.
function useDiceRolls(useChat, nativeTurn, nodeKey) {
    const key = useChat(function (snapshot) {
        const entry = snapshot && snapshot.nodes && nativeTurn > 0 ? diceIndex(snapshot).get(nativeTurn) : null;
        return entry && (nodeKey === undefined || entry.last === nodeKey) ? entry.rolls : "";
    });
    return React.useMemo(function () {
        return key ? JSON.parse(key).map(function (row) { return Object.assign({ callId: row[0] }, JSON.parse(row[1])); }) : [];
    }, [key]);
}

function DiceRoll(props) {
    const h = React.createElement, roll = props.roll;
    const [peeked, setPeeked] = React.useState(false), [open, setOpen] = React.useState(false);
    const covered = roll.hidden && !peeked;
    // While its 3D throw plays (dice-throw.js) the card waits hidden in place, then fades in.
    const throwing = useDiceThrowing(roll.callId);
    const detailsId = React.useId();
    // One button in both states, so focus stays on it when a peek uncovers the card.
    return h("div", { className: "fork-roll" + (covered ? " is-covered" : "") + (throwing ? " is-throwing" : "") + (props.leaving ? " is-leaving" : ""), "data-call": roll.callId, "data-tier": covered ? undefined : roll.tier },
        h("button", { type: "button", className: "fork-roll-head", title: covered ? "偷看暗骰" : undefined, tabIndex: props.leaving ? -1 : undefined,
            "aria-label": covered ? "暗骰，点按偷看" : (roll.hidden ? "暗骰 " : "") + diceText(roll),
            "aria-expanded": covered ? undefined : open, "aria-controls": covered || !open ? undefined : detailsId,
            // The stage turns pages on Enter / Space and on clicks; this control keeps its own.
            onKeyDown: function (event) { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); },
            onClick: function (event) { event.stopPropagation(); if (covered) setPeeked(true); else setOpen(!open); } },
            h(Icon, { name: covered ? "die-covered" : "die", size: 16 }),
            roll.hidden ? h("span", { className: "fork-roll-tag" }, "暗骰") : null,
            covered ? null : h("span", { className: "fork-roll-line" }, diceLine(h, roll))),
        !covered && open ? h("dl", { id: detailsId, className: "fork-roll-details" },
            h("dt", null, "理由"), h("dd", null, roll.reason),
            h("dt", null, "成败"), h("dd", null, roll.stakes)) : null);
}

// The stage strip's one-shot state: callId -> { page: the stage page key it shows on (null until a text page is up),
// leaving: fading out }. DiceThrow (the one judge of a live arrival) adds a roll; the strip pins it to the page it
// first shows on, and drops it for good once the reader is on another page (after the fade). Replaced on each change.
const DICE_STRIP_FADE_MS = 320;
const diceStrip = (function () {
    let rolls = new Map();
    const listeners = new Set();
    function set(next) { rolls = next; listeners.forEach(fn => fn()); }
    function edit(ids, fn) { const next = new Map(rolls); ids.forEach(id => fn(next, id)); set(next); }
    return {
        get: () => rolls,
        arrive(ids) { edit(ids, (next, id) => next.set(id, { page: null, leaving: false })); },
        pin(ids, page) { edit(ids, (next, id) => next.set(id, { page, leaving: false })); },
        leave(ids) {
            const marks = new Map(ids.map(id => [id, rolls.get(id)]));
            edit(ids, (next, id) => next.set(id, Object.assign({}, rolls.get(id), { leaving: true })));
            // A replay may bring the same roll again meanwhile; only the mark that is fading is dropped.
            setTimeout(() => edit(ids.filter(id => rolls.get(id)?.leaving && rolls.get(id).page === marks.get(id).page), (next, id) => next.delete(id)), DICE_STRIP_FADE_MS);
        },
        reset() { if (rolls.size) set(new Map()); },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
})();

// props: { useChat (host chat selector hook), nativeTurn, nodeKey? (chat floor), pageKey? (the stage: the page shown) }.
// Renders nothing for a round without rolls (on the stage: without a roll of this visit).
function DiceRolls(props) {
    const rolls = useDiceRolls(props.useChat, props.nativeTurn, props.nodeKey);
    const stage = props.pageKey !== undefined;
    const strip = React.useSyncExternalStore(diceStrip.subscribe, diceStrip.get, diceStrip.get);
    const shown = stage ? rolls.filter(roll => strip.has(roll.callId)) : rolls;
    React.useEffect(function () {
        if (!stage) return;
        const pin = shown.filter(roll => strip.get(roll.callId).page === null).map(roll => roll.callId), leave = [];
        // Any page change ends a shown strip, whichever round it belongs to.
        for (const [id, mark] of strip) if (mark.page !== null && mark.page !== props.pageKey && !mark.leaving) leave.push(id);
        if (pin.length) diceStrip.pin(pin, props.pageKey);
        if (leave.length) diceStrip.leave(leave);
    });
    // The text box gives way to the reply wait (the next round is sent): the shown strips are done.
    React.useEffect(() => stage ? function () {
        const done = [...diceStrip.get()].filter(([, mark]) => mark.page !== null && !mark.leaving).map(([id]) => id);
        if (done.length) diceStrip.leave(done);
    } : undefined, [stage]);
    if (!shown.length) return null;
    return React.createElement("div", { className: "fork-roll-list", role: "group", "aria-label": "检定" },
        shown.map(function (roll) { return React.createElement(DiceRoll, { key: roll.callId, roll: roll, leaving: stage && strip.get(roll.callId).leaving }); }));
}

// 履历: every round's open rolls by native turn (hidden rolls never reach it), from the same per-snapshot index.
function diceBacklogKey(snapshot) {
    if (!snapshot || !snapshot.nodes) return "";
    const out = [];
    for (const [turn, entry] of diceIndex(snapshot)) if (entry.rolls) out.push([turn, entry.rolls]);
    return out.length ? JSON.stringify(out) : "";
}
function useDiceBacklog(useChat) {
    const key = useChat ? useChat(diceBacklogKey) : "";
    return React.useMemo(function () {
        const byTurn = new Map();
        for (const [turn, rolls] of key ? JSON.parse(key) : []) {
            const open = JSON.parse(rolls).map(row => Object.assign({ callId: row[0] }, JSON.parse(row[1]))).filter(roll => !roll.hidden);
            if (open.length) byTurn.set(turn, open);
        }
        return byTurn;
    }, [key]);
}
// A round's checks lead its text in the 履历, as in the chat floor: after the round's separator and the player's input.
// nativeTurnOf(storyTurn) maps a row's turn to the rolls' native turn; rowOf(roll, storyTurn) is the 履历's performance row
// (gal-backlog.js backlogPerformanceEntry, kind core.dice.roll).
function diceBacklogEntries(entries, rolls, nativeTurnOf, rowOf) {
    if (!rolls.size) return entries;
    const out = [];
    for (let i = 0; i < entries.length; i++) {
        const row = entries[i];
        out.push(row);
        const list = row.type === "turn" ? rolls.get(nativeTurnOf(row.turn)) : null;
        if (!list) continue;
        if (entries[i + 1] && entries[i + 1].type === "input" && entries[i + 1].turn === row.turn) out.push(entries[++i]);
        for (const roll of list) out.push(rowOf(roll, row.turn));
    }
    return out;
}
