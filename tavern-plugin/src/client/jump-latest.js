// 回到最新 — the one jump-to-latest control.
// Shown only while the reader is scrolled away from the newest content; a click (or Enter / Space) glides back to
// the end. The chat page (in place of the host's always-on 回到底部) and the stage backlog both use it, each in
// its own paint (`skin`). Pure helpers are tested in tests/fork-jump-latest.test.mjs.

// How far from the end (px) still counts as "at the latest" (host chat uses 25; rows settle by a few px).
const JUMP_LATEST_SLACK = 32;
function jumpLatestAway(box, slack) {
    if (!box) return false;
    const floor = Math.max(0, box.scrollHeight - box.clientHeight);
    return floor - box.scrollTop > (slack == null ? JUMP_LATEST_SLACK : slack);
}
// Glide to the end. Content that grows during the glide (rows measured late, a streaming reply) is chased: when
// the glide settles short of the end, one more instant step lands on it. done() runs once at the end.
function jumpLatestScroll(box, done) {
    if (!box) return;
    let finished = false, timer = 0;
    const settle = function () {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        box.removeEventListener("scrollend", settle);
        if (jumpLatestAway(box, 2)) box.scrollTop = box.scrollHeight;
        if (done) done();
    };
    if (typeof box.scrollTo === "function") box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
    else box.scrollTop = box.scrollHeight;
    box.addEventListener("scrollend", settle);
    // No scrollend (already at the end, older engines): settle after the glide's usual length.
    timer = setTimeout(settle, 900);
}
// box: the scrolling element (or null while unknown). Returns { away, jump }. While a jump glides the control stays
// hidden; growth of the box's children re-evaluates `away` without a scroll event.
function useJumpLatest(box, options) {
    const slack = options && options.slack;
    const [away, setAway] = React.useState(false);
    const jumping = React.useRef(false);
    React.useEffect(function () {
        if (!box) { setAway(false); return undefined; }
        let frame = 0;
        const check = function () {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(function () { if (!jumping.current) setAway(jumpLatestAway(box, slack)); });
        };
        check();
        box.addEventListener("scroll", check, { passive: true });
        const observer = typeof ResizeObserver === "function" ? new ResizeObserver(check) : null;
        if (observer) { observer.observe(box); Array.from(box.children).forEach(child => observer.observe(child)); }
        return function () { cancelAnimationFrame(frame); box.removeEventListener("scroll", check); if (observer) observer.disconnect(); };
    }, [box, slack]);
    const jump = React.useCallback(function (after) {
        if (!box) return;
        jumping.current = true;
        setAway(false);
        jumpLatestScroll(box, function () { jumping.current = false; setAway(jumpLatestAway(box, slack)); if (after) after(); });
    }, [box, slack]);
    return { away, jump };
}
// props: { away, onJump(event), skin: "chat" | "stage", label?, className? }. Always mounted so it can animate in; while
// hidden it is visibility:hidden (out of the tab order and the accessibility tree). A keyboard press hands focus to
// props.focusAfter() (the list / the composer) once the control hides.
function JumpLatest(props) {
    const h = React.createElement;
    const label = props.label || "回到最新";
    return h("button", { type: "button", className: "fork-jump-latest is-" + (props.skin || "chat") + (props.className ? " " + props.className : ""),
        "data-shown": props.away ? "true" : undefined, "aria-hidden": props.away ? undefined : "true", tabIndex: props.away ? undefined : -1,
        title: label, "aria-label": label,
        onClick: function (event) {
            event.stopPropagation();
            const keyboard = event.detail === 0;
            props.onJump(keyboard && props.focusAfter ? props.focusAfter : undefined);
        } },
        h("svg", { viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false" },
            h("path", { d: "M7 7.5l5 5 5-5M7 17.5h10" })));
}
