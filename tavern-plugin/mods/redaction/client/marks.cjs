'use strict';
// 数据删除 on the stage: a mark the director put over words of a paragraph (the redact command, a text mark; the stage
// lays it out as one typing step, text-marks.cjs). Tapping it REDACTION_TAPS times opens it:
//   bar     an ink bar the size of the words; each tap rubs a patch of it off with an eraser drawn on a canvas (seeded by
//           the mark and the tap, so it rubs differently every time but the same on every redraw), the words show where
//           it rubbed; what the eraser leaves (grit, graphite) stays, redrawn from the taps after a reload too.
//   glitch  flickering mojibake of the words' width; each tap settles a third of it, the last tap the rest.
// A tap on a mark never turns the page. With reduced motion nothing shakes or flickers and the third tap shows the words.
// Taps are kept per game in the host (host/extension.js), so an opened mark stays open on another device and after a reload.
const REDACTION_TAPS = 3;
const ERASE_MS = 420, SETTLE_MS = 1600;
// Full-width cover glyphs for full-width words, ASCII ones for ASCII: a cover keeps the words' width.
const MOJIBAKE_WIDE = '锟斤拷烫屯＃％＆＠￥※縺繧譁', MOJIBAKE_NARROW = '#%&@$?*!';
const wide = glyph => glyph.codePointAt(0) > 0x2e7f;
function stageRandom(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; s = (s ^ (s >>> 13)) >>> 0; return s / 4294967296; };
}
function textSeed(text) { let h = 2166136261; for (const c of String(text)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; }
// What a glitch cover shows at `tick`: the words' glyphs, the first `settled` of them already in place.
function glitchCover(words, settled, tick) {
    return words.map((glyph, i) => {
        if (i < settled || /\s/.test(glyph)) return glyph;
        const pool = wide(glyph) ? MOJIBAKE_WIDE : MOJIBAKE_NARROW;
        return pool[(Math.imul(i * 31 + tick * 17 + 7, 2654435761) >>> 16) % pool.length];
    }).join('');
}
// One tap's dabs, [x, y, angle, pressure, last] in bar units (0..1 across, 0..1 down): the first taps rub back and forth
// over their own third (3-5 passes), the last over the whole bar (8-11 passes, a little harder).
function eraserDabs(seed, tap, aspect) {
    const r = stageRandom(seed + tap * 7919), dabs = [];
    const last = tap === REDACTION_TAPS - 1;
    const centre = last ? 0.5 : (tap + 0.5) / REDACTION_TAPS + (r() - 0.5) * 0.12, half = last ? 0.62 : 0.12 + r() * 0.1;
    const passes = last ? 8 + Math.floor(r() * 4) : 3 + Math.floor(r() * 3);
    let x = centre - half * (0.4 + r() * 0.6), y = 0.3 + r() * 0.4;
    for (let p = 0; p < passes; p++) {
        const to = Math.min(1.04, Math.max(-0.04, centre + (p % 2 ? 1 : -1) * half * (0.55 + r() * 0.45)));
        const toY = last ? 0.08 + r() * 0.84 : 0.1 + r() * 0.8, bend = (r() - 0.5) * 0.5, angle = (r() - 0.5) * 0.5, pressure = last ? 0.35 + r() * 0.3 : 0.25 + r() * 0.35;
        const steps = Math.max(6, Math.round(Math.abs(to - x) * aspect * 9));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            dabs.push([x + (to - x) * t, y + (toY - y) * t + bend * Math.sin(Math.PI * t), angle + (r() - 0.5) * 0.2, Math.min(1, Math.max(0.1, pressure + (r() - 0.5) * 0.25)), last]);
        }
        x = to; y = toY;
    }
    return dabs;
}

