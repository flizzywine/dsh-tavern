// the tavern_check records of a round (check-tool.js). As with tavern_roll the only record is the round's native tool
// result (its text block is the record JSON); nothing else is stored. A record reads 「<title> · <label> · <outcome>」 with
// its dice, the engine's report, what changed and the resources after it; an awaiting record lists the player's choices
// and what each value would do, for the player to answer in their next message. Shown on the round's chat floor and on
// the stage text box's top edge while that round's pages are up.

// One pass per chat snapshot: native turn -> { checks (JSON, call order), last (the turn's latest assistant step key) }; .latestTurn is the chat's newest round.
const checkIndexCache = new WeakMap();
function checkIndex(snapshot) {
    let index = checkIndexCache.get(snapshot);
    if (index) return index;
    index = new Map();
    const checks = new Map();
    let latestTurn = 0;
    for (const node of snapshot.nodes.values()) {
        const turn = Number(node.location && node.location.turn && node.location.turn.turn) || 0;
        if (!turn) continue;
        if (turn > latestTurn) latestTurn = turn;
        if (node.kind === "assistant-step") {
            const entry = index.get(turn);
            if (!entry || node.anchorSeq >= entry.seq) index.set(turn, { last: node.key, seq: node.anchorSeq, checks: "" });
            continue;
        }
        const root = node.kind === "tool-call" ? node.data.root : null;
        if (!root || root.kind !== "tool-result" || root.isError || !root.call || root.call.name !== "tavern_check") continue;
        const text = (root.content || []).find(block => block && block.type === "text");
        if (!text) continue;
        if (!checks.has(turn)) checks.set(turn, []);
        checks.get(turn).push([root.seq, root.callId, text.text]);
    }
    for (const [turn, list] of checks) {
        if (!index.has(turn)) index.set(turn, { last: null, seq: -1, checks: "" });
        index.get(turn).checks = JSON.stringify(list.sort((a, b) => a[0] - b[0]).map(row => [row[1], row[2]]));
    }
    index.latestTurn = latestTurn;
    checkIndexCache.set(snapshot, index);
    return index;
}

// Whether the player may answer this round's awaiting record by a button: it is the chat's newest round and nothing is being written.
function useCheckAnswerable(useChat, nativeTurn) {
    return useChat(function (snapshot) {
        if (!snapshot || !snapshot.nodes || !(nativeTurn > 0) || checkIndex(snapshot).latestTurn !== nativeTurn) return false;
        const legacy = snapshot.legacy;
        return !(legacy && (legacy.partial || legacy.runningCalls && legacy.runningCalls.length));
    });
}

function useChecks(useChat, nativeTurn, nodeKey) {
    const key = useChat(function (snapshot) {
        const entry = snapshot && snapshot.nodes && nativeTurn > 0 ? checkIndex(snapshot).get(nativeTurn) : null;
        return entry && (nodeKey === undefined || entry.last === nodeKey) ? entry.checks : "";
    });
    return React.useMemo(function () {
        const rows = [];
        for (const [callId, text] of key ? JSON.parse(key) : []) {
            try { const record = JSON.parse(text); if (record && record.status !== "sheet") rows.push(Object.assign({ callId }, record)); } catch (_) { /* not a record */ }
        }
        return rows;
    }, [key]);
}

const checkSigned = value => (value > 0 ? "+" : "") + value;
// What the player's card may show of a record: what the rules keep from the player (a v1 record lists its secret resources
// in record.secret, a v2 change row carries secret) is left out everywhere on it.
const checkShown = (record, rows) => rows.filter(row => !row.secret && !(record.secret && record.secret.includes(row.resource)));
// One previewed value of an int choice: 「2：代价成功（素质保证·主动-1）」.
function checkPreviewText(row, record) {
    const changes = checkShown(record, row.changes);
    return row.value + "：" + (row.outcome || "") + (changes.length ? "（" + changes.map(c => c.label + (c.add !== undefined ? checkSigned(c.add) : " " + c.to)).join("，") + "）" : "");
}
// A change row: 「欺瞒 3→2」; a new entry 「线索·管家 新增 2」, a removed one 「线索·管家 删除」.
function checkChangeText(row) {
    const label = row.label + (row.key ? "·" + row.key : "");
    if (!("from" in row)) return label + " 新增 " + checkValueText(row.to);
    if (!("to" in row)) return label + " 删除";
    return label + " " + checkValueText(row.from) + "→" + checkValueText(row.to);
}
// An entry with fields is one object: 「能力 8 · 季薪 30」.
const checkValueText = value => value === true ? "是" : value === false ? "否" : value === "" ? "（无）"
    : value && typeof value === "object" ? Object.entries(value).map(([field, item]) => field + " " + checkValueText(item)).join(" · ") : String(value);
