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
// in record.secret, a v2 change or report row carries secret) is left out everywhere on it.
const checkShown = (record, rows) => rows.filter(row => !row.secret && !(record.secret && record.secret.includes(row.resource)));
// One previewed value of a choice: 「2：代价成功（素质保证·主动-1）」; an option reads by its label 「计入：成功」. When every
// value of the choice leads to the same outcome (bare) the outcome says nothing about the value and is left out:
// 「本刻之星：获得 3 次嘉奖（嘉奖+3）」, not 「…：三重升华（嘉奖+3）」 on every button.
// Likewise a change every value brings (common: the same label and amount on each) is told once for the choice
// (checkPreviewCommon), and each value names only what sets it apart.
const checkChangeKey = c => c.label + "|" + (c.add !== undefined ? "+" + c.add : "=" + JSON.stringify(c.to));
const checkChangeShort = c => c.label + (c.add !== undefined ? checkSigned(c.add) : " " + c.to);
const checkPreviewNote = (row, record, common = []) => checkShown(record, row.changes).filter(c => !common.some(d => checkChangeKey(d) === checkChangeKey(c))).map(checkChangeShort).join("，");
function checkPreviewCommon(choice, record) {
    const rows = choice.preview || [];
    if (rows.length < 2) return [];
    return checkShown(record, rows[0].changes).filter(c => rows.every(row => checkShown(record, row.changes).some(d => checkChangeKey(d) === checkChangeKey(c))));
}
const checkCommonText = common => "每一项都会：" + common.map(checkChangeShort).join("，");
function checkPreviewText(row, record, label = row.value, bare = false, common = []) {
    const note = checkPreviewNote(row, record, common);
    return label + (bare ? "" : "：" + (row.outcome || "")) + (note ? "（" + note + "）" : "");
}
const checkPreviewBare = choice => Boolean(choice.preview) && choice.preview.length > 1 && choice.preview.every(row => row.outcome === choice.preview[0].outcome);
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
        const common = checkPreviewCommon(choice, record);
        return (common.length ? checkCommonText(common) + "　" : "") + choice.preview.map(row => checkPreviewText(row, record, row.value, checkPreviewBare(choice), common)).join("　");
    }
    if (choice.kind === "int") return choice.min + "～" + choice.max + "（默认 " + choice.default + "）";
    if (choice.preview) {
        const common = checkPreviewCommon(choice, record);
        return (common.length ? checkCommonText(common) + "　" : "") + (checkButtonValues(choice, record) || []).map(row => row.text).join("　");
    }
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
// A die's state on the record (faces.<group>.flags): a die that does not count is dimmed, one the player's choice
// turned shows its face after the change with a turned mark; one the rules struck out (cancelled) keeps its mark, dimmed.
const checkDieState = props => (props.marked ? " is-marked" : "") + (props.flag && !checkDieCounts(props) ? " is-dropped" : "") + (props.flag === "changed" ? " is-changed" : "") + (props.flag === "cancelled" ? " is-cancelled" : "");
function CheckDie(props) {
    const h = React.createElement, face = props.flag === "changed" && props.after !== undefined ? props.after : props.face, marked = props.marked;
    // A d8 is the outline of an octahedron seen from above with its top face up, the result on that face.
    if (props.sides === 8) return h("svg", { className: "fork-check-d8" + checkDieState(props), viewBox: "0 0 100 100", "aria-hidden": "true",
            style: marked && props.color ? { "--fork-check-mark": props.color } : undefined },
        h("polygon", { className: "fork-check-d8-body", points: "50,2 92,26 92,74 50,98 8,74 8,26" }),
        h("polygon", { className: "fork-check-d8-face", points: "50,14 86,76 14,76" }),
        h("text", { x: 50, y: 58, fontSize: 32, className: "fork-check-d8-top" }, String(face)),
        props.flag === "cancelled" ? h("line", { className: "fork-check-strike", x1: 10, y1: 90, x2: 90, y2: 10 }) : null);
    if (props.sides !== 4) return h("span", { className: "fork-check-die" + checkDieState(props), style: marked && props.color ? { "--fork-check-mark": props.color } : undefined }, String(face));
    const [left, right] = checkOtherFaces(face, 4, props.index);
    // Sizes are viewBox units (the die scales as a whole), not CSS type.
    const corner = (n, x, turn) => h("text", { x, y: 80, fontSize: 18, transform: "rotate(" + turn + " " + x + " 75)", className: "fork-check-d4-corner" }, String(n));
    return h("svg", { className: "fork-check-d4" + checkDieState(props), viewBox: "0 0 100 88", "aria-hidden": "true",
            style: marked && props.color ? { "--fork-check-mark": props.color } : undefined },
        h("polygon", { className: "fork-check-d4-face", points: "50,2 98,86 2,86" }),
        marked ? h("polygon", { className: "fork-check-d4-band", points: "50,2 87.7,68 12.3,68" }) : null,
        marked ? h("polygon", { className: "fork-check-d4-window", points: "50,18 73,58 27,58" }) : null,
        h("text", { x: 50, y: marked ? 54 : 52, fontSize: marked ? 30 : 34, className: "fork-check-d4-top" }, String(face)),
        corner(left, 24, 120), corner(right, 76, -120),
        props.flag === "cancelled" ? h("line", { className: "fork-check-strike", x1: 8, y1: 84, x2: 92, y2: 6 }) : null);
}
// The record's dice in roll order: [{ face, sides, color (the rules' markColor or null), marked, group, look, order,
// flag (kept / dropped / changed / cancelled, when the rules read the group), after (a changed die's face) }] (also the stage's).
function checkDiceFaces(record) {
    const dice = [];
    for (const [name, list] of Object.entries(record.dice || {})) {
        const meta = record.faces && record.faces[name] || {};
        // A dice expression with dice of different sides lists each die's sides.
        list.forEach((face, i) => {
            const shown = meta.after ? meta.after[i] : face;
            dice.push({ face, sides: Array.isArray(meta.sides) ? meta.sides[i] : meta.sides, color: meta.markColor || null, marks: meta.mark || [], marked: Array.isArray(meta.mark) && meta.mark.includes(shown),
                group: name, look: meta.look || "main", order: meta.order || 1, ...(meta.flags ? { flag: meta.flags[i] } : {}), ...(meta.after ? { after: meta.after[i] } : {}) });
        });
    }
    return dice;
}
function CheckDice(props) {
    const h = React.createElement, record = props.record, dice = checkDiceFaces(record);
    const rows = dice.map((die, i) => h(CheckDie, Object.assign({ key: i, index: i }, die)));
    if (!rows.length) return null;
    return h("div", { className: "fork-check-dice", role: "img", "aria-label": "骰面 " + dice.map(die => die.flag === "changed" ? die.face + "→" + die.after : String(die.face)).join(" ") }, rows);
}
// A dice expression's line: 「1d6 + 4d100 + 3 = 215」.
function checkRollText(record) {
    return Object.values(record.faces || {}).filter(meta => meta.roll).map(meta => meta.roll + " = " + meta.total).join(" · ");
}
// A condition the manager judges from the player's answer (a choice by gm): told, not a button.
const checkPlayerChoices = record => record.choices.filter(choice => choice.by !== "gm");
function CheckConditions(props) {
    const h = React.createElement;
    return props.record.choices.filter(choice => choice.by === "gm").map(choice => h("div", { key: choice.id, className: "fork-check-choice" },
        h("span", { className: "fork-check-choice-label" }, choice.label), choice.hint ? h("div", { className: "fork-check-hint" }, choice.hint + "（由经理判断）") : null));
}

