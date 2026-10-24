// dsh.entrance/1: 入场演出, the stage's opening performance - an `entrances` entry of the card's own packs. A data document:
// the engine draws a closed set of generic primitives (a light point, rings, streams flying out of the focus, a flare, a
// vignette and a full-screen cover); the document carries every colour, timing, intensity and shape. Nothing here names a work.
// The check is closed (an unknown field or a value out of range rejects the document) and runs once, where the entry is written.
//
// Timeline: phases play in order. A `hold` phase loops while the stage is not ready and is left once it is. At the end of the
// `cover` phase the screen is covered (the stage is shown under it) and the timeline waits there until the stage reports it is
// shown; the phases after it hand off (the last one's `fade` ends at 0). A skip after the stage is ready jumps to the cover
// (skip.flashMs) and a short handoff (skip.handoffMs). Reduced motion shows one still frame and fades it out (reducedMs) once
// the stage is ready. The cover's white and the flare are capped at half (光敏保护) unless a caller turns that off.
// Shared by the host and the browser (@include-domain): no imports, no host or DOM access.
const STAGE_ENTRANCE_SCHEMA = 'dsh.entrance/1';
// track: [default, min, max, layer it drives (null: the camera)]
const STAGE_ENTRANCE_TRACKS = Object.freeze({
  light: [0, 0, 8, 'light'], lightSize: [1, 0, 40, 'light'], rings: [0, 0, 8, 'rings'], ringSize: [1, 0, 20, 'rings'],
  streams: [0, 0, 8, 'streams'], flare: [0, 0, 8, 'flare'], vignette: [0, 0, 1, 'vignette'],
  speed: [0, -8, 40, null], spin: [0, -8, 8, null], zoom: [0, -2, 6, null], flash: [0, 0, 1, 'flash'], fade: [1, 0, 1, null]
});
// layer field: 'color!' a required palette name, 'color' an optional one; [min, max, required, integer] a number.
const STAGE_ENTRANCE_LAYERS = Object.freeze({
  light: { color: 'color!', core: 'color', radius: [0.001, 0.5, true], halo: [0.01, 4] },
  rings: { color: 'color!', radius: [0.01, 2, true], width: [0.001, 0.5, true], count: [1, 4, false, true] },
  streams: { color: 'color!', count: [4, 512, true, true], length: [0.01, 4], width: [0.1, 8] },
  flare: { color: 'color!', rays: [0, 32, false, true] },
  vignette: { color: 'color!' },
  flash: { color: 'color!' }
});
const ENTRANCE_FIELDS = ['schema', 'label', 'background', 'focus', 'palette', 'layers', 'phases', 'skip', 'still', 'holdBlendMs', 'reducedMs'];
const ENTRANCE_REQUIRED = ['schema', 'background', 'focus', 'palette', 'layers', 'phases', 'skip', 'still'];
const ENTRANCE_PHOTOSENSITIVE_PEAK = 0.5, ENTRANCE_RISE_MS = 80;
const entranceObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const entranceId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
function entranceCheck(ok, path, message) { if (!ok) throw Object.assign(new TypeError(path + ': ' + message), { code: 'INVALID_ENTRANCE', path }); }
function entranceShape(value, fields, required, path) {
  entranceCheck(entranceObject(value), path, 'expected an object');
  for (const key of Object.keys(value)) entranceCheck(fields.includes(key), path + '.' + key, 'unknown field');
  for (const key of required) entranceCheck(Object.hasOwn(value, key), path + '.' + key, 'required');
}
function entranceNumber(value, min, max, path, integer) {
  entranceCheck(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), path,
    'expected ' + (integer ? 'an integer' : 'a number') + ' in ' + min + '..' + max);
}
function entranceTrack(keys, name, path, hold) {
  const [, min, max] = STAGE_ENTRANCE_TRACKS[name];
  entranceCheck(Array.isArray(keys) && keys.length >= 1 && keys.length <= 32, path, 'expected 1..32 [t, value] keys');
  keys.forEach((key, i) => {
    entranceCheck(Array.isArray(key) && key.length === 2, path + '[' + i + ']', 'expected [t, value]');
    entranceNumber(key[0], 0, 1, path + '[' + i + '][0]'); entranceNumber(key[1], min, max, path + '[' + i + '][1]');
    if (i) entranceCheck(key[0] > keys[i - 1][0], path + '[' + i + '][0]', 'times must increase');
  });
  // A loop is seamless: it ends where it starts.
  if (hold) entranceCheck(keys[0][1] === keys[keys.length - 1][1], path, 'a hold phase track must end on its first value');
}
function validateStageEntrance(doc) {
  entranceShape(doc, ENTRANCE_FIELDS, ENTRANCE_REQUIRED, '$');
  entranceCheck(doc.schema === STAGE_ENTRANCE_SCHEMA, '$.schema', 'expected ' + STAGE_ENTRANCE_SCHEMA);
  if (doc.label !== undefined) entranceCheck(typeof doc.label === 'string' && doc.label.trim().length > 0 && doc.label.length <= 80, '$.label', 'expected 1..80 characters');
  entranceCheck(entranceObject(doc.palette) && Object.keys(doc.palette).length >= 1 && Object.keys(doc.palette).length <= 24, '$.palette', 'expected 1..24 named colours');
  for (const [name, color] of Object.entries(doc.palette)) {
    entranceCheck(entranceId(name), '$.palette.' + name, 'invalid name');
    entranceCheck(typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color), '$.palette.' + name, 'expected #rrggbb');
  }
  const paletteName = (value, path) => entranceCheck(typeof value === 'string' && Object.hasOwn(doc.palette, value), path, 'expected a palette name');
  paletteName(doc.background, '$.background');
  entranceCheck(Array.isArray(doc.focus) && doc.focus.length === 2, '$.focus', 'expected [x, y]');
  doc.focus.forEach((value, i) => entranceNumber(value, 0, 1, '$.focus[' + i + ']'));
  entranceCheck(entranceObject(doc.layers), '$.layers', 'expected an object');
  for (const [name, layer] of Object.entries(doc.layers)) {
    const spec = Object.hasOwn(STAGE_ENTRANCE_LAYERS, name) ? STAGE_ENTRANCE_LAYERS[name] : null, path = '$.layers.' + name;
    entranceCheck(!!spec, path, 'unknown layer');
    entranceShape(layer, Object.keys(spec), Object.keys(spec).filter(key => spec[key] === 'color!' || Array.isArray(spec[key]) && spec[key][2]), path);
    for (const [key, value] of Object.entries(layer)) {
      if (typeof spec[key] === 'string') paletteName(value, path + '.' + key);
      else entranceNumber(value, spec[key][0], spec[key][1], path + '.' + key, spec[key][3]);
    }
  }
  entranceCheck(Array.isArray(doc.phases) && doc.phases.length >= 2 && doc.phases.length <= 16, '$.phases', 'expected 2..16 phases');
  const ids = new Set();
  let cover = -1, hold = -1;
  doc.phases.forEach((phase, i) => {
    const path = '$.phases[' + i + ']';
    entranceShape(phase, ['id', 'ms', 'hold', 'cover', 'tracks'], ['id', 'ms'], path);
    entranceCheck(entranceId(phase.id) && !ids.has(phase.id), path + '.id', 'expected a unique short id'); ids.add(phase.id);
    entranceNumber(phase.ms, 1, 20000, path + '.ms', true);
    for (const flag of ['hold', 'cover']) if (phase[flag] !== undefined) entranceCheck(phase[flag] === true, path + '.' + flag, 'set true or omit');
    if (phase.hold) { entranceCheck(hold < 0, path + '.hold', 'only one hold phase'); hold = i; }
    if (phase.cover) { entranceCheck(cover < 0, path + '.cover', 'only one cover phase'); cover = i; }
    if (phase.tracks !== undefined) {
      entranceCheck(entranceObject(phase.tracks), path + '.tracks', 'expected an object');
      for (const [name, keys] of Object.entries(phase.tracks)) {
        entranceCheck(Object.hasOwn(STAGE_ENTRANCE_TRACKS, name), path + '.tracks.' + name, 'unknown track');
        const layer = STAGE_ENTRANCE_TRACKS[name][3];
        entranceCheck(!layer || Object.hasOwn(doc.layers, layer), path + '.tracks.' + name, 'needs layers.' + layer);
        entranceTrack(keys, name, path + '.tracks.' + name, phase.hold === true);
      }
    }
  });
  entranceCheck(cover >= 0, '$.phases', 'one phase must be the cover');
  entranceCheck(cover < doc.phases.length - 1, '$.phases[' + cover + '].cover', 'a handoff phase must follow the cover');
  entranceCheck(hold < 0 || hold < cover, '$.phases[' + hold + '].hold', 'the hold phase must come before the cover');
  entranceCheck(Object.hasOwn(doc.layers, 'flash'), '$.layers.flash', 'required: the cover is drawn with it');
  // The last phase hands the screen to the stage: its opacity ends at 0.
  const last = doc.phases[doc.phases.length - 1], fade = last.tracks && last.tracks.fade;
  entranceCheck(!!fade && fade[fade.length - 1][1] === 0, '$.phases[' + (doc.phases.length - 1) + '].tracks.fade', 'the last phase must fade out to 0');
  entranceShape(doc.skip, ['flashMs', 'handoffMs'], ['flashMs', 'handoffMs'], '$.skip');
  entranceNumber(doc.skip.flashMs, ENTRANCE_RISE_MS, 2000, '$.skip.flashMs', true);
  entranceNumber(doc.skip.handoffMs, 100, 5000, '$.skip.handoffMs', true);
  entranceShape(doc.still, ['phase', 'at'], ['phase', 'at'], '$.still');
  entranceCheck(ids.has(doc.still.phase) && doc.phases.findIndex(phase => phase.id === doc.still.phase) < cover, '$.still.phase', 'expected a phase before the cover');
  entranceNumber(doc.still.at, 0, 1, '$.still.at');
  if (doc.holdBlendMs !== undefined) entranceNumber(doc.holdBlendMs, 0, 3000, '$.holdBlendMs', true);
  if (doc.reducedMs !== undefined) entranceNumber(doc.reducedMs, 100, 3000, '$.reducedMs', true);
  entranceCheck(JSON.stringify(doc).length <= 16384, '$', 'document exceeds 16 KiB');
  return doc;
}

