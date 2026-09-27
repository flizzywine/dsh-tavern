// React owns only the placement slot. The conversation owns its iframe DOM and
// authenticated bridge, so unmounting a message cannot reset a card wizard.
function createRetainedTavernFrames(options) {
    const host = options.window, document = host.document, retention = options.retention;
    const records = new Map();
    let parking = null;
    function parked() {
        if (!parking) {
            parking = document.createElement("div");
            parking.hidden = true;
            parking.setAttribute("data-tavern-retained-frames", "");
            document.body.appendChild(parking);
        }
        return parking;
    }
    function key(props) {
        return JSON.stringify([props.sessionId, props.persistent ? "status" : "message", props.persistent ? props.panelId : props.turn, props.partIndex]);
    }
    function move(node, target) {
        if (node.parentNode !== target) target.moveBefore(node, null);
    }
    function release(record) {
        if (records.get(record.key) !== record) return;
        records.delete(record.key);
        if (record.unmount) record.unmount();
        if (record.forget) record.forget();
        if (record.stop) record.stop();
        if (record.unpin) record.unpin();
        for (const item of record.frames.values()) item.descriptor.ref(null);
        record.frames.clear();
        record.node.remove();
        if (!records.size && parking) { parking.remove(); parking = null; }
    }
    function paint(record, state) {
        record.node.style.height = state.height + "px";
        const wanted = [state.visibleDocument, state.pendingDocument].filter(Boolean);
        for (const [token, item] of record.frames) if (!wanted.some(value => value.token === token)) {
            item.descriptor.ref(null); item.node.remove(); record.frames.delete(token);
        }
        for (const descriptor of wanted) {
            const hidden = descriptor === state.pendingDocument;
            let item = record.frames.get(descriptor.token);
            if (!item) {
                const frame = document.createElement("iframe");
                frame.className = "dsh-tavern-message-frame";
                frame.__dshTavernSessionId = record.sessionId;
                frame.referrerPolicy = "no-referrer";
                if (!descriptor.trustedCardMode) frame.setAttribute("sandbox", "allow-scripts");
                frame.srcdoc = descriptor.html;
                item = { node: frame, descriptor: descriptor };
                record.frames.set(descriptor.token, item);
                record.node.appendChild(frame);
                descriptor.ref(frame);
            }
            const frame = item.node;
            frame.title = hidden ? "正在准备人物卡消息界面" : "人物卡消息界面";
            if (hidden) frame.setAttribute("aria-hidden", "true"); else frame.removeAttribute("aria-hidden");
            Object.assign(frame.style, { height: (hidden ? descriptor.height || state.height : state.height) + "px",
                position: hidden ? "absolute" : "", left: hidden ? "0" : "", top: hidden ? "0" : "",
                width: "100%", opacity: hidden ? "0" : "", pointerEvents: hidden ? "none" : "",
                overflow: state.height >= 32000 ? "auto" : "hidden" });
        }
    }
    function get(props) {
        const id = key(props);
        let record = records.get(id);
        if (!record) {
            const node = document.createElement("div");
            node.className = "dsh-tavern-message-frame-slot";
            node.style.position = "relative";
            parked().appendChild(node);
            record = { key: id, sessionId: props.sessionId, panelId: props.panelId, persistent: props.persistent, owner: props.frameOwner, node: node, frames: new Map(), unmount: null, unpin: null };
            records.set(id, record);
            record.lifecycle = options.createLifecycle(props);
            paint(record, record.lifecycle.snapshot());
            record.stop = record.lifecycle.start(function (state) { paint(record, state); });
            record.forget = retention.hold(props.sessionId, record, function () { release(record); });
        }
        record.lifecycle.update(props);
        return record;
    }
    return {
        key: key,
        mount: function (props, home) {
            const record = get(props);
            move(record.node, home);
            const unmount = retention.mount(props.sessionId);
            record.unmount = unmount;
            const movable = !props.persistent && /<(?:script|iframe|object|embed)\b/i.test(String(props.content || ""));
            if (movable && options.panels) {
                record.panel = Object.assign(record.panel || {}, { id: "retained:" + record.key,
                    sessionId: props.sessionId, title: "第 " + props.turn + " 轮 · 面板 " + (Number(props.partIndex) + 1),
                    node: record.node, home: home, pinned: Boolean(record.panel && record.panel.pinned) });
                record.unpin = options.panels.register(record.panel);
            }
            let attached = true;
            return {
                expand: function () { return expandTavernFrame(record.node); },
                update: function (next) { if (attached && records.get(record.key) === record) record.lifecycle.update(next); },
                detach: function () {
                    if (!attached) return;
                    attached = false;
                    if (records.get(record.key) !== record) return;
                    // Another React root may attach the new placement before
                    // the previous root cleans up. Its stale lease must not move it.
                    if (record.unmount !== unmount) { unmount(); return; }
                    if (record.unpin) { record.unpin(); record.unpin = null; }
                    move(record.node, parked());
                    if (record.unmount) { record.unmount(); record.unmount = null; }
                }
            };
        },
        invalidateOwner: function (owner) {
            for (const record of Array.from(records.values())) if (record.owner === owner) release(record);
        },
        invalidatePanel: function (sessionId, panelId) {
            for (const record of Array.from(records.values())) if (record.sessionId === sessionId && record.persistent && record.panelId === panelId) release(record);
        },
        clear: function () { for (const record of Array.from(records.values())) release(record); }
    };
}

