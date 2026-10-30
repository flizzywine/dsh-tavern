// the one pool of waiting lines, shared by the stage's two waits — the
// end panel while its choices generate (gal-choices.js) and the text box while the next body is written
// (gal-stage.js). Nods to works about world lines, time loops, branches, observation and parallel worlds.
// Keep each one short enough for one line of the choice
// pill on a 375 px phone (at most 14 characters). No trailing 「……」: the six animated dots that follow
// every line are its ellipsis. These are the engine's default lines; a stage skin replaces them with its waitLines (1-64
// lines, stage-skin.cjs), passed as props.lines.
const STAGE_WAIT_LINES = [
    "世界线收束中", "正在发送 D-Mail", "收集光玉中", "正在寻找这个世界的秘密", "观测「不连续存在」中",
    "模拟宇宙载入中", "神圣时间线校准中", "正在更新未来日记", "正在运营平行世界", "正在闭合时间的圆环",
    "正在遍历世界线", "观测下一个分歧点", "正在推演每一条分支", "正在折叠时间线", "正在打开薛定谔的盒子",
    "量子叠加态坍缩中", "多元宇宙分支展开中", "世界线变动率测定中", "正在拼合世界的碎片", "正在平行世界间转移",
    "平行宇宙坐标校准中", "命运的道路正在分岔", "因果律网络重构中",
];
// Each line holds STAGE_WAIT_LINE_MS in one of four stacked slots (theme.css: a 9.6 s cycle written for four).
const STAGE_WAIT_LINE_MS = 2400;
const STAGE_WAIT_LINE_SLOTS = 4;
const STAGE_WAIT_DOTS = 6;
// One wait: where in the pool it starts (random-ish, so each wait opens on a different line) and when it began.
// The same key keeps the same wait, so a remount resumes the cycle where it was.
function stageWaitLinesEpisode(previous, key, count = STAGE_WAIT_LINES.length) {
    if (previous && previous.key === key) return previous;
    return { key, first: Math.floor(Math.random() * count), start: Date.now() };
}
// Pool line shown by a slot at `elapsed` ms into the wait. Slot `i` shows the wait's turns i, i + 4, i + 8 …; it takes
// its next line half a turn after its fade-out ends, while it is hidden, so no visible line ever changes its text.
function stageWaitLineAt(lines, first, slot, elapsed) {
    const turn = STAGE_WAIT_LINE_MS, cycle = turn * STAGE_WAIT_LINE_SLOTS;
    const round = Math.max(0, Math.floor((elapsed - turn / 2 - (slot + 1) * turn) / cycle) + 1);
    return lines[(first + slot + round * STAGE_WAIT_LINE_SLOTS) % lines.length];
}
// The four stacked slots plus the whole pool, hidden in the same cell, so the slot is as wide as the widest line and the
// pill never resizes when a slot takes a new line. props: { first, start } from stageWaitLinesEpisode, lines (the skin's
// waitLines; the default lines without one).
// Only the first slot is read out (the others are aria-hidden); without motion it is the one shown, steady.
// Each line ends in the six breathing dots, right after its last character like an ellipsis; a sizer reserves the
// same width with a still spacer (no hidden animations). props.text instead: one fixed line (e.g. the settlement wait).
function StageWaitLines(props) {
    const h = React.createElement;
    const fixed = typeof props.text === "string";
    const pool = props.lines || STAGE_WAIT_LINES, first = props.first || 0, start = props.start || Date.now();
    // The cycle offset is read once per mount, so re-renders never shift the running fades.
    const clockRef = React.useRef(null);
    if (clockRef.current === null) clockRef.current = (Date.now() - start) % (STAGE_WAIT_LINE_MS * STAGE_WAIT_LINE_SLOTS);
    const [, setTick] = React.useState(0);
    React.useEffect(function () {
        if (fixed || typeof setInterval !== "function") return undefined; // a renderer without timers keeps the first lines
        const timer = setInterval(() => setTick(tick => tick + 1), STAGE_WAIT_LINE_MS);
        return () => clearInterval(timer);
    }, [fixed]);
    const elapsed = Date.now() - start;
    const dots = [];
    for (let i = 0; i < STAGE_WAIT_DOTS; i++) dots.push(h("i", { key: i }));
    if (fixed) return h("span", { className: "stage-wait-lines is-fixed" }, h("span", { className: "stage-wait-line" }, props.text, h("span", { className: "stage-wait-dots", "aria-hidden": true }, dots)));
    const lines = [];
    for (let i = 0; i < STAGE_WAIT_LINE_SLOTS; i++) lines.push(h("span", { key: i, className: "stage-wait-line", "aria-hidden": i ? true : undefined,
        style: { animationDelay: (i * STAGE_WAIT_LINE_MS - clockRef.current) + "ms" } }, stageWaitLineAt(pool, first, i, elapsed),
        h("span", { className: "stage-wait-dots", "aria-hidden": true }, dots)));
    // The sizers come last: the first slot stays :first-child, the one shown without motion.
    return h("span", { className: "stage-wait-lines" }, ...lines,
        ...pool.map((line, i) => h("span", { key: "size:" + i, className: "stage-wait-sizer", "aria-hidden": true }, line, h("span", { className: "stage-wait-dots-space" }))));
}
// a wait the player can stop. The wait itself is the control (R13,
// one place): pointer hover or keyboard focus shows 「停止」 in the wait's own slot; a click, Enter / Space or Esc stops.
// On touch the first tap shows 「停止」 and only a second tap stops, so a stray tap never throws a reply away.
// props: { label (what is waiting, read out), onStop, busy (stopping), className }; children = the wait (lines + dots).
// One look for every wait (theme.css "stage wait"): UI type, the accent dots and a thin accent rule on each side.
function StageWaitStop(props) {
    const h = React.createElement;
    const [armed, setArmed] = React.useState(false);
    const pointer = React.useRef("");
    React.useEffect(function () {
        if (!armed || typeof setTimeout !== "function") return undefined;
        const timer = setTimeout(() => setArmed(false), 4000);
        return () => clearTimeout(timer);
    }, [armed]);
    const busy = Boolean(props.busy);
    function stop() { setArmed(false); if (!busy) props.onStop(); }
    return h("button", { type: "button", className: "stage-wait" + (props.className ? " " + props.className : ""), "data-armed": armed ? "" : undefined, "data-busy": busy ? "" : undefined,
        "aria-busy": busy || undefined, "aria-label": busy ? "正在停止" : (props.label ? props.label + "，" : "") + "停止生成", title: "停止",
        onPointerDown: event => { pointer.current = event.pointerType || ""; },
        onClick: event => {
            event.stopPropagation();
            const touch = pointer.current === "touch";
            pointer.current = "";
            if (touch && !armed && !busy) { setArmed(true); return; }
            stop();
        },
        // Esc on the focused wait stops it; the stage's own Esc (its menu) sees the event as taken.
        onKeyDown: event => { if (event.key === "Escape" && !event.repeat) { event.preventDefault(); event.stopPropagation(); stop(); } },
        onBlur: () => setArmed(false) },
        h("span", { className: "stage-wait-body" }, props.children),
        h("span", { className: "stage-wait-stop", "aria-hidden": true }, busy ? "正在停止" : "停止"));
}
