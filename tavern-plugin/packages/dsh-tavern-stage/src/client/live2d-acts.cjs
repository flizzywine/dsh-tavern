// Live2D staged actions (scene-math.cjs moves); the stage bundle includes this source (live2d-figures.cjs passes the
// scene's moves), Node tests require it.
function live2dActMoves() {
    return require("./scene-math.cjs").createStageSceneMath({ colorMath: require("../../../../shared/color-math.cjs") });
}
// Staged actions without a matching motion group: head params and transform offsets over time.
// Nod/Shake play the model's own motion group when it has one (some models name theirs
// motion_000…, so they always use these).
const LIVE2D_ACTS = { nod: 700, shake: 850, jump: 740, tremble: 1000, turn: 1400, bow: 1300, lean: 1400, "step-back": 1300 };
function live2dStartAct(entry, name, now) {
    if (!LIVE2D_ACTS[name]) return;
    const groups = entry.model.internalModel.settings.motions || {};
    const own = (name === "nod" || name === "shake") && Object.keys(groups).find(group => group.toLowerCase() === name);
    if (own) { entry.model.motion(own, 0, 3); return; }
    entry.act = { name, start: now, duration: LIVE2D_ACTS[name] };
}
function live2dActFrame(entry, now, reduced, moves) {
    const {galHopAt, galShiverAt, galBodyActAt} = moves || live2dActMoves();
    const frame = { dx: 0, dy: 0, px: 0, flip: 1, angleX: 0, angleY: 0, zoom: 1, scaleX: 1, scaleY: 1 };
    const act = entry.act;
    if (!act) return frame;
    const t = (now - act.start) / act.duration;
    if (t >= 1 || t < 0) { entry.act = null; return frame; }
    // Nod: one deep dip and a small second one.
    if (act.name === "nod") { frame.angleY = t < 0.6 ? -18 * Math.sin(Math.PI * t / 0.6) : -8 * Math.sin(Math.PI * (t - 0.6) / 0.4); frame.dy = 0.008 * Math.sin(Math.PI * t); }
    else if (act.name === "shake") frame.angleX = 10 * Math.sin(Math.PI * 4 * t) * Math.pow(Math.sin(Math.PI * t), 2);
    else if (act.name === "jump") { Object.assign(frame, galHopAt(t, reduced)); frame.hop = true; }
    else if (act.name === "tremble") frame.px = galShiverAt(t);
    else if (act.name === "turn") frame.flip = t < 0.2 ? Math.cos(Math.PI * t / 0.2) : t < 0.8 ? -1 : -Math.cos(Math.PI * (t - 0.8) / 0.2);
    // Bow / lean / step-back: body moves shared with static portraits (scene-math.cjs galBodyActAt).
    else { const body = galBodyActAt(act.name, t); frame.dy = body.dy; frame.zoom = body.zoom; frame.angleY = body.angleY; }
    return frame;
}

// Scale the whole model around its bottom center, not its top-left origin.
function live2dApplyHop(model, act) {
    const im = model.internalModel;
    const width = (im.originalWidth || 2400) * model.scale.x;
    const height = (im.originalHeight || 3100) * model.scale.y;
    model.x += width * (1 - act.scaleX) / 2;
    model.y += height * (1 - act.scaleY) + Math.abs(height) * act.dy;
    model.scale.set(model.scale.x * act.scaleX, model.scale.y * act.scaleY);
}
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { live2dActMoves, LIVE2D_ACTS, live2dStartAct, live2dActFrame, live2dApplyHop };
