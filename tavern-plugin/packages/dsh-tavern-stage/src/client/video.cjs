'use strict';
function createStageVideo({getService, fetch, URL, stageVideo, audio:forkStageAudio, foreground:forkForeground, setTimeout, clearTimeout}) {
const players = new Set();
let disposed = false;
// the stage's one video player for the 视频 asset kind (`videos`). Any
// stage feature that references a video entry - an entrance's `video` layer today; performances / cut-ins, CG movies, OP/ED and
// skin backgrounds or transitions next - mounts one player per use into an element it owns and either drives it from its own
// timeline (sync) or lets it run (play / pause). The player:
// - reads the entry's bundle once per page and digest (a lease on its 'video' bundle), shared by every player of that entry and
//   released with the last one (its object URLs revoked), so nothing outlives the stage, the turn or the skin that used it;
// - preloads: `ready` settles true once the browser can play it through, false if it cannot decode it or not within readyMs (it
//   keeps loading and joins later); until then, and for good after a failure, the poster shows instead - it never blocks;
// - follows the stage's clock: a target time and rate, seeking only past a small drift; a single play holds its last frame;
// - routes its soundtrack (only when the consumer asks and the entry has one) through the stage mixer on the entry's layer, so
//   the stage volume and mute apply; otherwise it is muted. It pauses with the page when hidden (forkForeground) and resumes.
// Replay rules stay with the consumer (AGENTS: a page's one-shot plays once when paged back to; skip and refresh never replay).

const stageVideoReads = new Map();
function stageVideoAcquire(source) {
    const key = JSON.stringify([source.packId, source.bundleKey, source.hash]);
    let record = stageVideoReads.get(key);
    if (!record) {
        record = {users: 0};
        // One lease for both files; the poster arrives on its own (it stands in while the video is still on its way).
        const service = getService();
        const lease = service.leaseBundle({packId: source.packId, bundleKey: source.bundleKey});
        const read = name => lease.then(async ({ticket, url}) => {
            const marker = '/lease/' + encodeURIComponent(ticket) + '/', base = url.slice(0, url.indexOf(marker) + marker.length);
            const response = await fetch(base + name.split('/').map(encodeURIComponent).join('/'), {credentials: 'same-origin'});
            if (!response.ok) throw new Error('RESOURCE_READ_FAILED ' + response.status);
            return URL.createObjectURL(await response.blob());
        });
        record.poster = read(source.poster).catch(() => null);
        record.video = read(source.entry);
        Promise.allSettled([record.poster, record.video]).then(() => lease.then(({ticket}) => service.releaseLease(ticket), () => {}));
        record.video.catch(() => { if (stageVideoReads.get(key) === record) stageVideoReads.delete(key); });
        stageVideoReads.set(key, record);
    }
    record.users += 1;
    let released = false;
    return {poster: record.poster, video: record.video, release() {
        if (released) return;
        released = true;
        if (--record.users > 0) return;
        if (stageVideoReads.get(key) === record) stageVideoReads.delete(key);
        for (const url of [record.poster, record.video]) url.then(value => { if (value) URL.revokeObjectURL(value); }, () => {});
    }};
}
// host: the element it fills (positioned by the consumer); source: the host's projection of the entry (stage-video.js);
// options: {audio: play its soundtrack, loop / fit: override the entry's, poster: show the poster (default true; a consumer whose
// own drawing stands in passes false), readyMs}. Returns {ready: Promise<boolean> (settles by readyMs), playable: Promise (resolves
// whenever it can play, even after readyMs; never if it cannot), sync({time, rate, alpha}), play(), pause(), state(), dispose()}.
// The layer is a decorative media layer ([data-fk-layer]): its opacity is --fk-layer-opacity (0 until shown).
function stageVideoPlayer(host, source, options) {
    if (disposed) throw new Error("Stage video disposed");
    const o = Object.assign({audio: false, loop: source.loop === true, fit: source.fit || 'cover', poster: true, readyMs: 4000}, options || {});
    const doc = host.ownerDocument, layer = doc.createElement('div'), poster = doc.createElement('img'), video = doc.createElement('video');
    layer.className = 'fork-stage-video'; layer.dataset.fkLayer = ''; layer.setAttribute('aria-hidden', 'true');
    const reveal = alpha => layer.style.setProperty('--fk-layer-opacity', String(alpha));
    poster.className = 'fork-stage-video-poster'; poster.alt = ''; poster.decoding = 'async'; poster.hidden = true;
    video.className = 'fork-stage-video-media'; video.playsInline = true; video.preload = 'auto'; video.muted = true; video.loop = o.loop;
    video.disablePictureInPicture = true; video.hidden = true;
    for (const node of [poster, video]) node.style.objectFit = o.fit;
    layer.append(poster, video);
    host.append(layer);
    let status = 'loading', bound = false, settle, playableNow;
    const playable = new Promise(resolve => { playableNow = resolve; });
    const read = stageVideoAcquire(source);
    const ready = new Promise(resolve => { settle = resolve; });
    const timer = setTimeout(() => settle(false), o.readyMs);
    const show = () => { video.hidden = status !== 'ready'; poster.hidden = status === 'ready' || !poster.getAttribute('src'); };
    const fail = error => {
        if (status === 'disposed') return;
        if (error) console.warn('Stage video unavailable', error);
        status = 'failed'; clearTimeout(timer); settle(false); show();
    };
    video.addEventListener('canplaythrough', () => {
        if (status !== 'loading') return;
        status = 'ready'; clearTimeout(timer); settle(true); playableNow(); show();
    });
    video.addEventListener('error', () => fail(video.error));
    if (o.poster) read.poster.then(url => { if (url && status !== 'disposed') { poster.src = url; show(); } });
    read.video.then(url => {
        if (status === 'disposed') return;
        if (o.audio && source.audio && source.audio !== 'none' && typeof forkStageAudio !== 'undefined') {
            try { video.muted = false; forkStageAudio.bind(video, source.audio, url, {volume: source.volume, identity: source.hash, loudness: source.loudness, trace: {reason: 'stage-video'}}); bound = true; }
            catch (error) { video.muted = true; console.warn('Stage video sound unavailable', error); }
        }
        if (!bound && typeof forkForeground !== 'undefined') forkForeground.media(video);
        video.src = url;
        video.load();
    }, fail);
    const start = () => {
        const played = video.play();
        if (played && played.catch) played.catch(error => {
            // The autoplay policy may refuse sound before a gesture: the picture still plays, silent.
            if (status !== 'disposed' && error && error.name === 'NotAllowedError' && !video.muted) { video.muted = true; video.play().catch(() => {}); }
        });
    };
    const player = {
        ready, playable,
        // time: the consumer's clock (s); rate: its speed (0 holds); alpha: the layer's opacity (0..1).
        sync({time, rate, alpha}) {
            if (status === 'disposed') return;
            reveal(Math.max(0, Math.min(1, alpha)));
            if (status !== 'ready') return;
            const at = stageVideo.stageVideoTime(source.durationMs, time, o.loop), duration = source.durationMs / 1000;
            let drift = Math.abs(video.currentTime - at.time);
            if (o.loop) drift = Math.min(drift, duration - drift);
            if (!(rate > 0) || at.ended) {
                if (!video.paused) video.pause();
                if (drift > 0.04) video.currentTime = at.time;
                return;
            }
            video.playbackRate = Math.max(0.25, Math.min(4, rate));
            if (drift > 0.3) video.currentTime = at.time;
            if (video.paused) start();
        },
        // A free-running use (a looping skin background): the element's own clock.
        play() { if (status === 'ready') { reveal(1); start(); } else ready.then(ok => { if (ok && status === 'ready') { reveal(1); start(); } }); },
        pause() { if (status !== 'disposed') video.pause(); },
        state: () => ({status, time: video.currentTime, paused: video.paused, muted: video.muted, poster: !poster.hidden}),
        dispose() {
            if (status === 'disposed') return;
            status = 'disposed'; players.delete(player); clearTimeout(timer); settle(false);
            const errors = [];
            for (const release of [
                () => video.pause(),
                () => {if (bound && typeof forkStageAudio !== 'undefined') forkStageAudio.release(video);},
                () => {video.removeAttribute('src'); video.load();},
                () => poster.removeAttribute('src'),
                () => layer.remove(),
                () => read.release()
            ]) {try {release();} catch (error) {errors.push(error);}}
            if (errors.length) throw new AggregateError(errors, 'Stage video player cleanup failed');
        }
    };
    players.add(player);
    return player;
}

return {player:stageVideoPlayer, dispose() {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (const player of [...players]) {try {player.dispose();} catch (error) {errors.push(error);}}
    if (errors.length) throw new AggregateError(errors, 'Stage video cleanup failed');
}};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {createStageVideo};
