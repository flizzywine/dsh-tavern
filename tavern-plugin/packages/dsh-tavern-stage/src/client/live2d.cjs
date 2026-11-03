// Live2D portraits for the galgame stage.
// Runtime: pixi.js 6 + pixi-live2d-display (cubism4; it embeds the Live2D Cubism Framework) and the proprietary Cubism
// Core. The app downloads both once the player agrees (cubism-core.cjs); the host serves them from the data directory, never from git.
// Part of the Live2D module (live2d-module.js, after cubism-heap.cjs; the core's pixi loader comes in `host`); the
// stage's figures draw through live2d-figures.cjs, the asset library's previews through live2d-preview.cjs.
// A figure's model and its emotion → expression map come from its asset pack outfit (outfit.live2d).

// Scripts load once per page, in order: Cubism Core → pixi → pixi-live2d-display. The stage scene
// needs pixi alone even without a Cubism Core (backgrounds, static portraits); the Live2D plugin can
// still be added later because it only has to come after the core.
let live2dRuntimeLoad = null;
const LIVE2D_VENDOR = "/api/dsh-tavern/vendor/runtime-assets/live2d/";
function loadLive2dRuntime(coreUrl) {
    // absence is a capability state, not a failed model load.
    coreUrl = coreUrl || forkCubismCore.core;
    if (!coreUrl) return Promise.resolve(null);
    if (live2dRuntimeLoad) return live2dRuntimeLoad;
    const script = forkLoadScript, vendor = LIVE2D_VENDOR;
    live2dRuntimeLoad = (window.Live2DCubismCore ? Promise.resolve() : script(coreUrl))
        .then(() => window.PIXI ? null : loadPixiRuntime())
        .then(() => window.PIXI && window.PIXI.live2d ? null : script(forkCubismCore.display || vendor + "pixi-live2d-display-cubism4.min.js"))
        .then(() => {
            if (!window.PIXI || !window.PIXI.live2d) throw new Error("Live2D 运行库不可用");
            cubismHeapGuard(window.Live2DCubismCore, window.PIXI.live2d);
            const settings = window.PIXI.live2d.ModelSettings.prototype, resolve = settings.resolveURL;
            // Pixi's legacy URL resolver corrupts blob:http:// into blob:http//.
            // Owned bundle dependencies are already absolute; keep their opaque URLs intact.
            if (!resolve.forkBlobURLs) {
                settings.resolveURL = function (url) { return url.startsWith("blob:") ? url : resolve.call(this, url); };
                settings.resolveURL.forkBlobURLs = true;
            }
            return window.PIXI;
        })
        .catch(error => { live2dRuntimeLoad = null; throw error; });
    return live2dRuntimeLoad;
}

function live2dLoadError(error) {
    const detail = String(error?.message || error);
    return "模型加载失败：" + (/^(Network error\.?|Failed to fetch|Load failed)$/i.test(detail) ? "资源读取失败，请重试" : detail);
}

