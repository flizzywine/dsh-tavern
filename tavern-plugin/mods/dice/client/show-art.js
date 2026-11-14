// The check show's picture (show.js plays it): one canvas, painted whole for any moment t, in three flat colours -
// office paper, ink, and the rules' mark colour (Triangle Agency: signal red). No gradient, no shadow, no glow: what
// carries it is the cut, the scale and the beat. After the rulebook's Triscendence spread: three triangles of glittering
// dust with wavy contours, the title set across them in huge white type.
//
//   paper   a three-bladed shutter closes on the scene (its window a triangle shrinking to a point): the stage is a
//           sheet of paper, registered at its corners, the check's name at its head. The dice are set down in a row;
//           the unmarked ones are struck to outlines; the marked ones are counted, one, two, three, each filling a slot
//           of the gauge under the row.
//   figure  the counted dice go to the corners of a figure (a triangle for three) and it is ruled between them in one
//           stroke, corner to corner, each edge quicker, every angle certified; then it is inked - one frame a drawing,
//           the next the solid mark - and nothing moves.
//   bloom   the figure swallows the stage: everything is the mark colour. Three figures of dust are traced out of it
//           left to right; the label lands letter by letter in type as large as the stage allows, the last on the
//           downbeat, each blow kicking the dust; the dust rises (升华), the contours stand like the chord that sounds.
//   exit    the whole field is drawn back into the figure (the way in, backwards), which is filed on the record's card.
//
// 减少动态: the bloom at its height, still (the player fades it). 光敏保护: the one full-stage change of colour, the
// figure swallowing the stage, sweeps twice as slowly; nothing in the show flashes.

// Timeline (ms). The sound reads the same beats (show-sound.js).
const SHOW_T = Object.freeze({
    irisDur: 300,
    deal: 380, dealStep: 45, dealDur: 140,
    ghost: 690, ghostStep: 30,
    count: 820, countStep: 200, countDur: 170,
    fly: 1420, flyStep: 70, flyDur: 420,
    edge: 1900, edgeGap: 170, edgeQuick: 0.82, edgeDur: 150,
    fill: 2400, fillDur: 110,
    breath: 260, hit: 2760, plunge: 340,
    tri: 2980, triStep: 200, trace: 420,
    slamStep: 200, slamDur: 130, accent: 4260, head: 4460,
    end: 6160, ebb: 380, exit: 300,
    calmAt: 5300, calmIn: 320, calmHold: 2100, calmOut: 360
});
// 光敏保护: the figure takes this long to swallow the stage.
const SHOW_SAFE = Object.freeze({ plunge: 640 });
// How much dust a device draws (share of the desktop's).
const SHOW_DENSITY = Object.freeze({ desktop: 1, "mobile-landscape": 0.4, "mobile-portrait": 0.3 });

const showOut = value => 1 - Math.pow(1 - value, 3);
const showIn = value => value * value * value;
const showInOut = value => value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
// Ease out with a small overshoot (a die set down, a letter landing).
const showBack = value => 1 + 2.2 * Math.pow(value - 1, 3) + 1.2 * Math.pow(value - 1, 2);
const showAt = (t, start, dur) => { const value = (t - start) / dur; return value < 0 ? 0 : value > 1 ? 1 : value; };

