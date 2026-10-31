function StageSkinCursor(props) { return stageViews ? React.createElement(stageViews.skinCursor.Cursor, props) : null; }
function stageSkinBand(b,side) {
    const c=b.colors,h=b.height||14,top=side==='top',style={left:b.inset??24,right:b.inset??24,[side]:b.offset??9,height:h};
    const paints={
        staff:`repeating-linear-gradient(${c[0]} 0 1px,transparent 1px ${Math.max(3,h/4|0)}px)`,
        rule:`linear-gradient(${c[0]},${c[0]})`,
        dots:`radial-gradient(circle,${c[0]} 0 ${h/4}px,transparent ${h/4+.5}px) 0 0/${h*1.4}px ${h}px repeat-x`,
        stripes:`repeating-linear-gradient(45deg,${c[0]} 0 8px,${c[1]||'transparent'} 8px 16px)`,
        teeth:`conic-gradient(from ${top?135:-45}deg at 50% ${top?0:100}%,${c[0]} 90deg,transparent 0) 0 0/${h*1.5}px ${h}px repeat-x`,
        scanlines:`repeating-linear-gradient(${c[0]} 0 2px,transparent 2px 5px)`,
        fence:`conic-gradient(from 150deg at 50% 0,${c[0]} 60deg,transparent 0) 0 0/${h}px ${h*.7}px repeat-x,linear-gradient(${c[0]},${c[0]}) 0 100%/100% 2px no-repeat`,
        stained:`repeating-linear-gradient(90deg,${c.map((color,i)=>`${color} ${i*34}px ${i*34+30}px,#000000 ${i*34+30}px ${i*34+34}px`).join(',')})`,
        lace:`radial-gradient(circle at 50% ${top?0:100}%,${c[0]} 0 ${h*.55}px,transparent ${h*.55+.5}px) 0 0/${h*1.2}px ${h}px repeat-x`,
        checker:`conic-gradient(${c[0]} 25%,${c[1]||'transparent'} 0 50%,${c[0]} 0 75%,${c[1]||'transparent'} 0) 0 0/${h}px ${h}px`,
        chain:`radial-gradient(circle,transparent 0 ${h*.22}px,${c[0]} ${h*.22}px ${h*.38}px,transparent ${h*.38+.5}px) 0 0/${h*.9}px ${h}px repeat-x`
    };
    style.background=paints[b.pattern];
    if(b.pattern==='rule'){style.height=1;style.boxShadow=`0 ${top?4:-4}px 0 ${c[1]||c[0]}`;}
    return style;
}
// a skin's text box drawn as
// vector shapes from its own data - one SVG over art.shape.view (design px). The page's text is measured in design px (its
// widest extent and its rows); boxes[min(rows, n) - 1] draws it, the narration box a narration page. A point [x, y, kx, ky]
// moves (kx, ky) per unit of the box's stretch: S = max(min, base + width x text width + line x (rows - 1)), per axis (y as
// x when omitted). A box's parts remount each page and turn by one of turn.deg (picked from the page's text) about
// turn.pivot; origin = where the page's entrance (the layout's motion) grows from; still parts stay put. Drawn at 0.1 px.
function stageShapeStretch(s, width, lines) { return s ? Math.max(s.min ?? -Infinity, s.base + (s.width || 0) * width + (s.line || 0) * (lines - 1)) : 0; }
function stageShapePoint(p, S) { return [p[0] + (p[2] || 0) * S[0], p[1] + (p[3] || 0) * S[1]]; }
function stageShapePath(points, S) { return 'M' + points.map(p => stageShapePoint(p, S).map(v => Math.round(v * 10) / 10).join(' ')).join('L') + 'Z'; }
function stageShapeSeed(text) { let n = 2166136261; for (const ch of text) n = Math.imul(n ^ ch.codePointAt(0), 16777619); return n >>> 0; }
// The drawn box for a page: `lines` text rows, `width` the text's extent and `seed` the page text's hash, in design px.
function stageShapeBox(shape, {lines, width, seed}, narration) {
    const index = Math.min(lines, shape.boxes.length) - 1, box = narration && shape.narration || shape.boxes[index];
    const S = [stageShapeStretch(box.stretch?.x, width, lines), stageShapeStretch(box.stretch?.y || box.stretch?.x, width, lines)];
    const draw = part => part.points ? {paint: part.paint, edge: part.edge, d: stageShapePath(part.points, S)}
        : (([cx, cy]) => ({paint: part.paint, edge: part.edge, ellipse: [cx, cy, part.ellipse[4], part.ellipse[5], part.ellipse[6]]}))(stageShapePoint(part.ellipse, S));
    return {lines: index + 1, parts: box.parts.map(draw), still: (box.still || []).map(draw), origin: box.origin || null,
        turn: box.turn ? [box.turn.deg[seed % box.turn.deg.length], ...box.turn.pivot] : null};
}
// Measures the page's text (the full laid-out page: unrevealed glyphs keep their place) in design px; glyph rows more than 20
// design px apart are separate lines.
function stageShapeMeasure(span, view) {
    const box = span.closest('.fork-gal-box'), type = box?.querySelector(':scope > .fork-gal-text > .fork-gal-type');
    const svg = span.querySelector('svg'), unit = svg ? svg.getBoundingClientRect().height / view[3] : 0;
    if (!type || !(unit > 0)) return null;
    const range = document.createRange(); range.selectNodeContents(type);
    const rects = [...range.getClientRects()].filter(rect => rect.width > 0.5);
    if (!rects.length) return null;
    const left = Math.min(...rects.map(rect => rect.left)), right = Math.max(...rects.map(rect => rect.right));
    const mids = rects.map(rect => (rect.top + rect.bottom) / 2).sort((a, b) => a - b);
    const lines = mids.filter((mid, i) => i === 0 || mid - mids[i - 1] > unit * 20).length;
    return {width: Math.round((right - left) / unit), lines, seed: stageShapeSeed(type.textContent || '')};
}
function StageSkinShape({shape, page, narration}) {
    const h = React.createElement, ref = React.useRef(null), [m, setM] = React.useState({width: 0, lines: 1, seed: 0});
    React.useLayoutEffect(() => {
        const span = ref.current; if (!span) return;
        let frame = 0;
        const run = () => { frame = 0; const next = stageShapeMeasure(span, shape.view); if (next) setM(prev => prev.width === next.width && prev.lines === next.lines && prev.seed === next.seed ? prev : next); };
        run();
        const later = () => { if (!frame) frame = forkForeground.requestAnimationFrame(run); };
        const text = span.closest('.fork-gal-box')?.querySelector(':scope > .fork-gal-text');
        const watch = text && typeof MutationObserver === 'function' ? new MutationObserver(later) : null;
        watch?.observe(text, {childList: true, subtree: true, characterData: true});
        // the SVG's own size is the design px unit: it is 0 until the stage marks the skin's art (data-fk-skin-shape)
        const sized = typeof ResizeObserver === 'function' ? new ResizeObserver(later) : null;
        sized?.observe(span.querySelector('svg'));
        window.addEventListener('resize', later); document.fonts?.addEventListener('loadingdone', later);
        return () => { watch?.disconnect(); sized?.disconnect(); window.removeEventListener('resize', later); document.fonts?.removeEventListener('loadingdone', later); if (frame) forkForeground.cancelAnimationFrame(frame); };
    }, [page, narration, shape]);
    const box = stageShapeBox(shape, m, narration);
    // paint: bg / border = textbox.paint, name = nameplate.paint.bg (shown while a name shows); edge = an outline in textbox.paint.bg
    const part = (p, key) => {
        const look = {key, 'data-paint': p.paint, ...(p.edge ? {'data-edge': '', strokeWidth: p.edge} : {})};
        return p.d ? h('path', {...look, d: p.d}) : h('ellipse', {...look, cx: p.ellipse[0], cy: p.ellipse[1], rx: p.ellipse[2], ry: p.ellipse[3], transform: `rotate(${p.ellipse[4]} ${p.ellipse[0]} ${p.ellipse[1]})`});
    };
    const parts = box.parts.map(part);
    return h('span', {ref, className: 'fork-skin-frame', 'aria-hidden': true},
        h('svg', {className: 'fork-skin-shape', viewBox: shape.view.join(' '), 'data-lines': box.lines, preserveAspectRatio: 'none'},
            h('g', {key: (narration ? 'n:' : 'b:') + page, className: 'fork-skin-shape-page', ...(box.origin ? {'data-enter': '', style: {transformOrigin: box.origin[0] + 'px ' + box.origin[1] + 'px'}} : {})},
                box.turn ? h('g', {transform: `rotate(${box.turn[0]} ${box.turn[1]} ${box.turn[2]})`}, parts) : parts),
            box.still.map(part)));
}
// art.textbox.readout (N2): a local clock printed on the box image - its label, then HH:MM:SS, updated every
// second (placed and styled by theme.css «art readout»). Pure text: hidden from assistive technology with the frame.
function stageSkinClock(date) { return [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, '0')).join(':'); }
function StageSkinReadout({readout}) {
    const [now, setNow] = React.useState(() => stageSkinClock(new Date()));
    React.useEffect(() => {
        let timer = 0;
        const tick = () => { setNow(stageSkinClock(new Date())); timer = forkForeground.setTimeout(tick, 1000 - Date.now() % 1000 + 5); };
        timer = forkForeground.setTimeout(tick, 1000 - Date.now() % 1000 + 5);
        return () => forkForeground.clearTimeout(timer);
    }, []);
    return React.createElement('b', {className: 'fork-skin-readout'}, (readout.label ? readout.label + '  ' : '') + now);
}
function StageSkinFrame({skin, page = '', narration = false}) {
    // A skin with art.shape draws its box as that SVG (shown on wide stages, theme.css「stage skin: art」); elsewhere the
    // same span keeps the layout's own CSS frame (P5's slash polygons on phones) and the SVG stays hidden.
    if (skin.art?.shape && page) return React.createElement(StageSkinShape, {shape: skin.art.shape, page, narration});
    const h=React.createElement,frame=skin.textbox.frame||{},corner=frame.corners,readout=skin.art?.textbox?.readout;
    const drawings={diamond:['M2 28V8Q2 2 8 2H28','M15 6l5 5-5 5-5-5z'],rivet:['M2 28V2H28','M15 11a4 4 0 1 0-8 0a4 4 0 1 0 8 0'],bow:['M15 15C3 3 3 21 15 15C27 3 27 21 15 15','M18 15a3 3 0 1 0-6 0a3 3 0 1 0 6 0'],bracket:['M3 27V3H27','M9 21V9H21'],
        // a fine filigree curl in two opposite corners only (top-right, bottom-left).
        flourish:['M4 26C4 13 10 5 24 4M9 17c0-5 4-8 8-6c3 2 1 6-2 5c-2-1-1-3 1-3','M24 2.5c3-1.5 6-.5 7 1.5c-3 1-5 1-7-1.5zM2.5 26c-1.5 3-.5 5.5 1.5 6c1-3 .5-5-1.5-6z']};
    const at=corner?.kind==='flourish'?['tr','bl']:['tl','tr','br','bl'], fine=corner?.kind==='flourish';
    return h('span',{className:'fork-skin-frame','aria-hidden':true},
        readout?h(StageSkinReadout,{key:'readout',readout}):null,
        ['top','bottom'].map(side=>frame[side]?h('i',{key:side,'data-band':side,style:stageSkinBand(frame[side],side)}):null),
        drawings[corner?.kind]?at.map(position=>h('svg',{key:position,className:'fork-skin-corner '+position,'data-corner':corner.kind,viewBox:'0 0 32 32',style:{rotate:['tl','tr','br','bl'].indexOf(position)*90+'deg'},fill:'none'},
            h('path',{d:drawings[corner.kind][0],stroke:corner.colors?.[0]||skin.textbox.paint.border||skin.textbox.paint.fg,strokeWidth:fine?1.6:3,strokeLinecap:fine?'round':undefined}),
            h('path',{d:drawings[corner.kind][1],fill:corner.colors?.[1]||skin.textbox.paint.accent||skin.textbox.paint.fg,stroke:corner.colors?.[0]||skin.textbox.paint.fg,strokeWidth:fine?.6:1.5}))):null);
}
