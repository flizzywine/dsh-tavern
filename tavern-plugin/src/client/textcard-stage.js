// 「文字演出」 stage renderer. Plans come from textcard-presets.cjs;
// this file owns the DOM templates, optical centring, the frame-locked player and the stage hook.
// The player is imperative: the stage component never re-renders per card frame.
// @include textcard-presets.cjs
// @include textcard-vert-ink.cjs

const TEXTCARD_KIND = /^dsh\.textcard(?:\.|$)/;
function textcardAccepts(performance) {
    return !!performance && TEXTCARD_KIND.test(String(performance.kind || '')) && !!performance.payload &&
        (typeof performance.payload.style === 'string' || performance.kind === 'dsh.textcard.compound' && performance.payload.version === 1);
}

// ---------- templates ----------
function tcEl(doc, tag, cls, text) {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null && text !== '') node.textContent = text;
    return node;
}
// A newline separates lines (horizontal) or columns (vertical).
function tcLines(doc, text, cls = 'fork-tc-text') {
    const box = tcEl(doc, 'div', cls);
    String(text || '').split(/\r?\n/).forEach(line => box.append(tcEl(doc, 'span', 'fork-tc-ln', line)));
    return box;
}
// data-tc-center marks a block that is optically centred on the card (x for every writing mode, y too for vertical).
function tcCenter(node, axes = 'x') { node.dataset.tcCenter = axes; return node; }
const TEXTCARD_LAYOUTS = {
    punct(doc, plan, {state}) {
        const card = [tcCenter(tcEl(doc, 'div', 'fork-tc-punct-label', state.text), 'xy')];
        if (state.sub) card.push(tcEl(doc, 'div', 'fork-tc-reading', state.sub));
        if (state.foot) card.push(tcEl(doc, 'div', 'fork-tc-foot', state.foot));
        return card;
    },
    title(doc, plan, {state}) {
        const main = tcEl(doc, 'div', 'fork-tc-title-main');
        if (state.sub) main.append(tcEl(doc, 'span', 'fork-tc-title-k', state.sub));
        main.append(tcEl(doc, 'span', 'fork-tc-title-t', state.text));
        if ([...state.text].length === 1) main.classList.add('is-single');
        // The fine rectangle of the chapter card frames the title block.
        return [tcEl(doc, 'i', 'fork-tc-frame'), tcCenter(main), tcEl(doc, 'div', 'fork-tc-mark', '▲')];
    },
    name(doc, plan, {state}) {
        const out = [tcEl(doc, 'i', 'fork-tc-rule is-top'), tcCenter(tcEl(doc, 'div', 'fork-tc-name', state.text))];
        if (state.sub) out.push(tcEl(doc, 'div', 'fork-tc-name-roman', state.sub));
        out.push(tcEl(doc, 'i', 'fork-tc-rule is-bottom'));
        return out;
    },
    card(doc, plan, {state}) {
        const text = tcLines(doc, state.text);
        const out = [state.size === 'crop' ? text : tcCenter(text, 'xy')];
        if (state.sub) out.push(tcEl(doc, 'div', 'fork-tc-reading', state.sub));
        if (state.code) out.push(tcEl(doc, 'div', 'fork-tc-corner', state.code));
        if (state.foot) out.push(tcEl(doc, 'div', 'fork-tc-foot', state.foot));
        return out;
    },
    page(doc, plan, {state}) {
        const out = [tcLines(doc, state.text, 'fork-tc-page-text')];
        if (state.sub) out.push(tcEl(doc, 'div', 'fork-tc-margin', state.sub));
        if (state.foot) out.push(tcEl(doc, 'div', 'fork-tc-foot', state.foot));
        return out;
    },
    wall(doc, plan, {state}) {
        const fill = tcEl(doc, 'div', 'fork-tc-wall-fill', ((state.fill || state.text) + '　').repeat(360));
        return [fill, tcCenter(tcEl(doc, 'div', 'fork-tc-wall-word', state.text)), ...(plan.compound && state.sub ? [tcEl(doc, 'div', 'fork-tc-reading is-under', state.sub)] : [])];
    },
    split(doc, plan, {state}) {
        const grid = tcEl(doc, 'div', 'fork-tc-split');
        grid.dataset.cells = state.cells;
        for (let i = 0; i < state.cells; i++) {
            const cell = tcEl(doc, 'div', 'fork-tc-cell');
            if (state.names) cell.append(tcEl(doc, 'span', 'fork-tc-cell-name', state.names[i]));
            if (state.panes[i]) cell.append(tcCenter(tcEl(doc, 'span', 'fork-tc-cell-text', state.panes[i]), 'xy'));
            grid.append(cell);
        }
        return [grid, ...(plan.compound && state.sub ? [tcEl(doc, 'div', 'fork-tc-reading is-under', state.sub)] : [])];
    },
    morph(doc, plan, {state, frame}) {
        if (state.final) return [tcCenter(tcEl(doc, 'div', 'fork-tc-morph-final', state.text), 'xy'), ...(state.sub ? [tcEl(doc, 'div', 'fork-tc-gloss', state.sub)] : [])];
        const box = tcEl(doc, 'div', 'fork-tc-morph');
        box.style.setProperty('--tc-converge', Math.round(frame.ms * 0.8) + 'ms');
        state.parts.forEach((part, i) => { const node = tcEl(doc, 'span', 'fork-tc-part', part); node.dataset.slot = i % 4; box.append(node); });
        return [box];
    },
    flash(doc, plan, {state}) {
        // One stable centred layout (contract v1); only the text and, for pair/colour, the ground change.
        const word = tcEl(doc, 'div', 'fork-tc-fl');
        const span = tcCenter(tcEl(doc, 'span', 'fork-tc-fl-word', state.text), 'xy');
        word.append(span);
        const out = [word];
        if (state.sub) out.push(tcEl(doc, 'div', 'fork-tc-reading is-under', state.sub));
        return out;
    },
    ime(doc, plan, {state}) {
        const line = tcEl(doc, 'div', 'fork-tc-ime');
        // The finished line reserves its width so the growing text never re-centres between states.
        const ghost = tcEl(doc, 'span', 'fork-tc-ime-ghost', state.final);
        const live = tcEl(doc, 'span', 'fork-tc-ime-live');
        live.append(state.committed);
        if (state.typing) live.append(tcEl(doc, 'u', 'fork-tc-ime-typing', state.typing));
        if (state.caret) live.append(tcEl(doc, 'i', 'fork-tc-caret'));
        line.append(ghost, live);
        return [line, ...(plan.compound && state.sub ? [tcEl(doc, 'div', 'fork-tc-reading is-under', state.sub)] : [])];
    },
    code(doc, plan, {state}) {
        // Dots and bars derived from the code itself: a quiet signal row, not a decodable cipher.
        const bars = tcEl(doc, 'div', 'fork-tc-bars');
        [...state.text].slice(0, 24).forEach(ch => { const bar = tcEl(doc, 'i'); bar.dataset.h = ch.codePointAt(0) % 4; bars.append(bar); });
        const out = [tcCenter(tcEl(doc, 'div', 'fork-tc-code-main', state.text)), bars];
        if (state.sub) out.push(tcEl(doc, 'div', 'fork-tc-code-sub', state.sub));
        return out;
    },
    diagram(doc, plan, {state}) {
        const box = tcEl(doc, 'div', 'fork-tc-diagram');
        box.dataset.kind = state.kind;
        if (state.text) box.append(tcEl(doc, 'div', 'fork-tc-dg-root', state.text));
        const row = tcEl(doc, 'div', 'fork-tc-dg-items');
        state.items.forEach(item => row.append(tcEl(doc, 'span', 'fork-tc-dg-item', item)));
        box.append(row);
        const out = [box];
        if (state.sub) out.push(tcEl(doc, 'div', 'fork-tc-reading is-under', state.sub));
        if (state.foot) out.push(tcEl(doc, 'div', 'fork-tc-foot', state.foot));
        return out;
    },
    relate(doc, plan, {state}) {
        const box = tcEl(doc, 'div', 'fork-tc-relate');
        const svgEl = (tag, attrs) => {
            const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
            for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
            return node;
        };
        const svg = svgEl('svg', {viewBox:'0 0 1000 600', preserveAspectRatio:'none', 'aria-hidden':'true'});
        const defs = svgEl('defs', {}), marker = svgEl('marker', {id:'fork-tc-relate-arrow', viewBox:'0 0 10 10', refX:9, refY:5, markerWidth:7, markerHeight:7, orient:'auto-start-reverse'});
        marker.append(svgEl('path', {d:'M 0 0 L 10 5 L 0 10 z', fill:'currentColor'})); defs.append(marker); svg.append(defs); box.append(svg);
        const people = new Map(state.people.map(person => [person.id, person]));
        state.links.slice(0, state.visibleLinks).forEach((link, index) => {
            const from = people.get(link.from), to = people.get(link.to);
            const ax = from.x * 1000, ay = from.y * 600, bx = to.x * 1000, by = to.y * 600;
            const dx = bx - ax, dy = by - ay, distance = Math.hypot(dx, dy), ux = dx / distance, uy = dy / distance;
            // Parallel/reciprocal edges get separate lanes; endpoints always come from the stored local IDs.
            const peers = state.links.map((edge, i) => ({edge, i})).filter(({edge}) => edge.from === link.from && edge.to === link.to || edge.from === link.to && edge.to === link.from);
            const lane = peers.findIndex(row => row.i === index) - (peers.length - 1) / 2;
            const direction = link.from < link.to ? 1 : -1, bend = lane * 90 * direction;
            const cx = (ax + bx) / 2 - uy * bend, cy = (ay + by) / 2 + ux * bend;
            svg.append(svgEl('path', {d:`M ${ax + ux * 65} ${ay + uy * 45} Q ${cx} ${cy} ${bx - ux * 65} ${by - uy * 45}`, fill:'none', stroke:'currentColor', 'stroke-width':2, 'marker-end':'url(#fork-tc-relate-arrow)'}));
            const label = tcEl(doc, 'span', 'fork-tc-relate-label', link.label);
            label.style.left = ((ax + 2 * cx + bx) / 4 / 10) + '%'; label.style.top = ((ay + 2 * cy + by) / 4 / 6) + '%';
            box.append(label);
        });
        state.people.slice(0, state.visiblePeople).forEach(person => {
            const node = tcEl(doc, 'span', 'fork-tc-relate-person', person.name);
            node.style.left = person.x * 100 + '%'; node.style.top = person.y * 100 + '%'; box.append(node);
        });
        return [box, ...(state.sub ? [tcEl(doc, 'div', 'fork-tc-reading is-under', state.sub)] : [])];
    },
    marker(doc, plan, {state}) {
        const main = tcCenter(tcEl(doc, 'div', 'fork-tc-marker', state.text), [...state.text].length > 2 ? 'xy' : 'x');
        const out = [main, tcEl(doc, 'div', 'fork-tc-mark', '▲')];
        if (state.roman) out.push(tcEl(doc, 'div', 'fork-tc-roman', state.roman));
        if (state.sub) out.push(tcEl(doc, 'div', 'fork-tc-code', state.sub));
        return out;
    },
};
function textcardLuminance(color) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(color || '').trim());
    if (!m) return null;
    return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
