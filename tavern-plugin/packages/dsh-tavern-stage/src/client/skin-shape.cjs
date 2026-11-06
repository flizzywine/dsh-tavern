function createStageSkinShape({React,window,document,MutationObserver,ResizeObserver,clock:forkForeground}) {
let disposed=false;
const releases=new Set();
function own(setup) {
    if(disposed)return ()=>{};
    let live=true;const cleanup=[];
    const release=()=>{if(!live)return;live=false;releases.delete(release);const errors=[];for(const fn of cleanup.reverse()){try{fn();}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'Skin decoration cleanup failed');};
    releases.add(release);
    try{setup(fn=>cleanup.push(fn),()=>live&&!disposed);}catch(error){try{release();}catch(other){throw new AggregateError([error,other],'Skin decoration setup failed');}throw error;}
    return release;
}
function dispose(){if(disposed)return;disposed=true;const errors=[];for(const release of [...releases]){try{release();}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'Skin decoration disposal failed');}
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
    React.useLayoutEffect(() => own((add,live) => {
        const span = ref.current; if (!span) return;
        let frame = 0;
        const run = () => { if(!live())return; frame = 0; const next = stageShapeMeasure(span, shape.view); if (next) setM(prev => prev.width === next.width && prev.lines === next.lines && prev.seed === next.seed ? prev : next); };
        add(()=>{if(frame)forkForeground.cancelAnimationFrame(frame);});
        run();
        const later = () => { if (live() && !frame) frame = forkForeground.requestAnimationFrame(run); };
        const text = span.closest('.fork-gal-box')?.querySelector(':scope > .fork-gal-text');
        const watch = text && typeof MutationObserver === 'function' ? new MutationObserver(later) : null;
        add(()=>watch?.disconnect());
        watch?.observe(text, {childList: true, subtree: true, characterData: true});
        // the SVG's own size is the design px unit: it is 0 until the stage marks the skin's art (data-fk-skin-shape)
        const sized = typeof ResizeObserver === 'function' ? new ResizeObserver(later) : null;
        add(()=>sized?.disconnect());
        sized?.observe(span.querySelector('svg'));
        add(()=>window.removeEventListener('resize',later));
        window.addEventListener('resize',later);
        add(()=>document.fonts?.removeEventListener('loadingdone',later));
        document.fonts?.addEventListener('loadingdone',later);
    }), [page, narration, shape]);
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
return {Shape:StageSkinShape, box:stageShapeBox, dispose};
}
if(typeof module!=="undefined"&&typeof window==="undefined")module.exports={createStageSkinShape};
