// Shared soundscape replay/planning. No I/O or record migration.
const SOUNDSCAPE_TAGS = ['empty', 'open', 'sheltered', 'sealed'];
const SOUNDSCAPE_EXPOSURES = ['open', 'indoor', 'sheltered', 'sealed'];
const SOUNDSCAPE_WEATHER = ['rain', 'storm', 'snow', 'sakura', 'leaves', 'sparkle', 'none'];
const SOUNDSCAPE_RAIN_IDS = ['amb-rain-light', 'amb-rain', 'amb-heavy-rain', 'amb-rain-window'];
const SOUNDSCAPE_CROWD_IDS = ['amb-cafe', 'amb-classroom'];

function soundscapeObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function soundscapeId(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}
function soundscapeTags(raw) {
    if (!Array.isArray(raw)) return { tags: null, errors: ['Expected a sound tag array'] };
    if (raw.length > 2 || [...raw].some(tag => !SOUNDSCAPE_TAGS.includes(tag))
        || new Set(raw).size !== raw.length || raw.filter(tag => tag !== 'empty').length > 1) {
        return { tags: null, errors: ['Sound tags must be unique: empty and at most one of open, sheltered, sealed'] };
    }
    return { tags: SOUNDSCAPE_TAGS.filter(tag => raw.includes(tag)), errors: [] };
}
function soundscapeIdentity(value) {
    const ref = soundscapeObject(value?.ref) ? value.ref : value || {};
    const source = soundscapeId(ref.source) ? ref.source : '';
    return { source: !source ? '' : source === 'card' ? 'card' : 'library',
        libraryId: !source || source === 'card' ? '' : source === 'library' ? (soundscapeId(ref.libraryId) ? ref.libraryId : '') : source,
        id: soundscapeId(ref.id) ? ref.id : '' };
}
function soundscapeSceneKey(scene, ref) {
    const identity = soundscapeIdentity(ref);
    return JSON.stringify(identity.source && identity.id ? [scene, identity.source, identity.libraryId, identity.id] : [scene]);
}
function soundscapeNormalize(value) {
    if (!soundscapeObject(value)) return null;
    const checked = soundscapeTags(Object.hasOwn(value, 'tags') ? value.tags : []);
    if (checked.errors.length) return null;
    const scene = typeof value.scene === 'string' ? value.scene : '';
    return {
        sceneKey: typeof value.sceneKey === 'string' && value.sceneKey ? value.sceneKey : soundscapeSceneKey(scene),
        scene,
        weather: SOUNDSCAPE_WEATHER.includes(value.weather) ? value.weather : 'none',
        tags: checked.tags
    };
}
function soundscapeInitial(start) {
    if (!soundscapeObject(start)) return null;
    const state = soundscapeNormalize(soundscapeObject(start.soundscape) ? start.soundscape : {});
    if (!state) return null;
    const scene = typeof start.scene === 'string' ? start.scene : state.scene;
    const key = start.assetRefs?.scene || scene !== state.scene ? soundscapeSceneKey(scene, start.assetRefs?.scene) : state.sceneKey;
    // Qualifying a name-only scene refines its identity; it is not a scene change.
    if (state.scene && key !== state.sceneKey
        && (scene !== state.scene || state.sceneKey !== soundscapeSceneKey(scene))) state.tags = [];
    state.sceneKey = key;
    state.scene = scene;
    if (SOUNDSCAPE_WEATHER.includes(start.weather)) state.weather = start.weather;
    return state;
}
function soundscapeReplay(start, entries, para = Infinity) {
    const state = soundscapeInitial(start);
    if (!state) return null;
    const through = typeof para === 'number' && !Number.isNaN(para) ? para : 0;
    const ordered = (Array.isArray(entries) ? entries : [])
        .filter(entry => soundscapeObject(entry) && Number.isSafeInteger(entry.at) && entry.at >= 1 && entry.at <= through)
        .slice().sort((a, b) => a.at - b.at);
    for (const entry of ordered) {
        if (typeof entry.scene === 'string' && entry.scene) {
            // An unqualified repetition cannot establish a different source.
            const key = entry.scene === state.scene && !entry.assetRefs?.scene
                ? state.sceneKey : soundscapeSceneKey(entry.scene, entry.assetRefs?.scene);
            if (key !== state.sceneKey) {
                if (entry.scene !== state.scene || state.sceneKey !== soundscapeSceneKey(entry.scene)) state.tags = [];
                Object.assign(state, { scene: entry.scene, sceneKey: key });
            }
        }
        if (Object.hasOwn(entry, 'sound')) {
            const checked = soundscapeTags(entry.sound);
            if (!checked.errors.length) state.tags = checked.tags;
        }
        for (const command of Array.isArray(entry.commands) ? entry.commands : []) {
            if (soundscapeObject(command) && command.op === 'weather' && SOUNDSCAPE_WEATHER.includes(command.value)) state.weather = command.value;
        }
    }
    return state;
}
function soundscapeCarry(state) {
    return soundscapeNormalize(state);
}