// ---- timeline (pure; the stage and the tests drive it with real or fixed time steps) ----
const entranceCoverIndex = doc => doc.phases.findIndex(phase => phase.cover);
const entranceSmooth = x => x * x * (3 - 2 * x);
function entranceTrackAt(keys, f) {
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (f <= keys[i][0]) {
    const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
    return v0 + (v1 - v0) * entranceSmooth((f - t0) / (t1 - t0));
  }
  return keys[keys.length - 1][1];
}
// The raw values of a phase at fraction f; tracks it does not name take their defaults.
function entrancePhaseValues(doc, index, f) {
  const tracks = doc.phases[index].tracks || {}, values = {};
  for (const name of Object.keys(STAGE_ENTRANCE_TRACKS)) values[name] = tracks[name] ? entranceTrackAt(tracks[name], f) : STAGE_ENTRANCE_TRACKS[name][0];
  return values;
}
const entrancePhaseMs = (doc, state) => doc.phases[state.phase].ms * state.scale;
// options: reduced (one still frame), photosensitive (default on: the cover's white and the flare at most half).
function stageEntranceStart(doc, options) {
  const o = options || {};
  return { phase: 0, t: 0, scale: 1, clock: 0, travel: 0, turn: 0, loops: 0, blend: null, skipped: false, covered: false, revealed: false, done: false,
    reduced: o.reduced === true, peak: o.photosensitive === false ? 1 : ENTRANCE_PHOTOSENSITIVE_PEAK, fadeT: 0, still: o.reduced === true ? stageEntranceStill(doc) : null };
}
// What to draw now: {values (every track), clock (ms), travel, turn}.
function stageEntranceValues(doc, state) {
  if (state.reduced) {
    const still = state.still, values = Object.assign({}, still.values);
    values.fade = state.covered && state.revealed ? 1 - entranceSmooth(Math.min(1, state.fadeT / (doc.reducedMs || 400))) : 1;
    values.flash = 0; values.flare = Math.min(values.flare, still.values.flare * state.peak);
    return { values, clock: still.clock, travel: still.travel, turn: still.turn };
  }
  const raw = entrancePhaseValues(doc, state.phase, Math.min(1, state.t / entrancePhaseMs(doc, state)));
  let values = raw;
  if (state.blend) {
    const k = entranceSmooth(Math.min(1, state.blend.t / state.blend.ms));
    values = {};
    for (const name of Object.keys(raw)) values[name] = state.blend.from[name] + (raw[name] - state.blend.from[name]) * k;
  }
  values.flash = Math.min(values.flash, state.peak);
  values.flare *= state.peak < 1 ? state.peak : 1;
  return { values, clock: state.clock, travel: state.travel, turn: state.turn };
}
function entranceEnter(doc, state, index, blendMs, scale) {
  const from = blendMs > 0 ? stageEntranceValues(doc, state).values : null;
  state.phase = index; state.t = 0; state.loops = 0; state.scale = scale;
  state.blend = from ? { from, ms: blendMs, t: 0 } : null;
}
// One step of dt ms. input: {ready, skip, revealed}. Returns {state, events}; events are {type:'phase', id} | {type:'cover'} |
// {type:'done'}. The state is a plain object, copied, never shared.
function stageEntranceStep(doc, previous, dt, input) {
  const state = Object.assign({}, previous), events = [], ready = !!(input && input.ready), cover = entranceCoverIndex(doc);
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
  // A skip once the stage is ready jumps to the cover (shortened), then a short handoff.
  if (input && input.skip && ready && !state.skipped && state.phase < cover) {
    state.skipped = true;
    entranceEnter(doc, state, cover, doc.skip.flashMs, doc.skip.flashMs / doc.phases[cover].ms);
    events.push({ type: 'phase', id: doc.phases[cover].id });
  } else if (doc.phases[state.phase].hold && ready) {
    entranceEnter(doc, state, state.phase + 1, doc.holdBlendMs === undefined ? 500 : doc.holdBlendMs, 1);
    events.push({ type: 'phase', id: doc.phases[state.phase].id });
  }
  state.t += dt; state.clock += dt;
  if (state.blend) { state.blend.t += dt; if (state.blend.t >= state.blend.ms) state.blend = null; }
  for (let guard = 0; guard < 64; guard++) {
    const duration = entrancePhaseMs(doc, state), phase = doc.phases[state.phase];
    if (state.t < duration) break;
    if (phase.hold && !ready) { state.t -= duration; state.loops += 1; continue; }
    if (phase.cover && !state.covered) { state.covered = true; events.push({ type: 'cover' }); }
    if (phase.cover && !state.revealed) { state.t = duration; break; }
    if (state.phase === doc.phases.length - 1) { state.t = duration; state.done = true; events.push({ type: 'done' }); break; }
    const rest = state.t - duration;
    let next = state.phase + 1;
    if (doc.phases[next].hold && ready) next += 1;
    entranceEnter(doc, state, next, 0, state.skipped && next > cover ? doc.skip.handoffMs / doc.phases[next].ms : 1);
    state.t = rest;
    events.push({ type: 'phase', id: doc.phases[next].id });
  }
  // The camera moves by the values it shows (speed: log-radius units / s, spin: rad / s).
  const { values } = stageEntranceValues(doc, state);
  state.travel += values.speed * dt / 1000; state.turn += values.spin * dt / 1000;
  return { state, events };
}
// The reduced-motion frame: the timeline played with the stage ready at once (a hold is passed) up to still.phase at still.at,
// in fixed 1/60 s steps.
function stageEntranceStill(doc) {
  const index = doc.phases.findIndex(phase => phase.id === doc.still.phase);
  let state = stageEntranceStart(doc, { photosensitive: false });
  for (let guard = 0; guard < 20000 && !(state.phase === index && state.t >= doc.phases[index].ms * doc.still.at); guard++) {
    state = stageEntranceStep(doc, state, 1000 / 60, { ready: true }).state;
    if (state.phase > index) break;
  }
  const shown = stageEntranceValues(doc, state);
  return { values: shown.values, clock: shown.clock, travel: shown.travel, turn: shown.turn };
}
// The run when the stage is ready at once and nothing is skipped: every phase but the hold (ms).
function stageEntranceDuration(doc) {
  return doc.phases.reduce((sum, phase) => sum + (phase.hold ? 0 : phase.ms), 0);
}

export { STAGE_ENTRANCE_SCHEMA, STAGE_ENTRANCE_TRACKS, STAGE_ENTRANCE_LAYERS, validateStageEntrance, stageEntranceStart, stageEntranceStep, stageEntranceValues, stageEntranceStill, stageEntranceDuration }
