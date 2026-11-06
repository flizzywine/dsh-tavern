// BS.1770-4: K weighting, 400 ms blocks / 100 ms steps, absolute and relative gating.
// Kept platform-free so the browser fallback can be checked against ffmpeg in Node.
// Bus levels before the sliders. Voice is the
// anchor (every cached line is gained to -18 LUFS); BGM sits 6 LU under it and 10 LU under it while a line speaks,
// ambience 12 LU under. The sliders all default to 1, so the balance lives here and nowhere else.
const AUDIO_TARGETS = Object.freeze({ voice: -18, music: -24, sfx: -20, ui: -26, ambience: -30 });
// Ducking matrix: trigger -> bus -> dB. Priority call > voice > sfx > ambience > music: a trigger only lowers the
// buses below it. With several triggers sounding the deepest dip wins (never stacked). The call holds from dialling
// (ringback) to hang-up, so BGM stays down through her pauses too.
const AUDIO_DUCK = Object.freeze({
    call: Object.freeze({ sfx: -6, ui: -6, ambience: -10, music: -10 }),
    voice: Object.freeze({ sfx: -2, ui: -2, ambience: -4, music: -4 }),
    sfx: Object.freeze({ ambience: -3, music: -2 }),
    ambience: Object.freeze({})
});
// setTargetAtTime time constants in seconds: attack when the trigger starts; on its end the dip waits `hold`, then
// releases. Back within 0.5 dB of the full level: voice 0.25 s hold + 0.38 s, call 0.63 s, SE 0.05 + 0.25 s - every dip
// is gone within 1 s, also on the 400 ms momentary meter.
const AUDIO_DUCK_TIME = Object.freeze({
    call: Object.freeze({ attack: 0.08, hold: 0, release: 0.25 }),
    voice: Object.freeze({ attack: 0.05, hold: 0.25, release: 0.2 }),
    sfx: Object.freeze({ attack: 0.02, hold: 0.05, release: 0.15 }),
    ambience: Object.freeze({ attack: 0.1, hold: 0, release: 0.3 })
});
// The engine's matrix with an open stage skin's `duck` (voice / sfx rows, -24..0 dB, checked where the skin enters) over
// it, cell by cell; cells the skin leaves out keep the engine's amount.
function audioDuckMatrix(skin) {
    if (!skin) return AUDIO_DUCK;
    const matrix = {};
    for (const [trigger, row] of Object.entries(AUDIO_DUCK)) matrix[trigger] = { ...row, ...skin[trigger] };
    return matrix;
}
// The dip (dB) of one bus for the triggers sounding now, and which trigger sets it (null: none).
function audioDuckDb(layer, triggers, matrix = AUDIO_DUCK) {
    let db = 0, by = null;
    for (const trigger of Object.keys(matrix)) {
        const value = triggers[trigger] ? matrix[trigger][layer] || 0 : 0;
        if (value < db) { db = value; by = trigger; }
    }
    return { db, by };
}
// Five normalized cached voice outputs: -21.3..-22.1 LUFS (median -21.7).
// Keep the provider's guaranteed -1 dBFS ceiling rather than assume spare peak headroom.
const AUDIO_VOICE = Object.freeze({ lufs: -22, peak: -1, v: 1 });
function audioMeasurement(value) {
    return value && value.v === 1 && Number.isFinite(value.lufs) && value.lufs >= -100 && value.lufs <= 10 && Number.isFinite(value.peak) && value.peak >= -100 && value.peak <= 20;
}
function audioGain(layer, measured, gainDb = 0) {
    // Unknown audio is assumed hot, never boosted. Silence must not become a huge gain.
    const value = audioMeasurement(measured) ? measured : { lufs: -10, peak: 0 };
    if (value.lufs <= -70) return 0;
    // Authored SFX gain follows normalization, with the same true-peak ceiling.
    const normalized = Math.min(AUDIO_TARGETS[layer] - value.lufs, -1 - value.peak, 12);
    const authored = layer === "sfx" || layer === "ui" ? gainDb : 0;
    return Math.pow(10, Math.min(normalized + authored, -1 - value.peak) / 20);
}
function audioDuck(layer, triggers, matrix) { return Math.pow(10, audioDuckDb(layer, triggers, matrix).db / 20); }
function measureAudioLoudness(channels, rate) {
    if (!channels.length || channels.length > 2 || !Number.isFinite(rate) || rate < 8000) throw new Error("Unsupported audio layout");
    const length = channels[0].length;
    if (!length || channels.some(channel => channel.length !== length)) throw new Error("Empty audio");
    function coefficients(f, q, shelf) {
        const k = Math.tan(Math.PI * f / rate), k2 = k * k, a0 = 1 + k / q + k2;
        const vh = Math.pow(10, 3.999843853973347 / 20), vb = Math.pow(vh, 0.4996667741545416);
        return shelf ? [(vh + vb * k / q + k2) / a0, 2 * (k2 - vh) / a0, (vh - vb * k / q + k2) / a0, 2 * (k2 - 1) / a0, (1 - k / q + k2) / a0]
            : [1, -2, 1, 2 * (k2 - 1) / a0, (1 - k / q + k2) / a0];
    }
    const shelf = coefficients(1681.974450955533, 0.7071752369554196, true), highpass = coefficients(38.13547087602444, 0.5003270373238773, false);
    const hop = Math.round(rate * 0.1), block = hop * 4, padded = Math.max(length, block);
    const energy = new Float64Array(padded);
    let peak = 0;
    // Four-times, 48-tap windowed-sinc interpolation estimates intersample peaks.
    const phases = [0.25, 0.5, 0.75].map(phase => {
        const taps = []; let sum = 0;
        for (let j = -23; j <= 24; j++) { const x = phase - j, sinc = Math.sin(Math.PI * x) / (Math.PI * x), w = 0.5 + 0.5 * Math.cos(Math.PI * x / 24); const v = sinc * w; taps.push(v); sum += v; }
        return taps.map(v => v / sum);
    });
    for (const channel of channels) {
        // The two K-weighting biquads (shelf, then highpass) inlined: no per-sample closure calls.
        const [s0, s1, s2, s3, s4] = shelf, [h0, h1, h2, h3, h4] = highpass;
        let sx1 = 0, sx2 = 0, sy1 = 0, sy2 = 0, hx1 = 0, hx2 = 0, hy1 = 0, hy2 = 0;
        for (let i = 0; i < padded; i++) {
            const sample = i < length ? channel[i] : 0;
            const x = s0 * sample + s1 * sx1 + s2 * sx2 - s3 * sy1 - s4 * sy2; sx2 = sx1; sx1 = sample; sy2 = sy1; sy1 = x;
            const y = h0 * x + h1 * hx1 + h2 * hx2 - h3 * hy1 - h4 * hy2; hx2 = hx1; hx1 = x; hy2 = hy1; hy1 = y;
            energy[i] += y * y;
            const magnitude = sample < 0 ? -sample : sample; if (magnitude > peak) peak = magnitude;
        }
        // Zero-padded copy: the same products in the same order, without out-of-range reads in the hot loop
        // (a 2-minute stereo track took ~19 s, which left a new BGM at the unknown-audio gain that long).
        // A block whose interpolation bound (sum |taps| x its largest sample) cannot pass the peak so far is skipped:
        // the result is unchanged and most of a track never reaches the FIR.
        const window = new Float32Array(length + 47); window.set(channel, 23);
        const taps = phases.map(phase => Float64Array.from(phase)), bound = Math.max(...phases.map(phase => phase.reduce((s, v) => s + Math.abs(v), 0))) * (1 + 1e-9);
        for (let start = 0; start < length; start += 256) {
            const end = Math.min(length, start + 256);
            let local = 0;
            for (let k = start; k < end + 47; k++) { const v = window[k]; if (v > local) local = v; else if (-v > local) local = -v; }
            if (local * bound <= peak) continue;
            for (const phase of taps) for (let i = start; i < end; i++) {
                let sample = 0;
                for (let j = 0; j < 48; j++) sample += window[i + j] * phase[j];
                if (sample > peak) peak = sample; else if (-sample > peak) peak = -sample;
            }
        }
    }
    const blocks = []; let sum = 0;
    for (let i = 0; i < padded; i++) {
        sum += energy[i]; if (i >= block) sum -= energy[i - block];
        if (i >= block - 1 && (i + 1 - block) % hop === 0) blocks.push(sum / block);
    }
    const loudness = power => -0.691 + 10 * Math.log10(Math.max(1e-15, power));
    const absolute = blocks.filter(power => loudness(power) >= -70);
    const relative = loudness(absolute.reduce((a, b) => a + b, 0) / (absolute.length || 1)) - 10;
    const gated = absolute.filter(power => loudness(power) >= relative);
    return { lufs: gated.length ? loudness(gated.reduce((a, b) => a + b, 0) / gated.length) : -100, peak: peak ? Math.max(-100, 20 * Math.log10(peak) + 0.2) : -100, v: 1 };
}