// rooms get no ventilation hum (it played under every indoor scene).
// Finite category suggestions, not name/description inference. Exact paths from the bundled
// general backgrounds index; room prefixes also cover fantasy/xianxia interior categories.
// Unicode escapes keep this standalone include ASCII. Specific exceptions precede prefixes.
const SOUNDSCAPE_PRESETS = [
    ['amb-cafe', 'indoor', [
        '\u57ce\u9547/\u5546\u4e1a/\u5496\u5561\u5385', '\u57ce\u9547/\u5546\u4e1a/\u5bb6\u5ead\u9910\u5385',
        '\u57ce\u9547/\u5546\u4e1a/\u5feb\u9910\u5e97', '\u57ce\u9547/\u5546\u4e1a/\u62c9\u9762\u5e97',
        '\u57ce\u9547/\u5546\u4e1a/\u751c\u54c1\u5e97', '\u5b66\u6821/\u5ba4\u5185/\u5b66\u751f\u98df\u5802'
    ]],
    ['amb-classroom', 'indoor', ['\u5b66\u6821/\u5ba4\u5185/\u6559\u5ba4']],
    // quiet residential streets have no place bed, but remain outdoors for weather.
    ['none', 'open', ['\u4f4f\u5b85/\u5ba4\u5916/\u8857\u5df7', '\u4f4f\u5b85/\u5ba4\u5916/\u4f4f\u5b85\u533a']],
    ['amb-city-street', 'open', [
        '\u4f4f\u5b85/\u5ba4\u5916/\u8857\u89d2',
        '\u57ce\u9547/\u5546\u4e1a/\u5546\u5e97\u8857', '\u57ce\u9547/\u5546\u4e1a/\u7e41\u534e\u8857'
    ]],
    ['amb-forest', 'open', ['\u81ea\u7136/\u68ee\u6797\u5c0f\u5f84']],
    ['amb-park-birds', 'open', ['\u81ea\u7136/\u516c\u56ed', '\u81ea\u7136/\u513f\u7ae5\u516c\u56ed']],
    ['amb-stream-flow', 'open', ['\u81ea\u7136/\u5c71\u95f4\u6eaa\u6d41']],
    ['amb-river-waves', 'open', [
        '\u81ea\u7136/\u6cb3\u7554\u6a31\u82b1\u9053',
        '\u4f4f\u5b85/\u5ba4\u5916/\u6cb3\u5824', '\u4f4f\u5b85/\u5ba4\u5916/\u6cb3\u5ddd\u5927\u6865'
    ]],
    ['amb-sea', 'open', ['\u81ea\u7136/\u6d77\u8fb9\u5824\u9632', '\u6d3b\u52a8/\u51fa\u884c/\u6d77\u6ee9', '\u57ce\u9547/\u5546\u4e1a/\u6e2f\u53e3\u7801\u5934']],
    // train cars use the retained rail-joint clatter instead of a generic low rumble.
    ['amb-train-clatter', 'indoor', ['\u57ce\u9547/\u4ea4\u901a/\u7535\u8f66\u8f66\u53a2', '\u6d3b\u52a8/\u51fa\u884c/\u65b0\u5e72\u7ebf\u8f66\u53a2']]
];
const SOUNDSCAPE_ROOM_PREFIXES = [
    '\u5b66\u6821/\u5ba4\u5185', '\u4f4f\u5b85/\u5ba4\u5185', '\u57ce\u9547/\u5ba4\u5185', '\u5b97\u95e8/\u5ba4\u5185'
];
function soundscapePreset(scene) {
    const metadata = soundscapeObject(scene) ? scene : {};
    const explicit = metadata.soundscape;
    const classification = soundscapeObject(explicit) && typeof explicit.people === 'boolean' ? { people: explicit.people } : {};
    if (soundscapeObject(explicit) && soundscapeId(explicit.place) && explicit.place !== 'auto'
        && SOUNDSCAPE_EXPOSURES.includes(explicit.exposure)) {
        return { place: explicit.place, exposure: explicit.exposure, ...classification, warnings: [] };
    }
    for (const [place, exposure, categories] of SOUNDSCAPE_PRESETS) {
        if (categories.includes(metadata.category)) return { place, exposure, ...classification, warnings: [] };
    }
    if (typeof metadata.category === 'string' && SOUNDSCAPE_ROOM_PREFIXES.some(prefix => metadata.category === prefix || metadata.category.startsWith(prefix + '/'))) {
        return { place: 'none', exposure: 'indoor', ...classification, warnings: [] };
    }
    // Conservative fallback: silence for place, muffled rain rather than assuming outdoors.
    return { place: 'none', exposure: 'indoor', ...classification, warnings: ['unknown acoustic preset'] };
}

