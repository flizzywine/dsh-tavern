// Shared presentation state for the director and client. Never rewrites stored records.
function stageLookLayer(look) {
    if (typeof look === "string") look = { id: look };
    look = look || {};
    if (look.layer === "time" || look.layer === "mood") return look.layer;
    const words = [look.id, look.name, look.label].concat(look.tags || []).filter(value => typeof value === "string").join(" ");
    return /(?:^|[^a-z])(auto|day|dusk|night|dark)(?:$|[^a-z])/i.test(words) ? "time" : "mood";
}
function stageLighting(value, looks) {
    const state = { time: "auto", mood: "none" };
    if (value && typeof value === "object") {
        for (const layer of ["time", "mood"]) {
            const id = value[layer];
            const item = looks && looks.find(look => (typeof look === "string" ? look : look.id) === id);
            if (typeof id === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(id) && (id === state[layer] || !looks || item && stageLookLayer(item) === layer)) state[layer] = id;
        }
        return state;
    }
    return stageApplyLight(state, value || "auto", looks);
}
function stageApplyLight(state, value, looks) {
    const next = { ...state };
    if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(value)) return next;
    if (value === "none" || value === "clear") { next.mood = "none"; return next; }
    const item = looks && looks.find(look => (typeof look === "string" ? look : look.id) === value);
    if (value !== "auto" && looks && !item) {
        const layer = stageLookLayer(value);
        next[layer] = layer === "time" ? "auto" : "none";
        return next;
    }
    next[stageLookLayer(item || value)] = value;
    return next;
}
// Retain the duration of the most recent time cue, including when pages are skipped over.
function stageLightingReplay(start, entries, looks) {
    let lighting = stageLighting(start && (start.lighting || start.light), looks), timeFadeMs = 800;
    let timeShiftWithoutScene = 0;
    for (const entry of entries || []) {
        for (const command of entry.commands || []) {
            if (command.op !== "light") continue;
            const next = stageApplyLight(lighting, command.value, looks);
            if (next.time !== lighting.time) {
                const shift = !entry.scene && !(entry.commands || []).some(item => item.op === "trans");
                timeFadeMs = shift ? 2500 : 800;
                if (shift) timeShiftWithoutScene++;
            }
            lighting = next;
        }
    }
    return { lighting, timeFadeMs, timeShiftWithoutScene };
}
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { stageLookLayer, stageLighting, stageApplyLight, stageLightingReplay };
