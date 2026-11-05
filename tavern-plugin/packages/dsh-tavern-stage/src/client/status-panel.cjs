// 卡片页面 (stage card pages): the card's extensions.dsh_tavern.pages, opened over the stage by a shortcut letter, a menu
// row or a showOn event (the old status panel is the page with id 'status'). The engine gives only the way in, the
// sheet and one small facade; the page's html draws everything inside.
// Each page frame is the core's message-frame lifecycle (createCardFrame → createTavernMessageFrameLifecycle): the same
// document, Helper and trust model as text-mode card HTML. A trusted session (tavernRuntimePolicy.trustedCardMode) gets
// a same-origin frame with no sandbox attribute, an untrusted one sandbox="allow-scripts"; the Helper context is the
// live view's tavernHelper, so send, generate, triggerSlash, variables, MVU and worldbook work as in a message.
// The stage adds only window.DshCardPage (a short prelude talking to this host by postMessage; a message counts only
// when its source is one of this page's iframe windows):
//   page; data() → {ledger, figures:[{name, emotion?, avatar}], theme, card:{name}}; onData(fn) → its unsubscribe;
//   close(); open(id) another page; openSettings() the stage's 设置; fillInput(text) fills the stage's 自由输入 (never sends);
//   asset({kind, id, variant?, file?, size?}) → Promise<blob: URL> of a file of the card's own bound packs; assets(kind).
// The data is the page's ledger sections (readCardPage), the declared figures' faces as data: URLs (useFaces) and the
// stage skin tokens (--gal-ui-*). It is read once on open and again, coalesced, after each session state signal.
function createStageStatusPanel({React, window, document, rpc, signals, themeTokens, sounds, useFaces, useLiveView, createCardFrame, packService, fillInput}) {
const FACE_PX = 96;
let disposed = false;
const open = new Set(), faceData = new Map(), readers = new Map();
const readPage = (sessionId, page, withHtml) => rpc('readCardPage', {sessionId, page, withHtml}, sessionId).then(result => result?.page || null);
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const pageToken = () => 'card-page:' + Math.random().toString(36).slice(2) + Date.now().toString(36);
// The frame's turn: the latest assistant turn the Helper context knows (at least 1, as the status views use).
const latestTurn = helper => Math.max(1, ...Object.keys(helper?.turnMessageIds || {}).map(Number).filter(Number.isFinite));

// A face URL from the avatar cache (blob:) as a data: URL the page can keep and an untrusted frame could load.
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

// The page's window.DshCardPage: the same object in a trusted and a sandboxed frame. Blobs arrive by postMessage and
// become the frame's own object URLs (a sandboxed frame cannot load the host's).
function cardPagePrelude(token, page, snapshot, shortcut) {
    const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return '<script data-dsh-card-page>(function(){var token=' + json(token) + ',page=' + json(page) + ',data=' + json(snapshot) + ',next=1,pending=Object.create(null),listeners=new Set(),assets=new Map();'
        + 'function copy(v){return JSON.parse(JSON.stringify(v));}'
        + 'function call(method,args){return new Promise(function(resolve,reject){var id="p"+(next++);pending[id]={resolve:resolve,reject:reject};parent.postMessage({type:"dsh-card-page-call",token:token,requestId:id,method:method,args:args||{}},"*");});}'
        + 'addEventListener("message",function(event){var d=event.data;if(event.source!==parent||!d||d.token!==token)return;'
        + 'if(d.type==="dsh-card-page-data"){data=d.data;listeners.forEach(function(fn){try{fn(copy(data));}catch(error){console.error(error);}});return;}'
        + 'if(d.type!=="dsh-card-page-response")return;var task=pending[d.requestId];if(!task)return;delete pending[d.requestId];if(d.ok)task.resolve(d.result);else task.reject(new Error(String(d.error||"页面请求失败")));});'
        + 'addEventListener("keydown",function(event){if(event.isComposing||event.repeat)return;var own=' + json(shortcut || '') + ';var target=event.target,editing=target&&(target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));if(event.key!=="Escape"&&(!own||event.key.toLowerCase()!==own||editing||event.ctrlKey||event.altKey||event.metaKey))return;event.preventDefault();call("close");});'
        + 'window.DshCardPage=Object.freeze({page:page,data:function(){return copy(data);},onData:function(fn){if(typeof fn!=="function")throw new TypeError("onData 需要一个函数");listeners.add(fn);return function(){listeners.delete(fn);};},'
        + 'close:function(){return call("close");},open:function(id){return call("open",{id:String(id==null?"":id)});},openSettings:function(){return call("settings");},'
        + 'fillInput:function(text){return call("fillInput",{text:String(text==null?"":text)});},assets:function(kind){return call("assets",{kind:String(kind||"")});},'
        + 'asset:function(ref){var key=JSON.stringify(ref||{});if(!assets.has(key)){var task=call("asset",ref||{}).then(function(blob){return URL.createObjectURL(blob);});task.catch(function(){assets.delete(key);});assets.set(key,task);}return assets.get(key);}});})();<\/script>';
}

// A media file of the card's own packs by asset id: {kind, id, variant?} for an image (a background's variant, default
// its default), {kind:'videos', id, file?} for a file of a video bundle (default its entry; 'poster' its poster).
// The stage service locates it in the card's bound packs (locateCardPageAsset); the reader leases and fetches the file.
// One reader per session page for the client's lifetime: the page's preload and its later asset() calls share the blobs.
function assetReader(sessionId, page) {
    const key = sessionId + '\n' + page;
    if (!readers.has(key)) readers.set(key, createAssetReader(sessionId, page));
    return readers.get(key);
}
const refKey = ref => JSON.stringify([ref?.kind, ref?.id, ref?.variant, ref?.file, ref?.size]);
function createAssetReader(sessionId, page) {
    const blobs = new Map();
    const service = () => { const value = packService?.(); if (!value) throw new Error('素材库尚未就绪'); return value; };
    async function locate(ref) {
        if (!ref || typeof ref.kind !== 'string' || typeof ref.id !== 'string') throw new Error('asset 需要 {kind, id}');
        const result = await rpc('locateCardPageAsset', {sessionId, page, ref: {kind: ref.kind, id: ref.id, variant: ref.variant, file: ref.file, size: ref.size}}, sessionId);
        if (!result?.place) throw new Error('本卡的素材包里没有 ' + ref.kind + ' / ' + ref.id);
        return result.place;
    }
    async function fetchBlob(place) {
        // a small image: the library's thumbnail route (webp, at most size px), no lease
        if (place.hash && place.size) {
            const response = await window.fetch('/api/dsh-asset-library/v2/thumbnail?v=2&packId=' + encodeURIComponent(place.packId) + '&hash=' + encodeURIComponent(place.hash) + '&size=' + place.size, {credentials: 'same-origin'});
            if (!response.ok) throw new Error('素材读取失败 ' + response.status);
            return await response.blob();
        }
        const lease = place.hash ? await service().leaseMedia({packId: place.packId, hash: place.hash}) : await service().leaseBundle({packId: place.packId, bundleKey: place.bundleKey});
        try {
            let url = lease.url;
            if (!place.hash) {
                const marker = '/lease/' + encodeURIComponent(lease.ticket) + '/';
                url = url.slice(0, url.indexOf(marker) + marker.length) + String(place.file || '').split('/').map(encodeURIComponent).join('/');
            }
            const response = await window.fetch(url, {credentials: 'same-origin'});
            if (!response.ok) throw new Error('素材读取失败 ' + response.status);
            return await response.blob();
        } finally { try { service().releaseLease(lease.ticket); } catch (_) {} }
    }
    const remember = (ref, task) => { const key = refKey(ref); blobs.set(key, task.catch(error => { blobs.delete(key); throw error; })); return blobs.get(key); };
    const read = ref => blobs.get(refKey(ref)) || remember(ref, locate(ref).then(fetchBlob));
    // a preload row the page read already located: fetched now
    read.preload = ({ref, place}) => blobs.get(refKey(ref)) || remember(ref, fetchBlob(place));
    read.list = async kind => (await rpc('listCardPageAssets', {sessionId, page, kind}, sessionId))?.assets || [];
    return read;
}

// One open page: its frame lifecycle, the DshCardPage answers and the data feed. host() → the element the frames go into.
// onState({phase:'loading'|'ready'|'empty'|'error', label, size, figures, error}) drives the sheet's own chrome
// (size 'full': the sheet fills the stage instead of the centred window). onAction(kind, arg): 'open' (page id),
// 'settings', 'fill' (after fillInput(sessionId, text)).
function openCardPage({sessionId, page, shortcut, trustedCardMode, helperContext, host, onClose, onState, onAction}) {
    let closed = false, raw = null, avatars = new Map(), theme = {}, helper = helperContext || null;
    let inFlight = false, again = false, faceJob = 0, token = '', content = '', readAsset = null, heldFaces = null;
    let lifecycle = null, stopLifecycle = null, stopSignals = null, stopMessages = null;
    const frames = new Map(); // document token → {node, descriptor}
    const snapshot = () => ({
        ledger: copy(raw?.data?.ledger || {}),
        figures: (raw?.figures || []).map(figure => ({name: figure.name, ...(figure.emotion ? {emotion: figure.emotion} : {}), avatar: avatars.get(figure.name) || null})),
        theme: copy(theme), card: {name: String(raw?.card?.name || '')}
    });
    const windows = () => [...frames.values()].map(item => item.node.contentWindow).filter(Boolean);
    const post = (target, value) => { try { target.postMessage({type: 'dsh-card-page-data', token, data: value}, '*'); } catch (_) {} };
    function push() {
        if (closed) return;
        const value = snapshot();
        for (const target of windows()) post(target, value);
    }
    function state(phase, extra) {
        if (!closed) onState({phase, label: raw?.label || '', size: raw?.size || 'window', figures: raw?.figures || [], ...extra});
    }
    async function answer(method, args) {
        if (method === 'asset') return await readAsset(args);
        if (method === 'assets') return await readAsset.list(String(args?.kind || ''));
        if (method === 'fillInput') {
            if (typeof fillInput !== 'function') throw new Error('舞台输入框不可用');
            fillInput(sessionId, String(args?.text ?? ''));
            onAction('fill');
            return {filled: true};
        }
        if (method === 'close') { onClose(); return {closed: true}; }
        if (method === 'open') { onAction('open', String(args?.id || '')); return {ok: true}; }
        if (method === 'settings') { onAction('settings'); return {ok: true}; }
        throw new Error('卡片页面不支持：' + String(method || ''));
    }
    function receive(event) {
        const data = event?.data;
        if (closed || !data || data.type !== 'dsh-card-page-call' || data.token !== token || !windows().includes(event.source)) return;
        const source = event.source;
        answer(data.method, data.args).then(result => {
            if (!closed) source.postMessage({type: 'dsh-card-page-response', token, requestId: data.requestId, ok: true, result}, '*');
        }, error => {
            if (!closed) source.postMessage({type: 'dsh-card-page-response', token, requestId: data.requestId, ok: false, error: String(error?.message || error)}, '*');
        });
    }
    // The lifecycle's visible and pending documents, as retained message frames place them; the pending one stays hidden
    // until it reports ready.
    function paint(snap) {
        const target = host();
        if (closed || !target) return;
        const wanted = [snap.visibleDocument, snap.pendingDocument].filter(Boolean);
        for (const [key, item] of frames) if (!wanted.some(value => value.token === key)) {
            item.descriptor.ref(null); item.node.remove(); frames.delete(key);
        }
        for (const descriptor of wanted) {
            let item = frames.get(descriptor.token);
            if (!item) {
                const node = document.createElement('iframe');
                node.className = 'fork-gal-status-frame';
                node.referrerPolicy = 'no-referrer';
                if (!descriptor.trustedCardMode) node.setAttribute('sandbox', 'allow-scripts');
                node.srcdoc = descriptor.html;
                // A message posted while the document still loads is lost, and the html carries the data of its mount:
                // the loaded page gets the data as it is now (faces prepared meanwhile, a later read).
                node.addEventListener('load', () => { if (!closed && node.contentWindow) post(node.contentWindow, snapshot()); });
                item = {node, descriptor};
                frames.set(descriptor.token, item);
                target.appendChild(node);
                descriptor.ref(node);
            }
            const hidden = descriptor === snap.pendingDocument;
            item.node.title = raw?.label || '页面';
            if (hidden) item.node.setAttribute('aria-hidden', 'true'); else item.node.removeAttribute('aria-hidden');
            Object.assign(item.node.style, hidden
                ? {position: 'absolute', inset: '0', opacity: '0', pointerEvents: 'none'}
                : {position: '', inset: '', opacity: '', pointerEvents: ''});
        }
    }
    const frameProps = () => ({content, sessionId, turn: latestTurn(helper), partIndex: 0, panelId: 'stage-page-' + page,
        helperContext: helper || undefined, trustedCardMode: trustedCardMode === true, eager: true, persistent: true,
        observeMvuView: false, runtimeReporting: true});
    function mount(html) {
        const target = host();
        if (!target) return;
        token = pageToken();
        theme = themeTokens ? themeTokens(target) || {} : {};
        content = cardPagePrelude(token, page, snapshot(), shortcut) + html;
        window.addEventListener('message', receive);
        stopMessages = () => window.removeEventListener('message', receive);
        lifecycle = createCardFrame(frameProps());
        paint(lifecycle.snapshot());
        stopLifecycle = lifecycle.start(paint);
    }
    function refresh() {
        if (closed || !raw) return;
        if (inFlight) { again = true; return; }
        inFlight = true;
        Promise.resolve().then(() => readPage(sessionId, page, false)).then(next => {
            if (closed || !next) return;
            raw = {...raw, label: next.label || raw.label, figures: next.figures || [], data: next.data || {}, card: next.card || raw.card};
            push();
        }).catch(() => {}).finally(() => {
            inFlight = false;
            if (again && !closed) { again = false; refresh(); }
        });
    }
    async function load() {
        state('loading');
        try {
            const result = await readPage(sessionId, page, true);
            if (closed) return;
            if (!result) { raw = null; state('empty'); return; }
            raw = {label: result.label || '', size: result.size || 'window', figures: result.figures || [], data: result.data || {}, card: result.card || {}};
            readAsset = assetReader(sessionId, page);
            for (const row of result.preload || []) if (row?.place) readAsset.preload(row).catch(() => {});
            state('ready');
            mount(result.html);
            // faces handed over before the read finished
            if (heldFaces) current.setFaces(heldFaces);
            stopSignals = signals.subscribe(sessionId, refresh);
        } catch (error) {
            if (!closed) state('error', {error: String(error?.message || error || '读取失败')});
        }
    }
    const current = {
        get frames() { return [...frames.values()].map(item => item.node); },
        // The live view's Helper context moved on: the lifecycle syncs it into the frame (or rebuilds when it appears).
        setHelper(next) {
            helper = next || null;
            if (!closed && lifecycle) lifecycle.update(frameProps());
        },
        // faces: Map name → face URL (useFaces). Pushes once the new set is ready, if it changed anything.
        setFaces(faces) {
            heldFaces = faces;
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
            open.delete(current);
            const errors = [];
            for (const action of [() => stopSignals?.(), () => stopMessages?.(), () => stopLifecycle?.(),
                () => { for (const item of frames.values()) { item.descriptor.ref(null); item.node.remove(); } frames.clear(); }]) {
                try { action(); } catch (error) { errors.push(error); }
            }
            if (errors.length) throw new AggregateError(errors, 'Stage card page cleanup failed');
        }
    };
    open.add(current);
    void load();
    return current;
}

// The card's pages for a session: {pages, fresh} (declarations without html; fresh: no player message yet), or null
// (no pages, card mode, or not read yet). One read per session.
function usePages(sessionId) {
    const [value, setValue] = React.useState(null);
    React.useEffect(() => {
        setValue(null);
        if (disposed || !sessionId) return;
        let active = true;
        Promise.resolve().then(() => rpc('readCardPages', {sessionId}, sessionId)).then(result => {
            if (active && !disposed) setValue(result?.pages?.length ? {pages: result.pages, fresh: result.fresh === true} : null);
        }, () => {});
        return () => { active = false; };
    }, [sessionId]);
    return value;
}

// size: the declaration's size (usePages), so a full-stage sheet opens full instead of growing after its read.
// A full sheet has no title bar: the card draws the whole scene, and only the close button floats over its corner
// (the label stays the dialog's accessible name; Esc and the backdrop still close it).
// config / source: what useFaces needs to find the declared figures' faces.
function Overlay({sessionId, pageId, shortcut, size, config, source, onClose, onAction}) {
    const h = React.createElement, root = React.useRef(null), body = React.useRef(null), panel = React.useRef(null);
    const close = React.useRef(onClose), act = React.useRef(onAction);
    close.current = onClose; act.current = onAction;
    const live = useLiveView ? useLiveView(sessionId, 'card-page', [['tavernRuntimePolicy'], ['tavernHelper']]) : null;
    const ready = !useLiveView || Boolean(live?.view);
    const trusted = useLiveView ? Boolean(live?.view?.tavernRuntimePolicy?.trustedCardMode) : true;
    const helper = live?.view?.tavernHelper || null, helperNow = React.useRef(helper);
    helperNow.current = helper;
    const [state, setState] = React.useState({phase: 'loading', label: '', size: size || 'window', figures: []});
    const facesNow = React.useRef(null);
    React.useEffect(() => {
        if (disposed || !ready) return;
        const current = openCardPage({sessionId, page: pageId, shortcut, trustedCardMode: trusted, helperContext: helperNow.current, host: () => body.current,
            onClose: () => close.current?.(), onState: setState, onAction: (kind, arg) => act.current?.(kind, arg)});
        panel.current = current;
        if (facesNow.current) current.setFaces(facesNow.current);
        return () => { if (panel.current === current) panel.current = null; current.dispose(); };
    }, [sessionId, pageId, shortcut, ready, trusted]);
    React.useEffect(() => { panel.current?.setHelper(helper); }, [helper]);
    const names = state.figures.map(figure => figure.name);
    const faces = useFaces ? useFaces({config, sessionId, source, names, px: FACE_PX}) : new Map();
    const facesKey = JSON.stringify([...faces]);
    facesNow.current = faces;
    React.useEffect(() => { panel.current?.setFaces(faces); }, [facesKey]);
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
            close.current?.();
        };
        window.addEventListener('keydown', key, true);
        return () => window.removeEventListener('keydown', key, true);
    }, []);
    const label = state.label || '页面';
    return h('div', {className: 'fork-gal-status', 'data-size': state.size, 'data-page': pageId, onClick: event => { event.stopPropagation(); if (event.target === event.currentTarget) close.current?.(); },
        onWheel: event => event.stopPropagation(), onContextMenu: event => { event.preventDefault(); event.stopPropagation(); close.current?.(); }},
        h('section', {ref: root, tabIndex: -1, className: 'fork-gal-status-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label, 'data-phase': state.phase},
            h('header', {className: 'fork-gal-status-head'},
                state.size === 'full' ? null : h('b', {className: 'fork-gal-status-title'}, label),
                h('button', {type: 'button', className: 'fork-gal-status-close', title: '关闭' + label, 'aria-label': '关闭' + label, onClick: () => close.current?.()},
                    h('svg', {viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': true, focusable: 'false'}, h('path', {d: 'M7 7l10 10M17 7L7 17'})))),
            h('div', {ref: body, className: 'fork-gal-status-body'},
                state.phase === 'loading' ? h('p', {className: 'fork-gal-status-note', role: 'status'}, '正在读取' + label + '…') : null,
                state.phase === 'empty' ? h('p', {className: 'fork-gal-status-note'}, '本卡没有这个页面') : null,
                state.phase === 'error' ? h('p', {className: 'fork-gal-status-note', role: 'alert'}, label + '读取失败',
                    h('button', {type: 'button', onClick: () => panel.current?.retry()}, '重试')) : null)));
}

return {usePages, Overlay, open: openCardPage, dispose() {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (const current of [...open]) {
        try { current.dispose(); } catch (error) { errors.push(error); }
    }
    faceData.clear();
    readers.clear();
    if (errors.length) throw new AggregateError(errors, 'Stage card page cleanup failed');
}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageStatusPanel};
