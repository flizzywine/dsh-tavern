'use strict';
// What a covered word sounds like (mods/redaction/README.md 配音): the line is synthesized whole, and where a cover is
// still shut the stage's mixer turns the voice down under this noise (stage-audio.js mask). No recorded asset: every
// play draws it from a fresh seed, so no two bleeps are the same, and a fixed seed (a clip export) gives the same
// samples again. Layers, as a radio losing its signal: a brown/pink rumble, a band-limited hiss, sparse crackles, and
// short dropouts where it all cuts out. Levelled to an RMS of 0.1 (about -20 dBFS, the nominal voice level), so the
// mixer scales it with the line's own gain.
function noiseRandom(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; s = (s ^ (s >>> 13)) >>> 0; return s / 4294967296; };
}
// sampleRate: the audio context's; seconds: the loop's length. -> Float32Array of mono samples.
function redactionNoise(sampleRate, seed, seconds = 2) {
    const r = noiseRandom(seed), length = Math.round(sampleRate * seconds), out = new Float32Array(length);
    // pink (Paul Kellet's economy filter) and brown (leaky integrator) from the same white source
    let b0 = 0, b1 = 0, b2 = 0, brown = 0, low = 0, prev = 0, pop = 0, gap = 0, gapGain = 1;
    const hissCut = Math.exp(-2 * Math.PI * 1800 / sampleRate), lowCut = Math.exp(-2 * Math.PI * 6500 / sampleRate);
    for (let i = 0; i < length; i++) {
        const white = r() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.0990460; b1 = 0.96300 * b1 + white * 0.2965164; b2 = 0.57000 * b2 + white * 1.0526913;
        const pink = (b0 + b1 + b2 + white * 0.1848) * 0.11;
        brown = (brown + white * 0.02) * 0.998;
        // hiss: white with its rumble taken out (high-pass at ~1.8 kHz) and its top softened (low-pass at ~6.5 kHz)
        const high = white - prev * hissCut; prev = white;
        low = low * lowCut + high * (1 - lowCut);
        // a crackle about every 60 ms, a few samples long
        if (pop <= 0 && r() < 1 / (0.06 * sampleRate)) pop = 4 + Math.floor(r() * 24);
        const crackle = pop > 0 ? (pop--, (r() * 2 - 1) * 1.6) : 0;
        // a dropout about every 0.7 s, 20-90 ms long, faded in and out over ~3 ms
        if (gap <= 0 && r() < 1 / (0.7 * sampleRate)) gap = Math.floor((0.02 + r() * 0.07) * sampleRate);
        const target = gap > 0 ? (gap--, 0.08) : 1;
        gapGain += (target - gapGain) * Math.min(1, 330 / sampleRate);
        out[i] = (pink * 0.5 + brown * 0.9 + low * 0.55 + crackle * 0.25) * gapGain;
    }
    // level to RMS 0.1; both ends fade over 3 ms, so the loop's seam is a dip in the noise rather than a click
    let sum = 0;
    for (const value of out) sum += value * value;
    const scale = 0.1 / (Math.sqrt(sum / length) || 1), fade = Math.min(length >> 1, Math.round(sampleRate * 0.003));
    for (let i = 0; i < length; i++) {
        const edge = Math.min(1, Math.min(i, length - 1 - i) / fade);
        out[i] = Math.max(-1, Math.min(1, out[i] * scale * edge));
    }
    return out;
}
module.exports = {redactionNoise};
