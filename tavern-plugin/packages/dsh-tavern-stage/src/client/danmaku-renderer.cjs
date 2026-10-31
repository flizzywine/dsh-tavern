function createStageDanmaku({display,scheduler,session,liveroom,createAvatar,renderers={},window,Image,getComputedStyle,requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout,performance}) {
let closed=false;const instances=new Set();
const {DANMAKU_LIMITS, DANMAKU_ENTRIES, danmakuPlatform, danmakuMedalName, danmakuNewcomer, danmakuTurnText, dmClamp, danmakuOverlayPrefs, danmakuBadges, danmakuMedalTier, danmakuClock, danmakuCount, danmakuScNode, danmakuColour, danmakuPerspective, danmakuOrder, danmakuComments, danmakuHeatAt, danmakuOnlineAt}=display;
const {danmakuLanes, danmakuLaneSets, danmakuLate, danmakuPlan, danmakuQueueSize}=scheduler;
const {danmakuFlown,danmakuMarkFlown,danmakuReplayPending,danmakuReplayEpoch}=session;
// Timing evidence for muted debug slots only: `window.__forkDanmakuTrace = []` opts in; nothing is recorded otherwise.
const danmakuTraceOn = () => typeof window !== 'undefined' && Array.isArray(window.__forkDanmakuTrace);
function danmakuTrace(entry) { const log = window.__forkDanmakuTrace; log.push({ ...entry, wall: Date.now() }); if (log.length > 4000) log.splice(0, log.length - 4000); }

const DM_DEFAULT_CLOCK = {
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id),
};

