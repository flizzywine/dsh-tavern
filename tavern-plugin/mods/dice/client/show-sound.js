// The check show's sound (show.js), synthesized in code: no audio file, no pack entry. Pure: (stem, timeline) → PCM,
// the same samples on every machine, so the tests and the review render read the very sound the stage plays.
//
// The score follows the picture beat for beat (the times are the show's own timeline, SHOW_T):
//   open   the shutter closes (a rising hiss cut by a clack); each die is set down (a tick); each marked die is counted
//          (a chime, every one a fifth above the last: f, 3f/2, 9f/4 - the tones stand 3 : 3 : 3 apart); each edge is
//          ruled (a short rising stroke, each quicker); the figure is stamped (a low thud); then nothing.
//   bloom  a breath in, and the hit as the figure swallows the stage (a sub drop under a wide wash of air); each figure
//          of the frieze rings as it lights (the count's three tones an octave down, left, centre, right); each letter
//          lands (a drum, rising), the last on the downbeat with the whole chord: the open fifths the count promised
//          gain their major third, sung by a choir of formant voices over glitter.
//   exit   the air is drawn back in, and the result is filed on its card (a small tick).
//   calm   减少动态: nothing moves, so nothing strikes - the three tones, soft, and the chord held under the still.
// Everything rings in one small room (a Schroeder / Moorer reverb); the low end stays dry.

const SHOW_SOUND_RATE = 48000;
// The root: A (55 Hz and its octaves). Count tone j is 440 x (3/2)^j.
const SHOW_SOUND_ROOT = 55;
// The whole score's level as rendered (stems laid at their cues; BS.1770 integrated, sample peak in dBFS): the mixer
// gains the sfx bus from it (stage-audio-math.js audioGain). tests/fork-check-show-sound.test.mjs holds it to the render.
const SHOW_SOUND_LOUDNESS = Object.freeze({ v: 1, lufs: -15.2, peak: -1.0 });
// Every stem is scaled by this, so the laid-out score peaks at SHOW_SOUND_LOUDNESS.peak.
const SHOW_SOUND_GAIN = 0.9;