function TavernRetainedMessageFrame(props) {
    const home = React.useRef(null), lease = React.useRef(null);
    const [activated, setActivated] = React.useState(props.eager === true);
    const panels = React.useSyncExternalStore(tavernPanelRegistry.subscribe, tavernPanelRegistry.inspect);
    const key = tavernRetainedFrames.key(props), panelId = "retained:" + key;
    const pinned = panels.some(entry => entry.id === panelId && entry.pinned);
    const frameProps = Object.assign({}, props, { panelId: props.panelId || "message-" + props.turn + "-" + props.partIndex,
        placement: props.persistent || pinned ? "sidebar" : "message" });
    React.useEffect(function () {
        if (activated) return;
        if (props.eager || typeof window.IntersectionObserver !== "function") { setActivated(true); return; }
        let cancel = null;
        const observer = new window.IntersectionObserver(function (entries) {
            if (entries[entries.length - 1]?.isIntersecting && !cancel) cancel = enqueueTavernFrameActivation(function () { setActivated(true); });
            else if (!entries[entries.length - 1]?.isIntersecting && cancel) { cancel(); cancel = null; }
        }, { rootMargin: "240px 0px" });
        observer.observe(home.current);
        return function () { observer.disconnect(); if (cancel) cancel(); };
    }, [activated, props.eager]);
    React.useLayoutEffect(function () {
        if (!activated) return;
        // Deferred historical frames take their frozen baseline when activated.
        // Their parent need not receive every intervening Helper update.
        const initialProps = props.helperContextReader
            ? Object.assign({}, frameProps, { helperContext: props.helperContextReader() }) : frameProps;
        const mounted = tavernRetainedFrames.mount(initialProps, home.current);
        lease.current = mounted;
        return function () { lease.current = null; mounted.detach(); };
    }, [activated, key]);
    React.useLayoutEffect(function () { if (lease.current) lease.current.update(frameProps); });
    const movable = !props.persistent && /<(?:script|iframe|object|embed)\b/i.test(String(props.content || ""));
    return React.createElement("div", null,
        movable ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", onClick: function () {
            if (!activated) { setActivated(true); return; }
            try { tavernPanelRegistry.pin(panelId, !pinned); }
            catch (error) { tavernErrorHub.report("固定面板", error); }
        } }, pinned ? "返回原消息" : "固定到右侧") : null,
        tavernFrameSizing(props.content, props.frameSizing, props.persistent ? props.panelId : undefined) ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", onClick: () => { if (!activated) { setActivated(true); return; } return lease.current?.expand(); } }, "展开大屏") : null,
        React.createElement("div", { ref: home, style: { minHeight: activated ? undefined : estimatedTavernFrameHeight(props.content) + "px" } }));
}
