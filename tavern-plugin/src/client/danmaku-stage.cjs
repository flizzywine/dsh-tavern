'use strict';

// the two audience-band renderers. Both read the
// same JSON DanmakuView; only the chosen perspective draws comments.
//  - view/overlay.js  飘屏 — what a viewer sees (bilibili): right→left scrolling, top-/bottom-fixed comments, colour and
//    size hints; lanes avoid every host safe region (dialogue box, top bar, choices, widget controls). Passthrough.
//  - view/sidebar.js  直播风格 — what the streamer (the player) sees, laid out like a streamer's own screen (OBS /
//    直播姬): on a wide stage the host yields a right column (dock) for the chat and, when keeping the scene's aspect
//    leaves a band below it, the room band there (a live room's info bar: room face, title, uptime/turn/scene/BGM
//    tags, viewers with their recent trend, heat, the 醒目留言 total — now the platform theme's bar, danmaku-liveroom.cjs). Words and look come from the platform theme (bilibili). Chat
//    rows read like bilibili live: one username colour, viewers told apart only by badges (粉丝牌 / 舰长 / 房管); a
//    reply says 「回复 @名字」 and never indents. 醒目留言 (Super Chat, by amount tier) are a card in the list plus a
//    pill in the pinned strip over the chat for the tier's pin time. Phones and hosts without a dock get the same console
//    floating over the stage. The list scrolls (input regions).
//    In 飘屏 a 醒目留言 is only a short-lived tier card in the corner (the viewer's player shows it, it does not pin).
// Time is the host's active time (activeTimeMs, frozen while inactive); every comment is placed from its absolute
// offsetMs, so live play, remounts and history replay are the same projection. Once placed, a comment moves only by its
// own Web Animation on transform (compositor): a host time correction shifts the motions with the clock, never the
// comment. One timer per layer for the next due comment, a bounded node pool; inactive = zero ticks.

