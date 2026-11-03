// 场景生图 on the stage, part of the core: the illustrator plugin being on for the card is its only switch.
// - useStagePictures: the illustrator's pictures of one round placed on the stage's paragraphs, for the stage's CG insert
//   pages and its 「正在生成 CG…」 notice (gal-stage.js bindStageViews → the controller's `pictures`).
// - the top bar's 场景生图 entry: the chat's 配图 button for the round on screen - a click draws at once, a long press or
//   right click asks for this time's picture request (useTavernIllustratePress, runTavernIllustrator).
// Display only: nothing here writes the story, the stage cursor or the director.
function stageIllustrator(sessionId) {
    const illustrator = tavernUiExtensions.illustrator();
    return illustrator && tavernPluginAllowed(illustrator.owner, sessionId) ? illustrator : null;
}
// units: the round's host paragraphs ({para, text}, the stage text index). A picture follows the first paragraph holding its
// anchor sentence (the chat's own match, pluginAnchorInsertion); one whose sentence is not found closes the round, as in the chat.
function stagePicturePara(units, anchor) {
    if (anchor) for (const unit of units) if (pluginAnchorInsertion(String(unit.text || ""), anchor) >= 0) return unit.para;
    return units.length ? units[units.length - 1].para : 1;
}
// { items: [{ id, para, state 'pending'|'ready'|'failed', progress 0..1|null, url (ready only), caption }], planning }
// progress is the plugin's own report, null until it reports one.
function useStagePictures(sessionId, turn, units, enabled) {
    const extensions = useTavernUiExtensions();
    const media = useTavernPluginMedia(sessionId, turn, enabled);
    const draft = React.useSyncExternalStore(tavernIllustrationDrafts.subscribe, () => tavernIllustrationDrafts.get(sessionId, turn));
    return React.useMemo(() => {
        const ours = item => { const owner = item.kind.indexOf("/") > 0 ? tavernUiExtensions.illustrator(item.kind) : null; return Boolean(owner && tavernPluginAllowed(owner.owner, sessionId)); };
        const items = enabled ? media.items.filter(ours).map(item => {
            const progress = item.activity ? item.activity.progress : item.progress;
            return { id: item.id, para: stagePicturePara(units || [], item.anchor), state: item.activity ? "pending" : item.status,
                progress: typeof progress === "number" && progress > 0 && progress < 1 ? progress : null,
                url: item.status === "ready" && item.attachment ? tavernPluginMediaUrl(sessionId, item) : "", caption: item.caption || "" };
        }) : [];
        return { items, planning: Boolean(enabled && draft && draft.planning) };
    }, [media, units, draft, sessionId, enabled, extensions]);
}

function StageSceneImageEntry(props) {
    useTavernUiExtensions();
    const illustrator = props.turn > 0 ? stageIllustrator(props.sessionId) : null;
    useStageEntryState("scene-image", { available: Boolean(illustrator) });
    return illustrator ? React.createElement(StageSceneImageButton, { key: props.sessionId + ":" + props.turn, sessionId: props.sessionId, turn: props.turn, illustrator }) : null;
}
function StageSceneImageButton(props) {
    const h = React.createElement;
    const [busy, setBusy] = React.useState(false), [open, setOpen] = React.useState(false);
    const [text, setText] = React.useState(""), [sending, setSending] = React.useState(false), [failed, setFailed] = React.useState(false);
    const chip = React.useRef(null), panel = React.useRef(null), field = React.useRef(null), opened = React.useRef(false);
    // The round's notice (「正在生成 CG…」) shows the drawing; the button only stays busy while the plugin plans.
    async function draw() {
        if (busy) return;
        setBusy(true);
        try { await runTavernIllustrator(props.illustrator, props.sessionId, props.turn); } finally { setBusy(false); }
    }
    function openManual() {
        if (opened.current) return;
        opened.current = true;
        forkUiSfx.play("open");
        setText(""); setFailed(false); setOpen(true);
    }
    const press = useTavernIllustratePress(busy, draw, openManual);
    function close() { opened.current = false; press.release(); setOpen(false); }
    useBgmPopover(open, () => { forkUiSfx.play("close"); close(); }, chip, panel, true);
    useForkUiSfxControls(panel, open);
    React.useEffect(() => { if (open && field.current) field.current.focus({ preventScroll: true }); }, [open]);
    async function submit(event) {
        event.preventDefault();
        if (sending) return;
        setSending(true); setFailed(false);
        try { await runTavernIllustrator(props.illustrator, props.sessionId, props.turn, text); close(); if (chip.current) chip.current.focus({ preventScroll: true }); }
        // The plugin's own words stay in its chat card; the stage says only that it did not start.
        catch (_) { setFailed(true); }
        finally { setSending(false); }
    }
    const stop = event => event.stopPropagation();
    const label = busy ? "正在整理画面…" : "场景生图";
    return h("span", { className: "fork-scene-image-entry" },
        h("button", Object.assign({ ref: chip, type: "button", className: "fork-gal-scene-image", title: TAVERN_ILLUSTRATE_TITLE, "aria-label": label,
            "aria-haspopup": "dialog", "aria-expanded": open, "aria-busy": busy || undefined, disabled: busy }, press.handlers,
            { onClick: event => { event.stopPropagation(); return press.handlers.onClick(event); } }),
            busy ? h(Spinner, { delay: 0 }) : h(Icon, { name: "image", size: 16 })),
        open ? h("form", { ref: panel, "data-level": "popover", className: "fk-surface fork-bgm fork-bgm-panel fork-scene-image-panel", role: "dialog", "aria-label": "本次画面要求",
            onSubmit: submit, onClick: stop, onWheel: stop, onContextMenu: stop, onKeyDown: stop },
            h("div", { className: "fork-bgm-head" }, h("i", { className: "fork-bgm-gem", "aria-hidden": true }), h("b", { className: "fork-bgm-title" }, "本次画面要求")),
            h(TextArea, { inputRef: field, value: text, maxLength: 2000, rows: 3, disabled: sending, label: "本次画面要求（最多 2000 字）",
                placeholder: "例如：从门外侧拍摄，镜头略低；角色正在推开窗户。", onChange: setText,
                onKeyDown: event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(event); } }),
            failed ? h("p", { className: "fork-bgm-error", role: "alert" }, "⚠ 没能开始配图") : null,
            h("div", { className: "fork-scene-image-actions" },
                h("button", { type: "button", className: "fork-scene-image-cancel", disabled: sending, onClick: () => { forkUiSfx.play("close"); close(); if (chip.current) chip.current.focus({ preventScroll: true }); } }, "取消"),
                h("button", { type: "submit", className: "fork-scene-image-submit", disabled: sending }, sending ? "正在提交…" : "按要求配图"))) : null);
}
// After 电影模式's place: the top bar's features read 手机 / 模组, 场景生图, 电影模式 (stageEntryOrder: higher first).
if (typeof stageEntries === "object") stageEntries.register({ id: "scene-image", priority: 31, group: "feature", icon: "image", label: "场景生图",
    render: ctx => React.createElement(StageSceneImageEntry, { sessionId: ctx.sessionId, turn: ctx.turn || 0 }) });
