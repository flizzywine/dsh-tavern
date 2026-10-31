function createStageSkinMotion() {
// frames (skinFrames) on an image of w x h image px: the cell size, the sheet's background size, one cycle's time, the
// iteration count and the rest frame's position (the first when looping, the last when played once).
function stageSkinFrames(frames, [w,h]) {
    const n=frames.count || frames.columns * frames.rows, loop=frames.loop !== false;
    return {cell:[Math.round(w / frames.columns * 1000) / 1000,Math.round(h / frames.rows * 1000) / 1000],size:`${frames.columns * 100}% ${frames.rows * 100}%`,
        ms:Math.round(n / frames.fps * 1000) + 'ms',loop:loop ? 'infinite' : '1',rest:stageSkinFramePosition(frames,loop ? 0 : n - 1)};
}
function stageSkinFramePosition({columns,rows}, i) {return `${columns > 1 ? (i % columns) * 100 / (columns - 1) : 0}% ${rows > 1 ? Math.floor(i / columns) * 100 / (rows - 1) : 0}%`;}
// The slots that play frames (skinFrames), keyed by their keyframes' name (fork-skin-frames-<key>, stageSkinMotionKeyframes).
const STAGE_SKIN_FRAME_SLOTS = Object.freeze({next:art => art?.textbox?.next?.frames,lamp:art => art?.textbox?.lamp?.frames});
// transitions as data - per declared surface and phase its
// duration, ease and (choices) stagger as tokens, its wipe / pose as @keyframes fork-skin-tx-<surface>-<phase>
// (stageSkinMotionKeyframes); its slide is the generic fork-skin-tx-slide-* on the choice rows (theme.css) or the panels'
// own Web Animations (stage-skin-ui.js forkSkinPlayParts); the flat sweeping shapes are drawn by ForkSkinSweep (stage-skin-ui.js).
// (bauhaus v2: expo-out / quint-out are the standard easings.net curves; emphasized = Material 3's CSS approximation of its
// emphasized easing, emphasized-out / -in its decelerate / accelerate; spring settles with a 3.0% overshoot)
const STAGE_SKIN_TX_EASE = Object.freeze({linear:'linear',out:'cubic-bezier(.2,.7,.3,1)','in-out':'cubic-bezier(.65,0,.35,1)',back:'cubic-bezier(.34,1.56,.64,1)',snap:'cubic-bezier(.86,0,.07,1)',
    'expo-out':'cubic-bezier(.16,1,.3,1)','quint-out':'cubic-bezier(.22,1,.36,1)',emphasized:'cubic-bezier(.2,0,0,1)','emphasized-out':'cubic-bezier(.05,.7,.1,1)','emphasized-in':'cubic-bezier(.3,0,.8,.15)',spring:'cubic-bezier(.3,1.3,.5,1)'});
// A transition ease as CSS: a named curve, or the skin's own cubic Bezier [x1, y1, x2, y2].
function stageSkinTxEase(ease) {
    return Array.isArray(ease) ? 'cubic-bezier(' + ease.join(',') + ')' : STAGE_SKIN_TX_EASE[ease || 'out'];
}
function stageSkinTransitionList(document) {
    return Object.entries(document?.transitions || {}).flatMap(([surface,phases]) => ['enter','leave'].filter(phase => phases[phase]).map(phase => [surface,phase,phases[phase]]));
}
function stageSkinTransitionTokens(document) {
    const tokens={};
    for (const [surface,phase,t] of stageSkinTransitionList(document)) {
        const p='--tx-' + surface + '-' + phase;
        tokens[p + '-ms']=t.ms + 'ms'; tokens[p + '-ease']=stageSkinTxEase(t.ease);
        if (t.delay) tokens[p + '-delay']=t.delay + 'ms';
        if (surface === 'choices') tokens[p + '-stagger']=(t.stagger || 0) + 'ms';
    }
    // choices.leave holds the pick this long before it is sent (gal-choices.js reads --gal-choice-pick-ms)
    const pick=document?.transitions?.choices?.leave;
    if (pick) tokens['--tx-choices-pick-ms']=String(pick.ms + (pick.delay || 0));
    return tokens;
}
// A wipe's clip path open (the surface whole) or closed (nothing shown), percentages of the surface; the closed shapes grow
// from `at` far enough to cover the surface from any point.
function stageSkinWipeClip(wipe, open) {
    const [x,y]=(wipe.at || [.5,.5]).map(v => Math.round(v * 1000) / 10), r=(n,k) => Math.round((n + k) * 10) / 10 + '%';
    const poly=points => 'polygon(' + points.map(([dx,dy]) => r(x,dx) + ' ' + r(y,dy)).join(',') + ')';
    const k=open ? 1 : 0;
    switch (wipe.shape) {
    case 'circle': return `circle(${open ? 150 : 0}% at ${x}% ${y}%)`;
    case 'rect': return poly([[-100 * k,-100 * k],[100 * k,-100 * k],[100 * k,100 * k],[-100 * k,100 * k]]);
    case 'diamond': return poly([[0,-200 * k],[200 * k,0],[0,200 * k],[-200 * k,0]]);
    case 'triangle': return poly([[0,-420 * k],[370 * k,260 * k],[-370 * k,260 * k]]);
    case 'left': return open ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)';
    case 'right': return open ? 'inset(0 0 0 0)' : 'inset(0 0 0 100%)';
    case 'up': return open ? 'inset(0 0 0 0)' : 'inset(100% 0 0 0)';
    default: return open ? 'inset(0 0 0 0)' : 'inset(0 0 100% 0)';
    }
}
// One transition's keyframes: enter from its values to the surface as drawn (the transform ends on the surface's own value),
// leave from the surface as drawn to them. A slide is not here: it never touches the surface's opacity or its own transform.
function stageSkinTransitionKeyframes(surface, phase, t) {
    const away=[], here=[];
    if (t.pose) {const p=t.pose; away.push(`transform:translate(${p.dx || 0}%,${p.dy || 0}%) rotate(${p.rot || 0}deg) scale(${p.scale ?? 1})`);}
    if (t.wipe) {away.push('clip-path:' + stageSkinWipeClip(t.wipe,false)); here.push('clip-path:' + stageSkinWipeClip(t.wipe,true));}
    if (!away.length) return '';
    const [from,to]=phase === 'enter' ? [away,here] : [here,away];
    return `@keyframes fork-skin-tx-${surface}-${phase}{from{${from.join(';')}}to{${to.join(';')}}}`;
}
// The motion vocabulary's eases (skin-interface.md §18 E3 / E4).
const STAGE_SKIN_EASE = Object.freeze({linear:'linear',out:'cubic-bezier(.2,.7,.3,1)','in-out':'cubic-bezier(.65,0,.35,1)',back:'cubic-bezier(.34,1.56,.64,1)'});
// A pose's scale for CSS scale(): one value, or x, y when it has its own sx / sy.
function stageSkinPoseScale(pose) {
    const s=pose.scale ?? 1;
    return pose.sx == null && pose.sy == null ? String(s) : `${Math.round((pose.sx ?? 1) * s * 1000) / 1000}, ${Math.round((pose.sy ?? 1) * s * 1000) / 1000}`;
}
// textbox.motion.page from rest (§18 E4): the box stays as it is on a page turn's first frame. A
// motion whose first key is a pose (a shove or a glow) reaches it linearly over its first STAGE_SKIN_PAGE_RISE_MS (at most 30%
// of the motion) and plays its keys in the time left. A declared bright is drawn (the engine allows it; the
// fork's own skins leave it out, since a glow on every page reads as flicker).
const STAGE_SKIN_PAGE_RISE_MS = 90;
function stageSkinPageFromRest(motion) {
    const first=motion.keys[0];
    if (!(first.dx || first.dy || first.rot) && [first.scale,first.sx,first.sy,first.bright].every(value => (value ?? 1) === 1)) return motion;
    const rise=Math.min(0.3,STAGE_SKIN_PAGE_RISE_MS / motion.ms);
    return {...motion,keys:[{at:0,ease:'linear'},...motion.keys.map(key => ({...key,at:rise + key.at * (1 - rise)}))]};
}
// textbox.motion.page / nameplate.motion (§18 E4) as numeric @keyframes the stage mounts with the skin (theme.css
// «stage skin: motion» plays them): each key a transform (dx / dy em, rot deg, scale) and, when the motion has any, a brightness. '' = none.
function stageSkinMotionKeyframes(document) {
    const frames=(name,motion,glow=motion.keys.some(key => key.bright != null)) => `@keyframes ${name}{` + motion.keys.map(key => `${Math.round(key.at * 1000) / 10}%{transform:translate(${key.dx || 0}em,${key.dy || 0}em) rotate(${key.rot || 0}deg) scale(${stageSkinPoseScale(key).replace(' ','')});` +
        (glow ? `filter:brightness(${key.bright ?? 1});` : '') + `animation-timing-function:${STAGE_SKIN_EASE[key.ease || motion.ease || 'out']}}`).join('') + '}';
    // frames (skinFrames) per playing slot: its cells as discrete background positions, row-major (the loader sheets' rule);
    // 100% holds the last frame (a sheet played once rests there).
    const cells=Object.entries(STAGE_SKIN_FRAME_SLOTS).map(([key,of]) => {
        const frames=of(document?.art); if (!frames) return '';
        const n=frames.count || frames.columns * frames.rows;
        return `@keyframes fork-skin-frames-${key}{` + Array.from({length:n},(_,i) => `${Math.round(i * 100000 / n) / 1000}%{background-position:${stageSkinFramePosition(frames,i)}}`).join('') + `100%{background-position:${stageSkinFramePosition(frames,n - 1)}}}`;
    }).join('');
    const tx=stageSkinTransitionList(document).map(([surface,phase,t]) => stageSkinTransitionKeyframes(surface,phase,t)).join('');
    // art.portrait.frame.motion (§18 N9): the same poses with dx / dy in % of the frame, twice (a new face flips between them).
    // layer face: the same keyframes move the face square (its % then), and leave is fork-skin-face-out.
    const percent=text => text.replace(/translate\(([-\d.]+)em,([-\d.]+)em\)/g,'translate($1%,$2%)');
    const face=document?.art?.portrait?.frame?.motion, faceFrames=face ? ['a','b'].map(n => percent(frames('fork-skin-face-in-' + n,face))).join('') + (face.leave ? percent(frames('fork-skin-face-out',face.leave)) : '') : '';
    return [document?.textbox?.motion ? frames('fork-skin-box-page',stageSkinPageFromRest(document.textbox.motion.page)) : '',document?.nameplate?.motion ? frames('fork-skin-name-in',document.nameplate.motion) : '',faceFrames,cells,tx].join('');
}
// textFx.poses as the glyph copy's tokens (theme.css «stage typewriter»): per pose its transform, filter, opacity and ink.
function stageSkinGlyphPoses(fx) {
    const tokens={};
    (fx?.poses || []).forEach((pose,i) => {
        const scale=pose.scale ?? 1, p='--gal-hop-' + i;
        tokens[p + '-t']=`translate(${pose.dx || 0}em, ${pose.dy || 0}em) rotate(${pose.rot || 0}deg) scale(${(pose.sx ?? 1) * scale}, ${(pose.sy ?? 1) * scale}) skewX(${pose.skew || 0}deg)`;
        tokens[p + '-f']=pose.blur ? `blur(${pose.blur}em)` : 'none';
        tokens[p + '-c']=pose.ink === 'flash' ? 'var(--gal-skin-flash)' : pose.ink === 'accent' ? 'var(--gal-skin-accent)' : 'var(--gal-skin-fg)';
    });
    return tokens;
}

return {stageSkinFrames,stageSkinFramePosition,STAGE_SKIN_FRAME_SLOTS,STAGE_SKIN_TX_EASE,stageSkinTxEase,stageSkinTransitionList,stageSkinTransitionTokens,stageSkinWipeClip,stageSkinTransitionKeyframes,STAGE_SKIN_EASE,stageSkinPoseScale,STAGE_SKIN_PAGE_RISE_MS,stageSkinPageFromRest,stageSkinMotionKeyframes,stageSkinGlyphPoses};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageSkinMotion};
