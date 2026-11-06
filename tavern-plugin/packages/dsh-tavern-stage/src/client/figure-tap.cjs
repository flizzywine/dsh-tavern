function createStageFigureTap({document,geometry}) {
let disposed=false,masks=new WeakMap();
const {galStaticBody,galStaticCenterU}=geometry;
// ---- deliberate tap (mobile mis-taps): one primary pointer, primary button, no second finger, no
// pointercancel (the browser took it for a scroll / pan), at most `slopPx` CSS px from the press at any time (no drag,
// swipe) and released within `maxMs` (no long press). Mouse, pen and touch share the rule; the click that follows the
// release is the one judged. Pure: the scene feeds it the stage's pointer events (capture phase, never consumed).
const GAL_TAP_RULE = Object.freeze({ slopPx: 8, maxMs: 300, clickMs: 800 });
function galTapTracker() { return { down: null, pointers: new Set() }; }
function galTapPointer(tracker, event) {
    const id = event.pointerId, down = tracker.down, own = down && down.id === id;
    const moved = own ? Math.hypot(event.clientX - down.x, event.clientY - down.y) : 0;
    if (event.type === "pointerdown") {
        if (tracker.pointers.size || !event.isPrimary) { if (down) down.multi = true; tracker.pointers.add(id); return; }
        tracker.pointers.add(id);
        tracker.down = { id, type: event.pointerType || "mouse", button: event.button, x: event.clientX, y: event.clientY, at: event.timeStamp, moved: 0, multi: false, cancelled: false, upAt: 0 };
        return;
    }
    if (event.type === "pointerup" || event.type === "pointercancel") tracker.pointers.delete(id);
    if (!own) return;
    down.moved = Math.max(down.moved, moved);
    if (event.type === "pointerup") down.upAt = event.timeStamp;
    else if (event.type === "pointercancel") down.cancelled = true;
}
// The click judged once: true only for a deliberate tap that just ended.
function galTapDeliberate(tracker, click) {
    const down = tracker.down;
    tracker.down = null;
    if (!down || click.button !== 0 || down.button !== 0 || down.multi || down.cancelled || !down.upAt) return false;
    return down.moved <= GAL_TAP_RULE.slopPx && down.upAt - down.at <= GAL_TAP_RULE.maxMs && click.timeStamp - down.upAt <= GAL_TAP_RULE.clickMs;
}

// Arming (the common mis-tap is a page turn that lands on a figure). A deliberate tap on a figure is a
// page turn, unless it is the second tap of a double tap on that figure (≤ doubleMs after the first, ≤ doublePx away)
// or the figure is armed: then it reacts, does not turn the page and (re)arms the figure for armedMs. The first tap of
// a double tap has already turned the page; no page turn ever waits for a possible second tap. `key` is the figure the
// tap hit (null: none; undefined: not tested — the scene resolves a first tap's figure after the page turn).
const GAL_TAP_ARM = Object.freeze({ doubleMs: 350, doublePx: 24, armedMs: 5000 });
function galTapArmState() { return { first: null, until: {} }; }
function galTapArmed(arm, key, at) { return (arm.until[key] || 0) > at; }
// Whether this tap needs a hit test now: some figure is armed, or it may finish a double tap.
function galTapNeedsHit(arm, x, y, at) {
    const first = arm.first;
    return Object.values(arm.until).some(until => until > at) || Boolean(first && at - first.at <= GAL_TAP_ARM.doubleMs && Math.hypot(x - first.x, y - first.y) <= GAL_TAP_ARM.doublePx);
}
function galTapArm(arm, key, x, y, at) {
    const first = arm.first, near = first && at - first.at <= GAL_TAP_ARM.doubleMs && Math.hypot(x - first.x, y - first.y) <= GAL_TAP_ARM.doublePx;
    arm.first = null;
    for (const name in arm.until) if (arm.until[name] <= at) delete arm.until[name];
    if (key) {
        const armed = galTapArmed(arm, key, at);
        if (armed || near && first.key === key) { arm.until[key] = at + GAL_TAP_ARM.armedMs; return { claim: true, armed: !armed }; }
    }
    arm.first = { x, y, at, key };
    return { claim: false, armed: false };
}// A tap counts only on the bare scene: the Pixi canvas itself or a passive node of the scene host; never a control, the
// text box, choices, chips, the phone or any other stage UI above it (those clicks keep their own meaning).
const GAL_TAP_UI = "button, a, input, textarea, select, label, summary, [role], [tabindex], [contenteditable], .fork-gal-box";
function galTapBareTarget(target, canvas, host) {
    if (!target || target === canvas) return Boolean(target);
    if (!host || typeof host.contains !== "function" || !host.contains(target)) return false;
    for (let node = target; node && node !== host; node = node.parentElement) if (node.matches && node.matches(GAL_TAP_UI)) return false;
    return true;
}
// Live2D fallback gesture when the figure's emotionMap has none: the model's own Tap motion group (Cubism sample
// convention TapHead / TapBody / Tap, any case or separator), matched to the tapped region.
function galTapMotionGroup(motions, region) {
    const groups = Object.keys(motions || {}).filter(name => Array.isArray(motions[name]) && motions[name].length);
    const find = pattern => groups.find(name => pattern.test(name.replace(/[\s_-]/g, "")));
    return find(region === "head" ? /^taphead$/i : /^tapbody$/i) || find(/^tap$/i) || null;
}
// ---- tap feedback (purely visual: never sends, never calls a model, never changes story state, never plays a voice)
const GAL_TAP_BAGS = { head: ["happy", "shy", "happy-note"], body: ["surprised", "question", "sweat"] };
// shy has no mark: the shy emotion blushes with the model's own cheek.
const GAL_TAP_EMOTES = { happy: "heart", "happy-note": "note", surprised: "!", question: "?", sweat: "sweat", annoyed: "anger" };
// The emotion each reaction asks the figure's own emotion list for (resolved by matchBubbleMood, packFigureReactions).
const GAL_TAP_EMOTION = { happy: "joy", shy: "shy", "happy-note": "joy", surprised: "anxious", question: "anxious", sweat: "shy", annoyed: "anger" };
function galTapState() { return { bags: {}, serial: 0 }; }
// Shuffle bag per figure and region; a 3.5 s cooldown per figure between full reactions (taps inside it only squash);
// ≥4 taps on one figure within 5 s escalate to "annoyed" once, then not again for 6 s.
function galTapPlan(tap, entry, region, now, random = Math.random) {
    const cooldown = 3500, key = entry.key + ":" + region;
    entry.tapTimes = (entry.tapTimes || []).filter(at => now - at < 5000);
    entry.tapTimes.push(now);
    const escalate = entry.tapTimes.length >= 4 && !(entry.tapAnnoyedAt > now - 6000);
    if (escalate) { entry.tapAnnoyedAt = now; entry.tapLast = now; return { kind: "annoyed", full: true }; }
    if (now - (entry.tapLast ?? -Infinity) < cooldown) return { kind: region === "head" ? "pat" : "poke", full: false };
    let bag = tap.bags[key];
    if (!bag || !bag.length) {
        bag = GAL_TAP_BAGS[region].slice();
        for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
        tap.bags[key] = bag;
    }
    entry.tapLast = now;
    return { kind: bag.pop(), full: true };
}
// Damped squash-and-stretch about the feet (volume-preserving), a small shake when annoyed, and the head flinch.
// Reduced motion: none of it (the emote and the 差分 still show).
function galTapFrame(reaction, now, reduced) {
    const frame = { scaleX: 1, scaleY: 1, dx: 0, tilt: 0, flinch: 0 };
    if (!reaction || reduced) return frame;
    const t = (now - reaction.start) / 1000;
    if (t < 0 || t > 1.2) return frame;
    const pat = reaction.region === "head";
    const amp = reaction.kind === "annoyed" ? 0.03 : pat ? 0.022 : 0.032;
    const wave = Math.exp(-5.5 * t) * Math.cos(2 * Math.PI * 2.8 * t);
    frame.scaleY = 1 - amp * wave;
    frame.scaleX = 1 + amp * 0.55 * wave;
    if (reaction.kind === "annoyed") frame.dx = 0.006 * Math.sin(2 * Math.PI * 7 * t) * Math.exp(-3.5 * t);
    frame.flinch = Math.exp(-4 * t) * Math.sin(Math.PI * Math.min(1, t / 0.12));
    frame.tilt = (reaction.side || 1) * frame.flinch;
    return frame;
}
// Alpha mask of a static texture, 1/4 resolution, built on the first tap only.
function galTapAlpha(texture) {
    if(disposed)return null;
    if(masks.has(texture))return masks.get(texture);
    let mask=null;
    try {
        const source = texture.baseTexture.resource && texture.baseTexture.resource.source, frame = texture.frame;
        if (!source) return null;
        const w = Math.max(1, Math.round(frame.width / 4)), h = Math.max(1, Math.round(frame.height / 4));
        const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(source, frame.x, frame.y, frame.width, frame.height, 0, 0, w, h);
        mask = { w, h, data: ctx.getImageData(0, 0, w, h).data };
    } catch (_) {}
    masks.set(texture,mask);return mask;
}
// Static (flat or layered) sprite, or a Spine body (sprite-like container): the point's texture-normalized u/v.
function galTapUv(sprite, point) {
    if (!sprite || sprite.destroyed || !sprite.worldVisible || !sprite.texture || !sprite.texture.width || !sprite.texture.height) return null;
    const local = sprite.toLocal(point), tex = sprite.texture;
    const u = local.x / tex.width + sprite.anchor.x, v = local.y / tex.height + sprite.anchor.y;
    return u < 0 || u > 1 || v < 0 || v > 1 ? null : { u, v };
}
function galTapRegion(sprite, uv) {
    return { region: uv.v < galStaticBody(sprite)[1] ? "head" : "body", side: uv.u < galStaticCenterU(sprite) ? -1 : 1 };
}
// Only the visible body counts: the pixel must be solid (not a soft edge, shadow or glow) and so must
// its four neighbours in the 1/4 mask (±4 texels), so a tap grazing hair wisps or a transparent margin is a page turn.
function galTapHitStatic(sprite, point) {
    const uv = sprite && sprite.texture && sprite.texture.orig ? galTapUv(sprite, point) : null;
    if (!uv) return null;
    const mask = galTapAlpha(sprite.texture);
    if (mask) {
        const x = Math.min(mask.w - 1, Math.floor(uv.u * mask.w)), y = Math.min(mask.h - 1, Math.floor(uv.v * mask.h));
        const alpha = (dx, dy) => { const px = x + dx, py = y + dy; return px < 0 || py < 0 || px >= mask.w || py >= mask.h ? 0 : mask.data[(py * mask.w + px) * 4 + 3]; };
        if (alpha(0, 0) < 128 || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => alpha(dx, dy) < 40)) return null;
    }
    return galTapRegion(sprite, uv);
}
// The largest alpha of a 3×3 px render of `target` under the point (stage coordinates; the target has a parent).
function galTapProbe(target, point, renderer, PIXI) {
    const texture = renderer.generateTexture(target, { region: new PIXI.Rectangle(Math.floor(point.x) - 1, Math.floor(point.y) - 1, 3, 3), resolution: 1 });
    try {
        const pixels = renderer.plugins.extract.pixels(texture);
        let alpha = 0;
        for (let i = 3; i < pixels.length; i += 4) alpha = Math.max(alpha, pixels[i]);
        return alpha;
    } finally { texture.destroy(true); }
}
// Spine: the rendered skeleton under the point.
function galTapHitSpine(body, spine, point, renderer, PIXI) {
    const uv = galTapUv(body, point);
    if (!uv || !spine || spine.destroyed) return null;
    return galTapProbe(spine, point, renderer, PIXI) < 96 ? null : galTapRegion(body, uv);
}
// Live2D, for any model without per-figure data: a visible art-mesh triangle must contain the point, then the rendered
// model must be solid there (meshes carry transparent texels; model3 HitAreas are bounding boxes, so they only name the
// region: a head/face area → head). Otherwise head = above the head frame's chin (0.3 of the canvas).
function galTapHitLive2d(model, point, headFrame, renderer, PIXI) {
    if (!model || model.destroyed || !model.worldVisible) return null;
    const im = model.internalModel, p = model.toModelPosition(point);
    if (p.x < 0 || p.y < 0 || p.x > im.originalWidth || p.y > im.originalHeight) return null;
    const core = im.coreModel, count = core.getDrawableCount();
    let mesh = false;
    for (let i = count - 1; i >= 0 && !mesh; i--) {
        if (core.getDrawableOpacity(i) < 0.1 || (core.getDrawableDynamicFlagIsVisible && !core.getDrawableDynamicFlagIsVisible(i))) continue;
        const v = im.getDrawableVertices(i), idx = core.getDrawableVertexIndices(i);
        for (let j = 0; j + 2 < idx.length; j += 3) {
            const a = idx[j] * 2, b = idx[j + 1] * 2, c = idx[j + 2] * 2;
            const d1 = (p.x - v[b]) * (v[a + 1] - v[b + 1]) - (v[a] - v[b]) * (p.y - v[b + 1]);
            const d2 = (p.x - v[c]) * (v[b + 1] - v[c + 1]) - (v[b] - v[c]) * (p.y - v[c + 1]);
            const d3 = (p.x - v[a]) * (v[c + 1] - v[a + 1]) - (v[c] - v[a]) * (p.y - v[a + 1]);
            if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) { mesh = true; break; }
        }
    }
    if (!mesh || (renderer && galTapProbe(model, point, renderer, PIXI) < 96)) return null;
    const side = p.x < im.originalWidth / 2 ? -1 : 1, areas = Object.keys(im.hitAreas || {}).length ? im.hitTest(p.x, p.y) : [];
    const region = areas.some(name => /head|face/i.test(name)) || p.y / im.originalHeight < (headFrame ? headFrame.Chin : 0.3) ? "head" : "body";
    return { region, side };
}
function dispose(){disposed=true;masks=new WeakMap();}

return {GAL_TAP_RULE, galTapTracker, galTapPointer, galTapDeliberate, GAL_TAP_ARM, galTapArmState, galTapArmed, galTapNeedsHit, galTapArm, GAL_TAP_UI, galTapBareTarget, galTapMotionGroup, GAL_TAP_BAGS, GAL_TAP_EMOTES, GAL_TAP_EMOTION, galTapState, galTapPlan, galTapFrame, galTapAlpha, galTapUv, galTapRegion, galTapHitStatic, galTapProbe, galTapHitSpine, galTapHitLive2d, dispose};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageFigureTap};
