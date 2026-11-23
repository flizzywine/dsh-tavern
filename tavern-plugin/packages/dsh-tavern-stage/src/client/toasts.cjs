// Stage toasts (浮起提示): a short line that floats up over the stage for a few seconds and goes, like toastr. Card pages
// call it through DshCardPage.toast(text, {type, tag}) (status-panel.cjs); it is drawn on the stage, not in the page, so it
// outlives the page (fillInput closes the page and the line still reads). Where and how it shows is the skin's toast
// field (stage-skin.cjs: place, enter, paint, shape, mark, text; its own drawn plates and marks: art.toast; skin-adapter.cjs
// turns them into --fk-toast-* tokens and data-fk-toast-* marks); without one it rises in the middle of the stage in the skin's panel colours.
//   push(sessionId, {text, type?, tag?}) → {shown: true}: text 1–120 characters; type info (default) | success | warning |
//   error; a toast with the same tag (≤ 40 characters), or the same words and type, is replaced in place and shown anew
//   instead of stacking; at most MAX stand at once (the oldest leaves first).
//   Layer({sessionId}) draws the session's toasts. Each stays for a time read from its length, paused while a pointer moved
//   onto it stays there; a click puts it away.
function createStageToasts({React, window}) {
const MAX = 3, LEAVE_MS = 240, TEXT_MAX = 120, TAG_MAX = 40;
const TYPES = new Set(['info', 'success', 'warning', 'error']);
const sessions = new Map(); // sessionId → {items, listeners}
let next = 0, disposed = false;
const timers = new Set();
const later = (fn, ms) => { const id = window.setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
// reading time: about 7 characters a second over a 2.4 s floor, 3–8 s; a warning or an error stays a second longer.
const lifetime = item => Math.min(8000, Math.max(3000, 2400 + 140 * [...item.text].length)) + (item.type === 'warning' || item.type === 'error' ? 1000 : 0);
function bucket(sessionId) {
    if (!sessions.has(sessionId)) sessions.set(sessionId, {items: [], listeners: new Set()});
    return sessions.get(sessionId);
}
function emit(entry) {
    entry.items = entry.items.slice();
    for (const fn of entry.listeners) fn(entry.items);
}
function leave(sessionId, id) {
    const entry = sessions.get(sessionId), item = entry?.items.find(value => value.id === id);
    if (!item || item.leaving) return;
    entry.items = entry.items.map(value => value === item ? {...item, leaving: true} : value);
    emit(entry);
    later(() => { entry.items = entry.items.filter(value => value.id !== id); emit(entry); }, LEAVE_MS);
}
function push(sessionId, toast) {
    if (disposed) throw new Error('舞台已关闭');
    const text = typeof toast?.text === 'string' ? toast.text.trim() : '';
    if (!text || [...text].length > TEXT_MAX) throw new Error('toast 需要 1–' + TEXT_MAX + ' 字的文字');
    const type = toast.type === undefined ? 'info' : toast.type;
    if (!TYPES.has(type)) throw new Error('toast 的 type 只接受 info、success、warning、error');
    const tag = toast.tag === undefined ? '' : toast.tag;
    if (typeof tag !== 'string' || tag.length > TAG_MAX) throw new Error('toast 的 tag 是最多 ' + TAG_MAX + ' 字的文字');
    const entry = bucket(sessionId), standing = entry.items.filter(item => !item.leaving);
    const same = standing.find(item => tag ? item.tag === tag : !item.tag && item.text === text && item.type === type);
    // shown: a new number each time it is (re)shown, so its timer starts over and it plays its arrival again
    if (same) entry.items = entry.items.map(item => item === same ? {...item, text, type, shown: ++next} : item);
    else {
        entry.items = [...entry.items, {id: ++next, shown: next, text, type, tag}];
        const over = standing.length + 1 - MAX;
        for (const item of standing.slice(0, Math.max(0, over))) later(() => leave(sessionId, item.id), 0);
    }
    emit(entry);
    return {shown: true};
}
function useToasts(sessionId) {
    const [items, setItems] = React.useState(() => sessions.get(sessionId)?.items || []);
    React.useEffect(() => {
        const entry = bucket(sessionId);
        setItems(entry.items);
        entry.listeners.add(setItems);
        return () => entry.listeners.delete(setItems);
    }, [sessionId]);
    return items;
}
// One toast, mounted anew each time it is (re)shown (Layer's key), so it plays its arrival and its time starts over.
function Toast({sessionId, item}) {
    const h = React.createElement, [held, setHeld] = React.useState(false), left = React.useRef(lifetime(item));
    React.useEffect(() => {
        if (held || item.leaving) return;
        const started = Date.now(), id = later(() => leave(sessionId, item.id), left.current);
        return () => { window.clearTimeout(id); timers.delete(id); left.current = Math.max(600, left.current - (Date.now() - started)); };
    }, [held, item.leaving]);
    const alarm = item.type === 'warning' || item.type === 'error';
    return h('div', {className: 'fork-stage-toast', 'data-type': item.type, 'data-leaving': item.leaving ? '' : undefined, role: alarm ? 'alert' : undefined,
        // held by a pointer that moves onto it (one resting where it appears - the button that called it - does not hold it)
        onPointerMove: () => { if (!held) setHeld(true); }, onPointerLeave: () => setHeld(false),
        onClick: event => { event.stopPropagation(); leave(sessionId, item.id); }, onContextMenu: event => event.stopPropagation()},
        h('i', {className: 'fork-stage-toast-mark', 'aria-hidden': true}, alarm ? '⚠' : item.type === 'success' ? '✓' : ''),
        h('span', {className: 'fork-stage-toast-text'}, item.text));
}
function Layer({sessionId}) {
    const h = React.createElement, items = useToasts(sessionId);
    return h('div', {className: 'fork-stage-toasts', role: 'status', 'aria-live': 'polite'},
        items.map(item => h(Toast, {key: item.id + ':' + item.shown, sessionId, item})));
}
return {push, Layer, dispose() {
    disposed = true;
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
    sessions.clear();
}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageToasts};