// Palette name → CSS paint; 'figure' is the speaker's 形象色 (imageColor ?? autoColor) from the stage.
// The speaker accent is read when the card plays (the line it precedes); none → vermilion.
function textcardPaints(frame, plan, ctx) {
    const figure = plan.accent || '';
    const paint = name => name === 'figure' ? (figure || 'var(--gal-tc-vermilion)') : 'var(--gal-tc-' + name + ')';
    let fg = frame.fg;
    if (fg === 'auto') { const l = textcardLuminance(figure); fg = figure && (l === null || l >= 0.3) ? 'ink' : 'paper'; }
    return {bg: paint(frame.bg), fg: paint(fg), key: frame.bg === 'figure' ? 'figure:' + (figure || 'vermilion') : frame.bg};
}
// the speaker's image colour as card text or as the card under palette text is made readable
// against what it actually sits on, through the one shared lightness helper (stored colour untouched): figure text moves
// against the resolved card paint; a figure card moves under its palette text. Both figure, or a non-hex paint: left as is.
function textcardReadable(card, frame, plan) {
    const figure = /^#[0-9a-f]{6}$/i.test(plan.accent || '') ? plan.accent.toLowerCase() : '';
    if (!figure || !card.isConnected || (frame.fg === 'figure') === (frame.bg === 'figure')) return;
    const style = getComputedStyle(card), read = name => style.getPropertyValue(name).trim().toLowerCase();
    const bg = read('--tc-bg'), fg = read('--tc-fg'), hex = /^#[0-9a-f]{6}$/;
    if (frame.fg === 'figure' && hex.test(bg)) { const ink = figureTextColor(figure, bg); if (ink !== figure) card.style.setProperty('--tc-fg', ink); }
    if (frame.bg === 'figure' && hex.test(fg)) { const plate = figurePlateColor(figure, fg); if (plate !== figure) card.style.setProperty('--tc-bg', plate); }
}
function textcardNode(doc, plan, frame, ctx) {
    if (frame.layout) plan = {...plan, ...frame, compound:true};
    const card = tcEl(doc, 'div', 'fork-tc');
    if (plan.compound) card.dataset.compound = 'true';
    const paints = textcardPaints(frame, plan, ctx);
    card.dataset.layout = plan.layout; card.dataset.style = plan.style; card.dataset.dir = plan.dir; card.dataset.face = plan.type.face;
    card.dataset.size = frame.state.size || plan.type.size; card.dataset.motif = plan.motif;
    if (frame.state.anchor) card.dataset.anchor = frame.state.anchor;
    if (plan.reduced) card.dataset.reduced = 'true';
    card.style.setProperty('--tc-bg', paints.bg); card.style.setProperty('--tc-fg', paints.fg);
    card.append(...TEXTCARD_LAYOUTS[plan.layout](doc, plan, {state: frame.state, frame}));
    return {card, key: paints.key};
}

