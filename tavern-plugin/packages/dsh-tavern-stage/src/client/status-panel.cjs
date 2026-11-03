// 状态面板 (stage status panel): the card-supplied panel the stage opens with S or the menu's 「状态」 row.
// The engine gives only the way in and the container; the card's statusPanel.html draws everything inside.
// The html goes through the core's card-HTML frame builder unchanged (the path status bars, regex HTML and message
// frames use): a trusted session (tavernRuntimePolicy.trustedCardMode) gets a same-origin frame with no sandbox
// attribute, an untrusted one sandbox="allow-scripts", as retained-message-frames.js sets it. Nothing more is added.
// Data and close reach a trusted panel through the core's trusted host facade, the way status bars reach parent.Mvu:
// parent.DshStatusPanel (live while the frame is connected, from the first script on) and window.DshStatusPanel
// (once the frame has loaded) are the same object: data() → the current snapshot, onData(fn) → called on every push
// (returns its unsubscribe), close().
// The snapshot is {variables, ledger, figures:[{name, emotion?, avatar}], theme}: the host's bounded projection of the
// card's declared reads and ledger sections (readStatusPanel), the declared figures' faces as data: URLs
// (useFaces, the stage's card-face lookup) and the stage skin tokens (--gal-ui-*). It is read once on open and again,
// coalesced, after each session state signal while the panel is open.
function createStageStatusPanel({React, window, document, rpc, signals, themeTokens, sounds, useFaces, useLiveView, mountCardFrame, installHostFacade}) {
const FACADE = 'DshStatusPanel', FACE_PX = 96;
let disposed = false;
const open = new Set(), faceData = new Map();
const read = (sessionId, withHtml) => rpc('readStatusPanel', {sessionId, withHtml}, sessionId);
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const frameToken = () => 'status-panel:' + Math.random().toString(36).slice(2) + Date.now().toString(36);

// A face URL from the avatar cache (blob:) as a data: URL the panel can keep and an untrusted frame could load.
function faceDataUrl(url) {
    if (/^data:/i.test(url)) return Promise.resolve(url);
    if (!faceData.has(url)) faceData.set(url, window.fetch(url).then(response => response.blob()).then(blob => new Promise((resolve, reject) => {
        const reader = new window.FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    })).catch(error => { faceData.delete(url); throw error; }));
    return faceData.get(url);
}

// One open panel: the frame, its facade and the data feed. host() → the element the frame goes into.
// onState({phase:'loading'|'ready'|'empty'|'error', title, figures, error}) drives the sheet's own chrome.
function openStatusPanel({sessionId, trustedCardMode, host, onClose, onState}) {
    let closed = false, frame = null, releaseFacade = null, stopSignals = null, raw = null, avatars = new Map(), theme = {};
    let inFlight = false, again = false, faceJob = 0;
    const listeners = new Set();
    const snapshot = () => ({
        variables: copy(raw?.data?.variables || {}), ledger: copy(raw?.data?.ledger || {}),
        figures: (raw?.figures || []).map(figure => ({name: figure.name, ...(figure.emotion ? {emotion: figure.emotion} : {}), avatar: avatars.get(figure.name) || null})),
        theme: copy(theme)
    });
    const facade = Object.freeze({
        data: () => snapshot(),
        onData(fn) {
            if (typeof fn !== 'function') throw new TypeError('onData 需要一个函数');
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        close: () => { if (!closed) onClose(); }
    });
    function push() {
        if (closed || !frame) return;
        const value = snapshot();
        for (const fn of [...listeners]) {
            try { fn(value); } catch (error) { window.console?.error?.(error); }
        }
    }
    function state(phase, extra) {
        if (!closed) onState({phase, title: raw?.title || '', figures: raw?.figures || [], ...extra});
    }
    function mount(html) {
        const target = host();
        if (!target) return;
        frame = document.createElement('iframe');
        frame.className = 'fork-gal-status-frame';
        frame.title = raw.title || '状态';
        if (!trustedCardMode) frame.setAttribute('sandbox', 'allow-scripts');
        frame.srcdoc = mountCardFrame({content: html, token: frameToken(), trustedCardMode: trustedCardMode === true});
        theme = themeTokens ? themeTokens(target) || {} : {};
        target.appendChild(frame);
        if (!trustedCardMode) return;
        frame.__dshTavernSessionId = sessionId;
        // The facade owner is the frame element: parent.DshStatusPanel resolves while it is connected, so the card's
        // first script already sees it. Install after the frame is in the document (a detached owner retires).
        releaseFacade = installHostFacade(window, {frameElement: frame, [FACADE]: facade}, 0, [FACADE]);
        frame.addEventListener('load', () => {
            if (closed) return;
            let inner = null;
            try { inner = frame.contentWindow; inner[FACADE] = facade; } catch (_) { return; }
            // Keys typed inside a same-origin panel do not reach the stage: Esc still closes it.
            inner.addEventListener('keydown', event => {
                if (event.key !== 'Escape' || closed) return;
                event.preventDefault();
                sounds?.play?.('close');
                onClose();
            });
        });
    }
    function refresh() {
        if (closed || !raw) return;
        if (inFlight) { again = true; return; }
        inFlight = true;
        Promise.resolve().then(() => read(sessionId, false)).then(next => {
            if (closed || !next) return;
            raw = {...raw, title: next.title || raw.title, figures: next.figures || [], data: next.data || {}};
            push();
        }).catch(() => {}).finally(() => {
            inFlight = false;
            if (again && !closed) { again = false; refresh(); }
        });
    }
    async function load() {
        state('loading');
        try {
            const result = await read(sessionId, true);
            if (closed) return;
            if (!result || typeof result.html !== 'string') { raw = null; state('empty'); return; }
            raw = {title: result.title || '', figures: result.figures || [], data: result.data || {}};
            state('ready');
            mount(result.html);
            stopSignals = signals.subscribe(sessionId, refresh);
        } catch (error) {
            if (!closed) state('error', {error: String(error?.message || error || '读取失败')});
        }
    }
    const panel = {
        facade,
        get frame() { return frame; },
        // faces: Map name → face URL (useFaces). Pushes once the new set is ready, if it changed anything.
        setFaces(faces) {
            if (closed || !raw) return;
            const job = ++faceJob, entries = [...faces].filter(([name, url]) => url && raw.figures.some(figure => figure.name === name));
            Promise.all(entries.map(([name, url]) => faceDataUrl(url).then(data => [name, data], () => null))).then(list => {
                if (closed || job !== faceJob) return;
                const next = new Map(list.filter(Boolean));
                if (next.size === avatars.size && [...next].every(([name, data]) => avatars.get(name) === data)) return;
                avatars = next;
                push();
            });
        },
        retry() { if (!closed && !raw) void load(); },
        dispose() {
            if (closed) return;
            closed = true;
            open.delete(panel);
            listeners.clear();
            const errors = [];
            for (const action of [() => stopSignals?.(), () => releaseFacade?.(), () => frame?.remove()]) {
                try { action(); } catch (error) { errors.push(error); }
            }
            frame = null;
            if (errors.length) throw new AggregateError(errors, 'Stage status panel cleanup failed');
        }
    };
    open.add(panel);
    void load();
    return panel;
}

// The card's panel declaration for a session, or null (no panel, card mode, or not read yet): one probe without html.
function useStatusPanel(sessionId) {
    const [value, setValue] = React.useState(null);
    React.useEffect(() => {
        setValue(null);
        if (disposed || !sessionId) return;
        let active = true;
        Promise.resolve().then(() => read(sessionId, false)).then(result => { if (active && !disposed) setValue(result || null); }, () => {});
        return () => { active = false; };
    }, [sessionId]);
    return value;
}

function Overlay({sessionId, config, source, onClose}) {
    const h = React.createElement, root = React.useRef(null), body = React.useRef(null), panel = React.useRef(null), close = React.useRef(onClose);
    close.current = onClose;
    const live = useLiveView ? useLiveView(sessionId, 'status-panel', [['tavernRuntimePolicy']]) : null;
    const ready = !useLiveView || Boolean(live?.view);
    const trusted = useLiveView ? Boolean(live?.view?.tavernRuntimePolicy?.trustedCardMode) : true;
    const [state, setState] = React.useState({phase: 'loading', title: '', figures: []});
    React.useEffect(() => {
        if (disposed || !ready) return;
        const current = openStatusPanel({sessionId, trustedCardMode: trusted, host: () => body.current, onClose: () => close.current(), onState: setState});
        panel.current = current;
        return () => { if (panel.current === current) panel.current = null; current.dispose(); };
    }, [sessionId, ready, trusted]);
    const names = state.figures.map(figure => figure.name);
    const faces = useFaces ? useFaces({config, sessionId, source, names, px: FACE_PX}) : new Map();
    const facesKey = JSON.stringify([...faces]);
    React.useEffect(() => { if (state.phase === 'ready') panel.current?.setFaces(faces); }, [facesKey, state.phase]);
    React.useEffect(() => {
        const opener = document.activeElement;
        root.current?.focus();
        return () => { if (opener?.isConnected) opener.focus(); };
    }, []);
    React.useEffect(() => {
        const key = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            sounds?.play?.('close');
            close.current();
        };
        window.addEventListener('keydown', key, true);
        return () => window.removeEventListener('keydown', key, true);
    }, []);
    const title = state.title || '状态';
    return h('div', {className: 'fork-gal-status', onClick: event => { event.stopPropagation(); if (event.target === event.currentTarget) close.current(); },
        onWheel: event => event.stopPropagation(), onContextMenu: event => { event.preventDefault(); event.stopPropagation(); close.current(); }},
        h('section', {ref: root, tabIndex: -1, className: 'fork-gal-status-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, 'data-phase': state.phase},
            h('header', {className: 'fork-gal-status-head'},
                h('b', {className: 'fork-gal-status-title'}, title),
                h('button', {type: 'button', className: 'fork-gal-status-close', title: '关闭状态', 'aria-label': '关闭状态', onClick: () => { sounds?.play?.('close'); close.current(); }},
                    h('svg', {viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': true, focusable: 'false'}, h('path', {d: 'M7 7l10 10M17 7L7 17'})))),
            h('div', {ref: body, className: 'fork-gal-status-body'},
                state.phase === 'loading' ? h('p', {className: 'fork-gal-status-note', role: 'status'}, '正在读取状态…') : null,
                state.phase === 'empty' ? h('p', {className: 'fork-gal-status-note'}, '本卡没有状态面板') : null,
                state.phase === 'error' ? h('p', {className: 'fork-gal-status-note', role: 'alert'}, '状态读取失败',
                    h('button', {type: 'button', onClick: () => panel.current?.retry()}, '重试')) : null)));
}

return {useStatusPanel, Overlay, open: openStatusPanel, dispose() {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (const panel of [...open]) {
        try { panel.dispose(); } catch (error) { errors.push(error); }
    }
    faceData.clear();
    if (errors.length) throw new AggregateError(errors, 'Stage status panel cleanup failed');
}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageStatusPanel};
