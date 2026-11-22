// What the stage makes of a rule check record (check-tool.js, the rules' semantics in README.md): the dice with their
// states (kept, dropped, changed by the player's choice), the main number against its target, the outcome and how good
// it is (tone), and the result page that asks the player's choices (④ in the check design). One reading, shared by the
// stage's timeline (check-throw.js), the result page here and the record card on the text box (check.js).
//
// The timeline reports every beat as an effect point (checkCues): the built-in pictures follow the same beats, and a
// skin's cues (the dsh.dice option cues) hang effects on them. Points, in order:
//   declare  the line over the dice shows                    {record}
//   throw    a group of dice leaves the hand                 {record, order, dice}
//   land     a die comes to rest                             {record, index, die, at: [x, y] on the band}
//   rest     every die rests                                 {record}
//   count    a die that counts is counted (n so far)         {record, index, die, n}
//   drop     a die that does not count is set aside          {record, index, die}
//   headline the main number shows                           {record, headline}
//   tier     the outcome (or the outcome so far) shows       {record, outcome, tone}
//   ask      the result page opens                           {record}
//   choose   the player picked on the result page            {record, choice}
//   resolve  the outcome is final                            {record, outcome, tone}
//   change   one change the record made is listed            {record, change}
//   file     the check goes into its card on the text box    {record}
// Every detail carries the record; a listener reads what it needs. Only live records reach the timeline (no reload, no
// history), so a cue never fires twice for one record.
const CHECK_POINTS = Object.freeze(["declare", "throw", "land", "rest", "count", "drop", "headline", "tier", "ask", "choose", "resolve", "change", "file"]);
const checkCues = (function () {
    const listeners = new Set();
    return {
        on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        // One listener's failure does not stop the check or the other listeners. A listener may return promises (or a list
        // of them) the timeline waits for before its next beat (a held cue); emit returns them.
        emit(point, detail) {
            const holds = [];
            for (const fn of [...listeners]) { try { const out = fn(point, detail); if (out) holds.push(...(Array.isArray(out) ? out : [out])); } catch (error) { console.error("[fork-check-cue]", point, error); } }
            return holds.filter(item => item && typeof item.then === "function");
        }
    };
})();

// The tones (outcomes[].tone, rules-engine.js TONES) as the player reads them; their colours are the stage tokens
// --gal-check-tone-<tone> (themes.css), a skin's tones option overrides them.
const CHECK_TONES = Object.freeze(["great", "good", "mixed", "bad", "terrible"]);
const checkOutcomeOf = record => record.outcome || record.decided || null;
// Whether a die counts (checkDiceFaces): as its group's read says (kept; a die turned by the player's choice counts
// when its new face is one the rules mark), else - no read - when its face is marked.
const checkDieCounts = die => die.flag ? die.flag === "kept" || (die.flag === "changed" && die.marked) : die.marked;
const checkToneOf = record => { const tone = checkOutcomeOf(record)?.tone; return CHECK_TONES.includes(tone) ? tone : null; };
// The main number (report row with main: true) and its target, or null.
// While choices are open the main line is pending: its value is the one the defaults give (the default's preview main).
function checkHeadline(record) {
    const row = Object.values(record.report || {}).find(item => item && item.main && !item.secret);
    if (!row) return null;
    const value = row.pending ? checkDefaultPreview(record)?.main : row.value;
    return value === undefined ? null : { label: row.label + checkStepsText(row.steps), value, target: row.target || null };
}
// How the main number came about (report steps), before its value: 「 2 − 倦怠 1 =」 (the first step is the dice as read).
function checkStepsText(steps) {
    if (!Array.isArray(steps) || steps.length < 2) return "";
    return " " + steps[0].value + steps.slice(1).map(step => (step.value < 0 ? " − " : " + ") + step.label + " " + Math.abs(step.value)).join("") + " =";
}
function checkDefaultPreview(record) {
    for (const choice of checkOpenChoices(record)) {
        const row = (choice.preview || []).find(item => item.value === choice.default);
        if (row) return row;
    }
    return null;
}
const CHECK_NEEDS = { ">=": "≥", ">": "＞", "<=": "≤", "<": "＜", "==": "＝" };
// 「需 ≥ 难度 15」
const checkTargetText = target => "需 " + (CHECK_NEEDS[target.need] || target.need) + " " + target.label + " " + target.value;
// The player's choices of an awaiting record (a condition the manager judges, by gm, is not a button).
const checkOpenChoices = record => record.status === "awaiting" ? (record.choices || []).filter(choice => choice.by !== "gm") : [];
// The outcome a choice leaves as it stands (its default's preview), for the result page's 「现在」.
function checkOutcomeNow(record) {
    if (record.decided) return record.decided;
    const row = checkDefaultPreview(record);
    return row && row.outcome ? { label: row.outcome, tone: row.tone } : null;
}

