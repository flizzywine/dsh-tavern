// Shared effect definitions and flash gate serve every stage presentation.
// @include stage-effects.cjs

// Camera shots (persistent). The world point (fx, fy) (fractions of the stage) sits at the screen point
// (ax, ay); zoom and rotation turn around it. head: { x, y } of the close-up target, fractions.
const GAL_SHOTS = {
    "": { zoom: 1, ms: 900, ease: "inOutCubic" },
    push: { zoom: 1.12, ms: 8000, ease: "inOutSine" },
    close: { zoom: 1.35, ms: 700, ease: "inOutCubic" },
    "pan-left": { zoom: 1.1, panX: -0.06, ms: 4000, ease: "inOutSine" },
    "pan-right": { zoom: 1.1, panX: 0.06, ms: 4000, ease: "inOutSine" },
    dutch: { zoom: 1.08, rotation: 3.5 * Math.PI / 180, ms: 1000, ease: "inOutCubic" }
};
function galShotTarget(shot, head) {
    let spec = GAL_SHOTS[shot] || GAL_SHOTS[""];
    if (shot === "close" && !head) spec = GAL_SHOTS[""];
    const target = { zoom: spec.zoom, fx: 0.5 + (spec.panX || 0), fy: 0.42, ax: 0.5, ay: 0.42, rotation: spec.rotation || 0 };
    if (shot === "close" && head) {
        target.fx = head.x; target.fy = head.y; target.ax = 0.5;
        target.zoom = head.zoom ?? spec.zoom; target.ay = head.ay ?? 0.36;
    }
    return { target, ms: spec.ms, ease: spec.ease };
}
// Keeps the camera inside the backdrop (which overscans the stage by margin on each side): zooms in just
// enough for rotations, then slides the focus so no corner of the screen shows past the picture.
function galCameraClamp(cam, W, H, margin) {
    const m = margin == null ? 0.018 : margin;
    const cos = Math.cos(cam.rotation || 0), sin = Math.sin(cam.rotation || 0);
    let zoom = Math.max(0.2, cam.zoom || 1);
    const corners = z => [[0, 0], [W, 0], [0, H], [W, H]].map(function ([sx, sy]) {
        const dx = (sx - cam.ax * W) / z, dy = (sy - cam.ay * H) / z;
        return [dx * cos + dy * sin, -dx * sin + dy * cos];
    });
    const span = list => [Math.min(...list), Math.max(...list)];
    let c = corners(zoom);
    let [x0, x1] = span(c.map(p => p[0])), [y0, y1] = span(c.map(p => p[1]));
    const need = Math.max(1, (x1 - x0) / (W * (1 + 2 * m)), (y1 - y0) / (H * (1 + 2 * m)));
    if (need > 1) { zoom *= need * 1.0001; c = corners(zoom); [x0, x1] = span(c.map(p => p[0])); [y0, y1] = span(c.map(p => p[1])); }
    let fx = cam.fx * W, fy = cam.fy * H;
    if (fx + x0 < -m * W) fx = -m * W - x0; else if (fx + x1 > (1 + m) * W) fx = (1 + m) * W - x1;
    if (fy + y0 < -m * H) fy = -m * H - y0; else if (fy + y1 > (1 + m) * H) fy = (1 + m) * H - y1;
    return Object.assign({}, cam, { zoom, fx: fx / W, fy: fy / H });
}

// @include gal-looks.js