// rpc: the host's RPC (absent in an offline page: taps stay in this page)
function createRedactionMarks({React, window, rpc}) {
    const h = React.createElement, document = window.document;
    // ---- taps, per game: {turns: {<turn>: {source, marks: {"para:index": taps}}}}, read once, written per tap ----
    const games = new Map(), fresh = new Map(), subscribers = new Set();
    let version = 0;
    const changed = () => { version++; subscribers.forEach(fn => fn()); };
    const subscribe = fn => { subscribers.add(fn); return () => subscribers.delete(fn); };
    const keyOf = (place, index) => JSON.stringify([place.sessionId, place.turn, place.source, place.para, index]);
    function game(sessionId) {
        if (!games.has(sessionId)) {
            const value = {turns:{}};
            games.set(sessionId, value);
            if (sessionId && rpc) rpc('getStageRedactions', {sessionId}, sessionId).then(result => {
                if (result?.status !== 'ready') return;
                // taps made while it loaded stay: they are in the host too, and at least as many
                for (const [turn, row] of Object.entries(result.turns || {})) {
                    const mine = value.turns[turn];
                    value.turns[turn] = mine && mine.source === row.source
                        ? {source:row.source, marks:Object.fromEntries([...new Set([...Object.keys(row.marks), ...Object.keys(mine.marks)])].map(key => [key, Math.max(row.marks[key] || 0, mine.marks[key] || 0)]))}
                        : mine && mine.source !== row.source ? mine : row;
                }
                changed();
            }, () => {});
        }
        return games.get(sessionId);
    }
    function tapsOf(place, index) {
        const row = game(place.sessionId).turns[place.turn];
        return row && row.source === place.source ? row.marks[place.para + ':' + index] || 0 : 0;
    }
    function tap(place, index) {
        const value = game(place.sessionId), now = tapsOf(place, index);
        if (now >= REDACTION_TAPS) return;
        const row = value.turns[place.turn]?.source === place.source ? value.turns[place.turn] : {source:place.source, marks:{}};
        value.turns[place.turn] = {source:place.source, marks:{...row.marks, [place.para + ':' + index]:now + 1}};
        fresh.set(keyOf(place, index), Date.now());
        changed();
        if (rpc && place.sessionId && place.source) rpc('tapStageRedaction', {sessionId:place.sessionId, turn:place.turn, source:place.source, para:place.para, index}, place.sessionId).catch(() => {});
    }
    function useTaps(place, index) {
        React.useSyncExternalStore(subscribe, () => version);
        return {count:tapsOf(place, index), at:fresh.get(keyOf(place, index)) || 0};
    }
    // Milliseconds since `at`, redrawn every 40 ms until `until`.
    function useElapsed(at, until) {
        const [, setTick] = React.useState(0);
        const elapsed = at ? Date.now() - at : Infinity;
        React.useEffect(() => {
            if (!(elapsed < until)) return;
            const timer = window.setTimeout(() => setTick(n => n + 1), 40);
            return () => window.clearTimeout(timer);
        });
        return elapsed;
    }
    // ---- bar: the ink bar and its eraser ----
    // The eraser tip: a worn rectangle with a gritty grip (22% of it lifts only a little), soft at the edges.
    function eraserTip(size, seed) {
        const tip = document.createElement('canvas'), w = Math.max(4, Math.round(size * 0.55)), hgt = Math.max(4, Math.round(size));
        tip.width = w; tip.height = hgt;
        const g = tip.getContext('2d'), img = g.createImageData(w, hgt), r = stageRandom(seed);
        for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) {
            const ex = Math.min(i, w - 1 - i) / (w * 0.22), ey = Math.min(j, hgt - 1 - j) / (hgt * 0.18);
            const edge = Math.min(1, ex) * Math.min(1, ey), grit = r();
            img.data[(j * w + i) * 4 + 3] = Math.round(255 * edge * (grit < 0.22 ? 0.1 : 0.5 + grit * 0.5));
        }
        g.putImageData(img, 0, 0);
        return tip;
    }
    function EraserCanvas({seed, count, since, still}) {
        const ref = React.useRef(null), tips = React.useRef(null);
        React.useLayoutEffect(() => {
            const canvas = ref.current, host = canvas?.parentElement;
            if (!canvas || !host) return;
            const box = host.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
            const em = parseFloat(window.getComputedStyle(host).fontSize) || 16, pad = 0.3 * em;
            const W = Math.max(1, Math.round((box.width + 2 * pad) * dpr)), H = Math.max(1, Math.round((box.height + 2 * pad) * dpr));
            if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
            Object.assign(canvas.style, {left:-pad + 'px', top:-pad + 'px', width:(box.width + 2 * pad) + 'px', height:(box.height + 2 * pad) + 'px'});
            const g = canvas.getContext('2d'), ink = window.getComputedStyle(canvas).color;
            const x0 = pad * dpr, bw = box.width * dpr, y0 = (pad + 0.1 * em) * dpr, bh = Math.max(1, (box.height - 0.12 * em) * dpr);
            g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, W, H);
            g.fillStyle = ink; g.fillRect(x0 - 0.04 * em * dpr, y0, bw + 0.08 * em * dpr, bh);
            if (still) return;
            if (!tips.current || tips.current.size !== Math.round(bh)) tips.current = {size:Math.round(bh), tip:eraserTip(bh * 0.95, seed), smear:eraserTip(bh * 1.3, seed + 1)};
            const {tip, smear} = tips.current;
            for (let t = 0; t < count; t++) {
                const dabs = eraserDabs(seed, t, bw / bh);
                const shown = t < count - 1 ? dabs.length : Math.floor(dabs.length * Math.min(1, since / ERASE_MS));
                for (let i = 0; i < shown; i++) {
                    const [u, v, angle, pressure, last] = dabs[i], cx = x0 + u * bw, cy = y0 + v * bh;
                    g.setTransform(Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), cx, cy);
                    g.globalCompositeOperation = 'destination-out'; g.globalAlpha = pressure;
                    g.drawImage(tip, -tip.width / 2, -tip.height / 2);
                    // graphite dragged along: a faint smear behind the tip (too much would ink the rubbed patch again)
                    if (i % 5 === 0) { g.globalCompositeOperation = 'source-over'; g.globalAlpha = (last ? 0.008 : 0.02) * (1.2 - pressure); g.drawImage(smear, -smear.width / 2 - tip.width * 0.6, -smear.height / 2); }
                }
            }
            g.setTransform(1, 0, 0, 1, 0, 0);
        });
        return h('canvas', {ref, className:'fork-erase-canvas', 'aria-hidden':true});
    }
    // Eraser crumbs shaken off by a tap: rolled bits of different sizes that drop and tumble out of the box.
    function Crumbs({seed, since}) {
        const r = stageRandom(seed), t = since / 700;
        return h('span', {className:'fork-erase-crumbs', 'aria-hidden':true}, Array.from({length:5 + Math.floor(r() * 4)}, (_, i) => {
            const x = r() * 100, size = 0.06 + r() * 0.09, drift = (r() - 0.5) * 0.8, fall = 0.6 + r() * 0.9;
            return h('i', {key:i, 'data-fk-layer':'', style:{left:x + '%', width:size + 'em', height:size * (0.6 + r() * 0.6) + 'em',
                transform:'translate(' + (drift * t).toFixed(3) + 'em,' + (fall * t * t + 0.1).toFixed(3) + 'em) rotate(' + Math.round(r() * 360 + t * 200) + 'deg)', '--fk-layer-opacity':(1 - t).toFixed(2)}});
        }));
    }
    // ---- glitch ----
    function Glitch({text, settled, settling, still}) {
        const [tick, setTick] = React.useState(0);
        const words = Array.from(text), done = settled >= words.length;
        const shown = settling ? Math.min(words.length, settled + Math.floor(settling / 70)) : settled;
        React.useEffect(() => {
            if (still || done && !settling) return;
            const timer = window.setTimeout(() => setTick(n => n + 1), 90);
            return () => window.clearTimeout(timer);
        }, [tick, done, settling, still]);
        return glitchCover(words, shown, still ? 0 : tick);
    }
    // ---- the mark ----
    // mark: {params: {quote, kind}, index}; text: the words of it shown here (a mark cut at a page edge shows part);
    // place: {sessionId, turn, source, para}, where its taps are kept; still: no motion (reduced motion).
    function RedactionMark({mark, text, place, still}) {
        const kind = mark.params?.kind === 'glitch' ? 'glitch' : 'bar';
        const {count, at} = useTaps(place, mark.index);
        const open = count >= REDACTION_TAPS, since = useElapsed(still ? 0 : at, SETTLE_MS);
        const stop = event => event.stopPropagation();
        const press = event => { stop(event); event.preventDefault?.(); tap(place, mark.index); };
        const shake = since < 240 ? [0, .06, -.06, .04, -.03, 0][Math.floor(since / 40)] : 0;
        const props = {className:'fork-redact', 'data-redact':kind, 'data-revealed':open || undefined, 'data-taps':count || undefined,
            'data-fresh':open && since < SETTLE_MS || undefined, style:shake ? {'--shake':shake + 'em'} : undefined,
            ...(open ? {} : {role:'button', tabIndex:0, 'aria-label':'已删除的内容，点三下揭开',
                onPointerDown:stop, onMouseDown:stop, onTouchStart:stop, onClick:press,
                onKeyDown:event => { if (event.key === 'Enter' || event.key === ' ') press(event); else if (event.key !== 'Tab') stop(event); }})};
        if (kind === 'glitch') {
            const words = Array.from(text), third = Math.ceil(words.length / REDACTION_TAPS);
            const settled = open && !(since < SETTLE_MS) ? words.length : Math.min(count, REDACTION_TAPS - 1) * third;
            return h('span', props, open && still ? text : h(Glitch, {text, settled, settling:open && since < SETTLE_MS ? since : 0, still}));
        }
        const words = h('span', {key:'w', className:'fork-redact-words', 'aria-hidden':open ? undefined : true}, text);
        if (open && (still || !count)) return h('span', props, words);
        const seed = textSeed(mark.params?.quote + ':' + place.para + ':' + mark.index);
        return h('span', props, words, h(EraserCanvas, {key:'e', seed, count:still ? 0 : count, since, still}),
            !still && count && since < 700 ? h(Crumbs, {key:'c', seed:seed + count, since}) : null);
    }
    // Whether a mark is open (its voice is heard as words again): place and index as RedactionMark's.
    const open = (place, index) => tapsOf(place, index) >= REDACTION_TAPS;
    return {RedactionMark, open};
}
module.exports = {createRedactionMarks, glitchCover, eraserDabs, REDACTION_TAPS};