// The result page: the check's head and tags, its dice with their states, the main number and its target, the outcome
// as it stands, and the choices as buttons (CheckButtons, check.js: what each does, its cost and outcome). It stays until
// the player picks (onSend) or folds it into the card on the text box (Esc: the card keeps the same buttons). Skipping
// the animation never skips it. props: { record, input, answerable, onSend(values), onFold(), style }.
function CheckResultPage(props) {
    const h = React.createElement, record = props.record, box = React.useRef(null);
    const headline = record.hidden ? null : checkHeadline(record), now = record.hidden ? null : checkOutcomeNow(record), tone = now && CHECK_TONES.includes(now.tone) ? now.tone : null;
    React.useEffect(() => { box.current?.focus({ preventScroll: true }); }, []);
    const onKeyDown = event => {
        if (event.key === "Escape") { event.preventDefault(); props.onFold(); }
        event.stopPropagation();
    };
    const head = record.title && record.title !== record.label ? record.title + " · " + record.label : record.label || "检定";
    return h("section", { ref: box, className: "fork-check-page", role: "dialog", "aria-label": head, tabIndex: -1, style: props.style, "data-call": record.callId,
            "data-tone": tone || undefined, onKeyDown, onClick: event => event.stopPropagation(), onPointerDown: event => event.stopPropagation() },
        h("div", { className: "fork-check-page-head" },
            h("span", { className: "fork-check-page-title" }, head),
            (record.tags || []).map(tag => h("span", { key: tag, className: "fork-check-page-tag" }, tag))),
        h("div", { className: "fork-check-page-read" },
            record.hidden ? null : h(CheckDice, { record }),
            headline ? h("div", { className: "fork-check-page-headline" },
                h("span", { className: "fork-check-page-label" }, headline.label),
                h("span", { className: "fork-check-page-number" }, String(headline.value)),
                headline.target ? h("span", { className: "fork-check-page-target" }, checkTargetText(headline.target)) : null) : null,
            now ? h("div", { className: "fork-check-page-now" }, h("span", { className: "fork-check-page-label" }, "现在"), h("span", { className: "fork-check-page-tier" }, now.label)) : null),
        checkRollText(record) ? h("div", { className: "fork-check-line" }, checkRollText(record)) : null,
        h(CheckButtons, { record, input: props.input, disabled: !props.answerable, onSend: props.onSend }),
        props.answerable ? null : h("div", { className: "fork-check-hint" }, "叙述写完后就能选。"));
}

// The skin's cues (the dsh.dice option cues, in order; toneSounds is their shorthand: a sound at resolve per tone): at
// an effect point, every cue whose conditions all hold plays. Conditions only match what the rules already said -
// action, outcome, tone, look (the die's set of dice), mark (a marked face), state (kept / dropped / changed), choice
// (an answer, "id" or "id:value") - never a formula; a finer condition is one more outcome or mark in the rules.
// What a cue plays is a kind in CHECK_CUE_PLAYS: a new kind of effect is one entry there and one in mod.json's cue
// schema. A play may return a promise when the cue holds (hold: true): the timeline waits for it.
const CHECK_CUE_KEYS = Object.freeze(["action", "outcome", "tone", "look", "mark", "state", "choice"]);
function checkCueMatches(cue, point, detail) {
    if (cue.at !== point) return false;
    const record = detail.record, outcome = detail.outcome || checkOutcomeOf(record), die = detail.die;
    const facts = { action: record.action || record.check, outcome: outcome && outcome.id, tone: detail.tone !== undefined ? detail.tone : checkToneOf(record),
        look: die && die.look, mark: die ? Boolean(die.marked) : undefined, state: die && die.flag };
    return CHECK_CUE_KEYS.every(key => {
        if (cue[key] === undefined) return true;
        if (key === "choice") return Object.entries(detail.choice || {}).some(([id, value]) => cue.choice === id || cue.choice === id + ":" + value);
        return facts[key] === cue[key];
    });
}
const CHECK_CUE_PLAYS = Object.freeze({
    // A core stage effect by its director name (stage-effects.cjs): the stage's own safety policy applies.
    effect: (cue, ctx) => { ctx.screen?.(cue.effect); },
    // A skin sound asset on the stage's sound-effect bus.
    sound: (cue, ctx) => { const url = ctx.media[cue.sound]; if (url) void Promise.resolve(stageSfx.play(url, "skin:" + cue.sound, undefined, "check-cue:" + ctx.detail.record.callId, 1, { trace: { reason: "dice:cue" } })); },
    // A built-in show (show.js CHECK_SHOWS) over the record, named by the outcome's label.
    show: (cue, ctx) => { const outcome = ctx.detail.outcome || checkOutcomeOf(ctx.detail.record); return checkShowStage.play(ctx.detail.record, cue.show, outcome ? outcome.label : "", ctx.calm); }
});
const checkSkinCues = values => [...(values.cues || []), ...Object.entries(values.toneSounds || {}).filter(([, key]) => key).map(([tone, sound]) => ({ at: "resolve", tone, sound }))];
// Play the skin's cues at one point: { holds: [promise] } for the cues that hold the timeline.
function checkPlayCues(mod, point, detail, stage) {
    const values = mod && mod.values || {}, holds = [];
    for (const cue of checkSkinCues(values)) {
        if (!checkCueMatches(cue, point, detail)) continue;
        for (const kind of Object.keys(CHECK_CUE_PLAYS)) {
            if (cue[kind] === undefined) continue;
            const result = CHECK_CUE_PLAYS[kind](cue, { media: mod.media || {}, detail, screen: stage.screen, calm: stage.calm });
            if (cue.hold && result && typeof result.then === "function") holds.push(result);
        }
    }
    return holds;
}