// Contract v3 budget: 32 visible comments in either view (醒目留言 included). 飘屏 scheduling: a comment that finds no
// free lane is held and released when one frees, up to maxWaitMs past its offset (more comments, bursts
// are kept, not dropped); scrolling comments start at least staggerMs apart (a burst enters one after another, not as a
// column at the right edge); a fixed comment may book a row up to bookMs ahead.
// lateMs: a comment trails its own page like real chat
// (the mod places it 1.5-6 s after the page was shown, view comment.sourcePage.shownAtMs); one not yet flying 12 s after
// its page was shown is dropped, wherever the reader is now. Same cap as the mod's admission (controller DANMAKU_LATE_MS).
const DANMAKU_LIMITS = Object.freeze({ overlayVisible: 32, sidebarRows: 32, maxWaitMs: 10000, lateMs: 12000, bookMs: 5000, staggerMs: 150, fixedMs: 4500, played: 400, flown: 4000, pins: 6 });
// 醒目留言 (bilibili live Super Chat; contract v4: highlight.amount ∈ 30/50/100/500/1000/2000 CNY, null otherwise). The
// tiers keep bilibili's SUPER_CHAT colours (light header / saturated body, CSS tokens --gal-dm-sc-<index>-*) and its
// order of pin times — bilibili pins 1 / 2 / 5 / 30 / 60 / 120 min (official SC rules table); a story page lasts far less, so the pin (pinMs, the chat's top
// strip) is 20 s … 2 min of active time and the 飘屏 card (cardMs) 8 … 16 s. fx = strength of the brief entry effect
// (0 slide-in only · 1 a sheen · 2 + a glow · 3 + a second sheen · 4 + a spark burst); reduced motion shows none.
const DANMAKU_SC_TIERS = Object.freeze([
    { amount: 30, pinMs: 20000, cardMs: 8000, fx: 0 },
    { amount: 50, pinMs: 30000, cardMs: 9000, fx: 0 },
    { amount: 100, pinMs: 45000, cardMs: 10000, fx: 1 },
    { amount: 500, pinMs: 60000, cardMs: 12000, fx: 2 },
    { amount: 1000, pinMs: 90000, cardMs: 14000, fx: 3 },
    { amount: 2000, pinMs: 120000, cardMs: 16000, fx: 4 },
].map(Object.freeze));
// The tier of a highlight: {index, amount, pinMs, cardMs, fx}; a highlight without a valid amount (an older record)
// wears the first tier's colours and shows no price. null for ordinary comments. Pure; tests.
function danmakuScTier(comment) {
    if (!comment || comment.kind !== 'highlight') return null;
    const index = DANMAKU_SC_TIERS.findIndex(tier => tier.amount === comment.amount);
    return index >= 0 ? { index, ...DANMAKU_SC_TIERS[index] } : { index: 0, ...DANMAKU_SC_TIERS[0], amount: null };
}
const DANMAKU_ENTRIES = Object.freeze({ overlay: 'view/overlay.js', sidebar: 'view/sidebar.js' });
// Platform themes: everything the player sees while live reads like a real streaming room, bilibili by
// default; later themes (YouTube, 斗鱼, 虎牙, Twitch) are more entries here, never branches in the renderer. A theme is
// one id + its words + its feature flags: the id lands on every surface as data-dm-platform, where theme.css keeps
// that platform's tokens and layout variant (bilibili's are the stage defaults). Built-in, first-party, static — a mod
// resource like the phone's device frame, not a library entry (P6-REQUESTS.md「平台主题」). No word here may say the room
// is simulated: the settings pages say that, the live room never does.
const DANMAKU_PLATFORMS = Object.freeze({
    bilibili: Object.freeze({
        id: 'bilibili',
        words: Object.freeze({ streamer: '主播', live: '直播中', replay: '回放', viewers: '观众', uptime: '已播', heat: '热度', chat: '弹幕', sc: '醒目留言',
            guard: '舰长', admin: '房管', reply: '回复 @', latest: '回到最新', viewer: '观众', medal: '粉丝', welcome: '欢迎 ', entered: ' 进入直播间',
            unavailable: '弹幕暂不可用', unavailableRetry: '弹幕暂不可用，请重新开启弹幕', unavailableSettings: '弹幕暂不可用，请到弹幕设置里检查' }),
        // bilibili live: 粉丝牌 (room medal + level) · 舰长 · 房管 badges on chat rows; 醒目留言 by amount tier.
        badges: Object.freeze({ medal: true, guard: true, admin: true }),
        // The streamer's 直播信息栏: an entry of DANMAKU_LIVEROOM_BARS (danmaku-liveroom.cjs).
        bar: 'dashboard',
    }),
});
const DANMAKU_DEFAULT_PLATFORM = 'bilibili';
// The theme of a view: the host-resolved `view.platform` when it names a built theme, else bilibili. Pure; tests.
function danmakuPlatform(view) { return DANMAKU_PLATFORMS[view && view.platform] || DANMAKU_PLATFORMS[DANMAKU_DEFAULT_PLATFORM]; }
// The room's 粉丝牌 name (P6-REQUESTS F9, decided 2026-10): the streamer's — the player's — display name, first two
// characters; the default player name 「你」 or none falls back to the room title's first two, then the theme's word.
// A host-sent sidebar.medal still wins (danmakuBadges). Pure; tests.
function danmakuMedalName(stage, platform = DANMAKU_PLATFORMS[DANMAKU_DEFAULT_PLATFORM]) {
    const two = s => [...String(s || '').replace(/[\s\p{P}\p{S}]/gu, '')].slice(0, 2).join('');
    const player = String(stage && stage.player || '').trim();
    return (player && player !== '你' ? two(player) : '') || two(stage && stage.title) || platform.words.medal;
}
// The viewers' recent trend for the room band: the online count of every started batch (oldest first) and the count now;
// [] with fewer than three points (a flat line says nothing). Pure; tests.
function danmakuViewerTrend(view, t, limit = 24) {
    const points = (view?.batches || []).filter(b => b.offsetMs <= t && Number.isFinite(b.online)).map(b => b.online).slice(-(limit - 1));
    if (points.length) points.push(danmakuOnlineAt(view, t));
    return points.length >= 3 ? points : [];
}
// An SVG path for a trend in a w×h box: the line ('M…L…') and the area under it (closed). Pure; tests.
function danmakuSparkPaths(values, w = 120, h = 32) {
    if (!values || values.length < 2) return { line: '', area: '' };
    const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1, step = w / (values.length - 1);
    const pts = values.map((v, i) => [Math.round(i * step * 10) / 10, Math.round((h - 2 - (v - lo) / span * (h - 4)) * 10) / 10]);
    const line = pts.map(([x, y], i) => (i ? 'L' : 'M') + x + ' ' + y).join('');
    return { line, area: line + 'L' + w + ' ' + h + 'L0 ' + h + 'Z' };
}
// The newest viewer who spoke for the first time within `windowMs` (bilibili's 「欢迎 … 进入直播间」 line). Pure; tests.
// {author, until} (until = when the line goes away), or null. Pure; tests.
function danmakuNewcomer(comments, t, windowMs = 8000) {
    const seen = new Set(); let last = null;
    for (const c of comments || []) {
        if (!(c.offsetMs <= t) || !c.author) continue;
        if (!seen.has(c.author)) { seen.add(c.author); last = c; }
    }
    return last && t - last.offsetMs < windowMs ? { author: last.author, until: last.offsetMs + windowMs } : null;
}
// '第 129 轮' on the newest turn, '第 12 / 129 轮' while looking back. '' without a turn. Pure; tests.
function danmakuTurnText(stage) {
    const turn = stage && stage.turn, latest = stage && stage.latestTurn;
    if (!Number.isSafeInteger(turn)) return '';
    return '第 ' + turn + (Number.isSafeInteger(latest) && latest !== turn ? ' / ' + latest : '') + ' 轮';
}

const dmClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// FNV-1a: well mixed, so h % small primes stays fair for nicknames that differ only in their last character.
function danmakuHash(key) { let h = 0x811c9dc5; for (const ch of String(key)) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0; return h; }
// 飘屏 viewer preferences (stage CONFIG 弹幕; bilibili's 显示区域 / 不透明度 / 字号). Missing or odd values fall back to
// the defaults. area: share of the free reading band (top bar → dialogue box) the scrolling and top comments use.
const DANMAKU_AREAS = Object.freeze({ quarter: 0.25, half: 0.5, 'three-quarter': 0.75, full: 1 });
function danmakuOverlayPrefs(settings) {
    const s = settings || {}, num = (v, lo, hi, d) => Number.isFinite(Number(v)) && v !== null && v !== '' ? dmClamp(Number(v), lo, hi) : d;
    return { area: DANMAKU_AREAS[s.area] || DANMAKU_AREAS['three-quarter'], alpha: num(s.opacity, 10, 100, 90) / 100, scale: num(s.fontScale, 50, 150, 100) / 100 };
}
// A simulated viewer's badges, bilibili live style: a 粉丝牌 (the room's medal + level), 舰长, 房管. The DTO may carry
// them (comment.badges); otherwise they are derived from the nickname so one viewer always wears the same ones. They
// are decoration only (no money, no gifts). Pure; tests.
function danmakuBadges(comment, medal) {
    const given = comment && comment.badges, fallback = DANMAKU_PLATFORMS[DANMAKU_DEFAULT_PLATFORM].words.medal;
    if (given && typeof given === 'object') return {
        medal: given.medal && Number.isSafeInteger(given.medal.level) ? { name: String(given.medal.name || medal || fallback).slice(0, 4), level: dmClamp(given.medal.level, 1, 40) } : null,
        guard: given.guard === true || given.guard === '舰长', admin: given.admin === true };
    const h = danmakuHash(comment && comment.author || '');
    return { medal: h % 10 < 4 ? { name: String(medal || fallback).slice(0, 4), level: 1 + (h >>> 5) % 21 } : null, guard: h % 23 === 0, admin: h % 31 === 1 };
}
// bilibili fan-medal colour tiers by level: 1–4, 5–8, 9–12, 13–16, 17–20 flat; 21–24, 25–28, 29–32, 33+ gradients.
const danmakuMedalTier = level => Math.min(8, Math.floor((Math.max(1, level) - 1) / 4));
// 01:02:03 / 12:34
function danmakuClock(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000)), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60, p = n => String(n).padStart(2, '0');
    return (hh ? hh + ':' : '') + p(mm) + ':' + p(ss);
}
// 3214 → "3,214"; 12345 → "1.2万"
function danmakuCount(n) {
    const v = Math.max(0, Math.round(Number(n) || 0));
    if (v >= 1e8) return (v / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
    if (v >= 1e4) return (v / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
    return v.toLocaleString('en-US');
}
// '¥2,000'. Pure; tests.
const danmakuPrice = amount => Number.isSafeInteger(amount) && amount > 0 ? '¥' + amount.toLocaleString('en-US') : '';
// A 醒目留言 node, the one builder for every place it shows (also the review page's tier gallery):
//  variant 'card' — the 飘屏 corner card: header (initial, name, price) over the message, a draining time bar;
//  variant 'row'  — the same card as a row of the chat list (no time bar);
//  variant 'pill' — the chat's pinned strip: initial + price on the body colour, the remaining pin time draining behind.
// elapsed = ms since it appeared: animations start that far in, so a remount or history replay never re-fires an effect.
function danmakuScNode(doc, c, { variant = 'card', elapsed = 0, words = DANMAKU_PLATFORMS[DANMAKU_DEFAULT_PLATFORM].words } = {}) {
    const el = (tag, cls, parent) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (parent) parent.appendChild(n); return n; };
    const tier = danmakuScTier({ ...c, kind: 'highlight' }), price = danmakuPrice(tier.amount), name = c.author || words.viewer;
    const node = el(variant === 'pill' ? 'button' : 'div', variant === 'pill' ? 'fork-dm-sc-pill' : 'fork-dm-sc');
    node.dataset.tier = String(tier.index); node.dataset.fx = String(tier.fx); node.dataset.variant = variant; node.dataset.id = c.id;
    node.style.setProperty('--fork-dm-sc-age', -Math.max(0, Math.round(elapsed)) + 'ms');
    const face = () => { const f = el('span', 'fork-dm-sc-face'); f.textContent = [...name][0] || '观'; f.setAttribute('aria-hidden', 'true'); return f; };
    if (variant === 'pill') {
        node.type = 'button';
        const fill = el('i', 'fork-dm-sc-pill-fill', node);
        fill.style.animationDuration = tier.pinMs + 'ms'; fill.style.animationDelay = -Math.max(0, elapsed) + 'ms';
        node.appendChild(face());
        el('span', 'fork-dm-sc-pill-price', node).textContent = price || words.sc;
        node.setAttribute('aria-label', words.sc + ' ' + (price ? price + ' ' : '') + name + '：' + c.text);
        node.title = name + (price ? ' · ' + price : '');
        return node;
    }
    const head = el('div', 'fork-dm-sc-head', node);
    head.appendChild(face());
    el('b', 'fork-dm-sc-user', head).textContent = name;
    if (tier.index >= 3) { const gem = el('i', 'fork-dm-sc-gem', head); gem.setAttribute('aria-hidden', 'true'); if (tier.index === 5) gem.dataset.n = '2'; } // bilibili marks ¥500+ with an icon
    el('span', 'fork-dm-sc-price', head).textContent = price || words.sc;
    el('div', 'fork-dm-sc-text', node).textContent = c.text;
    if (variant === 'card') {
        const bar = el('i', 'fork-dm-sc-time', node);
        bar.style.animationDuration = (c.cardMs || tier.cardMs) + 'ms';
        bar.style.animationDelay = -Math.max(0, elapsed) + 'ms';
    }
    return node;
}
// A model colour is only ever a #RRGGBB hint. Dark hints keep their colour and get a light halo instead of the dark one.
function danmakuColour(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return { colour: hex.toLowerCase(), dark: 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.12 };
}
// Which perspective draws: 'overlay' | 'sidebar' | null (silent / off). Reduced motion shows the static console.
// stageReduced: the stage CONFIG 「减少动态」 read off the layer's own stage (when the host does not put it in the DTO).
function danmakuPerspective(view, stageReduced = false) {
    if (!view || view.silent || view.view === 'off') return null;
    if (view.view === 'sidebar' || view.settings?.reducedMotion || stageReduced) return 'sidebar';
    return 'overlay';
}
const danmakuOrder = (a, b) => a.offsetMs - b.offsetMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// Every comment the view carries, once, in (offsetMs, id) order: batches are the record window; sidebar.items and
// highlights are projections of it but are merged so a host that sends only those still plays.
function danmakuComments(view) {
    const seen = new Map();
    const add = c => { if (c && typeof c.id === 'string' && typeof c.text === 'string' && !seen.has(c.id)) seen.set(c.id, c); };
    for (const batch of view?.batches || []) for (const c of batch.comments || []) add(c);
    for (const c of view?.sidebar?.items || []) add(c);
    for (const c of view?.highlights || []) add(c);
    // A 醒目留言 stays pinned for its tier's time (the chat strip) and shows its 飘屏 card for the shorter cardMs.
    return [...seen.values()].map(c => {
        const tier = danmakuScTier(c), offsetMs = Number(c.offsetMs) || 0;
        if (tier) return { ...c, offsetMs, amount: tier.amount, tier: tier.index, durationMs: tier.pinMs, cardMs: tier.cardMs };
        return { ...c, offsetMs, durationMs: Number(c.durationMs) > 0 ? Number(c.durationMs) : 6500 };
    }).sort(danmakuOrder);
}
// Heat (0..100) at active time t (contract §2): the newest started batch's value, falling linearly to 0 at its
// heatExpiresAtMs, rounded like the runtime so live and history read the same numbers.
function danmakuHeatAt(view, t) {
    const started = (view?.batches || []).filter(b => b.offsetMs <= t);
    const last = started[started.length - 1];
    if (!last) return dmClamp(Number(view?.heat) || 0, 0, 100);
    const span = last.heatExpiresAtMs - last.offsetMs;
    return span > 0 ? dmClamp(Math.round(last.heat * Math.max(0, (last.heatExpiresAtMs - t) / span)), 0, 100) : 0;
}
// Online at active time t (contract §2): max(12, round(online - (heat - heatNow) * 2.4)) of the newest started batch; 0 before any.
function danmakuOnlineAt(view, t) {
    const started = (view?.batches || []).filter(b => b.offsetMs <= t), last = started[started.length - 1];
    if (!last) return Math.max(0, Math.round(Number(view?.online) || 0));
    return Math.max(12, Math.round(last.online - (last.heat - danmakuHeatAt(view, t)) * 2.4));
}

// Lanes: full-width horizontal bands that intersect no safe region. Every free band [{y,height}], top-down.
function danmakuLanes({ width, height, safeRegions = [], laneHeight, margin = 4 }) {
    if (!(width > 0 && height > 0 && laneHeight > 0)) return [];
    const regions = safeRegions.filter(r => r.width > 0 && r.height > 0);
    const free = [];
    let y = margin;
    while (y + laneHeight <= height - margin) {
        const hit = regions.filter(r => y < r.y + r.height + margin && y + laneHeight > r.y - margin);
        if (hit.length) { y = Math.max(...hit.map(r => r.y + r.height + margin)); continue; }
        free.push({ y, height: laneHeight });
        y += laneHeight;
    }
    return free;
}
// Scroll and top-fixed comments use the lanes inside the upper `area` share of the free band's height (bilibili 显示区域;
// at least one, at most maxLanes); bottom-fixed comments stack upward from the lowest free band, just above the box.
function danmakuLaneSets(free, { area = 0.75, maxLanes = 16, bottomLanes = 3 } = {}) {
    if (!free.length) return { upper: [], lower: [] };
    const top = free[0].y, limit = top + (free[free.length - 1].y + free[free.length - 1].height - top) * area + 0.5;
    const upper = free.filter(lane => lane.y + lane.height <= limit).slice(0, maxLanes);
    return { upper: upper.length ? upper : free.slice(0, 1), lower: free.slice(-Math.min(bottomLanes, free.length)).reverse() };
}
// 飘屏 collision model (bursts drew 4–5 comments on top of each other; no two comments may ever overlap).
// A placed comment is linear motion: its left edge is x0 − v·(τ − start) for τ in [start, end), it is w wide and covers
// the rows [y0, y1). A scrolling comment enters at the right edge (x0 = view width, v = (x0 + w) / duration: longer is
// faster, as on bilibili, and it has fully left at end); a fixed one has v = 0. Placed comments keep their own motion when
// the lanes are recomputed (a safe region grew, the window resized), so occupancy never resets under moving text.
const DANMAKU_GAP = 24;
function danmakuMotion({ start, duration, width, viewWidth, y, height, fixed = false }) {
    const x0 = fixed ? Math.max(0, Math.round((viewWidth - width) / 2)) : viewWidth;
    return { x0, v: fixed ? 0 : (viewWidth + width) / duration, w: width, start, end: start + duration, y0: y, y1: y + height };
}
// Two placed comments never touch: they share no rows or no time, or over the time they share one stays wholly ahead
// of the other by `gap` px. Motion is linear, so checking both ends of the shared interval is exact. Pure; tests.
function danmakuClear(a, b, gap = DANMAKU_GAP) {
    if (!(a.y0 < b.y1 && b.y0 < a.y1)) return true;
    const from = Math.max(a.start, b.start), to = Math.min(a.end, b.end);
    if (!(from < to)) return true;
    const x = (m, at) => m.x0 - m.v * (at - m.start);
    const rightOf = (p, q) => x(q, from) - x(p, from) - p.w >= gap && x(q, to) - x(p, to) - p.w >= gap; // q stays right of p
    return rightOf(a, b) || rightOf(b, a);
}
// The first lane in `order` where `motionAt(lane)` is clear of every placed comment; -1 = none free. Pure; tests.
function danmakuPickLane(order, motionAt, placed, gap = DANMAKU_GAP) {
    for (const lane of order) {
        const m = motionAt(lane);
        if (m && placed.every(o => danmakuClear(o, m, gap))) return lane;
    }
    return -1;
}
// A fixed comment with no row free now books the earliest start (≤ limit) at which it is clear of everything placed:
// the moment a scrolling comment's tail has passed its left edge, or a fixed one has gone. {lane, start, motion} | null.
// The booking is an obstacle at once, so scrolling comments stop entering that row and it clears. Pure; tests.
function danmakuBook(order, motionAt, placed, from, limit, gap = DANMAKU_GAP) {
    let best = null;
    for (const lane of order) {
        const probe = motionAt(lane, from); if (!probe) continue;
        const times = [from];
        for (const o of placed) if (o.y0 < probe.y1 && probe.y0 < o.y1) times.push(Math.ceil(o.v > 0 ? o.start + (o.x0 + o.w - probe.x0 + gap) / o.v : o.end) + 1);
        for (const at of times.filter(x => x >= from && x <= limit).sort((a, b) => a - b)) {
            if (best && at >= best.start) break;
            const m = motionAt(lane, at);
            if (placed.every(o => danmakuClear(o, m, gap))) { best = { lane, start: at, motion: m }; break; }
        }
    }
    return best;
}
// Page provenance (view.page {index, anchor, shownAtMs}; comment.sourcePage {index, anchor, shownAtMs}). Pure; tests.
// Too late: not flying yet more than lateMs after its own page was shown. An untagged comment (a record saved by an older
// mod, a re-read page's earlier session) is measured from its own placement: a cold pass staggered after the previous page
// must not resurrect one whose time passed long ago.
const danmakuLate = (c, t, lateMs = DANMAKU_LIMITS.lateMs) => t - (Number.isFinite(c?.sourcePage?.shownAtMs) ? c.sourcePage.shownAtMs : c.offsetMs) > lateMs;
// 0 = about the visible page (or untagged), 1 = an earlier page's tail (or another body's): the visible page goes first.
function danmakuSourceRank(c, page) {
    const from = c?.sourcePage;
    if (!page || !from || !Number.isSafeInteger(from.index) || !Number.isSafeInteger(page.index)) return 0;
    return from.anchor?.sourceKey === page.anchor?.sourceKey && from.index >= page.index ? 0 : 1;
}
// One pass of the 飘屏 scheduler (bilibili-like). Shared by the renderer and the tests. Pure.
//  due     comments neither shown nor dropped yet, (offsetMs, id) order; placed = motions on screen now; t = active time.
//  opts    {viewWidth, lanes, lower (bands {y,height}), size(c) → {w, h} measured once per comment, warm, lastStart, room,
//          prefer(c) → lane | -1, starts(id) → an earlier start | undefined, held(id) → already queued, gap, staggerMs,
//          maxWaitMs, maxQueue, retryMs, page (view.page), lateMs}
// A scrolling comment takes the first lane (a reply first tries the lane under its parent's) where it never touches a
// comment on screen: the one ahead has fully entered (+gap) and, when the new one is longer (faster), has left before
// being caught. Top-fixed comments take the first lane top-down, bottom-fixed the lowest first, clear of everything they
// would cover; they go first in a pass and may book a row up to bookMs ahead (danmakuBook) — a row under steady traffic
// is otherwise never clear. Scroll starts are at least staggerMs apart, so a burst enters one after another. When
// nothing fits the comment is held (retried every retryMs; it enters at the right edge when it goes) until maxWaitMs
// past its offset, then it is dropped; a queue longer than maxQueue (what the lanes can release in that time,
// danmakuQueueSize) drops its oldest first. A cold pass (first draw after a mount, an anchor change or a view switch)
// places comments at their absolute offsets — mid-flight — so a remount or a history replay shows what is on screen at
// that moment; a warm pass (live play) and a held comment start now, at the right edge.
// With page provenance: a comment that has not started and is more than lateMs past its own page's show is dropped;
// the visible page's comments take lanes before an earlier page's tail, and an overfull queue sheds the tail first.
// What already flies is never touched (it is not in `due`).
// → {place: [{c, lane, mode, motion}], drop: [id], queue: [c] still held, next, lastStart}
function danmakuPlan(due, placed, t, o) {
    const gap = o.gap ?? DANMAKU_GAP, stagger = o.staggerMs ?? DANMAKU_LIMITS.staggerMs, maxWait = o.maxWaitMs ?? DANMAKU_LIMITS.maxWaitMs;
    const lanes = o.lanes || [], lower = o.lower || [], W = o.viewWidth, on = [...placed], place = [], drop = [], waiting = [];
    let next = Infinity, last = Number.isFinite(o.lastStart) ? o.lastStart : -Infinity, room = o.room ?? Infinity;
    const fixedMode = c => c.mode === 'top' || c.mode === 'bottom';
    const rank = c => danmakuSourceRank(c, o.page), lateMs = o.lateMs ?? DANMAKU_LIMITS.lateMs;
    const byRank = list => [...list.filter(c => !rank(c)), ...list.filter(c => rank(c))];
    for (const c of [...byRank(due.filter(fixedMode)), ...byRank(due.filter(c => !fixedMode(c)))]) {
        if (c.offsetMs > t) { next = Math.min(next, c.offsetMs); continue; }
        const known = o.starts?.(c.id);
        if (!Number.isFinite(known) && danmakuLate(c, t, lateMs)) { drop.push(c.id); continue; } // far behind the picture
        const mode = fixedMode(c) ? c.mode : 'scroll', scroll = mode === 'scroll';
        const ms = scroll ? c.durationMs : Math.min(c.durationMs, DANMAKU_LIMITS.fixedMs);
        let s = Number.isFinite(known) ? known : o.warm || o.held?.(c.id) ? t : c.offsetMs;
        if (scroll && !Number.isFinite(known)) s = Math.max(s, last + stagger);
        if (s + ms <= t) { drop.push(c.id); continue; } // already over: counts as played
        if (s > t) { next = Math.min(next, s); waiting.push(c); continue; } // staggered: its turn comes at s
        const set = mode === 'bottom' ? lower : lanes, { w, h } = o.size(c);
        const motionAt = (lane, start = s) => set[lane] && danmakuMotion({ start, duration: ms, width: w, viewWidth: W, y: Math.round(set[lane].y + (set[lane].height - h) / 2), height: h, fixed: !scroll });
        const order = [...set.keys()], prefer = scroll && o.prefer ? o.prefer(c) : -1;
        if (prefer >= 0 && prefer < order.length) order.unshift(...order.splice(prefer, 1));
        const lane = room > 0 ? danmakuPickLane(order, motionAt, on, gap) : -1;
        const booked = lane < 0 && !scroll && room > 0 && maxWait > 0 ? danmakuBook(order, motionAt, on, s, s + DANMAKU_LIMITS.bookMs, gap) : null;
        if (lane >= 0 || booked) {
            const motion = booked ? booked.motion : motionAt(lane);
            place.push({ c, lane: booked ? booked.lane : lane, mode, motion }); on.push(motion); room--;
            if (scroll) last = Math.max(last, s);
        } else if (t - c.offsetMs >= maxWait) drop.push(c.id); // stale: never drawn over another comment
        else { waiting.push(c); next = Math.min(next, t + (o.retryMs ?? 100)); }
    }
    const over = Math.max(0, waiting.length - (o.maxQueue ?? Infinity));
    // Shed the oldest of an earlier page's tail first, then the oldest of the visible page.
    const shed = new Set([...waiting].sort((a, b) => rank(b) - rank(a)).slice(0, over));
    drop.push(...[...shed].map(c => c.id));
    return { place, drop, queue: waiting.filter(c => !shed.has(c)), next, lastStart: last };
}
// How many held comments the lanes can release within maxWaitMs: a lane takes the next comment once a typical one
// (`width` px) has entered with its gap, and starts are staggerMs apart overall. Pure; tests.
function danmakuQueueSize({ lanes, viewWidth, width, durationMs = 6500, maxWaitMs = DANMAKU_LIMITS.maxWaitMs, staggerMs = DANMAKU_LIMITS.staggerMs, gap = DANMAKU_GAP }) {
    const laneMs = durationMs * (width + gap) / (viewWidth + width);
    return Math.max(1, Math.floor(Math.min(lanes * maxWaitMs / laneMs, maxWaitMs / staggerMs)));
}

// A comment flies once per stage session. The ids a 飘屏 layer has drawn,
// dropped or seen finish outlive the layer: the host remounts it (page turns used to, a view switch, re-entering the
// stage) and the server re-reads a page's records with its clock at their offsets, so per-layer memory alone replayed
// the newest comments on every remount. History stays readable in the 直播风格 list; it never flies twice.
const DANMAKU_FLOWN = new Map();
function danmakuFlown(session) {
    const key = String(session || '');
    let set = DANMAKU_FLOWN.get(key);
    if (!set) { set = new Set(); DANMAKU_FLOWN.set(key, set); if (DANMAKU_FLOWN.size > 8) DANMAKU_FLOWN.delete(DANMAKU_FLOWN.keys().next().value); }
    return set;
}
function danmakuMarkFlown(session, id) {
    const set = danmakuFlown(session);
    set.add(id); if (set.size > DANMAKU_LIMITS.flown) set.delete(set.values().next().value);
}
// A clip export's replay of a round (the player has no replay) is the exception: while it plays,
// the round's comments fly again (a fresh flown set, every layer forgets what it played); when it ends, what had flown
// before counts as flown again. visit = the replay's stage visit: the host re-shows each page for it
// (view.page.visit), so until that view arrives the layer draws nothing — the view from before the replay would otherwise
// drop its long-past comments as late and count them as flown before the replay's own view could fly them.
const DANMAKU_REPLAY = new Map();
function danmakuReplay(session, on, visit = null) {
    const key = String(session || ''), saved = DANMAKU_REPLAY.get(key);
    if (on) { DANMAKU_REPLAY.set(key, { flown: saved?.flown || danmakuFlown(key), epoch: (saved?.epoch || 0) + 1, visit: visit === null ? null : String(visit) }); DANMAKU_FLOWN.set(key, new Set()); }
    else if (saved?.flown) { for (const id of danmakuFlown(key)) saved.flown.add(id); DANMAKU_FLOWN.set(key, saved.flown); DANMAKU_REPLAY.set(key, { flown: null, epoch: saved.epoch, visit: null }); }
}
// True while a replay waits for its own view (see above).
function danmakuReplayPending(session, view) {
    const replay = DANMAKU_REPLAY.get(String(session || ''));
    return !!replay?.flown && replay.visit !== null && String(view?.page?.visit ?? '') !== replay.visit;
}

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
        ov = { stage, corner, hud, live, online, cards, cardOf: new Map(), queue: new Map(), held: new Map(), lanes: [], lower: [], capLanes: 0, items: new Map(), starts: new Map(), widths: new Map(), laneOf: new Map(), pool: [], fonts: {}, canvas: null, key: '', warm: false, lastStart: -Infinity, replay: DANMAKU_REPLAY.get(String(st.session || ''))?.epoch || 0 };
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
        ov.items.delete(id); it.anim?.cancel(); it.node.remove();
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
            it.anim.onfinish = () => dropItem(c.id);
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
        const epoch = DANMAKU_REPLAY.get(String(st.session || ''))?.epoch || 0;
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
        pinned.addEventListener('click', event => { const pill = event.target.closest('.fork-dm-sc-pill'); if (pill) openPin(pill.dataset.id); });
        dock.addEventListener('keydown', event => { if (event.key === 'Escape' && sb.open) { const id = sb.open; event.stopPropagation(); openPin(id); pinned.querySelector('[data-id="' + CSS.escape(id) + '"]')?.focus(); } });
        // Scrolling or clicking the chat must not also turn the page (the stage owns wheel/click/keys on its root).
        for (const type of ['wheel', 'click', 'pointerdown', 'touchstart', 'keydown']) dock.addEventListener(type, event => { if (event.target.closest('[data-mod-input]')) event.stopPropagation(); }, { passive: true });
        list.addEventListener('scroll', () => { sb.follow = list.scrollTop + list.clientHeight >= list.scrollHeight - 8; latest.hidden = sb.follow; }, { passive: true });
        latest.addEventListener('click', () => { sb.follow = true; list.scrollTop = list.scrollHeight; latest.hidden = true; });
        return sb;
    }
    // The streamer's 直播信息栏: the platform theme's bar (danmaku-liveroom.cjs) — 'band' under the docked scene,
    // 'float' at the top of the floating console (phones, no dock), where it replaces the room capsule. One instance per
    // layout; switching layout builds the other one (its first paint is cold).
    function barFor(layout) {
        if (sb.bar?.layout === layout) return sb.bar;
        sb.bar?.dispose();
        sb.bar = DANMAKU_LIVEROOM_BARS[danmakuPlatform(st.view).bar](doc, layout); sb.barKey = '';
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
        sb.shown = liveroomSnapshot(st.view, now(), sb.shown);
        bar.paint(liveroomModel(sb.shown), { name: streamerName(), live: history ? w.replay : st.view.status === 'error' ? w.unavailable : w.live, history, uptime: history ? '' : danmakuClock(liveNow()),
            turn: danmakuTurnText(info), scene: info.scene || '', bgm: info.bgm || '', warn: err, cold, reduced: wrap.dataset.motion === 'reduced', paintFace });
        if (!history) tickUptime(); else { clock.clearTimeout(uptimeTimer); uptimeTimer = null; }
    }
    function drawSidebar(comments, t) {
        sidebarParts();
        // A replay (clip export) starts the chat over: the round's comments come in again with its pages.
        const epoch = DANMAKU_REPLAY.get(String(st.session || ''))?.epoch || 0;
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
            if (!sb.pinFrame && typeof requestAnimationFrame === 'function') sb.pinFrame = requestAnimationFrame(() => { sb.pinFrame = 0; if (sb.follow) sb.list.scrollTop = sb.list.scrollHeight; });
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
    return Object.freeze({
        update(arg) {
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
        dispose() { clock.clearTimeout(timer); timer = null; clock.clearTimeout(uptimeTimer); uptimeTimer = null; sb?.heat.motion?.cancel(); sb?.bar?.dispose(); if (sb?.pinFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(sb.pinFrame); clearOverlay(); clearSidebar(); releaseDock(); wrap.remove(); },
    });
}
// Static renderer registry for the host layer (keyed modId/entry, as createModUiLayerHost looks them up).
const DANMAKU_RENDERERS = Object.freeze({
    ['dsh.danmaku/' + DANMAKU_ENTRIES.overlay]: args => createDanmakuLayer({ ...args, layer: 'overlay' }),
    ['dsh.danmaku/' + DANMAKU_ENTRIES.sidebar]: args => createDanmakuLayer({ ...args, layer: 'sidebar' }),
});

// First-party static registration in the host's application-owned stage renderer table (mod-stage-layers.js,
// included before this file); idempotent.
if (typeof MOD_STAGE_RENDERERS === 'object' && MOD_STAGE_RENDERERS) Object.assign(MOD_STAGE_RENDERERS, DANMAKU_RENDERERS);

// The host face's image source, or null: only an image URL the stage may load as a CSS background. Pure; tests.
function danmakuAvatarSrc(view) {
    const src = view?.streamer?.avatar?.src;
    return typeof src === 'string' && src.length <= 2000000 && /^(data:image\/(png|jpeg|webp|gif);base64,|blob:|\/(?!\/))/.test(src) ? src : null;
}
// view.streamer.avatar.crop — the fraction box {x, y, w, h} of the sprite the panel's avatar shows — or null. Pure; tests.
function danmakuCrop(crop) {
    const ok = crop && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(crop[k])) && crop.w > 0 && crop.h > 0 && crop.x >= 0 && crop.y >= 0 && crop.x + crop.w <= 1.0001 && crop.y + crop.h <= 1.0001;
    return ok ? crop : null;
}
// The background (CSS size and position, in %) that fills a round face with a crop of a width × height image: the crop's
// shorter side spans the face, centred on the crop. Pure; tests.
function danmakuFaceCrop(crop, width, height) {
    const side = Math.min(crop.w * width, crop.h * height), w = width / side, h = height / side;
    const at = (size, centre) => Math.abs(1 - size) < 1e-6 ? 50 : (0.5 - centre) / (1 - size) * 100, pct = n => Math.round(n * 1000) / 1000 + '%';
    return { size: pct(w * 100) + ' ' + pct(h * 100), position: pct(at(w, (crop.x + crop.w / 2) * w)) + ' ' + pct(at(h, (crop.y + crop.h / 2) * h)) };
}
// A sprite's natural size, read once per source for the page: {width, height}, or null while it loads (then `ready`).
const danmakuFaceSizes = new Map();
function danmakuFaceSize(src, ready) {
    const known = danmakuFaceSizes.get(src);
    if (known && known.width) return known;
    if (known) { known.waiting.add(ready); return null; }
    const entry = { waiting: new Set([ready]) }, img = new Image();
    danmakuFaceSizes.set(src, entry);
    if (danmakuFaceSizes.size > 16) danmakuFaceSizes.delete(danmakuFaceSizes.keys().next().value);
    img.onload = () => { entry.width = img.naturalWidth; entry.height = img.naturalHeight; for (const fn of entry.waiting) fn(); entry.waiting.clear(); };
    img.onerror = () => { danmakuFaceSizes.delete(src); };
    img.src = src;
    return null;
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = { danmakuAvatarSrc, danmakuCrop, danmakuFaceCrop, DANMAKU_LIMITS, danmakuFlown, danmakuMarkFlown, danmakuReplay, danmakuReplayPending, DANMAKU_ENTRIES, DANMAKU_PLATFORMS, danmakuPlatform, danmakuMedalName, danmakuViewerTrend, danmakuSparkPaths, danmakuNewcomer, danmakuTurnText, DANMAKU_SC_TIERS, danmakuScTier, danmakuPrice, danmakuScNode, DANMAKU_RENDERERS, danmakuHash, danmakuOverlayPrefs, danmakuBadges, danmakuMedalTier, danmakuClock, DANMAKU_AREAS, danmakuCount, danmakuColour, danmakuPerspective, danmakuComments, danmakuHeatAt, danmakuOnlineAt, danmakuLanes, danmakuLaneSets, DANMAKU_GAP, danmakuMotion, danmakuClear, danmakuPickLane, danmakuBook, danmakuLate, danmakuSourceRank, danmakuPlan, danmakuQueueSize, createDanmakuLayer };