// Fit complete compound input (up to an 800-character dossier); the v1 renderer keeps its original typography.
function textcardFit(card) {
    if (!card.dataset.compound) return;
    for (const node of card.querySelectorAll('.fork-tc-text,.fork-tc-name,.fork-tc-marker,.fork-tc-title-main,.fork-tc-fl-word,.fork-tc-ime,.fork-tc-code-main,.fork-tc-page-text,.fork-tc-cell-text')) {
        if (card.dataset.size === 'crop') continue;
        const page = node.classList.contains('fork-tc-page-text'), cell = node.closest('.fork-tc-cell');
        const width = page ? node.clientWidth : cell ? cell.clientWidth * .85 : card.clientWidth * .84;
        const height = page ? node.clientHeight : cell ? cell.clientHeight * .55 : card.clientHeight * .7;
        const ratio = Math.min(1, width / node.scrollWidth, height / node.scrollHeight);
        if (ratio < 1) node.style.fontSize = parseFloat(card.ownerDocument.defaultView.getComputedStyle(node).fontSize) * ratio + 'px';
    }
}

// ---------- optical centring ----------
// Full-width CJK punctuation sits on one side of its em box (「？」 at the end of 「真的？」), and letter-spacing adds a
// trailing gap: the layout box is centred, the ink is not. Each [data-tc-center] block is measured glyph by glyph —
// layout position from a DOM Range; ink bounds from canvas measureText (actualBoundingBox*) for horizontal and upright
// glyphs, and from the generated vert/vrt2 table (textcard-vert-ink.cjs, bin/textcard-vert-ink.py) for
// tategaki punctuation, whose rotated/shifted form canvas cannot see — and moved with `translate` so its ink box is
// centred on the block's layout box (the sample's ink centring). `halt` / `text-spacing-trim` do not fix ？！.
function textcardVertInk(style, ch) {
    // Only the first family renders the card; a fallback name later in the stack must not select the Noto table.
    if (typeof TEXTCARD_VERT_INK === 'undefined' || !/noto-serif-sc|Noto Serif SC/i.test(style.fontFamily.split(',')[0])) return null;
    const weight = Number(style.fontWeight) || 400, key = weight >= 600 ? '700' : weight >= 450 ? '500' : '400';
    return TEXTCARD_VERT_INK[key][ch] || null;
}
const textcardInkCache = new Map();
let textcardCanvas = null;
function textcardGlyphInk(doc, font, ch) {
    const key = font + '\u0000' + ch;
    let ink = textcardInkCache.get(key);
    if (ink) return ink;
    textcardCanvas ||= doc.createElement('canvas').getContext('2d');
    const c = textcardCanvas;
    c.font = font; c.textAlign = 'left'; c.textBaseline = 'ideographic';
    const m = c.measureText(ch);
    c.textBaseline = 'alphabetic';
    const a = c.measureText(ch);
    // ideo: relative to the em box bottom (vertical upright); alpha: relative to the alphabetic baseline, which sits
    // fontBoundingBoxAscent below the top of the inline content area (horizontal).
    ink = {left: -m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight, top: -m.actualBoundingBoxAscent, bottom: m.actualBoundingBoxDescent, width: m.width,
        alphaTop: -a.actualBoundingBoxAscent, alphaBottom: a.actualBoundingBoxDescent, ascent: a.fontBoundingBoxAscent};
    if (textcardInkCache.size > 4000) textcardInkCache.clear();
    textcardInkCache.set(key, ink);
    return ink;
}
// The offset of a block follows from its layout alone, so it is kept per (card attributes, card size, block class and
// box size, and each text run's class, font, writing mode, letter-spacing and text): a repeated card skips the glyph walk.
// Nothing is kept while a font is loading (the glyphs may still be a fallback) and the cache empties when one finishes.
const textcardCenterCache = new Map();
let textcardCenterFonts = null;
function textcardCenterCacheable(doc) {
    const fonts = doc.fonts;
    if (!fonts) return false;
    if (textcardCenterFonts !== fonts) {
        textcardCenterFonts = fonts;
        textcardCenterCache.clear();
        fonts.addEventListener?.('loadingdone', () => textcardCenterCache.clear());
    }
    return fonts.status === 'loaded';
}
// Stage units: a docked stage is only scaled (createModStageDock); glyph metrics are in CSS px of the card.
function textcardLocalRect(r, k) {
    return k === 1 ? r : {left: r.left * k, right: r.right * k, top: r.top * k, bottom: r.bottom * k, width: r.width * k, height: r.height * k};
}
function textcardCenterOffset(doc, block, box, runs, k = 1) {
    const range = doc.createRange();
    let ink = null;
    for (const {text, style, vertical, size, font} of runs) {
        const value = text.nodeValue;
        for (let i = 0; i < value.length;) {
            const code = value.codePointAt(i), len = code > 0xffff ? 2 : 1, ch = value.slice(i, i + len);
            range.setStart(text, i); range.setEnd(text, i + len); i += len;
            if (!ch.trim()) continue;
            const r = textcardLocalRect(range.getBoundingClientRect(), k);
            if (!r.width && !r.height) continue;
            const table = vertical ? textcardVertInk(style, ch) : null;
            if (table) {
                const left = r.left + (r.width - size) / 2, em = size / 1000;
                const rect = {left: left + table[0] * em, right: left + size - table[1] * em, top: r.top + table[2] * em, bottom: r.top + size - table[3] * em};
                ink = ink ? {left: Math.min(ink.left, rect.left), right: Math.max(ink.right, rect.right), top: Math.min(ink.top, rect.top), bottom: Math.max(ink.bottom, rect.bottom)} : rect;
                continue;
            }
            const g = textcardGlyphInk(doc, font, ch);
            if (!(g.right > g.left)) continue;
            // Horizontal: the em box starts at the glyph's advance origin. Vertical upright: the em box is centred in
            // the column and its ideographic bottom sits one em below the glyph's top.
            const x0 = vertical ? r.left + (r.width - g.width) / 2 : r.left, base = vertical ? r.top + size : r.top + g.ascent;
            const rect = {left: x0 + g.left, right: x0 + g.right, top: base + (vertical ? g.top : g.alphaTop), bottom: base + (vertical ? g.bottom : g.alphaBottom)};
            ink = ink ? {left: Math.min(ink.left, rect.left), right: Math.max(ink.right, rect.right), top: Math.min(ink.top, rect.top), bottom: Math.max(ink.bottom, rect.bottom)} : rect;
        }
    }
    range.detach?.();
    if (!ink) return '';
    const dx = (box.left + box.right) / 2 - (ink.left + ink.right) / 2;
    const dy = block.dataset.tcCenter === 'xy' ? (box.top + box.bottom) / 2 - (ink.top + ink.bottom) / 2 : 0;
    return Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 ? dx.toFixed(1) + 'px ' + dy.toFixed(1) + 'px' : '';
}
// Writes, then reads, then writes: every block's translate is cleared first, all of them are measured against one
// layout (blocks are never nested, so one block's translate cannot move another), and the offsets are written last.
function textcardCenter(card) {
    const doc = card.ownerDocument, view = doc.defaultView;
    const blocks = [...card.querySelectorAll('[data-tc-center]')];
    for (const block of blocks) block.style.translate = '';
    const cacheable = textcardCenterCacheable(doc);
    const d = card.dataset, cardKey = [d.layout, d.style, d.dir, d.face, d.size, d.motif, d.anchor, d.reduced, card.clientWidth, card.clientHeight].join('\u0001');
    const stage = card.closest('.fork-gal-stage'), outer = stage && blocks.length ? stage.getBoundingClientRect() : null;
    const k = outer && outer.width > 0 && Math.abs(outer.width - stage.offsetWidth) >= 1 ? stage.offsetWidth / outer.width : 1;
    const offsets = blocks.map(block => {
        const box = textcardLocalRect(block.getBoundingClientRect(), k);
        if (!box.width || !box.height) return '';
        const walker = doc.createTreeWalker(block, 4), runs = [];
        let key = cardKey + '\u0002' + block.className + '\u0001' + block.dataset.tcCenter + '\u0001' + box.width + '\u0001' + box.height;
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
            const style = view.getComputedStyle(text.parentElement), vertical = style.writingMode.startsWith('vertical');
            const size = parseFloat(style.fontSize), font = style.fontStyle + ' ' + style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
            runs.push({text, style, vertical, size, font});
            key += '\u0002' + text.parentElement.className + '\u0001' + font + '\u0001' + style.writingMode + '\u0001' + style.letterSpacing + '\u0001' + text.nodeValue;
        }
        if (cacheable && textcardCenterCache.has(key)) return textcardCenterCache.get(key);
        const offset = textcardCenterOffset(doc, block, box, runs, k);
        if (cacheable) {
            if (textcardCenterCache.size > 256) textcardCenterCache.clear();
            textcardCenterCache.set(key, offset);
        }
        return offset;
    });
    blocks.forEach((block, i) => { if (offsets[i]) block.style.translate = offsets[i]; });
}

