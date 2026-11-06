function createStageLookArt({canvasTexture:galCanvasTexture}){
function galLookArt(PIXI, kind) {
    const soft = /^vignette:(\d)$/.exec(kind);
    if (soft) {
        const s = Number(soft[1]) / 4, inner = 0.32 - 0.28 * s;
        return galCanvasTexture(PIXI, 512, 288, function (ctx, w, h) {
            ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(w / h, 1);
            const g = ctx.createRadialGradient(0, 0, h * inner, 0, 0, h * 0.62);
            g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.45, "rgba(255,255,255,.12)"); g.addColorStop(0.8, "rgba(255,255,255,.62)"); g.addColorStop(1, "rgba(255,255,255,1)");
            ctx.fillStyle = g; ctx.fillRect(-w, -h, w * 2, h * 2); ctx.restore();
        });
    }
    const leak = /^leak:(\w+)$/.exec(kind);
    if (leak) return galCanvasTexture(PIXI, 512, 288, function (ctx, w, h) {
        // Soft overlapping blobs of light pouring in from one edge (drawn for the left edge, then turned).
        const from = leak[1];
        ctx.save();
        if (from === "right") { ctx.translate(w, 0); ctx.scale(-1, 1); }
        const blob = function (x, y, rx, ry, alpha) {
            ctx.save(); ctx.translate(x, y); ctx.scale(rx / ry, 1);
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
            g.addColorStop(0, "rgba(255,255,255," + alpha + ")"); g.addColorStop(0.35, "rgba(255,255,255," + alpha * 0.55 + ")"); g.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ry, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        };
        if (from === "top") { blob(w * 0.3, -h * 0.05, w * 0.42, h * 0.42, 0.85); blob(w * 0.62, -h * 0.02, w * 0.3, h * 0.32, 0.6); blob(w * 0.85, h * 0.02, w * 0.22, h * 0.2, 0.4); }
        else if (from === "corner") { blob(-w * 0.02, -h * 0.04, w * 0.46, h * 0.6, 0.95); blob(w * 0.16, h * 0.12, w * 0.2, h * 0.3, 0.45); blob(w * 0.05, h * 0.5, w * 0.12, h * 0.26, 0.3); }
        else { blob(-w * 0.04, h * 0.42, w * 0.3, h * 0.72, 0.95); blob(w * 0.05, h * 0.12, w * 0.16, h * 0.34, 0.55); blob(w * 0.1, h * 0.86, w * 0.14, h * 0.3, 0.4); }
        ctx.restore();
    });
    if (kind === "flare:glow" || kind === "flare:ghost" || kind === "flare:ring" || kind === "flare:core") return galCanvasTexture(PIXI, 256, 256, function (ctx, w, h) {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        if (kind === "flare:glow") { g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(0.12, "rgba(255,255,255,.45)"); g.addColorStop(0.4, "rgba(255,255,255,.12)"); g.addColorStop(1, "rgba(255,255,255,0)"); }
        else if (kind === "flare:core") { g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.2, "rgba(255,255,255,.8)"); g.addColorStop(0.5, "rgba(255,255,255,.15)"); g.addColorStop(1, "rgba(255,255,255,0)"); }
        else if (kind === "flare:ghost") { g.addColorStop(0, "rgba(255,255,255,.18)"); g.addColorStop(0.7, "rgba(255,255,255,.3)"); g.addColorStop(0.86, "rgba(255,255,255,.5)"); g.addColorStop(1, "rgba(255,255,255,0)"); }
        else { g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.8, "rgba(255,255,255,0)"); g.addColorStop(0.9, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(255,255,255,0)"); }
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    if (kind === "flare:streak") return galCanvasTexture(PIXI, 512, 32, function (ctx, w, h) {
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
        const v = ctx.createLinearGradient(0, 0, 0, h);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "destination-in";
        v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(0.5, "rgba(0,0,0,1)"); v.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    });
    if (kind === "dirt") return galCanvasTexture(PIXI, 512, 288, function (ctx, w, h) {
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
        let seed = 11;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let i = 0; i < 18; i++) {
            const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 80;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, "rgba(255,245,230," + (0.08 + rnd() * 0.12) + ")"); g.addColorStop(1, "rgba(255,245,230,0)");
            ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        for (let i = 0; i < 160; i++) { ctx.fillStyle = "rgba(255,250,240," + (0.25 + rnd() * 0.5) + ")"; ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 0.4 + rnd() * 1.4, 0, Math.PI * 2); ctx.fill(); }
    });
    return null;
}


return galLookArt;
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageLookArt};
