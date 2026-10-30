// Card Stage client runtime.
//
// A card's `extensions.dsh_stage` HTML runs in sandboxed iframes built by the
// existing Tavern Helper frame document (variables, events, getChatMessages,
// triggerSlash). This module only owns placement, the stage SDK and host
// signals; it never writes story or variables itself.

const CARD_STAGE_PREF_KEY = "dsh-card-stage-disabled";
const cardStagePrefs = (function () {
    const listeners = new Set();
    function read() {
        try { const value = JSON.parse(window.localStorage.getItem(CARD_STAGE_PREF_KEY) || "{}"); return value && typeof value === "object" ? value : {}; }
        catch (_) { return {}; }
    }
    let snapshot = read();
    return {
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        get() { return snapshot; },
        disabled(key) { return Boolean(key && snapshot[key]); },
        set(key, disabled) {
            if (!key) return;
            const next = Object.assign({}, snapshot);
            if (disabled) next[key] = true; else delete next[key];
            snapshot = next;
            try { window.localStorage.setItem(CARD_STAGE_PREF_KEY, JSON.stringify(next)); } catch (_) {}
            listeners.forEach(fn => fn());
        }
    };
})();
function useCardStagePrefs() {
    return React.useSyncExternalStore(cardStagePrefs.subscribe, cardStagePrefs.get, cardStagePrefs.get);
}
function cardStageKey(view) { return view && view.card && view.card.path ? String(view.card.path) : ""; }

// Runs inside the stage iframe. Must stay self-contained (serialized with toString).
function installCardStageSdk(region, initialHost) {
    var base = new URL("/api/dsh-tavern/vendor/runtime-assets/", document.baseURI).href;
    var aliases = { three: "three/build/three.module.js" };
    var listeners = Object.create(null);
    var host = initialHost || {};
    var lastVars = "";
    var scheduled = false;
    var readyResolve;
    var ready = new Promise(function (resolve) { readyResolve = resolve; });
    function emit(name, value) {
        (listeners[name] || []).slice().forEach(function (fn) { try { fn(value); } catch (error) { console.error(error); } });
    }
    function vars() {
        try { return typeof window.getVariables === "function" ? window.getVariables({ type: "message", message_id: "latest" }) || {} : {}; }
        catch (_) { return {}; }
    }
    function check() {
        scheduled = false;
        var value = vars(), json = JSON.stringify(value);
        if (json === lastVars) return;
        lastVars = json;
        emit("vars", value);
    }
    function schedule() { if (!scheduled) { scheduled = true; setTimeout(check, 0); } }
    function applyHost(next) {
        var previousTurn = host.turn;
        host = Object.assign({}, host, next || {});
        document.documentElement.setAttribute("data-scheme", host.scheme === "dark" ? "dark" : "light");
        document.documentElement.setAttribute("data-stage-region", region);
        document.documentElement.toggleAttribute("data-busy", Boolean(host.busy));
        emit("host", host);
        if (next && next.layout) emit("layout", host.layout);
        if (next && next.turn !== undefined && next.turn !== previousTurn) emit("turn", host.turn);
        schedule();
    }
    addEventListener("message", function (event) {
        var data = event && event.data;
        if (event.source !== parent || !data || typeof data.type !== "string") return;
        if (data.type === "dsh-card-stage-host") { applyHost(data.host); return; }
        if (data.type.indexOf("dsh-tavern-helper") === 0) schedule();
    });
    function pathGet(source, path, fallback) {
        var parts = Array.isArray(path) ? path : String(path || "").split(/[./]/).filter(Boolean);
        var value = source;
        for (var i = 0; i < parts.length; i += 1) {
            if (value === null || value === undefined) return fallback;
            value = value[parts[i]];
        }
        return value === undefined ? fallback : value;
    }
    window.dshStage = Object.freeze({
        version: 1,
        region: region,
        get host() { return host; },
        ready: ready,
        vars: vars,
        stat: function () { var value = vars(); return value && value.stat_data || {}; },
        get: function (path, fallback) { return pathGet(this.stat(), path, fallback); },
        on: function (name, fn) {
            if (typeof fn !== "function") throw new TypeError("dshStage.on 需要函数");
            (listeners[name] || (listeners[name] = [])).push(fn);
            if (name === "vars" && lastVars) fn(JSON.parse(lastVars));
            if (name === "host") fn(host);
            return function () { listeners[name] = (listeners[name] || []).filter(function (item) { return item !== fn; }); };
        },
        // Reading column in this frame's coordinates; place visuals outside it.
        safeArea: function () {
            var layout = host.layout || {}, w = layout.width || innerWidth, h = layout.height || innerHeight;
            var c = layout.column || { left: w * 0.25, right: w * 0.75, top: 0, bottom: h };
            return { width: w, height: h, column: c, left: { x: 0, width: Math.max(0, c.left) }, right: { x: c.right, width: Math.max(0, w - c.right) } };
        },
        kit: function () { return import(base + "stage-kit/index.js"); },
        url: function (path) { return base + String(path || "").replace(/^\/+/, ""); },
        lib: function (name) { return import(base + (aliases[name] || String(name).replace(/^\/+/, ""))); },
        messages: function () {
            try { return typeof window.getChatMessages === "function" ? window.getChatMessages("0-{{lastMessageId}}") : []; }
            catch (_) { return []; }
        },
        send: function (text) {
            if (region !== "takeover") return Promise.reject(new Error("只有接管模式可以发送行动"));
            var value = String(text || "").trim();
            if (!value) return Promise.reject(new Error("行动为空"));
            if (typeof window.triggerSlash !== "function") return Promise.reject(new Error("当前舞台无法发送"));
            return window.triggerSlash("/send " + value.replace(/\|/g, "｜") + "|/trigger");
        }
    });
    applyHost(initialHost);
    Promise.resolve(window.__dshTavernHelperReady).catch(function () {}).then(function () { check(); readyResolve(true); });
}

