// Shared manifest/runtime contract. No platform APIs, filesystem reads or implicit image lookup.
const SPRITE_EVENTS = ['closed', 'small', 'mid', 'open'];
function layeredSpritePath(value) {
    if (typeof value !== 'string' || value.length > 240 || !/^[a-zA-Z0-9_./-]+$/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')) || !/\.(png|webp)$/i.test(value)) throw new Error('分层素材路径无效');
    return value;
}
function layeredSpriteManifest(raw, mode = 'path') {
    const fail = message => { throw new Error('分层素材：' + message); };
    const object = v => v && typeof v === 'object' && !Array.isArray(v);
    const slug = (v, max = 64) => typeof v === 'string' && v.length <= max && /^[a-z0-9][a-z0-9_-]*$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
    const text = (v, max = 160) => typeof v === 'string' ? v.slice(0, max) : '';
    const dimension = v => Number.isInteger(v) && v > 0 && v <= 4096;
    const source = v => mode === 'sha' ? (/^[0-9a-f]{64}$/.test(v) ? v : fail('图片 SHA 无效')) : layeredSpritePath(v);
    function rect(r, w, h) {
        if (!object(r) || !['x', 'y', 'w', 'h'].every(k => Number.isInteger(r[k])) || r.x < 0 || r.y < 0 || r.w <= 0 || r.h <= 0 || r.x + r.w > w || r.y + r.h > h) fail('坐标越界');
        return { x: r.x, y: r.y, w: r.w, h: r.h };
    }
    function viewRect(r, w, h) {
        if (!object(r) || !['x', 'y', 'w', 'h'].every(k => Number.isFinite(r[k]) && r[k] >= 0) || r.w === 0 || r.h === 0) fail('坐标越界');
        // Rasterize view anchors only; atlas crops must remain exact integer pixels.
        const x = Math.floor(r.x), y = Math.floor(r.y);
        return rect({ x, y, w: Math.min(Math.ceil(r.w), w - x), h: Math.min(Math.ceil(r.h), h - y) }, w, h);
    }
    if (!object(raw) || raw.version !== 2 || raw.kind !== 'layered-static-sprites') fail('不支持的 manifest 版本');
    if (raw.closedBehavior !== 'restore-base') fail('closedBehavior 必须是 restore-base');
    if (!slug(raw.character?.id) || !text(raw.character?.name).trim()) fail('角色无效');
    function atlas(value) {
        if (!object(value) || !dimension(value.width) || !dimension(value.height) || !object(value.frames) || !Object.keys(value.frames).length || Object.keys(value.frames).length > 256) fail('atlas 无效');
        const frames = {};
        for (const [id, entry] of Object.entries(value.frames)) {
            if (!slug(id)) fail('frame ID 无效');
            const r = rect(entry, value.width, value.height);
            if (Object.values(frames).some(p => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y)) fail('atlas frame 重叠');
            // replacement is opt-in; legacy frames remain alpha-over.
            if (entry.replace !== undefined && typeof entry.replace !== 'boolean') fail('Invalid frame replace flag');
            frames[id] = { ...r, ...(entry.replace !== undefined ? { replace: entry.replace } : {}) };
        }
        return { src: source(value.src), width: value.width, height: value.height, frames, defaultFrames: mapping(value.defaultFrames, SPRITE_EVENTS, frames) };
    }
    function mapping(value, keys, frames) {
        if (value === undefined || object(value) && !Object.keys(value).length) return {};
        if (!object(value) || keys.some(key => !Object.hasOwn(value, key))) fail('mouthFrames requires closed/small/mid/open');
        const out = {};
        for (const [key, id] of Object.entries(value)) {
            if (!keys.includes(key)) fail('mouthFrames requires exactly closed/small/mid/open; unexpected key: ' + key);
            if (!Object.hasOwn(frames, id)) fail('口型映射不存在');
            out[key] = id;
        }
        return out;
    }
    const mouthAtlas = raw.mouthAtlas === undefined ? undefined : atlas(raw.mouthAtlas), mouthSets = {};
    if (raw.mouthSets !== undefined) {
        if (!object(raw.mouthSets) || Object.keys(raw.mouthSets).length > 128) fail('mouthSets 无效');
        for (const [id, value] of Object.entries(raw.mouthSets)) {
            if (!slug(id, 160)) fail('mouthSet ID 无效');
            mouthSets[id] = atlas(value);
        }
    }
    if (!Array.isArray(raw.states) || !raw.states.length) fail('至少需要一个状态');
    const seen = new Set();
    const states = raw.states.map(s => {
        if (!object(s) || !slug(s.id) || seen.has(s.id)) fail('状态 ID 无效或重复');
        seen.add(s.id);
        if (s.mouthSet !== undefined && (!slug(s.mouthSet, 160) || !Object.hasOwn(mouthSets, s.mouthSet))) fail('mouthSet 不存在');
        const selectedAtlas = s.mouthSet === undefined ? mouthAtlas : mouthSets[s.mouthSet];
        const frames = selectedAtlas?.frames || {};
        const mouthFrames = mapping(s.mouthFrames, SPRITE_EVENTS, frames), initialPhoneme = s.initialPhoneme ?? 'closed';
        if (!SPRITE_EVENTS.includes(initialPhoneme)) fail('initialPhoneme 无效');
        if (s.closedMouthFrame !== undefined) {
            if (!Object.hasOwn(frames, s.closedMouthFrame) || mouthFrames.closed && mouthFrames.closed !== s.closedMouthFrame) fail('closed 映射冲突');
            mouthFrames.closed = s.closedMouthFrame;
        }
        if (initialPhoneme !== 'closed' && !mouthFrames.closed) fail('张口底图需要真正的闭口 patch');
        const staticState = s.stage?.mouth === undefined && s.portrait?.mouth === undefined;
        if (staticState && (Object.keys(mouthFrames).length || Object.keys(s.stage?.mouthByFrame || {}).length || Object.keys(s.portrait?.mouthByFrame || {}).length)) fail('静态状态不能引用口型');
        function view(v) {
            if (!object(v) || !dimension(v.width) || !dimension(v.height)) fail('视图尺寸无效');
            const out = { src: source(v.src), width: v.width, height: v.height };
            if (!staticState) {
                out.mouth = viewRect(v.mouth, v.width, v.height);
                if (!SPRITE_EVENTS.every(key => Object.hasOwn(v.mouthFrames || mouthFrames, key))) fail('mouthFrames requires closed/small/mid/open');
            }
            if (v.mouthByFrame !== undefined) {
                if (!object(v.mouthByFrame)) fail('mouthByFrame 无效');
                out.mouthByFrame = {};
                for (const [id, r] of Object.entries(v.mouthByFrame)) {
                    if (!Object.hasOwn(frames, id)) fail('mouthByFrame frame 不存在');
                    out.mouthByFrame[id] = viewRect(r, v.width, v.height);
                }
            }
            // independent raster patches can share the selected state atlas.
            if (v.mouthFrames !== undefined) {
                out.mouthFrames = mapping(v.mouthFrames, SPRITE_EVENTS, frames);
                if (staticState && Object.keys(out.mouthFrames).length) fail('Static view cannot map mouths');
            }
            if (v.mouthOcclusionMask !== undefined) out.mouthOcclusionMask = source(v.mouthOcclusionMask);
            // an optional blink overlay never invalidates the sprite; a bad one is ignored.
            if (v.blink !== undefined) { try { out.blink = layeredSpriteBlink(v.blink, v.width, v.height, source); } catch { /* eyes stay open */ } }
            return out;
        }
        return { id: s.id, label: text(s.label || s.id), emotion: text(s.emotion || s.id, 64), initialPhoneme, mouthFrames, ...(s.mouthSet !== undefined ? { mouthSet: s.mouthSet } : {}), stage: view(s.stage), portrait: view(s.portrait) };
    });
    if (raw.defaultState !== undefined && !seen.has(raw.defaultState)) fail('默认状态不存在');
    return { version: raw.version, kind: raw.kind, closedBehavior: 'restore-base', character: { id: raw.character.id, name: text(raw.character.name) }, defaultState: raw.defaultState || (seen.has('calm') ? 'calm' : states[0].id), ...(mouthAtlas ? { mouthAtlas } : {}), ...(raw.mouthSets !== undefined ? { mouthSets } : {}), states };
}
function layeredSpriteBlink(raw, width, height, source = layeredSpritePath) {
    const r = raw && raw.rect;
    if (!raw || typeof raw !== 'object' || !Array.isArray(r) || r.length !== 4 || !r.every(Number.isInteger) || r[0] < 0 || r[1] < 0 || r[2] <= 0 || r[3] <= 0 || r[0] + r[2] > width || r[1] + r[3] > height) throw new Error('blink 无效');
    return { closed: source(raw.closed), ...(raw.half !== undefined ? { half: source(raw.half) } : {}), rect: [...r], ...(raw.blend === 'replace' ? { blend: 'replace' } : {}) };
}
function layeredSpriteMapAssets(pack, map) {
    const view = v => ({ ...v, src: map(v.src), ...(v.mouthOcclusionMask ? { mouthOcclusionMask: map(v.mouthOcclusionMask) } : {}), ...(v.blink ? { blink: { ...v.blink, closed: map(v.blink.closed), ...(v.blink.half ? { half: map(v.blink.half) } : {}) } } : {}) });
    return { ...pack, ...(pack.mouthAtlas ? { mouthAtlas: { ...pack.mouthAtlas, src: map(pack.mouthAtlas.src) } } : {}), ...(pack.mouthSets ? { mouthSets: Object.fromEntries(Object.entries(pack.mouthSets).map(([id, atlas]) => [id, { ...atlas, src: map(atlas.src) }])) } : {}), states: pack.states.map(s => ({ ...s, stage: view(s.stage), portrait: view(s.portrait) })) };
}
function layeredSpriteAssets(pack) {
    const out = new Map();
    const add = (src, w, h) => { if (out.has(src) && String(out.get(src)) !== String([w, h])) throw new Error('分层素材同一资源尺寸冲突'); out.set(src, [w, h]); };
    for (const atlas of [pack.mouthAtlas, ...Object.values(pack.mouthSets || {})].filter(Boolean)) add(atlas.src, atlas.width, atlas.height);
    for (const s of pack.states) for (const v of [s.stage, s.portrait]) { add(v.src, v.width, v.height); if (v.mouthOcclusionMask) add(v.mouthOcclusionMask, v.width, v.height); }
    return out;
}
function layeredSpriteState(pack, requested, fallback = '') {
    if (!pack) return null;
    const alias = { sad: 'sadness', anxious: 'nervous', shy: 'embarrassed', love: 'affection' };
    const exact = value => pack.states.find(s => s.id === value || s.label === value);
    const emotion = value => pack.states.find(s => s.emotion === value || s.emotion === alias[value]);
    return exact(requested) || exact(alias[requested]) || emotion(requested) || exact(fallback) || exact(alias[fallback]) || emotion(fallback) || exact(pack.defaultState) || pack.states[0];
}
function layeredSpriteAtlas(pack, state) {
    return state.mouthSet === undefined ? pack.mouthAtlas : pack.mouthSets?.[state.mouthSet];
}
function layeredSpriteFrame(pack, state, event, view) {
    if (event === 'initial' || event === 'idle' || (!state.stage.mouth && !state.portrait.mouth)) return null;
    if (!SPRITE_EVENTS.includes(event)) return null;
    const atlas = layeredSpriteAtlas(pack, state);
    const id = (view?.mouthFrames || state.mouthFrames)?.[event];
    return id && atlas?.frames[id] ? { id, rect: atlas.frames[id] } : null;
}
// The one amplitude → tier gear, shared by the stage and the dialogue portrait: one sample per Audio element per display
// frame. Rising thresholds 0.20/0.45/0.72, falling 0.10/0.32/0.58 (hysteresis), 80 ms hold between tier changes, and
// real silence closes at once even inside the hold. 'initial' (the clip has not started) keeps the base untouched.
// Amplitude animation, not phoneme recognition; no synthetic text timer.
const MOUTH_UP = [0.20, 0.45, 0.72], MOUTH_DOWN = [0.10, 0.32, 0.58];
function layeredSpriteVoiceStep(previous, audio, level, enabled, now) {
    const fresh = !previous || (audio && previous.audio !== audio) || now < previous.at || now - previous.at > 250 || Number(audio?.currentTime) + 0.02 < previous.time;
    const state = fresh ? { audio, event: 'initial', started: Boolean(previous?.started && (!audio || previous.audio === audio)), changed: -Infinity } : previous;
    const playing = Boolean(enabled && audio && !audio.paused && !audio.ended && Number.isFinite(level));
    const started = state.started || playing, amplitude = playing ? Math.min(1, Math.max(0, level)) : 0;
    let event = 'initial';
    if (started && amplitude <= 0.01) event = 'closed';
    else if (started) {
        const index = Math.max(0, SPRITE_EVENTS.indexOf(state.event));
        let next = index;
        while (next < 3 && amplitude >= MOUTH_UP[next]) next++;
        if (next === index) while (next > 0 && amplitude < MOUTH_DOWN[next - 1]) next--;
        event = SPRITE_EVENTS[next !== index && now - state.changed < 80 ? index : next];
    }
    return { audio, event, started, changed: event === state.event ? state.changed : now, at: now, time: Number(audio?.currentTime) || 0 };
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = { SPRITE_EVENTS, layeredSpritePath, layeredSpriteBlink, layeredSpriteManifest, layeredSpriteMapAssets, layeredSpriteAssets, layeredSpriteState, layeredSpriteAtlas, layeredSpriteFrame, layeredSpriteVoiceStep };
