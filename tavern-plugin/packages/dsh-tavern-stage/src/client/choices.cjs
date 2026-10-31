function createStageChoices({React:react,ReactDOM,window,document,layout,sounds:forkUiSfx,useSounds:useForkUiSfxControls,episode:stageWaitLinesEpisode,waitLines:STAGE_WAIT_LINES,TextArea,Icon,StageWaitStop,StageWaitLines,getComputedStyle,ResizeObserver,setTimeout:hostSetTimeout,clearTimeout:hostClearTimeout,requestAnimationFrame:hostRequestFrame,cancelAnimationFrame:hostCancelFrame}) {
let disposed=false;
const cleanups=new Set(),timers=new Map(),frames=new Map();
function own(cleanup){let active=true;const release=()=>{if(!active)return;active=false;cleanups.delete(release);cleanup();};cleanups.add(release);return release;}
const effect=hook=>(setup,deps)=>hook(()=>{
    if(disposed)return;
    const cleanup=setup();return typeof cleanup==='function'?own(cleanup):undefined;
},deps);
const React={...react,useEffect:effect(react.useEffect),useLayoutEffect:effect(react.useLayoutEffect),createElement(type,props,...children){
    const guarded=props&&Object.fromEntries(Object.entries(props).map(([name,value])=>[name,/^on[A-Z]/.test(name)&&typeof value==='function'?(...args)=>{if(!disposed)return value(...args);}:value]));
    return react.createElement(type,guarded,...children);
}};
function schedule(map,start,callback,delay){
    if(disposed)return 0;
    const token={};const id=start((...args)=>{if(disposed||map.get(id)!==token)return;map.delete(id);callback(...args);},delay);map.set(id,token);return id;
}
const setTimeout=(fn,ms)=>schedule(timers,hostSetTimeout,fn,ms),clearTimeout=id=>{timers.delete(id);hostClearTimeout(id);};
const requestAnimationFrame=fn=>schedule(frames,hostRequestFrame,fn),cancelAnimationFrame=id=>{frames.delete(id);hostCancelFrame(id);};
// the galgame stage's "what next" menu.
// Included inside the play-controls feature module so it reuses the candidate pipeline
// (Candidate Generator via submitTask, the shared candidate panel) instead of a new one.
// The host schedules automatic generation on live completion. This view only generates on
// an explicit click; opening the stage never starts a second task or retries a failed one.
// "generating" only while a candidate task for this message is pending or running (status "loading"). The auto
// preference alone is not enough: the host never backfills an older reply, so auto-on with no task offers the button.
function galEndPanelState({ status, atEnd }) {
    if (!atEnd) return "hidden";
    if (status === "ready") return "ready";
    if (status === "error") return "failed";
    if (status === "loading") return "generating";
    return "off";
}
// the wait lines take turns, one every 2.4 s, cross-fading in one reserved
// slot (theme.css "stage choices"). The lines come from the pool shared with the text box (wait-lines.js).
// the end panel of one reply starts on one wait line and plays its entrance
// once. A remount of the same panel (the stage re-rendering at the end of the turn) or a state change and back must
// neither restart the cycle nor wipe the rows in again — that read as the panel blinking while its choices generate.
// `start` is the reply's cycle clock; a remount resumes the cycle where it was.
let galChoiceWait = { key: "", first: 0, start: 0 };
let galChoicesShown = "";
// Choices stored before the host fix may hold double-escaped model output ("\\u7a97…"): show real characters.
// A draft the user has not changed (still the suggestion, or still empty for 「自由输入」): closing it keeps nothing.
function galChoiceUntouched(editing) {
    return Boolean(editing) && String(editing.text || "").trim() === String(editing.initial || "").trim();
}
// the draft key of 「自由输入」; a suggestion's key is the text it sends.
const GAL_FREE = "\u0000free";
function GalChoices(props) {
    const h = React.createElement;
    const sessionId = props.sessionId;
    const {panel,taskForMessage,running,messageId,commands}=props;
    const lifetime=React.useRef({active:false,epoch:0}),pickTimer=React.useRef(0);
    React.useEffect(()=>{lifetime.current.active=true;lifetime.current.epoch++;return()=>{lifetime.current.active=false;clearTimeout(pickTimer.current);};},[]);
    const alive=()=>!disposed&&lifetime.current.active;
    // one ribbon at a time is a field (`editingAt`, a draft key). Its text lives
    // in `drafts` and follows the inline-edit rule: a click outside closes the field and keeps
    // the text (the ribbon then reads as the draft; touch has no Esc), Esc reverts it, Enter sends.
    const [editingAt, setEditingAt] = React.useState(null);
    const [drafts, setDrafts] = React.useState({});
    const [sending, setSending] = React.useState(false);
    const [stopping, setStopping] = React.useState(false);
    const [error, setError] = React.useState("");
    // the suggestion being picked while its motion plays (null otherwise).
    const [picked, setPicked] = React.useState(null);
    const editorRef = React.useRef(null);
    const requestRef = React.useRef(false);
    // a task the player stopped reads as never started - 生成选项 again, not an error.
    const status = panel ? panel.phase : taskForMessage ? taskForMessage.busy ? "loading" : taskForMessage.status === "succeeded" ? "ready" : taskForMessage.status === "cancelled" ? "idle" : "error" : "idle";
    const state = galEndPanelState({ status, atEnd: props.atEnd !== false && !running });
    const panelKey = String(sessionId) + ":" + String(messageId || "");
    if (state === "generating") galChoiceWait = stageWaitLinesEpisode(galChoiceWait, panelKey, (props.waitLines || STAGE_WAIT_LINES).length);
    const settledRef = React.useRef(null);
    if (state !== "hidden" && settledRef.current === null) settledRef.current = galChoicesShown === panelKey;
    React.useEffect(function () { if (state !== "hidden") galChoicesShown = panelKey; }, [state !== "hidden", panelKey]);
    // galgame UI cues (ui-sfx.js): a chime when this reply's options appear, confirm on sending.
    const rootRef = React.useRef(null);
    useForkUiSfxControls(rootRef, state !== "hidden");
    // A short stage: when the list overflows its bottom rows stay in view and the choices above scroll.
    const choiceCount = panel && panel.phase === "ready" && panel.choices ? panel.choices.length : 0;
    (React.useLayoutEffect || React.useEffect)(function () {
        const el = rootRef.current;
        if (el && el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight;
    }, [state, choiceCount]);
    // Image bars on the pixel step (galSnapChoices): after layout, on every resize of the list or the window, and
    // when the screen's pixel ratio changes (a window moved to another monitor, the zoom).
    // only new choices, a new state or a resize
    // start the fit over. Opening or closing a field changes that one row: `resnapRef` keeps the fit and every bar as it is,
    // the field at least its bar's height (so opening it moves nothing) and the bar back at its own height when it closes;
    // only a field taller than its bar grows the menu (and may shrink it once more). A fresh fit painted every bar at full
    // size for a frame or more before it shrank them again.
    const resnapRef = React.useRef(null), fieldRowRef = React.useRef(null);
    (React.useLayoutEffect || React.useEffect)(function () {
        const el = rootRef.current;
        if (!el || state === "hidden" || typeof window === "undefined" || !el.closest || !el.closest("[data-fk-skin-choices]")) return;
        let frame = 0, media = null, stopped = false;
        const run = () => { frame = 0; if (!stopped && (layout.galSnapChoices(el, window.devicePixelRatio || 1) || layout.galFitChoices(el))) frame = requestAnimationFrame(run); };
        const later = () => { if (!stopped && !disposed && !frame) frame = requestAnimationFrame(run); };
        const resize = () => {
            if(stopped||disposed)return;
            for (const row of [el, ...el.children]) row.style.removeProperty("--fk-snap-h");
            el.style.removeProperty("--art-choice-fit");
            later();
        };
        const watch = () => { media?.removeEventListener?.("change", onRatio); media = window.matchMedia?.("(resolution: " + (window.devicePixelRatio || 1) + "dppx)") || null; media?.addEventListener?.("change", onRatio); };
        function onRatio() { if(stopped||disposed)return;watch(); resize(); }
        // A row that changes size (the open field growing a line as the player types) re-snaps before that frame is painted,
        // as opening a field does (resnapRef): one snap pass per frame painted every pass - the list a step taller each frame,
        // its rows stretched - so each typed character made the menu jump and come back.
        const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => resnapRef.current ? resnapRef.current(null, null) : later()) : null;
        observer?.observe(el);
        window.addEventListener("resize", resize);
        watch();
        for (const row of [el, ...el.children]) row.style.removeProperty("--fk-snap-h");
        el.style.removeProperty("--art-choice-fit");
        run();
        // The settled snaps are a fixed point (the list's snapped height stretches its grid rows): the rows keep theirs, the
        // list starts over, and the passes run here until they settle, before the frame is painted.
        const rest = new WeakMap();
        resnapRef.current = (closed, opened) => {
            if(stopped||disposed)return;
            if (frame) { cancelAnimationFrame(frame); frame = 0; }
            if (closed && closed !== opened && closed.parentNode === el && rest.has(closed)) {
                if (rest.get(closed)) closed.style.setProperty("--fk-snap-h", rest.get(closed)); else closed.style.removeProperty("--fk-snap-h");
            }
            if (opened && opened !== closed) rest.set(opened, opened.style.getPropertyValue("--fk-snap-h"));
            el.style.removeProperty("--fk-snap-h");
            for (let pass = 0; pass < 8; pass++) if (!(layout.galSnapChoices(el, window.devicePixelRatio || 1) || layout.galFitChoices(el))) return;
            later();
        };
        return function () { stopped = true; resnapRef.current = null; if (frame) cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener("resize", resize); media?.removeEventListener?.("change", onRatio); };
    }, [state, choiceCount]);
    (React.useLayoutEffect || React.useEffect)(function () {
        const field = rootRef.current?.querySelector?.(":scope > .is-editing") || null;
        // An opened suggestion is edited from its end: the caret after its text (autoFocus left it at the start).
        const input = field?.querySelector?.(".fork-gal-choice-input");
        if (input && input === document.activeElement) input.setSelectionRange(input.value.length, input.value.length);
        resnapRef.current?.(fieldRowRef.current, field);
        fieldRowRef.current = field;
    }, [editingAt]);
    const offered = state === "ready" && Boolean(panel && panel.choices && panel.choices.length);
    React.useEffect(function () { if (offered) forkUiSfx.play("choice"); }, [offered, messageId]);
    // A click outside the open field closes it and keeps what was typed (capture phase, before the click acts).
    const refocusRef = React.useRef(null);
    React.useEffect(function () {
        if (editingAt === null || sending || typeof document === "undefined" || !document.addEventListener) return;
        function onPointerDown(event) {
            if(!alive())return;
            const card = editorRef.current;
            if (card && event.target && typeof card.contains === "function" && card.contains(event.target)) return;
            closeField(false);
        }
        document.addEventListener("pointerdown", onPointerDown, true);
        return function () { document.removeEventListener("pointerdown", onPointerDown, true); };
    }, [editingAt, drafts, sending]);
    // Esc hands the keyboard back to the ribbon it reverted.
    React.useEffect(function () {
        const selector = refocusRef.current, root = rootRef.current;
        if (editingAt !== null || !selector || !root || typeof root.querySelector !== "function") return;
        refocusRef.current = null;
        const target = root.querySelector(selector);
        if (target && typeof target.focus === "function") target.focus();
    }, [editingAt]);
    // Close the field: Esc reverts its draft; a click away keeps a changed one (an unchanged one is simply dropped).
    function closeField(revert) {
        const key = editingAt;
        if (key === null) return;
        setDrafts(function (previous) {
            const next = Object.assign({}, previous);
            if (revert || galChoiceUntouched({ text: next[key], initial: key === GAL_FREE ? "" : key })) delete next[key];
            return next;
        });
        setEditingAt(null);
    }
    // a pick the player stopped and withdrew (the stage's 停止 while the reply was written)
    // comes back. A suggestion sent as offered is simply live again; typed or edited words wait in 自由输入 as its draft
    // (the stage passes only those, see onSending).
    const withdrawn = String(props.withdrawnText || "").trim();
    React.useEffect(function () {
        if (withdrawn) setDrafts(previous => previous[GAL_FREE] ? previous : Object.assign({}, previous, { [GAL_FREE]: withdrawn }));
    }, [withdrawn]);
    // the player has started an input - a field open, a draft
    // kept, a pick or a send under way. The deadline stops counting then, and its fallback never overrides it.
    const inputStarted = editingAt !== null || sending || picked !== null || Object.values(drafts).some(text => String(text || "").trim());
    React.useEffect(function () { props.onInputActivity?.(inputStarted); }, [inputStarted]);
    React.useEffect(function () { return function () { props.onInputActivity?.(false); if (props.fallbackRef) props.fallbackRef.current = null; }; }, []);
    // the 自由输入 row has exactly
    // one action control - 发送 while that draft holds text (open or closed), else 重新生成 (发送, disabled, when 重新生成 is not
    // offered). Skins only draw it (art.choices.tool.image / .send, else the shared replay / send glyphs in the skin's ink).
    // Each change after the first look flips data-swap, which restarts the badge's turn (theme.css).
    const canRegenerate = typeof props.onRegenerate === "function" && state !== "generating";
    const toolSend = Boolean(String(drafts[GAL_FREE] || "").trim()) || !canRegenerate;
    const swapRef = React.useRef({ send: toolSend, count: 0 });
    if (swapRef.current.send !== toolSend) swapRef.current = { send: toolSend, count: swapRef.current.count + 1 };
    if (state === "hidden") { if (props.fallbackRef) props.fallbackRef.current = null; return null; }
    // the wait chip stops this reply's choices (host stopChoices:
    // only the candidate task; the director, settlement and the body keep going). The panel then offers 生成选项,
    // 自由输入 and 重新生成 again.
    async function stopChoices() {
        if(!alive()||stopping||!taskForMessage)return;
        const epoch=lifetime.current.epoch;
        forkUiSfx.play('cancel');setStopping(true);setError('');
        try {await commands.stop(taskForMessage.taskId);}
        catch(err){if(alive()&&epoch===lifetime.current.epoch)setError('停止失败：'+String(err?.message||err));}
        finally{if(alive()&&epoch===lifetime.current.epoch)setStopping(false);}
    }
    async function send(text, cued) {
        const value = String(text || "").trim();
        if (!alive() || !value || sending) return;
        const epoch=lifetime.current.epoch;
        const current=()=>alive()&&epoch===lifetime.current.epoch;
        if (typeof props.executeSlash !== "function") { setError("当前界面无法发送，请回到聊天视图输入"); setPicked(null); return; }
        if (!cued) forkUiSfx.play("confirm");
        setSending(true); setError("");
        // offered: a suggestion sent exactly as offered (withdrawing it needs no draft; see withdrawnText).
        props.onSending?.(value, { offered: choices.some(choice => textOf(choice) === value) });
        try {
            // A pipe would split the slash command; the full-width bar reads the same.
            await props.executeSlash("/send " + value.replace(/\|/g, "｜") + "|/trigger", sessionId);
            if(!current())return;
            commands.clear(); setEditingAt(null); setDrafts({});
            props.onSent && props.onSent(value);
        } catch (err) {
            if(!current())return;
            setError("发送失败：" + String(err && err.message || err));
            setPicked(null);
            props.onSendFailed?.(err);
        }
        finally { if(current())setSending(false); }
    }
    // a skin's bar menu plays the original's pick (the
    // picked bar squeezes and swells out while the others fade) and then sends. Its length is the list's CSS
    // --gal-choice-pick-ms: 0 in every other look and under CONFIG 「减少动态」, which send at once.
    function pick(key, text) {
        if (!alive() || sending || picked !== null) return;
        const root = rootRef.current;
        const ms = root && typeof getComputedStyle === "function" ? parseFloat(getComputedStyle(root).getPropertyValue("--gal-choice-pick-ms")) || 0 : 0;
        if (!ms) { send(text); return; }
        forkUiSfx.play("confirm");
        setPicked(key);
        pickTimer.current=setTimeout(() => send(text, true), ms);
    }
    async function generate() {
        if(!alive()||!messageId||requestRef.current||status==='loading'||taskForMessage?.busy)return;
        forkUiSfx.play('confirm');requestRef.current=true;
        try {await commands.generate();}finally{requestRef.current=false;}
    }
    const choices = panel && panel.phase === "ready" ? (panel.choices || []).map(choice => choice !== null && typeof choice === "object" ? { ...choice, text: props.decode(choice.text) } : { type: "action", text: props.decode(String(choice)) }) : [];
    const textOf = choice => (choice.type === "scene" ? "【场景变化】" : "") + choice.text;
    // The reply deadline's fallback goes through this panel's one send lock, synchronously checked: nothing typed or picked,
    // nothing sending. It returns whether it was sent (the caller marks the offer consumed before, so it is never retried).
    if (props.fallbackRef) props.fallbackRef.current = function (text) {
        if (!alive() || inputStarted || sending || picked !== null) return false;
        send(text);
        return true;
    };
    const draftOf = key => drafts[key] != null ? drafts[key] : key === GAL_FREE ? "" : key;
    const freeDraft = drafts[GAL_FREE] && drafts[GAL_FREE].trim() ? drafts[GAL_FREE] : "";
    // a ribbon turns into its own field in place — the same element (no remount,
    // so no entrance wipe) and, for one line, the same height (theme.css), so nothing below or above it moves. One
    // send control: 自由输入's is the row's one badge (below); an edited suggestion gets the same badge as 发送 (owner
    // 2026-10-26: the skin's art.choices.tool.send, else the shared send glyph, at the row's end). There is no 取消
    // button: Esc reverts, a click away closes and keeps the text (touch included).
    function editor(key, refocus) {
        const text = draftOf(key);
        return [
            // Styled only through the stage UI tokens (theme.css "stage choices"), which also shield it from skins.
            h(TextArea, { key: "input", className: "fork-gal-choice-input", "aria-label": key === GAL_FREE ? "自由输入下一步" : "修改选项", autoFocus: true, rows: 1, value: text,
                placeholder: key === GAL_FREE ? "你想怎么做？" : "改完按 Enter 发送",
                onChange: value => setDrafts(previous => Object.assign({}, previous, { [key]: value })),
                onClick: e => e.stopPropagation(),
                onKeyDown: e => {
                    e.stopPropagation();
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); }
                    else if (e.key === "Escape") { e.preventDefault(); forkUiSfx.play("cancel"); refocusRef.current = refocus; closeField(true); }
                } }),
            key === GAL_FREE ? null : h("button", { key: "send", type: "button", role: "menuitem", "data-action": "send", "data-tool": "send", className: "fork-gal-choice-tool", title: "发送（Enter）", "aria-label": "发送",
                disabled: sending || !text.trim(), onClick: e => { e.stopPropagation(); send(text); } }, h(Icon, { name: "send", size: 17 }), h("span", null, "发送"))];
    }
    function open(key) { setEditingAt(key); }
    // One status slot (生成选项 / the wait line / 选项生成失败): switching between them reuses the card, so it never wipes in again.
    // Generating (wait redesign): a quiet chip, not a card — the wait line ending in six breathing accent dots.
    // Every line sits in the same grid cell, so the chip is sized by the longest and never moves when the line changes;
    // only the first is read out (the others are aria-hidden), and without motion it is the one shown.
    // the chip is the stop control (StageWaitStop, wait-lines.js).
    // the wait is not a chip over the menu any more; it is portalled
    // into the text box's slot (props.waitSlot, gal-stage.js), the same wait the box shows while a reply is written.
    const waitRow = state === "generating" && props.waitSlot ? ReactDOM.createPortal(h("div", { className: "fork-gal-box-wait-row", role: "status", "aria-live": "polite", onClick: e => e.stopPropagation() },
            h(StageWaitStop, { label: "正在生成选项", busy: stopping, onStop: stopChoices },
                h(StageWaitLines, { first: galChoiceWait.first, start: galChoiceWait.start, lines: props.waitLines }))), props.waitSlot) : null;
    const statusRow = state === "off" ? h("div", { key: "status", className: "fork-gal-choice" },
            h("button", { type: "button", role: "menuitem", "data-action": "generate", className: "fork-gal-choice-main", disabled: !messageId || sending, onClick: generate }, "生成选项"), layout.galChoiceArt())
        : state === "failed" ? h("div", { key: "status", className: "fork-gal-choice is-error" }, h("span", null, "选项生成失败"),
            h("button", { type: "button", role: "menuitem", "data-action": "retry", className: "fork-gal-choice-edit", disabled: !messageId || sending, onClick: generate,
                title: String(panel && panel.error || taskForMessage && taskForMessage.error || "选项生成未完成") }, "重试"))
        : null;
    // 重新生成 is the trailing control of the 自由输入 row
    // (open or not); without 自由输入 it keeps the same slot as a compact row. One row either way, so --rows (the bar rows of a
    // skin's bar menu, theme.css 「stage skin: art choices」 fits its stack to the screen) counts it once.
    // while the choices generate neither shows (an open field stays).
    const freeShown = !(state === "generating" && editingAt !== GAL_FREE);
    const toolShown = canRegenerate || (freeShown && (editingAt === GAL_FREE || Boolean(freeDraft)));
    const rows = choices.length + (statusRow ? 1 : 0) + (freeShown || toolShown ? 1 : 0);
    // 重新生成 opens the stage's own regenerate dialog (gal-regenerate.js: 正文 / MVU / 舞台指导 / 选项, 正文 preselected,
    // optional guidance + 确定; 正文 is the same regenBody RPC as the chat view's 「重新生成正文」); the stage passes onRegenerate,
    // its busy rule and the G key (gal-stage.js presses this control). After 自由输入 in the DOM, so in focus order too.
    // An open field closes first and keeps its text, as a click anywhere else would.
    // Holding text it is 发送 instead: it sends the 自由输入 draft, and G (which presses only [data-action="regenerate"])
    // leaves it alone.
    const swap = swapRef.current.count ? (swapRef.current.count % 2 ? "a" : "b") : undefined;
    const tool = toolShown ? (toolSend
        ? h("button", { key: "regenerate", type: "button", role: "menuitem", "data-action": "send", "data-tool": "send", "data-swap": swap, className: "fork-gal-choice-tool", title: "发送（Enter）", "aria-label": "发送",
            disabled: sending || !freeDraft, onClick: e => { e.stopPropagation(); send(drafts[GAL_FREE]); } }, h(Icon, { name: "send", size: 17 }), h("span", null, "发送"))
        : h("button", { key: "regenerate", type: "button", role: "menuitem", "data-action": "regenerate", "data-tool": "regenerate", "data-swap": swap, className: "fork-gal-choice-tool", title: "重新生成（G）", "aria-label": "重新生成", "aria-keyshortcuts": "G",
            disabled: sending || Boolean(props.regenerateDisabled), onClick: e => { e.stopPropagation(); closeField(false); props.onRegenerate(); } }, h(Icon, { name: "replay", size: 17 }), h("span", null, "重新生成"))) : null;
    return h("div", { ref: rootRef, className: "fork-gal-choices fork-gal-endpanel", style: props.hidden ? { display: "none" } : { "--rows": rows }, "data-hidden": props.hidden ? "" : undefined, "data-state": state, "data-settled": settledRef.current ? "" : undefined, "data-picked": picked !== null ? "" : undefined, role: "menu", "aria-label": "接下来", onClick: e => e.stopPropagation(), onWheel: e => e.stopPropagation() },
        choices.map(function (choice, index) {
            const key = textOf(choice), draft = drafts[key];
            // data-index stays on the open field: a numbered skin keeps its number in the cell (theme.css) and the rows below it theirs.
            if (editingAt === key) return h("div", { key: index, ref: editorRef, className: "fork-gal-choice is-editing", "data-type": choice.type, "data-index": index }, editor(key, '[data-index="' + index + '"] > .fork-gal-choice-main'));
            // A suggestion edited and left (click away) reads as its draft and sends what it shows; Esc in its field reverts it.
            return h("div", { key: index, className: "fork-gal-choice" + (picked === key ? " is-picked" : ""), "data-type": choice.type, "data-index": index, "data-edited": draft != null ? "" : undefined },
                h("button", { type: "button", role: "menuitem", className: "fork-gal-choice-main", disabled: sending, onClick: () => pick(key, draft != null ? draft : key), onPointerEnter: () => forkUiSfx.play("move") },
                    // a scene jump reads like any other choice - no tag, same card (its
                    // 【场景变化】 prefix is only in the message sent).
                    h("span", { className: "fork-gal-choice-text" }, draft != null ? draft : choice.text)),
                h("button", { type: "button", className: "fork-gal-choice-edit", "data-ui-sfx": "toggle", "aria-label": "改一改再发送", title: "改一改再发送", disabled: sending, onClick: () => open(key) }, h(Icon, { name: "pencil", size: 15 })), layout.galChoiceArt());
        }),
        statusRow,
        waitRow,
        // 自由输入 is the menu's last ribbon (dashed edge, secondary ink); it turns
        // into the field in place and, closed with text in it, reads as that draft. (「生成中的
        // 时候隐藏这个『自由输入』」): not shown while the choices generate (an open field stays); stopping brings it back.
        !freeShown ? (tool ? h("div", { key: "free", className: "fork-gal-choice is-free is-compact" }, tool) : null)
        : editingAt === GAL_FREE ? h("div", { key: "free", ref: editorRef, className: "fork-gal-choice is-free is-editing" }, editor(GAL_FREE, '[data-action="free"]'), tool)
        : h("div", { key: "free", className: "fork-gal-choice is-free", "data-edited": freeDraft ? "" : undefined },
            h("button", { type: "button", role: "menuitem", "data-action": "free", className: "fork-gal-choice-main", "data-ui-sfx": "toggle", disabled: sending, onClick: () => open(GAL_FREE) },
                h(Icon, { name: "pencil", size: 15 }), h("span", { className: "fork-gal-choice-text" }, freeDraft || "自由输入")), tool, layout.galChoiceArt()),
        error ? h("p", { className: "fork-gal-choice-error", role: "alert" }, error) : null);
}
return {Choices:GalChoices,dispose(){if(disposed)return;disposed=true;const errors=[];for(const fn of [...cleanups]){try{fn();}catch(error){errors.push(error);}}for(const [map,cancel] of [[timers,hostClearTimeout],[frames,hostCancelFrame]]){for(const id of map.keys()){try{cancel(id);}catch(error){errors.push(error);}}map.clear();}if(errors.length)throw new AggregateError(errors,'Choices cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageChoices};