// ---------- player ----------
// One card at a time; cards that arrive while one is up queue behind it (one colour change between them, no scene).
// Frame-locked on requestAnimationFrame with a 250 ms watchdog, so a throttled frame clock never leaves a card up.
// Every full-screen colour change waits for the shared gate. skip() ends the current card; cancel() removes everything.
function createTextcardPlayer({doc = document, now = () => performance.now(), raf = fn => requestAnimationFrame(fn), caf = id => cancelAnimationFrame(id),
    setInterval: every = (fn, ms) => setInterval(fn, ms), clearInterval: stopEvery = id => clearInterval(id), gate = createTextcardGate(), fontsReady = () => Promise.resolve(),
    fontsLoaded = () => false,
    context = () => ({}), onChange = () => {}} = {}) {
    let layer = null, queue = [], current = null, phase = 'idle', frameId = 0, watchdog = 0, sceneKey = 'scene', disposed = false;
    const log = {changes: [], cards: []};
    let snapshot = {phase, style: null, id: null};
    function emit() {
        const next = {phase, style: current ? current.plan.style : null, id: current ? current.id : null, sr: current && phase === 'up' ? current.plan.sr : ''};
        if (next.phase === snapshot.phase && next.id === snapshot.id) return;
        snapshot = next; onChange(snapshot);
    }
    function schedule() {
        if (disposed || !current && !queue.length) return;
        if (!frameId) frameId = raf(tick);
        if (!watchdog) watchdog = every(() => tick(now(), true), 250);
    }
    function stopClock() {
        if (frameId) caf(frameId); frameId = 0;
        if (watchdog) stopEvery(watchdog); watchdog = 0;
    }
    function changeColour(key, t) {
        if (key === sceneKey) return;
        gate.mark(t); log.changes.push(t); if (log.changes.length > 64) log.changes.shift();
        sceneKey = key;
    }
    function mount(entry, index, t) {
        const frame = entry.plan.frames[index];
        const built = textcardNode(doc, entry.plan, frame, context());
        if (layer) {
            layer.replaceChildren(built.card);
            textcardReadable(built.card, frame, entry.plan);
            try { textcardFit(built.card); textcardCenter(built.card); } catch (_) { /* centring is cosmetic */ }
            if ((frame.layout || entry.plan.layout) === 'morph' && !frame.state.final && frame.state.converge) raf(() => built.card.classList.add('is-converging'));
        }
        changeColour(built.key, t);
        entry.deadline = frame.layout && entry.plan.style === 'count' && index > 0 ? entry.deadline + frame.ms : t + frame.ms;
        entry.index = index; entry.shownAt = t; entry.node = built.card;
        entry.record.frames.push(Math.round(t - (entry.record.t0 ?? t)));
        entry.record.t0 ??= t;
    }
    function keyOf(entry, index) { return textcardPaints(entry.plan.frames[index], entry.plan, context()).key; }
    function ready(entry, t) {
        // A colour change may paint only when the gate allows it; the previous state simply stays up.
        const key = entry.index < 0 ? keyOf(entry, 0) : keyOf(entry, entry.index);
        return key === sceneKey || gate.slot(t) <= t;
    }
    function finish(entry, skipped) {
        entry.record.skipped = skipped; entry.record.t1 = now();
        log.cards.push(entry.record); if (log.cards.length > 32) log.cards.shift();
        entry.resolve(skipped);
    }
    function exit(t) {
        if (sceneKey !== 'scene' && gate.slot(t) > t) return false;
        if (layer) layer.replaceChildren();
        if (sceneKey !== 'scene') { gate.mark(t); log.changes.push(t); }
        sceneKey = 'scene';
        return true;
    }
    function tick(t = now(), fromWatchdog = false) {
        if (!fromWatchdog) frameId = 0;
        if (disposed) return;
        t = fromWatchdog ? now() : t;
        if (!current && queue.length) { current = queue.shift(); current.index = -1; phase = 'pending'; emit(); }
        if (!current) {
            if (sceneKey !== 'scene' && !exit(t)) return schedule();
            phase = 'idle'; emit(); stopClock(); return;
        }
        const entry = current;
        if (entry.index < 0 && entry.skip) { finish(entry, true); current = null; return tick(t, fromWatchdog); }
        if (!entry.fontsReady) return schedule();
        if (entry.index < 0) {
            if (!ready(entry, t)) return schedule();
            mount(entry, 0, t); phase = 'up'; emit(); return schedule();
        }
        const frame = entry.plan.frames[entry.index];
        const due = entry.skip || t >= (frame.layout && entry.plan.style === 'count' ? entry.deadline : entry.shownAt + frame.ms - 8);
        if (!due) return schedule();
        const last = entry.index >= entry.plan.frames.length - 1;
        if (!last && !entry.skip) {
            const nextKey = keyOf(entry, entry.index + 1);
            if (nextKey !== sceneKey && gate.slot(t) > t) return schedule();
            mount(entry, entry.index + 1, t); return schedule();
        }
        // End of the card: straight into a queued card (one change), else back to the scene.
        const next = queue[0];
        if (next && next.fontsReady && !next.skip) {
            const key = keyOf(next, 0);
            if (key !== sceneKey && gate.slot(t) > t) return schedule();
            finish(entry, !!entry.skip); current = queue.shift(); current.index = -1;
            mount(current, 0, t); emit(); return schedule();
        }
        if (!exit(t)) return schedule();
        finish(entry, !!entry.skip); current = null; phase = queue.length ? 'pending' : 'idle'; emit();
        if (queue.length) return tick(t, fromWatchdog);
        stopClock();
    }
    return {
        attach(node) { layer = node; if (!node) cancelAll(true); },
        play(plan) {
            if (disposed || !plan || !plan.frames.length) return Promise.resolve(false);
            return new Promise(resolve => {
                // Fonts already in memory: the card mounts inside this call, in the same paint as the page turn.
                const entry = {id: Symbol('textcard'), plan, index: -1, skip: false, fontsReady: !!fontsLoaded(plan), resolve,
                    record: {style: plan.style, planned: plan.frames.map(frame => Math.round(frame.ms)), frames: [], skipped: false}};
                // Fonts get a bounded wait; a slow font never holds the story. Loaded fonts need neither the wait nor a
                // FontFaceSet.load per weight (a burst of queued cards would otherwise pay both for every card).
                if (!entry.fontsReady) Promise.race([Promise.resolve(fontsReady(plan)).catch(() => {}), new Promise(done => setTimeout(done, 600))]).then(() => { entry.fontsReady = true; schedule(); });
                queue.push(entry); // Admission already bounds accepted cards by the per-turn cap.
                if (!current) { current = queue.shift(); current.index = -1; phase = 'pending'; emit(); }
                if (current === entry && entry.fontsReady) tick(now(), true); else schedule();
            });
        },
        // Click / Space / Enter / wheel during a card: jump to its end. Returns whether a card consumed the input.
        skip() {
            if (!current) return false;
            current.skip = true; schedule(); tick(now(), true);
            return true;
        },
        cancel: cancelAll,
        snapshot: () => snapshot,
        log: () => ({changes: log.changes.slice(), cards: log.cards.slice(), peak: textcardPeak(log.changes, 1000)}),
        dispose() { cancelAll(true); disposed = true; },
    };
    function cancelAll(detached = false) {
        for (const entry of queue) entry.resolve(true);
        queue = [];
        // Visible cancellation still changes the full-screen colour; only teardown bypasses the gate.
        if (current && !detached && layer) { current.skip = true; tick(now(), true); return; }
        if (current) { finish(current, true); current = null; }
        if (layer) layer.replaceChildren();
        if (sceneKey !== 'scene') { const t = now(); gate.mark(t); log.changes.push(t); }
        sceneKey = 'scene'; stopClock(); phase = 'idle'; emit();
    }
}

