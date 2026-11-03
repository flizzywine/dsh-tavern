'use strict';
// 场景生图 CG insert pages. The core places the illustrator's pictures on the round's paragraphs (useStagePictures,
// stage-scene-images.js); after the paragraph a finished picture follows, the reader turns to one page of it and clicks on.
// An insert page is display only: it is not a stage page, never in the cursor, the position bookmark or a clip export. A
// reload lands on the page it followed; skip passes it; reading back shows ready pictures again and never draws one.
function createStagePictures({React}) {
// The ready pictures a page turn passes, in the order they are met: forward from paragraph `from` to `to` (null: past the
// round's last page) shows the pictures of [from, to); back from `from` to `to`, those of [to, from) in reverse.
function stagePicturesPassed(items, from, to, forward) {
    const ready = (items || []).filter(item => item.state === 'ready' && item.url);
    if (forward) return ready.filter(item => item.para >= from && (to === null || item.para < to));
    return ready.filter(item => item.para >= to && item.para < from).reverse();
}
// The pictures still being drawn: the notice's 「正在生成 CG…」 and the plugin's own progress once it reports one.
function stagePicturesWorking(state) {
    const pending = (state?.items || []).filter(item => item.state === 'pending');
    if (!pending.length && !state?.planning) return null;
    const known = pending.map(item => item.progress).filter(value => typeof value === 'number');
    return {progress:known.length ? Math.min(...known) : null};
}
// One picture over the whole stage: the art contained, the same picture blurred behind it; the caption bottom left and the
// 继续 cue bottom right. A picture that does not load is passed (onFailed), never an empty page.
function StagePicturePage({picture, onFailed}) {
    const h = React.createElement;
    return h('figure', {className:'fork-gal-picture-page', 'aria-label':picture.caption || 'CG'},
        h('img', {className:'fork-gal-picture-fill', src:picture.url, alt:'', 'aria-hidden':true, draggable:false}),
        h('img', {className:'fork-gal-picture-art', src:picture.url, alt:picture.caption || 'CG', draggable:false, onError:onFailed}),
        picture.caption ? h('figcaption', null, picture.caption) : null,
        h('span', {className:'fork-gal-picture-next', 'aria-hidden':true}, '点击继续'));
}
return {passed:stagePicturesPassed, working:stagePicturesWorking, Page:StagePicturePage};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStagePictures};
