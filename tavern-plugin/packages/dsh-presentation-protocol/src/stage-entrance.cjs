'use strict';
// the inert dsh.entrance/1 contract of
// the 入场演出 asset kind (`entrances`), shared by the pack importer (validation once, on write) and the stage (timeline).
// The engine draws a closed set of generic procedural primitives (a light point with dust and filaments, rings, a radial
// tunnel with streams, caustic walls, glass shards and an oil-film sheen, a flare, a white cover; over them a water pass:
// a refracting glass orb, thin liquid sheets that tear apart, near foam shards, a water lump, droplets in depth and a
// particle spray of fine droplets; a baked plate - an offline-rendered image sequence of real fluid with its coverage and the
// refraction it applies to what is behind, composited over the scene); a video - a 视频 entry of the same pack (stage-video.cjs),
// played by the stage's video player above all of it on the timeline's own clock; and a post stage with bloom and light shafts. The
// document carries every work-specific value - colours, timings, intensities, shapes, the plate's frames. Nothing here names
// a work.
// Timeline: phases play in order. A `hold` phase loops while the stage is still loading and is skipped once it is ready;
// at the end of the `cover` phase the screen is covered (the stage is revealed under it) and the timeline waits there
// until the stage reports it is shown; the phases after it hand off (their `fade` track ends at 0). A click after the load
// is the engine's one skip for every entrance: the timeline freezes on the frame it shows (no seek,
// never its designed ending) and the stage takes the skip through black (stage entrance presenter). Reduced motion shows one still
// frame and fades it out (reducedMs) once the stage is ready. 光敏保护 caps the cover's white and the flare at half.
// stageEntranceContract() is self-contained (no outer references) so the stage can ship it to its render worker as text.
function stageEntranceContract() {
    const SCHEMA = 'dsh.entrance/1';
    // track: [default, min, max, layer it drives (null: the camera / compositor)]
    const TRACKS = {
        light: [0, 0, 8, 'light'], lightSize: [1, 0, 40, 'light'], lightMix: [0, 0, 1, 'light'], lightEdge: [0, 0, 1, 'light'], lightDisc: [0, 0, 8, 'light'],
        dust: [0, 0, 8, 'dust'], filaments: [0, 0, 8, 'filaments'],
        rings: [0, 0, 8, 'rings'], ringSize: [1, 0, 20, 'rings'],
        streams: [0, 0, 8, 'streams'], walls: [0, 0, 8, 'walls'], caustics: [0, 0, 8, 'caustics'],
        shards: [0, 0, 8, 'shards'], shardSize: [1, 0, 20, 'shards'],
        film: [0, 0, 8, 'film'], flare: [0, 0, 8, 'flare'], aberration: [0, 0, 8, 'aberration'],
        orb: [0, 0, 8, 'orb'], orbSize: [1, 0, 20, 'orb'], liquid: [0, 0, 8, 'liquid'], liquidSize: [1, 0, 40, 'liquid'],
        splash: [0, 0, 8, 'splash'], splashSize: [1, 0, 40, 'splash'], droplets: [0, 0, 8, 'droplets'],
        spray: [0, 0, 8, 'spray'], spraySize: [1, 0, 20, 'spray'], lump: [0, 0, 8, 'lump'], lumpSize: [1, 0, 20, 'lump'], lumpX: [0, -1, 1, 'lump'], lumpY: [0, -1, 1, 'lump'],
        // plate: its strength; plateRate: playback speed (1 = the sequence's fps; the frame advances only while it is > 0).
        plate: [0, 0, 8, 'plate'], plateRate: [0, 0, 4, 'plate'], bloom: [0, 0, 8, 'bloom'], shafts: [0, 0, 8, 'shafts'],
        // video: its opacity over the drawn layers (times the fade); videoRate: playback speed (its clock advances only while > 0).
        video: [0, 0, 1, 'video'], videoRate: [0, 0, 4, 'video'],
        speed: [0, -8, 40, null], spin: [0, -8, 8, null], zoom: [0, -2, 6, null], blur: [0, 0, 1, null], panX: [0, -1, 1, null], panY: [0, -1, 1, null],
        exposure: [1, 0, 8, null], flash: [0, 0, 1, 'flash'], fade: [1, 0, 1, null]
    };
    // layer field: 'color!' a required palette name, 'color' an optional one, 'path!' a required bundle folder, 'id!' a required entry id,
    // 'flag' an optional true / false,
    // [min, max, required, integer] a number.
    const LAYERS = {
        light: { color: 'color!', core: 'color', disc: 'color', discSize: [0.5, 4] /* the disc's radius over the core's */, radius: [0.001, 0.5, true], halo: [0.01, 4], lobes: [0, 1] },
        dust: { color: 'color!', density: [0, 1, true], size: [0.1, 8], trail: [0, 8], cluster: [0, 1], spread: [0, 8] },
        filaments: { color: 'color!', density: [0, 1, true], curl: [0, 4], width: [0.1, 8], length: [0.05, 1] },
        rings: { color: 'color!', radius: [0.01, 2, true], width: [0.001, 0.5, true], count: [1, 4, false, true] },
        streams: { color: 'color!', count: [4, 512, true, true], length: [0.01, 4], width: [0.1, 8] },
        walls: { color: 'color!', deep: 'color', scale: [0.1, 16] },
        caustics: { color: 'color!', scale: [0.1, 32] },
        shards: { color: 'color!', edge: 'color!', density: [0, 1, true], scale: [0.1, 16], warp: [0, 2], fill: [0, 1] },
        film: { scale: [0.1, 16], saturation: [0, 2], coverage: [0, 1] },
        flare: { color: 'color!', rays: [0, 32, false, true] },
        // The water pass. liquid: translucent sheets with holes (tear: their edges break into filaments and droplets,
        // more the nearer they fly; opacity: how much body colour against the light through them; layers: sheets at 1..3
        // depths - the sheets, a nearer thinner one, fine debris behind; foam: white patches; crinkle: fine glinting
        // ripples; lean/angle: the share of water thrown toward one screen direction, in degrees, 0 = right, 90 = up);
        // splash: thin ribbons near the lens (same fields; foam turns them white and crumpled, cells into a sheet blown
        // full of holes that breaks into pointed shards); droplets: depth
        // layers around a focal depth (bokeh = circle of confusion, trail = motion streaks); spray: `count` particles thrown
        // out of the focus (start: spawn radius, speed: log-radius per second, life: seconds; size in px at 1080 with a
        // power-law spread; fall: shrink along the path as they break up; mist: the share kept as a fine slow cloud near
        // the focus; streak: motion blur of the fast ones; bokeh: the share out of focus near the lens); lump: a crumpled
        // refracting water body at x, y (frame heights from the focus, y up; the lumpX / lumpY tracks move it from there).
        orb: { color: 'color!', radius: [0.01, 1, true], refraction: [0, 2], glitter: [0, 1] },
        liquid: { color: 'color!', edge: 'color!', density: [0, 1, true], scale: [0.1, 16], detail: [0, 1], gloss: [0, 4], refraction: [0, 2], spread: [0, 1],
            tear: [0, 1], opacity: [0, 1], layers: [1, 3, false, true], foam: [0, 1], crinkle: [0, 1], lean: [0, 1], angle: [-180, 180] },
        splash: { color: 'color!', edge: 'color!', density: [0, 1, true], scale: [0.1, 16], detail: [0, 1], gloss: [0, 4], refraction: [0, 2], spread: [0, 1],
            tear: [0, 1], opacity: [0, 1], foam: [0, 1], crinkle: [0, 1], cells: [0, 1], lean: [0, 1], angle: [-180, 180] },
        droplets: { color: 'color!', glint: 'color', density: [0, 1, true], size: [0.1, 8], focus: [0, 1], bokeh: [0, 4], trail: [0, 8] },
        spray: { color: 'color!', glint: 'color', count: [16, 16384, true, true], size: [0.1, 8], fall: [0, 4], speed: [0.05, 8], start: [0, 1], life: [0.1, 8],
            spread: [0, 1], lean: [0, 1], angle: [-180, 180], streak: [0, 8], bokeh: [0, 1], mist: [0, 1], clump: [0, 1] },
        lump: { color: 'color!', edge: 'color!', radius: [0.01, 1, true], x: [-1, 1], y: [-1, 1], wobble: [0, 1], refraction: [0, 2] },
        // plate: a baked image sequence (frames <dir>/color-0001.webp ..., top row first, 16:9, covering the frame like the
        // scene): RGB the light the plate adds, stored as L / (1 + L) so it carries HDR highlights; alpha its coverage (the
        // share of what is behind that it holds back). With `shift`, <dir>/shift-0001.webp holds where each pixel looks
        // through the plate: a grey image of two halves side by side (x then y offset, frame heights, 0.5 = none, 0 / 1 =
        // -shift / +shift), so the live scene behind is refracted by the baked shapes. tint: the colour of what shows through
        // thick coverage; parallax: how far the plate follows the camera pan (1 = with the focus); exposure scales its light.
        plate: { dir: 'path!', frames: [1, 240, true, true], fps: [1, 60, true], shift: [0.005, 1], tint: 'color', refraction: [0, 4], exposure: [0, 8], parallax: [0, 2] },
        // Post: bloom - the glow of everything brighter than threshold (0..1 of the tone-mapped image), radius in frame heights;
        // shafts - light scattered toward the camera from bright areas around the focus, held back by whatever covers them.
        // video: the 视频 entry (asset: its id in this pack) played over everything drawn, at the video track's opacity and on the
        // timeline's video clock (it holds its last frame unless the entry loops); audio: true plays its soundtrack through the stage
        // mixer (default: silent). It degrades to the entry's poster, then to the drawn layers, and never holds the stage.
        video: { asset: 'id!', audio: 'flag' },
        bloom: { amount: [0, 4, true], threshold: [0, 1], radius: [0.005, 0.5], color: 'color' },
        shafts: { amount: [0, 4, true], length: [0.05, 1], threshold: [0, 1], color: 'color' },
        grain: { amount: [0, 0.5, true] },
        vignette: { amount: [0, 1, true], color: 'color' },
        aberration: { amount: [0, 0.05, true] },
        flash: { color: 'color!' }
    };
    const FIELDS = ['schema', 'label', 'background', 'focus', 'palette', 'layers', 'phases', 'skip', 'still', 'holdBlendMs', 'reducedMs', 'sfx'];
    const REQUIRED = ['schema', 'background', 'focus', 'palette', 'layers', 'phases', 'skip', 'still'];
    const PHOTOSENSITIVE_PEAK = 0.5, PHOTOSENSITIVE_RISE_MS = 80;
    const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const isId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
    const isColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    function fail(path, message) { throw Object.assign(new TypeError(path + ': ' + message), { code: 'INVALID_ASSET_PACK', path }); }
    function check(ok, path, message) { if (!ok) fail(path, message); }
    function shape(value, fields, required, path) {
        check(isObject(value), path, 'expected an object');
        for (const key of Object.keys(value)) check(fields.includes(key), path + '.' + key, 'unknown field');
        for (const key of required) check(Object.hasOwn(value, key), path + '.' + key, 'required');
    }
    function number(value, min, max, path, integer) {
        check(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), path,
            'expected ' + (integer ? 'an integer' : 'a number') + ' in ' + min + '..' + max);
    }
    function track(keys, name, path, hold) {
        const [, min, max] = TRACKS[name];
        check(Array.isArray(keys) && keys.length >= 1 && keys.length <= 32, path, 'expected 1..32 [t, value] keys');
        keys.forEach((key, i) => {
            check(Array.isArray(key) && key.length === 2, path + '[' + i + ']', 'expected [t, value]');
            number(key[0], 0, 1, path + '[' + i + '][0]'); number(key[1], min, max, path + '[' + i + '][1]');
            if (i) check(key[0] > keys[i - 1][0], path + '[' + i + '][0]', 'times must increase');
        });
        // A loop is seamless: it ends where it starts.
        if (hold) check(keys[0][1] === keys[keys.length - 1][1], path, 'a hold phase track must end on its first value');
    }
    function validateStageEntrance(doc) {
        shape(doc, FIELDS, REQUIRED, '$');
        check(doc.schema === SCHEMA, '$.schema', 'expected ' + SCHEMA);
        if (doc.label !== undefined) check(typeof doc.label === 'string' && doc.label.trim().length > 0 && doc.label.length <= 80, '$.label', 'expected 1..80 characters');
        check(isObject(doc.palette) && Object.keys(doc.palette).length >= 1 && Object.keys(doc.palette).length <= 24, '$.palette', 'expected 1..24 named colours');
        for (const [name, color] of Object.entries(doc.palette)) { check(isId(name), '$.palette.' + name, 'invalid name'); check(isColor(color), '$.palette.' + name, 'expected #rrggbb'); }
        const paletteName = (value, path) => check(typeof value === 'string' && Object.hasOwn(doc.palette, value), path, 'expected a palette name');
        paletteName(doc.background, '$.background');
        check(Array.isArray(doc.focus) && doc.focus.length === 2, '$.focus', 'expected [x, y]');
        doc.focus.forEach((value, i) => number(value, 0, 1, '$.focus[' + i + ']'));
        check(isObject(doc.layers), '$.layers', 'expected an object');
        for (const [name, layer] of Object.entries(doc.layers)) {
            const spec = LAYERS[name], path = '$.layers.' + name;
            check(!!spec && Object.hasOwn(LAYERS, name), path, 'unknown layer');
            shape(layer, Object.keys(spec), Object.keys(spec).filter(key => ['color!', 'path!', 'id!'].includes(spec[key]) || Array.isArray(spec[key]) && spec[key][2]), path);
            for (const [key, value] of Object.entries(layer)) {
                if (spec[key] === 'id!') check(isId(value), path + '.' + key, 'expected an entry id');
                else if (spec[key] === 'flag') check(typeof value === 'boolean', path + '.' + key, 'expected true or false');
                else if (spec[key] === 'path!') check(typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}(\/[a-z0-9][a-z0-9_-]{0,63}){0,3}$/.test(value), path + '.' + key, 'expected a relative folder (lower-case names, /)');
                else if (typeof spec[key] === 'string') paletteName(value, path + '.' + key);
                else number(value, spec[key][0], spec[key][1], path + '.' + key, spec[key][3]);
            }
        }
        check(Array.isArray(doc.phases) && doc.phases.length >= 2 && doc.phases.length <= 16, '$.phases', 'expected 2..16 phases');
        const ids = new Set();
        let cover = -1, hold = -1;
        doc.phases.forEach((phase, i) => {
            const path = '$.phases[' + i + ']';
            shape(phase, ['id', 'ms', 'hold', 'cover', 'tracks'], ['id', 'ms'], path);
            check(isId(phase.id) && !ids.has(phase.id), path + '.id', 'expected a unique short id'); ids.add(phase.id);
            number(phase.ms, 1, 20000, path + '.ms', true);
            for (const flag of ['hold', 'cover']) if (phase[flag] !== undefined) check(phase[flag] === true, path + '.' + flag, 'set true or omit');
            if (phase.hold) { check(hold < 0, path + '.hold', 'only one hold phase'); hold = i; }
            if (phase.cover) { check(cover < 0, path + '.cover', 'only one cover phase'); cover = i; }
            if (phase.tracks !== undefined) {
                check(isObject(phase.tracks), path + '.tracks', 'expected an object');
                for (const [name, keys] of Object.entries(phase.tracks)) {
                    check(Object.hasOwn(TRACKS, name), path + '.tracks.' + name, 'unknown track');
                    const layer = TRACKS[name][3];
                    check(!layer || Object.hasOwn(doc.layers, layer), path + '.tracks.' + name, 'needs layers.' + layer);
                    track(keys, name, path + '.tracks.' + name, phase.hold === true);
                }
            }
        });
        check(cover >= 0, '$.phases', 'one phase must be the cover');
        check(cover < doc.phases.length - 1, '$.phases[' + cover + '].cover', 'a handoff phase must follow the cover');
        check(hold < 0 || hold < cover, '$.phases[' + hold + '].hold', 'the hold phase must come before the cover');
        check(Object.hasOwn(doc.layers, 'flash'), '$.layers.flash', 'required: the cover is drawn with it');
        // The last phase hands the screen to the stage: its opacity ends at 0.
        const last = doc.phases[doc.phases.length - 1], fade = last.tracks && last.tracks.fade;
        check(!!fade && fade[fade.length - 1][1] === 0, '$.phases[' + (doc.phases.length - 1) + '].tracks.fade', 'the last phase must fade out to 0');
        // skip: no longer read ; still checked so the installed documents stay
        // valid until they are migrated without it.
        shape(doc.skip, ['flashMs', 'handoffMs'], ['flashMs', 'handoffMs'], '$.skip');
        number(doc.skip.flashMs, PHOTOSENSITIVE_RISE_MS, 2000, '$.skip.flashMs', true);
        number(doc.skip.handoffMs, 100, 5000, '$.skip.handoffMs', true);
        shape(doc.still, ['phase', 'at'], ['phase', 'at'], '$.still');
        check(ids.has(doc.still.phase) && doc.phases.findIndex(phase => phase.id === doc.still.phase) < cover, '$.still.phase', 'expected a phase before the cover');
        number(doc.still.at, 0, 1, '$.still.at');
        if (doc.holdBlendMs !== undefined) number(doc.holdBlendMs, 0, 3000, '$.holdBlendMs', true);
        if (doc.reducedMs !== undefined) number(doc.reducedMs, 100, 3000, '$.reducedMs', true);
        // Reserved sound slot: phase id -> an sfx entry of the same pack. Not played yet.
        if (doc.sfx !== undefined) {
            check(isObject(doc.sfx), '$.sfx', 'expected an object');
            for (const [phase, id] of Object.entries(doc.sfx)) { check(ids.has(phase), '$.sfx.' + phase, 'unknown phase'); check(isId(id), '$.sfx.' + phase, 'expected an sfx entry id'); }
        }
        check(JSON.stringify(doc).length <= 16384, '$', 'document exceeds 16 KiB');
        return doc;
    }

    // ---- timeline (pure; the stage and the tests drive it with fixed or real time steps) ----
    const smooth = x => x * x * (3 - 2 * x);
    function trackAt(keys, f) {
        if (f <= keys[0][0]) return keys[0][1];
        for (let i = 1; i < keys.length; i++) if (f <= keys[i][0]) {
            const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
            return v0 + (v1 - v0) * smooth((f - t0) / (t1 - t0));
        }
        return keys[keys.length - 1][1];
    }
    // The raw values of a phase at fraction f; tracks it does not name take their defaults.
    function phaseValues(doc, index, f) {
        const tracks = doc.phases[index].tracks || {}, values = {};
        for (const name of Object.keys(TRACKS)) values[name] = tracks[name] ? trackAt(tracks[name], f) : TRACKS[name][0];
        return values;
    }
    const phaseMs = (doc, state) => doc.phases[state.phase].ms;
    // reduced: one still frame; photosensitive: the cover's white and the flare at most half.
    function stageEntranceStart(doc, options) {
        const o = options || {};
        return { phase: 0, t: 0, clock: 0, travel: 0, turn: 0, plate: 0, video: 0, loops: 0, blend: null, skipped: null, covered: false, revealed: false, done: false,
            reduced: o.reduced === true, peak: o.photosensitive === false ? 1 : PHOTOSENSITIVE_PEAK, fadeT: 0, still: o.reduced === true ? stageEntranceStill(doc) : null };
    }
    function stageEntranceValues(doc, state) {
        if (state.reduced) {
            const still = state.still, values = Object.assign({}, still.values);
            values.fade = state.covered && state.revealed ? 1 - smooth(Math.min(1, state.fadeT / (doc.reducedMs || 400))) : 1;
            values.flash = 0; values.flare = Math.min(values.flare, still.values.flare * state.peak);
            return { values, clock: still.clock, travel: still.travel, turn: still.turn, plate: still.plate, video: still.video };
        }
        // Skipped: the frame it was on.
        if (state.skipped) return state.skipped;
        const raw = phaseValues(doc, state.phase, Math.min(1, state.t / phaseMs(doc, state)));
        let values = raw;
        if (state.blend) {
            const k = smooth(Math.min(1, state.blend.t / state.blend.ms));
            values = {};
            for (const name of Object.keys(raw)) values[name] = state.blend.from[name] + (raw[name] - state.blend.from[name]) * k;
        }
        values.flash = Math.min(values.flash, state.peak);
        values.flare *= state.peak < 1 ? state.peak : 1;
        return { values, clock: state.clock, travel: state.travel, turn: state.turn, plate: state.plate, video: state.video };
    }
    function enter(doc, state, index, blendMs) {
        const from = blendMs > 0 ? stageEntranceValues(doc, state).values : null;
        state.phase = index; state.t = 0; state.loops = 0;
        state.blend = from ? { from, ms: blendMs, t: 0 } : null;
    }
    // One step of dt ms. input: {ready, skip, revealed}. Returns {state, events}; events are {type:'phase', id} | {type:'cover'} |
    // {type:'done'}. The state is a plain object, copied, never shared.
    function stageEntranceStep(doc, previous, dt, input) {
        const state = Object.assign({}, previous), events = [], ready = !!(input && input.ready);
        if (state.blend) state.blend = Object.assign({}, state.blend);
        if (input && input.revealed) state.revealed = true;
        if (state.done) return { state, events };
        if (state.reduced) {
            if (!state.covered && ready) { state.covered = true; events.push({ type: 'cover' }); }
            if (state.covered && state.revealed) {
                state.fadeT += dt;
                if (state.fadeT >= (doc.reducedMs || 400)) { state.done = true; events.push({ type: 'done' }); }
            }
            return { state, events };
        }
        // A click after the load, before the cover, stops the entrance on the frame it shows: every clock stands still from then on
        // and its later frames never play (the stage covers it with black and ends it).
        if (!state.skipped && input && input.skip && ready && !state.covered) state.skipped = stageEntranceValues(doc, state);
        if (state.skipped) return { state, events };
        if (doc.phases[state.phase].hold && ready) {
            enter(doc, state, state.phase + 1, doc.holdBlendMs === undefined ? 500 : doc.holdBlendMs);
            events.push({ type: 'phase', id: doc.phases[state.phase].id });
        }
        state.t += dt; state.clock += dt;
        if (state.blend) { state.blend.t += dt; if (state.blend.t >= state.blend.ms) state.blend = null; }
        for (let guard = 0; guard < 64; guard++) {
            const duration = phaseMs(doc, state), phase = doc.phases[state.phase];
            if (state.t < duration) break;
            if (phase.hold && !ready) { state.t -= duration; state.loops += 1; continue; }
            if (phase.cover && !state.covered) { state.covered = true; events.push({ type: 'cover' }); }
            if (phase.cover && !state.revealed) { state.t = duration; break; }
            if (state.phase === doc.phases.length - 1) { state.t = duration; state.done = true; events.push({ type: 'done' }); break; }
            const rest = state.t - duration;
            let next = state.phase + 1;
            if (doc.phases[next].hold && ready) next += 1;
            enter(doc, state, next, 0);
            state.t = rest;
            events.push({ type: 'phase', id: doc.phases[next].id });
        }
        // The camera moves by the values it shows (speed: log-radius units / s, spin: rad / s); the plate's and the video's clocks (s)
        // by their rates.
        const { values } = stageEntranceValues(doc, state);
        state.travel += values.speed * dt / 1000; state.turn += values.spin * dt / 1000; state.plate += values.plateRate * dt / 1000; state.video += values.videoRate * dt / 1000;
        return { state, events };
    }
    // The reduced-motion frame: the timeline played (never ready) up to still.phase at still.at, in fixed 1/60 s steps.
    function stageEntranceStill(doc) {
        const index = doc.phases.findIndex(phase => phase.id === doc.still.phase);
        let state = stageEntranceStart(doc, { photosensitive: false });
        const step = 1000 / 60;
        for (let guard = 0; guard < 20000 && !(state.phase === index && state.t >= doc.phases[index].ms * doc.still.at); guard++) {
            state = stageEntranceStep(doc, state, step, { ready: false }).state;
            if (state.phase > index) break;
        }
        const shown = stageEntranceValues(doc, state);
        return { values: shown.values, clock: shown.clock, travel: shown.travel, turn: shown.turn, plate: shown.plate, video: shown.video };
    }
    // The media files a document draws (relative to its entry's bundle): the plate's frames, colour then shift, in order.
    function stageEntranceFiles(doc) {
        const plate = doc.layers.plate;
        if (!plate) return [];
        const name = (kind, i) => plate.dir + '/' + kind + '-' + String(i + 1).padStart(4, '0') + '.webp';
        const files = [];
        for (let i = 0; i < plate.frames; i++) files.push(name('color', i));
        if (plate.shift !== undefined) for (let i = 0; i < plate.frames; i++) files.push(name('shift', i));
        return files;
    }
    // The plate frame shown at plate clock `seconds` (the last one holds).
    function stageEntrancePlateFrame(doc, seconds) {
        const plate = doc.layers.plate;
        return Math.max(0, Math.min(plate.frames - 1, Math.floor(seconds * plate.fps + 1e-6)));
    }
    // The run when the stage is ready at once and nothing is clicked: every phase but the hold (ms).
    function stageEntranceDuration(doc) {
        return doc.phases.reduce((sum, phase) => sum + (phase.hold ? 0 : phase.ms), 0);
    }
    return Object.freeze({ STAGE_ENTRANCE_SCHEMA: SCHEMA, STAGE_ENTRANCE_TRACKS: TRACKS, STAGE_ENTRANCE_LAYERS: LAYERS,
        validateStageEntrance, stageEntranceStart, stageEntranceStep, stageEntranceValues, stageEntranceStill, stageEntranceDuration, stageEntranceFiles, stageEntrancePlateFrame });
}
const stageEntrance = stageEntranceContract();
if (typeof module !== 'undefined' && typeof window === 'undefined' && module.exports) module.exports = Object.assign({ stageEntranceContract }, stageEntrance);