// ---------- fonts ----------
// TEXTCARD_FACE is the one place that picks the card face. `library`: a font-library id, registered on demand, full font (no per-sample subset).
// `local`: installed full / PostScript names tried first through local(), for trying faces that are not in the library
// (never shipped); one installed face serves every card weight, like the single-weight HGP明朝B of the 物語 cards.
// If none is installed the library face is used. The tategaki punctuation table (textcard-vert-ink.cjs) was
// generated from the library's Noto Serif SC and applies only while that face renders.
const TEXTCARD_FACE = Object.freeze({library: 'noto-serif-sc', local: Object.freeze([])});
const TEXTCARD_LOCAL_FAMILY = 'DSH Textcard Local';
function textcardLocalFace(face) {
    if (!face.local.length || typeof document === 'undefined' || !document.fonts || typeof FontFace !== 'function') return Promise.resolve(null);
    const src = face.local.map(name => 'local(' + JSON.stringify(name) + ')').join(', ');
    const font = new FontFace(TEXTCARD_LOCAL_FAMILY, src, {weight: '100 900', display: 'block'});
    return font.load().then(() => { document.fonts.add(font); return JSON.stringify(TEXTCARD_LOCAL_FAMILY); }, () => null);
}
let textcardFamily = null, textcardFamilyValue;
function textcardFonts() {
    if (textcardFamily) return textcardFamily;
    const library = () => typeof tavernFonts === 'object' && tavernFonts && tavernFonts.ensure
        ? Promise.resolve(tavernFonts.ensure(TEXTCARD_FACE.library)).then(font => font && font.family || null, () => null) : Promise.resolve(null);
    textcardFamily = textcardLocalFace(TEXTCARD_FACE).then(local => local || library());
    textcardFamily.then(value => { textcardFamilyValue = value; });
    return textcardFamily;
}
const textcardGlyphs = plan => [...new Set(plan.frames.flatMap(frame => [...JSON.stringify(frame.state)]))].join('').slice(0, 400) || '文';
const textcardFaces = family => [400, 500, 700].map(weight => weight + ' 40px ' + family.split(',')[0]);
async function textcardFontsReady(plan, family) {
    if (!family || typeof document === 'undefined' || !document.fonts) return;
    await Promise.all(textcardFaces(family).map(face => document.fonts.load(face, textcardGlyphs(plan))));
}
// Synchronous: the family is known and every face the plan needs is loaded (or there is no library to wait for).
function textcardFontsLoaded(plan) {
    if (textcardFamilyValue === undefined) return false;
    if (!textcardFamilyValue || typeof document === 'undefined' || !document.fonts) return true;
    try { return textcardFaces(textcardFamilyValue).every(face => document.fonts.check(face, textcardGlyphs(plan))); } catch (_) { return false; }
}

