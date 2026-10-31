function createStageDanmakuDisplay() {
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


return {DANMAKU_LIMITS, DANMAKU_SC_TIERS, danmakuScTier, DANMAKU_ENTRIES, DANMAKU_PLATFORMS, DANMAKU_DEFAULT_PLATFORM, danmakuPlatform, danmakuMedalName, danmakuViewerTrend, danmakuSparkPaths, danmakuNewcomer, danmakuTurnText, dmClamp, danmakuHash, DANMAKU_AREAS, danmakuOverlayPrefs, danmakuBadges, danmakuMedalTier, danmakuClock, danmakuCount, danmakuPrice, danmakuScNode, danmakuColour, danmakuPerspective, danmakuOrder, danmakuComments, danmakuHeatAt, danmakuOnlineAt};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageDanmakuDisplay};
