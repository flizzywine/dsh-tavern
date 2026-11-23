'use strict';
// 动态立绘: a pack figure's still may carry looping videos (outfit sprite.videos, 视频 entries whose frames hold the picture on
// the left and its alpha matte on the right, stageVideo alpha 'right'): an idle loop, and optionally a talking loop whose
// mouth, jaw and blinks are the video's own. Both are made from the still and start and end on it. The still stays the
// figure: its size, anatomy, anchor, light, tap and avatar never change. A video only stands in for the still's pixels, drawn
// as a child of the figure sprite over the still's rect, so every transform and filter of the figure applies to it as well.
// - The still shows until the idle loop can play, whenever the stage says the motion is off (`on: false`), and for good when
//   the idle loop cannot play (a decode error, no WebGL upload); the change is a short crossfade, never a gap.
// - Speech: the talking loop starts from its first frame when the figure starts speaking and loops while it speaks; when the
//   line ends it plays on to its last frame (the still's pose) and the idle loop takes over from its first frame. Without a
//   playable talking loop the handle says so (`talks()`) and the stage shows the still's own mouths instead.
// - Only a figure on stage plays: a video whose motion is off pauses once it has faded out, and the browser's hidden page
//   pauses it too (forkForeground); a released figure releases its videos (elements, textures and the shared reads).
// - A texture takes each decoded frame once (requestVideoFrameCallback; PIXI's own updates at 30 fps without it) and
//   nothing while the element is paused.
// One H.264 or VP9 file with a side-by-side matte plays with transparency in every browser that plays video (Safari does not
// render a WebM's alpha channel), and decodes in one hardware decoder.
function createStageFigureVideos({document, acquire, foreground}) {
let disposed = false;
const scopes = new Set();
const FADE_MS = 240, SWITCH_MS = 150;
const VERTEX = `attribute vec2 aVertexPosition;attribute vec2 aTextureCoord;uniform mat3 projectionMatrix;uniform mat3 translationMatrix;uniform mat3 uTextureMatrix;varying vec2 vTextureCoord;
void main(){gl_Position=vec4((projectionMatrix*translationMatrix*vec3(aVertexPosition,1.0)).xy,0.0,1.0);vTextureCoord=(uTextureMatrix*vec3(aTextureCoord,1.0)).xy;}`;
// The colour of a point is the left half, its opacity the red of the right half; clamped half a texel from the seam.
const FRAGMENT = `precision mediump float;varying vec2 vTextureCoord;uniform sampler2D uSampler;uniform vec4 uColor;uniform float uSeam;
void main(){float x=clamp(vTextureCoord.x*0.5,0.0,0.5-uSeam);vec3 c=texture2D(uSampler,vec2(x,vTextureCoord.y)).rgb;
float a=texture2D(uSampler,vec2(0.5+clamp(vTextureCoord.x*0.5,uSeam,0.5-uSeam),vTextureCoord.y)).r;gl_FragColor=vec4(c*a,a)*uColor;}`;
function create({PIXI}) {
    if (disposed) throw new Error('Figure videos disposed');
    let closed = false;
    const handles = new Set();
    let program = null;
    // One video of a figure: its element, texture and mesh under the figure's own children (a mouth or a blink over it).
    function clip(sprite, source, loop, place) {
        const video = document.createElement('video');
        video.muted = true; video.defaultMuted = true; video.loop = loop; video.playsInline = true; video.preload = 'auto';
        video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.disablePictureInPicture = true;
        const read = acquire(source, {poster: false});
        const c = {video, status: 'loading', mix: 0, mesh: null, base: null, playing: false};
        c.fail = error => {
            if (c.status === 'released') return;
            if (error) console.warn('[figure-video] still kept', error);
            c.status = 'failed'; c.mix = 0; video.pause(); if (c.mesh) c.mesh.visible = false;
        };
        video.addEventListener('error', () => c.fail(video.error));
        video.addEventListener('loadeddata', () => {
            if (c.status !== 'loading') return;
            try {
                // One upload per decoded frame: the browser's frame callback where it has one, else PIXI's own updates at 30 fps.
                const frames = typeof video.requestVideoFrameCallback === 'function';
                const resource = new PIXI.VideoResource(video, {autoPlay: false, autoLoad: true, updateFPS: 30});
                if (frames) resource.autoUpdate = false;
                c.base = new PIXI.BaseTexture(resource, {mipmap: PIXI.MIPMAP_MODES.OFF});
                if (frames) {
                    const next = () => { if (c.status === 'ready') { resource.update(); video.requestVideoFrameCallback(next); } };
                    video.requestVideoFrameCallback(next);
                }
                program ||= PIXI.Program.from(VERTEX, FRAGMENT, 'figure-video');
                const material = new PIXI.MeshMaterial(new PIXI.Texture(c.base), {program, uniforms: {uSeam: 0.5 / video.videoWidth}});
                c.mesh = new PIXI.Mesh(new PIXI.PlaneGeometry(1, 1, 2, 2), material);
                c.mesh.alpha = 0; c.mesh.visible = false;
                sprite.addChildAt(c.mesh, 0); place(c.mesh);
                c.status = 'ready';
            } catch (error) { c.fail(error); }
        });
        if (foreground) foreground.media(video);
        read.video.then(url => { if (c.status === 'loading') { video.src = url; video.load(); } }, c.fail);
        // from: play from the first frame (the still's pose) rather than where it was.
        c.start = from => {
            if (c.status !== 'ready' || (c.playing && !from && !video.ended)) return;
            c.playing = true;
            if (from || c.mix <= 0 || video.ended) try { video.currentTime = 0; } catch (_) {}
            const played = video.play();
            if (played && played.catch) played.catch(error => { c.playing = false; if (error?.name !== 'AbortError') c.fail(error); });
        };
        c.stop = () => { if (c.playing) { c.playing = false; video.pause(); } };
        // A clip draws once a frame of its current play is on the texture; an ended clip holds its last frame.
        c.fade = (wanted, dt, ms) => {
            if (c.status !== 'ready') return;
            const target = wanted && c.playing && (!video.paused || video.ended) && video.readyState >= 2 ? 1 : 0, step = Math.max(0, dt) / ms;
            c.mix = target > c.mix ? Math.min(target, c.mix + step) : Math.max(target, c.mix - step);
            if (c.mix <= 0 && !wanted) c.stop();
            c.mesh.visible = c.mix > 0; c.mesh.alpha = c.mix;
        };
        c.release = () => {
            c.status = 'released';
            return [
                () => video.pause(),
                () => { video.removeAttribute('src'); video.load(); },
                () => { if (c.mesh && !c.mesh.destroyed) { c.mesh.parent?.removeChild(c.mesh); c.mesh.destroy({children: true}); } },
                () => { if (c.base && !c.base.destroyed) c.base.destroy(); },
                () => read.release()
            ];
        };
        return c;
    }
    // sprite: the figure's PIXI sprite (its texture the still or the still's composed frame, anchor set);
    // motion: {source: the idle loop's 视频 projection, talk: the talking loop's or null, rect: [x, y, w, h] the still canvas
    // px both pictures cover}.
    function attach(sprite, motion) {
        if (closed) return null;
        let on = false, talking = false, phase = 'idle', released = false, last = null;
        const place = mesh => {
            const [x, y, w, h] = motion.rect, ax = sprite.anchor.x * sprite.texture.width, ay = sprite.anchor.y * sprite.texture.height;
            mesh.position.set(x - ax, y - ay); mesh.scale.set(w, h);
        };
        const idle = clip(sprite, motion.source, true, place);
        const talk = motion.talk ? clip(sprite, motion.talk, false, place) : null;
        const clips = talk ? [idle, talk] : [idle];
        // The still draws itself only while no video covers it fully.
        const drawStill = sprite._render;
        sprite._render = function (renderer) { if (!clips.some(c => c.mesh && c.mesh.visible && c.mix >= 1)) drawStill.call(this, renderer); };
        const talks = () => talk?.status === 'ready';
        const handle = {
            // on: the stage wants the motion now (on stage, not reduced motion, no tap still); talking: the figure speaks.
            update({on: nextOn, talking: nextTalking = false}) { on = Boolean(nextOn); talking = Boolean(nextTalking); },
            // Whether a talking loop can show this figure's speech; without one the stage turns the motion off to speak.
            talks,
            // dt: ms since the last frame. Returns whether a video draws this frame.
            tick(dt) {
                if (released) return false;
                if (idle.status === 'failed') { if (talk) { talk.stop(); talk.mix = 0; if (talk.mesh) talk.mesh.visible = false; } return false; }
                if (phase === 'talk' && !talks()) phase = 'idle';
                if (on && phase === 'idle' && talking && talks()) { phase = 'talk'; talk.start(true); }
                if (phase === 'talk' && talk.video.ended) {
                    if (talking && on) talk.start(true);
                    else { phase = 'idle'; if (on) idle.start(true); }
                }
                if (!on && phase === 'talk' && talk.mix <= 0) phase = 'idle';
                const active = phase === 'talk' ? talk : idle;
                if (on) active.start(false);
                // One clip handing over to the other crossfades quicker than the motion fading in over the still.
                const ms = clips.some(c => c !== active && c.mix > 0) ? SWITCH_MS : FADE_MS;
                for (const c of clips) c.fade(on && c === active, dt, ms);
                if (sprite.texture !== last) { last = sprite.texture; for (const c of clips) if (c.mesh) place(c.mesh); }
                return clips.some(c => c.mix > 0);
            },
            state: () => ({status: idle.status, talk: talk ? talk.status : null, phase, on, talking, mix: idle.mix, talkMix: talk ? talk.mix : 0,
                playing: idle.playing, time: idle.video.currentTime, size: [idle.video.videoWidth, idle.video.videoHeight]}),
            destroy() {
                if (released) return;
                released = true; handles.delete(handle);
                const errors = [];
                const steps = [() => { if (sprite._render !== drawStill) sprite._render = drawStill; }];
                for (const c of clips) steps.push(...c.release());
                for (const release of steps) { try { release(); } catch (error) { errors.push(error); } }
                if (errors.length) throw new AggregateError(errors, 'Figure video cleanup failed');
            }
        };
        handles.add(handle);
        return handle;
    }
    const scope = {attach, dispose() {
        if (closed) return; closed = true; scopes.delete(scope);
        const errors = [];
        for (const handle of [...handles]) { try { handle.destroy(); } catch (error) { errors.push(error); } }
        if (program) { program = null; }
        if (errors.length) throw new AggregateError(errors, 'Figure videos cleanup failed');
    }};
    scopes.add(scope);
    return scope;
}
return {create, dispose() {
    if (disposed) return; disposed = true;
    const errors = [];
    for (const scope of [...scopes]) { try { scope.dispose(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Figure videos cleanup failed');
}};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {createStageFigureVideos};