// Placement: x as a fraction of the stage width. The figure canvas of these models is
// 2400×3100 with the head near the top; frame head-to-waist.
function live2dSlots(count) { return count <= 1 ? [0.5] : count === 2 ? [0.33, 0.67] : [0.2, 0.5, 0.8]; }
// flip: horizontal
// scale sign (-1 mirrored, in between while turning). x is always the figure's centre.
function live2dPlace(model, width, height, x, speaking, preview, focus, flip, figureSizing) {
    focus = focus || 1;
    if (flip == null) flip = 1;
    // Canvas size of this model (e.g. 2400×3100 full figure; AI-built busts are squarer).
    const W = model.internalModel.originalWidth || 2400, H = model.internalModel.originalHeight || 3100;
    // avatar previews retain head-fit; only calibrated stage entries use centimeters.
    if (!preview && figureSizing) {
        const physical = resolveFigureSizing({ ...figureSizing, canvas: [W, H], W: width, H: height, stageX: width * x, speaking, focus, flip });
        model.forkFigureSizing = physical;
        if (physical.mode === "physical") {
            model.scale.set(physical.scale * flip, physical.scale);
            model.position.set(physical.x, physical.y);
            return physical;
        }
    }
    const bust = H / W < 1.15;
    let scale;
    // Models may declare where their head sits ("ForkStage": { "HeadTop", "Chin" } in model3.json,
    // fractions of the canvas height). They are then sized so their head matches a full-figure
    // figure's (top at 13% of the stage, 19% tall), whatever the canvas framing.
    const settings = model.internalModel.settings && model.internalModel.settings.json;
    // Sampled head bounds are for visibility, not a new sizing/ground calibration.
    const frame = settings && settings.ForkStage;
    if (!preview && frame && frame.Chin > frame.HeadTop && frame.HeadTop >= 0) {
        scale = Math.min(height * 0.19 / ((frame.Chin - frame.HeadTop) * H), width * 0.6 / W);
        const s = scale * (speaking ? 1.03 : 1) * focus;
        model.scale.set(s * flip, s);
        model.x = width * x - W / 2 * model.scale.x;
        const top = 0.13 + (focus < 1 ? (1 - focus) * 0.3 : -(focus - 1) * 0.1);
        model.y = height * top - H * frame.HeadTop * s;
        return;
    }
    if (bust) {
        // A bust fills the lower part of the stage, its bottom edge hidden behind the text box.
        scale = preview ? Math.min(width / W, height / H) : Math.min(height * 0.8 / H, width * 0.36 / W);
        const s = scale * (speaking ? 1.03 : 1) * focus;
        model.scale.set(s * flip, s);
        model.x = width * x - W / 2 * model.scale.x;
        // A close-up grows downwards from near the top instead of pushing the head off screen.
        const y = preview ? (height - H * s) / 2 : height - H * s + height * 0.04;
        model.y = !preview && focus > 1 ? Math.max(y, height * 0.02) : y;
        return;
    }
    // Full figure: head near the top, body down to the thighs behind the text box; never wider than a slot.
    // Closer figures lift a little so the face fills more; farther ones stand lower.
    scale = preview ? height / (H * 0.484) : Math.min(height / (H * 0.758), width / (W * 1.083));
    const s = scale * (speaking ? 1.03 : 1) * focus;
    model.scale.set(s * flip, s);
    model.x = width * x - W / 2 * model.scale.x;
    const top = preview ? 0.02 : 0.06 + (focus < 1 ? (1 - focus) * 0.3 : -(focus - 1) * 0.1);
    model.y = height * top - H * (preview ? 0.0645 : 0.055) * s;
}
// Head frame from the model's "ForkStage" { HeadTop, Chin } (fractions of the canvas height), the stage's
// sampled head, or a default for full figures / square busts.
function live2dHeadFrame(model) {
    const settings = model.internalModel.settings && model.internalModel.settings.json;
    const frame = settings && settings.ForkStage;
    if (frame && frame.Chin > frame.HeadTop && frame.HeadTop >= 0) return frame;
    if (model.forkStageHeadFrame) return model.forkStageHeadFrame;
    const W = model.internalModel.originalWidth || 2400, H = model.internalModel.originalHeight || 3100;
    return H / W < 1.15 ? { HeadTop: 0.12, Chin: 0.5 } : { HeadTop: 0.085, Chin: 0.235 };
}
// pixi-live2d-display 0.4 keeps Cubism's shader programs in one singleton bound to one WebGL
// context, so a second canvas (a settings preview next to the stage) breaks
// both. Each renderer swaps its own programs in right before it draws.
const live2dShaders = new Map();
function live2dUseContext(gl) {
    const Shader = window.PIXI && window.PIXI.live2d && window.PIXI.live2d.CubismShader_WebGL;
    if (!Shader || !gl) return;
    const shader = Shader.getInstance();
    if (shader.gl === gl) return;
    if (shader.gl) live2dShaders.set(shader.gl, shader._shaderSets);
    shader._shaderSets = live2dShaders.get(gl) || [];
    shader.gl = gl;
}
function live2dDropContext(gl) {
    live2dShaders.delete(gl);
    const Shader = window.PIXI && window.PIXI.live2d && window.PIXI.live2d.CubismShader_WebGL;
    if (Shader && Shader.getInstance().gl === gl) { Shader.getInstance().gl = null; Shader.getInstance()._shaderSets = []; }
}
// Syllable-like flapping for lines without audio: a new target every ~70–130 ms, eased.
function syntheticMouth(entry, now) {
    if (!entry.flap || now >= entry.flap.next) entry.flap = { target: Math.random() < 0.18 ? 0.1 : 0.45 + Math.random() * 0.55, next: now + 70 + Math.random() * 60, value: entry.flap ? entry.flap.value : 0 };
    entry.flap.value += (entry.flap.target - entry.flap.value) * 0.45;
    return entry.flap.value;
}
function live2dExpress(entry, figure) {
    if (!entry || !entry.model || !figure) return;
    let expression = figure.expression !== undefined ? figure.expression : (figure.moods && figure.moods[figure.mood]) || "";
    // a pack emotionMap entry ({expression, motion}) selects by name, never by object identity.
    if (expression && typeof expression === "object") expression = typeof expression.expression === "string" ? expression.expression : "";
    // a tap reaction's expression goes through this same apply path for a
    // moment; it ends early when the figure speaks or its own expression changes (the page turned), then the own returns.
    const tap = entry.tapExpression;
    if (tap) {
        if (tap.base === undefined) tap.base = expression;
        if (performance.now() < tap.until && !figure.speaking && tap.base === expression) expression = tap.name;
        else entry.tapExpression = null;
    }
    if (entry.mood === expression) return;
    entry.mood = expression;
    const manager = entry.model.internalModel.motionManager.expressionManager;
    // Prefer the model's own neutral expression; pixi-live2d-display 0.4 ignores re-selecting the
    // expression that was active before resetExpression(), so clear its memory of it too.
    const neutral = (entry.model.internalModel.settings.expressions || []).some(item => item.Name === "neutral") ? "neutral" : "";
    if (expression || neutral) entry.model.expression(expression || neutral);
    else if (manager) { manager.resetExpression(); manager.currentExpression = manager.defaultExpression; }
}

// Static portrait: name + a default picture + one picture per mood (transparent PNG/WebP recommended).