function showSynth(rate) {
    const TAU = Math.PI * 2, count = seconds => Math.max(1, Math.round(seconds * rate));
    function random(seed) {
        let a = 0x9e3779b9;
        for (const ch of String(seed)) a = Math.imul(a ^ ch.charCodeAt(0), 2654435761) >>> 0;
        return function () {
            a = a + 0x6d2b79f5 >>> 0;
            let t = Math.imul(a ^ a >>> 15, a | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    // An RBJ biquad (lowpass / highpass / bandpass with a 0 dB peak); tune() retunes it while it runs.
    function biquad(type, freq, q) {
        let b0, b1, b2, a1, a2, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        const filter = {
            tune(f, quality) {
                const w = TAU * Math.max(10, Math.min(f, rate * 0.45)) / rate, cos = Math.cos(w), alpha = Math.sin(w) / (2 * quality), a0 = 1 + alpha;
                if (type === "lowpass") { b0 = (1 - cos) / 2 / a0; b1 = (1 - cos) / a0; b2 = b0; }
                else if (type === "highpass") { b0 = (1 + cos) / 2 / a0; b1 = -(1 + cos) / a0; b2 = b0; }
                else { b0 = alpha / a0; b1 = 0; b2 = -alpha / a0; }
                a1 = -2 * cos / a0; a2 = (1 - alpha) / a0;
                return filter;
            },
            run(x) { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; }
        };
        return filter.tune(freq, q);
    }
    // White noise, seconds long.
    function noise(seconds, seed) {
        const out = new Float32Array(count(seconds)), next = random(seed);
        for (let i = 0; i < out.length; i++) out[i] = next() * 2 - 1;
        return out;
    }
    // In place: a filter whose frequency glides from f0 to f1 (exponentially, bent by `curve`), retuned every 16 samples.
    function sweep(data, type, f0, f1, q, curve = 1) {
        const filter = biquad(type, f0, q), ratio = f1 / f0;
        for (let i = 0; i < data.length; i++) {
            if ((i & 15) === 0) filter.tune(f0 * Math.pow(ratio, Math.pow(i / data.length, curve)), q);
            data[i] = filter.run(data[i]);
        }
        return data;
    }
    function filtered(data, type, freq, q = 0.707) { const filter = biquad(type, freq, q); for (let i = 0; i < data.length; i++) data[i] = filter.run(data[i]); return data; }
    // In place: times shape(t seconds).
    function shape(data, fn) { for (let i = 0; i < data.length; i++) data[i] *= fn(i / rate); return data; }
    // A sine whose frequency follows freq(t).
    function tone(seconds, freq) {
        const out = new Float32Array(count(seconds));
        let phase = 0;
        for (let i = 0; i < out.length; i++) { out[i] = Math.sin(phase); phase += TAU * freq(i / rate) / rate; }
        return out;
    }
    // A band-limited sawtooth (polyBLEP) whose frequency follows freq(t).
    function saw(seconds, freq, start = 0) {
        const out = new Float32Array(count(seconds));
        let phase = start;
        for (let i = 0; i < out.length; i++) {
            const step = freq(i / rate) / rate;
            phase += step; if (phase >= 1) phase -= 1;
            let value = 2 * phase - 1;
            if (phase < step) { const x = phase / step; value -= x + x - x * x - 1; }
            else if (phase > 1 - step) { const x = (phase - 1) / step; value -= x * x + x + x + 1; }
            out[i] = value;
        }
        return out;
    }
    // A struck bar (partials 1 : 4 : 10, a vibraphone's): the count's and the frieze's tone. ring: the fundamental's
    // decay (s); warm adds a second voice a few cents off, for the low octave.
    function chime(freq, seconds, ring, warm = 0) {
        const out = new Float32Array(count(seconds)), hit = filtered(noise(0.012, "mallet" + freq), "highpass", 2500);
        for (const [ratio, level, decay] of [[1, 1, ring], [4, 0.2, ring * 0.33], [10, 0.045, ring * 0.1]]) {
            if (freq * ratio > rate * 0.45) continue;
            for (const [cents, part] of warm ? [[0, 0.6], [warm, 0.4]] : [[0, 1]]) {
                const w = TAU * freq * ratio * Math.pow(2, cents / 1200) / rate;
                for (let i = 0; i < out.length; i++) out[i] += level * part * Math.sin(w * i) * Math.exp(-i / rate / decay);
            }
        }
        for (let i = 0; i < hit.length; i++) out[i] += 0.22 * hit[i] * Math.exp(-i / rate / 0.003);
        const rise = count(0.0015);
        for (let i = 0; i < rise; i++) out[i] *= i / rise;
        return out;
    }
    // A drop: a sine falling from `from` to `to` Hz (time constant fall s), ringing `ring` s; its first tenth of a
    // second is driven (harmonics a small speaker can still say), the rest rings clean.
    function drop(seconds, from, to, fall, ring, drive) {
        const out = tone(seconds, t => to + (from - to) * Math.exp(-t / fall));
        for (let i = 0; i < out.length; i++) { const t = i / rate, push = 1 + (drive - 1) * Math.exp(-t / 0.09); out[i] = Math.tanh(out[i] * push) / Math.tanh(push) * Math.exp(-t / ring) * Math.min(1, (seconds - t) / (seconds * 0.3)); }
        const rise = count(0.002);
        for (let i = 0; i < rise; i++) out[i] *= i / rise;
        return out;
    }
    // A choir on one vowel (ah): three sawtooth voices a note, each a little off pitch and slowly wavering, spread
    // across the stereo field, through the vowel's five formants. notes: [[hz, level]]. → [left, right], unshaped.
    function choir(seconds, notes, seed) {
        const next = random(seed), length = count(seconds), sides = [new Float32Array(length), new Float32Array(length)];
        for (const [hz, level] of notes) for (const cents of [-8, 0, 7]) {
            const pitch = hz * Math.pow(2, (cents + (next() - 0.5) * 5) / 1200), speed = 4.6 + next() * 1.2, lag = next() * TAU, pan = (next() - 0.5) * 1.5;
            const voice = saw(seconds, t => pitch * (1 + 0.004 * Math.min(1, t / 0.6) * Math.sin(TAU * speed * t + lag)), next());
            const left = level * Math.cos((pan + 1) * Math.PI / 4), right = level * Math.sin((pan + 1) * Math.PI / 4);
            for (let i = 0; i < length; i++) { sides[0][i] += voice[i] * left; sides[1][i] += voice[i] * right; }
        }
        return sides.map(side => {
            const out = new Float32Array(length), body = biquad("lowpass", 520, 0.7);
            const formants = [[800, 80, 1], [1150, 90, 0.5], [2900, 120, 0.1], [3900, 130, 0.12], [4950, 140, 0.02]].map(([f, width, level]) => [biquad("bandpass", f, f / width), level]);
            for (let i = 0; i < length; i++) {
                let sum = 0.3 * body.run(side[i]);
                for (const [filter, level] of formants) sum += level * filter.run(side[i]);
                out[i] = sum;
            }
            return out;
        });
    }
    // A stereo stem being laid: add(mono, at seconds, level, pan -1..1, send to the room 0..1); done() adds the room,
    // rounds the peaks and returns { left, right }.
    function stem(seconds) {
        const length = count(seconds), left = new Float32Array(length), right = new Float32Array(length), sendL = new Float32Array(length), sendR = new Float32Array(length);
        function add(mono, at, level = 1, pan = 0, send = 0) {
            const from = Math.round(at * rate), l = level * Math.cos((pan + 1) * Math.PI / 4), r = level * Math.sin((pan + 1) * Math.PI / 4);
            for (let i = Math.max(0, -from), end = Math.min(mono.length, length - from); i < end; i++) {
                const v = mono[i];
                left[from + i] += v * l; right[from + i] += v * r;
                if (send) { sendL[from + i] += v * l * send; sendR[from + i] += v * r * send; }
            }
        }
        function addStereo(sides, at, level = 1, send = 0) {
            const from = Math.round(at * rate);
            for (let i = Math.max(0, -from), end = Math.min(sides[0].length, length - from); i < end; i++) {
                left[from + i] += sides[0][i] * level; right[from + i] += sides[1][i] * level;
                if (send) { sendL[from + i] += sides[0][i] * level * send; sendR[from + i] += sides[1][i] * level * send; }
            }
        }
        // The room: eight damped combs into four allpasses a side (Freeverb's tunings, the right side 23 samples longer).
        function room(input, spread, feedback, damp) {
            const scale = rate / 44100, out = new Float32Array(length);
            const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(size => ({ line: new Float32Array(Math.round((size + spread) * scale)), at: 0, low: 0 }));
            const passes = [556, 441, 341, 225].map(size => ({ line: new Float32Array(Math.round((size + spread) * scale)), at: 0 }));
            for (let i = 0; i < length; i++) {
                const dry = input[i] * 0.015;
                let sum = 0;
                for (const comb of combs) {
                    const echo = comb.line[comb.at];
                    comb.low = echo * (1 - damp) + comb.low * damp;
                    comb.line[comb.at] = dry + comb.low * feedback;
                    if (++comb.at === comb.line.length) comb.at = 0;
                    sum += echo;
                }
                for (const pass of passes) {
                    const echo = pass.line[pass.at];
                    pass.line[pass.at] = sum + echo * 0.5;
                    if (++pass.at === pass.line.length) pass.at = 0;
                    sum = echo - sum;
                }
                out[i] = sum;
            }
            return out;
        }
        function done(roomLevel = 1, feedback = 0.86, damp = 0.3) {
            const wetL = room(sendL, 0, feedback, damp), wetR = room(sendR, 23, feedback, damp), edge = count(0.03);
            for (let i = 0; i < length; i++) {
                // The room answers in both ears; a soft knee rounds what the sum pushes past -3 dBFS.
                const l = (left[i] + roomLevel * (wetL[i] * 0.8 + wetR[i] * 0.2)) * SHOW_SOUND_GAIN, r = (right[i] + roomLevel * (wetR[i] * 0.8 + wetL[i] * 0.2)) * SHOW_SOUND_GAIN;
                const out = i > length - edge ? (length - i) / edge : 1;
                left[i] = knee(l) * out; right[i] = knee(r) * out;
            }
            return { left, right };
        }
        return { add, addStereo, done };
    }
    const knee = x => { const a = Math.abs(x); return a <= 0.7 ? x : Math.sign(x) * (0.7 + 0.3 * Math.tanh((a - 0.7) / 0.3)); };
    return { TAU, count, random, biquad, noise, sweep, filtered, shape, tone, saw, chime, drop, choir, stem };
}

// When edge j of the figure starts being ruled (ms): each stroke follows the last a little sooner.
function showEdgeAt(T, j) { return T.edge + T.edgeGap * (1 - Math.pow(T.edgeQuick, j)) / (1 - T.edgeQuick); }
// When letter i of n lands (ms): the last on the accent, the others the steps before it.
function showSlamAt(T, i, n) { return T.accent - (n - 1 - i) * T.slamStep; }

// The show's stems and when each starts (ms on the show's clock). calm: 减少动态's one stem.
function showSoundCues(T, calm) {
    return calm ? [{ stem: "calm", at: 0 }] : [{ stem: "open", at: 0 }, { stem: "bloom", at: T.hit - T.breath }, { stem: "exit", at: T.end }];
}

// One stem's PCM: { left, right } Float32Array at `rate`. T: the show's timeline (SHOW_T); cast: { dice, marked,
// corners, letters } counts of this record's composition.
function showSoundStem(name, T, cast, rate = SHOW_SOUND_RATE) {
    const S = showSynth(rate), s = ms => ms / 1000, fifth = j => 440 * Math.pow(1.5, Math.min(j, 3));
    if (name === "open") {
        const mix = S.stem(s(T.fill) + 1.3);
        // The shutter: air rising as the blades close, cut dead by their clack.
        const close = s(T.irisDur), hiss = S.sweep(S.noise(close, "shutter"), "bandpass", 500, 3200, 1.6, 1.6);
        mix.add(S.shape(hiss, t => Math.pow(t / close, 2.2) * (t > close - 0.004 ? (close - t) / 0.004 : 1)), 0, 0.36, 0, 0.1);
        mix.add(S.drop(0.3, 190, 82, 0.012, 0.07, 1.6), close, 0.5, 0, 0.12);
        mix.add(S.shape(S.filtered(S.noise(0.03, "clack"), "bandpass", 2400, 1.2), t => Math.exp(-t / 0.006)), close, 0.55, 0, 0.25);
        // The dice set down: a dry tick each, a little different every time.
        for (let i = 0; i < cast.dice; i++) {
            const tick = S.shape(S.filtered(S.noise(0.03, "tick" + i), "bandpass", 3100 + 350 * ((i * 5) % 3), 3), t => Math.exp(-t / 0.004));
            mix.add(tick, s(T.deal + i * T.dealStep), 0.42, -0.5 + i / Math.max(1, cast.dice - 1), 0.12);
            mix.add(S.drop(0.08, 320, 210, 0.01, 0.018, 1), s(T.deal + i * T.dealStep), 0.16, -0.5 + i / Math.max(1, cast.dice - 1));
        }
        // The count: one chime a marked die, a fifth above the last.
        for (let j = 0; j < cast.marked; j++) mix.add(S.chime(fifth(j), 1.6, 0.42), s(T.count + j * T.countStep), 0.34, -0.25 + 0.25 * j, 0.55);
        // The edges ruled: a rising stroke each (pen on paper), the pitch a step higher every time.
        for (let j = 0; j < cast.corners; j++) {
            const length = s(T.edgeDur), from = 700 * Math.pow(1.26, j);
            const stroke = S.shape(S.sweep(S.noise(length, "rule" + j), "bandpass", from, from * 3.2, 5), t => Math.min(1, t / 0.008) * Math.pow(1 - t / length, 0.6));
            mix.add(stroke, s(showEdgeAt(T, j)), 0.4, [-0.4, 0.4, 0][j % 3], 0.15);
            mix.add(S.shape(S.tone(length, t => from * 0.5 * (1 + 1.4 * t / length)), t => 0.5 * Math.min(1, t / 0.008) * (1 - t / length)), s(showEdgeAt(T, j)), 0.12, [-0.4, 0.4, 0][j % 3], 0.2);
        }
        // The stamp: the figure inked in one blow.
        mix.add(S.drop(0.5, 170, 58, 0.022, 0.13, 2.2), s(T.fill), 0.5, 0, 0.06);
        mix.add(S.shape(S.filtered(S.noise(0.06, "stamp"), "lowpass", 1800), t => Math.exp(-t / 0.012)), s(T.fill), 0.4, 0, 0.2);
        return mix.done(1, 0.8, 0.35);
    }
    if (name === "bloom") {
        const breath = s(T.breath), at = ms => breath + s(ms - T.hit), accent = at(T.accent), end = at(T.end), mix = S.stem(end + 2.6);
        // The breath in: air and the root's octave swelling out of the silence, cut by the hit.
        mix.add(S.shape(S.sweep(S.noise(breath, "breath"), "bandpass", 5200, 1400, 0.9), t => Math.exp((t - breath) / 0.075)), 0, 0.3, 0, 0.3);
        mix.add(S.shape(S.tone(breath, () => 220), t => Math.exp((t - breath) / 0.09)), 0, 0.12);
        // The hit: the sub falls an octave and a half and stays; a knock a small speaker can say; a wide wash of air.
        mix.add(S.drop(2.6, 150, SHOW_SOUND_ROOT, 0.05, 0.55, 2.6), breath, 0.6);
        mix.add(S.drop(0.5, 330, 110, 0.03, 0.12, 2), breath, 0.3, 0, 0.08);
        for (const [side, seed] of [[-1, "washL"], [1, "washR"]]) {
            const wash = S.shape(S.sweep(S.noise(2.2, seed), "lowpass", 7000, 260, 0.8, 0.5), t => Math.min(1, t / 0.004) * Math.exp(-t / 0.55));
            mix.add(wash, breath, 0.26, side * 0.9, 0.25);
        }
        // The open fifths under everything from the hit (root, twelfth, and the ninth above it: 1 : 3 : 9), swelling
        // toward the accent.
        const hold = end - breath + 1.6, swell = t => Math.min(1, 0.25 + 0.75 * t / (accent - breath)) * Math.min(1, t / 0.25) * Math.min(1, Math.exp(-(t - (end - breath)) / 0.5));
        for (const [ratio, level] of [[2, 0.1], [3, 0.07], [9, 0.02]]) {
            const drone = S.filtered(S.saw(hold, t => SHOW_SOUND_ROOT * ratio * (1 + 0.0015 * Math.sin(S.TAU * 0.31 * t + ratio))), "lowpass", 900);
            mix.add(S.shape(drone, swell), breath, level, 0, 0.3);
        }
        // The frieze: each figure rings as it lights - the count's tones an octave down, left to right.
        for (let k = 0; k < 3; k++) {
            mix.add(S.chime(fifth(k) / 2, 3.2, 1.25, 6), at(T.tri + k * T.triStep), 0.26, [-0.62, 0, 0.62][k], 0.7);
            mix.add(S.chime(fifth(k), 2, 0.6), at(T.tri + k * T.triStep), 0.1, [-0.62, 0, 0.62][k], 0.7);
        }
        // The letters land: a drum each, climbing the chord; the last is the accent.
        const steps = [2, 2.5, 3, 4, 5, 6];
        for (let i = 0; i < cast.letters - 1; i++) {
            const when = at(showSlamAt(T, i, cast.letters)), pitch = SHOW_SOUND_ROOT * steps[Math.min(i, steps.length - 1)], pan = -0.3 + 0.6 * i / Math.max(1, cast.letters - 1);
            mix.add(S.drop(0.6, pitch * 2.2, pitch, 0.018, 0.16, 2), when, 0.42, pan, 0.18);
            mix.add(S.shape(S.filtered(S.noise(0.05, "slam" + i), "bandpass", 1900, 1.4), t => Math.exp(-t / 0.009)), when, 0.3, pan, 0.3);
        }
        // The accent: the second sub, a crash of bright air, and the chord complete - the choir brings the third.
        mix.add(S.drop(2.8, 165, SHOW_SOUND_ROOT, 0.06, 0.7, 2.8), accent, 0.62);
        mix.add(S.drop(0.6, 440, 110, 0.03, 0.14, 2), accent, 0.3, 0, 0.1);
        for (const [side, seed] of [[-1, "crashL"], [1, "crashR"]]) {
            mix.add(S.shape(S.filtered(S.noise(2.4, seed), "highpass", 3200), t => Math.min(1, t / 0.003) * Math.exp(-t / 0.6)), accent, 0.12, side * 0.85, 0.5);
        }
        const sung = end - accent + 2.2, voices = S.choir(sung, [[110, 0.8], [165, 0.7], [220, 0.9], [277.18, 0.75], [330, 0.8], [495, 0.6], [554.37, 0.5], [660, 0.35]], "choir");
        // It comes in under the blow and keeps growing until the field folds.
        const breathe = t => Math.pow(Math.min(1, t / 0.32), 1.5) * (0.72 + 0.28 * Math.min(1, t / (end - accent))) * Math.min(1, Math.exp(-(t - (end - accent)) / 0.55));
        mix.addStereo(voices.map(side => S.shape(side, breathe)), accent, 0.38, 0.6);
        // Glitter: the dust heard - short high tones of the chord, thick at the accent and thinning.
        const next = S.random("glitter"), tones = [1760, 1980, 2217.46, 2640, 3520, 3960, 4434.92, 5280];
        for (let t = at(T.tri); t < end + 0.5;) {
            const since = t - accent, density = since < 0 ? 7 + 14 * (t - at(T.tri)) / (accent - at(T.tri)) : 46 * Math.exp(-since / 1.3) + 6;
            t += -Math.log(1 - next()) / density;
            const hz = tones[Math.floor(next() * tones.length)], ring = 0.03 + next() * 0.11, level = 0.02 + 0.05 * next() * next();
            const ping = S.shape(S.tone(ring * 5, () => hz), x => Math.min(1, x / 0.002) * Math.exp(-x / ring));
            mix.add(ping, t, level * (t > end ? Math.max(0, 1 - (t - end) / 0.5) : 1), next() * 1.8 - 0.9, 0.6);
        }
        return mix.done(1, 0.88, 0.28);
    }
    if (name === "exit") {
        const ebb = s(T.ebb), land = s(T.ebb + T.exit), mix = S.stem(land + 0.9);
        // The air drawn back in as the field folds into the figure; the figure filed on its card.
        mix.add(S.shape(S.sweep(S.noise(ebb, "ebb"), "bandpass", 300, 3800, 1.2, 1.4), t => Math.pow(t / ebb, 1.8) * (t > ebb - 0.006 ? (ebb - t) / 0.006 : 1)), 0, 0.5, 0, 0.2);
        mix.add(S.drop(0.3, 210, 96, 0.015, 0.06, 1.6), ebb, 0.36, 0, 0.1);
        mix.add(S.chime(1760, 0.7, 0.16), land, 0.16, 0.2, 0.5);
        mix.add(S.shape(S.filtered(S.noise(0.03, "file"), "bandpass", 2800, 2), t => Math.exp(-t / 0.005)), land, 0.4, 0.2, 0.2);
        mix.add(S.drop(0.15, 260, 150, 0.01, 0.03, 1.2), land, 0.3, 0.2);
        return mix.done(1, 0.8, 0.35);
    }
    // calm: the three tones, close together and soft, into the chord held under the still picture.
    const hold = s(T.calmIn + T.calmHold), mix = S.stem(hold + 2.4);
    for (let j = 0; j < 3; j++) mix.add(S.chime(fifth(j) / 2, 3, 1.1, 6), 0.06 + 0.13 * j, 0.26, -0.4 + 0.4 * j, 0.7);
    const voices = S.choir(hold + 1.6, [[110, 0.8], [165, 0.7], [220, 0.9], [277.18, 0.75], [330, 0.8], [495, 0.6]], "calm");
    mix.addStereo(voices.map(side => S.shape(side, t => Math.pow(Math.min(1, t / 0.9), 1.5) * Math.min(1, Math.exp(-(t - hold) / 0.5)))), 0.3, 0.26, 0.6);
    return mix.done(1, 0.88, 0.28);
}

if (typeof module !== "undefined" && typeof window === "undefined") module.exports = { SHOW_SOUND_RATE, SHOW_SOUND_LOUDNESS, SHOW_SOUND_GAIN, showSynth, showEdgeAt, showSlamAt, showSoundCues, showSoundStem };
