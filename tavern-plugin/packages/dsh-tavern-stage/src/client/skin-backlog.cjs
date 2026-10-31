function createStageSkinBacklog() {
const STAGE_BACKLOG_DEFAULTS = Object.freeze({
    list:{close:'head',roles:{speech:'row',player:'row',narration:'row',notice:'row',divider:'rule'}},
    overlay:{close:'corner',roles:{speech:'bubble',player:'bubble',narration:'band',notice:'band',divider:'none'}}});
const STAGE_BACKLOG_OPACITY = Object.freeze({bubble:.9,plaque:.9,band:.8});
// The engine's own measures (px at a 16 px reading size), for an overlay skin without metrics.
const STAGE_BACKLOG_METRICS = Object.freeze({
    bubble:{w:600,h:84,inset:40,corner:10,line:0,rim:1.5,tail:[16,34,22,40],name:[18,10,16],text:[30,28,52,16,27],margin:[8,8]},
    band:{w:880,h:56,corner:10,rim:1.5,text:[16,27],margin:[8,8]},
    plaque:{h:40,pad:20,corner:8,rim:1.5,text:[14,22],margin:[6,6]}});
function stageSkinBacklog(document) {
    const declared=document?.backlog, layout=declared?.layout || 'list', defaults=STAGE_BACKLOG_DEFAULTS[layout];
    const p=document?.textbox?.paint, box=p ? {bg:p.bg,fg:p.fg,border:p.border || p.fg} : null;
    const own=declared?.metrics, metrics={...STAGE_BACKLOG_METRICS,...(own || {})};
    const roles={}, style={};
    for (const [role,fallback] of Object.entries(defaults.roles)) roles[role]={look:fallback,...declared?.roles?.[role]};
    for (const [role,look] of Object.entries(roles)) {
        if (!STAGE_BACKLOG_OPACITY[look.look] || !box) continue;
        // A band reads as the box's negative unless painted; a notice band without paint takes the narration band's.
        const borrowed=role === 'notice' && look.look === 'band' && !look.paint && roles.narration.look === 'band' ? roles.narration : null;
        const paint=(borrowed || look).paint || (look.look === 'band' ? {bg:box.fg,fg:box.bg,border:box.fg} : box);
        look.paint={border:paint.fg,...paint};
        look.alpha=(borrowed || look).opacity ?? STAGE_BACKLOG_OPACITY[look.look];
        look.corner=(borrowed || look).corner || 'round';
        style['--bl-'+role+'-fg']=look.paint.fg;
        style['--bl-'+role+'-bg']='rgb('+[1,3,5].map(i => parseInt(look.paint.bg.slice(i,i+2),16)).join(' ')+' / '+look.alpha+')';
        if (look.name) style['--bl-'+role+'-name']=look.name;
        // Bubbles carry their side (and their speaker's colour with tint): the row draws them (stageSkinBacklogPlate).
        if (look.look === 'bubble') continue;
        look.plate=stageSkinBacklogPlateStyle(stageSkinBacklogPlate(look,metrics[look.look],'',look.paint.line));
    }
    const m=metrics.bubble, b=metrics.band, q=metrics.plaque;
    // The measures as unitless design px; theme.css multiplies them by --bl-u (the design px's size on this stage).
    Object.assign(style,Object.fromEntries(Object.entries({'bw':m.w,'bh':m.h,'binset':m.inset || 0,'btail':m.tail ? m.tail[2] : 0,'bname-x':m.name[0],'bname-y':m.name[1],'bname-font':m.name[2],
        'btext-l':m.text[0],'btext-r':m.text[1],'btext-y':m.text[2],'bfont':m.text[3],'bpitch':m.text[4],'bm-t':m.margin?.[0] || 0,'bm-b':m.margin?.[1] || 0,
        'nw':b.w,'nh':b.h,'nfont':b.text[0],'npitch':b.text[1],'nm-t':b.margin?.[0] || 0,'nm-b':b.margin?.[1] || 0,
        'qh':q.h,'qpad':q.pad || 0,'qfont':q.text[0],'qpitch':q.text[1],'qm-t':q.margin?.[0] || 0,'qm-b':q.margin?.[1] || 0,
        ...(metrics.close ? {'cx':metrics.close.x,'cy':metrics.close.y,'csize':metrics.close.size} : {})}).map(([key,value]) => ['--blm-'+key,String(value)])));
    const close=declared?.close?.paint || (box && {bg:box.bg,fg:box.border,border:box.border});
    if (close) style['--bl-close']=stageSkinBacklogClose(close);
    if (declared?.dim !== undefined) style['--bl-dim']='color-mix(in srgb, var(--fork-stage-veil-ink) '+Math.round(declared.dim * 1000) / 10+'%, transparent)';
    // anchor end (§18 N9): the list as tall as its rows, standing on the sheet's bottom (the latest line by the box)
    // voice: whether a spoken row shows its replay control (art.voice.backlog false: the original's log has none; R replays).
    return {layout,close:declared?.close?.place || defaults.close,metrics:own ? (document.art?.screenWidth ? 'art' : '') : '',roles,style,bubble:m,anchor:declared?.anchor || '',
        badge:stageSkinBacklogBadge(declared?.badge),voice:document?.art?.voice?.backlog !== false};
}
// A mod-declared line kind's badge: the skin's look, place and paint (as --bl-badge-*), else a
// pill after the name in the panel's muted ink (theme.css .fork-gal-backlog-badge).
function stageSkinBacklogBadge(declared) {
    const paint=declared?.paint;
    return {look:declared?.look || 'pill',place:declared?.place || 'name',...(declared?.show === false ? {show:false} : {}),...(declared?.icon === 'bold' ? {icon:'bold'} : {}),
        style:paint ? Object.fromEntries([['fg',paint.fg],['bg',paint.bg],['border',paint.border]].filter(([,value]) => value).map(([key,value]) => ['--bl-badge-'+key,value])) : undefined};
}
// A look's outline as a clockwise polygon (screen y down) in design px: the w x h rect with its corners and, for a bubble on
// `side`, the tail out of that side.
function stageSkinBacklogOutline(look, m, side) {
    const w=m.w, h=m.h, k=look.corner === 'square' ? 0 : Math.min(m.corner || 0,w / 2,h / 2), points=[];
    const corner=(cx,cy,from) => {
        if (!k) return points.push([cx,cy]);
        if (look.corner === 'chamfer') return points.push(...stageSkinChamfer(cx,cy,k,from));
        // round: the quarter arc in 6 steps, centred k in from the corner
        const ox=cx + (cx ? -k : k), oy=cy + (cy ? -k : k);
        for (let i=0;i<=6;i++) {const a=(from + i / 6) * Math.PI / 2; points.push([ox + k * Math.cos(a),oy + k * Math.sin(a)]);}
    };
    const t=m.tail;
    corner(0,0,2);
    corner(w,0,3);
    if (t && side === 'right') points.push([w,t[0]],[w + t[2],t[3]],[w,t[1]]);
    corner(w,h,0);
    corner(0,h,1);
    if (t && side === 'left') points.push([0,t[1]],[-t[2],t[3]],[0,t[0]]);
    return points;
}
// A chamfer's two points at a corner, in the clockwise order of the arc that starts at quarter `from` (2: top-left, 3: top-right,
// 0: bottom-right, 1: bottom-left).
function stageSkinChamfer(cx, cy, k, from) {
    return {2:[[0,k],[k,0]],3:[[cx - k,0],[cx,k]],0:[[cx,cy - k],[cx - k,cy]],1:[[k,cy],[0,cy - k]]}[from];
}
// The polygon moved d inward (each edge along its inward normal, neighbours intersected), so rings keep one width everywhere.
function stageSkinInset(points, d) {
    const n=points.length, unit=([x,y]) => {const l=Math.hypot(x,y) || 1; return [x / l,y / l];};
    return points.map((at,i) => {
        const prev=points[(i + n - 1) % n], next=points[(i + 1) % n];
        const d1=unit([at[0] - prev[0],at[1] - prev[1]]), d2=unit([next[0] - at[0],next[1] - at[1]]);
        const n1=[-d1[1],d1[0]], n2=[-d2[1],d2[0]], a=[prev[0] + n1[0] * d,prev[1] + n1[1] * d], b=[at[0] + n2[0] * d,at[1] + n2[1] * d];
        const cross=d1[0] * d2[1] - d1[1] * d2[0];
        if (Math.abs(cross) < 1e-6) return [at[0] + n1[0] * d,at[1] + n1[1] * d];
        const s=((b[0] - a[0]) * d2[1] - (b[1] - a[1]) * d2[0]) / cross;
        return [a[0] + d1[0] * s,a[1] + d1[1] * s];
    });
}
// One plate: {rest, hi (the current / hovered entry's lift: the fill that, laid over rest, makes it 0.1 fuller), slice [t, r, b, l],
// outset [t, r, b, l]} in design px.
// line: the outer line's colour (a bubble's speaker colour with tint), drawn `m.line` wide when there is one.
function stageSkinBacklogPlate(look, m, side, line) {
    const outer=stageSkinBacklogOutline(look,m,side), lw=line ? m.line || 0 : 0, rim=m.rim || 0;
    const mid=lw ? stageSkinInset(outer,lw) : outer, inner=rim ? stageSkinInset(mid,rim) : mid;
    const xs=outer.map(p => p[0]), ys=outer.map(p => p[1]);
    const x0=Math.floor(Math.min(0,...xs)) - 1, y0=Math.floor(Math.min(0,...ys)) - 1, x1=Math.ceil(Math.max(m.w,...xs)) + 1, y1=Math.ceil(Math.max(m.h,...ys)) + 1;
    const path=points => 'M' + points.map(([x,y]) => (Math.round((x - x0) * 100) / 100) + ' ' + (Math.round((y - y0) * 100) / 100)).join('L') + 'Z';
    const svg=(alpha, edges = true) => 'url("data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${x1 - x0}" height="${y1 - y0}" viewBox="0 0 ${x1 - x0} ${y1 - y0}">` +
        (edges && lw ? `<path fill-rule="evenodd" fill="${line}" d="${path(outer)}${path(mid)}"/>` : '') + (edges && rim ? `<path fill-rule="evenodd" fill="${look.paint.border}" d="${path(mid)}${path(inner)}"/>` : '') +
        `<path fill="${look.paint.bg}" fill-opacity="${alpha}" d="${path(inner)}"/></svg>`) + '")';
    const rest=look.alpha, hi=Math.min(1,rest + .1);
    // The slices hold the corners and the tail whole; the edges between them carry only the rim and stretch.
    const edge=Math.ceil((look.corner === 'square' ? 0 : m.corner || 0) + lw + rim) + 2, tail=m.tail && side ? Math.ceil(Math.max(m.tail[1],m.tail[3]) + lw + rim) + 2 : 0;
    const outset=[-y0,x1 - m.w,y1 - m.h,-x0];
    return {rest:svg(rest),hi:svg(rest < 1 ? Math.round((hi - rest) / (1 - rest) * 1000) / 1000 : 0,false),slice:[Math.max(edge,tail) + outset[0],edge + outset[1],edge + outset[2],edge + outset[3]],outset};
}
function stageSkinBacklogPlateStyle(plate, prefix = '--bl-') {
    return {[prefix + 'plate']:plate.rest,[prefix + 'plate-hi']:plate.hi,[prefix + 'slice']:plate.slice.join(' '),
        ...Object.fromEntries(['t','r','b','l'].flatMap((side,i) => [[prefix + 's' + side,String(plate.slice[i])],[prefix + 'o' + side,String(plate.outset[i])]]))};
}
// The corner close (「左下只有一个 ×」): a rounded frame in border, a lighter inner line, the bg face and
// the × in fg with round ends - one SVG, drawn at the close's size.
function stageSkinBacklogClose(paint) {
    const body=`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect x="0" y="0" width="80" height="80" rx="13" fill="${paint.border || paint.fg}"/>` +
        `<rect x="7" y="7" width="66" height="66" rx="7" fill="${paint.bg}" stroke="${paint.bg}" stroke-opacity=".55" stroke-width="3"/>` +
        `<path d="M24 24L56 56M56 24L24 56" stroke="${paint.fg}" stroke-width="8" stroke-linecap="round"/></svg>`;
    return 'url("data:image/svg+xml,' + encodeURIComponent(body) + '")';
}

return {STAGE_BACKLOG_DEFAULTS,STAGE_BACKLOG_OPACITY,STAGE_BACKLOG_METRICS,stageSkinBacklog,stageSkinBacklogBadge,stageSkinBacklogOutline,stageSkinChamfer,stageSkinInset,stageSkinBacklogPlate,stageSkinBacklogPlateStyle,stageSkinBacklogClose};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageSkinBacklog};
