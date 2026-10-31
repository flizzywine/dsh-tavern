function createStageEffectColors({document}) {
let disposed=false;
// Two 0xRRGGBB colours blended per channel (t 0..1).
function galColorMix(a, b, t) {
    const ch = (c, s) => (c >> s) & 255;
    const one = s => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
    return (one(16) << 16) | (one(8) << 8) | one(0);
}

// Any CSS colour → 0xRRGGBB (the browser parses it).
function galCssColor(value, fallback) {
    if (typeof value === "number") return value;
    if(disposed)return fallback == null ? 0xf06aa0 : fallback;
    try {
        const ctx = galCssColor.ctx || (galCssColor.ctx = document.createElement("canvas").getContext("2d"));
        ctx.fillStyle = "#000"; ctx.fillStyle = String(value || "");
        const text = ctx.fillStyle;
        if (/^#[0-9a-f]{6}$/i.test(text)) return parseInt(text.slice(1), 16);
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(text);
        if (m) return (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]);
    } catch (_) {}
    return fallback == null ? 0xf06aa0 : fallback;
}
function galHex(color) { return "#" + (color & 0xffffff).toString(16).padStart(6, "0"); }


return {mix:galColorMix,css:galCssColor,hex:galHex,dispose(){disposed=true;galCssColor.ctx=null;}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageEffectColors};