// A ruling without dice shows as one small line of what the player may see changed: 「嘉奖 +1」「时间 -1，已标·职能 +1」.
function checkNoteText(record) {
    return checkShown(record, record.changes || []).map(row => typeof row.from === "number" && typeof row.to === "number"
        ? row.label + " " + checkSigned(row.to - row.from) : checkChangeText(row)).join("，");
}
// The resources after a record, from its labels: a keyed resource lists its non-zero entries.
function checkSheet(record) {
    const labels = record.labels || {}, parts = [];
    for (const [id, label] of Object.entries(labels)) {
        if (record.secret && record.secret.includes(id)) continue;
        const value = record.state && record.state.resources ? record.state.resources[id] : undefined;
        if (value === undefined) continue;
        if (value && typeof value === "object") {
            const entries = Object.entries(value).filter(([, n]) => n !== 0).map(([k, n]) => k + n);
            parts.push(label + " " + (entries.length ? entries.join(" ") : "0"));
        } else parts.push(label + " " + value);
    }
    return parts.join(" · ");
}
function checkChoiceText(choice, record) {
    if (choice.kind === "int" && choice.preview) {
        return choice.preview.map(row => checkPreviewText(row, record)).join("　");
    }
    if (choice.kind === "int") return choice.min + "～" + choice.max + "（默认 " + choice.default + "）";
    if (choice.kind === "options") return Object.values(choice.options).join(" / ");
    if (choice.kind === "pick") return "从 " + choice.options.join("、") + " 中选 " + (choice.min === choice.max ? choice.min : choice.min + "～" + choice.max) + " 个";
    if (choice.kind === "set") return choice.options.join(" / ");
    return "是 / 否";
}

// One die face. A d4 is drawn as the face it is read from: a triangle with the result at its top and the other two
// numbers of that face in its lower corners (as on the real tetrahedron); a face the rules mark (faces.mark, e.g.
// Triangle Agency's 3) gets the marked colouring, in the rules' markColor or the theme accent. Other dice are a plain tile. Decoration is aria-hidden; the row's
// aria-label carries the faces.
function checkOtherFaces(face, sides, index) {
    const rest = [];
    for (let n = 1; n <= sides; n++) if (n !== face) rest.push(n);
    return [rest[index % rest.length], rest[(index + 1) % rest.length]];
}
function CheckDie(props) {
    const h = React.createElement, face = props.face, marked = props.marked;
    if (props.sides !== 4) return h("span", { className: "fork-check-die" + (marked ? " is-marked" : ""), style: marked && props.color ? { "--fork-check-mark": props.color } : undefined }, String(face));
    const [left, right] = checkOtherFaces(face, 4, props.index);
    // Sizes are viewBox units (the die scales as a whole), not CSS type.
    const corner = (n, x, turn) => h("text", { x, y: 80, fontSize: 18, transform: "rotate(" + turn + " " + x + " 75)", className: "fork-check-d4-corner" }, String(n));
    return h("svg", { className: "fork-check-d4" + (marked ? " is-marked" : ""), viewBox: "0 0 100 88", "aria-hidden": "true",
            style: marked && props.color ? { "--fork-check-mark": props.color } : undefined },
        h("polygon", { className: "fork-check-d4-face", points: "50,2 98,86 2,86" }),
        marked ? h("polygon", { className: "fork-check-d4-band", points: "50,2 87.7,68 12.3,68" }) : null,
        marked ? h("polygon", { className: "fork-check-d4-window", points: "50,18 73,58 27,58" }) : null,
        h("text", { x: 50, y: marked ? 54 : 52, fontSize: marked ? 30 : 34, className: "fork-check-d4-top" }, String(face)),
        corner(left, 24, 120), corner(right, 76, -120));
}
// The record's dice in roll order: [{ face, sides, color (the rules' markColor or null), marked }] (also the stage
// performance's, show.js).
function checkDiceFaces(record) {
    const dice = [];
    for (const [name, list] of Object.entries(record.dice || {})) {
        const meta = record.faces && record.faces[name] || {};
        for (const face of list) dice.push({ face, sides: meta.sides, color: meta.markColor || null, marked: Array.isArray(meta.mark) && meta.mark.includes(face) });
    }
    return dice;
}
function CheckDice(props) {
    const h = React.createElement, record = props.record;
    const rows = checkDiceFaces(record).map((die, i) => h(CheckDie, Object.assign({ key: i, index: i }, die)));
    if (!rows.length) return null;
    return h("div", { className: "fork-check-dice", role: "img", "aria-label": "骰面 " + Object.values(record.dice).flat().join(" ") }, rows);
}