// The buttons of an awaiting record: each choice's values as buttons. A record with one single-value choice settles on the
// click; otherwise the clicks only mark and 「确认」 hands them all over. What is sent is one readable player line,
// 「【检定 #2 选择】调整后 3 的个数：2」, which the model settles with (the card's description tells it the format).
const CHECK_INT_BUTTONS_MAX = 12;
// Each button: { value, text, label, note (its outcome when the values differ in it, and what it changes), tone (the
// outcome it leads to, when previewed) }. A wide int (its preview keeps the value nearest the default for each outcome)
// is those values, the default first among equals.
function checkButtonValues(choice, record) {
    const rows = new Map((choice.preview || []).map(row => [row.value, row])), bare = checkPreviewBare(choice), common = checkPreviewCommon(choice, record);
    const button = (value, label) => {
        const row = rows.get(value);
        if (!row) return { value, text: label, label };
        const note = [bare ? "" : row.outcome || "", checkPreviewNote(row, record, common)].filter(Boolean).join(" · ");
        return { value, text: checkPreviewText(row, record, label, bare, common), label, note, ...(row.tone && !bare ? { tone: row.tone } : {}) };
    };
    if (choice.kind === "int") {
        if (choice.max - choice.min + 1 > CHECK_INT_BUTTONS_MAX) {
            if (!choice.preview) return null;
            const values = [...new Set([choice.default, ...choice.preview.map(row => row.value)])].sort((a, b) => a - b);
            return values.map(n => button(n, String(n)));
        }
        const values = [];
        for (let n = choice.min; n <= choice.max; n++) values.push(button(n, String(n)));
        return values;
    }
    if (choice.kind === "options") return Object.entries(choice.options).map(([id, label]) => button(id, label));
    if (choice.kind === "boolean") return [button(true, "是"), button(false, "否")];
    if (choice.kind === "set") return choice.options.map(option => button(option, option));
    return choice.options.map(option => ({ value: option, text: option, label: option }));
}
// The outcome the player's marks lead to, from the choices' previews (the last previewed choice that has one), or null.
function checkPickedNow(record, picked) {
    let now = null;
    if (picked) for (const choice of checkPlayerChoices(record)) {
        const row = (choice.preview || []).find(item => item.value === picked[choice.id]);
        if (row && row.outcome) now = { label: row.outcome, tone: row.tone, main: row.main };
    }
    return now;
}
// What confirming the marks does, for the ledger's confirm bar: 「嘉奖+3」「主动×2、专注」.
function checkPickedEffect(record, picked) {
    return checkPlayerChoices(record).map(choice => {
        const value = picked[choice.id];
        if (choice.kind === "pick") return [...new Set(value)].map(name => name + (value.filter(v => v === name).length > 1 ? "×" + value.filter(v => v === name).length : "")).join("、");
        const row = (choice.preview || []).find(item => item.value === value);
        return row ? checkPreviewNote(row, record, checkPreviewCommon(choice, record)) : "";
    }).filter(Boolean).join("，");
}
function checkAnswerText(record, picked) {
    const parts = checkPlayerChoices(record).map(choice => {
        const value = picked[choice.id];
        const shown = choice.kind === "pick" ? value.join("、") : choice.kind === "boolean" ? (value ? "是" : "否")
            : choice.kind === "options" ? choice.options[value] + (choice.options[value] === value ? "" : "（" + value + "）") : String(value);
        return choice.label + "：" + shown;
    });
    return "【检定 " + record.id + " 选择】" + parts.join("；");
}
function CheckButtons(props) {
    const h = React.createElement, record = props.record;
    const choices = checkPlayerChoices(record);
    const [picked, setPicked] = React.useState(() => Object.fromEntries(choices.map(choice => [choice.id, choice.kind === "pick" ? [] : choice.default])));
    const [state, setState] = React.useState({ sent: false, error: "" });
    // On the stage (props.foldable) the choices fold to one line so a long list need not cover the scene; the marks stay.
    const [folded, setFolded] = React.useState(false);
    // With a condition for the manager the player writes his answer to it, so the clicks only mark. The ledger look
    // (props.ledger) always marks first: its steppers and tiles show what a value does before the confirm bar sends it.
    const ledger = Boolean(props.ledger);
    const direct = !ledger && choices.length === 1 && choices[0].kind !== "pick" && choices.length === record.choices.length;
    const stop = event => event.stopPropagation();
    function send(values) {
        setState({ sent: true, error: "" });
        Promise.resolve(props.input.submit(checkAnswerText(record, values))).then(() => { if (props.onSend) props.onSend(values); }, function (error) { setState({ sent: false, error: String(error && error.message || error) }); });
    }
    // A pick may name a value more than once (the rules add it up once per naming): a click adds one, − takes one back.
    function choose(choice, value, less) {
        const list = picked[choice.id];
        const next = Object.assign({}, picked, { [choice.id]: choice.kind !== "pick" ? value : less ? list.filter((v, i) => i !== list.lastIndexOf(value)) : list.concat(value) });
        setPicked(next);
        if (props.onPick) props.onPick(next);
        if (direct) send(next);
    }
    const ready = choices.every(choice => choice.kind !== "pick" || picked[choice.id].length >= choice.min && picked[choice.id].length <= choice.max);
    const off = state.sent || props.disabled;
    // The ledger's int is a stepper: − the value (and what it does) +.
    const stepper = (choice, values) => {
        const at = values.findIndex(row => row.value === picked[choice.id]), row = values[at];
        return h("div", { className: "fork-check-stepper", role: "group", "aria-label": choice.label },
            h("button", { type: "button", disabled: off || at <= 0, "aria-label": choice.label + " 减一", onClick: () => choose(choice, values[at - 1].value) }, "−"),
            h("output", { className: "fork-check-step-value", "aria-live": "polite" }, String(picked[choice.id]), row && row.note ? h("small", null, row.note) : null),
            h("button", { type: "button", disabled: off || at < 0 || at >= values.length - 1, "aria-label": choice.label + " 加一", onClick: () => choose(choice, values[at + 1].value) }, "+"));
    };
    const effect = ledger ? checkPickedEffect(record, picked) : "";
    // On the result page (onSend) Esc still reaches the page, which folds it into the card.
    const keyStop = event => { if (!(props.onSend && event.key === "Escape")) event.stopPropagation(); };
    const className = "fork-check-choices" + (ledger ? " is-ledger" : "");
    if (props.foldable && folded) return h("div", { className: className + " is-folded", onClick: stop, onKeyDown: keyStop },
        h("button", { type: "button", className: "fork-check-unfold", "aria-expanded": false, onClick: () => setFolded(false) }, "等你选择 · 展开"));
    return h("div", { className, onClick: stop, onKeyDown: keyStop },
        props.foldable ? h("button", { type: "button", className: "fork-check-fold", "aria-expanded": true, onClick: () => setFolded(true) }, "收起") : null,
        h(CheckConditions, { record }),
        choices.map(choice => {
            const values = checkButtonValues(choice, record), common = checkPreviewCommon(choice, record);
            return h("div", { key: choice.id, className: "fork-check-choice" },
                h("span", { className: "fork-check-choice-label" }, choice.label),
                choice.hint ? h("div", { className: "fork-check-hint" }, choice.hint) : null,
                common.length && values ? h("div", { className: "fork-check-hint fork-check-common" }, checkCommonText(common)) : null,
                ledger && choice.kind === "int" && values ? stepper(choice, values) :
                values ? h("div", { className: "fork-check-buttons", role: "group", "aria-label": choice.label },
                    values.map(row => {
                        if (choice.kind === "pick") {
                            const count = picked[choice.id].filter(v => v === row.value).length, full = picked[choice.id].length >= choice.max;
                            return h("span", { key: String(row.value), className: "fork-check-pick" + (count ? " is-on" : "") },
                                h("button", { type: "button", className: "fork-check-button" + (count ? " is-on" : ""), disabled: off || full, onClick: () => choose(choice, row.value) },
                                    row.text, count ? h("b", { className: "fork-check-pick-count" }, "×" + count) : null),
                                count ? h("button", { type: "button", className: "fork-check-pick-less", disabled: off, "aria-label": "少选一个" + row.text, onClick: () => choose(choice, row.value, true) }, "−") : null);
                        }
                        const on = picked[choice.id] === row.value;
                        return h("button", { key: String(row.value), type: "button", className: "fork-check-button" + (on ? " is-on" : ""), "aria-pressed": on, disabled: off, "data-tone": row.tone,
                            onClick: () => choose(choice, row.value) }, ledger ? [row.label, row.note ? h("small", { key: "n" }, row.note) : null] : row.text);
                    })) : checkChoiceText(choice, record));
        }),
        // What a click does, said where it is done: the answer goes out as the player's next message.
        direct ? h("div", { className: "fork-check-hint fork-check-how" }, "点一项就作为你的回答发出") : null,
        direct || !choices.length ? null : h("button", { type: "button", className: "fork-check-confirm", disabled: off || !ready, onClick: () => send(picked) },
            ledger ? [h("b", { key: "c" }, "确认发送"), effect ? h("span", { key: "e", className: "fork-check-confirm-effect" }, effect) : null] : "确认并发送"),
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
        if (props.look && props.look.result && props.look.result.card === "ledger") return h(CheckNoteLedger, props);
        const note = checkNoteText(record);
        return note ? h("div", { className: "fork-check-note", "data-call": record.callId }, h(Icon, { name: "die", size: 14 }), h("span", null, note)) : null;
    }
    return h(CheckCard, props);
}
function CheckCard(props) {
    const h = React.createElement, record = props.record;
    const [open, setOpen] = React.useState(false);
    // The player's marks on the buttons, so the ledger's outcome follows them before the confirm.
    const [picked, setPicked] = React.useState(null);
    const detailsId = React.useId();
    const awaiting = record.status === "awaiting";
    // While its stage performance plays (show.js) the card waits hidden in place.
    const performing = useCheckPerforming(record.callId);
    const head = record.title && record.title !== record.label ? record.title + " · " + record.label : record.label || "调整";
    // An outcome the rules stage (show) is named in the mark colour; one fixed as the dice land is named while it awaits.
    // A hidden roll (the rules' hidden) shows neither its dice nor what came of them; the model reads them as usual.
    const hidden = record.hidden === true;
    const tail = hidden ? "暗骰" : awaiting ? (record.show ? record.show.label + " · " : "") + "等你选择" : record.outcome ? record.outcome.label : record.status === "adjusted" ? "资源调整" : "";
    const mark = record.show ? checkDiceFaces(record).find(die => die.color)?.color : null;
    // The main number (report main) is told large at the head of the report, its target beside it.
    const headline = hidden ? null : checkHeadline(record);
    // The skin's ledger look (the dsh.dice option result.card) for a record with dice the player may see.
    // A record without dice (a settlement) is the same form: its report rows are the row's cells.
    const ledger = props.look && props.look.result && props.look.result.card === "ledger" && (record.dice || record.report) && !hidden ? props.look : null;
    const now = ledger ? (awaiting ? checkPickedNow(record, picked) || checkOutcomeNow(record) : record.outcome) : null, tone = ledger ? (now && CHECK_TONES.includes(now.tone) ? now.tone : null) : checkToneOf(record);
    const report = record.report && !hidden ? checkShown(record, Object.values(record.report)).filter(row => !row.main).map(row => row.label + " " + checkValueText(row.value)).join(" · ") : "";
    const changes = hidden ? [] : checkShown(record, record.changes || []);
    const headProps = { type: "button", "aria-expanded": open, "aria-controls": open ? detailsId : undefined,
        onKeyDown: function (event) { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); },
        onClick: function (event) { event.stopPropagation(); setOpen(!open); } };
    return h("div", { className: "fork-roll fork-check" + (ledger ? " is-ledger" : "") + (awaiting ? " is-awaiting" : "") + (performing ? " is-throwing" : ""), "data-call": record.callId, "data-outcome": record.outcome ? record.outcome.id : undefined,
            "data-tone": hidden ? undefined : tone || undefined, "data-show": record.show ? record.show.effect : undefined, style: Object.assign(mark ? { "--fork-check-mark": mark } : {}, ledger ? checkToneStyle(ledger) : {}) },
        ledger ? h(CheckLedger, { record, look: ledger, now, headline, headProps, title: (record.id ? record.id + " " : "") + head + " · " + tail }) : [
            h("button", Object.assign({ key: "head", className: "fork-roll-head" }, headProps),
                h(Icon, { name: "die", size: 16 }),
                h("span", { className: "fork-roll-line" }, (record.id ? record.id + " " : "") + head + " · ", h("span", { className: "fork-roll-tier" }, tail))),
            hidden ? null : h(CheckDice, { key: "dice", record })],
        !hidden && checkRollText(record) ? h("div", { className: "fork-check-line" }, checkRollText(record)) : null,
        headline && !ledger ? h("div", { className: "fork-check-line fork-check-headline" }, headline.label + " ", h("b", null, String(headline.value)), headline.target ? "　" + checkTargetText(headline.target) : null) : null,
        report && !(ledger && !record.dice) ? h("div", { className: "fork-check-line" }, report) : null,
        changes.length ? h("div", { className: "fork-check-line" }, changes.map(checkChangeText).join("，")) : null,
        awaiting && props.answerable ? h(CheckButtons, { record, input: props.input, ledger: Boolean(props.look && props.look.result && props.look.result.card === "ledger"), onPick: setPicked, foldable: props.onStage }) : null,
        awaiting && !props.answerable ? h("div", { className: "fork-check-choices" },
            h(CheckConditions, { record }),
            checkPlayerChoices(record).map(choice => h("div", { key: choice.id, className: "fork-check-choice" },
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
    // The skin's look of the record cards (the stage passes its session; a chat floor keeps the plain card).
    const options = useModOptions(props.sessionId, "dsh.dice", { enabled: Boolean(props.sessionId) && records.length > 0 });
    if (!records.length) return null;
    const look = options && options.values || null;
    return React.createElement("div", { className: "fork-roll-list fork-check-list", role: "group", "aria-label": "规则检定" },
        records.map(record => React.createElement(CheckRecord, { key: record.callId, record, look, onStage: Boolean(props.sessionId), input: props.input, answerable: answerable && record === records[records.length - 1] })));
}

// The skin's tone colours (the dsh.dice option tones) over the stage's, as on the throw's band.
const checkToneStyle = look => Object.fromEntries(CHECK_TONES.filter(tone => look.tones && look.tones[tone]).map(tone => ["--gal-check-tone-" + tone, look.tones[tone]]));
// The ledger card (the dsh.dice option result.card: "ledger"): a head of cells - the tags (a skin may colour one, result.tagColors),
// the title, the record id - that opens the details, and one row read as a sum: the dice that do not count, the dice that
// counted as rolled, each step the rules took after (the main report line's steps: 「− 燃尽 1」), the main number and the outcome.
// A die the player's choice turned stands at its rolled face with its turned outline: the steps carry the change.
function checkLedgerDice(record) {
    const hit = [], miss = [];
    checkDiceFaces(record).forEach((die, index) => {
        const asRolled = die.flag ? die.flag === "kept" || die.flag === "cancelled" || (die.flag === "changed" && die.marks.includes(die.face)) : die.marked;
        (asRolled ? hit : miss).push(Object.assign({}, die, { index, after: undefined, marked: die.marks.includes(die.face) }));
    });
    return { hit, miss };
}
function CheckLedger(props) {
    const h = React.createElement, record = props.record, result = props.look.result, headline = props.headline;
    const verdict = h("div", { key: "verdict", className: "fork-check-ledger-verdict" }, props.now ? props.now.label : "等你选择",
        record.status === "awaiting" ? h("span", { className: "fork-check-ledger-pending" }, "待定") : null);
    const head = h(props.headProps ? "button" : "div", Object.assign({ key: "head", className: "fork-check-ledger-head", title: props.title }, props.headProps),
        (record.tags || []).map(tag => h("span", { key: tag, className: "fork-check-ledger-tag", style: (result.tagColors || {})[tag] ? { "--check-tag": result.tagColors[tag] } : undefined }, tag)),
        h("span", { className: "fork-check-ledger-title" }, record.title || record.label),
        record.id ? h("span", { className: "fork-check-ledger-id" }, record.id) : null);
    // Without dice the row is the report: each row a cell, its value large, its label small.
    if (!record.dice) {
        const rows = checkShown(record, Object.values(record.report || {}));
        return [head, h("div", { key: "row", className: "fork-check-ledger-row is-report", role: "img", "aria-label": rows.map(row => row.label + " " + checkValueText(row.value)).join("；") + (props.now ? "；" + props.now.label : "") },
            rows.map((row, i) => h("div", { key: i, className: "fork-check-ledger-cell" + (typeof row.value === "boolean" ? " is-" + row.value : "") }, h("b", null, checkValueText(row.value)), h("small", null, row.label))),
            props.now ? verdict : null)];
    }
    const { hit, miss } = checkLedgerDice(record);
    const main = checkMainRow(record), steps = main && Array.isArray(main.steps) && main.steps.length > 1 ? main.steps.slice(1) : [];
    const die = die => h(CheckDie, Object.assign({ key: die.index }, die));
    return [
        // On the result page the head only names the check (props.headProps null): no details to open there.
        head,
        h("div", { key: "row", className: "fork-check-ledger-row", role: "img", "aria-label": checkLedgerText(record, headline, steps, props.now) },
            h("div", { className: "fork-check-ledger-miss" }, miss.map(die)),
            h("div", { className: "fork-check-ledger-hit" }, hit.length ? hit.map(die) : h("svg", { className: "fork-check-ledger-none", viewBox: "0 0 100 88", "aria-hidden": "true" }, h("polygon", { points: "50,4 96,84 4,84" }))),
            steps.map((step, i) => h("div", { key: i, className: "fork-check-ledger-step" }, h("b", null, (step.value < 0 ? "−" : "+") + Math.abs(step.value)), h("small", null, step.label))),
            headline ? h("div", { className: "fork-check-ledger-sum" }, h("b", null, String(props.now && typeof props.now.main === "number" ? props.now.main : headline.value)), headline.target ? h("small", null, checkTargetText(headline.target)) : null) : null,
            verdict)];

}
// A ruling without dice in the ledger look (a settlement once chosen): the same form - a head of tags, title and id -
// over one cell per change the player may see, the amount large and what it is small: 「+6 / 嘉奖」.
function CheckNoteLedger(props) {
    const h = React.createElement, record = props.record, colours = props.look.result.tagColors || {};
    const rows = checkShown(record, record.changes || []);
    if (!rows.length) return null;
    const cells = rows.map(row => typeof row.from === "number" && typeof row.to === "number"
        ? { value: checkSigned(row.to - row.from).replace("-", "−"), label: row.label, sign: Math.sign(row.to - row.from) }
        : { value: "from" in row && "to" in row ? checkValueText(row.to) : "to" in row ? "新增" : "删除", label: row.label + (row.key ? "·" + row.key : ""), sign: 0 });
    return h("div", { className: "fork-roll fork-check is-ledger is-note", "data-call": record.callId, style: checkToneStyle(props.look) },
        h("div", { className: "fork-check-ledger-head" },
            (record.tags || []).map(tag => h("span", { key: tag, className: "fork-check-ledger-tag", style: colours[tag] ? { "--check-tag": colours[tag] } : undefined }, tag)),
            h("span", { className: "fork-check-ledger-title" }, record.title || record.label || "结算"),
            record.id ? h("span", { className: "fork-check-ledger-id" }, record.id) : null),
        h("div", { className: "fork-check-ledger-changes", role: "img", "aria-label": checkNoteText(record) },
            cells.map((cell, i) => h("div", { key: i, className: "fork-check-ledger-change" + (cell.sign > 0 ? " is-up" : cell.sign < 0 ? " is-down" : "") },
                h("b", null, cell.value), h("small", null, cell.label)))));
}
// What the ledger row reads aloud: 「骰面 3 4 3 2 2 2；3 的个数 2 − 燃尽 1 = 1；成功」.
function checkLedgerText(record, headline, steps, now) {
    const dice = "骰面 " + checkDiceFaces(record).map(die => String(die.face)).join(" ");
    const sum = headline ? "；" + checkMainRow(record).label + " " + (steps.length ? checkMainRow(record).steps[0].value + steps.map(step => (step.value < 0 ? " − " : " + ") + step.label + " " + Math.abs(step.value)).join("") + " = " : "") + (now && typeof now.main === "number" ? now.main : headline.value) : "";
    return dice + sum + (now ? "；" + now.label : "") + (record.status === "awaiting" ? "（待定）" : "");
}
