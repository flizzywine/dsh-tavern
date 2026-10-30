// each stored emotion owns its image; missing images rest only at calm.
// @include-shared sprite-images.cjs
const spriteImageContract = typeof window === 'undefined' && typeof require === 'function' ? require('./sprite-images.cjs') : {spriteUsesImages, spriteImageTable, stateImagePool, stateImageId};
function spriteEmotionEntries(manifest) {
    return Object.entries(spriteImageContract.spriteImageTable(manifest) || {});
}
function spriteEmotionState(manifest, emotion) {
    const images = spriteImageContract.spriteImageTable(manifest);
    const entry = typeof emotion === 'string' && images && Object.hasOwn(images, emotion) ? images[emotion] : null;
    return entry ? {id:emotion, ...entry} : null;
}
// `fallbackTo` (outfit 缺图时用) names the canonical 差分 shown when the requested
// one has no state of its own; without one (or when it has none either) the outfit default stands in, as before.
function resolveSpriteEmotion(manifest, requested, order, fallbackEmotions = [], fallbackTo = {}) {
    // Callers with a figure supply its declarations, headed by the outfit default.
    const unrestricted = order === undefined;
    order ??= ['calm'];
    requested ??= order[0];
    const own = unrestricted || order.includes(requested) ? spriteEmotionState(manifest,requested) : null;
    const id = order[0];
    const state = own || fallbackTo?.[requested] && spriteEmotionState(manifest,fallbackTo[requested]) || spriteEmotionState(manifest,id);
    return {requestedEmotion:requested, resolvedEmotion:state?.id || null, missing:!own, intentionalFallback:!own && requested !== id && fallbackEmotions.includes(requested) && Boolean(state),
        reason:own ? 'own' : state ? 'missing-emotion' : 'missing-sprite', state};
}
function resolveSpriteDisplay(manifest, requested, order, fallbackEmotions = [], fallbackTo = {}) {
    const base=resolveSpriteEmotion(manifest,requested,order,fallbackEmotions,fallbackTo);
    return {...base,fallback:base.missing ? base.state ? 'first-emotion' : 'avatar' : null};
}
// The raster compositor consumes a transient projection, never a persisted pool.
function spriteRenderManifest(manifest) {
    if (!manifest) return null;
    const {emotions, images, ...render} = manifest;
    if (spriteImageContract.spriteUsesImages(manifest)) render.version = manifest.kind === 'static-sprites' ? 1 : 2;
    const states = spriteEmotionEntries(manifest).map(([id, value]) => ({id, ...value}));
    return {...render, defaultState:resolveSpriteEmotion(manifest,undefined,states.map(row=>row.id)).resolvedEmotion, states};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {spriteEmotionEntries, spriteEmotionState, resolveSpriteEmotion, resolveSpriteDisplay, spriteRenderManifest};
