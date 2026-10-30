// shared placement for the production widget presentation owner.
function stageWidgetSourcePlace({ width, height, size, figures = [], blocked = [], previous, anchor='center-card' }) {
    const w = size.width, h = size.height, padding = 16;
    const valid = r => r && !r.hidden && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
    const inflate = (r, n) => ({ x: r.x - n, y: r.y - n, width: r.width + n * 2, height: r.height + n * 2 });
    const obstacles = [...blocked.filter(valid).map(r => inflate(r, 12)), ...figures.flatMap(f => [valid(f.body) && inflate(f.body, 18), valid(f.head) && inflate(f.head, 24)]).filter(Boolean)];
    const safe = r => r.x >= padding && r.y >= padding && r.x + w <= width - padding + 1e-7 && r.y + h <= height - padding + 1e-7
        && !obstacles.some(b => r.x < b.x + b.width - 1e-7 && r.x + w > b.x + 1e-7 && r.y < b.y + b.height - 1e-7 && r.y + h > b.y + 1e-7);
    const box = (x, y) => ({ x, y, width: w, height: h });
    if (previous && previous.width === w && previous.height === h && safe(previous)) return box(previous.x, previous.y);
    const cx = (width - w) / 2, cy = (height - h) / 2, xs = new Set([cx, padding, width - w - padding]), ys = new Set([cy, padding, height - h - padding]);
    for (const r of obstacles) { xs.add(r.x - w); xs.add(r.x + r.width); ys.add(r.y - h); ys.add(r.y + r.height); }
    const candidates = [];
    for (const x of xs) for (const y of ys) { const r = box(x, y); if (safe(r)) candidates.push(r); }
    const target=anchor==='corner-left' ? [padding,height-h-padding] : anchor==='corner-right' ? [width-w-padding,height-h-padding] : anchor==='top-center' ? [cx,padding] : [cx,cy];
    candidates.sort((a, b) => ((a.x - target[0]) ** 2 + (a.y - target[1]) ** 2) - ((b.x - target[0]) ** 2 + (b.y - target[1]) ** 2) || a.y-b.y || a.x-b.x);
    return candidates[0] || null;
}
function stageWidgetAvatarSquare(width,height,crop={x:0,y:0,w:1,h:1}) {
    const w=crop.w*width,h=crop.h*height,side=Math.min(w,h);
    return {x:crop.x*width+(w-side)/2,y:crop.y*height+(h-side)*.15,width:side,height:side};
}
// the bounded thumbnail set handed to a source widget. Every listed
// person's face comes first (one per figure, so a long contact list never runs out after eight people); per-message mood
// variants only fill a small extra allowance, and a bubble without its own variant shows the sender's face instead.
// inputs: [[id, encodedUrl|null, kind:'person'|'message']] -> {urls, rows:{id:'a<n>'}} (ids without a thumbnail are absent).
const STAGE_WIDGET_AVATAR_PEOPLE=24,STAGE_WIDGET_AVATAR_VARIANTS=8;
function stageWidgetAvatarBudget(inputs) {
    const urls=[],rows={};
    const take=(kind,limit)=>{let added=0;for (const [id,url,type] of inputs) {
        if (type!==kind || !url) continue;
        let index=urls.indexOf(url);
        if (index<0 && added<limit) {index=urls.push(url)-1;added++;}
        if (index>=0) rows[id]='a'+index;
    }};
    take('person',STAGE_WIDGET_AVATAR_PEOPLE);take('message',STAGE_WIDGET_AVATAR_VARIANTS);
    return {urls,rows};
}
// the device pixels of the faces handed to the phone, from
// the phone's width on the stage (stage units: a docked stage is only scaled down, so this never asks for less than is shown)
// and the screen's pixel ratio. One iOS point of the phone is its width / 393 (style.css --pt, on the stage and on the sheet);
// a person's face is drawn for the largest place it appears, her 200 pt contact-card photo (the call's 132 / 55 pt photo and every list face are smaller); a message's own mood face is at most the 32 px
// bubble / banner face of the 280 px design, zoomed with the phone. Rounded up to 32 px so a small resize redraws nothing.
const PHONE_FACE_PT=200,PHONE_POINTS=393,PHONE_DESIGN_WIDTH=280,PHONE_MESSAGE_FACE=32;
function stageWidgetFacePx(width,dpr) {
    const device=css=>Math.ceil(css*dpr/32)*32;
    return {person:device(PHONE_FACE_PT*width/PHONE_POINTS),message:device(PHONE_MESSAGE_FACE*width/PHONE_DESIGN_WIDTH)};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {stageWidgetSourcePlace,stageWidgetAvatarSquare,stageWidgetAvatarBudget,stageWidgetFacePx};
