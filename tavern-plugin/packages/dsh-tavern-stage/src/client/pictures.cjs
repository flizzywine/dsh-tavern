'use strict';
// 场景生图 CG insert pages. The core places the illustrator's pictures on the round's paragraphs (useStagePictures,
// stage-scene-images.js); after the paragraph a finished picture follows, the reader turns to one page of it and clicks on.
// An insert page is display only: it is not a stage page, never in the cursor, the position bookmark or a clip export. A
// reload lands on the page it followed; skip passes it; reading back shows ready pictures again and never draws one.
function createStagePictures({React}) {
// The ready pictures a page turn passes, in the order they are met: forward from paragraph `from` to `to` (null: past the
// round's last page) shows the pictures of [from, to); back from `from` to `to`, those of [to, from) in reverse. AUTO
// (drawing) also meets the ones still being drawn: it waits for each a short grace (stagePictureAutoDelay).
function stagePicturesPassed(items, from, to, forward, drawing) {
    const met = (items || []).filter(item => item.state === 'ready' && item.url || drawing && item.state === 'pending');
    if (forward) return met.filter(item => item.para >= from && (to === null || item.para < to));
    return met.filter(item => item.para >= to && item.para < from).reverse();
}
// The pictures still being drawn: the notice's 「正在生成 CG…」 and the plugin's own progress once it reports one.
function stagePicturesWorking(state) {
    const pending = (state?.items || []).filter(item => item.state === 'pending');
    if (!pending.length && !state?.planning) return null;
    const known = pending.map(item => item.progress).filter(value => typeof value === 'number');
    return {progress:known.length ? Math.min(...known) : null};
}
// The final paragraph counts as passed once the end panel opens.
function stagePictureLate(items, previouslyPending, para, atEnd) {
    return items.findLast(item => item.state === 'ready' && item.url && previouslyPending.has(item.id) &&
        (item.para < para || atEnd && item.para === para)) || null;
}
// AUTO on an insert page: a picture on screen (onShown) holds at least STAGE_PICTURE_AUTO_MIN_MS, however short the
// reader's auto wait (a picture has no words to time it by); one not on screen within STAGE_PICTURE_AUTO_GRACE_MS of
// reaching its page (still drawn or loading) is passed, never waited for. It stays in 回想 and reading back.
const STAGE_PICTURE_AUTO_GRACE_MS = 3000, STAGE_PICTURE_AUTO_MIN_MS = 3000;
function stagePictureAutoDelay(shown, wait, elapsed) {
    return shown ? Math.max(STAGE_PICTURE_AUTO_MIN_MS, wait) : Math.max(0, STAGE_PICTURE_AUTO_GRACE_MS - elapsed);
}
// The live state of an insert page's picture: ready to show, or null while it is drawn (or once it failed).
function stagePictureShowable(items, picture) {
    const item = (items || []).find(entry => entry.id === picture.id);
    return item && item.state === 'ready' && item.url ? item : null;
}
// One picture over the whole stage: the art contained, the same picture blurred behind it; the caption bottom left and the
// 继续 cue bottom right. onShown once the art has loaded; a picture that does not load is passed (onFailed), never an empty page.
function StagePicturePage({picture, onShown, onFailed}) {
    const h = React.createElement;
    return h('figure', {className:'fork-gal-picture-page', 'aria-label':picture.caption || 'CG'},
        h('img', {className:'fork-gal-picture-fill', src:picture.url, alt:'', 'aria-hidden':true, draggable:false}),
        h('img', {className:'fork-gal-picture-art', src:picture.url, alt:picture.caption || 'CG', draggable:false, onLoad:onShown, onError:onFailed}),
        picture.caption ? h('figcaption', null, picture.caption) : null,
        h('span', {className:'fork-gal-picture-next', 'aria-hidden':true}, '点击继续'));
}
return {passed:stagePicturesPassed, working:stagePicturesWorking, late:stagePictureLate, autoDelay:stagePictureAutoDelay, showable:stagePictureShowable, Page:StagePicturePage};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStagePictures};
