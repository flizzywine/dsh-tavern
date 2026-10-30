// card/session-scoped storage capabilities and acknowledged persistence.
// The frame owner alone registers windows; widgets never receive a capability.
const forkFrameStorage = (function () {
    let values = Object.create(null), loaded = false, loading = null;
    let timer = null, flight = null, active = false;
    const pending = [], grants = new Map();
    const bytes = value => new TextEncoder().encode(value).length;
    function apply(target, op) {
        if (op.op === "clear") Object.keys(target).forEach(key => { if (key.startsWith(op.namespace)) delete target[key]; });
        else if (op.op === "remove") delete target[op.key];
        else target[op.key] = op.value;
    }
    function load() {
        if (loaded || loading || typeof rpc !== "function") return loading;
        loading = Promise.resolve().then(() => rpc("getFrameStorage")).then(function (result) {
            const stored = result && result.values && typeof result.values === "object" ? result.values : {};
            values = Object.assign(Object.create(null), stored, values);
            pending.forEach(op => apply(values, op));
            loaded = true;
        }).catch(function () { loading = null; });
        return loading;
    }
    function schedule(delay) {
        if (active && timer === null) timer = window.setTimeout(flush, delay);
    }
    function flush() {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        if (flight) return flight;
        if (!pending.length) return Promise.resolve(true);
        flight = (async function () {
            if (!loaded) await load();
            if (!loaded) throw new Error("Frame storage initial load failed");
            // One request at a time: an older response can never acknowledge newer ops.
            while (pending.length) {
                const ops = pending.slice(0, 500);
                const result = await rpc("updateFrameStorage", { ops: ops });
                if (!result || result.ok !== true || result.applied !== ops.length) throw new Error("Frame storage batch not acknowledged");
                pending.splice(0, ops.length);
            }
            return true;
        })().catch(function () {
            console.warn("dsh-tavern: card storage save failed; pending writes retained for retry");
            return false;
        }).finally(function () { flight = null; if (pending.length) schedule(1000); });
        return flight;
    }
    function queue(op) {
        // Coalesce consecutive same-kind writes only, never across set/remove/clear
        // barriers or a batch whose acknowledgement is still outstanding.
        const last = pending[pending.length - 1];
        if (!flight && last && op.op !== "clear" && last.op === op.op && last.key === op.key) pending[pending.length - 1] = op;
        else pending.push(op);
        apply(values, op);
        schedule(300);
    }
    function snapshot(namespace) {
        const out = Object.create(null);
        if (namespace) Object.keys(values).forEach(key => { if (key.startsWith(namespace)) out[key.slice(namespace.length)] = values[key]; });
        return out;
    }
    function capability(scope, host) {
        host = host || window;
        if (!scope || !scope.sessionId || !host.crypto || typeof host.crypto.getRandomValues !== "function") return null;
        const namespace = "dsh-card:" + encodeURIComponent(JSON.stringify([String(scope.cardPath || ""), String(scope.sessionId)])) + ":";
        if (bytes(namespace) > 3072) return null;
        const token = Array.from(host.crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join("");
        return { token: token, namespace: namespace, seed: snapshot(namespace) };
    }
    function register(frame, capability) {
        if (!frame || !frame.contentWindow || !capability) return function () {};
        const source = frame.contentWindow;
        const grant = { token: capability.token, namespace: capability.namespace, count: 0, size: 0, since: Date.now(), rejected: false, revoke: null };
        let loads = 0, observer = null;
        function revoke() {
            if (grants.get(source) === grant) grants.delete(source);
            frame.removeEventListener("load", onLoad);
            if (observer) observer.disconnect();
        }
        function onLoad() { if (++loads > 1) revoke(); }
        grant.revoke = revoke;
        if (grants.has(source)) grants.get(source).revoke();
        grants.set(source, grant);
        frame.addEventListener("load", onLoad);
        Promise.resolve(load()).then(function () {
            if (grants.get(source) === grant && typeof source.postMessage === "function") source.postMessage({ type: "dsh-tavern-frame-storage-seed", token: grant.token, values: snapshot(grant.namespace) }, "*");
        }).catch(function () {});
        if (typeof window.MutationObserver === "function") {
            observer = new window.MutationObserver(revoke);
            observer.observe(frame, { attributes: true, attributeFilter: ["src", "srcdoc"] });
        }
        return revoke;
    }
    function receive(event) {
        const data = event && event.data, grant = event && grants.get(event.source);
        if (!grant || !data || data.type !== "dsh-tavern-frame-storage" || typeof data.token !== "string" || data.token !== grant.token) return false;
        if (data.op === "revoke") { grant.revoke(); return true; }
        if (Date.now() - grant.since >= 1000) { grant.since = Date.now(); grant.count = 0; grant.size = 0; grant.rejected = false; }
        function reject() {
            if (!grant.rejected) {
                grant.rejected = true;
                console.warn("dsh-tavern: card storage operation rejected (scope, size or rate limit)");
            }
            return false;
        }
        if (!["set", "remove", "clear"].includes(data.op)) return reject();
        if (data.namespace !== grant.namespace) return reject();
        if (data.op !== "clear" && (typeof data.key !== "string" || !data.key.startsWith(grant.namespace) || bytes(data.key.slice(grant.namespace.length)) > 512)) return reject();
        if (data.op === "set" && (typeof data.value !== "string" || bytes(data.value) > 256 * 1024)) return reject();
        const size = bytes(data.key || "") + bytes(data.value || "");
        if (grant.count >= 2048 || grant.size + size > 2 * 1024 * 1024) return reject();
        grant.count++; grant.size += size;
        queue(data.op === "clear" ? { op: "clear", namespace: grant.namespace } : data.op === "set" ? { op: "set", key: data.key, value: data.value } : { op: "remove", key: data.key });
        for (const [source, peer] of grants) {
            if (peer.namespace !== grant.namespace || source === event.source || typeof source.postMessage !== "function") continue;
            try { source.postMessage({ type: "dsh-tavern-frame-storage-update", token: peer.token, op: data.op, key: data.op === "clear" ? "" : data.key.slice(grant.namespace.length), value: data.value }, "*"); } catch (_) {}
        }
        return true;
    }
    function start() { active = true; if (pending.length) schedule(300); }
    function stop() {
        active = false;
        for (const grant of grants.values()) grant.revoke();
        return flush();
    }
    // host-only preferences are outside every frame storage grant.
    function zoomKey(cardPath) { return "dsh-card-zoom:" + encodeURIComponent(cardPath); }
    function readZoom(cardPath) { return Number(values[zoomKey(cardPath)]) || 1; }
    function writeZoom(cardPath, value) { queue({ op: "set", key: zoomKey(cardPath), value: String(value) }); }
    // one-time hints the host has shown (「已看过」), kept like the card zoom so they
    // survive restarts and port changes (the page origin's localStorage does not). Read only after `load()` settled.
    function seenKey(name) { return "dsh-ui-seen:" + encodeURIComponent(name); }
    function seen(name) { return values[seenKey(name)] === "1"; }
    function markSeen(name) { if (!seen(name)) queue({ op: "set", key: seenKey(name), value: "1" }); }
    return { load, flush, snapshot, capability, register, receive, start, stop, readZoom, writeZoom, zoomLoaded: () => loaded, loaded: () => loaded, seen, markSeen };
})();

function frameStorageSeedJson(capability) {
    return JSON.stringify(capability || null).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

// Runs inside both trusted and opaque card frames; there is no ambient parent API.
function installFrameStorage(capability) {
    var values = Object.assign(Object.create(null), capability && capability.seed || {});
    var prefix = capability && capability.namespace || "", dirty = new Set(), cleared = false;
    function sync(op, key, value) {
        if (!capability) return;
        window.parent.postMessage({ type: "dsh-tavern-frame-storage", token: capability.token, namespace: prefix, op: op, key: prefix + (key || ""), value: value }, "*");
    }
    var storage = {
        getItem: function (key) { key = String(key); return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
        setItem: function (key, value) {
            key = String(key); value = String(value);
            if (new TextEncoder().encode(key).length > 512 || new TextEncoder().encode(value).length > 256 * 1024) throw new Error("QuotaExceededError: card storage item too large");
            dirty.add(key); values[key] = value; sync("set", key, value);
        },
        removeItem: function (key) { key = String(key); dirty.add(key); delete values[key]; sync("remove", key); },
        clear: function () { cleared = true; values = Object.create(null); sync("clear"); },
        key: function (index) { var keys = Object.keys(values); return keys[Number(index)] === undefined ? null : keys[Number(index)]; }
    };
    Object.defineProperty(storage, "length", { enumerable: true, get: function () { return Object.keys(values).length; } });
    try { Object.defineProperty(window, "localStorage", { configurable: true, enumerable: true, value: storage }); } catch (e) {}
    if (typeof window.addEventListener === "function") {
        window.addEventListener("message", function (event) {
            var data = event.data;
            if (event.source !== window.parent || !capability || !data || data.token !== capability.token) return;
            if (data.type === "dsh-tavern-frame-storage-update") {
                if (data.op === "clear") { cleared = true; values = Object.create(null); }
                else { dirty.add(data.key); if (data.op === "remove") delete values[data.key]; else if (data.op === "set") values[data.key] = data.value; }
                return;
            }
            if (data.type !== "dsh-tavern-frame-storage-seed" || cleared) return;
            Object.keys(data.values || {}).forEach(function (key) { if (!dirty.has(key)) values[key] = data.values[key]; });
        });
        window.addEventListener("pagehide", function () { sync("revoke"); }, { once: true });
    }
}

function installFrameStorageBridge(host) {
    if (!host || host.__dshForkFrameStorage || typeof host.addEventListener !== "function" || typeof host.setTimeout !== "function") return;
    const marker = {};
    host.__dshForkFrameStorage = marker;
    forkFrameStorage.start();
    host.addEventListener("message", forkFrameStorage.receive);
    host.addEventListener("pagehide", forkFrameStorage.flush);
    const timer = host.setTimeout(function () { forkFrameStorage.load(); }, 0);
    let disposed = false;
    return function () {
        if (disposed) return;
        disposed = true;
        host.clearTimeout(timer);
        host.removeEventListener("message", forkFrameStorage.receive);
        host.removeEventListener("pagehide", forkFrameStorage.flush);
        if (host.__dshForkFrameStorage === marker) delete host.__dshForkFrameStorage;
        return forkFrameStorage.stop();
    };
}
