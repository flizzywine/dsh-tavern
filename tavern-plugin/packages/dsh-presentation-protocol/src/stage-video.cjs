'use strict';
// the 视频 asset kind (`videos`) - one first-class stage video that
// any stage feature references by entry id (an entrance's `video` layer today; performances / cut-ins, CG movies, OP/ED and
// skins use the same entry and player). The inert contract shared by the pack importer (validation once, on write), the host
// (projection) and the stage player (its playback position). Nothing here names a work.
// An entry: bundleKey - its 'video' bundle, which holds exactly two files: entry (the video: WebM or MP4) and poster (a still
// image shown until the video can play, and instead of it when it cannot); durationMs; loop - the default playback (a consumer
// may override it); audio - the stage mixer layer its soundtrack plays on ('none': the file is silent or its sound is never
// used); size - its intrinsic [width, height] in pixels; fit - how it fills the stage ('cover' crops, 'contain' letterboxes);
// volume - the authored level of its sound (0..1).
function stageVideoContract() {
    const FIELDS = ['bundleKey', 'entry', 'poster', 'durationMs', 'loop', 'audio', 'size', 'fit', 'volume', 'loudness'];
    const REQUIRED = ['bundleKey', 'entry', 'poster', 'durationMs', 'size'];
    const AUDIO = ['none', 'music', 'sfx', 'ambience'];
    const FITS = ['cover', 'contain'];
    const VIDEO_TYPES = { webm: 'video/webm', mp4: 'video/mp4' };
    const POSTER_TYPES = ['webp', 'png', 'jpg', 'jpeg'];
    const MAX_BYTES = 96 * 1024 * 1024, MAX_MS = 10 * 60 * 1000;
    const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const isId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
    const isFile = (value, types) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}(\/[a-z0-9][a-z0-9_-]{0,63}){0,3}\.[a-z0-9]+$/.test(value)
        && types.includes(value.slice(value.lastIndexOf('.') + 1));
    function fail(path, message) { throw Object.assign(new TypeError(path + ': ' + message), { code: 'INVALID_ASSET_PACK', path }); }
    function check(ok, path, message) { if (!ok) fail(path, message); }
    function validateStageVideo(content, path) {
        const at = path || '$';
        check(isObject(content), at, 'expected an object');
        for (const key of Object.keys(content)) check(FIELDS.includes(key), at + '.' + key, 'unknown field');
        for (const key of REQUIRED) check(Object.hasOwn(content, key), at + '.' + key, 'required');
        check(isId(content.bundleKey), at + '.bundleKey', 'expected a bundle key');
        check(isFile(content.entry, Object.keys(VIDEO_TYPES)), at + '.entry', 'expected a .webm or .mp4 file in the bundle (lower-case names)');
        check(isFile(content.poster, POSTER_TYPES), at + '.poster', 'expected a .webp, .png or .jpg file in the bundle (lower-case names)');
        check(content.poster !== content.entry, at + '.poster', 'the poster is its own file');
        check(Number.isInteger(content.durationMs) && content.durationMs >= 1 && content.durationMs <= MAX_MS, at + '.durationMs', 'expected 1..' + MAX_MS + ' ms');
        check(Array.isArray(content.size) && content.size.length === 2 && content.size.every(n => Number.isInteger(n) && n >= 16 && n <= 8192), at + '.size', 'expected [width, height], 16..8192 px');
        if (content.loop !== undefined) check(typeof content.loop === 'boolean', at + '.loop', 'expected true or false');
        if (content.audio !== undefined) check(AUDIO.includes(content.audio), at + '.audio', 'expected one of ' + AUDIO.join(', '));
        if (content.fit !== undefined) check(FITS.includes(content.fit), at + '.fit', 'expected one of ' + FITS.join(', '));
        if (content.volume !== undefined) check(typeof content.volume === 'number' && content.volume >= 0 && content.volume <= 1, at + '.volume', 'expected 0..1');
        return content;
    }
    // The bundle's files, video first (it is the bundle's entry).
    function stageVideoFiles(content) { return [content.entry, content.poster]; }
    // The container a file's first bytes declare: 'webm' (EBML), 'mp4' (an ISO BMFF ftyp box) or null.
    function stageVideoSignature(bytes) {
        if (!bytes || bytes.length < 12) return null;
        if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
        if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'mp4';
        return null;
    }
    // Where a video shows at clock `seconds` (s): a loop wraps; a single play holds its last frame. {time, ended}.
    function stageVideoTime(durationMs, seconds, loop) {
        const duration = durationMs / 1000, t = Math.max(0, Number(seconds) || 0);
        if (loop) return { time: duration > 0 ? t % duration : 0, ended: false };
        return { time: Math.min(t, Math.max(0, duration - 0.001)), ended: t >= duration };
    }
    return Object.freeze({ STAGE_VIDEO_FIELDS: FIELDS, STAGE_VIDEO_AUDIO: AUDIO, STAGE_VIDEO_FITS: FITS, STAGE_VIDEO_TYPES: VIDEO_TYPES,
        STAGE_VIDEO_MAX_BYTES: MAX_BYTES, validateStageVideo, stageVideoFiles, stageVideoSignature, stageVideoTime });
}
const stageVideo = stageVideoContract();
if (typeof module !== 'undefined' && typeof window === 'undefined' && module.exports) module.exports = Object.assign({ stageVideoContract }, stageVideo);
