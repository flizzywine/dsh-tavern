// Browser resources share one inactivity deadline per conversation. Navigation
// starts the clock; model/settlement work blocks expiry but does not reset it.
function createTavernSessionRetention(options) {
    const host = options.window;
    const now = options.now || Date.now;
    const duration = options.durationMs === undefined ? 10 * 60 * 1000 : options.durationMs;
    // Every held session keeps one iframe plus its blob URLs alive. A phone that walks
    // through the chat history cannot be allowed to accumulate them, so background
    // sessions beyond this cap are released oldest-first instead of at the deadline.
    const deviceMemory = Number(host && host.navigator && host.navigator.deviceMemory) || 0;
    const defaultRetained = deviceMemory > 0 && deviceMemory <= 4 ? 3 : 4;
    const maxRetained = options.maxRetained === undefined ? defaultRetained : Math.max(0, Math.floor(Number(options.maxRetained) || 0));
    const records = new Map(), leaveListeners = new Set(), selectListeners = new Set();
    let selected = "", managed = false;
    function record(id) {
        if (!records.has(id)) records.set(id, { id: id, resources: new Map(), mounts: 0, busy: false, leftAt: now(), timer: null });
        return records.get(id);
    }
    function busy(item) { return typeof item.busy === "function" ? item.busy() : item.busy; }
    function active(item) { return managed ? selected === item.id : item.mounts > 0; }
    function cancel(item) {
        if (item.timer !== null) host.clearTimeout(item.timer);
        item.timer = null;
    }
    function release(id) {
        const item = records.get(id);
        if (!item) return;
        records.delete(id); cancel(item);
        for (const dispose of item.resources.values()) dispose();
        item.resources.clear();
    }
    // Only background sessions are candidates: anything mounted or selected is in use.
    // Busy sessions are working (generation/settlement) and keep their resources too.
    function enforceLimit() {
        if (!maxRetained) return;
        const idle = [];
        for (const item of records.values()) if (!active(item) && !busy(item)) idle.push(item);
        if (idle.length <= maxRetained) return;
        idle.sort((left, right) => left.leftAt - right.leftAt);
        for (let index = 0; index < idle.length - maxRetained; index += 1) release(idle[index].id);
    }
    function schedule(item) {
        cancel(item);
        if (active(item) || busy(item) || !item.resources.size) return;
        const remaining = Math.max(0, duration - (now() - item.leftAt));
        item.timer = host.setTimeout(function () {
            item.timer = null;
            if (records.get(item.id) !== item || active(item) || busy(item)) return;
            if (now() - item.leftAt < duration) { schedule(item); return; }
            release(item.id);
        }, remaining);
    }
    return {
        isSelected: id => !managed || selected === id,
        hold: function (id, key, dispose) {
            const item = record(id);
            item.resources.set(key, dispose); schedule(item);
            return function () {
                if (records.get(id) !== item || item.resources.get(key) !== dispose) return;
                item.resources.delete(key);
                if (!item.resources.size) { cancel(item); records.delete(id); }
            };
        },
        mount: function (id) {
            const item = record(id);
            item.mounts++; cancel(item);
            return function () {
                if (records.get(id) !== item) return;
                item.mounts--;
                if (!managed && item.mounts === 0) item.leftAt = now();
                schedule(item);
                enforceLimit();
            };
        },
        select: function (id) {
            if (managed && selected === id) return;
            const previous = selected;
            selected = id; managed = true;
            for (const item of records.values()) {
                if (item.id === previous || item.id === selected) item.leftAt = now();
                schedule(item);
            }
            if (previous) for (const listener of Array.from(leaveListeners)) listener(previous);
            for (const listener of Array.from(selectListeners)) listener(id);
            enforceLimit();
        },
        onSelect: function (listener) { selectListeners.add(listener); return () => selectListeners.delete(listener); },
        onLeave: function (listener) { leaveListeners.add(listener); return function () { leaveListeners.delete(listener); }; },
        busy: function (id, value) { const item = records.get(id); if (item) { item.busy = value; schedule(item); } },
        release: release,
        clear: function () { for (const id of Array.from(records.keys())) release(id); },
        inspect: function () { return Array.from(records.values()).map(item => ({ sessionId: item.id, active: active(item), busy: Boolean(busy(item)), resources: item.resources.size })); }
    };
}
