// Opt-in, template-local sizing. An absent/invalid declaration stays on the
// legacy path, including its viewport heuristics and cached initial height.
function tavernFrameSizingDeclaration(content) {
    if (!String(content || "").includes("dsh-tavern-frame")) return null;
    const markup = String(content || "").replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
    for (const tag of markup.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) || []) {
        const attrs = Object.create(null);
        for (const match of tag.matchAll(/([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
            const key = match[1].toLowerCase();
            if (!(key in attrs)) attrs[key] = match[2] ?? match[3] ?? match[4];
        }
        if (attrs.name !== "dsh-tavern-frame") continue;
        return attrs;
    }
    return null;
}

function tavernFrameSizing(content, settings, panelId) {
    const attrs = tavernFrameSizingDeclaration(content);
    if (attrs?.content) {
        const value = { mode: attrs.content };
        for (const [attribute, key] of [["data-height", "height"], ["data-min-height", "minHeight"], ["data-max-height", "maxHeight"], ["data-aspect-ratio", "aspectRatio"]]) {
            if (attrs[attribute] === undefined) continue;
            if (!/^\d+(?:\.\d+)?$/.test(attrs[attribute])) return null;
            value[key] = Number(attrs[attribute]);
        }
        const config = normalizeFrameSizing(value);
        return config ? Object.assign(config, { source: "template" }) : null;
    }
    const card = normalizeCardFrameSizing(settings);
    const id = attrs?.["data-panel-id"] || panelId;
    const panel = card?.panels[id];
    const config = panel || card?.default;
    return config ? Object.assign({}, config, { source: panel ? "panel" : "card" }) : null;
}

function tavernFrameSizingHeight(config, width, available, measured) {
    const target = config.mode === "content" ? measured : config.mode === "viewport" ? available
        : config.height || width / config.aspectRatio;
    const limit = config.mode === "content" ? config.maxHeight : Math.min(config.maxHeight, available);
    return Math.max(48, Math.round(Math.min(limit, Math.max(config.minHeight, target || 48))));
}

// Size against a scroll viewport, not the frame's top or its content height:
// scrolling a message must not shrink its application or create a feedback loop.
function observeTavernFrameSizing(host, frame, config, change) {
    let stopped = false, queued = null, ancestors = [], observer;
    function update() {
        queued = null;
        if (stopped || !frame.isConnected || !frame.getClientRects().length) return;
        const viewport = host.visualViewport;
        let top = viewport?.offsetTop || 0, bottom = top + (viewport?.height || host.innerHeight);
        const next = [];
        for (let node = frame.parentElement; node && node !== host.document.body; node = node.parentElement) {
            next.push(node);
            const style = host.getComputedStyle(node);
            // Scroll containers define the viewport even when content currently
            // fits; using scrollHeight here would oscillate at the fit boundary.
            // Plain clipping wrappers are not available-height contracts.
            if (!/(auto|scroll)/.test(style.overflowY) && !node.hasAttribute("data-dsh-tavern-frame-viewport")) continue;
            const rect = node.getBoundingClientRect();
            top = Math.max(top, rect.top + node.clientTop + (parseFloat(style.paddingTop) || 0));
            bottom = Math.min(bottom, rect.top + node.clientTop + node.clientHeight - (parseFloat(style.paddingBottom) || 0));
        }
        if (observer && (next.length !== ancestors.length || next.some((node, index) => node !== ancestors[index]))) {
            observer.disconnect(); observer.observe(frame);
            next.forEach(node => observer.observe(node)); ancestors = next;
        }
        const width = frame.getBoundingClientRect().width;
        const available = Math.max(48, bottom - top);
        change({ width, available, height: tavernFrameSizingHeight(config, width, available, frame.clientHeight), reason: "container" });
    }
    function schedule() { if (!stopped && queued === null) queued = host.requestAnimationFrame(update); }
    if (typeof host.ResizeObserver === "function") { observer = new host.ResizeObserver(schedule); observer.observe(frame); }
    host.addEventListener("resize", schedule);
    host.addEventListener("scroll", schedule, true);
    host.visualViewport?.addEventListener("resize", schedule);
    host.visualViewport?.addEventListener("scroll", schedule);
    frame.addEventListener("load", schedule);
    schedule();
    return { schedule, stop() {
        stopped = true;
        if (queued !== null) host.cancelAnimationFrame(queued);
        observer?.disconnect();
        host.removeEventListener("resize", schedule);
        host.removeEventListener("scroll", schedule, true);
        host.visualViewport?.removeEventListener("resize", schedule);
        host.visualViewport?.removeEventListener("scroll", schedule);
        frame.removeEventListener("load", schedule);
    } };
}

// Runs inside the iframe, including opaque-origin sandboxed cards.
function installTavernFrameSizing(token, config) {
    window.__dshTavernFrameLayout = function () {
        return { mode: config?.mode || "legacy", source: config?.source || "legacy",
            phase: document.readyState, width: innerWidth, height: innerHeight, minHeight: config?.minHeight || 48,
            maxHeight: config?.maxHeight || 32000,
            roots: [document.documentElement, document.body, document.getElementById("app")].filter(Boolean).map(node => {
                const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
                return { tag: node.tagName, id: node.id, width: rect.width, height: rect.height,
                    clientHeight: node.clientHeight, scrollHeight: node.scrollHeight,
                    position: style.position, overflowY: style.overflowY, cssHeight: style.height, minHeight: style.minHeight };
            }) };
    };
    if (!config) return;
    addEventListener("message", event => {
        const data = event.data;
        if (event.source !== parent || data?.token !== token || data.type !== "dsh-tavern-frame-layout") return;
        if (config.mode === "content") document.documentElement.toggleAttribute("data-dsh-tavern-sizing-scroll", data.scroll === true);
    });
}
