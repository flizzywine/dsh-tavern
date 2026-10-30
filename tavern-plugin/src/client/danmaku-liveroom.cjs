'use strict';

// the 直播信息栏
// seen from the STREAMER's side — the player is the streamer, so the bar is their own live console (bilibili 直播中心
// 「实时数据」), not a viewer's player bar. Docked under the scaled scene ('band'): a slim head (own face, name, 「直播中
// 01:02」, the 互动 events sliding in, turn / scene / BGM) over four live tiles — 在线 with its line chart and 峰值, 弹幕 / 分
// with the 10-second density bars, the 热度 gauge with the 小时榜 rank, the round's 高能榜 top three. Floating (phones,
// stages without a dock, 'float'): the glass capsule and three small glass tiles over the picture, a new event as a toast.
// Swappable: a platform theme (DANMAKU_PLATFORMS[id].bar in danmaku-stage.cjs) names one entry of
// DANMAKU_LIVEROOM_BARS; another look is another entry plus its CSS block, never a branch here. bilibili → 'dashboard'.
// Data: only the host's recorded snapshots (view.metrics / the page's batch.metrics) through
// liveroomSnapshot + liveroomModel; the bar draws and animates, it never counts. No snapshot (an older round, nothing
// persisted yet) shows 「—」, never a fake zero.
// Motion follows only the stage CONFIG 「减少动态」 (ctx.reduced → data-motion="reduced": every number, chart and card at
// its end state at once). A cold paint (the first one, live ⇄ 回放, a history page) shows the recorded numbers at once
// too: no roll from the previous values, no entry slides — history and replay never flicker.

// The recorded snapshot the bar shows at active time t: the host's rule — the last
// batch of the page already started, its saved batch.metrics — applied at the client's clock, so a history page or a
// 回放 steps through its recording as its batches come due (view.metrics is that same pick at projection time).
// Before the page's first snapshot the numbers stay frozen at the one shown (`shown`), but only when it is truly the state
// just before: live in the same chat (a new page), or the snapshot right before the page's first (sequence n − 1, a
// history page or 回放 reached in order). Otherwise — an older round without metrics, a jump — null: 「—」, never a
// borrowed number. Pure; tests.
function liveroomSnapshot(view, t, shown) {
    const started = view.batches.findLast(b => b.offsetMs <= t && b.metrics)?.metrics || view.metrics;
    if (started || !shown) return started || null;
    const first = view.batches.find(b => b.metrics)?.metrics;
    if (first) return first.sessionId === shown.sessionId && first.sequence === shown.sequence + 1 ? shown : null;
    return view.mode === 'live' ? shown : null;
}
// A snapshot → what the bar draws, or null. Pure; tests.
function liveroomModel(m) {
    if (!m) return null;
    return {
        online: m.online, peak: m.peakOnline, delta: m.onlineDelta, trend: m.onlineSeries.map(p => p.online),
        rate: m.danmakuPerMinute, total: m.commentCount, buckets: m.danmakuBuckets.map(b => b.count),
        heat: m.heat, rank: m.hourlyRank, likes: m.likes, follows: m.newFollowers, captains: m.captains, revenue: m.revenueCny,
        top: m.topContributors.map(p => ({ author: p.author, score: p.score, comments: p.comments, paid: p.scRevenueCny + p.captainRevenueCny })),
        events: m.events.map(e => ({ id: e.id, kind: e.type, author: e.author, value: e.value })),
    };
}

const LIVEROOM_ICONS = Object.freeze({ follow: '♥', captain: '⚓', sc: '¥', 'likes-milestone': '♥', 'rank-milestone': '▲' });
const LIVEROOM_EASE = 'cubic-bezier(.2, .9, .25, 1.06)';