// The composition on a stage of w x h px: the dice row, the figure, the frieze of dust and the label's block (a record
// always lays out the same). The label's letters are placed at the first paint (they need the font's measure).
function showLayout(record, w, h, device) {
    const dice = checkDiceFaces(record), marked = dice.filter(die => die.marked), corners = Math.max(3, marked.length);
    const rand = diceRandom("show:" + record.callId), unit = Math.max(1, Math.min(w, h) / 1080), portrait = h > w * 1.1;
    // The figure: a regular polygon standing on an edge, optically centred.
    const radius = Math.min(h * 0.3, w * 0.36), cx = w / 2, cy = h / 2 + (corners === 3 ? radius * 0.25 : 0);
    const angles = Array.from({ length: corners }, (_, i) => -Math.PI / 2 + i * 2 * Math.PI / corners);
    const points = angles.map(a => [cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
    // The dice in a row across the middle; each marked die goes to a corner, left to right, so no two paths cross.
    const size = Math.max(30, Math.min(h * 0.12, (w * 0.86) / (dice.length * 1.25)));
    const rowW = dice.length * size * 1.25 - size * 0.25;
    const slots = dice.map((_, i) => [cx - rowW / 2 + size / 2 + i * size * 1.25, h / 2]);
    const byX = points.map((p, i) => i).sort((a, b) => points[a][0] - points[b][0] || points[a][1] - points[b][1]);
    const targets = new Map(dice.map((die, i) => i).filter(i => dice[i].marked).map((i, n) => [i, points[byX[n % points.length]]]));
    // The scale at which the figure, grown about its centre, covers the whole stage: each stage corner inside every edge.
    const inradius = radius * Math.cos(Math.PI / corners), normals = angles.map(a => a + Math.PI / corners);
    let reach = 1;
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) for (const n of normals) reach = Math.max(reach, ((x - cx) * Math.cos(n) + (y - cy) * Math.sin(n)) / inradius);
    reach *= 1.04;
    // The bloom: the label in one line (two on a tall stage) as large as the stage allows, over a frieze of three
    // triangles as wide as the stage.
    const letters = Array.from(record.show.label), lines = portrait && letters.length >= 4 ? 2 : 1, per = Math.ceil(letters.length / lines);
    const type = lines === 1 ? Math.min(h * 0.3, w * 0.148, w * 0.9 / (per * 1.04)) : Math.min(h * 0.2, w * 0.9 / (per * 1.04));
    const base = Math.min(lines === 1 ? type * 2.2 : w, w * 0.96 / 2.88), high = base * Math.sqrt(3) / 2;
    const over = lines === 1 ? type * 1.22 : type * 0.2, block = lines * type + (lines - 1) * type * 0.06;
    const small = Math.max(13, type * 0.085), all = Math.max(high, high - over + block) + small * 2.6;
    const apexY = (h - all) / 2, baseY = apexY + high, titleTop = baseY - over, headY = Math.max(baseY, titleTop + block) + small * 2;
    const figures = [-1, 0, 1].map(k => ({ x: cx + k * base * 0.94, apex: apexY, base: baseY }));
    // The dust: specks along each triangle's outline (clumped, most of them close to the line, some far out like
    // smoke), along four wavy contours in its lower half, and a few small triangles. Each: home, size, when the trace
    // reveals it, how it twinkles and rises, and whether it passes in front of the label.
    const density = SHOW_DENSITY[device] || 1, dust = [], gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    const traced = p => 1 - Math.pow(1 - p, 1 / 3);
    figures.forEach((fig, k) => {
        const from = SHOW_T.tri + k * SHOW_T.triStep, left = fig.x - base / 2;
        for (let n = Math.round(4200 * density), tries = 0; n > 0 && tries < 50000; tries++) {
            const u = rand(), far = rand() < 0.24, off = gauss() * base * (far ? 0.075 : 0.013);
            if (rand() > 0.3 + 0.7 * Math.abs(Math.sin(u * 41 + k * 2) * Math.sin(u * 97 + k))) continue;
            n--;
            let x, y, p;
            if (u < 2 / 3) { const side = u < 1 / 3 ? -1 : 1, f = (u % (1 / 3)) * 3; x = fig.x + side * f * base / 2 + side * off * 0.866; y = apexY + f * high - off * 0.5; p = 0.62 * f; }
            else { const g = (u - 2 / 3) * 3; x = left + g * base; y = baseY + off; p = 0.62 + 0.38 * (1 - Math.abs(2 * g - 1)); }
            dust.push({ x, y, size: (far ? 0.9 : 1.1) + Math.pow(rand(), 3.2) * (far ? 2 : 3.4), at: from + SHOW_T.trace * traced(p), phase: rand() * 6.283, rate: 2 + rand() * 5,
                rise: (far ? 10 : 2.5) + rand() * (far ? 22 : 7), sway: rand() * 6.283, front: rand() < 0.3, kind: 0 });
        }
        [0.58, 0.7, 0.82, 0.93].forEach((share, m) => {
            const half = share * base / 2 * 0.88;
            for (let n = Math.round(half / base * 1300 * density); n > 0; n--) {
                const g = rand();
                dust.push({ x: fig.x + (2 * g - 1) * half, y: apexY + share * high + gauss() * base * 0.006, size: 1 + Math.pow(rand(), 3) * 2.6, at: from + SHOW_T.trace + m * 70 + g * 170,
                    phase: rand() * 6.283, rate: 2 + rand() * 5, rise: 0, sway: 0, front: rand() < 0.3, kind: 0, wave: [g * Math.PI * (5 + m) + m * 1.7 + k, base * 0.017] });
            }
        });
        for (let n = Math.round(16 * Math.sqrt(density)); n > 0; n--) {
            const u = rand(), f = rand(), side = u < 0.5 ? -1 : 1, off = gauss() * base * 0.07;
            dust.push({ x: fig.x + side * f * base / 2 + off, y: apexY + f * high + gauss() * base * 0.05, size: 5 + rand() * 9, at: from + SHOW_T.trace * (0.3 + 0.7 * rand()), phase: rand() * 6.283, rate: 0.6 + rand(),
                rise: 4 + rand() * 12, sway: rand() * 6.283, front: rand() < 0.5, kind: rand() < 0.55 ? 1 : 2 });
        }
    });
    return { record, dice, marked, corners, cx, cy, radius, points, size, slots, targets, reach, unit, w, h, letters, lines, per, type, base, high, apexY, baseY, titleTop, headY, small, figures, dust, chars: null,
        head: record.title && record.title !== record.label ? record.label + " · " + record.title : record.label || "" };
}

// The label's letters placed (needs the context's measure): L.chars = [{ ch, x, y (baseline), at }].
function showSetType(ctx, L, font) {
    ctx.font = "900 " + L.type + "px " + font; ctx.textBaseline = "alphabetic";
    const n = L.letters.length, chars = [];
    for (let line = 0; line < L.lines; line++) {
        const row = L.letters.slice(line * L.per, (line + 1) * L.per), widths = row.map(ch => ctx.measureText(ch).width), gap = L.type * 0.04;
        const total = widths.reduce((a, b) => a + b, 0) + gap * (row.length - 1), box = ctx.measureText(row.join(""));
        const mid = L.titleTop + line * L.type * 1.06 + L.type / 2, baseline = mid + (box.actualBoundingBoxAscent - box.actualBoundingBoxDescent) / 2;
        let x = L.cx - total / 2;
        row.forEach((ch, i) => { chars.push({ ch, x: x + widths[i] / 2, y: baseline, mid, at: showSlamAt(SHOW_T, line * L.per + i, n) }); x += widths[i] + gap; });
    }
    L.chars = chars;
}

// One die of the row at x, y (size px): a d4 as the face it is read from (its number at the top, the face's other two
// in the lower corners), a d8 as its hexagonal outline, other dice a tile. look: "ink" as set down, "mark" counted, "ghost" struck to an outline.
function showDie(ctx, die, index, x, y, size, look, C, font) {
    const k = size / 100;
    ctx.save();
    ctx.translate(x, y); ctx.scale(k, k);
    ctx.beginPath();
    if (die.sides === 4) { ctx.moveTo(0, -56); ctx.lineTo(48, 28); ctx.lineTo(-48, 28); ctx.closePath(); }
    else if (die.sides === 8) { [[0, -48], [42, -24], [42, 24], [0, 48], [-42, 24], [-42, -24]].forEach(([px, py], i) => ctx[i ? "lineTo" : "moveTo"](px, py)); ctx.closePath(); }
    else ctx.rect(-40, -40, 80, 80);
    if (look === "ghost") { ctx.globalAlpha = 0.32; ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke(); ctx.fillStyle = C.ink; }
    else { ctx.fillStyle = look === "mark" ? C.mark : C.ink; ctx.fill(); ctx.fillStyle = C.paper; }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "800 " + (die.sides === 4 ? 34 : 40) + "px " + font;
    ctx.fillText(String(die.face), 0, die.sides === 4 ? -4 : 2);
    if (die.sides === 4) {
        const [left, right] = checkOtherFaces(die.face, 4, index);
        ctx.font = "800 17px " + font;
        for (const [n, cx, turn] of [[left, -26, 120], [right, 26, -120]]) { ctx.save(); ctx.translate(cx, 15); ctx.rotate(turn * Math.PI / 180); ctx.fillText(String(n), 0, 0); ctx.restore(); }
    }
    ctx.restore();
}

function showFigurePath(ctx, L, k) {
    ctx.beginPath();
    L.points.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](L.cx + (x - L.cx) * k, L.cy + (y - L.cy) * k));
    ctx.closePath();
}