function soundscapeSceneSnapshots(scenes) {
    const snapshots = (Array.isArray(scenes) ? scenes : []).filter(scene => soundscapeObject(scene)
        && scene.enabled !== false && scene.hidden !== true).map(scene => {
        const preset = soundscapePreset(scene);
        return Object.freeze({ name: typeof scene.name === 'string' ? scene.name : '', ...soundscapeIdentity(scene),
            soundscape: Object.freeze({ ...preset, warnings: Object.freeze(preset.warnings.slice()) }) });
    });
    const keys = snapshots.map(scene => JSON.stringify([scene.name, scene.source, scene.libraryId, scene.id]));
    if (new Set(keys).size !== keys.length) throw new TypeError('Duplicate scene identity');
    return Object.freeze(snapshots);
}
function soundscapeRecordPlan(direction, para, sounds) {
    if (!soundscapeObject(direction)) return { version: 0, layers: [], warnings: [] };
    const state = soundscapeReplay(direction.start || {}, direction.entries, para);
    if (!state) return { version: 0, layers: [], warnings: [] };
    let key;
    try { key = JSON.parse(state.sceneKey); } catch (_) { key = []; }
    const snapshots = Array.isArray(direction.soundscapeScenes) ? direction.soundscapeScenes : [];
    let candidates = snapshots.filter(scene => scene?.name === state.scene);
    if (Array.isArray(key) && key.length === 4) candidates = snapshots.filter(scene => {
        const identity = soundscapeIdentity(scene);
        // A qualified identity survives display-name changes in the current picture catalogue.
        return identity.source === key[1] && identity.libraryId === key[2] && identity.id === key[3];
    });
    const scene = candidates.length === 1 ? candidates[0] : null;
    const plan = soundscapePlan(state, scene, sounds);
    plan.warnings = [...new Set([...plan.warnings, ...(scene ? scene.soundscape?.warnings || []
        : [candidates.length ? 'ambiguous scene identity' : 'missing scene snapshot'])])];
    return plan;
}

function soundscapePlan(state, scene, sounds) {
    const normalized = soundscapeNormalize(state);
    if (!normalized) return { version: 0, layers: [], warnings: [] };
    const preset = soundscapePreset(scene);
    const warnings = preset.warnings.slice();
    const catalogue = new Map();
    for (const sound of Array.isArray(sounds) ? sounds : []) {
        if (!soundscapeObject(sound) || !soundscapeId(sound.id) || sound.enabled === false || sound.hidden === true || sound.missing === true
            || (sound.kind !== undefined && sound.kind !== 'ambience')) continue;
        if (!catalogue.has(sound.id)) catalogue.set(sound.id, sound);
    }
    function resolve(id) {
        const sound = catalogue.get(id);
        if (!sound) { warnings.push('missing ambience: ' + id); return null; }
        if (typeof sound.url !== 'string' || !sound.url.trim()) { warnings.push('missing ambience URL: ' + id); return null; }
        return { id, url: sound.url };
    }
    const exposure = normalized.tags.find(tag => tag !== 'empty') || preset.exposure;
    // Rain-family presets are not independent weather commands or place beds.
    let placeId = SOUNDSCAPE_RAIN_IDS.includes(preset.place) ? 'none' : preset.place;
    const soundPeople = catalogue.get(placeId)?.people;
    const people = typeof soundPeople === 'boolean' ? soundPeople
        : typeof preset.people === 'boolean' ? preset.people : SOUNDSCAPE_CROWD_IDS.includes(placeId);
    if (normalized.tags.includes('empty') && people) placeId = 'none';
    const layers = [];
    if (placeId !== 'none') {
        const place = resolve(placeId);
        if (place) layers.push({ slot: 'place', ...place, gain: 0.8, lowpassHz: null });
    }
    const raining = normalized.weather === 'rain' || normalized.weather === 'storm';
    if (exposure !== 'sealed' && raining) {
        const storm = normalized.weather === 'storm';
        let id = storm ? 'amb-heavy-rain' : 'amb-rain';
        const windowRain = catalogue.get('amb-rain-window');
        if (exposure === 'indoor' && !storm
            && typeof windowRain?.url === 'string' && windowRain.url.trim()) id = 'amb-rain-window';
        let weather = resolve(id);
        if (!weather && id !== 'amb-rain') weather = resolve('amb-rain');
        if (weather) {
            // The window recording is already an indoor bed; do not muffle it a second time.
            const windowBed = exposure === 'indoor' && weather.id === 'amb-rain-window';
            const attenuation = { open: 1, indoor: 0.4, sheltered: 0.7 }[exposure];
            layers.push({ slot: 'weather', ...weather, gain: (storm ? 1.25 : 1) * attenuation,
                lowpassHz: windowBed ? null : exposure === 'indoor' ? 1600 : exposure === 'sheltered' ? 4500 : null });
        }
    }
    // URL aliases collapse in favor of the weather slot so exposure filtering still applies.
    if (layers.length === 2 && layers[0].url === layers[1].url) {
        warnings.push('duplicate ambience URL: kept weather');
        layers.shift();
    }
    const budget = layers.length === 2 ? 0.7 : 1;
    return { version: 1, layers: layers.map(layer => ({ ...layer, gain: Math.max(0, Math.min(1, layer.gain * budget)) })), warnings };
}

if (typeof window === 'undefined' && typeof module !== 'undefined' && module.exports) module.exports = { soundscapeTags, soundscapeInitial, soundscapeReplay, soundscapeCarry, soundscapePreset, soundscapePlan, soundscapeSceneSnapshots, soundscapeRecordPlan };