// ---------- stage hook ----------
// props: {sessionId, reducedMotion (stage CONFIG 「减少动态」, R20: not the OS setting), blocked (an overlay is open or
// skip is running: any card ends at once)}.
// Returns {accepts(performance), play(effect, {accent}) → Promise, skip() → consumed, cancel(), up, busy, node};
// accent is the 形象色 of the speaker of the line the card precedes.
function textcardPlan(payload, reduced, accent) {
    const plan = planTextcard(payload, {reduced});
    return plan ? {...plan, accent: typeof accent === 'string' ? accent : ''} : null;
}
function useTextcardStage({sessionId, reducedMotion, blocked}) {
    const h = React.createElement;
    const ctx = React.useRef({}); ctx.current = {reducedMotion: reducedMotion === true};
    const [family, setFamily] = React.useState(null);
    const [state, setState] = React.useState({phase: 'idle', sr: ''});
    const familyRef = React.useRef(null); familyRef.current = family;
    const player = React.useMemo(() => createTextcardPlayer({
        now:forkForeground.now, raf:forkForeground.requestAnimationFrame, caf:forkForeground.cancelAnimationFrame,
        setInterval:forkForeground.setInterval, clearInterval:forkForeground.clearInterval,
        context: () => ctx.current, onChange: setState, fontsLoaded: textcardFontsLoaded,
        fontsReady: plan => textcardFonts().then(value => { if (value && familyRef.current !== value) setFamily(value); return textcardFontsReady(plan, value); }),
    }), [sessionId]);
    React.useEffect(() => () => player.dispose(), [player]);
    // Register the family early so the first card does not wait for it.
    React.useEffect(() => { let live = true; textcardFonts().then(value => { if (live && value) setFamily(value); }); return () => { live = false; }; }, []);
    React.useEffect(() => { if (blocked) player.cancel(); }, [blocked, player]);
    const play = React.useCallback((effect, options = {}) => {
        const performance = effect && effect.performance;
        if (!textcardAccepts(performance)) return Promise.resolve(false);
        return player.play(textcardPlan(performance.payload, ctx.current.reducedMotion, options.accent));
    }, [player]);
    // Test hook (debug instance / browser tests): replay a payload through the same plan, gate and player.
    React.useEffect(() => {
        const debug = {play: (payload, accent) => player.play(textcardPlan(payload, ctx.current.reducedMotion, accent)), skip: () => player.skip(), cancel: () => player.cancel(),
            state: () => player.snapshot(), log: () => player.log(), plan: payload => planTextcard(payload, {reduced: ctx.current.reducedMotion})};
        window.forkTextcardDebug = debug;
        return () => { if (window.forkTextcardDebug === debug) delete window.forkTextcardDebug; };
    }, [player]);
    const attach = React.useCallback(node => player.attach(node), [player]);
    const up = state.phase === 'up', busy = state.phase !== 'idle';
    const node = h('div', {className: 'fork-tc-layer' + (up ? ' is-up' : ''), style: family ? {'--tc-mincho': family} : undefined},
        h('div', {ref: attach, className: 'fork-tc-host', 'aria-hidden': true}),
        h('span', {className: 'fork-tc-sr', 'aria-live': 'polite'}, up ? state.sr : ''));
    return {accepts: textcardAccepts, play, skip: player.skip, cancel: player.cancel, up, busy, node};
}