// The paper act at t (before the hit, and under the figure as it grows).
function showPaintPaper(ctx, L, t, C, font) {
    const T = SHOW_T, { w, h, unit } = L;
    // The shutter: paper everywhere but a triangular window on the scene, shrinking to a point (faster and faster).
    const open = L.reach * (1 - showIn(showAt(t, 0, T.irisDur)));
    ctx.fillStyle = C.paper;
    if (open > 0.001) {
        showFigurePath(ctx, L, open);
        ctx.rect(0, 0, w, h);
        ctx.fill("evenodd");
        showFigurePath(ctx, L, open);
        ctx.lineWidth = 2 * unit; ctx.strokeStyle = C.ink; ctx.stroke();
        return;
    }
    ctx.fillRect(0, 0, w, h);
    // The sheet: registration marks at its corners, the check's name at its head.
    const inset = Math.round(Math.min(w, h) * 0.035), arm = Math.round(Math.min(w, h) * 0.022);
    ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1, unit * 1.5); ctx.lineCap = "butt";
    ctx.beginPath();
    for (const [x, sx] of [[inset, 1], [w - inset, -1]]) for (const [y, sy] of [[inset, 1], [h - inset, -1]]) { ctx.moveTo(x + sx * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * arm); }
    ctx.stroke();
    if (L.head) {
        const s = L.small;
        ctx.fillStyle = C.mark;
        ctx.beginPath(); ctx.moveTo(inset + arm * 0.9 + s * 0.5, inset + arm * 0.9); ctx.lineTo(inset + arm * 0.9 + s, inset + arm * 0.9 + s * 0.87); ctx.lineTo(inset + arm * 0.9, inset + arm * 0.9 + s * 0.87); ctx.closePath(); ctx.fill();
        ctx.fillStyle = C.ink; ctx.font = "700 " + s + "px " + font; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        if ("letterSpacing" in ctx) ctx.letterSpacing = (s * 0.16) + "px";
        ctx.fillText(L.head, inset + arm * 0.9 + s * 1.7, inset + arm * 0.9 + s * 0.5);
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    }
    if (t >= T.fill) {
        // Inked: one frame a drawing, the next the solid mark, set down with a small press.
        showFigurePath(ctx, L, 0.95 + 0.05 * showBack(showAt(t, T.fill, T.fillDur)));
        ctx.fillStyle = C.mark; ctx.fill();
        return;
    }
    // The figure ruled in one stroke, corner to corner (a drafting line, a little past each corner), each angle
    // certified as the stroke reaches it.
    const flying = t >= T.fly;
    if (flying) {
    const n = L.points.length, order = Array.from({ length: n }, (_, j) => [(n - 1 + j) % n, j % n]);
    ctx.strokeStyle = C.ink; ctx.fillStyle = C.ink; ctx.lineWidth = Math.max(1.5, unit * 2); ctx.lineCap = "butt";
    ctx.font = "700 " + Math.max(11, L.radius * 0.062) + "px " + font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const angle = Math.round((n - 2) * 180 / n) + "°";
    order.forEach(([a, b], j) => {
        const e = showOut(showAt(t, showEdgeAt(T, j), T.edgeDur));
        if (e <= 0) return;
        const [ax, ay] = L.points[a], [bx, by] = L.points[b], from = -0.07, to = from + (1.14) * e;
        ctx.beginPath(); ctx.moveTo(ax + (bx - ax) * from, ay + (by - ay) * from); ctx.lineTo(ax + (bx - ax) * to, ay + (by - ay) * to); ctx.stroke();
        if (e < 1) return;
        // The angle at the corner this stroke left, now that both its edges stand (the last stroke closes two).
        for (const corner of j === 0 ? [] : j === n - 1 ? [a, b] : [a]) showAngle(ctx, L, corner, angle);
    });
    }
    // The dice: set down one by one; the unmarked struck to outlines; the marked counted, then off to the corners.
    let counted = 0, struck = 0;
    L.dice.forEach((die, i) => {
        const [sx, sy] = L.slots[i], set = showAt(t, T.deal + i * T.dealStep, T.dealDur);
        if (set <= 0) return;
        const pop = 0.55 + 0.45 * showBack(set);
        if (!die.marked) {
            const n = struck++, gone = showIn(showAt(t, T.fly + n * 25, 130));
            if (gone < 1) showDie(ctx, die, i, sx, sy, L.size * pop * (1 - gone), t >= T.ghost + n * T.ghostStep ? "ghost" : "ink", C, font);
            return;
        }
        const n = counted++, at = T.count + n * T.countStep, [tx, ty] = L.targets.get(i), f = showInOut(showAt(t, T.fly + n * T.flyStep, T.flyDur));
        const press = t >= at ? 1 + 0.24 * (1 - showOut(showAt(t, at, T.countDur))) : 1, lift = Math.sin(f * Math.PI) * L.size * 0.35;
        showDie(ctx, die, i, sx + (tx - sx) * f, sy + (ty - sy) * f - lift, L.size * pop * press, t >= at ? "mark" : "ink", C, font);
    });
    // The gauge under the row: a slot a marked die, filled as each is counted; gone as they leave.
    const slots = L.marked.length, g = L.size * 0.2, gy = h / 2 + L.size * 0.95, shown = showAt(t, T.deal + L.dice.length * T.dealStep, 1), left = showIn(showAt(t, T.fly, 130));
    if (shown && left < 1) for (let n = 0; n < slots; n++) {
        const x = L.cx + (n - (slots - 1) / 2) * g * 2.1, full = t >= T.count + n * T.countStep, k = (1 - left) * (full ? 1 + 0.5 * (1 - showOut(showAt(t, T.count + n * T.countStep, T.countDur))) : 1);
        ctx.beginPath(); ctx.moveTo(x, gy - g * 0.66 * k); ctx.lineTo(x + g * 0.58 * k, gy + g * 0.34 * k); ctx.lineTo(x - g * 0.58 * k, gy + g * 0.34 * k); ctx.closePath();
        if (full) { ctx.fillStyle = C.mark; ctx.fill(); } else { ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1, unit * 1.5); ctx.stroke(); }
    }
}
// The certified angle at a corner: an arc between its two edges and its measure, inside the figure.
function showAngle(ctx, L, corner, text) {
    const n = L.points.length, [x, y] = L.points[corner], prev = L.points[(corner + n - 1) % n], next = L.points[(corner + 1) % n];
    const a0 = Math.atan2(prev[1] - y, prev[0] - x), a1 = Math.atan2(next[1] - y, next[0] - x), r = L.size * 0.86;
    let sweep = a1 - a0; while (sweep > Math.PI) sweep -= 2 * Math.PI; while (sweep < -Math.PI) sweep += 2 * Math.PI;
    ctx.beginPath(); ctx.arc(x, y, r, a0, a0 + sweep, sweep < 0); ctx.stroke();
    const mid = a0 + sweep / 2;
    ctx.fillText(text, x + Math.cos(mid) * r * 1.62, y + Math.sin(mid) * r * 1.62);
}