// The buttons of an awaiting record: each choice's values as buttons. A record with one single-value choice settles on the
// click; otherwise the clicks only mark and 「确认」 hands them all over. What is sent is one readable player line,
// 「【检定 #2 选择】调整后 3 的个数：2」, which the model settles with (the card's description tells it the format).
const CHECK_INT_BUTTONS_MAX = 12;
function checkButtonValues(choice, record) {
    if (choice.kind === "int") {
        if (choice.max - choice.min + 1 > CHECK_INT_BUTTONS_MAX) return null;
        const rows = choice.preview ? new Map(choice.preview.map(row => [row.value, row])) : new Map(), values = [];
        for (let n = choice.min; n <= choice.max; n++) {
            const row = rows.get(n);
            values.push({ value: n, text: row ? checkPreviewText(row, record) : String(n) });
        }
        return values;
    }
    if (choice.kind === "options") return Object.entries(choice.options).map(([id, label]) => ({ value: id, text: label }));
    if (choice.kind === "boolean") return [{ value: true, text: "是" }, { value: false, text: "否" }];
    return choice.options.map(option => ({ value: option, text: option }));
}
function checkAnswerText(record, picked) {
    const parts = record.choices.map(choice => {
        const value = picked[choice.id];
        const shown = choice.kind === "pick" ? value.join("、") : choice.kind === "boolean" ? (value ? "是" : "否")
            : choice.kind === "options" ? choice.options[value] + (choice.options[value] === value ? "" : "（" + value + "）") : String(value);
        return choice.label + "：" + shown;
    });
    return "【检定 " + record.id + " 选择】" + parts.join("；");
}
function CheckButtons(props) {
    const h = React.createElement, record = props.record;
    const [picked, setPicked] = React.useState(() => Object.fromEntries(record.choices.map(choice => [choice.id, choice.kind === "pick" ? [] : choice.default])));
    const [state, setState] = React.useState({ sent: false, error: "" });
    const direct = record.choices.length === 1 && record.choices[0].kind !== "pick";
    const stop = event => event.stopPropagation();
    function send(values) {
        setState({ sent: true, error: "" });
        Promise.resolve(props.input.submit(checkAnswerText(record, values))).catch(function (error) { setState({ sent: false, error: String(error && error.message || error) }); });
    }
    function choose(choice, value) {
        const next = Object.assign({}, picked, { [choice.id]: choice.kind === "pick"
            ? (picked[choice.id].includes(value) ? picked[choice.id].filter(v => v !== value) : picked[choice.id].concat(value)) : value });
        setPicked(next);
        if (direct) send(next);
    }
    const ready = record.choices.every(choice => choice.kind !== "pick" || picked[choice.id].length >= choice.min && picked[choice.id].length <= choice.max);
    return h("div", { className: "fork-check-choices", onClick: stop, onKeyDown: stop },
        record.choices.map(choice => {
            const values = checkButtonValues(choice, record);
            return h("div", { key: choice.id, className: "fork-check-choice" },
                h("span", { className: "fork-check-choice-label" }, choice.label),
                choice.hint ? h("div", { className: "fork-check-hint" }, choice.hint) : null,
                values ? h("div", { className: "fork-check-buttons", role: "group", "aria-label": choice.label },
                    values.map(row => {
                        const on = choice.kind === "pick" ? picked[choice.id].includes(row.value) : picked[choice.id] === row.value;
                        return h("button", { key: String(row.value), type: "button", className: "fork-check-button" + (on ? " is-on" : ""), "aria-pressed": on, disabled: state.sent,
                            onClick: () => choose(choice, row.value) }, row.text);
                    })) : checkChoiceText(choice, record));
        }),
        direct ? null : h("button", { type: "button", className: "fork-check-confirm", disabled: state.sent || !ready, onClick: () => send(picked) }, "确认选择"),
        state.error ? h("div", { className: "fork-check-hint", role: "alert" }, "⚠ " + state.error) : null);
}

