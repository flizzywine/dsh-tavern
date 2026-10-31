// the one registry of stage
// entries. Every feature / mod registers its entry here (its button in the top bar); none is forced onto the stage. The top bar
// is the entries' only home in every skin: it hides while reading and reveals on demand (gal-stage.js useGalHudReveal);
// an entry that needs attention (a badge) keeps its own button on screen. Order is the entry's own `priority` (higher first).
// An entry with nothing usable this round (its button renders nothing) is nowhere.
//
// Entry: { id, priority, group: 'scene' (top-left) | 'feature' (top-right), hud (the place / track label line), icon
//   (ICON_PATHS name), label, render(ctx) } - ctx = { sessionId, rpc, place, live, widgets, film, openConfig(tab) }.
// The mounted button reports its state with useStageEntryState(id, { available, on, badge, detail, icon, label }).
const stageEntries = (function () {
    const entries = new Map();
    return Object.freeze({
        register(entry) {
            const value = Object.freeze({ ...entry });
            entries.set(entry.id, value);
            return () => { if (entries.get(entry.id) === value) entries.delete(entry.id); };
        },
        list(group) { return [...entries.values()].filter(entry => !group || entry.group === group).sort(stageEntryOrder); }
    });
})();
function stageEntryOrder(a, b) { return b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }

// Per-stage state reports (the top bar keeps an entry with a badge on screen while it is hidden).
function createStageEntryStore() {
    let states = {};
    const listeners = new Set();
    return {
        get: () => states,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        report(id, state) {
            if (JSON.stringify(states[id] ?? null) === JSON.stringify(state ?? null)) return;
            const next = { ...states };
            if (state) next[id] = state; else delete next[id];
            states = next;
            listeners.forEach(listener => listener());
        }
    };
}
// Created on first use (harnesses load this file without React).
let stageEntryContext = null;
function stageEntryContextType() { return stageEntryContext || (stageEntryContext = React.createContext(null)); }
function useStageEntryState(id, state) {
    const store = React.useContext(stageEntryContextType()), key = JSON.stringify(state);
    React.useEffect(() => { if (store) store.report(id, state); }, [store, id, key]);
    React.useEffect(() => () => { if (store) store.report(id, null); }, [store, id]);
}

// 电影模式 is an action - one top-bar entry, not a CONFIG preference.
stageEntries.register({ id: "film", priority: 30, group: "feature", icon: "film-mode", label: "电影模式",
    render: ctx => React.createElement(StageFilmEntry, { film: ctx.film }) });
function StageFilmEntry({ film }) {
    useStageEntryState("film", { available: true, on: film });
    return React.createElement("button", { type: "button", className: "fork-gal-film", "aria-pressed": film, title: "电影模式",
        "aria-label": film ? "电影模式（已开启，点击关闭）" : "电影模式（点击开启）",
        onClick: event => { event.stopPropagation(); stageFilm.set(!film); event.currentTarget.blur(); } }, React.createElement(Icon, { name: "film-mode", size: 16 }));
}

if (typeof module !== "undefined" && typeof window === "undefined" && module.exports) module.exports = { stageEntries, stageEntryOrder, createStageEntryStore };