// The bloom at t: the field in the mark colour, the dust (behind and in front of the label), the label, the check's line.
function showPaintBloom(ctx, L, t, C, font, still) {
    const T = SHOW_T, { w, h, unit } = L;
    if (!L.chars) showSetType(ctx, L, font);
    ctx.fillStyle = C.mark;
    ctx.fillRect(-2 * w, -2 * h, w * 5, h * 5);
    // The whole pushes in slowly while it holds; the accent drops it a hair.
    const since = t - T.accent, push = 1 + 0.04 * showOut(showAt(t, T.hit, T.end - T.hit)), drop = still || since < 0 ? 0 : h * 0.008 * Math.exp(-since / 80) * Math.cos(since / 38);
    const mx = L.cx, my = (L.apexY + L.headY) / 2;
    ctx.save();
    ctx.translate(mx, my + drop); ctx.scale(push, push); ctx.translate(-mx, -my);
    // The blows still ringing in the dust: [x, y, strength now].
    const blows = [];
    if (!still) L.chars.forEach((c, i) => {
        const x = t - c.at;
        if (x >= 0 && x < 900) blows.push([c.x, c.mid, L.type * (i === L.chars.length - 1 ? 0.13 : 0.07) * (1 - Math.exp(-x / 16)) * Math.exp(-x / 240)]);
    });
    const reach = L.type * 0.9, tau = t / 1000, hurry = still ? 0 : Math.pow(showAt(t, T.end - 500, 500), 2) * 3, swell = 0.65 + 0.35 * Math.sin(tau * 3.4);
    const layer = front => {
        const levels = [[], [], [], []], shapes = [];
        for (const p of L.dust) {
            if (p.front !== front || t < p.at) continue;
            const age = (t - p.at) / 1000;
            let x = p.x + Math.sin(p.sway + age * 1.3) * p.rise * 0.35 * unit, y = p.y - p.rise * unit * (age + hurry * age);
            if (p.wave) y += p.wave[1] * swell * Math.sin(p.wave[0] - tau * 2.6);
            for (const [bx, by, force] of blows) {
                const dx = x - bx, dy = y - by, d = Math.hypot(dx, dy) || 1, push = force * Math.exp(-d / reach);
                x += dx / d * push; y += dy / d * push;
            }
            const size = p.size * unit, light = 0.5 + 0.5 * Math.sin(p.phase + age * p.rate);
            if (p.kind) shapes.push([x, y, size, p.kind, 0.45 + 0.55 * light]);
            else levels[Math.min(3, Math.floor(light * 4))].push(x, y, size);
        }
        ctx.fillStyle = C.paper; ctx.strokeStyle = C.paper;
        levels.forEach((list, n) => {
            if (!list.length) return;
            ctx.globalAlpha = 0.4 + 0.2 * n;
            ctx.beginPath();
            for (let i = 0; i < list.length; i += 3) ctx.rect(list[i] - list[i + 2] / 2, list[i + 1] - list[i + 2] / 2, list[i + 2], list[i + 2]);
            ctx.fill();
        });
        for (const [x, y, s, kind, light] of shapes) {
            ctx.globalAlpha = light;
            ctx.beginPath(); ctx.moveTo(x, y - s * 0.66); ctx.lineTo(x + s * 0.58, y + s * 0.34); ctx.lineTo(x - s * 0.58, y + s * 0.34); ctx.closePath();
            if (kind === 1) ctx.fill(); else { ctx.lineWidth = Math.max(1, unit * 1.2); ctx.stroke(); }
        }
        ctx.globalAlpha = 1;
    };
    // Each triangle's outline, ruled fine: down both sides from the apex, then in along the base, a bright point at
    // the head of each stroke; the dust lies on it and lifts off it.
    L.figures.forEach((fig, k) => {
        const e = still ? 1 : showOut(showAt(t, T.tri + k * T.triStep, T.trace));
        if (e <= 0) return;
        const f = Math.min(1, e / 0.62), g = Math.max(0, (e - 0.62) / 0.38), s = 5 * unit;
        ctx.strokeStyle = C.paper; ctx.fillStyle = C.paper; ctx.lineWidth = Math.max(1, unit * 1.5); ctx.lineJoin = "miter"; ctx.globalAlpha = 0.6;
        ctx.beginPath();
        for (const side of [-1, 1]) {
            ctx.moveTo(fig.x, L.apexY); ctx.lineTo(fig.x + side * f * L.base / 2, L.apexY + f * L.high);
            if (g > 0) ctx.lineTo(fig.x + side * L.base / 2 * (1 - g), L.baseY);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (e < 1) for (const side of [-1, 1]) {
            const x = g > 0 ? fig.x + side * L.base / 2 * (1 - g) : fig.x + side * f * L.base / 2, y = g > 0 ? L.baseY : L.apexY + f * L.high;
            ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
    });
    layer(false);
    // The label: each letter lands opaque and oversized and is pressed to its size.
    ctx.fillStyle = C.paper;
    ctx.font = "900 " + L.type + "px " + font; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    for (const c of L.chars) {
        if (!still && t < c.at) continue;
        const k = still ? 1 : 1.42 - 0.42 * showBack(showAt(t, c.at, T.slamDur));
        ctx.save();
        ctx.translate(c.x, c.mid); ctx.scale(k, k);
        ctx.fillText(c.ch, 0, c.y - c.mid);
        ctx.restore();
    }
    layer(true);
    if (L.head && (still || t >= T.head)) {
        ctx.fillStyle = C.paper; ctx.font = "700 " + L.small + "px " + font; ctx.textBaseline = "middle";
        if ("letterSpacing" in ctx) ctx.letterSpacing = (L.small * 0.3) + "px";
        ctx.fillText(L.head, L.cx + L.small * 0.15, L.headY);
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    }
    ctx.restore();
}

// The whole show on its canvas at t ms. look: { colors: { paper, ink, mark }, font (CSS family), safe (光敏保护),
// still (减少动态: the bloom at its height, whatever t), into ([dx, dy] from the figure's centre to the record's card) }.
function showPaint(ctx, L, dpr, t, look) {
    const T = SHOW_T, C = look.colors, font = look.font, { w, h } = L;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    if (look.still) { showPaintBloom(ctx, L, T.calmAt, C, font, true); return; }
    if (t < T.hit) { showPaintPaper(ctx, L, t, C, font); return; }
    const plunge = look.safe ? SHOW_SAFE.plunge : T.plunge;
    if (t < T.end) {
        // The figure swallows the stage (falling into it: faster and faster), the bloom already inside it.
        const k = 1 + (L.reach - 1) * (look.safe ? showInOut : showIn)(showAt(t, T.hit, plunge));
        if (k < L.reach) {
            showPaintPaper(ctx, L, T.hit - 1, C, font);
            ctx.save(); showFigurePath(ctx, L, k); ctx.clip();
            showPaintBloom(ctx, L, t, C, font, false);
            ctx.restore();
        } else showPaintBloom(ctx, L, t, C, font, false);
        return;
    }
    if (t < T.end + T.ebb) {
        // The way in, backwards: the field and all it holds drawn back into the figure, the scene around it again.
        const k = L.reach + (1 - L.reach) * showInOut(showAt(t, T.end, T.ebb)), s = k / L.reach;
        ctx.save(); showFigurePath(ctx, L, k); ctx.clip();
        ctx.translate(L.cx, L.cy); ctx.scale(s, s); ctx.translate(-L.cx, -L.cy);
        showPaintBloom(ctx, L, t, C, font, false);
        ctx.restore();
        return;
    }
    // Filed: the figure goes to the record's card.
    const e = showIn(showAt(t, T.end + T.ebb, T.exit)), [dx, dy] = look.into || [0, 0];
    if (e >= 1) return;
    ctx.save();
    ctx.translate(dx * e, dy * e); ctx.translate(L.cx, L.cy); ctx.scale(1 - 0.9 * e, 1 - 0.9 * e); ctx.translate(-L.cx, -L.cy);
    showFigurePath(ctx, L, 1); ctx.fillStyle = C.mark; ctx.fill();
    ctx.restore();
}

if (typeof module !== "undefined" && typeof window === "undefined") module.exports = { SHOW_T, SHOW_SAFE, showLayout, showPaint };