// The records whose stage performance plays (show.js holds and releases them): their cards wait hidden in place.
const checkPerforming = (function () {
    let held = new Set();
    const listeners = new Set(), change = next => { held = next; listeners.forEach(fn => fn()); };
    return {
        get: () => held,
        hold(ids) { change(new Set([...held, ...ids])); },
        release(ids) { change(new Set([...held].filter(id => !ids.includes(id)))); },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
})();
function useCheckPerforming(callId) {
    return React.useSyncExternalStore(checkPerforming.subscribe, () => checkPerforming.get().has(callId), () => false);
}

function CheckRecord(props) {
    const h = React.createElement, record = props.record;
    if (record.action && record.status === "settled" && !record.dice) {
        const note = checkNoteText(record);
        return note ? h("div", { className: "fork-check-note", "data-call": record.callId }, h(Icon, { name: "die", size: 14 }), h("span", null, note)) : null;
    }
    return h(CheckCard, props);
}
function CheckCard(props) {
    const h = React.createElement, record = props.record;
    const [open, setOpen] = React.useState(false);
    const detailsId = React.useId();
    const awaiting = record.status === "awaiting";
    // While its stage performance plays (show.js) the card waits hidden in place.
    const performing = useCheckPerforming(record.callId);
    const head = record.title && record.title !== record.label ? record.title + " · " + record.label : record.label || "调整";
    // An outcome the rules stage (show) is named in the mark colour; one fixed as the dice land is named while it awaits.
    const tail = awaiting ? (record.show ? record.show.label + " · " : "") + "等你选择" : record.outcome ? record.outcome.label : record.status === "adjusted" ? "资源调整" : "";
    const mark = record.show ? checkDiceFaces(record).find(die => die.color)?.color : null;
    const report = record.report ? Object.values(record.report).map(row => row.label + " " + (row.value === true ? "是" : row.value)).join(" · ") : "";
    return h("div", { className: "fork-roll fork-check" + (awaiting ? " is-awaiting" : "") + (performing ? " is-throwing" : ""), "data-call": record.callId, "data-outcome": record.outcome ? record.outcome.id : undefined,
            "data-show": record.show ? record.show.effect : undefined, style: mark ? { "--fork-check-mark": mark } : undefined },
        h("button", { type: "button", className: "fork-roll-head", "aria-expanded": open, "aria-controls": open ? detailsId : undefined,
            onKeyDown: function (event) { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); },
            onClick: function (event) { event.stopPropagation(); setOpen(!open); } },
            h(Icon, { name: "die", size: 16 }),
            h("span", { className: "fork-roll-line" }, (record.id ? record.id + " " : "") + head + " · ", h("span", { className: "fork-roll-tier" }, tail))),
        h(CheckDice, { record }),
        report ? h("div", { className: "fork-check-line" }, report) : null,
        record.changes && checkShown(record, record.changes).length ? h("div", { className: "fork-check-line" }, checkShown(record, record.changes).map(checkChangeText).join("，")) : null,
        awaiting && props.answerable ? h(CheckButtons, { record, input: props.input }) : null,
        awaiting && !props.answerable ? h("div", { className: "fork-check-choices" },
            record.choices.map(choice => h("div", { key: choice.id, className: "fork-check-choice" },
                h("span", { className: "fork-check-choice-label" }, choice.label), " ", checkChoiceText(choice, record),
                choice.hint ? h("div", { className: "fork-check-hint" }, choice.hint) : null)),
            h("div", { className: "fork-check-hint" }, "在下一句里说出你的选择，例如「花 1 点，变成 2 个 3」；不说就按默认。")) : null,
        open ? h("dl", { id: detailsId, className: "fork-roll-details" },
            record.reason ? [h("dt", { key: "rt" }, "理由"), h("dd", { key: "rd" }, record.reason)] : null,
            record.stakes ? [h("dt", { key: "st" }, "成败"), h("dd", { key: "sd" }, record.stakes)] : null,
            record.state ? [h("dt", { key: "at" }, "资源"), h("dd", { key: "ad" }, checkSheet(record))] : null,
            record.seed !== undefined ? [h("dt", { key: "et" }, "种子"), h("dd", { key: "ed" }, String(record.seed))] : null) : null);
}

// props: { useChat, nativeTurn, nodeKey? (chat floor), pageKey? (the stage), input? ({submit(text)}, from the host) }. Nothing for a
// round without checks. The round's awaiting record gets its buttons only on the chat's newest round while nothing is being written.
function CheckRecords(props) {
    const records = useChecks(props.useChat, props.nativeTurn, props.nodeKey);
    const answerable = useCheckAnswerable(props.useChat, props.nativeTurn) && Boolean(props.input);
    if (!records.length) return null;
    return React.createElement("div", { className: "fork-roll-list fork-check-list", role: "group", "aria-label": "规则检定" },
        records.map(record => React.createElement(CheckRecord, { key: record.callId, record, input: props.input, answerable: answerable && record === records[records.length - 1] })));
}
