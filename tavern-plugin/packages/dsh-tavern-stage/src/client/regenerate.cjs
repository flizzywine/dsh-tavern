function createStageRegenerate({React:react, window, document, report, sounds:forkUiSfx, useSounds:useForkUiSfxControls, episode:stageWaitLinesEpisode, waitLines:STAGE_WAIT_LINES, HelpTip, Segmented, TextArea, StageWaitStop, StageWaitLines}) {
let disposed=false;
const cleanups=new Set();
const effect=hook=>(setup,deps)=>hook(()=>{
    if(disposed)return;
    const cleanup=setup();if(typeof cleanup!=='function')return;
    let active=true;const release=()=>{if(!active)return;active=false;cleanups.delete(release);cleanup();};
    cleanups.add(release);return release;
},deps);
const React={...react,useEffect:effect(react.useEffect),useLayoutEffect:effect(react.useLayoutEffect),createElement(type,props,...children){
    const guarded=props&&Object.fromEntries(Object.entries(props).map(([name,value])=>[name,/^on[A-Z]/.test(name)&&typeof value==='function'?(...args)=>{if(!disposed)return value(...args);}:value]));
    return react.createElement(type,guarded,...children);
}};
function GalRegenerate(props) {
    const {submit:galSubmitRegeneration,stop:galStopRegeneration}=props.commands;
    const h = React.createElement;
    const messageId = props.messageId;
    const [target, setTarget] = React.useState("body");
    const [guidance, setGuidance] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    // stopping - the wait shows 「正在停止」 until the run has ended.
    const [stopping, setStopping] = React.useState(false);
    const stopRef = React.useRef(false); // 停止 was asked for this submit
    // while it submits the button row is the stage wait (wait-lines.js), as the text box
    // shows while a reply is written; each submit opens on its own line.
    const waitRef = React.useRef(null);
    if (!busy) waitRef.current = null;
    else if (!waitRef.current) waitRef.current = stageWaitLinesEpisode(null, "regenerate", (props.waitLines || STAGE_WAIT_LINES).length);
    const pending = React.useRef(""); // the target being submitted
    const root = React.useRef(null);
    const lifetime = React.useRef({active:false,epoch:0});
    React.useEffect(()=>{
        lifetime.current.active=true;lifetime.current.epoch++;
        return()=>{
            lifetime.current.active=false;
            if(pending.current){
                stopRef.current=true;
                if(pending.current==='body')void galStopRegeneration(live.current.sessionId,'body');
                live.current.onBusy(false);
            }
        };
    },[]);
    const live = React.useRef(props);
    live.current = props;
    // galgame UI cues (ui-sfx.js): target radios toggle, 取消 / Esc / right click cancel, 确定 confirms.
    useForkUiSfxControls(root);
    // a running regeneration is never left behind by a closed dialog. While it runs, Esc and
    // right click are its 停止 (as on every stage wait) and the dialog stays until the run has ended; it then returns to
    // its form with the target and guidance kept. A click on the dimmed stage does nothing meanwhile (gal-menu.js).
    function stop() {
        if (disposed || !lifetime.current.active || !pending.current || stopRef.current) return;
        forkUiSfx.play("cancel");
        stopRef.current = true;
        setStopping(true);
        if (pending.current === "body") void galStopRegeneration(live.current.sessionId, "body");
    }
    function dismiss() {
        if(disposed||!lifetime.current.active)return;
        if (pending.current) { stop(); return; }
        forkUiSfx.play("cancel");
        live.current.onClose();
    }
    React.useLayoutEffect(function () {
        const opener = document.activeElement;
        root.current.querySelector('[role="radio"][aria-checked="true"]').focus({ preventScroll: true });
        function onKey(event) {
            if(disposed||!lifetime.current.active)return;
            if (event.isComposing) return;
            if (event.key === "Escape") {
                event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) dismiss();
            } else if (event.key === "Tab") {
                const nodes = Array.from(root.current.querySelectorAll('[role="radio"][aria-checked="true"]:not(:disabled), textarea:not(:disabled), button:not([role="radio"]):not(:disabled)'));
                const at = nodes.indexOf(document.activeElement);
                event.preventDefault(); event.stopImmediatePropagation();
                if (!nodes.length) return;
                nodes[(at + (event.shiftKey ? nodes.length - 1 : 1)) % nodes.length].focus({ preventScroll: true });
            }
        }
        window.addEventListener("keydown", onKey, true);
        return function () {
            window.removeEventListener("keydown", onKey, true);
            if (opener && opener.isConnected) opener.focus({ preventScroll: true });
        };
    }, []);
    // Back from a stopped or failed run the wait that held focus is gone: focus returns to the form.
    const wasBusy = React.useRef(false);
    React.useLayoutEffect(function () {
        if (wasBusy.current && !busy && !root.current.contains(document.activeElement)) root.current.querySelector('[role="radio"][aria-checked="true"]').focus({ preventScroll: true });
        wasBusy.current = busy;
    }, [busy]);
    async function submit(event) {
        event.preventDefault();
        if (disposed || !lifetime.current.active || pending.current || props.busy || props.historical) return;
        pending.current = target; stopRef.current = false; setBusy(true);
        props.onBusy(true);
        const epoch=lifetime.current.epoch;
        const active=()=>!disposed&&lifetime.current.active&&lifetime.current.epoch===epoch;
        let close = false;
        try {
            const started = await galSubmitRegeneration(props.sessionId, props.turn, target, guidance, messageId);
            // 停止 during an enqueue: stop the work it just started. A 正文 that committed before its stop took effect stays.
            if ((!active() || stopRef.current) && target !== "body") await galStopRegeneration(props.sessionId, target, started, props.turn);
            close = !stopRef.current || target === "body";
        } catch (error) {
            // A stopped 正文 fails as 「没有完成…正文保持原样」: that is the stop, not an error.
            if (active() && !stopRef.current) report("重新生成", error);
        }
        finally { if(active()){pending.current = ""; stopRef.current = false; setStopping(false); setBusy(false); props.onBusy(false);} }
        if (active() && close) props.onClose();
    }
    const targets = [
        ["body", "正文", "重写本轮回复；之后照常结算与导演"],
        // 「MVU」 keeps four segments on one line; the (?) and its title say what it is.
        ["mvu", "MVU", "变量结算。保留正文，重新结算本轮 MVU 变量"],
        ["director", "舞台指导", "保留正文与变量，重新生成本轮演出"],
        ["choices", "选项", "保留正文、变量与舞台，只重新生成本轮选项"]
    ];
    // fork-gal-confirm: the stage's confirm dialogs, drawn by a skin's art.confirm (stage-skin-adv.md).
    return h("form", { ref: root, className: "fork-gal-menu-panel fork-gal-regenerate fork-gal-confirm", role: "dialog", "aria-modal": true, "aria-label": "重新生成", "aria-busy": busy, onSubmit: submit,
        onClick: event => event.stopPropagation(), onKeyDown: event => event.stopPropagation(), onContextMenu: event => { event.preventDefault(); event.stopPropagation(); dismiss(); } },
        // no grey helper text — what each target does lives behind the title's 「?」 (and each option's title).
        h("h2", null, "重新生成", typeof HelpTip === "function" ? h(HelpTip, { label: "重新生成说明" }, targets.map(([id, label, note]) => h("span", { key: id }, label + "：" + note))) : null),
        // the target is the shared Segmented in the stage skin (was native
        // radios); ←→ choose, each option keeps its one-line title.
        h(Segmented, { base: "fork-gal-config-seg", className: "fork-gal-regenerate-targets", label: "重新生成目标", value: target, disabled: busy, onChange: setTarget,
            options: targets.map(([id, label, note]) => [id, label, false, note, { "data-target": id }]) }),
        h("label", { className: "fork-gal-regenerate-guidance" }, "本次指导（可选）",
            h(TextArea, { rows: 2, value: guidance, disabled: busy, onChange: setGuidance })),
        // the wait is its own 停止 (StageWaitStop, as the text box's wait):
        // hover or focus shows 「■ 停止」, a click / Enter / Space / Esc stops; on touch the first tap arms it.
        busy ? h("div", { className: "fork-gal-regenerate-actions is-waiting", role: "status", "aria-label": stopping ? "正在停止" : "正在重新生成" },
            h(StageWaitStop, { label: "正在重新生成", busy: stopping, onStop: stop }, h(StageWaitLines, { first: waitRef.current.first, start: waitRef.current.start, lines: props.waitLines }))) :
        h("div", { className: "fork-gal-regenerate-actions" },
            // The words in a span: a skin's drawn buttons (art.confirm) tint their first glyph (::first-letter needs a block box).
            h("button", { type: "button", "data-ui-sfx": "cancel", onClick: props.onClose }, h("span", null, "取消")),
            h("button", { type: "submit", "data-ui-sfx": "confirm", disabled: props.busy || props.historical }, h("span", null, "确定"))));
}
return {Regenerate:GalRegenerate,dispose(){if(disposed)return;disposed=true;const errors=[];for(const cleanup of [...cleanups]){try{cleanup();}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'Regeneration UI cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageRegenerate};
