// @include audio-trace.cjs
const AUDIO_DEFAULT_LEVEL = 0.8;
// The quiet after the last source ends before the mixer's AudioContext is suspended (see settle()).
const AUDIO_IDLE_SUSPEND_MS = 3000;
// The time constant (s) of the other sources' return after an exclusive source ends (~1.2 s to 95%).
const AUDIO_EXCLUSIVE_RETURN = 0.4;
function audioContentKey(identity) {
    const match = /(?:^|[^0-9a-f])([0-9a-f]{64})(?![0-9a-f])/.exec(String(identity || ""));
    return match ? match[1] : null;
}
function audioPreferences(storage) {
    // quarter-strength UI cues; migrate the saved slider once, in the same record.
    // every bus slider defaults to 1; the bus targets carry the balance.
    const defaults = { v: 1, uiGainVersion: 1, musicLevelVersion: 1, mixVersion: 1, master: AUDIO_DEFAULT_LEVEL, voice: 1, music: 1, sfx: 1, ambience: 1, ui: 0.5, muted: {} };
    try {
        let record = storage.getItem("dsh-tavern-stage-audio");
        if (record == null) {
            record = storage.getItem("fork-stage-audio");
            if (record != null) {
                // Copy the complete record before removing the old key; failed writes retain the original.
                try {
                    storage.setItem("dsh-tavern-stage-audio", record);
                    storage.removeItem("fork-stage-audio");
                } catch (_) {} // Keep using the saved levels if storage cannot publish the migration.
            }
        }
        const saved = JSON.parse(record || "null");
        if (!saved || saved.v !== 1) {
            // One-time reset of the old compensating gains, not the voice enable/roster settings.
            for (const key of ["fork-stage-music", "fork-stage-sfx"]) storage.setItem(key, JSON.stringify({ volume: 0.8, muted: false }));
            storage.setItem("dsh-tavern-stage-audio", JSON.stringify(defaults)); return defaults;
        }
        for (const key of ["master", "voice", "music", "sfx", "ambience", "ui"]) if (Number.isFinite(saved[key])) defaults[key] = Math.max(0, Math.min(1, saved[key]));
        defaults.muted = saved.muted && typeof saved.muted === "object" ? saved.muted : {};
        // CONFIG › 声音 › 自动混音 off is saved as duck: false (upstream's shape); on leaves no field.
        if (saved.duck === false) defaults.duck = false;
        // Only the former default follows the new default; custom levels and mutes survive. All in one write.
        const migrating = saved.musicLevelVersion !== 1 || saved.uiGainVersion !== 1 || saved.mixVersion !== 1;
        if (saved.musicLevelVersion !== 1) {
            if (saved.music === 0.8) defaults.music = 1;
            saved.music = defaults.music; saved.musicLevelVersion = 1;
        }
        if (saved.uiGainVersion !== 1) {
            if (Number.isFinite(saved.ui)) defaults.ui = Math.min(1, defaults.ui * 4);
            saved.ui = defaults.ui; saved.uiGainVersion = 1;
        }
        // A bus slider still at the former 0.8 default follows the new default 1.
        if (saved.mixVersion !== 1) {
            for (const key of ["voice", "sfx", "ambience"]) if (saved[key] === AUDIO_DEFAULT_LEVEL) { defaults[key] = 1; saved[key] = 1; }
            saved.mixVersion = 1;
        }
        if (migrating) storage.setItem("dsh-tavern-stage-audio", JSON.stringify(saved));
    } catch (_) {}
    return defaults;
}
const forkStageAudio = (function () {
    let storage = null;
    // Even reading the getter (including typeof) throws on opaque origins.
    try { storage = localStorage; } catch (_) {}
    const prefs = audioPreferences(storage);
    const snapshotOf = () => Object.freeze({ ...prefs, muted: Object.freeze({ ...prefs.muted }) });
    let snapshot = snapshotOf();
    const listeners = new Set(), nodes = new WeakMap(), active = new Set(), catalogue = new Map();
    const voiceGains = new WeakMap();
    function remember(item) {
        catalogue.delete(item.url); catalogue.set(item.url, item);
        for (const key of catalogue.keys()) {
            if (catalogue.size <= 1024) break;
            if (![...active].some(record => record.url === key)) catalogue.delete(key);
        }
    }
    function known(url) {
        const item = catalogue.get(url);
        if (item) { catalogue.delete(url); catalogue.set(url, item); }
        return item;
    }
    let context = null, master = null, output = null, buses = {}, previewBus = null;
    // Which ducking triggers sound now (AUDIO_DUCK): voice and call are set by their players, sfx follows the
    // stage SE elements playing on the sfx bus.
    const triggers = { call: false, voice: false, sfx: false, ambience: false };
    // The open stage skin's matrix (duckBy); the player's 自动混音 switch off (prefs.duck === false) holds every bus at 0 dB.
    let matrix = AUDIO_DUCK;
    const dipOf = layer => prefs.duck === false ? { db: 0, by: null } : audioDuckDb(layer, triggers, matrix);
    const voiceOwners = new Set();
    function voiceActivity(owner, on) {
        if (on) voiceOwners.add(owner); else voiceOwners.delete(owner);
        trigger("voice", voiceOwners.size > 0);
    }
    const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
    const volume = layer => prefs.muted[layer] ? 0 : prefs[layer];
    // An exclusive source (a full-screen entrance video's own soundtrack, `exclusive`) is the only one heard while it
    // sounds: every other source on every bus (BGM, ambience, voice, other SE, UI cues) holds at 0 under the user's levels,
    // which stay as they are; auditions are not stage sound. When it ends the others glide back in (BGM fades in).
    let solo = null;
    const held = record => solo !== null && solo !== record && !record.preview;
    // A running AudioContext keeps the device's audio hardware awake even in silence (a phone's battery). With nothing on the
    // mixer - no bound element playing, no buffer/stream source, no call, no recorder tap - it is suspended after a short
    // quiet; every source start resumes it first (ensure, or a bound element's play), so nothing is cut.
    // Playback that is about to sound again on its own (the stage's AUTO, a streaming round with voice) holds it awake too
    // (keepAwake): iOS Safari may refuse to resume a suspended context without a user gesture, which a timer-led next line lacks.
    let idleTimer = null, tapped = false;
    const awake = new Set();
    const busy = () => tapped || triggers.call || active.size > 0 || awake.size > 0;
    function settle() {
        clearTimeout(idleTimer); idleTimer = null;
        if (!context || busy() || context.state !== "running") return;
        idleTimer = setTimeout(() => { idleTimer = null; if (!busy() && context.state === "running") context.suspend().catch(() => {}); }, AUDIO_IDLE_SUSPEND_MS);
    }
    active.add = function (record) { Set.prototype.add.call(this, record); settle(); return this; };
    active.delete = function (record) { const had = Set.prototype.delete.call(this, record); if (had) settle(); return had; };
    function ensure() {
        if (context) { if (context.state === "suspended") context.resume().catch(() => {}); return context; }
        const Constructor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
        if (!Constructor) return null;
        try {
            if (typeof navigator !== "undefined" && navigator.audioSession) navigator.audioSession.type = "playback";
            context = new Constructor(); master = context.createGain(); master.gain.value = volume("master"); const foregroundGain = context.createGain(); master.connect(foregroundGain); foregroundGain.connect(context.destination);
            output = foregroundGain;
            if (typeof forkForeground !== "undefined") forkForeground.context(context, foregroundGain);
            for (const layer of Object.keys(AUDIO_TARGETS)) {
                const gain = context.createGain(), duck = context.createGain(), dip = dipOf(layer);
                gain.gain.value = volume(layer); duck.gain.value = Math.pow(10, dip.db / 20);
                gain.connect(duck); duck.connect(master); buses[layer] = { gain, duck, db: dip.db, by: dip.by, to: duck.gain.value };
            }
            previewBus = context.createGain(); previewBus.gain.value = 1; previewBus.connect(master);
            if (context.state === "suspended") context.resume().catch(() => {});
            context.addEventListener("statechange", settle);
        } catch (_) { context = null; }
        return context;
    }
    const installedHosts = new WeakSet();
    function install(host) {
        if (!host || !host.addEventListener || installedHosts.has(host)) return;
        const resume = () => { if (context && context.state === "suspended") context.resume().catch(() => {}); };
        installedHosts.add(host);
        host.addEventListener("pointerdown", resume, { passive: true });
        let disposed = false;
        return () => {
            if (disposed) return;
            disposed = true;
            host.removeEventListener("pointerdown", resume);
            installedHosts.delete(host);
        };
    }
    // One trigger changed: each bus glides to its new dip - down at the attack of the trigger now setting it, up after
    // the hold and at the release of the trigger that set it. cancelAndHoldAtTime keeps a glide in progress continuous.
    function retarget() {
        if (context) for (const layer of Object.keys(buses)) {
            const bus = buses[layer], dip = dipOf(layer);
            if (dip.db === bus.db) { bus.by = dip.by; continue; }
            const now = context.currentTime, deeper = dip.db < bus.db, time = AUDIO_DUCK_TIME[deeper ? dip.by : bus.by];
            bus.duck.gain.cancelAndHoldAtTime(now);
            bus.duck.gain.setTargetAtTime(Math.pow(10, dip.db / 20), deeper ? now : now + time.hold, deeper ? time.attack : time.release);
            bus.db = dip.db; bus.by = dip.by; bus.to = Math.pow(10, dip.db / 20);
        }
        active.forEach(record => { if (!record.gain) update(record); });
    }
    function trigger(name, on) { if (triggers[name] === on) return; triggers[name] = on; retarget(); if (name === "call") settle(); }
    const sounding = () => trigger("sfx", [...active].some(record => ["sfx", "ui"].includes(record.layer) && !record.preview));
    function measured(record) { return record.loudness || known(record.url)?.loudness || (record.layer === "voice" ? AUDIO_VOICE : undefined); }
    // an entry's authored 音量 (0..1) multiplies its normalized gain.
    const trimOf = value => Number.isFinite(value) ? clamp(value) : 1;
    // DEV DIAGNOSTICS (audio-trace.cjs): every start / stop / failure of a source on this mixer. Harnesses that
    // load the mixer alone have no trace.
    const mediaErrors = { 1: 'aborted', 2: 'network', 3: 'decode', 4: 'src-not-supported' };
    function trace(event, record, extra = {}) {
        if (typeof audioTrace === 'undefined' || !audioTrace) return;
        const loudness = measured(record), trackGain = (voiceGains.get(record.node) ?? audioGain(record.layer, loudness, record.gainDb)) * record.trim;
        const duration = record.node && Number.isFinite(record.node.duration) ? record.node.duration : extra.duration;
        // An element's media time: a start at its paused position is a resume, not a restart from 0.
        const position = record.node && Number.isFinite(record.node.currentTime) ? record.node.currentTime : undefined;
        audioTrace.record({ event, layer: record.layer, url: record.url, content: record.content, preview: record.preview, meta: record.trace,
            lufs: audioMeasurement(loudness) ? loudness.lufs : undefined, trackDb: trackGain > 0 ? 20 * Math.log10(trackGain) : undefined,
            trim: record.trim, duck: buses[record.layer] ? buses[record.layer].to : undefined, duration, position, error: extra.error });
    }
    const sourceLevel = record => held(record) ? 0 : (voiceGains.get(record.node) ?? audioGain(record.layer, measured(record), record.gainDb)) * record.trim;
    const level = record => sourceLevel(record) * (record.covered ? COVER_GAIN : 1);
    // ---- covered words (a stage line's text marks: speech.cjs covered, pack-playback.cjs maskAudio) ----
    // While a bound voice plays inside a span of a cover still shut (shares of its length, COVER_PAD s either side) it is
    // turned down to COVER_GAIN under the cover's noise, which sounds on the voice bus at the line's own level. A 20 ms
    // watch follows the element's own time, so a pause, the reading speed and a seek are followed as they happen. Each
    // play draws the noise from a fresh seed.
    const COVER_GAIN = 0.05, COVER_PAD = 0.15, COVER_GLIDE = 0.01, COVER_TICK_MS = 20;
    const covers = new Set();
    let coverTimer = null;
    function dropNoise(record) {
        if (!record.noise) return;
        try { record.noise.source.stop(); } catch (_) {}
        record.noise.source.disconnect(); record.noise.gain.disconnect(); record.noise = null;
    }
    function coverNoise(record) {
        if (record.noise || !record.cover.noise) return record.noise;
        const samples = record.cover.noise(context.sampleRate, Math.floor(Math.random() * 4294967296));
        const buffer = context.createBuffer(1, samples.length, context.sampleRate), source = context.createBufferSource(), gain = context.createGain();
        buffer.copyToChannel(samples, 0);
        source.buffer = buffer; source.loop = true; gain.gain.value = 0;
        source.connect(gain); gain.connect(buses.voice.gain); source.start();
        return record.noise = { source, gain };
    }
    function cover(record, inside, glide) {
        record.covered = inside; update(record, glide);
        const noise = inside ? coverNoise(record) : record.noise;
        if (!noise) return;
        const now = context.currentTime;
        noise.gain.gain.cancelScheduledValues(now); noise.gain.gain.setTargetAtTime(inside ? sourceLevel(record) : 0, now, glide);
    }
    function insideCover(record, at) {
        const length = record.node.duration;
        return Number.isFinite(length) && length > 0
            ? record.cover.spans.some(([from, to]) => at >= from * length - COVER_PAD && at <= to * length + COVER_PAD)
            : record.cover.spans.some(([from]) => from <= 0.02);
    }
    function watchCovers() {
        for (const record of covers) {
            if (record.released || record.node.ended) { covers.delete(record); cover(record, false, COVER_GLIDE); dropNoise(record); continue; }
            const inside = !record.node.paused && insideCover(record, record.node.currentTime);
            if (inside !== record.covered) cover(record, inside, COVER_GLIDE);
        }
        if (!covers.size) { clearInterval(coverTimer); coverTimer = null; }
    }
    function update(record, glide = 0.05) {
        if (record.released) return;
        const gain = level(record);
        if (record.gain) { record.gain.gain.cancelScheduledValues(context.currentTime); record.gain.gain.setTargetAtTime(gain, context.currentTime, glide); }
        else record.node.volume = 0;
    }
    function bind(node, layer, url, authored = {}) {
        if (typeof forkForeground !== "undefined") forkForeground.media(node);
        let record = nodes.get(node);
        if (record?.released) throw new Error("Cannot bind a released audio element; create a new element");
        if (!record) {
            record = { node, layer, url, envelope: node.volume, gain: null, gainDb: authored.gainDb ?? 0, loudness: authored.loudness, trim: trimOf(authored.volume), released: false, preview: Boolean(authored.preview), trace: authored.trace }; nodes.set(node, record);
            if (ensure()) {
                try { const source = context.createMediaElementSource(node), gain = context.createGain(); source.connect(gain); gain.connect(authored.preview ? previewBus : buses[layer].gain); record.source = source; record.gain = gain; gain.gain.value = level(record); }
                catch (error) { node.muted = true; throw error; }
            }
            if (!record.gain) { node.muted = true; throw new Error("Audio mixer unavailable"); }
            const activate = () => { if (!record.released) { active.add(record); update(record); sounding(); trace('start', record); } };
            const deactivate = (event, extra) => { active.delete(record); sounding(); trace(event, record, extra); };
            record.handlers = { play: activate, pause: () => deactivate('stop'), ended: () => deactivate('end'),
                error: () => deactivate('fail', { error: mediaErrors[node.error?.code] || 'media-error' }) };
            for (const [event, handler] of Object.entries(record.handlers)) node.addEventListener(event, handler);
            // A refused play() (autoplay policy, an interrupted load) never fires a media event: trace it here.
            const play = node.play;
            if (typeof play === 'function') node.play = function () {
                const args = arguments, start = () => {
                    const result = play.apply(node, args);
                    if (result && typeof result.catch === 'function') result.catch(error => trace('fail', record, { error: (error && error.name) || 'play-rejected' }));
                    return result;
                };
                // An idle-suspended mixer wakes before the element starts, so its first syllable is heard.
                return context.state === "suspended" ? context.resume().then(start, start) : start();
            };
        }
        if (record.layer !== layer && !record.preview) { if (record.gain) { record.gain.disconnect(); record.gain.connect(buses[layer].gain); } record.layer = layer; }
        if (typeof forkForeground !== "undefined") forkForeground.media(node, Boolean(record.source));
        // A reused element (the music crossfade pair) takes the volume of the track it now plays.
        if (Object.hasOwn(authored, 'loudness') || record.url !== url) record.loudness = authored.loudness;
        if (Object.hasOwn(authored, 'gainDb') || record.url !== url) record.gainDb = authored.gainDb ?? 0;
        const changed = record.url !== url;
        if (Object.hasOwn(authored, 'trace')) record.trace = authored.trace;
        record.url = url; record.content = audioContentKey(authored.identity); record.trim = trimOf(authored.volume); if (!node.paused) active.add(record); update(record); sounding();
        if (changed && !node.paused) trace('change', record);
        return record;
    }
    function save() {
        snapshot = snapshotOf();
        try { localStorage.setItem("dsh-tavern-stage-audio", JSON.stringify(prefs)); } catch (_) {}
        retarget();
        if (context) { master.gain.setTargetAtTime(volume("master"), context.currentTime, 0.015); for (const layer of Object.keys(buses)) buses[layer].gain.gain.setTargetAtTime(volume(layer), context.currentTime, 0.015); }
        active.forEach(record => update(record)); listeners.forEach(fn => fn());
    }
    return {
        install,
        musicContext: ensure,
        // owner (any value) holds the mixer awake while on; the context wakes now if it was asleep (the toggle is usually a tap).
        keepAwake(owner, on) {
            if (on) { awake.add(owner); if (context && context.state === "suspended") context.resume().catch(() => {}); } else awake.delete(owner);
            settle();
        },
        // External buffer/oscillator players own their sources, never their output destination.
        bufferInput(layer, { loudness, gainDb = 0, volume: trim = 1, trace: meta, url = "", duration } = {}) {
            const ctx = ensure(); if (!ctx) return null;
            const input = ctx.createGain();
            const record = { node: input, layer, url, envelope: 1, gain: input, gainDb, trim: trimOf(trim), loudness, released: false, trace: meta };
            input.gain.value = level(record);
            input.connect(buses[layer].gain); active.add(record); sounding(); trace('start', record, { duration });
            return { context: ctx, input, release() { record.released = true; active.delete(record); input.disconnect(); sounding(); } };
        },
        // Buffer music uses the same normalization/duck/mute buses, with its own fade envelope.
        // identity: the track's media identity; its sha256 keys the measurement kept on this machine. loudness: the entry's
        // install-time measurement; a track carrying it is never measured here.
        // meta, duration: the trace's source (audio-trace.cjs) and the decoded length.
        musicVoice(url, volume, identity, loudness, meta, duration) {
            const ctx = ensure(), input = ctx.createGain(), envelope = ctx.createGain(), gain = ctx.createGain(), key = audioContentKey(identity);
            const record = {node:input,layer:'music',url,content:key,envelope:0,gain,gainDb:0,trim:trimOf(volume),loudness:audioMeasurement(loudness) ? loudness : known(url)?.loudness,released:false,trace:meta};
            input.connect(envelope); envelope.connect(gain); gain.connect(buses.music.gain);
            envelope.gain.value = 0; active.add(record); update(record); trace('start', record, { duration });
            let analyser = null;
            return {
                input,
                // The player's own pause / resume of this track.
                mark(event) { if (!record.released) trace(event, record, { duration }); },
                level(value) { if (value === undefined) return record.envelope; record.envelope = value; envelope.gain.setValueAtTime(value,ctx.currentTime); },
                trim(value) { record.trim = trimOf(value); update(record); },
                analyser() { if (!analyser) { analyser = ctx.createAnalyser(); input.connect(analyser); } return analyser; },
                release() { if (!record.released) trace('stop', record, { duration }); record.released = true; active.delete(record); input.disconnect(); envelope.disconnect(); gain.disconnect(); analyser?.disconnect(); }
            };
        },
        // The trace of a source that failed before it reached the mixer (a BGM fetch or decode).
        traceFailure(layer, url, meta, error) { trace('fail', { node: null, layer, url, gainDb: 0, trim: 1, trace: meta }, { error }); },
        // a voice played as Web Audio buffers the moment they arrive
        // (no media element start-up buffer). The handle stands where a voice element would (lip-sync analyser, mixer
        // voice bus at the nominal speech level or the line's loudness); its owner keeps `paused` and `currentTime`.
        voiceStream(loudness, meta) {
            const ctx = ensure(); if (!ctx) return null;
            const input = ctx.createGain(), gain = ctx.createGain();
            const handle = { input, context: ctx, paused: true, ended: false, muted: false, volume: 1, currentTime: 0 };
            if (loudness) voiceGains.set(handle, loudness.gain);
            const record = { node: handle, layer: "voice", url: "", envelope: 1, gain, gainDb: 0, trim: 1, released: false, source: input, handlers: {}, trace: meta };
            input.connect(gain); gain.connect(buses.voice.gain); nodes.set(handle, record); active.add(record); update(record); trace('start', record);
            return handle;
        },
        // a sound the call synthesizes itself, on the voice bus with
        // her voice (audio-mix: the call is one source, never ducked by its own trigger; voice slider, mute and master apply);
        // the caller disconnects `input` when done.
        callInput(meta) {
            const ctx = ensure(); if (!ctx) return null;
            const input = ctx.createGain(); input.connect(buses.voice.gain);
            trace('start', { node: null, layer: 'voice', url: '', gainDb: 0, trim: 1, trace: meta });
            return { context: ctx, input };
        },
        // The measured level of a streamed voice (dsh-tavern-tts loudness: the line's own, or its voice's estimate while it
        // streams): the handle's gain glides to it.
        voiceLevel(handle, loudness) {
            const record = nodes.get(handle);
            if (!record || record.released || !loudness || voiceGains.get(handle) === loudness.gain) return;
            voiceGains.set(handle, loudness.gain); update(record);
        },
        // a phone call, from dialling (its ringback) to hang-up, ducks every bus below the voice.
        call(on) { trigger("call", Boolean(on)); },
        // A bound element becomes (on) or stops being (off) the one source heard; see `solo`. Silencing is quick, the return
        // a ~1 s glide. Releasing the element ends its exclusivity too.
        exclusive(node, on) {
            const record = nodes.get(node);
            if (on ? !record || record.released || solo === record : !record || solo !== record) return;
            solo = on ? record : null;
            active.forEach(other => { if (other !== record) update(other, on ? 0.015 : AUDIO_EXCLUSIVE_RETURN); });
        },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        get() { return { ...prefs, muted: { ...prefs.muted } }; },
        getSnapshot() { return snapshot; },
        // Read-only evidence for read-only diagnostics, which evaluates under V8's side-effect check: plain closure reads
        // only (no AudioParam/AudioContext getters, no cache touch, no storage). Gains are the mixer's settled targets.
        diagnostics() {
            const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
            const duck = layer => buses[layer] ? buses[layer].to : Math.pow(10, dipOf(layer).db / 20);
            const tracks = [...active].filter(record => !record.preview && !record.released).slice(0, 16).map(record => {
                const loudness = record.loudness || catalogue.get(record.url)?.loudness || (record.layer === "voice" ? AUDIO_VOICE : undefined);
                // trackGain = loudness normalization x the entry's authored volume; effective adds envelope, layer, duck and master.
                const trackGain = (voiceGains.get(record.node) ?? audioGain(record.layer, loudness, record.gainDb)) * record.trim;
                const effective = held(record) ? 0 : trackGain * record.envelope * volume(record.layer) * duck(record.layer) * volume("master");
                const known = audioMeasurement(loudness);
                return { layer: record.layer, content: record.content ? record.content.slice(0, 12) : null, measured: known ? { lufs: loudness.lufs, peak: loudness.peak } : null, trim: record.trim,
                    envelope: round(record.envelope, 4), trackGain: round(trackGain, 4), trackGainDb: trackGain > 0 ? round(20 * Math.log10(trackGain), 2) : null,
                    duck: round(duck(record.layer), 4), effective: round(effective, 4), effectiveDb: effective > 0 ? round(20 * Math.log10(effective), 2) : null,
                    outputLufs: known && effective > 0 ? round(loudness.lufs + 20 * Math.log10(effective), 2) : null };
            });
            // Plain copies: object spread trips the side-effect check.
            const levels = { muted: {} };
            for (const layer of ["master", "voice", "music", "sfx", "ambience", "ui"]) { levels[layer] = prefs[layer]; levels.muted[layer] = Boolean(prefs.muted[layer]); }
            const ducking = {};
            for (const layer of Object.keys(AUDIO_TARGETS)) ducking[layer] = buses[layer] ? { db: buses[layer].db, by: buses[layer].by } : dipOf(layer);
            return { context: Boolean(context), exclusive: solo ? solo.layer : null, speaking: triggers.voice, call: triggers.call, sfx: triggers.sfx, ducking, prefs: levels, tracks };
        },
        // CONFIG › 声音 › 自动混音: off is stored as duck: false, on drops the field; buses glide to the new dips.
        setDucking(on) { if (on) delete prefs.duck; else prefs.duck = false; save(); },
        // The open stage skin's `duck` (null: the engine's amounts).
        duckBy(skin) { matrix = audioDuckMatrix(skin); retarget(); },
        setVolume(layer, value) { if (!Object.hasOwn(prefs, layer) || layer === "muted" || layer === "v" || layer === "duck") return; prefs[layer] = clamp(value); prefs.muted[layer] = false; save(); },
        toggleMute(layer) { prefs.muted[layer] = !prefs.muted[layer]; save(); },
        register(items) {
            for (const item of items) if (item.url) {
                const previous = known(item.url);
                if (!audioMeasurement(item.loudness) && audioMeasurement(previous?.loudness)) continue;
                remember(item);
            }
            active.forEach(record => update(record));
        }, bind,
        // Terminal opt-in teardown. Retain the WeakMap tombstone: a media element may only
        // have one MediaElementSource, even after that source has been disconnected.
        // Covered words over a bound voice about to play: cover {spans: [[from, to]] shares of its length, noise(sampleRate,
        // seed) -> Float32Array}, or null to hear it as is. A cover over the line's first words holds from its first sample.
        mask(node, value) {
            const record = nodes.get(node);
            if (!record || record.released || !record.gain) return;
            dropNoise(record); record.cover = value?.spans?.length ? value : null;
            if (!record.cover) { covers.delete(record); if (record.covered) cover(record, false, COVER_GLIDE); return; }
            covers.add(record); coverTimer ||= setInterval(watchCovers, COVER_TICK_MS);
            cover(record, insideCover(record, node.ended ? 0 : node.currentTime), 0.001);
        },
        release(node) {
            const record = nodes.get(node);
            if (!record || record.released) return;
            covers.delete(record); dropNoise(record);
            if (active.has(record)) trace('stop', record);
            if (solo === record) { solo = null; active.forEach(other => { if (other !== record) update(other, AUDIO_EXCLUSIVE_RETURN); }); }
            record.released = true; active.delete(record); voiceActivity(node, false); sounding();
            if (typeof node.removeEventListener === "function") {
                for (const [event, handler] of Object.entries(record.handlers)) node.removeEventListener(event, handler);
            }
            for (const part of [record.source, record.analyser, record.filter, record.gain]) {
                if (part) { try { part.disconnect(); } catch (_) {} }
            }
            record.filterActive = false;
        },
        // retune a bound element's authored 音量 (an edit while it plays).
        trim(node, value) {
            const record = nodes.get(node);
            if (!record || record.released || record.trim === trimOf(value)) return;
            record.trim = trimOf(value); update(record);
        },
        // Auditions share the master output but neither trigger nor receive stage ducking.
        preview(node, loudness, layer = "voice", authored = {}) {
            if (Number.isFinite(loudness?.gain)) voiceGains.set(node, loudness.gain);
            return bind(node, layer, node.src, { trace: { reason: "preview" }, ...authored, loudness, preview: true });
        },
        audible(node) { return prefs.master > 0 && !prefs.muted.master && (nodes.get(node)?.preview || prefs.voice > 0 && !prefs.muted.voice); },
        prepareVoice(node, blob, loudness, meta) {
            if (Number.isFinite(loudness?.gain)) voiceGains.set(node, loudness.gain);
            bind(node, "voice", node.src, {loudness, trace: meta || { reason: "voice" }});
        },        wake() { ensure(); },
        analyser(node) {
            const record = nodes.get(node) || bind(node, "voice", node.src);
            if (record.released || !record.source) return null;
            if (!record.analyser) {
                record.analyser = context.createAnalyser(); record.analyser.fftSize = 1024;
                record.source.disconnect(); record.source.connect(record.analyser); record.analyser.connect(record.filterActive ? record.filter : record.gain);
            }
            return record.analyser;
        },
        // Opt-in only: source -> optional analyser -> optional lowpass -> normalization -> bus.
        // Never create a second MediaElementSource or disturb the existing envelope/duck chain.
        filter(node, cutoffHz) {
            const record = nodes.get(node);
            if (!record || record.released || !record.source || !record.gain) return false;
            if (cutoffHz != null && (!Number.isFinite(cutoffHz) || cutoffHz < 0)) return false;
            const upstream = record.analyser || record.source;
            if (!cutoffHz) {
                if (record.filterActive) {
                    upstream.disconnect(); record.filter.disconnect(); upstream.connect(record.gain);
                    record.filterActive = false;
                }
                return true;
            }
            if (!record.filter) {
                if (typeof context.createBiquadFilter !== "function") return false;
                record.filter = context.createBiquadFilter(); record.filter.type = "lowpass";
                record.filter.Q.value = 0;
            }
            if (!record.filterActive) {
                const frequency = record.filter.frequency, time = context.currentTime;
                if (typeof frequency.cancelScheduledValues === "function") frequency.cancelScheduledValues(time);
                if (typeof frequency.setValueAtTime === "function") frequency.setValueAtTime((context.sampleRate || 48000) / 2, time);
                else frequency.value = (context.sampleRate || 48000) / 2;
                upstream.disconnect(); upstream.connect(record.filter); record.filter.connect(record.gain);
                record.filterActive = true;
            }
            const frequency = record.filter.frequency, time = context.currentTime;
            const cutoff = Math.max(20, Math.min((context.sampleRate || 48000) / 2, cutoffHz));
            if (typeof frequency.setTargetAtTime === "function") {
                // Hold an in-progress target where supported before retargeting it.
                if (typeof frequency.cancelAndHoldAtTime === "function") frequency.cancelAndHoldAtTime(time);
                else if (typeof frequency.cancelScheduledValues === "function") frequency.cancelScheduledValues(time);
                frequency.setTargetAtTime(cutoff, time, 0.05);
            } else frequency.value = cutoff;
            return true;
        },
        level(node, value) {
            const record = nodes.get(node);
            if (value === undefined) return record ? record.envelope : node.volume;
            if (record?.released) return;
            if (!record) { node.volume = clamp(value); return; }
            record.envelope = clamp(value);
            if (record.gain) node.volume = record.envelope; else update(record);
        },
        voice(activeVoice) { voiceActivity("stage", Boolean(activeVoice)); },
        voiceActivity,
        // System speech has no PCM output; its API only permits a 0..1 utterance volume.
        speechVolume(preview = false) { return volume("master") * (preview ? 1 : solo ? 0 : volume("voice")); },
        // Measurement only: the graph points a recorder taps - the output after the
        // master and foreground gains, and each bus after its dip. Connecting to them never changes what is heard.
        taps() { if (!ensure()) return null; tapped = true; settle(); const after = {}; for (const layer of Object.keys(buses)) after[layer] = buses[layer].duck; return { context, output, buses: after }; }
    };
})();
try { if (typeof window !== "undefined" && window) {
    window.forkStageAudioDiagnostics = () => forkStageAudio.diagnostics();
    window.forkStageAudioTaps = () => forkStageAudio.taps();
    window.forkStageAudioMaintenance = ({master, muted = false}) => {
        if (!Number.isFinite(master) || master < 0 || master > 1 || typeof muted !== "boolean") throw new Error("Invalid master volume");
        forkStageAudio.setVolume("master", master);
        if (muted) forkStageAudio.toggleMute("master");
        return forkStageAudio.get();
    };
} } catch (_) {}
function useStageAudioState() {
    const [, redraw] = React.useState(0);
    React.useEffect(() => forkStageAudio.subscribe(() => redraw(n => n + 1)), []);
    return forkStageAudio.get();
}
// the old top-bar mixer sliders were removed (the stage mixer is gal-mixer.js).
