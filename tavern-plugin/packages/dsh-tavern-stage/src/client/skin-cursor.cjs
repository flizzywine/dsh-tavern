function createStageSkinCursor({React, matchMedia, clock}) {
let disposed = false;
const releases = new Set();
// Closed, generic drawing vocabulary from the frozen skin contract (40c409bf).
  const STAGE_SKIN_CURSORS = {
    triangle(x, k, c) { if (k % 2) return; x.fillStyle = c.color; x.beginPath(); x.moveTo(9, 12); x.lineTo(25, 12); x.lineTo(17, 24); x.fill(); },
    wheel(x, k, c) { x.translate(17, 17); x.rotate(k * Math.PI / 6); x.strokeStyle = c.color; x.lineWidth = 2; x.beginPath(); x.arc(0, 0, 11, 0, 7); x.stroke(); for (let i = 0; i < 8; i++) { x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(i * Math.PI / 4) * 11, Math.sin(i * Math.PI / 4) * 11); x.stroke(); } x.fillStyle = c.accent; x.beginPath(); x.arc(0, 0, 3.5, 0, 7); x.fill(); },
    lollipop(x, k, c) { x.strokeStyle = c.color; x.lineWidth = 3; x.beginPath(); x.moveTo(17, 18); x.lineTo(17, 33); x.stroke(); x.translate(17, 13); x.rotate(k * Math.PI / 4); x.fillStyle = c.color; x.beginPath(); x.arc(0, 0, 11, 0, 7); x.fill(); x.strokeStyle = c.accent; x.lineWidth = 2.5; x.beginPath(); for (let a = 0; a < 12; a += 0.3) { const r = a * 0.85; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.stroke(); },
    eye(x, k, c) { const shut = k % 6 === 0; x.translate(17, 17); x.fillStyle = c.color; x.beginPath(); x.ellipse(0, 0, 13, shut ? 1.5 : 10, 0, 0, 7); x.fill(); if (!shut) { x.fillStyle = c.accent; x.beginPath(); x.arc((k % 3) - 1, 0, 6, 0, 7); x.fill(); x.fillStyle = "#000"; x.beginPath(); x.arc((k % 3) - 1, 0, 3, 0, 7); x.fill(); } },
    rose(x, k, c) { x.translate(17, 16); x.rotate(k * 0.35); x.fillStyle = c.accent; for (let i = 0; i < 5; i++) { x.rotate(Math.PI * 2 / 5); x.beginPath(); x.ellipse(0, -6, 5, 8, 0, 0, 7); x.fill(); } x.fillStyle = c.color; x.beginPath(); x.arc(0, 0, 4, 0, 7); x.fill(); },
    rec(x, k, c) { x.fillStyle = c.color; x.fillRect(4, 8, 26, 18); x.fillStyle = k % 2 ? c.accent : c.color; x.beginPath(); x.arc(12, 17, 5, 0, 7); x.fill(); x.fillStyle = c.accent; x.fillRect(20, 14, 7, 2); x.fillRect(20, 19, 5, 2); },
    candle(x, k, c) { x.fillStyle = c.color; x.fillRect(13, 15, 8, 17); x.fillStyle = c.accent; x.beginPath(); const lean = [0, 2, -1, 1][k % 4]; x.moveTo(17, 14); x.quadraticCurveTo(10 + lean, 8, 17 + lean, 1); x.quadraticCurveTo(24 + lean, 8, 17, 14); x.fill(); },
    gear(x, k, c) { x.translate(17, 17); x.rotate(-k * Math.PI / 8); x.fillStyle = c.color; for (let i = 0; i < 8; i++) { x.rotate(Math.PI / 4); x.fillRect(-3, -15, 6, 6); } x.beginPath(); x.arc(0, 0, 10, 0, 7); x.fill(); x.fillStyle = c.accent; x.beginPath(); x.arc(0, 0, 4, 0, 7); x.fill(); },
    light(x, k, c) { const on = k % 4 !== 3; x.fillStyle = on ? c.accent : c.color; x.fillRect(5, 5, 24, 24); x.fillStyle = c.color; x.fillRect(9, 9, 16, 16); if (on) { x.fillStyle = c.accent; x.fillRect(13, 13, 8, 8); } },
    bell(x, k, c) { x.translate(17, 6); x.rotate([0.35, 0, -0.35, 0][k % 4]); x.fillStyle = c.color; x.beginPath(); x.moveTo(-10, 20); x.quadraticCurveTo(-10, 2, 0, 2); x.quadraticCurveTo(10, 2, 10, 20); x.closePath(); x.fill(); x.fillStyle = c.accent; x.beginPath(); x.arc(0, 23, 3.5, 0, 7); x.fill(); },
    feather(x, k, c) { x.translate(17, 8 + (k % 4) * 4); x.rotate([0.5, 0.1, -0.4, 0.1][k % 4]); x.fillStyle = c.color; x.beginPath(); x.ellipse(0, 0, 5, 12, 0, 0, 7); x.fill(); x.strokeStyle = c.accent; x.lineWidth = 1.5; x.beginPath(); x.moveTo(0, -12); x.lineTo(0, 14); x.stroke(); },
    needle(x, k, c) { x.translate(17, 17); x.rotate(Math.PI / 4 + (k % 2) * 0.12); x.strokeStyle = c.color; x.lineWidth = 2.5; x.beginPath(); x.moveTo(0, -14); x.lineTo(0, 14); x.stroke(); x.strokeStyle = c.accent; x.lineWidth = 1.5; x.beginPath(); x.ellipse(0, -10, 1.6, 3, 0, 0, 7); x.stroke(); x.beginPath(); x.moveTo(0, -10); x.quadraticCurveTo(10, 0, 4 + (k % 3) * 2, 14); x.stroke(); },
    teacup(x, k, c) { x.fillStyle = c.color; x.beginPath(); x.moveTo(5, 13); x.lineTo(25, 13); x.quadraticCurveTo(24, 28, 15, 28); x.quadraticCurveTo(6, 28, 5, 13); x.fill(); x.strokeStyle = c.color; x.lineWidth = 2.5; x.beginPath(); x.arc(26, 18, 4, -1.4, 1.4); x.stroke(); x.strokeStyle = c.accent; x.lineWidth = 2; x.beginPath(); x.moveTo(12, 10); x.quadraticCurveTo(10 + (k % 2) * 4, 6, 13, 2); x.stroke(); },
    // two arrowed arcs turning, a reload ring (12 steps per turn).
    ring(x, k, c) { x.translate(17, 17); x.rotate(k * Math.PI / 6); x.lineWidth = 3; x.lineCap = 'round';
      for (let i = 0; i < 2; i++) { x.rotate(Math.PI); x.strokeStyle = i ? c.accent : c.color; x.fillStyle = x.strokeStyle; x.beginPath(); x.arc(0, 0, 10, 0.35, 2.55); x.stroke();
        x.beginPath(); x.moveTo(Math.cos(2.55) * 6.8, Math.sin(2.55) * 6.8); x.lineTo(Math.cos(2.55) * 13.2, Math.sin(2.55) * 13.2); x.lineTo(Math.cos(2.92) * 10, Math.sin(2.92) * 10); x.fill(); } },
    // the ガルパ page cue - a leaning "!" bolt (a notch out on the right, a step
    // in on the left) with a small star for its dot, both outlined in the accent, hopping (8 steps per hop). Traced from
    // the official still in px (bbox 24x40 with the outline), drawn at .78 into the 34-unit box.
    star(x, k, c) { const p = k % 8, lift = [0, 1.5, 2.5, 3, 2.5, 1.5, 0, 0][p]; x.translate(7.6, 3 - lift); x.scale(.78, .78); x.lineJoin = 'round';
      const bolt = () => { x.beginPath(); [[18, 2], [20.6, 2], [19.6, 8.6], [22.6, 9.2], [19.6, 19.6], [16.6, 26], [12, 26], [14, 20.2], [10, 19.6], [14, 9]].forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.closePath(); };
      const star = () => { x.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 3 : 6.8, a = -Math.PI / 2 - .17 + i * Math.PI / 5; x.lineTo(8 + Math.cos(a) * r, 32 + Math.sin(a) * r); } x.closePath(); };
      x.strokeStyle = c.accent; x.lineWidth = 4; bolt(); x.stroke(); star(); x.stroke();
      x.fillStyle = c.color; bolt(); x.fill(); star(); x.fill(); },
    // a cut-paper dart pointing on, its accent shadow knocked down-right;
    // it jabs forward on twos (4 steps), no easing.
    arrow(x, k, c) { const push = [0, 1.5, 3, 1.5][k % 4]; x.translate(push, 0); x.lineJoin = 'miter';
      const dart = (dx, dy) => { x.beginPath(); [[4, 7], [27.5, 15.5], [6, 27], [11, 16.5]].forEach(([a, b], i) => i ? x.lineTo(a + dx, b + dy) : x.moveTo(a + dx, b + dy)); x.closePath(); };
      x.fillStyle = c.accent; dart(2.5, 2.5); x.fill(); x.fillStyle = c.color; dart(0, 0); x.fill(); },
    // page cues measured on the official stills. gem = the PSP
    // pearl (below); sphere = the Vita orb (a ball in the colour, accent rim and down triangle) bobbing.
    // fleur = the マギアレコード page cue (traced 1:1 from the owner's 485 x 651 still in its px):
    // a gold four-point head with concave sides and four cut-out lobes (top, left, right and a softer bottom one) on a
    // down arrow with sharp barbs, a dark olive outline (the accent) and a soft shadow under it; the body is lit at the
    // top and the tip, darker at the neck. 1.17em tall in the 1.3em cue (record_03: 1.2em). Re-traced 2026-10:
    // the head's sides are concave between round points, the neck is longer and the barbs
    // rise to round tips; three full lobes (a diamond over two teardrops) leave a light Y between them. Drawn still: the
    // measured bob is a compositor transform on its canvas (theme.css「stage skin: art」 fork-art-cue-bob).
    fleur(x, k, c) { const rgb = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c.color || ''), base = rgb ? rgb.slice(1).map(v => parseInt(v, 16)) : null;
      const tone = t => base ? 'rgb(' + base.map(v => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t))).join(' ') + ')' : c.color;
      x.translate(3.54, 2.2); x.scale(.058, .058); x.translate(0, -42); x.lineJoin = 'round';
      // the right half in the still's px, mirrored about x 232 (the left half drawn back up from the tip)
      const half = [[244, 62, 'q', 232, 48], [380, 160, 'c', 262, 92, 318, 150], [382, 180, 'q', 398, 168], [312, 288, 'c', 352, 200, 318, 240], [312, 322, 'l'],
        [336, 330, 'q', 320, 336], [390, 312, 'c', 356, 322, 376, 308], [396, 334, 'q', 406, 318], [246, 548, 'l'], [218, 548, 'q', 232, 566]];
      const outline = () => { x.beginPath(); x.moveTo(220, 62);
        for (const [px, py, kind, ...k] of half) { if (kind === 'l') x.lineTo(px, py); else if (kind === 'q') x.quadraticCurveTo(k[0], k[1], px, py); else x.bezierCurveTo(k[0], k[1], k[2], k[3], px, py); }
        const M = v => 464 - v;
        for (let i = half.length - 2; i >= 1; i--) { const to = half[i - 1], [, , kind, ...k] = half[i];
          if (kind === 'l') x.lineTo(M(to[0]), to[1]); else if (kind === 'q') x.quadraticCurveTo(M(k[0]), k[1], M(to[0]), to[1]); else x.bezierCurveTo(M(k[2]), k[3], M(k[0]), k[1], M(to[0]), to[1]); }
        x.closePath(); };
      x.save(); x.shadowColor = c.accent; x.shadowBlur = 5; x.shadowOffsetY = 3; x.fillStyle = c.accent; outline(); x.fill(); x.restore();
      x.strokeStyle = c.accent; x.lineWidth = 22; outline(); x.stroke();
      const body = x.createLinearGradient(0, 42, 0, 572); body.addColorStop(0, tone(.2)); body.addColorStop(.3, tone(.05)); body.addColorStop(.52, tone(-.12)); body.addColorStop(.8, tone(.3)); body.addColorStop(1, tone(.22));
      x.fillStyle = body; outline(); x.fill();
      x.fillStyle = tone(-.36); x.beginPath(); x.moveTo(232, 112); x.quadraticCurveTo(246, 134, 260, 150); x.quadraticCurveTo(246, 166, 232, 186); x.quadraticCurveTo(218, 166, 204, 150); x.quadraticCurveTo(218, 134, 232, 112); x.closePath();
      for (const m of [1, -1]) { const X = v => m > 0 ? v : 464 - v; x.moveTo(X(150), 184); x.bezierCurveTo(X(172), 174, X(200), 182, X(212), 200); x.bezierCurveTo(X(216), 222, X(216), 248, X(212), 272); x.bezierCurveTo(X(186), 256, X(156), 226, X(150), 184); x.closePath(); }
      x.fill(); x.fillStyle = tone(-.1); x.beginPath(); x.moveTo(204, 272); x.bezierCurveTo(220, 280, 244, 280, 260, 272); x.lineTo(262, 330); x.bezierCurveTo(258, 352, 248, 372, 232, 388); x.bezierCurveTo(216, 372, 206, 352, 202, 330); x.closePath(); x.fill(); },
    // gem (review, psp_01 / psp_03 / psp_04 at 4x): the PSP page cue is a round glossy pearl, not a crowned
    // soul gem - a dark hairline edge, a thin light ring, a body lit from the top (pale pink -> pink -> the deep colour at
    // the bottom), a soft gloss cap and a faint glow in the colour. The gloss breathes (6 steps); it never moves.
    gem(x, k, c) { const rgb = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c.color || ''), base = rgb ? rgb.slice(1).map(v => parseInt(v, 16)) : null;
      // toward white by t (no colour literal: the paint is the skin's cursor.color); a non-hex colour is used as is
      const lift = (t, a = 1) => base ? 'rgb(' + base.map(v => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t))).join(' ') + ' / ' + a + ')' : c.color; // t < 0 darkens
      const gloss = [.4, .48, .55, .6, .55, .48][k % 6];
      x.translate(17, 17);
      x.save(); x.shadowColor = lift(.2, .8); x.shadowBlur = 4; x.fillStyle = c.accent; x.beginPath(); x.arc(0, 0, 11.2, 0, 7); x.fill(); x.restore();
      x.fillStyle = lift(.72); x.beginPath(); x.arc(0, 0, 10.3, 0, 7); x.fill();
      const body = x.createLinearGradient(0, -9.2, 0, 9.2); body.addColorStop(0, lift(.55)); body.addColorStop(.4, lift(.15)); body.addColorStop(.75, lift(-.04)); body.addColorStop(1, lift(-.24));
      x.fillStyle = body; x.beginPath(); x.arc(0, 0, 9.2, 0, 7); x.fill();
      const cap = x.createLinearGradient(0, -8.6, 0, -1.6); cap.addColorStop(0, base ? 'rgb(' + [255, 255, 255].join(' ') + ' / ' + gloss + ')' : c.accent); cap.addColorStop(1, base ? 'rgb(' + [255, 255, 255].join(' ') + ' / 0)' : c.accent);
      x.fillStyle = cap; x.beginPath(); x.ellipse(0, -4.6, 6.4, 4, 0, 0, 7); x.fill();
      x.globalAlpha = .35; x.fillStyle = lift(.6); x.beginPath(); x.ellipse(0, 6.4, 4.6, 1.6, 0, 0, 7); x.fill(); x.globalAlpha = 1; },
    // play (PSP ポータブル 1:1, measured on 30 fps gameplay frames): the page cue is the round ▷ button set in the
    // box's bottom rim; while the page waits it pulses from its resting face (cursor.accent disc, a darker ▷) to the lit
    // one (cursor.color disc lit from the top, a white ▷) and back, 21 frames a cycle (8 steps at fps 12).
    play(x, k, c) { const t = (1 - Math.cos((k % 8) / 8 * Math.PI * 2)) / 2, hex = v => (/^#?([0-9a-f]{6})$/i.exec(v || '') || [])[1];
      const rgb = [hex(c.accent), hex(c.color)].map(h => h ? [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) : [255, 255, 255]);
      const at = (light = 0) => 'rgb(' + rgb[0].map((v, i) => Math.round((v + (rgb[1][i] - v) * t) * (1 - light) + 255 * light)).join(' ') + ')';
      x.translate(17, 17); const body = x.createLinearGradient(0, -15, 0, 15); body.addColorStop(0, at(.45)); body.addColorStop(.55, at()); body.addColorStop(1, at());
      x.fillStyle = body; x.beginPath(); x.arc(0, 0, 15, 0, 7); x.fill();
      x.fillStyle = 'rgb(' + [0, 1, 2].map(i => Math.round(110 + (255 - 110) * t)).join(' ') + ' / ' + (.75 + .25 * t) + ')';
      x.beginPath(); x.moveTo(-4.5, -7.5); x.lineTo(7.5, 0); x.lineTo(-4.5, 7.5); x.closePath(); x.fill(); },
    sphere(x, k, c) { x.translate(17, 18 - [0, 1, 2, 1][k % 4]);
      x.fillStyle = c.accent; x.beginPath(); x.arc(0, 0, 13, 0, 7); x.fill(); x.fillStyle = c.color; x.beginPath(); x.arc(0, 0, 11, 0, 7); x.fill();
      x.globalCompositeOperation = 'lighter'; x.globalAlpha = .45; x.beginPath(); x.ellipse(-3, -5.5, 6, 3.4, -0.3, 0, 7); x.fill(); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      x.fillStyle = c.accent; x.beginPath(); x.moveTo(-6.5, -1.5); x.lineTo(6.5, -1.5); x.lineTo(0, 6.5); x.closePath(); x.fill(); },
    // original designer whale, on the same reduced-motion clock as every cursor.
    whale(x, k, c) {
  const p = k % 6;
  x.translate(0, [0, -1, -1, 0, 0, 0][p]);
  x.fillStyle = c.color;
  // body
  x.beginPath(); x.moveTo(2.5, 21); x.bezierCurveTo(2.5, 13, 9, 10.5, 16, 10.5); x.bezierCurveTo(22, 11, 25.5, 15, 26, 19);
  x.quadraticCurveTo(26.5, 24.5, 20, 26); x.lineTo(9, 26); x.quadraticCurveTo(2.5, 26, 2.5, 21); x.fill();
  // tail stock + fluke
  x.beginPath(); x.moveTo(22, 21); x.quadraticCurveTo(28.5, 18, 28.5, 12); x.quadraticCurveTo(26.5, 9, 25, 6); x.quadraticCurveTo(28, 7, 29.2, 9.5);
  x.quadraticCurveTo(30.5, 7, 33, 6.5); x.quadraticCurveTo(31.5, 10, 30.6, 13); x.quadraticCurveTo(30, 20, 24, 24.5); x.closePath(); x.fill();
  // eye and belly line: punched out
  x.globalCompositeOperation = 'destination-out';
  x.beginPath(); x.arc(8.2, 17.2, 1.7, 0, 7); x.fill();
  x.lineWidth = 1.5; x.lineCap = 'round'; x.beginPath(); x.moveTo(5, 22.4); x.quadraticCurveTo(12, 24.6, 20.5, 23); x.stroke();
  x.globalCompositeOperation = 'source-over';
  // spout
  if (p < 4) {
    x.fillStyle = c.accent;
    const y = 8 - p * 1.4, r = 1.8 - p * 0.25;
    x.beginPath(); x.arc(10, y, r, 0, 7); x.fill();
    x.beginPath(); x.arc(13.4, y - 1.6, r * 0.8, 0, 7); x.fill();
    if (p > 0) { x.beginPath(); x.arc(7, y - 0.6, r * 0.7, 0, 7); x.fill(); }
  }
},
  };
