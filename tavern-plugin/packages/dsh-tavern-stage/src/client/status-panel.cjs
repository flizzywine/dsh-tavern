// 卡片页面 (stage card pages): the card's extensions.dsh_tavern.pages, opened over the stage by a shortcut letter, a menu
// row or a showOn event (the old status panel is the page with id 'status'). The engine gives only the way in, the
// sheet and one small facade; the page's html draws everything inside.
// Each page frame is the core's message-frame lifecycle (createCardFrame → createTavernMessageFrameLifecycle): the same
// document, Helper and trust model as text-mode card HTML. A trusted session (tavernRuntimePolicy.trustedCardMode) gets
// a same-origin frame with no sandbox attribute, an untrusted one sandbox="allow-scripts"; the Helper context is the
// live view's tavernHelper, so send, generate, triggerSlash, variables, MVU and worldbook work as in a message.
// The stage adds only window.DshCardPage (a short prelude talking to this host by postMessage; a message counts only
// when its source is one of this page's iframe windows):
//   page; data() → {ledger, figures:[{name, emotion?, avatar}], theme, card:{name}, saved}; onData(fn) → its unsubscribe;
//   close(); open(id) another page; openSettings() the stage's 设置; fillInput(text) fills the stage's 自由输入 (never sends);
//   asset({kind, id, variant?, file?, size?}) → Promise<blob: URL> of a file of the card's own bound packs; assets(kind);
//   the title-screen actions, each the stage's or core's existing way: newGame() the card's 游戏准备 (after the core confirm
//   when this chat is saved, i.e. has a player message), continueGame() closes the page and reading goes on where it is
//   (on an entry page close() is 返回主页面 instead: closing a title page is not entering),
//   openGallery() 回想 over the page, exit() 返回主页面; sound(name) the shown skin's own move / confirm / open / close cue
//   (a skin without that cue stays silent). Every action's Promise settles, so a page that disables its buttons while one
//   runs can enable them again. An element with data-dsh-sound sounds move on hover / focus and confirm on click.
// The data is the page's ledger sections (readCardPage), the declared figures' faces as data: URLs (useFaces) and the
// stage skin tokens (--gal-ui-*). It is read once on open and again, coalesced, after each session state signal.
function createStageStatusPanel({React, window, document, rpc, signals, themeTokens, sounds, confirm, newGame, useFaces, useLiveView, createCardFrame, packService, fillInput}) {
const FACE_PX = 96;
let disposed = false;
const open = new Set(), faceData = new Map(), readers = new Map();
const readPage = (sessionId, page, withHtml) => rpc('readCardPage', {sessionId, page, withHtml}, sessionId).then(result => result?.page || null);
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const pageToken = () => 'card-page:' + Math.random().toString(36).slice(2) + Date.now().toString(36);
// the UI cues a page may sound (sound(name)): the skin palette's gesture cues
const PAGE_SOUNDS = new Set(['move', 'confirm', 'open', 'close']);
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
// The stage's scrollbar rule in the page's document (theme.css «stage scrollbars»): none, unless the skin declares
// scrollbars.page (its --fk-sb-page-* tokens on the host). :where() keeps it under the card's own CSS.
function cardPageScrollbars(style) {
    const token = name => style.getPropertyValue('--fk-sb-page-' + name).trim(), all = ':where(html,body,*)', thumb = token('thumb');
    if (!thumb) return all + '{scrollbar-width:none}' + all + '::-webkit-scrollbar{display:none}';
    const w = token('w'), track = token('track');
    return all + '::-webkit-scrollbar{width:' + w + ';height:' + w + ';background:' + track + '}' + all + '::-webkit-scrollbar-thumb{border-radius:' + w + ';background:' + thumb + '}'
        + all + '::-webkit-scrollbar-track,' + all + '::-webkit-scrollbar-corner{background:' + track + '}';
}
function cardPagePrelude(token, page, snapshot, shortcut, scrollbars) {
    const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return '<style data-dsh-card-page>' + scrollbars + '</style><script data-dsh-card-page>(function(){var token=' + json(token) + ',page=' + json(page) + ',data=' + json(snapshot) + ',next=1,pending=Object.create(null),listeners=new Set(),assets=new Map();'
        + 'function copy(v){return JSON.parse(JSON.stringify(v));}'
        + 'function call(method,args){return new Promise(function(resolve,reject){var id="p"+(next++);pending[id]={resolve:resolve,reject:reject};parent.postMessage({type:"dsh-card-page-call",token:token,requestId:id,method:method,args:args||{}},"*");});}'
        + 'addEventListener("message",function(event){var d=event.data;if(event.source!==parent||!d||d.token!==token)return;'
        + 'if(d.type==="dsh-card-page-data"){data=d.data;listeners.forEach(function(fn){try{fn(copy(data));}catch(error){console.error(error);}});return;}'
        + 'if(d.type!=="dsh-card-page-response")return;var task=pending[d.requestId];if(!task)return;delete pending[d.requestId];if(d.ok)task.resolve(d.result);else task.reject(new Error(String(d.error||"页面请求失败")));});'
        + 'addEventListener("keydown",function(event){if(event.isComposing||event.repeat)return;var own=' + json(shortcut || '') + ';var target=event.target,editing=target&&(target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));if(event.key!=="Escape"&&(!own||event.key.toLowerCase()!==own||editing||event.ctrlKey||event.altKey||event.metaKey))return;event.preventDefault();call("close");});'
        + 'function cue(event){var node=event.target&&event.target.closest?event.target.closest("[data-dsh-sound]"):null;if(!node||node.disabled||node.getAttribute("aria-disabled")==="true")return null;return node;}'
        + 'function hover(event){var node=cue(event);if(node&&!(event.relatedTarget&&node.contains(event.relatedTarget)))call("sound",{name:"move"}).catch(function(){});}'
        + 'addEventListener("mouseover",hover);addEventListener("focusin",hover);addEventListener("click",function(event){if(cue(event))call("sound",{name:"confirm"}).catch(function(){});},true);'
        + 'window.DshCardPage=Object.freeze({page:page,data:function(){return copy(data);},onData:function(fn){if(typeof fn!=="function")throw new TypeError("onData 需要一个函数");listeners.add(fn);return function(){listeners.delete(fn);};},'
        + 'close:function(){return call("close");},open:function(id){return call("open",{id:String(id==null?"":id)});},openSettings:function(){return call("settings");},'
        + 'fillInput:function(text){return call("fillInput",{text:String(text==null?"":text)});},assets:function(kind){return call("assets",{kind:String(kind||"")});},'
        + 'newGame:function(){return call("newGame");},continueGame:function(){return call("continue");},openGallery:function(){return call("gallery");},exit:function(){return call("exit");},'
        + 'sound:function(name){return call("sound",{name:String(name||"")});},'
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
// onState({phase:'loading'|'ready'|'empty'|'error', label, size, figures, shown, error}) drives the sheet's own chrome
// (size 'full': the sheet fills the stage instead of the centred window). label / size: the page's declaration (usePages),
// what the sheet keeps until the read returns. shown: the lifecycle's visible document has loaded in its frame, so the page
// is on screen. onAction(kind, arg): 'open' (page id),
// 'settings', 'fill' (after fillInput(sessionId, text)), 'continue', 'gallery', 'exit' (newGame() leaves too, then asks the core).
// saved: the chat has a player message (usePages' fresh is false), so newGame() asks first.
function openCardPage({sessionId, page, label, size, shortcut, saved, trustedCardMode, helperContext, host, onClose, onState, onAction}) {
    let closed = false, raw = null, shown = false, avatars = new Map(), theme = {}, helper = helperContext || null;
    let inFlight = false, again = false, faceJob = 0, token = '', content = '', readAsset = null, heldFaces = null;
    let lifecycle = null, stopLifecycle = null, stopSignals = null, stopMessages = null;
    const frames = new Map(); // document token → {node, descriptor}
    const snapshot = () => ({
        ledger: copy(raw?.data?.ledger || {}),
        figures: (raw?.figures || []).map(figure => ({name: figure.name, ...(figure.emotion ? {emotion: figure.emotion} : {}), avatar: avatars.get(figure.name) || null})),
        theme: copy(theme), card: {name: String(raw?.card?.name || '')}, saved: saved === true
    });
    const windows = () => [...frames.values()].map(item => item.node.contentWindow).filter(Boolean);
    const post = (target, value) => { try { target.postMessage({type: 'dsh-card-page-data', token, data: value}, '*'); } catch (_) {} };
    function push() {
        if (closed) return;
        const value = snapshot();
        for (const target of windows()) post(target, value);
    }
    function state(phase, extra) {
        if (!closed) onState({phase, label: raw?.label || label || '', size: raw?.size || size || 'window', figures: raw?.figures || [], shown, ...extra});
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
        if (method === 'continue' || method === 'gallery' || method === 'exit') { onAction(method); return {ok: true}; }
        if (method === 'newGame') {
            if (typeof newGame !== 'function') throw new Error('新游戏不可用');
            if (saved === true && !(typeof confirm === 'function' && await confirm('开始新游戏？\n\n当前这局会保留在游玩记录里，随时可以回来继续。', {confirmText: '开始新游戏', cancelText: '取消'}))) return {started: false};
            if (closed) return {started: false};
            onAction('exit');
            newGame(sessionId);
            return {started: true};
        }
        if (method === 'sound') {
            const name = String(args?.name || '');
            if (!PAGE_SOUNDS.has(name)) throw new Error('sound 只接受 move、confirm、open、close');
            return {played: sounds?.playSkin(name) === true};
        }
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
    function reveal(item) {
        if (shown || !item.loaded || lifecycle?.snapshot().visibleDocument?.token !== item.descriptor.token) return;
        shown = true;
        state('ready');
    }
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
                node.addEventListener('load', () => {
                    if (closed) return;
                    if (node.contentWindow) post(node.contentWindow, snapshot());
                    item.loaded = true;
                    reveal(item);
                });
                item = {node, descriptor, loaded: false};
                frames.set(descriptor.token, item);
                target.appendChild(node);
                descriptor.ref(node);
            }
            const hidden = descriptor === snap.pendingDocument;
            item.node.title = raw?.label || label || '页面';
            if (hidden) item.node.setAttribute('aria-hidden', 'true'); else item.node.removeAttribute('aria-hidden');
            Object.assign(item.node.style, hidden
                ? {position: 'absolute', inset: '0', opacity: '0', pointerEvents: 'none'}
                : {position: '', inset: '', opacity: '', pointerEvents: ''});
            if (!hidden) reveal(item);
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
        content = cardPagePrelude(token, page, snapshot(), shortcut, cardPageScrollbars(window.getComputedStyle(target))) + html;
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

// The card's pages for a session: {pages, fresh} (declarations without html; fresh: no player message yet), null (no
// pages, card mode or a failed read) or undefined while the read is out. One read per session.
function usePages(sessionId) {
    const [value, setValue] = React.useState(undefined);
    React.useEffect(() => {
        if (disposed || !sessionId) { setValue(null); return; }
        setValue(undefined);
        let active = true;
        Promise.resolve().then(() => rpc('readCardPages', {sessionId}, sessionId)).then(result => {
            if (active && !disposed) setValue(result?.pages?.length ? {pages: result.pages, fresh: result.fresh === true} : null);
        }, () => { if (active && !disposed) setValue(null); });
        return () => { active = false; };
    }, [sessionId]);
    return value;
}

// size / label: the declaration's (usePages), so a full-stage sheet opens full and the sheet names its page while it reads.
// A full sheet has no title bar: the card draws the whole scene, and only the close button floats over its corner
// (the label stays the dialog's accessible name; Esc and the backdrop still close it). Its close button is the stage's
// overlay icon button (the top bar's 返回主页面 ×, themes.css).
// entry: the page stands in for this stage entry (a title or opening page): it is drawn opaque from its first frame, with
// no fade and no 正在读取 note, so the stage never shows through while its document loads; onClose then leaves the stage.
// Until its document is on screen (shown) it draws no chrome either (data-bare: no title bar, no ×, no sheet border), only
// its opaque ground, and then the page appears at once (an empty or failed read gets the chrome back, to leave by).
// config / source: what useFaces needs to find the declared figures' faces.
function Overlay({sessionId, pageId, label: declaredLabel, shortcut, size, saved, entry, config, source, onClose, onAction}) {
    const h = React.createElement, root = React.useRef(null), body = React.useRef(null), panel = React.useRef(null);
    const close = React.useRef(onClose), act = React.useRef(onAction);
    close.current = onClose; act.current = onAction;
    const live = useLiveView ? useLiveView(sessionId, 'card-page', [['tavernRuntimePolicy'], ['tavernHelper']]) : null;
    const ready = !useLiveView || Boolean(live?.view);
    const trusted = useLiveView ? Boolean(live?.view?.tavernRuntimePolicy?.trustedCardMode) : true;
    const helper = live?.view?.tavernHelper || null, helperNow = React.useRef(helper);
    helperNow.current = helper;
    const [state, setState] = React.useState({phase: 'loading', label: declaredLabel || '', size: size || 'window', figures: [], shown: false});
    const facesNow = React.useRef(null);
    React.useEffect(() => {
        if (disposed || !ready) return;
        const current = openCardPage({sessionId, page: pageId, label: declaredLabel, size, shortcut, saved: saved === true, trustedCardMode: trusted, helperContext: helperNow.current, host: () => body.current,
            onClose: () => close.current?.(), onState: setState, onAction: (kind, arg) => act.current?.(kind, arg)});
        panel.current = current;
        if (facesNow.current) current.setFaces(facesNow.current);
        return () => { if (panel.current === current) panel.current = null; current.dispose(); };
    }, [sessionId, pageId, declaredLabel, size, shortcut, saved, ready, trusted]);
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
    const closeLabel = entry ? '返回主页面' : '关闭' + label;
    return h('div', {className: 'fork-gal-status', 'data-size': state.size, 'data-page': pageId, 'data-entry-page': entry ? '' : undefined, 'data-bare': entry && !state.shown && (state.phase === 'loading' || state.phase === 'ready') ? '' : undefined, onClick: event => { event.stopPropagation(); if (event.target === event.currentTarget) close.current?.(); },
        onWheel: event => event.stopPropagation(), onContextMenu: event => { event.preventDefault(); event.stopPropagation(); close.current?.(); }},
        h('section', {ref: root, tabIndex: -1, className: 'fork-gal-status-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label, 'data-phase': state.phase},
            h('header', {className: 'fork-gal-status-head'},
                state.size === 'full' ? null : h('b', {className: 'fork-gal-status-title'}, label),
                h('button', {type: 'button', className: 'fork-gal-status-close', title: closeLabel, 'aria-label': closeLabel, onClick: () => close.current?.()},
                    h('svg', {viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': true, focusable: 'false'}, h('path', {d: 'M7 7l10 10M17 7L7 17'})))),
            h('div', {ref: body, className: 'fork-gal-status-body'},
                state.phase === 'loading' && !entry ? h('p', {className: 'fork-gal-status-note', role: 'status'}, '正在读取' + label + '…') : null,
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