function buildCardStageContent(stage, region, host) {
    const reset = "<style data-dsh-card-stage>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent;white-space:normal}body{font-family:system-ui,-apple-system,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif}</style>";
    // Markup tagged data-region="hud" etc. only renders in that region (the kit also removes it).
    const regionStyle = (region === "hud" ? "<style>html,body{height:auto;overflow:visible}</style>" : "")
        + "<style>[data-region]:not([data-region~=\"" + region + "\"]){display:none!important}</style>";
    // Theme values were validated server-side (colors / font stacks only).
    const vars = stage.theme && stage.theme.vars || {};
    const theme = Object.keys(vars).length ? "<style data-dsh-card-stage-theme>:root{" + Object.entries(vars).map(([name, value]) => name + ":" + value).join(";").replace(/</g, "") + "}</style>" : "";
    const sdk = "<script data-dsh-card-stage-sdk>(" + installCardStageSdk.toString() + ")(" + JSON.stringify(region) + "," + JSON.stringify(host).replace(/</g, "\\u003c") + ");<\/script>";
    const html = String(stage.html || "");
    // Declarative stages (<stage-*> tags) get the shared component kit automatically.
    const kit = /<stage-[a-z]/i.test(html) ? "<script type=\"module\" data-dsh-stage-kit>import(new URL(\"/api/dsh-tavern/vendor/runtime-assets/stage-kit/index.js\",document.baseURI).href).catch(function(e){console.error(e)});<\/script>" : "";
    return reset + regionStyle + theme + sdk + kit + html;
}

// Mount one stage region as plain DOM driven by the shared frame lifecycle.
function mountCardStageRegion(container, initialProps) {
    const lifecycle = createTavernMessageFrameLifecycle(initialProps);
    const frames = new Map();
    let onHeight = null;
    function render(state) {
        const docs = [state.visibleDocument, state.pendingDocument].filter(Boolean);
        for (const [token, entry] of frames) {
            if (docs.some(doc => doc.token === token)) continue;
            entry.doc.ref(null);
            entry.node.remove();
            frames.delete(token);
        }
        for (const doc of docs) {
            let entry = frames.get(doc.token);
            if (!entry) {
                const node = container.ownerDocument.createElement("iframe");
                node.className = "dsh-card-stage-frame";
                node.title = "人物卡舞台";
                if (!doc.trustedCardMode) node.setAttribute("sandbox", "allow-scripts");
                node.setAttribute("referrerpolicy", "no-referrer");
                node.setAttribute("allow", "autoplay");
                node.srcdoc = doc.html;
                container.appendChild(node);
                doc.ref(node);
                entry = { node, doc };
                frames.set(doc.token, entry);
            }
            entry.node.classList.toggle("pending", doc !== state.visibleDocument);
        }
        if (onHeight) onHeight(state.height);
    }
    const stop = lifecycle.start(render);
    render(lifecycle.snapshot());
    return {
        update(props) { lifecycle.update(props); },
        onHeight(fn) { onHeight = fn; },
        post(message) {
            for (const entry of frames.values()) {
                if (entry.node.contentWindow) entry.node.contentWindow.postMessage(message, "*");
            }
        },
        dispose() {
            stop();
            for (const entry of frames.values()) { entry.doc.ref(null); entry.node.remove(); }
            frames.clear();
        }
    };
}

