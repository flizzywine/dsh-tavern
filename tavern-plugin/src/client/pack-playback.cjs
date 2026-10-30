// Opt-in asset-packs-v1 playback helpers. Nothing here mounts or changes legacy players.
// @include avatar-cache.cjs
function createPackCalibration({ measure, place, limit = 256, algorithm = 'figure-measure-v1' }) {
    const cache = new Map();
    return {
        async placement(figure, view, input) {
            if (!figure.geometry?.[view]) return null;
            const key = figure.geometry[view] + ':' + algorithm;
            if (!cache.has(key)) {
                const pending = Promise.resolve().then(() => measure(figure, view, key));
                cache.set(key, pending);
                pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
                while (cache.size > limit) cache.delete(cache.keys().next().value);
            }
            const geometry = await cache.get(key);
            // Final placement is deliberately not cached: scene ruler/viewport/pose can change.
            return place(geometry, { ...input, heightCm: figure.heightCm, source: key, view });
        },
        clear() { cache.clear(); }
    };
}
function createPackFigureCalibration({getResource}) {
    return createPackCalibration({
        algorithm: FIGURE_ALGORITHM,
        async measure(figure, view, key) {
            const resource = await getResource(figure, view);
            return figure.form === 'live2d' && view === 'stage' ? figureMeasureLive2d(resource, key) : figureMeasureTexture(key, resource);
        },
        place(record, input) {
            // Confirmed here means usable derived geometry, not a persisted author approval.
            const metrics = {...record, status:record.auto?.invalid ? 'pending' : 'confirmed'};
            return resolveFigureSizing({...input, version:1, canvas:record.canvas, metrics});
        }
    });
}
// Event looks interrupt the performance grade without changing either persistent owner.
function packPerformanceScene(scene, look) {
    return scene && look && scene.mood?.event !== true ? {...scene, mood:look} : scene;
}
function createPackSceneLayers(math) {
    math ||= {normalize:galLookNormalize, matrix:galLookMatrix, extras:galLookExtras, compose:galLookCompose, multiply:galMatrix.multiply, identity:galMatrix.identity};
    const cache = new WeakMap();
    return projection => {
        if (cache.has(projection)) return cache.get(projection);
        // day is always neutral, even if an editable day look contains grade parameters.
        const time = math.normalize(projection.timeOfDay === 'day' ? {} : projection.time?.params || {}), mood = math.normalize(projection.mood?.params || {});
        const figureGrade = math.matrix(time);
        const value = {time, mood, figureGrade,
            backgroundGrade:projection.timeOfDay !== 'day' && projection.compensateBackground ? math.multiply(figureGrade, math.matrix(math.normalize(projection.time?.params?.standIn || {}))) : math.identity(),
            timeGradeTarget:projection.compensateBackground ? 'world' : 'figures',
            timeWorld:math.extras(time), moodWorld:mood, world:math.compose(math.extras(time), mood),
            timeTransitionMs:projection.timeTransitionMs, backgroundUrl:projection.backgroundUrl};
        cache.set(projection,value); return value;
    };
}
// The reducer has already consumed entry slots. Missing figures do not reserve invisible anchors.
function packStageMembers(state, stageable = () => true) {
    const cast = state.cast.filter(id => stageable(id));
    return cast.map((id, index) => ({id, x:(index + 1) / (cast.length + 1), gaze:state.actors[id].gaze, light:state.actors[id].figureLight}));
}
// preserve the live stage's listener/close-up dimming, independently of figure-light cues.
// A skin with dimListeners: false (stage-skin-adv.md: listeners keep full light) keeps only the close-up dimming.
function packFigureShade(alias, speaker, members, camera, dimListeners = true) {
    const speaking = alias === speaker;
    let shade = speaking || !dimListeners ? 1 : members.some(member => member.id === speaker) ? 0.8 : 0.94;
    if (camera?.mode === 'close' && camera.actor !== alias && !speaking) shade *= 0.82;
    return shade;
}
const packSpriteViewCache = new WeakMap();
function packSpriteViews(figure, contract) {
    if (packSpriteViewCache.has(figure)) return packSpriteViewCache.get(figure);
    if (!figure.spritePack || figure.manifest?.kind !== 'layered-static-sprites') return {stage:null, portrait:null};
    const project = typeof window === 'undefined' && typeof require === 'function' ? require('../../shared/sprite-emotions.cjs').spriteRenderManifest : spriteRenderManifest;
    const raw = project(figure.manifest);
    const normalize = contract?.layeredSpriteManifest || layeredSpriteManifest, mapAssets = contract?.layeredSpriteMapAssets || layeredSpriteMapAssets;
    // Reuse the existing raster/closed-mouth normalization, with the same surrogate
    // state IDs as P0 validation. Missing portraits must not become stage-image faces.
    const ids = new Map(raw.states.map((state, i) => [state.id, 'state_' + i]));
    const defaultState = ids.has(raw.defaultState) ? raw.defaultState : ids.has('calm') ? 'calm' : raw.states[0].id;
    const normalized = normalize({...raw, defaultState:ids.get(defaultState), states:raw.states.map(state => ({...state, id:ids.get(state.id), portrait:state.portrait || state.stage}))});
    const pack = mapAssets(normalized, src => figure.spriteUrls[src] || src);
    pack.defaultState = defaultState;
    pack.states.forEach((state, i) => { state.id = raw.states[i].id; if (!raw.states[i].portrait) state.portrait = {}; });
    const state = pack.states.find(value => value.id === figure.state?.id);
    if (!state) return {stage:null, portrait:null};
    const bundle = view => state[view]?.src ? { pack, state, view:state[view], key:figure.geometry[view], identity:figure.ref.packId + ':' + figure.geometry[view], revision:figure.ref.packId + ':' + figure.geometry[view] } : null;
    const result = {stage:figure.form !== 'sprite' || figure.views?.stage === false ? null : bundle('stage'), portrait:figure.views?.portrait === false ? null : bundle('portrait')};
    packSpriteViewCache.set(figure,result); return result;
}
// an outfit emotionMap entry {expression?, motion?} becomes the stage's expression name and an
// explicit gesture group. The mood token changes exactly when the mapped entry does, so the gesture plays once
// per emotion change (gal-scene.js galMoodMotionPlan); a missing motion never falls back to Mood_<id>.
function packLive2dMood(mapping) {
    const expression = typeof mapping?.expression === 'string' ? mapping.expression : '';
    const motion = typeof mapping?.motion === 'string' && mapping.motion ? mapping.motion : null;
    const mood = 'pack:' + JSON.stringify([expression, motion]);
    return {mood, moods:{[mood]:expression}, moodMotion:motion};
}
// the stage view's authored blink patch (URLs already resolved). Layered views carry
// their canvas; flat stills are checked against the loaded base texture by the scene.
function packBlinkBundle(blink, view) {
    if (!blink?.closed || !Array.isArray(blink.rect)) return null;
    const canvas = view ? [view.width, view.height] : null;
    return {key:JSON.stringify([blink.closed, blink.half || '', blink.rect, canvas, ...(blink.blend ? [blink.blend] : [])]), closed:blink.closed, half:blink.half || '', rect:blink.rect, canvas, ...(blink.blend ? {blend:blink.blend} : {})};
}
// track 0 animation for the selected emotion (outfit emotionMap, else rest) and
// the talk animation used while voiced. Display settings travel unchanged; the scene owns their runtime meaning.
function packSpineInputs(spine, mapping) {
    return {spine:{defaultAnimation:spine.defaultAnimation, hideSlots:spine.hideSlots || [], ...(spine.skin ? {skin:spine.skin} : {}), ...(spine.frame ? {frame:spine.frame} : {}),
        ...(spine.bottomFade !== undefined ? {bottomFade:spine.bottomFade} : {})},
        animation:mapping?.animation || spine.defaultAnimation, talk:mapping?.talk || spine.talkAnimation || null};
}
// A Spine body its frame cuts off (lobby art ends mid-body) fades out over the last 12% of its visible height instead
// of ending in a hard edge above the text box. Cut-off: the anatomy says so (crop "custom", feet below the frame), or
// without anatomy the measured rest pose touches the frame's bottom edge. `override` (outfit spine.bottomFade, a share
// 0–0.5; 0 = none) replaces the default share. Returns {start, end} in frame fractions (y down), or null.
const PACK_SPINE_BOTTOM_FADE = 0.12;
function packSpineBottomFade(override, anatomy, auto, frameHeight) {
    const measured = !anatomy && auto && !auto.invalid ? auto : null;
    const cut = anatomy ? anatomy.crop === 'custom' || anatomy.feet > 1 : Boolean(measured?.cropSuspected);
    const share = typeof override === 'number' ? override : cut ? PACK_SPINE_BOTTOM_FADE : 0;
    if (!(share > 0)) return null;
    const top = anatomy ? anatomy.figureTop ?? 0 : measured ? measured.figureTop / frameHeight : 0;
    const end = Math.min(1, anatomy ? anatomy.visibleBottom ?? 1 : measured ? measured.visibleBottom / frameHeight : 1);
    return {start:end - share * Math.max(0, end - top), end};
}
function packFigureRenderInputs(figure, {audio = null, speaking = false, skipping = false, voiceKey = figure.alias, sessionId} = {}, contract) {
    const views = packSpriteViews(figure, contract), staticMouth = figure.mouthPolicy?.mouth === 'static';
    const activeAudio = speaking && !skipping && !staticMouth ? audio : null;
    const readImage = typeof window === 'undefined' && typeof require === 'function' ? require('../../shared/sprite-emotions.cjs').spriteEmotionState : spriteEmotionState;
    const state = readImage(figure.spritePack,figure.state?.id);
    const face = figure.avatarUrl ? {key:figure.alias,identity:figure.media.avatar.identity,src:figure.avatarUrl,crop:figure.avatarCrop,
        avatar:{sessionId,ref:figure.ref,revision:figure.revision,outfitKey:figure.avatarOutfitKey || figure.outfitKey,stateId:figure.avatarStateId || figure.state?.id,identity:figure.media.avatar.identity,crop:figure.avatarCrop}} : null;
    if (figure.form === 'avatar' || !figure.form || figure.views?.stage === false) return {stage:null, face};
    // actor slot is stable across outfits; the renderer prepares the
    // changed resource before retiring the previous model in that slot.
    const key = figure.alias;
    const identity = JSON.stringify([figure.ref,figure.outfitKey,figure.form,figure.form === 'live2d' ? figure.media.model.identity : figure.media.sprite.identity]);
    // The Spine identity is its geometry key: bundle plus display settings, so a re-framed outfit reloads.
    if (figure.form === 'spine') return {stage:figure.modelUrl ? {key, identity, kind:'spine', url:figure.modelUrl, ...packSpineInputs(figure.outfit.spine, figure.spineEmotion), audio:activeAudio, voiced:Boolean(activeAudio)} : null, face};
    if (figure.form === 'live2d') return {stage:figure.modelUrl ? {key, identity, kind:'live2d', url:figure.modelUrl, ...packLive2dMood(figure.live2dEmotion), ...(figure.live2dBlush === true ? {blush:true} : {}), moodLine:speaking ? voiceKey : null, audio:activeAudio, voiced:Boolean(activeAudio), voiceStarted:Boolean(activeAudio && !activeAudio.paused && !activeAudio.ended), talking:false} : null, face};
    const src = views.stage?.view.src || state?.src;
    return {stage:src ? {key, identity, kind:'static', src, spriteBundle:views.stage, blinkBundle:packBlinkBundle(views.stage?.view.blink, views.stage?.view), spriteVoiceKey:voiceKey, audio:activeAudio} : null, face};
}
// what a tap reaction may borrow from the figure's own outfit for a
// moment, per reaction emotion: the Live2D emotionMap expression/gesture, the Spine emotionMap animation, or a sprite
// 差分's stage still. The still is a lazy media descriptor the
// scene acquires on the first tap, never a prefetch. Each word resolves through the figure's own emotion list (`moods`,
// bubbleMoodList) with the shared resolver; a figure without that emotion reacts without a 差分. Generic: no new data.
const PACK_REACTION_EMOTIONS = Object.freeze(['joy', 'shy', 'anxious', 'anger']);
function packFigureReaction(figure, id) {
    const outfit = figure.outfit;
    if (figure.form === 'live2d') {
        const mapping = outfit?.live2d?.emotionMap?.[id];
        const expression = typeof mapping?.expression === 'string' ? mapping.expression : '', motion = typeof mapping?.motion === 'string' && mapping.motion ? mapping.motion : null;
        return expression || motion ? {expression, motion} : null;
    }
    if (figure.form === 'spine') {
        const animation = outfit?.spine?.emotionMap?.[id]?.animation;
        return typeof animation === 'string' && animation ? {animation} : null;
    }
    if (figure.form !== 'sprite' || outfit?.sprite?.imagePools || id === figure.state?.id || !figure.ref?.packId) return null;
    const entry = figure.manifest?.emotions?.[id], name = entry ? (entry.stage ? entry.stage.src : entry.src) : null;
    const hash = typeof name === 'string' && outfit?.sprite?.assets && Object.hasOwn(outfit.sprite.assets, name) ? outfit.sprite.assets[name] : null;
    if (typeof hash !== 'string') return null;
    const ref = figure.ref;
    return {still:{resource:true, kind:'media', ref:{...ref}, alias:figure.alias, revision:figure.revision, hash,
        identity:`${ref.packId}:${ref.kind || 'figures'}:${ref.assetId || ref.figureId}:${hash}`}};
}
function packFigureReactions(figure, moods, resolve = typeof matchBubbleMood === 'function' ? matchBubbleMood : require('./bubble-line.cjs').matchBubbleMood) {
    if (!figure?.form || !Array.isArray(moods)) return null;
    const result = {};
    for (const word of PACK_REACTION_EMOTIONS) {
        const id = resolve(word, moods)?.id, value = id ? packFigureReaction(figure, id) : null;
        if (value) result[word] = value;
    }
    return Object.keys(result).length ? result : null;
}
// a sprite figure whose outfit has no sprite image at all
// (not even calm) stands on the stage as the outfit's avatar, a small portrait (gal-stage.js), never vanishes.
function packSpriteStandIn(figure) {
    const resolution = figure?.spriteResolution;
    return figure?.form === 'sprite' && figure.views?.stage !== false && Boolean(resolution?.missing) && !resolution.state;
}
// One report row per on-stage sprite figure whose requested 差分 has no image of its own (selectPackFigure →
// resolveSpriteDisplay). Display-only: the data slot stays missing. `shown` is the emotion displayed instead, '@avatar'
// (the avatar stand-in) or null (nothing at all to show). `key` dedupes per figure · outfit · 差分.
function packSpriteFallbacks(characters, onStage = () => true, hasPortrait = () => false) {
    const rows = [];
    for (const figure of characters || []) {
        const resolution = figure?.spriteResolution;
        if (figure?.form !== 'sprite' || figure.views?.stage === false || !resolution?.missing || resolution.intentionalFallback || !onStage(figure.alias)) continue;
        const requested = resolution.requestedEmotion || 'calm', labels = resolution.labels || {};
        const shown = resolution.state ? resolution.resolvedEmotion || resolution.state.id : hasPortrait(figure.alias) ? '@avatar' : null;
        rows.push({key:JSON.stringify([figure.ref?.packId || '', figure.ref?.figureId || figure.alias, figure.outfitKey || '', requested]),
            alias:figure.alias, figure:labels.figure || '', outfit:figure.outfit?.label || figure.outfitKey || '', requested, shown,
            requestedLabel:labels[requested] || '', shownLabel:shown && shown !== '@avatar' ? labels[shown] || '' : ''});
    }
    return rows;
}
// image identity belongs to the pinned content, never its transport.
function packCropStyle(crop, width, height, cropOverflow = false) {
    const scale = Math.min(1 / (width * crop.w), 1 / (height * crop.h));
    return {position:'absolute', maxWidth:'none', objectFit:'fill',
        clipPath:cropOverflow ? `inset(${100 * crop.y}% ${100 * (1 - crop.x - crop.w)}% 0% 0%)` : `inset(${100 * crop.y}% ${100 * (1 - crop.x - crop.w)}% ${100 * (1 - crop.y - crop.h)}% ${100 * crop.x}%)`,
        width:100 * width * scale + '%', height:100 * height * scale + '%',
        left:100 * ((1 - width * crop.w * scale) / 2 - width * crop.x * scale) + '%',
        top:100 * ((1 - height * crop.h * scale) / 2 - height * crop.y * scale) + '%'};
}
// every avatar shares one ResizeObserver (all widths arrive in one callback after
// layout) and one window listener that only reads the pixel ratio. A per-avatar resize listener that measured its own
// node forced one layout per avatar on each fullscreen toggle (~970 on 小圆, ~410 ms in one task).
const packAvatarDpr = (() => {
    const listeners = new Set(), read = () => globalThis.devicePixelRatio || 1;
    let seen = read();
    const update = () => { const next = read(); if (next === seen) return; seen = next; for (const fn of [...listeners]) fn(); };
    return {get:read, subscribe(fn) {
        if (!listeners.size) { seen = read(); globalThis.addEventListener?.('resize',update); }
        listeners.add(fn);
        return () => { listeners.delete(fn); if (!listeners.size) globalThis.removeEventListener?.('resize',update); };
    }};
})();
const packAvatarWidths = (() => {
    const callbacks = new Map();
    let observer = null;
    return {observe(target, fn) {
        if (typeof ResizeObserver === 'undefined') return null;
        observer ||= new ResizeObserver(entries => { for (const entry of entries) callbacks.get(entry.target)?.(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width); });
        callbacks.set(target,fn); observer.observe(target);
        return () => { if (callbacks.get(target) !== fn) return; callbacks.delete(target); observer.unobserve(target); };
    }};
})();
function PackImage({identity,src,crop,avatar,originalSrc,cropOverflow=false,...props}) {
    // the stage face needs source pixels outside the cached square avatar.
    if (cropOverflow) avatar = null;
    const held = React.useRef(null), node = React.useRef(null), picture = React.useRef(null), [size, setSize] = React.useState(null), [px,setPx] = React.useState(null);
    const dpr = React.useSyncExternalStore(packAvatarDpr.subscribe, packAvatarDpr.get);
    if (!held.current || held.current.identity !== identity) held.current = {identity,src};
    const h = React.createElement, url = avatar ? originalSrc || src : held.current.src;
    const cache = typeof avatarCache === 'undefined' ? null : avatarCache;
    const avatarKey = avatar && JSON.stringify([avatar.sessionId,avatar.ref,avatar.revision,avatar.outfitKey,avatar.stateId,identity,crop]);
    const cached = React.useSyncExternalStore(cache?.subscribe || (() => () => {}), () =>
        avatar && (cache?.get(avatar,px || 64,dpr) || cache?.ready(avatar)) || null);
    React.useEffect(() => {
        if (!avatar || !node.current) return;
        // the width comes from the observer's first report, delivered after layout, never
        // from a getBoundingClientRect in the effect: a long transcript mounts ~1000 avatars at once and each read forced a
        // whole-document style recalc (~1 s opening 小圆). An avatar in a skipped (off-screen) turn reports once rendered,
        // and its bitmap is only prepared then (px stays null until measured).
        const target = node.current;
        const apply = width => { if (width > 0) setPx(width); };
        const unobserve = packAvatarWidths.observe(target,apply);
        if (unobserve) return unobserve;
        // No ResizeObserver: measure now and again on window resize.
        apply(target.getBoundingClientRect().width || 64);
        const resize = () => apply(target.getBoundingClientRect().width);
        globalThis.addEventListener?.('resize',resize);
        return () => globalThis.removeEventListener?.('resize',resize);
    }, [avatarKey,cached]);
    React.useEffect(() => {
        if (avatar && url && url !== cached && px) void cache?.prepare(avatar,url,px,dpr);
    }, [avatarKey,url,px,dpr,cached]);
    // an already-available source is measured before paint, so a remounted
    // crop never shows its hidden-until-onLoad frame.
    (React.useLayoutEffect || React.useEffect)(() => {
        const image = picture.current;
        if (!cached && image?.complete && image.naturalWidth && size?.url !== url)
            setSize({url,width:image.naturalWidth,height:image.naturalHeight});
    }, [url,cached]);
    if (cached) return h('img',{...props,ref:node,src:cached});
    if (typeof getStageAvatarCrop === 'function') crop = getStageAvatarCrop(url,crop);
    if (!crop) return h('img',{...props,...(avatar ? {ref:node} : {}),src:url});
    // face orientation belongs to the crop wrapper, not its offset source pixels.
    const {className,style,'data-enter':enter,'data-out':out,'data-face-actor':faceActor,...imageProps} = props;
    return h('span',{ref:node,className:(className ? className + ' ' : '') + 'fork-pack-crop',style,'data-enter':enter,'data-out':out,'data-face-actor':faceActor,'data-avatar-crop':JSON.stringify(crop)},
        h('img',{...imageProps,ref:picture,src:url,style:size?.url === url ? packCropStyle(crop,size.width,size.height,cropOverflow) : {visibility:'hidden'},
            onLoad:event => { const image = event.currentTarget; setSize({url,width:image.naturalWidth,height:image.naturalHeight});
                if (avatar) void cache?.prepare(avatar,url,px || 64,dpr,image); }}));
}
function createPackVoicePlayer({ getClient, createAudio = url => new Audio(url), createSpeech = null, urls = globalThis.URL, prepareAudio = () => {}, disposeAudio = () => {}, onAudio = () => {}, now = Date.now, schedule = (fn, ms) => setInterval(fn, ms), cancel = id => clearInterval(id), maxBytes = 256 * 1024 ** 2, maxClips = 4096, maxPrefetch = 64 }) {
    // decoded Audio objects survive page/turn unmounts for session revisits.
    const clips = new Map(), pending = new Map(), failures = new Map(), listeners = new Set(), queue = [];
    let running = 0;
    function drain() {
        while (running < 2 && queue.length) {
            const job = queue.shift();
            if (job.abort.signal.aborted) { job.start(); continue; }
            running++;
            job.start().finally(() => { running--; drain(); });
        }
    }
    function prioritize(key) {
        const index = queue.findIndex(job => job.key === key);
        if (index > 0) queue.unshift(queue.splice(index, 1)[0]);
    }
    let bytes = 0, current = null, tail = null, client, unsubscribe, enabled = false, disposed = false, generation = 0;
    // Streamed clips replaced by their complete line while they still play; disposed once they stop.
    const superseded = new Set();
    const keyOf = ({cacheKey, owner, id, text, mood = 'default'}) => cacheKey || JSON.stringify([owner, id, text, mood]);
    const emit = () => { onAudio(current?.audio && !current.audio.paused ? current.audio : null); for (const fn of listeners) fn(); };
    function release(audio) {
        if (!audio) return;
        audio.onended = audio.onpause = audio.onplay = null;
        audio.pause(); audio.currentTime = 0; audio.volume = 1;
        if (superseded.delete(audio)) { disposeAudio(audio); audio.src = ''; }
    }
    function retireStream(clip) {
        if (clip.audio === current?.audio || clip.audio === tail?.audio) superseded.add(clip.audio);
        else { release(clip.audio); disposeAudio(clip.audio); clip.audio.src = ''; }
    }
    function stopTail() { if (tail) { cancel(tail.timer); release(tail.audio); tail = null; } }
    function retire(handoff) {
        stopTail();
        const old = current; current = null;
        if (!old?.audio) return;
        const audio = old.audio;
        audio.onended = audio.onpause = audio.onplay = null;
        if (!handoff || audio.paused) { release(audio); return; }
        const started = now(), volume = audio.volume;
        tail = {audio, timer:schedule(() => {
            const remaining = Math.max(0, 1 - (now() - started) / 120);
            audio.volume = volume * remaining;
            if (!remaining) stopTail();
        }, 10)};
    }
    function cancelPending(keep = new Set()) {
        for (const [key, job] of pending) if (!keep.has(key)) { pending.delete(key); job.abort.abort(); }
    }
    function stop() { retire(false); cancelPending(); emit(); }
    function invalidate() {
        generation++; failures.clear(); stop();
        for (const clip of clips.values()) { release(clip.audio); disposeAudio(clip.audio); clip.audio.src = ''; urls.revokeObjectURL(clip.url); }
        clips.clear(); bytes = 0;
    }
    function activeClient() {
        const next = getClient();
        if (next !== client) {
            invalidate(); unsubscribe?.(); client = next;
            unsubscribe = client?.subscribe(() => { if (!client.available()) invalidate(); });
        }
        return !disposed && enabled && client?.apiVersion === 1 && client.available() ? client : null;
    }
    function remember(key, clip) {
        if (clips.has(key)) { bytes -= clips.get(key).size; clips.delete(key); }
        clips.set(key, clip); bytes += clip.size;
        for (const [id, value] of clips) {
            if (bytes <= maxBytes && clips.size <= maxClips) break;
            if (value.audio === current?.audio || value.audio === tail?.audio) continue;
            clips.delete(id); bytes -= value.size; release(value.audio); disposeAudio(value.audio); value.audio.src = ''; urls.revokeObjectURL(value.url);
        }
    }
    // Existing automatic demand drives retries; polling/remounts cannot bypass the per-line budget.
    function canRetry(input) {
        const failure = failures.get(keyOf(input));
        return !failure || failure.attempts < 3 && now() >= failure.retryAt;
    }
    function prepare(descriptor, input, service) {
        const key = keyOf(input);
        if (clips.has(key)) { const clip = clips.get(key); remember(key, clip); return Promise.resolve(clip); }
        if (pending.has(key)) return pending.get(key).promise;
        const abort = new AbortController(), epoch = generation, job = {abort,key};
        const valid = () => { abort.signal.throwIfAborted(); if (epoch !== generation || !enabled || !service.available()) throw new Error('voice-unavailable'); };
        // Prefetch failures belong to the line even when it never becomes the active player.
        const failed = error => {
            if (!abort.signal.aborted && epoch === generation && error.name !== 'AbortError') {
                const attempts = (failures.get(key)?.attempts || 0) + 1;
                const permanent = error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
                failures.set(key, {code:error.code || error.message, attempts, retryAt:permanent ? Infinity : now() + 1000 * 2 ** (attempts - 1)});
                emit();
            }
        };
        // a streaming provider makes the line playable from its first audio;
        // the complete line then replaces the streamed clip in the cache, and a line cut off mid-stream is dropped.
        let stream = null;
        const run = (playable) => (async () => {
            valid();
            if (typeof descriptor === 'function') descriptor = await descriptor();
            valid();
            if (!descriptor?.available) throw new Error(descriptor?.diagnostics?.[0] || 'voice-unavailable');
            // A browser-speech voice is spoken by the system, not synthesized by the TTS
            // service: its clip is an Audio-like utterance with nothing to download.
            if (descriptor.browser) {
                if (!createSpeech) throw new Error('voice-unavailable');
                const audio = createSpeech({...descriptor.browser, text:input.text, language:descriptor.language});
                prepareAudio(audio, null, {});
                const clip = {url:'', audio, size:0, key:null};
                remember(key, clip);
                return clip;
            }
            // the host-issued source scopes this voice; never fall back to global IDs.
            const result = await service.synthesize({voice:descriptor.voice, text:input.text, mood:input.mood || 'default', selectionKey:input.selectionKey, language:descriptor.language}, {scope:descriptor.scope,signal:abort.signal,onStream:live => {
                if (abort.signal.aborted || epoch !== generation) return;
                const audio = createAudio(live.url);
                // The voice's known loudness (if any) levels the first play; the complete line brings its own.
                audio.preload = 'auto'; prepareAudio(audio, null, live); audio.load?.();
                stream = {url:live.url, audio, size:0, key:null};
                remember(key, stream); playable(stream);
            }});
            valid();
            const blob = await service.audio(result.ticket,{signal:abort.signal});
            valid();
            const url = urls.createObjectURL(blob);
            let clip;
            try {
                const audio = createAudio(url);
                audio.preload = 'auto'; prepareAudio(audio, blob, result); audio.load?.();
                clip = {url, audio, size:blob.size, key:result.key};
            } catch (e) { urls.revokeObjectURL(url); throw e; }
            remember(key, clip);
            if (stream) retireStream(stream);
            return clip;
        })().catch(error => {
            if (stream) {
                if (clips.get(key) === stream) clips.delete(key);
                if (current?.audio === stream.audio) { retire(false); emit(); }
                retireStream(stream); failed(error);
            }
            throw error;
        });
        job.promise = new Promise((resolve, reject) => {
            job.start = () => run(resolve).then(resolve, error => { if (stream) return; reject(error); });
        }).then(clip => {
            if (failures.delete(key)) emit();
            return clip;
        }, error => {
            failed(error);
            throw error;
        }).finally(() => { if (pending.get(key) === job) pending.delete(key); });
        pending.set(key, job); queue.push(job); drain(); return job.promise;
    }
    return {
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        get() { return current; },
        getError(input) { return input ? failures.get(keyOf(input))?.code || null : null; }, stop, invalidate,
        stopPlayback() { retire(false); emit(); },
        setEnabled(value) { enabled = value === true; if (!enabled) stop(); },
        setRate(rate) { for (const clip of clips.values()) { clip.audio.preservesPitch = true; clip.audio.playbackRate = rate; } },
        cancelPrefetch(items = []) { const keep = new Set(items.map(keyOf)); if (current) keep.add(current.requestKey); cancelPending(keep); },
        prioritize(items = []) { for (const item of [...items].reverse()) prioritize(keyOf(item)); },
        prefetch(descriptor, input) { const service = activeClient(), key = keyOf(input); return service && canRetry(input) && (pending.size < maxPrefetch || pending.has(key) || clips.has(key)) ? prepare(descriptor,input,service).then(() => true, () => false) : Promise.resolve(false); },
        async play(descriptor, input) {
            const service = activeClient();
            if (!service) return false;
            const requestKey = keyOf(input), cached = clips.get(requestKey);
            if (input.automatic) { if (!canRetry(input)) return false; }
            else failures.delete(requestKey);
            retire(input.handoff === true && cached?.audio !== current?.audio);
            const entry = { loading: true, audio: null, owner:input.owner, id:input.id, requestKey };
            current = entry; emit();
            try {
                // Cached page turns call play before any await (the browser gesture is still live).
                const ready = cached ? null : prepare(descriptor, input, service);
                prioritize(requestKey);
                const prepared = cached || await ready;
                // A streamed clip may already be replaced by its complete line.
                const clip = clips.get(requestKey) || prepared;
                if (current !== entry || !enabled || !service.available()) return false;
                entry.audio = clip.audio; entry.loading = false; entry.key = clip.key;
                remember(requestKey, clip);
                clip.audio.volume = 1;
                clip.audio.onended = () => { if (current === entry) { retire(false); emit(); } };
                clip.audio.onpause = clip.audio.onplay = emit;
                await clip.audio.play();
                if (current !== entry || !enabled || !service.available()) return false;
                emit(); return true;
            } catch (e) {
                if (current === entry) { entry.loading = false; if (e.name !== 'AbortError') entry.error = e.code || e.message; emit(); }
                return false;
            }
        },
        dispose() { if (disposed) return; disposed = true; invalidate(); unsubscribe?.(); listeners.clear(); }
    };
}
// P6 mounts this only beside a new-path bubble/stage descriptor; settings ownership stays outside it.
function PackVoiceButton({player, descriptor, text, mood, enabled}) {
    const [, refresh] = React.useReducer(value => value + 1, 0);
    React.useEffect(() => player.subscribe(refresh), [player]);
    React.useEffect(() => { player.setEnabled(enabled); }, [player, enabled]);
    const state = player.get();
    return React.createElement('button', {type:'button', disabled:!enabled || !descriptor?.available,
        title:state?.error || descriptor?.diagnostics?.join(', ') || 'Speech',
        onClick:() => state?.audio && !state.audio.paused ? player.stop() : void player.play(descriptor,{text,mood})}, state?.loading ? 'Loading speech' : state?.audio && !state.audio.paused ? 'Stop speech' : 'Play speech');
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {packPerformanceScene, createPackCalibration, createPackFigureCalibration, createPackSceneLayers, packStageMembers, packFigureShade, packSpriteViews, packBlinkBundle, packSpineInputs, packSpineBottomFade, packFigureRenderInputs, packFigureReactions, packSpriteStandIn, packSpriteFallbacks, createPackVoicePlayer};
