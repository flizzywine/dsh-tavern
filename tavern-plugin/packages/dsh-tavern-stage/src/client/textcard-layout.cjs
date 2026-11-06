function createStageTextcardLayout({getComputedStyle,figureTextColor,figurePlateColor}) {
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

return {textcardNode,textcardReadable,textcardFit,textcardPaints};
}
if(typeof module!=="undefined"&&typeof window==="undefined")module.exports={createStageTextcardLayout};