function createLiveroomDashboard(doc, layout) {
    const el = (tag, cls, parent, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; if (parent) parent.appendChild(n); return n; };
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = (tag, attrs, parent) => { const n = doc.createElementNS(svgNs, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); parent.appendChild(n); return n; };
    const words = {
        online: '在线人数', onlineShort: '在线', rate: '弹幕 / 分', heat: '热度', top: '本场高能榜', peak: '峰值 ', total: n => '本场 ' + n + ' 条',
        rank: n => '小时榜 第 ' + n + ' 名', rankShort: n => '小时榜 ' + n, lines: n => n + ' 条', likes: '点赞 ', follows: '关注 +', captains: '舰长 ', revenue: '营收 ',
    };
    // Motion state of the current paint: cold / reduced paints place everything at its end state.
    let still = true;
    const play = (node, frames, options) => { if (!still && typeof node.animate === 'function') node.animate(frames, options); };
    // Entries slide in by a CSS keyframe (class is-new, dropped when it ends); a cold or reduced paint adds none.
    const enter = node => { if (still) return; node.classList.add('is-new'); node.addEventListener('animationend', () => node.classList.remove('is-new'), { once: true }); };

    // An odometer number: one reel per digit (2 nodes: the window and a one-column strip 「0…9」), moved only by transform.
    function roller(parent, cls) {
        const node = el('span', 'fork-lr-roll' + (cls ? ' ' + cls : ''), parent); let text = null;
        node.setAttribute('role', 'img');
        return { node, set(value) {
            const next = String(value); if (next === text) return;
            const old = text, digits = next.replace(/\D/g, ''); text = next;
            node.setAttribute('aria-label', next);
            const shape = s => s.replace(/\d/g, '0');
            if (old === null || shape(old) !== shape(next)) {
                node.textContent = '';
                for (const ch of next) {
                    if (!/\d/.test(ch)) { node.append(ch); continue; }
                    const reel = el('span', 'fork-lr-reel', el('span', 'fork-lr-digit', node), '0123456789');
                    reel.setAttribute('aria-hidden', 'true');
                    reel.style.transform = 'translateY(' + -ch * 10 + '%)';
                    // A new digit count rolls up from 0.
                    if (old !== null) play(reel, [{ transform: 'translateY(0%)' }, { transform: reel.style.transform }], { duration: 650, easing: LIVEROOM_EASE });
                }
                return;
            }
            [...node.querySelectorAll('.fork-lr-reel')].forEach((reel, i) => { reel.style.transform = 'translateY(' + -digits[i] * 10 + '%)'; });
        } };
    }
    // The streamer's face (the 「头像歪了」 fix): a fixed square box (flex none + aspect-ratio) whose image is set only through
    // longhands (danmaku-stage.cjs paintFace, with the avatar crop), and no state rule ever writes the background
    // shorthand, so 回放 cannot reset its size / position.
    function face(parent) { const n = el('span', 'fork-lr-face', parent); n.setAttribute('aria-hidden', 'true'); return n; }
    function livePill(parent) { const live = el('span', 'fork-lr-live', parent); return { live, word: el('span', 'fork-lr-live-word', live), time: el('span', 'fork-lr-live-time', live) }; }
    // A line chart of the online samples; the newest stretch is drawn in (clip reveal), the live point pulses.
    function spark(parent, w, h, cls) {
        const wrap = el('span', 'fork-lr-spark ' + cls, parent); wrap.setAttribute('aria-hidden', 'true');
        const s = svg('svg', { viewBox: '0 0 ' + w + ' ' + h, preserveAspectRatio: 'none' }, wrap);
        const area = svg('path', { class: 'fork-lr-spark-area' }, s), line = svg('path', { class: 'fork-lr-spark-line' }, s), dot = el('i', 'fork-lr-spark-dot', wrap);
        let key = '', count = 0;
        return { set(values) {
            const next = values.join(','); if (next === key) return; key = next;
            const p = danmakuSparkPaths(values, w, h), last = p.line.match(/([\d.]+) ([\d.]+)$/), from = count && values.length > count ? (count - 1) / (values.length - 1) : 0;
            line.setAttribute('d', p.line); area.setAttribute('d', p.area); dot.hidden = !last;
            if (last) { dot.style.left = (last[1] / w * 100) + '%'; dot.style.top = (last[2] / h * 100) + '%'; }
            // First line: drawn left to right; a new sample: only its segment is drawn in.
            if (p.line && (!count || values.length > count)) play(s, [{ clipPath: 'inset(0 ' + (100 - from * 100).toFixed(2) + '% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: count ? 600 : 1100, easing: 'ease-out' });
            count = p.line ? values.length : 0;
        } };
    }
    // Density bars: one per 10-second bucket, scaled by transform (CSS transition); the current bucket is the brand colour.
    function bars(parent, cls) {
        const box = el('span', 'fork-lr-bars ' + cls, parent); box.setAttribute('aria-hidden', 'true');
        return { set(counts) {
            while (box.childElementCount > counts.length) box.lastChild.remove();
            while (box.childElementCount < counts.length) el('i', null, box).style.transform = 'scaleY(0)';
            const hi = Math.max(4, ...counts);
            [...box.children].forEach((b, i) => { b.style.transform = 'scaleY(' + (0.05 + counts[i] / hi * 0.95).toFixed(3) + ')'; b.dataset.now = i === counts.length - 1 ? 'true' : ''; });
        } };
    }
    // One 互动 event: icon + one line. Words from the contract's suggestions.
    function eventNode(e, parent) {
        const n = el('span', 'fork-lr-ev'); n.dataset.kind = e.kind; n.dataset.id = e.id;
        el('i', 'fork-lr-ev-icon', n, LIVEROOM_ICONS[e.kind]).setAttribute('aria-hidden', 'true');
        const body = el('span', 'fork-lr-ev-body', n);
        if (e.kind === 'likes-milestone') { body.append('点赞突破 '); el('b', null, body, danmakuCount(e.value)); }
        else if (e.kind === 'rank-milestone') { body.append('进入小时榜前 '); el('b', null, body, String(e.value)); }
        else {
            el('b', null, body, e.author);
            if (e.kind === 'follow') body.append(' 关注了你');
            else if (e.kind === 'captain') body.append(' 开通了舰长');
            else { body.append(' 发送 '); el('em', null, body, danmakuPrice(e.value)); body.append(' 醒目留言'); }
        }
        parent.insertBefore(n, parent.firstChild);
        return n;
    }

    const node = el('section', 'fork-dm-band fork-lr');
    node.dataset.bar = 'dashboard'; node.dataset.layout = layout;
    const seen = new Set();
    let last = null, toastTimer = null;
    const parts = layout === 'band' ? buildBand() : buildFloat();

    function buildBand() {
        const head = el('div', 'fork-lr-head', node), f = face(head), name = el('b', 'fork-lr-name', head), live = livePill(head);
        const warn = el('span', 'fork-dm-warn', head, '⚠'); warn.setAttribute('role', 'img');
        const lane = el('div', 'fork-lr-lane', head); lane.setAttribute('aria-label', '互动');
        const facts = el('div', 'fork-lr-facts', head), turn = el('span', 'fork-lr-chip', facts), scene = el('span', 'fork-lr-chip', facts), bgm = el('span', 'fork-lr-chip is-bgm', facts);
        const eq = el('i', 'fork-lr-eq', bgm); for (let i = 0; i < 4; i++) el('b', null, eq).style.setProperty('--i', i);
        const bgmText = el('span', null, bgm);
        const tiles = el('div', 'fork-lr-tiles', node);
        const tile = (label, cls) => { const c = el('section', 'fork-lr-tile ' + cls, tiles), top = el('div', 'fork-lr-tile-top', c); el('span', 'fork-lr-label', top, label); return { c, top }; };
        const t1 = tile(words.online, 'is-online'), online = roller(t1.top, 'is-big'), delta = el('span', 'fork-lr-delta', t1.top), peak = el('span', 'fork-lr-meta', t1.top), line = spark(t1.c, 300, 70, 'is-wide');
        const t2 = tile(words.rate, 'is-rate'), rate = roller(t2.top, 'is-big'), total = el('span', 'fork-lr-meta', t2.top), density = bars(t2.c, 'is-wide');
        const t3 = tile(words.heat, 'is-heat'), rank = el('span', 'fork-lr-chip is-rank', t3.top);
        const gauge = svg('svg', { class: 'fork-lr-gauge', viewBox: '0 0 120 66', 'aria-hidden': 'true' }, t3.c);
        svg('path', { class: 'fork-lr-gauge-track', d: 'M10 60A50 50 0 0 1 110 60', pathLength: '100' }, gauge);
        const arc = svg('path', { class: 'fork-lr-gauge-fill', d: 'M10 60A50 50 0 0 1 110 60', pathLength: '100' }, gauge), tip = svg('circle', { class: 'fork-lr-gauge-tip', cx: '10', cy: '60', r: '5.5' }, gauge);
        const heat = roller(el('div', 'fork-lr-gauge-value', t3.c), 'is-big');
        const t4 = tile(words.top, 'is-top'), sum = el('span', 'fork-lr-meta', t4.top), board = el('ol', 'fork-lr-board', t4.c);
        return { f, name, live, warn, lane, turn, scene, bgm, bgmText, eq, online, delta, peak, line, rate, total, density, rank, arc, tip, heat, sum, board };
    }
    function buildFloat() {
        const cap = el('div', 'fork-lr-cap', node), f = face(cap), who = el('div', 'fork-lr-who', cap), name = el('b', 'fork-lr-name', who), live = livePill(who);
        const warn = el('span', 'fork-dm-warn', cap, '⚠'); warn.setAttribute('role', 'img');
        const tiles = el('div', 'fork-lr-mini', node);
        const tile = label => { const c = el('div', 'fork-lr-mini-tile', tiles); el('span', 'fork-lr-label', c, label); return c; };
        const a = tile(words.onlineShort), online = roller(a), line = spark(a, 90, 22, 'is-mini');
        const b = tile(words.rate), rate = roller(b), density = bars(b, 'is-mini');
        const c = tile(words.heat), heat = roller(c), rank = el('span', 'fork-lr-mini-rank', c), meter = el('i', 'fork-lr-meter', c);
        const toast = el('div', 'fork-lr-toast', node); toast.setAttribute('aria-hidden', 'true');
        return { f, name, live, warn, online, line, rate, density, heat, rank, meter, toast };
    }
    // The newest three events in the head lane: new ones slide in from the left, the oldest slides out.
    function syncLane(events) {
        const lane = parts.lane, want = events.slice(-3), ids = new Set(want.map(e => e.id));
        for (const n of [...lane.children]) if (!ids.has(n.dataset.id) && !n.classList.contains('is-leaving')) {
            if (still) { n.remove(); continue; }
            n.classList.add('is-leaving'); n.addEventListener('animationend', () => n.remove(), { once: true });
        }
        const have = new Set([...lane.children].filter(n => !n.classList.contains('is-leaving')).map(n => n.dataset.id));
        for (const e of want) if (!have.has(e.id)) { const n = eventNode(e, lane); if (!seen.has(e.id)) enter(n); }
    }
    // Phones: the newest new event as a toast under the tiles for 6 s (never on a cold paint).
    function toast(events) {
        const fresh = events.filter(e => !seen.has(e.id)).at(-1);
        if (!fresh || last === null) return;
        const box = parts.toast; box.textContent = '';
        enter(eventNode(fresh, box));
        clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.textContent = ''; }, 6000);
    }
    // 高能榜: rows keyed by viewer; a reorder slides the rows to their new places, the score bars grow.
    function syncBoard(top) {
        const board = parts.board, rows = new Map([...board.children].map(li => [li.dataset.author, li]));
        const before = still ? null : new Map([...rows].map(([k, li]) => [k, li.offsetTop]));
        const max = top[0]?.score || 1;
        top.forEach((p, i) => {
            let li = rows.get(p.author);
            if (!li) {
                li = el('li', 'fork-lr-row'); li.dataset.author = p.author;
                el('span', 'fork-lr-medal', li); el('span', 'fork-lr-initial', li, [...p.author][0]); el('span', 'fork-lr-user', li, p.author);
                el('i', 'fork-lr-bar', li).style.transform = 'scaleX(0)'; el('span', 'fork-lr-score', li);
                enter(li);
            }
            rows.delete(p.author);
            if (board.children[i] !== li) board.insertBefore(li, board.children[i] || null);
            li.dataset.rank = String(i + 1); li.children[0].textContent = String(i + 1);
            li.querySelector('.fork-lr-bar').style.transform = 'scaleX(' + (p.score / max).toFixed(3) + ')';
            li.querySelector('.fork-lr-score').textContent = p.paid ? danmakuPrice(p.paid) : words.lines(p.comments);
        });
        for (const li of rows.values()) li.remove();
        if (before) for (const li of board.children) {
            const from = before.get(li.dataset.author), dy = from === undefined ? 0 : from - li.offsetTop;
            if (dy) li.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 500, easing: LIVEROOM_EASE });
        }
    }
    const signed = n => n ? (n > 0 ? '▲' : '▼') + Math.abs(n) : '';

    return {
        node, layout,
        // 已播 ticks on its own (danmaku-stage.cjs tickUptime); only this text node changes.
        uptime(text) { if (parts.live.time.textContent !== text) parts.live.time.textContent = text; },
        // ctx: {name, live (直播中 / 回放), history, uptime, turn, scene, bgm, warn, cold, reduced, paintFace}
        paint(m, ctx) {
            const p = parts;
            still = ctx.cold || ctx.reduced || last === null || !node.isConnected;
            node.dataset.live = ctx.history ? 'replay' : 'live';
            node.dataset.motion = ctx.reduced ? 'reduced' : '';
            // CSS transitions (bars, gauge, digits) jump on a cold paint: the end state at once.
            if (ctx.cold) node.dataset.settle = 'true';
            node.setAttribute('aria-label', ctx.name);
            ctx.paintFace(p.f);
            p.name.textContent = ctx.name; p.live.word.textContent = ctx.live; this.uptime(ctx.uptime);
            p.warn.hidden = !ctx.warn; p.warn.title = ctx.warn; p.warn.setAttribute('aria-label', ctx.warn);
            if (layout === 'band') {
                for (const [chip, text] of [[p.turn, ctx.turn], [p.scene, ctx.scene], [p.bgm, ctx.bgm]]) { chip.hidden = !text; if (chip !== p.bgm) chip.textContent = text; }
                p.bgmText.textContent = ctx.bgm;
            }
            node.dataset.empty = m ? '' : 'true';
            if (!m) {
                // No recorded snapshot: dashes, no charts, no events — never a fake zero.
                for (const r of [p.online, p.rate, p.heat]) r.set('—');
                p.line.set([]); p.density.set([]); p.rank.hidden = true;
                if (layout === 'band') { p.delta.textContent = p.peak.textContent = p.total.textContent = p.sum.textContent = ''; p.arc.style.strokeDashoffset = '100'; p.tip.style.transform = 'rotate(0deg)'; p.lane.textContent = ''; p.board.textContent = ''; }
                else p.meter.style.transform = 'scaleX(0)';
            } else {
                p.online.set(danmakuCount(m.online)); p.rate.set(String(m.rate)); p.heat.set(String(m.heat));
                p.line.set(m.trend); p.density.set(m.buckets);
                const up = !ctx.cold && last && m.rank !== null && last.rank !== null && m.rank < last.rank ? last.rank - m.rank : 0;
                p.rank.hidden = m.rank === null;
                if (layout === 'band') {
                    p.delta.textContent = signed(m.delta); p.delta.dataset.dir = m.delta < 0 ? 'down' : 'up';
                    p.peak.textContent = words.peak + danmakuCount(m.peak); p.total.textContent = words.total(m.total);
                    p.arc.style.strokeDashoffset = String(100 - m.heat); p.tip.style.transform = 'rotate(' + m.heat * 1.8 + 'deg)';
                    p.rank.textContent = m.rank === null ? '' : words.rank(m.rank);
                    if (up) el('em', 'fork-lr-rank-up', p.rank, '▲' + up);
                    p.sum.textContent = [words.likes + danmakuCount(m.likes), words.follows + m.follows, m.captains ? words.captains + m.captains : '', m.revenue ? words.revenue + danmakuPrice(m.revenue) : ''].filter(Boolean).join(' · ');
                    syncLane(m.events); syncBoard(m.top);
                } else {
                    p.rank.textContent = m.rank === null ? '' : words.rankShort(m.rank);
                    p.meter.style.transform = 'scaleX(' + (m.heat / 100).toFixed(3) + ')';
                    if (!still) toast(m.events);
                }
                if (up) play(p.rank, [{ transform: 'scale(1.18)', filter: 'brightness(1.5)' }, { transform: 'none', filter: 'none' }], { duration: 900, easing: 'ease-out' });
                for (const e of m.events) seen.add(e.id);
                if (seen.size > 200) seen.delete(seen.values().next().value);
            }
            if (ctx.cold) { void node.offsetWidth; delete node.dataset.settle; }
            last = m ? { rank: m.rank } : { rank: null };
        },
        // A new 回放 is a new visit: its events may come in again.
        reset() { seen.clear(); last = null; },
        dispose() { clearTimeout(toastTimer); node.remove(); },
    };
}

const DANMAKU_LIVEROOM_BARS = Object.freeze({ dashboard: createLiveroomDashboard });

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = { liveroomSnapshot, liveroomModel, DANMAKU_LIVEROOM_BARS, createLiveroomDashboard };
