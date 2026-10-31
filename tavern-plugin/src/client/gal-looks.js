// Shared look math also serves asset-library previews while the stage plugin is disabled.
// @include-protocol stage-light.cjs
// @include-shared stage-look-math.cjs
const stageLookMath=createStageLookMath({matrix:galMatrix,clamp:galClamp01,lighting:stageLighting,layer:stageLookLayer});
const {GAL_LOOK_ID, GAL_LOOK_MS, GAL_LEAK_FROM, GAL_MOTE_KINDS, GAL_LUMA, galLookNumber, galLookRgb, galLookHex, galLookVec, galLookMixer, galLookObject, galLookNormalize, GAL_LOOK_NEUTRAL, GAL_LOOK_LINEAR, galLookExtras, galLookMix, galLookMatrix, galLookPlan, galGradeUniforms, galLookRegistry, GAL_LOOKS_EMPTY, galLookResolveAssets, galLookResolve, galLookComposeMatrix, galLookCompose, galTimeGrade, galLayerCorrection, galFitAffine, galLookUi}=stageLookMath;

// DOM side of the UI follow: writes the frame from galLookUi onto the stage root (CSS variables, the
// SVG colour matrix the text box / choices / backlog filter through) only when it changes. The paint-only overlay
// variables (vignette, haze, grain; read only by .fork-gal-frame .look/.grain) go on that frame instead: a pulsing
// vignette rewrites them every frame, and on the root each write restyled the whole stage.
const GAL_UI_FRAME_VARS = new Set(["--look-vig", "--look-vig-color", "--look-haze", "--look-haze-color", "--look-grain"]);
function galUiApplier() {
    let last = {}, paint = { node: null, values: {} };
    const fmt = v => Math.round(v * 1000) / 1000;
    const rgb = c => c.map(v => Math.round(v * 255)).join(" ");
    return function apply(root, frame) {
        if (!root) return;
        const matrix = frame && frame.matrix ? frame.matrix.map(fmt).join(" ") : "";
        if (matrix !== last.matrix) {
            last.matrix = matrix;
            const node = root.querySelector(".fork-gal-look-defs feColorMatrix");
            if (node && matrix) node.setAttribute("values", matrix);
            if (matrix) root.setAttribute("data-look-ui", ""); else root.removeAttribute("data-look-ui");
        }
        const vars = frame ? {
            "--look-shake-x": fmt(frame.shake.x) + "px", "--look-shake-y": fmt(frame.shake.y) + "px",
            "--look-vig": String(fmt(frame.vignette.alpha)), "--look-vig-color": rgb(frame.vignette.color),
            "--look-haze": String(fmt(frame.haze.alpha)), "--look-haze-color": rgb(frame.haze.color), "--look-grain": String(fmt(frame.grain))
        } : { "--look-shake-x": "0px", "--look-shake-y": "0px", "--look-vig": "0", "--look-vig-color": "0 0 0", "--look-haze": "0", "--look-haze-color": "255 255 255", "--look-grain": "0" };
        // Pack skins render no .fork-gal-frame, so nothing reads the paint variables: skip them rather than fall back to
        // the root, where every fade step restyled the whole stage (~2.5x the elements per recalc of classic). A frame
        // that mounts later starts with an empty cache and gets every value on the next scene frame.
        const frameNode = root.querySelector(".fork-gal-frame");
        if (frameNode !== paint.node) paint = { node: frameNode, values: {} };
        Object.keys(vars).forEach(function (name) {
            const cache = GAL_UI_FRAME_VARS.has(name) ? paint.values : last, node = cache === last ? root : frameNode;
            if (!node) return;
            if (cache[name] !== vars[name]) { cache[name] = vars[name]; node.style.setProperty(name, vars[name]); }
        });
        const grain = Boolean(frame && frame.grain > 0.01);
        if (grain !== last.grain) { last.grain = grain; if (grain) root.setAttribute("data-look-grain", ""); else root.removeAttribute("data-look-grain"); }
    };
}
