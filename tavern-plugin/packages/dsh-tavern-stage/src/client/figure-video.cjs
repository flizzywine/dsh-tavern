'use strict';
// 动态立绘: a pack figure's still may carry a looping video (outfit sprite.videos, a 视频 entry whose
// frames hold the picture on the left and its alpha matte on the right, stageVideo alpha 'right'). The still stays the figure:
// its size, anatomy, anchor, light, tap and avatar never change. The video only stands in for the still's pixels, drawn as a
// child of the figure sprite over the still's rect, so every transform and filter of the figure applies to it as well.
// - The still shows until the video can play, whenever the stage says the motion is off (`on: false`), and for good when the
//   video cannot play (a decode error, no WebGL upload); the change is a short crossfade, never a gap.
// - Only a figure on stage plays: a video whose motion is off pauses once it has faded out, and the browser's hidden page
//   pauses it too (forkForeground); a released figure releases its video (element, texture and the shared read).
// - The texture takes each decoded frame once (requestVideoFrameCallback; PIXI's own updates at 30 fps without it) and
//   nothing while the element is paused.
// One H.264 or VP9 file with a side-by-side matte plays with transparency in every browser that plays video (Safari does not
// render a WebM's alpha channel), and decodes in one hardware decoder.
function createStageFigureVideos({document, acquire, foreground}) {
let disposed = false;
const scopes = new Set();
const FADE_MS = 240;
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
    // sprite: the figure's PIXI sprite (its texture the still or the still's composed frame, anchor set);
    // motion: {source: the host's projection of the 视频 entry, rect: [x, y, w, h] the still canvas px the picture covers}.
    function attach(sprite, motion) {
        if (closed) return null;
        const video = document.createElement('video');
        video.muted = true; video.defaultMuted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
        video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.disablePictureInPicture = true;
        const read = acquire(motion.source, {poster: false});
        let status = 'loading', on = false, mix = 0, mesh = null, base = null, last = null, playing = false;
        const fail = error => {
            if (status === 'released') return;
            if (error) console.warn('[figure-video] still kept', error);
            status = 'failed'; video.pause();
        };
        const place = () => {
            const [x, y, w, h] = motion.rect, ax = sprite.anchor.x * sprite.texture.width, ay = sprite.anchor.y * sprite.texture.height;
            mesh.position.set(x - ax, y - ay); mesh.scale.set(w, h);
        };
        video.addEventListener('error', () => fail(video.error));
        video.addEventListener('loadeddata', () => {
            if (status !== 'loading') return;
            try {
                // One upload per decoded frame: the browser's frame callback where it has one, else PIXI's own updates at 30 fps.
                const frames = typeof video.requestVideoFrameCallback === 'function';
                const resource = new PIXI.VideoResource(video, {autoPlay: false, autoLoad: true, updateFPS: 30});
                if (frames) resource.autoUpdate = false;
                base = new PIXI.BaseTexture(resource, {mipmap: PIXI.MIPMAP_MODES.OFF});
                if (frames) {
                    const next = () => { if (status === 'ready') { resource.update(); video.requestVideoFrameCallback(next); } };
                    video.requestVideoFrameCallback(next);
                }
                program ||= PIXI.Program.from(VERTEX, FRAGMENT, 'figure-video');
                const material = new PIXI.MeshMaterial(new PIXI.Texture(base), {program, uniforms: {uSeam: 0.5 / video.videoWidth}});
                mesh = new PIXI.Mesh(new PIXI.PlaneGeometry(1, 1, 2, 2), material);
                mesh.alpha = 0; mesh.visible = false;
                // Under the figure's own children (a mouth or a blink drawn over it).
                sprite.addChildAt(mesh, 0); place();
                status = 'ready';
            } catch (error) { fail(error); }
        });
        // The still draws itself only while the video does not cover it fully.
        const drawStill = sprite._render;
        sprite._render = function (renderer) { if (!(mesh && mesh.visible && mix >= 1)) drawStill.call(this, renderer); };
        if (foreground) foreground.media(video);
        read.video.then(url => { if (status === 'loading') { video.src = url; video.load(); } }, fail);
        const start = () => {
            if (playing || status !== 'ready') return;
            playing = true;
            // From the first frame: it is the still (the loop is made from it), so the crossfade starts on the same pose.
            if (mix <= 0) try { video.currentTime = 0; } catch (_) {}
            const played = video.play();
            if (played && played.catch) played.catch(error => { playing = false; if (error?.name !== 'AbortError') fail(error); });
        };
        const stop = () => { if (playing) { playing = false; video.pause(); } };
        const handle = {
            // on: the stage wants the motion now (on stage, not reduced motion, no speech the still has to show).
            update({on: next}) { on = Boolean(next); },
            // dt: ms since the last frame. Returns whether the video draws this frame.
            tick(dt) {
                if (status === 'released') return false;
                if (status === 'failed') { mix = 0; if (mesh) mesh.visible = false; return false; }
                if (status !== 'ready') return false;
                if (on) start();
                // Fade in only once a frame of the current play is on the texture; fade out at once.
                const shown = on && playing && !video.paused && video.readyState >= 2;
                const target = shown ? 1 : 0, step = Math.max(0, dt) / FADE_MS;
                mix = target > mix ? Math.min(target, mix + step) : Math.max(target, mix - step);
                if (mix <= 0 && !on) stop();
                if (sprite.texture !== last) { last = sprite.texture; place(); }
                mesh.visible = mix > 0; mesh.alpha = mix;
                return mix > 0;
            },
            state: () => ({status, on, mix, playing, time: video.currentTime, size: [video.videoWidth, video.videoHeight]}),
            destroy() {
                if (status === 'released') return;
                status = 'released'; handles.delete(handle);
                const errors = [];
                for (const release of [
                    () => video.pause(),
                    () => { video.removeAttribute('src'); video.load(); },
                    () => { if (sprite._render !== drawStill) sprite._render = drawStill; },
                    () => { if (mesh && !mesh.destroyed) { mesh.parent?.removeChild(mesh); mesh.destroy({children: true}); } },
                    () => { if (base && !base.destroyed) base.destroy(); },
                    () => read.release()
                ]) { try { release(); } catch (error) { errors.push(error); } }
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