// the ADV cues are drawn larger (ring / star at ~1.6em), so their canvas keeps
// 3x backing pixels; every other cursor keeps its 34px canvas unchanged.
const STAGE_SKIN_CURSOR_SCALE = {ring:3, star:3, arrow:3, fleur:3, gem:3, sphere:3, play:3};

function mount(canvas, {cursor, active, snap}) {
    if (disposed || !canvas) return () => {};
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};
    const scale = STAGE_SKIN_CURSOR_SCALE[cursor?.name] || 1;
    const settings = {name:'triangle', color:'#ffffff', accent:'#ffffff', fps:8, ...cursor};
    const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    let step = 0, timer, live = true;
    function draw() {
        if (!live || disposed) return;
        ctx.clearRect(0, 0, 34*scale, 34*scale);
        ctx.save();
        try { if (scale !== 1) ctx.scale(scale, scale); STAGE_SKIN_CURSORS[settings.name](ctx, step++, settings); }
        finally { ctx.restore(); }
        if (active && !snap) timer = clock.setTimeout(draw, (settings.name === 'rec' ? 500 : 1000/settings.fps)*(motion?.matches ? 2 : 1));
    }
    function reset() {
        if (!live || disposed) return;
        if (timer !== undefined) clock.clearTimeout(timer);
        timer = undefined; step = 0; draw();
    }
    function release() {
        if (!live) return;
        live = false; releases.delete(release);
        const errors = [];
        for (const cleanup of [() => motion?.removeEventListener('change', reset), () => { if (timer !== undefined) clock.clearTimeout(timer); }, () => ctx.clearRect(0,0,34*scale,34*scale)]) {
            try { cleanup(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'Stage cursor cleanup failed');
    }
    releases.add(release);
    try { motion?.addEventListener('change', reset); draw(); }
    catch (error) { try { release(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Stage cursor mount failed'); } throw error; }
    return release;
}
function Cursor({cursor, active, snap}) {
    const ref = React.useRef(null), scale = STAGE_SKIN_CURSOR_SCALE[cursor?.name] || 1;
    React.useEffect(() => mount(ref.current, {cursor, active, snap}), [cursor, active, snap, scale]);
    return React.createElement('canvas', {ref, width:34*scale, height:34*scale, 'aria-hidden':true});
}
return {Cursor, mount, dispose() {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (const release of [...releases]) { try { release(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Stage cursors cleanup failed');
}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageSkinCursor};