// Where the story sits inside the stage box, so stages can use the margins.
function measureCardStageLayout(box) {
    const outer = box.getBoundingClientRect();
    const column = box.querySelector('[data-slot="conversation.view"] [class*="_column"]');
    const composer = box.querySelector('[data-slot="conversation.composer"] [data-composer-card]');
    const header = box.querySelector('[data-slot="conversation.session.header"]');
    const c = column ? column.getBoundingClientRect() : null;
    const top = header ? Math.max(0, header.getBoundingClientRect().bottom - outer.top) : 0;
    const bottom = composer ? Math.min(outer.height, composer.getBoundingClientRect().top - outer.top) : outer.height;
    return {
        width: Math.round(outer.width), height: Math.round(outer.height),
        column: c ? { left: Math.round(c.left - outer.left), right: Math.round(c.right - outer.left), top: Math.round(top), bottom: Math.round(bottom) }
            : { left: Math.round(outer.width * 0.2), right: Math.round(outer.width * 0.8), top: Math.round(top), bottom: Math.round(bottom) }
    };
}

function cardStageHostState(view, layout) {
    const dark = document.body && document.body.hasAttribute("data-ds-dark-theme");
    const reducedMotion = Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    return {
        scheme: dark ? "dark" : "light",
        reducedMotion,
        visible: document.visibilityState !== "hidden",
        busy: Boolean(view && view.activity && view.activity.busy),
        turn: Math.max(0, Number(view && view.latestAssistantTurn) || 0),
        playerName: String(view && view.playerName || ""),
        layout: layout || null
    };
}

function cardStageFrameProps(region, content, sessionId, view, executeSlash) {
    return {
        content,
        sessionId,
        turn: Math.max(1, Number(view.latestAssistantTurn) || 1),
        partIndex: 0,
        panelId: "card-stage-" + region,
        helperContext: view.tavernHelper,
        trustedCardMode: false,
        eager: true,
        persistent: true,
        preserveInstance: true,
        followContentFont: false,
        observeMvuView: false,
        runtimeReporting: false,
        leanRuntime: true,
        executeSlash
    };
}