// The renderer contract of createModUiLayerHost: render({root,context,viewport,budget}) → {update, dispose}. update()
// receives either the host's geometry refresh ({context,viewport}) or the mod's DanmakuView (version 1).
// Optional host hooks: `dock(request|null)` — request {side:'right'} returns
// {column, below|null} slot elements beside / under the scene (the host scales the scene, never re-lays it out) or null
// when the stage is too narrow; null releases. `context.stage` — read-only display facts for the 直播信息栏
// {title?, turn?, latestTurn?, scene?, bgm?}; anything missing is simply not shown.
function createDanmakuLayer({ root, viewport, budget, context, dock = null, layer = 'overlay', clock = DM_DEFAULT_CLOCK }) {
    if(closed)throw new Error('Danmaku renderer is disposed');
    let disposed=false;const listeners=[];
    const avatar=createAvatar({Image});
    const {danmakuAvatarSrc,danmakuCrop,danmakuFaceCrop,danmakuFaceSize}=avatar;
    function listen(node,type,fn,options){const guarded=event=>{if(!disposed)fn(event);};node.addEventListener(type,guarded,options);listeners.push(()=>node.removeEventListener(type,guarded,options));}
    const doc = root.ownerDocument;
    const el = (tag, cls, parent) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (parent) parent.appendChild(n); return n; };
    const maxVisible = Math.min(DANMAKU_LIMITS.overlayVisible, budget?.maxVisible || DANMAKU_LIMITS.overlayVisible);
    const maxNodes = Math.max(40, (budget?.maxNodes || 200) - 4);
    const st = { view: null, geometry: viewport || null, base: 0, baseAt: 0, active: false, shown: false, stage: context?.stage || null, session: context?.sessionId || '', mountedAt: clock.now() };
    const now = () => st.base + (st.active ? clock.now() - st.baseAt : 0);
    const wrap = el('div', 'fork-dm', root);
    wrap.dataset.layer = layer;
    wrap.hidden = true;
    let timer = null;
    const played = new Set();
    const markPlayed = id => { played.add(id); if (played.size > DANMAKU_LIMITS.played) played.delete(played.values().next().value); danmakuMarkFlown(st.session, id); };
    const area = () => { const v = st.view; return v && v.viewport?.width > 0 ? { width: v.viewport.width, height: v.viewport.height, safeRegions: v.safeRegions || [] } : st.geometry || { width: 0, height: 0, safeRegions: [] }; };

    // ---- the platform theme (words, data-dm-platform) and the shared head pieces: live tag, viewers, heat bar
    const words = () => danmakuPlatform(st.view).words;
    // The host's face (view.streamer.avatar.src, resolved by the host from the card's 主播头像): an image the page may load
    // (data: / blob: / same-origin path); otherwise a neutral face (CSS), never a glyph. A character's sprite comes with its
    // avatar crop (view.streamer.avatar.crop), drawn once the sprite's size is known (the neutral face until then).
    const paintFace = node => {
        const src = danmakuAvatarSrc(st.view), crop = src && danmakuCrop(st.view.streamer.avatar.crop), size = crop && danmakuFaceSize(src, () => { if (wrap.isConnected) draw(); });
        const fit = crop ? size && danmakuFaceCrop(crop, size.width, size.height) : src ? { size: '', position: '' } : null;
        node.style.backgroundImage = fit ? 'url("' + src.replace(/["\\]/g, encodeURIComponent) + '")' : '';
        node.style.backgroundSize = fit ? fit.size : ''; node.style.backgroundPosition = fit ? fit.position : '';
        if (fit) node.dataset.avatar = 'true'; else delete node.dataset.avatar;
    };
    const streamerName = () => st.view?.streamer?.name.trim() || (st.stage?.player && st.stage.player !== '你' ? st.stage.player : words().streamer);
    const brand = node => { const id = danmakuPlatform(st.view).id; if (node && node.dataset.dmPlatform !== id) node.dataset.dmPlatform = id; };
    const viewersText = t => words().viewers + ' ' + danmakuCount(danmakuOnlineAt(st.view, t));
    const medalName = () => st.view?.sidebar?.medal || danmakuMedalName(st.stage, danmakuPlatform(st.view));
    function liveTag(parent) { return el('span', 'fork-dm-live', parent); }
    function heatBar(parent) { const t = el('span', 'fork-dm-heat', parent); t.setAttribute('role', 'img'); return { track: t, bar: el('i', 'fork-dm-heat-bar', t) }; }
    // Keep one compositor animation per cool-down, rather than forcing layout to restart a CSS transition on every draw.
    function paintHeat(h) {
        const v = st.view, t = now(), value = danmakuHeatAt(v, t) / 100;
        const started = (v?.batches || []).filter(b => b.offsetMs <= t), last = started[started.length - 1];
        const span = last ? last.heatExpiresAtMs - last.offsetMs : 0;
        const key = last && st.active && v.mode === 'live' && span > 0 && t < last.heatExpiresAtMs ? [last.offsetMs, last.heat, last.heatExpiresAtMs].join(':') : '';
        h.bar.style.transition = 'none';
        if (key && h.bar.animate) {
            if (h.key !== key) {
                h.motion?.cancel();
                h.motion = h.bar.animate([{ transform: `scaleX(${dmClamp(last.heat, 0, 100) / 100})` }, { transform: 'scaleX(0)' }], { duration: span, fill: 'both' });
                h.key = key;
            }
            h.motion.currentTime = Math.max(0, t - last.offsetMs);
        } else {
            h.motion?.cancel(); h.motion = null; h.key = '';
            h.bar.style.transform = `scaleX(${value})`;
        }
        const label = words().heat + ' ' + Math.round(value * 100);
        if (h.track.getAttribute('aria-label') !== label) h.track.setAttribute('aria-label', label);
        if (h.track.title !== words().heat) h.track.title = words().heat;
    }
    function setStatus(node) {
        node.textContent = st.view?.mode === 'history' ? words().replay : st.view?.status === 'error' ? words().unavailable : words().live;
        wrap.dataset.live = node.dataset.live = st.view?.mode === 'history' ? 'replay' : 'live';
    }

    // ================= overlay (飘屏)
    let ov = null;
    function overlayParts() {
        if (ov) return ov;
        const stage = el('div', 'fork-dm-stage', wrap);
        const corner = el('div', 'fork-dm-corner', wrap);
        const hud = el('div', 'fork-dm-hud', corner);
        const live = liveTag(hud);
        const online = el('span', 'fork-dm-online', hud);
        const cards = el('div', 'fork-dm-cards', corner);
        // The flying comments and cards are decorative (the console is the readable form); the room chip is not.
        stage.setAttribute('aria-hidden', 'true'); cards.setAttribute('aria-hidden', 'true');
        // items: id → {node, anim, motion} on screen; starts: id → start once placed (a re-shown comment continues from
        // where it is); widths: id → {w, h} measured once per comment and font; warm: false until the first pass after a
        // mount / clear (that pass places comments at their absolute offsets); queue: id → comment held for a lane (kept
        // across a page turn: the new view no longer carries it); capLanes: the most lanes this stage size has had (choices
        // cover the stage only for a while, so the queue is sized for the stage without them).
        ov = { stage, corner, hud, live, online, cards, cardOf: new Map(), queue: new Map(), held: new Map(), lanes: [], lower: [], capLanes: 0, items: new Map(), starts: new Map(), widths: new Map(), laneOf: new Map(), pool: [], fonts: {}, canvas: null, key: '', warm: false, lastStart: -Infinity, replay: danmakuReplayEpoch(st.session) };
        return ov;
    }
    function fontOf(size) {
        if (ov.fonts[size]) return ov.fonts[size];
        const probe = el('span', 'fork-dm-item', ov.stage); probe.dataset.size = size; probe.style.visibility = 'hidden';
        const cs = typeof getComputedStyle === 'function' ? getComputedStyle(probe) : null;
        const f = { font: cs ? `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}` : '600 20px sans-serif', px: (cs && parseFloat(cs.fontSize)) || 20, spacing: (cs && parseFloat(cs.letterSpacing)) || 0 };
        probe.remove(); ov.fonts[size] = f; return f;
    }
    // Measure with a canvas (no forced layout), once per comment and font: the text, its letter-spacing and the halo.
    function sizeOf(c) {
        const size = ['small', 'large'].includes(c.size) ? c.size : 'standard', hit = ov.widths.get(c.id);
        if (hit && hit.size === size && hit.text === c.text) return hit;
        const f = fontOf(size), chars = [...c.text].length;
        if (!ov.canvas) ov.canvas = doc.createElement('canvas').getContext?.('2d') || null;
        let w = chars * f.px;
        if (ov.canvas) { ov.canvas.font = f.font; w = ov.canvas.measureText(c.text).width; }
        const m = { size, text: c.text, w: Math.ceil(w + chars * f.spacing) + 6, h: Math.ceil(f.px * 1.3) };
        ov.widths.set(c.id, m);
        if (ov.widths.size > DANMAKU_LIMITS.played) ov.widths.delete(ov.widths.keys().next().value);
        return m;
    }
    function relayout(v) {
        const prefs = danmakuOverlayPrefs(st.view?.settings);
        const key = JSON.stringify([v.width, v.height, v.safeRegions, st.view?.settings?.density, prefs]);
        if (key === ov.key) return;
        // New bands only: comments on screen keep their own motion and stay obstacles until they leave.
        const fontKey = ov.fontKey, nextFontKey = JSON.stringify([v.width, v.height, prefs.scale]);
        ov.key = key;
        if (fontKey !== nextFontKey) { ov.fonts = {}; ov.widths.clear(); ov.fontKey = nextFontKey; ov.capLanes = 0; }
        wrap.style.setProperty('--fork-dm-scale', String(prefs.scale));
        wrap.style.setProperty('--fork-dm-opacity', String(prefs.alpha));
        const regions = v.safeRegions || [], wide = r => r.width > v.width * 0.5;
        const topEdge = Math.max(0, ...regions.filter(r => wide(r) && r.y < v.height * 0.3).map(r => r.y + r.height));
        wrap.style.setProperty('--fork-dm-top', Math.round(topEdge) + 'px');
        wrap.dataset.narrow = v.width > 0 && v.width < 560 ? 'true' : '';
        // The corner chip (直播中 · 观众 N, 4px under the top bar) keeps its own row; comments start below it. Read once per
        // layout. A lane fits a large comment, so no size spills into a safe region or the next lane.
        const chip = { x: 0, y: topEdge, width: 1, height: 4 + (ov.hud.offsetHeight || 28) };
        const low = st.view?.settings?.density === 'low';
        const free = danmakuLanes({ width: v.width, height: v.height, safeRegions: [...regions, chip], laneHeight: Math.ceil(Math.max(fontOf('standard').px * 1.42, fontOf('large').px * 1.3 + 2)) });
        const sets = danmakuLaneSets(free, { area: prefs.area, maxLanes: v.width < 560 ? 9 : 16, bottomLanes: low ? 2 : 3 });
        ov.lanes = sets.upper; ov.lower = sets.lower; ov.capLanes = Math.max(ov.capLanes, ov.lanes.length);
    }
    function dropItem(id) {
        const it = ov.items.get(id); if (!it) return;
        ov.items.delete(id); if(it.anim){it.anim.onfinish=null;it.anim.cancel();} it.node.remove();
        if (ov.pool.length < maxVisible) ov.pool.push(it.node);
    }
    // Draw one placement of danmakuPlan: the node moves only by transform (Web Animations, compositor).
    function show({ c, lane, mode, motion }, t) {
        const size = ['small', 'large'].includes(c.size) ? c.size : 'standard', ms = motion.end - motion.start, y = motion.y0;
        if (mode === 'scroll') {
            ov.laneOf.set(c.id, lane);
            if (ov.laneOf.size > DANMAKU_LIMITS.played) ov.laneOf.delete(ov.laneOf.keys().next().value);
        }
        ov.starts.set(c.id, motion.start);
        if (ov.starts.size > DANMAKU_LIMITS.played) ov.starts.delete(ov.starts.keys().next().value);
        const node = ov.pool.pop() || el('span', 'fork-dm-item');
        node.textContent = c.text; node.dataset.size = size; node.dataset.mode = mode;
        const tone = danmakuColour(c.color);
        if (tone) { node.style.setProperty('--gal-dm-c', tone.colour); node.dataset.dark = tone.dark ? 'true' : ''; }
        else { node.style.removeProperty('--gal-dm-c'); node.dataset.dark = ''; }
        ov.stage.appendChild(node);
        const frames = mode === 'scroll'
            ? [{ transform: `translate3d(${motion.x0}px,${y}px,0)`, visibility: 'visible' }, { transform: `translate3d(${-motion.w}px,${y}px,0)`, visibility: 'visible' }]
            : [{ transform: `translate3d(${motion.x0}px,${y}px,0)`, visibility: 'visible' }, { transform: `translate3d(${motion.x0}px,${y}px,0)`, visibility: 'visible' }]; // fixed: appears and leaves, like bilibili
        // A booked fixed comment (start ahead of t) waits hidden in its place: the animation's before phase has no fill.
        node.style.transform = frames[0].transform; node.style.visibility = 'hidden';
        const it = { node, motion, anim: null };
        ov.items.set(c.id, it);
        if (typeof node.animate === 'function') {
            it.anim = node.animate(frames, { duration: ms, easing: 'linear', fill: 'forwards' });
            // Start on the document timeline now, not a pending play at the next (possibly delayed) paint.
            it.anim.startTime = doc.timeline.currentTime - (t - motion.start);
            it.anim.onfinish = () => {if(!disposed)dropItem(c.id);};
            if (!st.active) it.anim.pause();
        } else node.style.visibility = '';
    }
    // Highlight nodes: keyed by id, each removed at its own end (part of the next-due timer); new ones in arrival order.
    function syncCards(container, list, t, variant = 'card') {
        const want = new Map(list.map(c => [c.id, c]));
        for (const node of [...container.children]) if (!want.has(node.dataset.id)) node.remove();
        const have = new Set([...container.children].map(n => n.dataset.id));
        for (const c of list) if (!have.has(c.id)) container.appendChild(danmakuScNode(doc, c, { variant, elapsed: t - c.offsetMs, words: words() }));
    }
    function drawOverlay(comments, t) {
        overlayParts();
        setStatus(ov.live); brand(wrap);
        ov.online.textContent = viewersText(t);
        // The host hands a new layer its first view before it attaches the layer, and off the document computed style is
        // empty (the canvas then measured at its 10px default: every comment ~40% of its width, lanes too low, for the
        // whole session). Fonts, lanes and widths are read once the layer is in the page, a frame later.
        if (!wrap.isConnected) return t + 16;
        const v = area();
        relayout(v);
        // 飘屏 (the viewer's screen): a 醒目留言 is a card in the corner for its tier's cardMs — no pinned strip over the
        // scene; at most two at once, the newest below. The cards share the visible budget with the comments. A card on
        // screen stays for its own time, also after a page turn drops it from the view; one already shown this session
        // (an earlier mount) does not come back.
        const epoch = danmakuReplayEpoch(st.session);
        if (ov.replay !== epoch) { ov.replay = epoch; played.clear(); }
        const flown = danmakuFlown(st.session), cards = new Map([...ov.cardOf].filter(([, c]) => t < c.offsetMs + c.cardMs));
        for (const c of comments) if (c.kind === 'highlight' && !cards.has(c.id) && !flown.has(c.id) && c.offsetMs <= t && t < c.offsetMs + c.cardMs) cards.set(c.id, c);
        const live = [...cards.values()].sort(danmakuOrder).slice(-2);
        ov.cardOf = new Map(live.map(c => [c.id, c]));
        for (const c of live) danmakuMarkFlown(st.session, c.id);
        syncCards(ov.cards, live, t);
        // A comment on screen moves only by its own animation (never re-seeked: a host time arriving late would pull it
        // back). One paused past its end never fires finish (and play() would rewind it to the right edge): it ends here.
        // The document animation clock can trail the host/performance clock by a render frame. A running
        // compositor animation owns its finish; only paused/non-animated comments use the host deadline.
        for (const [id, it] of ov.items) if (t >= it.motion.end && (!it.anim || it.anim.playState === 'paused' || it.anim.playState === 'finished')) dropItem(id);
        // Due: the view's new comments and the held queue (a held one enters at the right edge when a lane frees).
        const due = new Map();
        for (const c of [...comments, ...ov.queue.values()]) if (c.kind !== 'highlight' && !ov.items.has(c.id) && !played.has(c.id) && !flown.has(c.id)) due.set(c.id, c);
        const low = st.view.settings?.density === 'low', cap = low ? Math.ceil(maxVisible / 2) : maxVisible;
        const plan = danmakuPlan([...due.values()].sort(danmakuOrder), [...ov.items.values()].map(it => it.motion), t, {
            // A history page plays its recording from the right edge (「像看录播」): one that arrives a little late enters now
            // rather than appearing mid-screen.
            viewWidth: v.width, lanes: ov.lanes, lower: ov.lower, size: sizeOf, warm: ov.warm || st.view.mode === 'history', lastStart: ov.lastStart,
            room: cap - ov.items.size - ov.cards.childElementCount, starts: id => ov.starts.get(id), held: id => ov.queue.has(id),
            // A relay reads down the screen: a reply tries the lane under its parent's first (no @ marker — viewers see plain danmaku).
            prefer: c => { const parent = c.replyTo ? ov.laneOf.get(c.replyTo) : undefined; return parent === undefined || !ov.lanes.length ? -1 : (parent + 1) % ov.lanes.length; },
            // 疏朗 (low density): what finds no lane right away is dropped, never queued.
            maxWaitMs: low ? 0 : DANMAKU_LIMITS.maxWaitMs,
            maxQueue: danmakuQueueSize({ lanes: ov.capLanes, viewWidth: v.width, width: fontOf('standard').px * 10 }),
            page: st.view.page,
        });
        if (danmakuTraceOn()) {
            const reduced = ov.lanes.length < ov.capLanes; // a choice (or another safe region) covers lanes now
            for (const c of plan.queue) { const h = ov.held.get(c.id) || { since: t, reduced: false }; h.reduced ||= reduced; ov.held.set(c.id, h); }
            const row = (ev, c, extra) => { const h = ov.held.get(c.id); ov.held.delete(c.id); danmakuTrace({ ev, id: c.id, text: c.text, t, offsetMs: c.offsetMs, source: c.sourcePage || null, timing: c.timing || null,
                page: st.view.page || null, anchor: st.view.anchor || null, lanes: ov.lanes.length, capLanes: ov.capLanes, heldMs: h ? t - h.since : 0, heldReduced: !!h?.reduced, ...extra }); };
            for (const p of plan.place) row('fly', p.c, { start: p.motion.start });
            for (const id of plan.drop) { const c = due.get(id); if (c) row('drop', c, { late: danmakuLate(c, t) }); }
        }
        for (const p of plan.place) { markPlayed(p.c.id); show(p, t); }
        for (const id of plan.drop) markPlayed(id);
        ov.queue = new Map(plan.queue.map(c => [c.id, c]));
        ov.lastStart = plan.lastStart; ov.warm = true;
        let next = plan.next;
        for (const c of [...comments, ...ov.cardOf.values()]) if (c.kind === 'highlight') next = Math.min(next, c.offsetMs > t ? c.offsetMs : c.offsetMs + c.cardMs > t ? c.offsetMs + c.cardMs : Infinity);
        return next;
    }
    // Every host view resets the clock to its activeTimeMs, which may be late, jittered or a re-published older view
    //. What is on screen or held moves with the clock, so the motions keep
    // describing where each comment really is and the scheduler stays exact; nothing on screen ever moves backward.
    function rebase(shift) {
        if (!ov || !shift) return;
        for (const it of ov.items.values()) { it.motion.start += shift; it.motion.end += shift; }
        // A held comment's page show moves with it, so its lateness is measured on the same clock as its offset.
        const moved = c => ({ ...c, offsetMs: c.offsetMs + shift, ...(Number.isFinite(c.sourcePage?.shownAtMs) ? { sourcePage: { ...c.sourcePage, shownAtMs: c.sourcePage.shownAtMs + shift } } : {}) });
        for (const held of [ov.cardOf, ov.queue]) for (const [id, c] of held) held.set(id, moved(c));
        for (const [id, s] of ov.starts) ov.starts.set(id, s + shift);
        ov.lastStart += shift;
    }
    function clearOverlay(resume = false) {
        if (!ov) return;
        // resume (a view switch, silence lifted): comments still on screen are not 'played' yet; shown again they continue
        // from where they are now (their start is kept). Closing the room cuts them for good. The next pass is cold.
        for (const id of [...ov.items.keys()]) { if (resume) { played.delete(id); danmakuFlown(st.session).delete(id); } dropItem(id); }
        if (resume) for (const card of ov.cards.children) danmakuFlown(st.session).delete(card.dataset.id);
        ov.cards.textContent = ''; ov.cardOf.clear(); ov.queue.clear(); ov.held.clear(); ov.laneOf.clear(); ov.warm = false; ov.lastStart = -Infinity;
    }

    // ================= sidebar (直播风格: the streamer's chat dock + 直播信息栏)
    let sb = null;
    function sidebarParts() {
        if (sb) return sb;
        const dock = el('section', 'fork-dm-console', wrap);
        // Docked without a band: the head is the room capsule — the room's face with the live ring, its title, 「直播中 ·
        // 观众 N」, the heat. Docked beside the band: just the panel's name (弹幕), the bar says the rest. Floating (phones):
        // the bar's 'float' layout replaces the head.
        const head = el('header', 'fork-dm-head', dock);
        const face = el('span', 'fork-dm-face', head); face.setAttribute('aria-hidden', 'true');
        const capsule = el('span', 'fork-dm-capsule', head);
        const roomTitle = el('b', 'fork-dm-capsule-title', capsule);
        const line = el('span', 'fork-dm-capsule-line', capsule);
        const live = liveTag(line);
        const online = el('span', 'fork-dm-online', line);
        const panelTitle = el('span', 'fork-dm-head-title', head);
        const warn = el('span', 'fork-dm-warn', head); warn.hidden = true; warn.setAttribute('role', 'img'); warn.textContent = '⚠';
        const heat = heatBar(head);
        // bilibili's pinned strip: one pill per 醒目留言 still pinned (its tier's time draining behind); a pill opens
        // the full card under the strip, a second press (or Esc) closes it.
        const pinned = el('div', 'fork-dm-pinned', dock);
        pinned.setAttribute('data-mod-input', ''); pinned.setAttribute('role', 'group'); pinned.setAttribute('aria-label', words().sc);
        const detail = el('div', 'fork-dm-pin-detail', dock); detail.hidden = true; detail.setAttribute('data-mod-input', '');
        const list = el('ol', 'fork-dm-list', dock);
        list.setAttribute('data-mod-input', '');
        list.setAttribute('role', 'log'); list.setAttribute('aria-live', 'off');
        // bilibili's entry line under the chat: 「欢迎 <name> 进入直播间」 for the newest first-time chatter; fades by itself.
        const ticker = el('div', 'fork-dm-ticker', dock); ticker.setAttribute('aria-hidden', 'true');
        const latest = el('button', 'fork-dm-latest', dock);
        latest.type = 'button'; latest.setAttribute('data-mod-input', ''); latest.setAttribute('aria-label', words().latest); latest.title = words().latest; latest.textContent = '↓'; latest.hidden = true;
        sb = { dock, head, face, roomTitle, live, online, panelTitle, warn, heat, pinned, detail, list, ticker, latest, rows: new Map(), cut: new Set(), kept: new Set(), follow: true, bar: null, barKey: '', slots: null, open: null, newcomer: null };
        const openPin = id => {
            sb.open = sb.open === id ? null : id;
            for (const pill of pinned.children) pill.setAttribute('aria-expanded', String(pill.dataset.id === sb.open));
            draw();
        };
        listen(pinned, 'click', event => { const pill = event.target.closest('.fork-dm-sc-pill'); if (pill) openPin(pill.dataset.id); });
        listen(dock, 'keydown', event => { if (event.key === 'Escape' && sb.open) { const id = sb.open; event.stopPropagation(); openPin(id); [...pinned.children].find(node=>node.dataset.id===id)?.focus(); } });
        // Scrolling or clicking the chat must not also turn the page (the stage owns wheel/click/keys on its root).
        for (const type of ['wheel', 'click', 'pointerdown', 'touchstart', 'keydown']) listen(dock, type, event => { if (event.target.closest('[data-mod-input]')) event.stopPropagation(); }, { passive: true });
        listen(list, 'scroll', () => { sb.follow = list.scrollTop + list.clientHeight >= list.scrollHeight - 8; latest.hidden = sb.follow; }, { passive: true });
        listen(latest, 'click', () => { sb.follow = true; list.scrollTop = list.scrollHeight; latest.hidden = true; });
        return sb;
    }
    // The streamer's 直播信息栏: the platform theme's bar (danmaku-liveroom.cjs) — 'band' under the docked scene,
    // 'float' at the top of the floating console (phones, no dock), where it replaces the room capsule. One instance per
    // layout; switching layout builds the other one (its first paint is cold).
    function barFor(layout) {
        if (sb.bar?.layout === layout) return sb.bar;
        sb.bar?.dispose();
        sb.bar = liveroom.create(doc, layout); sb.barKey = '';
        return sb.bar;
    }
    function dropBar() { sb.bar?.dispose(); sb.bar = null; delete sb.dock.dataset.bar; }
    // A row: badges · name · text. A 醒目留言 is its tier card in the list. A reply (relay of any depth) stays flat and
    // says whom it answers — 「回复 @名字」 — instead of indenting.
    function rowFor(c, medal, byId, t) {
        const li = el('li', 'fork-dm-row');
        li.dataset.id = c.id; li.dataset.kind = c.kind === 'highlight' ? 'highlight' : 'comment';
        const w = words(), flags = danmakuPlatform(st.view).badges;
        if (c.kind === 'highlight') { li.appendChild(danmakuScNode(doc, c, { variant: 'row', elapsed: t - c.offsetMs, words: w })); return li; }
        const b = danmakuBadges(c, medal);
        if (!flags.medal) b.medal = null; if (!flags.guard) b.guard = false; if (!flags.admin) b.admin = false;
        if (b.guard) li.dataset.guard = 'true'; // bilibili tints a 舰长's row
        // One node per badge (the layer's maxNodes is shared by 32 rows): the medal's level is drawn from data-level.
        if (b.medal) { const m = el('span', 'fork-dm-medal', li); m.dataset.tier = String(danmakuMedalTier(b.medal.level)); m.dataset.level = String(b.medal.level); m.textContent = b.medal.name; }
        if (b.guard) { const g = el('span', 'fork-dm-guard', li); g.title = w.guard; g.setAttribute('aria-label', w.guard); }
        if (b.admin) el('span', 'fork-dm-admin', li).textContent = w.admin;
        el('b', 'fork-dm-user', li).textContent = (c.author || w.viewer) + '：';
        const parent = c.replyTo ? byId.get(c.replyTo) : null;
        if (parent) { el('span', 'fork-dm-reply', li).textContent = w.reply + (parent.author || w.viewer) + ' '; li.dataset.reply = 'true'; }
        el('span', 'fork-dm-text', li).textContent = c.text;
        return li;
    }
    // 已播: wall time since the player entered the stage — this layer mounts with the stage view and
    // remounts on re-entry, so leaving and coming back starts a new broadcast. Nothing is stored.
    const liveNow = () => clock.now() - st.mountedAt;
    // 已播 ticks on its own second boundaries from the first paint, independent of comment timing or data events; only
    // its text node changes. It stops by itself once the band is gone, hidden or showing a replay.
    let uptimeTimer = null;
    function tickUptime() {
        if(disposed)return;
        clock.clearTimeout(uptimeTimer); uptimeTimer = null;
        const bar = sb && sb.bar;
        if (!bar || !bar.node.isConnected || wrap.hidden || st.view?.mode === 'history') return;
        const ms = liveNow();
        bar.uptime(danmakuClock(ms));
        uptimeTimer = clock.setTimeout(tickUptime, 1000 - (ms % 1000) + 8);
    }
    // Dock in the host's column when it offers one (wide stages), else float over the stage.
    function placeConsole() {
        const slots = typeof dock === 'function' ? dock({ side: 'right' }) : null;
        const column = slots && slots.column, below = slots && slots.below, home = column || wrap, follow = sb.follow;
        // Moving the console resets the list's scroll; drawSidebar puts a reader who was following back on the newest rows
        // once the console has its final size.
        const moved = sb.dock.parentNode !== home;
        if (moved) home.appendChild(sb.dock);
        if (column) sb.dock.dataset.dock = 'right'; else delete sb.dock.dataset.dock;
        if (column && below) { const bar = barFor('band'); if (bar.node.parentNode !== below) below.appendChild(bar.node); delete sb.dock.dataset.bar; }
        else if (!column) { const bar = barFor('float'); if (sb.dock.firstChild !== bar.node) sb.dock.insertBefore(bar.node, sb.dock.firstChild); sb.dock.dataset.bar = 'float'; }
        else dropBar();
        sb.slots = column ? slots : null;
        return { docked: !!column, band: !!(column && below), refollow: moved && follow };
    }
    function releaseDock() {
        if (!sb) return;
        if (sb.bar?.layout === 'band') dropBar();
        if (sb.dock.parentNode !== wrap) wrap.appendChild(sb.dock);
        delete sb.dock.dataset.dock;
        if (sb.slots && typeof dock === 'function') dock(null);
        sb.slots = null;
    }
    // The bar's numbers are the host's recorded snapshot (liveroomModel); a cold paint — the bar's first, a switch between
    // live and 回放, a replay's start, each history page — shows them at once (no roll from the previous page's values).
    function paintBar(err) {
        const bar = sb.bar, info = st.stage || {}, history = st.view.mode === 'history', w = words();
        const key = [st.view.mode, sb.replay, history ? JSON.stringify(st.view.anchor) : ''].join('|');
        if (sb.barReplay !== sb.replay) { sb.barReplay = sb.replay; bar.reset(); }
        const cold = sb.barKey !== key; sb.barKey = key;
        brand(bar.node);
        bar.node.dataset.paused = st.active ? '' : 'true';
        // Frozen numbers (liveroomSnapshot) only within one chat and one mode.
        const scope = st.session + '|' + st.view.mode;
        if (sb.shownScope !== scope) { sb.shownScope = scope; sb.shown = null; }
        sb.shown = liveroom.snapshot(st.view, now(), sb.shown);
        bar.paint(liveroom.model(sb.shown), { name: streamerName(), live: history ? w.replay : st.view.status === 'error' ? w.unavailable : w.live, history, uptime: history ? '' : danmakuClock(liveNow()),
            turn: danmakuTurnText(info), scene: info.scene || '', bgm: info.bgm || '', warn: err, cold, reduced: wrap.dataset.motion === 'reduced', paintFace });
        if (!history) tickUptime(); else { clock.clearTimeout(uptimeTimer); uptimeTimer = null; }
    }
    function drawSidebar(comments, t) {
        sidebarParts();
        // A replay (clip export) starts the chat over: the round's comments come in again with its pages.
        const epoch = danmakuReplayEpoch(st.session);
        if (sb.replay !== epoch) { sb.replay = epoch; clearSidebar(); }
        const placed = placeConsole();
        const v = area(), regions = v.safeRegions || [], wide = r => r.width > v.width * 0.5;
        const topEdge = Math.max(0, ...regions.filter(r => wide(r) && r.y < v.height * 0.3).map(r => r.y + r.height));
        const bottomEdge = Math.min(v.height || 0, ...regions.filter(r => wide(r) && r.y > v.height * 0.4).map(r => r.y));
        wrap.style.setProperty('--fork-dm-top', Math.round(topEdge) + 'px');
        wrap.style.setProperty('--fork-dm-bottom', Math.round(Math.max(0, (v.height || 0) - bottomEdge)) + 'px');
        wrap.dataset.narrow = v.width > 0 && v.width < 560 ? 'true' : '';
        setStatus(sb.live); brand(wrap); brand(sb.dock);
        const w = words(), title = streamerName();
        sb.dock.setAttribute('aria-label', w.chat);
        sb.face.textContent = ''; paintFace(sb.face);
        sb.roomTitle.textContent = title; sb.roomTitle.hidden = !title;
        sb.panelTitle.textContent = w.chat;
        sb.online.textContent = viewersText(t);
        // The live room never shows a backend or model message: one phrase and what to do; details stay in the settings pages.
        const err = st.view.status === 'error' ? w.unavailableRetry : st.view.settings?.model && st.view.settings.model.available === false ? w.unavailableSettings : '';
        sb.warn.hidden = !err; sb.warn.title = err; sb.warn.setAttribute('aria-label', err);
        paintHeat(sb.heat);
        // Every pinned pill counts against the same 32 (contract v3/v4): the list gives up its places.
        const pin = comments.filter(c => c.kind === 'highlight' && c.offsetMs <= t && t < c.offsetMs + c.durationMs).slice(-DANMAKU_LIMITS.pins);
        const room = Math.min(maxVisible, st.view.sidebar?.limit || DANMAKU_LIMITS.sidebarRows) - pin.length;
        const due = comments.filter(c => c.offsetMs <= t && !sb.cut.has(c.id)).slice(-Math.max(0, room));
        const want = new Set(due.map(c => c.id)), medal = medalName(), byId = new Map(comments.map(c => [c.id, c]));
        // Rows carried from earlier pages (sb.kept) stay above the new page's rows; the oldest give way when the room is full.
        const carried = [...sb.list.children].filter(li => !want.has(li.dataset.id) && sb.kept.has(li.dataset.id));
        const drop = new Set(carried.slice(0, Math.max(0, carried.length - Math.max(0, room - due.length))).map(li => li.dataset.id));
        for (const [id, li] of sb.rows) if (!want.has(id) && (!sb.kept.has(id) || drop.has(id))) { li.remove(); sb.rows.delete(id); sb.kept.delete(id); }
        let added = false;
        for (const c of due) if (!sb.rows.has(c.id)) { const li = rowFor(c, medal, byId, t); sb.list.appendChild(li); sb.rows.set(c.id, li); added = true; }
        // Following the newest: pin to the bottom on every draw and once more next frame. A first mount or a remount
        // (phone ⇄ PC layout) draws before the host attaches the layer, when the list has no height yet.
        if (sb.follow) {
            sb.list.scrollTop = sb.list.scrollHeight;
            if (!sb.pinFrame && typeof requestAnimationFrame === 'function') sb.pinFrame = requestAnimationFrame(() => { sb.pinFrame = 0; if (!disposed && sb.follow) sb.list.scrollTop = sb.list.scrollHeight; });
        }
        sb.latest.hidden = sb.follow;
        const newcomer = danmakuNewcomer(comments, t);
        if ((newcomer?.author || null) !== sb.newcomer) {
            sb.newcomer = newcomer?.author || null; sb.ticker.textContent = '';
            if (newcomer) { sb.ticker.append(w.welcome); el('b', null, sb.ticker).textContent = newcomer.author; sb.ticker.append(w.entered); }
        }
        sb.ticker.hidden = !newcomer;
        syncCards(sb.pinned, pin, t, 'pill');
        for (const pill of sb.pinned.children) pill.setAttribute('aria-expanded', String(pill.dataset.id === sb.open));
        const open = pin.find(c => c.id === sb.open);
        if (!open) sb.open = null;
        if ((sb.detail.dataset.id || '') !== (open?.id || '')) {
            sb.detail.textContent = ''; sb.detail.dataset.id = open?.id || '';
            if (open) sb.detail.appendChild(danmakuScNode(doc, open, { variant: 'row', elapsed: 1e7, words: words() }));
        }
        sb.detail.hidden = !open;
        if (sb.bar) paintBar(err);
        // The host drops a layer that exceeds budget.maxNodes (counted over the layer and its dock slots): the oldest rows
        // give way first, so a list of 32 醒目留言 / badge-heavy rows never takes the whole console down.
        const nodes = () => wrap.querySelectorAll('*').length + 1 + (sb.dock.parentNode !== wrap ? sb.dock.querySelectorAll('*').length + 1 : 0) + (sb.bar?.layout === 'band' ? sb.bar.node.querySelectorAll('*').length + 1 : 0);
        for (let n = nodes(); n > maxNodes && sb.list.firstChild;) {
            const li = sb.list.firstChild; n -= li.querySelectorAll('*').length + 1; sb.rows.delete(li.dataset.id); li.remove();
            sb.cut.add(li.dataset.id); if (sb.cut.size > DANMAKU_LIMITS.played) sb.cut.delete(sb.cut.values().next().value);
        }
        sb.dock.dataset.band = placed.band ? 'true' : '';
        if (placed.refollow) { sb.follow = true; sb.list.scrollTop = sb.list.scrollHeight; sb.latest.hidden = true; }
        sb.dock.dataset.paused = st.active ? '' : 'true';
        sb.dock.dataset.motion = wrap.dataset.motion;
        // A new medal name (the player renamed, another card) re-dresses the rows already shown.
        if (sb.medal !== medal) { if (sb.medal !== undefined) for (const m of sb.list.querySelectorAll('.fork-dm-medal')) m.textContent = String(medal).slice(0, 4); sb.medal = medal; }
        let next = Infinity;
        if (newcomer) next = Math.min(next, newcomer.until);
        if (sb.bar) for (const b of st.view.batches) if (b.metrics && b.offsetMs > t) next = Math.min(next, b.offsetMs);
        for (const c of comments) {
            if (c.offsetMs > t) next = Math.min(next, c.offsetMs);
            else if (c.kind === 'highlight' && c.offsetMs + c.durationMs > t) next = Math.min(next, c.offsetMs + c.durationMs);
        }
        return next;
    }
    function clearSidebar() { if (!sb) return; sb.ticker.textContent = ''; sb.newcomer = null; sb.list.textContent = ''; sb.rows.clear(); sb.cut.clear(); sb.kept.clear(); sb.pinned.textContent = ''; sb.detail.textContent = ''; sb.detail.dataset.id = ''; sb.detail.hidden = true; sb.open = null; sb.follow = true; }

    // ================= one draw, one timer
    function draw() {
        if(disposed)return;
        clock.clearTimeout(timer); timer = null;
        const v = st.view, reduced = !!v?.settings?.reducedMotion || !!root.closest?.('[data-reduced-motion]');
        const mine = danmakuPerspective(v, reduced) === layer;
        wrap.hidden = !mine;
        wrap.dataset.paused = st.active ? '' : 'true';
        wrap.dataset.motion = reduced ? 'reduced' : '';
        if (!mine) {
            // Changing perspective hides a view, not its flights, lane bookings or comment history.
            if (!v || v.silent || v.view === 'off') { if (layer === 'overlay') clearOverlay(true); else clearSidebar(); }
            if (layer === 'sidebar') releaseDock();
            return;
        }
        if (danmakuReplayPending(st.session, v)) return;
        const t = now(), comments = danmakuComments(v);
        const next = layer === 'overlay' ? drawOverlay(comments, t) : drawSidebar(comments, t);
        if ((st.active || !wrap.isConnected) && Number.isFinite(next)) timer = clock.setTimeout(draw, Math.max(16, next - t));
    }
    function setActive(active) {
        if (active === st.active) return;
        if (ov) for (const it of ov.items.values()) active ? it.anim?.play() : it.anim?.pause();
        st.active = active;
    }
    const instance=Object.freeze({
        update(arg) {
            if(disposed)return;
            // The host re-applies the view it holds on every sync (geometry, stage facts, resize): the same snapshot does not
            // reset the clock.
            if (arg && arg === st.view) { /* unchanged snapshot */ }
            else if (arg && arg.version === 1 && arg.modId === 'dsh.danmaku') {
                const modeChanged = !!st.view && arg.mode !== st.view.mode, anchorChanged = JSON.stringify(arg.anchor) !== JSON.stringify(st.view?.anchor) || modeChanged, before = now();
                st.base = Number(arg.activeTimeMs) || 0; st.baseAt = clock.now();
                setActive(!!arg.active && !arg.silent);
                st.view = arg;
                rebase(now() - before);
                // A new anchor or a switch to history: 飘屏 lets what flies
                // finish — it stays an obstacle for the new page's comments, whose own records start cold (at their offsets);
                // the console starts the new page. Only closing the room (off, silent), the mod going off or
                // leaving the stage stops a flight. Nothing flies twice in a session (danmakuFlown), not even on a re-read.
                // 直播风格: a page turn keeps the chat — what is shown is carried above the new
                // page's rows. Only a switch between live and replay starts the console over.
                if (anchorChanged) { if (ov) { ov.starts.clear(); ov.warm = false; } if (modeChanged) clearSidebar(); else if (sb) for (const id of sb.rows.keys()) sb.kept.add(id); }
            } else if (arg && arg.viewport) { st.geometry = arg.viewport; if (arg.context && arg.context.stage) st.stage = arg.context.stage; if (arg.context?.sessionId) st.session = arg.context.sessionId; }
            draw();
        },
        stats: () => ({ layer, hidden: wrap.hidden, docked: !!(sb && sb.slots), visible: ov ? ov.items.size : 0, rows: sb ? sb.rows.size : 0, lanes: ov ? ov.lanes.length : 0, nodes: wrap.querySelectorAll('*').length + 1, timer: timer !== null }),
        dispose() {
            if(disposed)return;disposed=true;instances.delete(instance);const errors=[],pendingTimer=timer,pendingUptime=uptimeTimer;
            const cleanup=[()=>clock.clearTimeout(pendingTimer),()=>clock.clearTimeout(pendingUptime),()=>avatar.dispose(),...listeners,
                ()=>sb?.heat.motion?.cancel(),()=>sb?.bar?.dispose(),()=>{if(sb?.pinFrame)cancelAnimationFrame?.(sb.pinFrame);},
                ...[...(ov?.items.values()||[])].map(it=>()=>{if(it.anim){it.anim.onfinish=null;it.anim.cancel();}}),
                ()=>clearOverlay(),()=>clearSidebar(),()=>releaseDock(),()=>sb?.dock.remove(),()=>wrap.remove()];
            timer=null;uptimeTimer=null;listeners.length=0;
            for(const fn of cleanup){try{fn();}catch(error){errors.push(error);}}
            if(errors.length)throw new AggregateError(errors,'Danmaku layer cleanup failed');
        },
    });
    instances.add(instance);return instance;
}
const registrations={
 ['dsh.danmaku/'+DANMAKU_ENTRIES.overlay]:args=>createDanmakuLayer({...args,layer:'overlay'}),
 ['dsh.danmaku/'+DANMAKU_ENTRIES.sidebar]:args=>createDanmakuLayer({...args,layer:'sidebar'}),
};
const previous=new Map(Object.keys(registrations).map(key=>[key,renderers[key]]));
Object.assign(renderers,registrations);
return {create:createDanmakuLayer,replay(...args){if(!closed)session.danmakuReplay(...args);},dispose(){
 if(closed)return;closed=true;const errors=[];
 for(const [key,renderer]of Object.entries(registrations))if(renderers[key]===renderer){if(previous.get(key)===undefined)delete renderers[key];else renderers[key]=previous.get(key);}
 for(const instance of [...instances]){try{instance.dispose();}catch(error){errors.push(error);}}
 if(errors.length)throw new AggregateError(errors,'Danmaku renderer cleanup failed');
}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageDanmaku};
