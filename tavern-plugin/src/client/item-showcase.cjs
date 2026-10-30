'use strict';

// place the floating item showcase in front of the figures without
// covering a face. Pure geometry in stage CSS px: the item sits on the stage centre line at about 40 % height; it slides
// below the faces and steps down in size until the item (with its bob and the 出示 zoom) and its name fit between the
// faces, the textbox and the top chrome. The name tries above, then below, then beside the item (a group of two only
// above/below). The spotlight dim is returned only when the item lies over a figure, and starts just above the item.
function itemShowcasePlace({width, height, figures = [], blocked = [], boxTop, captions = [], show = false}) {
    const valid = r => r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
    const inflate = (r, n) => ({x: r.x - n, y: r.y - n, width: r.width + n * 2, height: r.height + n * 2});
    const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const unit = Math.min(width, height * 16 / 9) / 100;
    const sMax = Math.max(17 * unit, 72), sMin = Math.max(8 * unit, 40), step = Math.max(0.5 * unit, 2);
    const zoom = show ? 1.14 : 1, bob = unit, gap = 1.6 * unit, edge = Math.max(unit, 4);
    const bottom = (Number.isFinite(boxTop) ? Math.min(boxTop, height) : height) - Math.max(0.8 * unit, 4);
    const heads = figures.filter(f => valid(f?.head)).map(f => f.head);
    const blocks = [...blocked.filter(valid).map(r => inflate(r, Math.max(0.6 * unit, 4))), ...heads.map(r => inflate(r, Math.max(0.8 * unit, 6)))];
    const fits = r => r.x >= edge && r.y >= edge && r.x + r.width <= width - edge && r.y + r.height <= bottom && !blocks.some(b => hit(r, b));
    const count = Math.max(1, captions.length), caps = Array.from({length: count}, (_, i) => captions[i] && captions[i].width > 0 && captions[i].height > 0 ? captions[i] : {width: 0, height: 0});
    const modes = count === 1 ? ['above', 'below', 'right', 'left'] : ['above', 'below'];
    function layout(s, cy, mode) {
        // A card without any image (no entry or genre icon) is its name alone, centred where the item would float.
        const column = i => caps[i].textOnly ? caps[i].width : mode === 'above' || mode === 'below' ? Math.max(s * zoom, caps[i].width) : s * zoom;
        const total = caps.reduce((sum, _, i) => sum + column(i), 0) + gap * (count - 1);
        let x = width / 2 - total / 2;
        const items = [], names = [];
        for (let i = 0; i < count; i++) {
            const cx = x + column(i) / 2, c = caps[i];x += column(i) + gap;
            if (c.textOnly) {items.push({cx, cy, box: {x: cx - c.width / 2, y: cy - c.height / 2, width: c.width, height: c.height}});names.push({x: cx, y: cy, width: 0, height: 0});continue;}
            items.push({cx, cy, box: {x: cx - s * zoom / 2, y: cy - s * zoom / 2 - bob, width: s * zoom, height: s * zoom + bob}});
            const half = s * zoom / 2;
            names.push(mode === 'above' ? {x: cx - c.width / 2, y: cy - half - bob - 0.7 * unit - c.height, width: c.width, height: c.height}
                : mode === 'below' ? {x: cx - c.width / 2, y: cy + half + 0.5 * unit, width: c.width, height: c.height}
                : mode === 'right' ? {x: cx + half + 1.4 * unit, y: cy - c.height / 2, width: c.width, height: c.height}
                : {x: cx - half - 1.4 * unit - c.width, y: cy - c.height / 2, width: c.width, height: c.height});
        }
        return {items, names};
    }
    function result(s, cy, mode, forced) {
        const {items, names} = layout(s, cy, mode);
        const over = items.some(item => figures.some(f => valid(f?.body) && hit(item.box, f.body)));
        let dim = null;
        if (over) {
            const all = [...items.map(item => item.box), ...names.filter(valid)];
            const left = Math.min(...all.map(r => r.x)), right = Math.max(...all.map(r => r.x + r.width));
            const x = (left + right) / 2 - (right - left + s * 1.3) / 2, w = right - left + s * 1.3, low = Math.max(...all.map(r => r.y + r.height));
            // The dim never reaches a face: it stops below every chin above the item and above every face below it.
            const itemTop = Math.min(...items.map(item => item.box.y)) + bob, itemLow = Math.max(...items.map(item => item.box.y + item.box.height));
            const across = heads.filter(r => r.x < x + w && x < r.x + r.width);
            const top = Math.max(itemTop - s * 0.25, ...across.filter(r => r.y + r.height <= itemTop).map(r => r.y + r.height + 1));
            const end = Math.min(low + s * 0.55, bottom, ...across.filter(r => r.y >= itemLow).map(r => r.y - 1));
            dim = {x, y: top, width: w, height: Math.max(0, end - top)};
        }
        return {size: s, caption: mode, items: items.map(({cx, cy}) => ({x: cx, y: cy})), names, dim, forced: !!forced};
    }
    // Slide below the faces first (every size), and only when nothing fits below rise above them.
    const prefer = height * 0.4, down = [], up = [];
    for (let d = 0; d <= height * 0.45; d += step) {down.push(d);if (d) up.push(-d);}
    for (const ladder of [down, up]) for (let s = sMax; s >= sMin - 1e-6; s -= step) for (const dy of ladder) for (const mode of modes) {
        const {items, names} = layout(s, prefer + dy, mode);
        if (items.every(item => fits(item.box)) && names.every(r => r.width === 0 || fits(r))) return result(s, prefer + dy, mode);
    }
    return result(sMin, Math.max(sMin, bottom - sMin * zoom / 2), count === 1 ? 'right' : 'above', true);
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {itemShowcasePlace};