// Imperative mount into the conversation root (the host exposes no react-dom
// portal). Regions: backdrop (behind the story, no pointer events), hud
// (floating, interactive), takeover (covers the play area).
function createCardStageMount(root, options) {
    const doc = root.ownerDocument;
    const container = doc.createElement("div");
    container.className = "dsh-card-stage";
    container.setAttribute("data-mode", options.stage.mode);
    root.insertBefore(container, root.firstChild);
    let view = options.view;
    let layout = measureCardStageLayout(root);
    const hudFits = () => layout.width >= options.stage.hudWidth + 640;
    let hudUserToggled = false;
    const regions = options.stage.regions.map(function (region) {
        const wrap = doc.createElement("div");
        wrap.className = region === "hud" ? "dsh-card-stage-hud" : (region === "takeover" ? "dsh-card-stage-takeover" : "dsh-card-stage-layer");
        wrap.setAttribute("data-region", region);
        const slot = doc.createElement("div");
        slot.className = "dsh-card-stage-region";
        slot.setAttribute("data-region", region);
        if (region === "hud") {
            const toggle = doc.createElement("button");
            toggle.type = "button";
            toggle.className = "dsh-card-stage-hud-toggle";
            const sync = () => {
                const open = !wrap.classList.contains("collapsed");
                toggle.textContent = open ? "−" : "≡";
                toggle.title = open ? "收起卡片面板" : "展开卡片面板";
                toggle.setAttribute("aria-expanded", String(open));
            };
            toggle.addEventListener("click", () => { hudUserToggled = true; wrap.classList.toggle("collapsed"); sync(); });
            wrap.__syncHud = () => {
                // Narrow play area: the HUD starts as a chip and opens as an overlay.
                wrap.classList.toggle("compact", !hudFits());
                if (!hudUserToggled) wrap.classList.toggle("collapsed", !hudFits());
                sync();
            };
            wrap.__syncHud();
            wrap.appendChild(toggle);
            slot.style.width = options.stage.hudWidth + "px";
            slot.style.maxWidth = "calc(100vw - 32px)";
        }
        wrap.appendChild(slot);
        if (region === "takeover") {
            const exit = doc.createElement("button");
            exit.type = "button";
            exit.className = "dsh-card-stage-exit";
            exit.textContent = "文字模式";
            exit.title = "关闭卡片舞台，回到文字界面";
            exit.addEventListener("click", () => options.onDisable());
            wrap.appendChild(exit);
        }
        container.appendChild(wrap);
        const content = buildCardStageContent(options.stage, region, cardStageHostState(view, layout));
        const controller = mountCardStageRegion(slot, cardStageFrameProps(region, content, options.sessionId, view, options.executeSlash));
        if (region === "hud") controller.onHeight(value => { slot.style.height = Math.max(0, Number(value) || 0) + "px"; });
        return { region, content, controller, wrap };
    });
    let lastHost = "";
    function pushHost(force) {
        const state = cardStageHostState(view, layout);
        const key = JSON.stringify(state);
        if (!force && key === lastHost) return;
        lastHost = key;
        regions.forEach(entry => entry.controller.post({ type: "dsh-card-stage-host", host: state }));
    }
    const pushNow = () => pushHost(true);
    doc.addEventListener("visibilitychange", pushNow);
    const themeObserver = new MutationObserver(pushNow);
    themeObserver.observe(doc.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
    let layoutFrame = 0;
    function relayout() {
        if (layoutFrame) return;
        layoutFrame = doc.defaultView.requestAnimationFrame(function () {
            layoutFrame = 0;
            layout = measureCardStageLayout(root);
            regions.forEach(entry => entry.wrap.__syncHud && entry.wrap.__syncHud());
            pushHost(false);
        });
    }
    const resizeObserver = new ResizeObserver(relayout);
    resizeObserver.observe(root);
    const column = root.querySelector('[data-slot="conversation.view"] [class*="_column"]');
    if (column) resizeObserver.observe(column);
    return {
        update(nextView) {
            view = nextView;
            relayout();
            regions.forEach(entry => entry.controller.update(cardStageFrameProps(entry.region, entry.content, options.sessionId, view, options.executeSlash)));
            pushHost(false);
        },
        dispose() {
            doc.removeEventListener("visibilitychange", pushNow);
            themeObserver.disconnect();
            resizeObserver.disconnect();
            if (layoutFrame) doc.defaultView.cancelAnimationFrame(layoutFrame);
            regions.forEach(entry => entry.controller.dispose());
            container.remove();
        }
    };
}

// Lives in the conversation dock slot (always mounted for a session) and
// orchestrates the imperative stage mount inside the conversation root.
function CardStageHost(props) {
    const anchor = React.useRef(null);
    const mountRef = React.useRef(null);
    const state = useLiveTavernView(props.sessionId);
    const view = state && state.view;
    const prefs = useCardStagePrefs();
    const stage = view && isPlayMode(view.mode) && view.cardStage && view.cardStage.html && view.tavernHelper ? view.cardStage : null;
    const key = cardStageKey(view);
    const enabled = Boolean(stage) && !prefs[key];
    const revision = enabled ? stage.revision : "";
    React.useLayoutEffect(function () {
        const root = anchor.current && anchor.current.closest('[data-slot="main.conversation"]');
        if (!root || !enabled) return;
        root.setAttribute("data-dsh-card-stage", stage.mode);
        root.setAttribute("data-dsh-card-stage-regions", stage.regions.join(" "));
        const vars = stage.theme && stage.theme.vars || {};
        for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
        if (stage.theme && stage.theme.scheme) root.setAttribute("data-dsh-card-stage-scheme", stage.theme.scheme);
        // main.conversation is display:contents; the positioned box is its first element child.
        const box = Array.from(root.children).find(node => !node.classList.contains("dsh-card-stage")) || root;
        box.classList.add("dsh-card-stage-box");
        const mount = createCardStageMount(box, { stage, view, sessionId: props.sessionId, executeSlash: props.executeSlash, onDisable: () => cardStagePrefs.set(key, true) });
        mountRef.current = mount;
        return function () {
            mount.dispose();
            box.classList.remove("dsh-card-stage-box");
            mountRef.current = null;
            root.removeAttribute("data-dsh-card-stage");
            root.removeAttribute("data-dsh-card-stage-regions");
            root.removeAttribute("data-dsh-card-stage-scheme");
            for (const name of Object.keys(vars)) root.style.removeProperty(name);
        };
    }, [props.sessionId, revision]);
    React.useEffect(function () { if (mountRef.current && view) mountRef.current.update(view); });
    const h = React.createElement;
    return h(React.Fragment, null, h("span", { ref: anchor, hidden: true, "data-dsh-card-stage-anchor": "" }),
        stage && stage.warnings && stage.warnings.length ? h("div", { className: "dsh-tavern-dock-error", role: "status" }, stage.warnings.join(" ")) : null);
}

// Header utility: toggle this card's stage on and off.
function CardStageToggle(props) {
    const state = useLiveTavernView(props.sessionId);
    const view = state && state.view;
    const prefs = useCardStagePrefs();
    const stage = view && isPlayMode(view.mode) && view.cardStage && view.cardStage.html ? view.cardStage : null;
    if (!stage) return null;
    const key = cardStageKey(view);
    const on = !prefs[key];
    return React.createElement("button", { type: "button", className: "dsh-tavern-btn dsh-card-stage-toggle" + (on ? " on" : ""), "aria-pressed": on,
        title: on ? "关闭人物卡舞台" : "开启人物卡舞台", onClick: () => cardStagePrefs.set(key, on) }, "舞台");
}
