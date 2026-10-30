// one pure avatar resolver for transcript, stage faces and pack UI.
// Precedence per emotion (owner, card-centric merge): an uploaded avatar image for that emotion, then the crop of
// that emotion's own sprite state (manual state > manual outfit > auto > default crop), then the outfit's calm
// uploaded avatar, then the crop of the calm/fallback state. Uploaded avatars are already framed (crop null).
// @include-shared sprite-emotions.cjs
function packSpriteEmotions() {
    return typeof window === 'undefined' && typeof require === 'function' ? require('../../shared/sprite-emotions.cjs') : {resolveSpriteEmotion, spriteEmotionEntries, spriteEmotionState};
}
const PACK_AVATAR_DEFAULT_CROP = Object.freeze({x:0.3,y:0,w:0.4,h:0.21});
// The crop of one sprite state's own body picture: manual state > manual outfit > automatic (written when the pack was
// published / imported); null when nothing framed that picture.
function packSpriteCrop(outfit, stateId) {
    return outfit?.sprite?.avatarCrop?.[stateId] || outfit?.avatarCrop || outfit?.sprite?.avatarCropAuto?.[stateId] || null;
}
// The head (hair → chin, canvas fractions) inside a crop, which frames the head with a short neck below. The cast faces
// and the stage's head-normalised sizing (packFigureAnatomy) read the same box.
function packCropHead(crop) {
    return {top:crop.y + crop.h * 0.08, chin:crop.y + crop.h * 0.8};
}
// card appearance is intent; missing media only lowers the effective form.
// Callers validate the choice and select an enabled outfit before resolving its media.
// `live2d` false (no Cubism Core installed) makes every Live2D view count as
// missing, so the figure takes the same ladder step as an outfit without a model.
// `spine` false (no Spine runtime on this machine, e.g. the public build) does
// the same for Spine. Spine sits between Live2D and sprite: both are animated rigs, sprites are the universal floor.
function packAppearance(outfit, appearance, live2d = true, spine = true) {
    const forms = ['live2d','spine','sprite','avatar'], missing = [];
    for (const form of forms.slice(forms.indexOf(appearance))) {
        if (form === 'avatar' || outfit?.[form] && (live2d || form !== 'live2d') && (spine || form !== 'spine')) return {form,missing};
        missing.push(form);
    }
}
function packAvatarState(outfit, manifest, emotion = outfit?.defaultEmotion || 'calm', defaultEmotion = outfit?.defaultEmotion || 'calm') {
    const pools = outfit?.sprite?.imagePools;
    if (pools) {
        const pool = pools[emotion] || pools[outfit.fallbackTo?.[emotion]] || pools[defaultEmotion];
        return pool ? packSpriteEmotions().spriteEmotionState(manifest,pool.defaultImageId) : null;
    }
    return packSpriteEmotions().resolveSpriteEmotion(manifest, emotion, [defaultEmotion,emotion]).state;
}
function packAvatarSlots(outfit, emotion) {
    return [emotion];
}
function packAvatarImage(outfit, emotion, exactOnly = false, defaultEmotion = outfit?.defaultEmotion || 'calm') {
    const slots = [...packAvatarSlots(outfit,emotion),...(exactOnly ? [] : [defaultEmotion])];
    const stateId = slots.find(slot => outfit?.avatars?.[slot]);
    // Avatar media is already framed; sprite crop coordinates must not be applied.
    return stateId ? {hash:outfit.avatars[stateId],stateId,crop:null} : null;
}
function selectPackAvatar({outfit,manifest,state,avatarSource,defaultEmotion = outfit?.defaultEmotion || 'calm',emotion = state?.id || defaultEmotion,spriteOnly = false}) {
    if (avatarSource) return selectPackAvatar(avatarSource);
    const exactImage = packAvatarImage(outfit,emotion,true);
    if (exactImage) return exactImage;
    const body = candidate => candidate?.stage?.src || candidate?.src;
    const available = candidate => outfit?.sprite?.assets?.[body(candidate)];
    const selected = [state,packAvatarState(outfit,manifest,emotion,defaultEmotion),packAvatarState(outfit,manifest,defaultEmotion,defaultEmotion)].find(available);
    const hash = available(selected);
    const exactState = selected && selected.id === emotion;
    const crop = () => ({hash,stateId:selected.id,crop:packSpriteCrop(outfit,selected.id) || PACK_AVATAR_DEFAULT_CROP});
    if (hash && exactState) return crop();
    const fallbackImage = packAvatarImage(outfit,emotion,false,defaultEmotion);
    if (fallbackImage && (hash || !spriteOnly)) return fallbackImage;
    return hash ? crop() : null;
}
function selectFigureAvatar(figure, sprites = {}, {outfitKey,emotion,imageSelection} = {}) {
    if (!figure?.enabled || !Array.isArray(figure.outfits)) return null;
    if (figure.emotions?.length === 1 && figure.emotions[0].label === undefined) emotion = figure.emotions[0].id;
    const selected = outfitKey === undefined ? figure.outfits.find(outfit => outfit.enabled) : figure.outfits.find(outfit => outfit.key === outfitKey);
    if (!selected?.enabled) return null;
    const identity = typeof window === 'undefined' && typeof require === 'function' ? require('../../packages/dsh-asset-library/lib/shared/emotion-identity.cjs').matchBubbleMood : matchBubbleMood;
    emotion = identity(emotion,figure.emotions || [])?.id || emotion || selected.defaultEmotion || figure.emotions?.[0]?.id;
    if (selected.sprite?.imagePools) {
        const images = typeof window === 'undefined' && typeof require === 'function' ? require('../../shared/sprite-images.cjs') : {stateImageId};
        const id = images.stateImageId(selected,emotion,imageSelection), manifest = sprites[selected.sprite.manifestKey];
        const state = packSpriteEmotions().spriteEmotionState(manifest,id);
        if (!state) return null;
        const source = {outfit:selected,manifest,state,emotion:id,defaultEmotion:id,spriteOnly:true};
        const avatar = selectPackAvatar(source);
        return avatar ? {...avatar,outfitKey:selected.key,avatarSource:source} : null;
    }
    // 缺图时用 — a 差分 with neither its own avatar nor its own sprite state shows its stand-in.
    const use = selected.fallbackTo?.[emotion];
    if (use && !selected.avatars?.[emotion] && packSpriteEmotions().resolveSpriteEmotion(sprites[selected.sprite?.manifestKey], emotion, [selected.defaultEmotion ?? figure.emotions?.[0]?.id ?? 'calm', emotion]).missing) emotion = use;
    // Missing avatars never borrow a different outfit's appearance.
    for (const outfit of [selected]) {
        const manifest = sprites[outfit.sprite?.manifestKey], defaultEmotion=outfit.defaultEmotion ?? figure.emotions?.[0]?.id ?? 'calm', state = packAvatarState(outfit,manifest,emotion,defaultEmotion);
        const avatar = selectPackAvatar({outfit,manifest,state,emotion,defaultEmotion,spriteOnly:true});
        if (avatar) return {...avatar,outfitKey:outfit.key,avatarSource:{outfit,...(manifest ? {manifest} : {}),state,emotion,defaultEmotion,spriteOnly:true}};
    }
    for (const outfit of [selected]) {
        const avatar = packAvatarImage(outfit,emotion,false,outfit.defaultEmotion ?? figure.emotions?.[0]?.id ?? 'calm');
        if (avatar) return {...avatar,outfitKey:outfit.key,avatarSource:{outfit,emotion,defaultEmotion:outfit.defaultEmotion ?? figure.emotions?.[0]?.id}};
    }
    return null;
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {DEFAULT_AVATAR_CROP:PACK_AVATAR_DEFAULT_CROP,packSpriteCrop,packCropHead,selectPackAvatar,selectFigureAvatar,packAvatarState,packAppearance};
