// A card shown for the first time starts from an estimate (up to 1200px) and then shrinks
// to its real height. Above the viewport that shift moved everything the reader was looking
// at. Browser scroll anchoring does not cover DSH's chat list, so keep the reading position
// here, unless the browser already adjusted it (it does so during layout).
function tavernScrollerOf(win, node) {
    for (let element = node.parentElement; element; element = element.parentElement) {
        const style = win.getComputedStyle(element);
        if (/(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) return element;
    }
    return win.document.scrollingElement;
}
function tavernKeepViewWhileResizing(win, node, mutate) {
    if (!node.isConnected || node.closest("[hidden]") || typeof win.getComputedStyle !== "function") { mutate(); return; }
    const scroller = tavernScrollerOf(win, node);
    const before = node.getBoundingClientRect(), offset = scroller ? scroller.scrollTop : 0;
    mutate();
    if (!scroller) return;
    const top = scroller === win.document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
    if (before.bottom <= top && scroller.scrollTop === offset) scroller.scrollTop = offset + node.getBoundingClientRect().height - before.height;
}
function tavernStoredFrameHeight(win, key) {
    try {
        const saved = Number(win.sessionStorage.getItem(key));
        return Number.isFinite(saved) && saved >= 48 ? clampTavernFrameHeight(saved) : 0;
    } catch (_) { return 0; }
}

// React owns only the placement slot. The conversation owns its iframe DOM and
// authenticated bridge, so unmounting a message cannot reset a card wizard.
function createRetainedTavernFrames(options) {
    const host = options.window, document = host.document, retention = options.retention;
    const records = new Map();
    let parking = null, retiring = null;
    // A trusted status panel may mount its own overlay onto the DSH page, which Tavern
    // cannot attribute to it. Leaving the conversation closes those panels so the next
    // game is not covered; returning reloads them.
    if (typeof retention.onLeave === "function") retention.onLeave(function (sessionId) {
        for (const record of Array.from(records.values())) if (record.sessionId === sessionId && record.persistent) release(record);
    });
    const retirements = new Map();
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
    // A reloaded status panel keeps its old document alive, hidden and earlier in
    // document order, until the replacement has loaded. SillyTavern card shells elect
    // the newest floor and hand shared UI over to it; tearing the old one down first
    // lets it hide that UI with no successor to restore it.
    function retire(record) {
        const node = record.node;
        if (!node.isConnected || typeof document.body.moveBefore !== "function") return false;
        if (!retiring) {
            retiring = document.createElement("div");
            retiring.hidden = true;
            retiring.setAttribute("data-tavern-retiring-frames", "");
        }
        if (retiring.parentNode !== document.body) document.body.insertBefore(retiring, document.body.firstChild);
        retiring.moveBefore(node, null);
        let timer = null;
        const finish = function () {
            if (retirements.get(record.key) === finish) retirements.delete(record.key);
            host.clearTimeout(timer);
            node.remove();
            if (retiring && !retiring.firstChild) { retiring.remove(); retiring = null; }
        };
        timer = host.setTimeout(finish, 5000);
        const previous = retirements.get(record.key);
        retirements.set(record.key, finish);
        if (previous) previous();
        return true;
    }
    function successorLoaded(record) {
        const finish = retirements.get(record.key);
        if (finish) host.setTimeout(finish, 300);
    }
    function release(record, replaced) {
        if (records.get(record.key) !== record) return;
        records.delete(record.key);
        if (record.unmount) record.unmount();
        if (record.forget) record.forget();
        if (record.stop) record.stop();
        if (record.unpin) record.unpin();
        if (record.unzoom) record.unzoom();
        for (const item of record.frames.values()) item.descriptor.ref(null);
        record.frames.clear();
        if (!(replaced && retire(record))) record.node.remove();
        if (!records.size && parking) { parking.remove(); parking = null; }
    }
    function paint(record, state) {
        if (record.node.style.height !== state.height + "px") tavernKeepViewWhileResizing(host, record.node, function () { record.node.style.height = state.height + "px"; });
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
                if (retirements.has(record.key)) frame.addEventListener("load", function () { successorLoaded(record); }, { once: true });
                item = { node: frame, descriptor: descriptor };
                record.frames.set(descriptor.token, item);
                record.node.appendChild(frame);
                descriptor.ref(frame);
            }
            const frame = item.node;
            frame.title = hidden ? "正在准备人物卡消息界面" : "人物卡消息界面";
            if (hidden) frame.setAttribute("aria-hidden", "true"); else frame.removeAttribute("aria-hidden");
            // A page-fullscreen frame owns its geometry until it is restored.
            if (frame.hasAttribute("data-dsh-tavern-expanded")) continue;
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
            // Story frames follow the reading font size; status panels keep their layout.
            if (!props.persistent) record.unzoom = bindTavernFontZoom(node, host);
            record.lifecycle = options.createLifecycle(props);
            paint(record, record.lifecycle.snapshot());
            record.stop = record.lifecycle.start(function (state) { paint(record, state); });
            record.forget = retention.hold(props.sessionId, record, function () { release(record); });
        }
        record.lifecycle.update(props);
        return record;
    }
    // After "load earlier", cards above the reader are loaded one at a time offscreen, measured
    // and closed again, so each one later reserves its real height instead of an estimate.
    // Nearest first: floors mount top to bottom, the newest request is closest to the reader.
    // Each card loads a whole page (styles, libraries, scripts); back to back they froze the
    // chat for seconds right after "load earlier". Measure only when the page is idle, with a
    // gap between cards.
    const measurements = [];
    let measuring = false, waiting = false;
    function nextMeasurement() {
        if (measuring || waiting || !measurements.length) return;
        waiting = true;
        const run = function () { waiting = false; measureNext(); };
        host.setTimeout(function () {
            if (typeof host.requestIdleCallback === "function") host.requestIdleCallback(run, { timeout: 3000 }); else run();
        }, 400);
    }
    function measureNext() {
        if (measuring) return;
        const job = measurements.pop();
        if (!job) return;
        if (job.cancelled || records.has(job.key) || !job.node.isConnected) { job.resolve(0); measureNext(); return; }
        measuring = true;
        // Read layout and Helper state only now, at idle, once per measured card: mounting a
        // "load earlier" batch must not force a page layout per slot.
        job.props = job.props();
        const width = Math.max(1, Math.round(job.node.clientWidth) || 1);
        const stage = document.createElement("div");
        stage.setAttribute("data-tavern-measuring-frame", "");
        stage.setAttribute("aria-hidden", "true");
        // Inside the viewport geometry (frames stop measuring when offscreen), but never painted.
        Object.assign(stage.style, { position: "fixed", left: "0", top: "0", width: width + "px", visibility: "hidden", pointerEvents: "none", zIndex: "-1" });
        document.body.appendChild(stage);
        const record = get(job.props);
        move(record.node, stage);
        let last = -1, stableSince = host.performance ? host.performance.now() : Date.now();
        const started = stableSince;
        const timer = host.setInterval(function () {
            const now = host.performance ? host.performance.now() : Date.now();
            const height = record.lifecycle.snapshot().height;
            if (height !== last) { last = height; stableSince = now; }
            if (!job.cancelled && now - stableSince < 500 && now - started < 6000) return;
            host.clearInterval(timer);
            const measured = job.cancelled ? 0 : tavernStoredFrameHeight(host, tavernFrameHeightKey(job.props));
            // The reader may have scrolled to it meanwhile; a mounted frame stays.
            if (!record.unmount) release(record);
            stage.remove();
            measuring = false;
            job.resolve(measured);
            nextMeasurement();
        }, 100);
    }
    return {
        key: key,
        has: function (props) { return records.has(key(props)); },
        measure: function (props, node, readProps) {
            let job;
            const result = new Promise(function (resolve) { job = { key: key(props), props: readProps, node: node, resolve: resolve, cancelled: false }; });
            measurements.push(job);
            nextMeasurement();
            return { result: result, cancel: function () { job.cancelled = true; } };
        },
        mount: function (props, home) {
            let record = get(props), unmount;
            function attach(props) {
                move(record.node, home);
                unmount = retention.mount(props.sessionId);
                record.unmount = unmount;
                const movable = !props.persistent && /<(?:script|iframe|object|embed)\b/i.test(String(props.content || ""));
                if (movable && options.panels) {
                    record.panel = Object.assign(record.panel || {}, { id: "retained:" + record.key,
                        sessionId: props.sessionId, title: "第 " + props.turn + " 轮 · 面板 " + (Number(props.partIndex) + 1),
                        node: record.node, home: home, pinned: Boolean(record.panel && record.panel.pinned) });
                    record.unpin = options.panels.register(record.panel);
                }
            }
            attach(props);
            let attached = true;
            let latest = props;
            function update(next) {
                latest = next;
                if (!attached) return;
                // The host can retain React panels across navigation while onLeave
                // releases their iframe. Renew that lease only for the selected session.
                if (records.get(record.key) !== record) {
                    if (records.has(record.key) || !home.isConnected || retention.isSelected && !retention.isSelected(next.sessionId)) return;
                    record = get(next); attach(next);
                } else record.lifecycle.update(next);
            }
            const stopSelection = retention.onSelect?.(id => { if (id === latest.sessionId) update(latest); });
            return {
                expand: function () { return expandTavernFrame(record.node); },
                update,
                detach: function () {
                    if (!attached) return;
                    attached = false;
                    stopSelection?.();
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
            for (const record of Array.from(records.values())) if (record.sessionId === sessionId && record.persistent && record.panelId === panelId) release(record, true);
        },
        clear: function () { for (const record of Array.from(records.values())) release(record); }
    };
}

function TavernRetainedMessageFrame(props) {
    const home = React.useRef(null), lease = React.useRef(null);
    const pendingPin = React.useRef(null);
    // A floor that scrolls back in finds its retained document still alive: reattach it at
    // once instead of waiting behind a placeholder and reloading.
    const [activated, setActivated] = React.useState(props.eager === true || tavernRetainedFrames.has(props));
    const [reservedHeight, setReservedHeight] = React.useState(function () { return tavernStoredFrameHeight(window, tavernFrameHeightKey(props)); });
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
    React.useEffect(function () {
        if (activated || reservedHeight || props.persistent || !home.current) return;
        const measured = tavernRetainedFrames.measure(frameProps, home.current, function () {
            return props.helperContextReader ? Object.assign({}, frameProps, { helperContext: props.helperContextReader() }) : frameProps;
        });
        let live = true;
        measured.result.then(function (height) {
            if (!live || !height || !home.current) return;
            tavernKeepViewWhileResizing(window, home.current, function () { home.current.style.minHeight = height + "px"; });
            setReservedHeight(height);
        });
        return function () { live = false; measured.cancel(); };
    }, [activated, reservedHeight, key]);
    React.useLayoutEffect(function () {
        if (!activated) return;
        // Deferred historical frames take their frozen baseline when activated.
        // Their parent need not receive every intervening Helper update.
        const initialProps = props.helperContextReader
            ? Object.assign({}, frameProps, { helperContext: props.helperContextReader() }) : frameProps;
        const mounted = tavernRetainedFrames.mount(initialProps, home.current);
        lease.current = mounted;
        // The first click may activate a cold frame. Wait for mount to register its
        // panel before pinning, and never carry that intent to another message.
        const pinAfterMount = pendingPin.current === panelId;
        pendingPin.current = null;
        if (pinAfterMount) {
            try { tavernPanelRegistry.pin(panelId, true); }
            catch (error) { tavernErrorHub.report("固定面板", error); }
        }
        return function () { lease.current = null; mounted.detach(); };
    }, [activated, key]);
    React.useLayoutEffect(function () { if (lease.current) lease.current.update(frameProps); });
    const movable = !props.persistent && /<(?:script|iframe|object|embed)\b/i.test(String(props.content || ""));
    return React.createElement("div", null,
        movable && !pinned ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", onClick: function () {
            if (!activated) { pendingPin.current = panelId; setActivated(true); return; }
            try { tavernPanelRegistry.pin(panelId, true); }
            catch (error) { tavernErrorHub.report("固定面板", error); }
        } }, "固定到右侧") : null,
        tavernFrameSizing(props.content, props.frameSizing, props.persistent ? props.panelId : undefined) ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", onClick: () => { if (!activated) { setActivated(true); return; } return lease.current?.expand(); } }, "展开大屏") : null,
        // Reserve the height this frame last reported, not a generic estimate: the estimate
        // (up to 1200px) collapsing on load shifted everything below it while scrolling.
        React.createElement("div", { ref: home, style: { minHeight: activated ? undefined : (reservedHeight || estimatedTavernFrameHeight(props.content)) + "px" } }));
}
