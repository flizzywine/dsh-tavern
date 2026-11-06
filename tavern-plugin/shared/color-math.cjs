// Shared by material look previews and stage rendering; no plugin or browser state.
// Colour matrices (pixi ColorMatrixFilter layout: 4 rows × 5, offsets in 0..1). multiply(a, b) = apply b, then a.
const galMatrix = {
    identity: () => [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    multiply(a, b) {
        const out = new Array(20);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
            let sum = c === 4 ? a[r * 5 + 4] : 0;
            for (let k = 0; k < 4; k++) sum += a[r * 5 + k] * b[k * 5 + c];
            out[r * 5 + c] = sum;
        }
        return out;
    },
    chain(...list) { return list.reduce((acc, m) => galMatrix.multiply(m, acc), galMatrix.identity()); },
    saturate(s) {
        const r = 0.2126 * (1 - s), g = 0.7152 * (1 - s), b = 0.0722 * (1 - s);
        return [r + s, g, b, 0, 0, r, g + s, b, 0, 0, r, g, b + s, 0, 0, 0, 0, 0, 1, 0];
    },
    scale(r, g, b) { return [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0]; },
    contrast(c) { const o = 0.5 * (1 - c); return [c, 0, 0, 0, o, 0, c, 0, 0, o, 0, 0, c, 0, o, 0, 0, 0, 1, 0]; },
    offset(r, g, b) { return [1, 0, 0, 0, r, 0, 1, 0, 0, g, 0, 0, 1, 0, b, 0, 0, 0, 1, 0]; },
    mix(a, b, t) { return a.map((value, i) => value + (b[i] - value) * t); },
    isIdentity(m) { const id = galMatrix.identity(); return m.every((value, i) => Math.abs(value - id[i]) < 1e-3); }
};
function galClamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
if(typeof module!=="undefined"&&typeof window==="undefined")module.exports={galMatrix,galClamp01};
