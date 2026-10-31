function createStageDanmakuScheduler({DANMAKU_LIMITS}) {
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


return {danmakuLanes, danmakuLaneSets, DANMAKU_GAP, danmakuMotion, danmakuClear, danmakuPickLane, danmakuBook, danmakuLate, danmakuSourceRank, danmakuPlan, danmakuQueueSize};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageDanmakuScheduler};
