'use strict';
// 动态立绘: a pack figure's still may carry looping videos (outfit sprite.videos, 视频 entries whose frames hold the picture on
// the left and its alpha matte on the right, stageVideo alpha 'right'): an idle loop, and optionally a talking loop whose
// mouth, jaw and blinks are the video's own. Both are made from the still and start and end on it. The still stays the
// figure: its size, anatomy, anchor, light, tap and avatar never change. A video only stands in for the still's pixels, drawn
// as a child of the figure sprite over the still's rect, so every transform and filter of the figure applies to it as well.
// - The still shows until the idle loop can play, whenever the stage says the motion is off (`on: false`), and for good when
//   the idle loop cannot play (a decode error, no WebGL upload); the change is a short crossfade, never a gap.
// - Speech follows the voice, as the still's mouths do: the talking loop starts from its first frame when the figure's voice
//   is heard and loops while it goes on (gaps between words shorter than VOICE_HOLD_MS count as speech); once the voice
//   stops it plays on to its last frame (the still's pose) and the idle loop takes over from its first frame. No heard voice
//   (voice off, muted, failed), no talking loop. Without a playable talking loop the handle says so (`talks()`) and the stage
//   shows the still's own mouths instead.
// - A change of expression may enter through a transition (motion.enter, a 视频 of the same kind that starts on the
//   previous still's pose and ends on this one's; the shown picture loads its transitions out ahead, motion.into, and hands
//   the loaded one over, so it starts at once): the handle claims the still at once (it does not draw, so the previous
//   picture fading out on top is all that shows), waits up to ENTER_WAIT_MS for the clip, shows it whole under the
//   previous picture's fade (entering() says when), plays it once and hands over to the idle loop - or to the talking loop
//   when the voice is heard by then - from its first frame. A clip that does not come in time, fails, or a motion turned off
//   meanwhile drops the transition: the still shows and the pictures crossfade as without one.
// - Only a figure on stage plays: a video whose motion is off pauses once it has faded out, and the browser's hidden page
//   pauses it too (forkForeground); a released figure releases its videos (elements, textures and the shared reads).
// - A texture takes each decoded frame once (requestVideoFrameCallback; PIXI's own updates at 30 fps without it) and
//   nothing while the element is paused; it is mipmapped (rebuilt per frame), so the downscaled figure does not shimmer.
// - Frame blending (blend() > 0, needs the frame callback): a 24 fps loop on a 60 Hz screen holds its frames for 3 and 2
//   refreshes in turn, a visible unevenness. Two textures keep the latest frame and the one before it, and every refresh
//   draws the point between them where a steady clock stands (the arrival lag of the recent frames, so the picture runs
//   about a frame late but at an even pace); blend is the share of each frame spent crossfading (1: all of it). A loop
//   whose drawings change only every second or third frame (videoCadence) blends between its drawings, not its repeats.
//   Any jump (a start from the first frame) shows the new frame alone.
// One H.264 or VP9 file with a side-by-side matte plays with transparency in every browser that plays video (Safari does not
// render a WebM's alpha channel), and decodes in one hardware decoder.
// A loop drawn on twos (or threes) and encoded at the full rate repeats each drawing: only the frames of one phase change
// the picture. intervals: [[frame index, mean difference from the frame before]]. The one rule: the changes of one phase
// are CADENCE_RATIO times those of the others. Returns {step, phase}: frames whose index % step === phase are new drawings.
const CADENCE_RATIO = 2.5;
function videoCadence(intervals) {
    for (const step of [2, 3]) for (let phase = 0; phase < step; phase++) {
        let on = 0, onCount = 0, off = 0, offCount = 0;
        for (const [index, diff] of intervals) if (index % step === phase) { on += diff; onCount++; } else { off += diff; offCount++; }
        if (onCount >= 4 && offCount >= 4 && on / onCount > CADENCE_RATIO * Math.max(off / offCount, 1e-3)) return {step, phase};
    }
    return {step: 1, phase: 0};
}
function createStageFigureVideos({document, acquire, foreground}) {
let disposed = false;
const scopes = new Set();
const FADE_MS = 240, SWITCH_MS = 150, VOICE_HOLD_MS = 400, ENTER_WAIT_MS = 600;
// Cadence: measured on SAMPLE_W x SAMPLE_H of the colour half over CADENCE_SAMPLES consecutive frames, once per file.
// LAG_FRAMES: the frames whose arrival lag sets the blending clock.
const SAMPLE_W = 32, SAMPLE_H = 48, CADENCE_SAMPLES = 40, LAG_FRAMES = 24;
const cadences = new Map();
const VERTEX = `attribute vec2 aVertexPosition;attribute vec2 aTextureCoord;uniform mat3 projectionMatrix;uniform mat3 translationMatrix;uniform mat3 uTextureMatrix;varying vec2 vTextureCoord;
void main(){gl_Position=vec4((projectionMatrix*translationMatrix*vec3(aVertexPosition,1.0)).xy,0.0,1.0);vTextureCoord=(uTextureMatrix*vec3(aTextureCoord,1.0)).xy;}`;
// The colour of a point is the left half, its opacity the red of the right half; clamped half a texel from the seam.
// Blending: the frame before (uPrev) and the latest (uSampler), premultiplied, mixed at uMix (1: the latest alone).
const FRAGMENT = `precision mediump float;varying vec2 vTextureCoord;uniform sampler2D uSampler;uniform sampler2D uPrev;uniform vec4 uColor;uniform float uSeam;uniform float uMix;
vec4 px(sampler2D s){float x=clamp(vTextureCoord.x*0.5,0.0,0.5-uSeam);vec3 c=texture2D(s,vec2(x,vTextureCoord.y)).rgb;
float a=texture2D(s,vec2(0.5+clamp(vTextureCoord.x*0.5,uSeam,0.5-uSeam),vTextureCoord.y)).r;return vec4(c*a,a);}
void main(){vec4 p=px(uSampler);if(uMix<1.0)p=mix(px(uPrev),p,uMix);gl_FragColor=p*uColor;}`;
// blend: the share of each frame spent crossfading into the next (0: off); now: the clock (ms) read both when a frame
// arrives and when the figure is drawn.
function create({PIXI, blend = () => 0, now = () => performance.now()}) {
    if (disposed) throw new Error('Figure videos disposed');
    let closed = false;
    const handles = new Set();
    let program = null;
    // One video of a figure: its element, texture and mesh under the figure's own children (a mouth or a blink over it).
    // sprite null: a clip loaded ahead without a figure yet (a transition out of the shown picture); adopt gives it one.
    function clip(sprite, source, loop, place) {
        const video = document.createElement('video');
        video.muted = true; video.defaultMuted = true; video.loop = loop; video.playsInline = true; video.preload = 'auto';
        video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.disablePictureInPicture = true;
        const read = acquire(source, {poster: false});
        const c = {video, status: 'loading', mix: 0, mesh: null, playing: false, sprite, place, cur: null, prev: null,
            clock: {jump: true, loops: 0, last: null, lags: [], from: 0, to: 0, dur: 0}};
        c.adopt = (host, at) => {
            c.sprite = host; c.place = at;
            if (c.mesh) { c.mesh.alpha = 0; c.mesh.visible = false; host.addChildAt(c.mesh, 0); at(c.mesh); }
            return c;
        };
        c.fail = error => {
            if (c.status === 'released') return;
            if (error) console.warn('[figure-video] still kept', error);
            c.status = 'failed'; c.mix = 0; video.pause(); if (c.mesh) c.mesh.visible = false;
        };
        video.addEventListener('error', () => c.fail(video.error));
        video.addEventListener('loadeddata', () => {
            if (c.status !== 'loading') return;
            try {
                // One upload per decoded frame: the browser's frame callback where it has one (no throttle of PIXI's own:
                // updateFPS counts PIXI's shared ticker, not the video's frames, and would drop every second one), else
                // PIXI's own updates at 30 fps.
                const frames = typeof video.requestVideoFrameCallback === 'function';
                // Mipmapped: the stage draws a figure at about half its canvas, and a moving picture sampled without mipmaps
                // shimmers along every line (each frame aliases differently); PIXI builds the levels only on a style change,
                // so every new frame marks the style dirty.
                const layer = () => {
                    const resource = new PIXI.VideoResource(video, {autoPlay: false, autoLoad: true, updateFPS: frames ? 0 : 30});
                    if (frames) resource.autoUpdate = false;
                    const base = new PIXI.BaseTexture(resource, {mipmap: PIXI.MIPMAP_MODES.ON});
                    return {resource, base, texture: new PIXI.Texture(base)};
                };
                c.cur = layer();
                program ||= PIXI.Program.from(VERTEX, FRAGMENT, 'figure-video');
                const material = new PIXI.MeshMaterial(c.cur.texture, {program, uniforms: {uSeam: 0.5 / video.videoWidth, uPrev: c.cur.texture, uMix: 1}});
                if (frames) {
                    const next = (_, meta) => { if (c.status === 'ready') { frame(now(), meta, layer, material); video.requestVideoFrameCallback(next); } };
                    video.requestVideoFrameCallback(next);
                }
                c.mesh = new PIXI.Mesh(new PIXI.PlaneGeometry(1, 1, 2, 2), material);
                c.mesh.alpha = 0; c.mesh.visible = false;
                if (c.sprite) { c.sprite.addChildAt(c.mesh, 0); c.place(c.mesh); }
                c.status = 'ready';
            } catch (error) { c.fail(error); }
        });
        if (foreground) foreground.media(video);
        read.video.then(url => { if (c.status === 'loading') { video.src = url; video.load(); } }, c.fail);
        const upload = at => { at.resource.update(); at.base.dirtyStyleId++; };
        // A decoded frame (at: its arrival, meta its metadata): uploaded as is, or, blending, into the
        // texture of the frame before last, which becomes the latest.
        const frame = (at, meta, layer, material) => {
            const clock = c.clock, strength = blend();
            if (!(strength > 0)) { clock.jump = true; upload(c.cur); return; }
            if (clock.jump) { clock.loops = 0; clock.last = null; clock.lags = []; }
            const last = clock.last;
            if (last && meta.mediaTime < last.mediaTime) clock.loops++;
            if (last && meta.presentedFrames === last.presentedFrames + 1 && meta.mediaTime - last.mediaTime > 0.004) clock.dur = Math.min(clock.dur || Infinity, meta.mediaTime - last.mediaTime);
            clock.last = meta;
            const media = meta.mediaTime + clock.loops * (video.duration || 0), index = clock.dur ? Math.round(meta.mediaTime / clock.dur) : null;
            clock.lags.push(at - media * 1000); if (clock.lags.length > LAG_FRAMES) clock.lags.shift();
            const cadence = measureCadence(index);
            if (!clock.jump && index != null && index % cadence.step !== cadence.phase) return;
            c.prev ||= layer();
            [c.prev, c.cur] = [c.cur, c.prev];
            upload(c.cur);
            material.texture = c.cur.texture; material.uniforms.uPrev = c.prev.texture;
            clock.from = clock.jump ? media : clock.to; clock.to = media; clock.jump = false;
        };
        // The file's cadence, measured once on its first consecutive frames while blending (step 1 until then).
        const key = source && (source.hash || source.bundleKey);
        let sampler = null, samples = [], lastSample = null, lastIndex = null;
        const measureCadence = index => {
            if (cadences.has(key)) return cadences.get(key);
            if (index == null || !video.videoWidth) return {step: 1, phase: 0};
            if (!sampler) { const canvas = document.createElement('canvas'); canvas.width = SAMPLE_W; canvas.height = SAMPLE_H; sampler = canvas.getContext('2d', {willReadFrequently: true}); }
            sampler.drawImage(video, 0, 0, video.videoWidth / 2, video.videoHeight, 0, 0, SAMPLE_W, SAMPLE_H);
            const data = sampler.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data, shade = new Float32Array(SAMPLE_W * SAMPLE_H);
            for (let i = 0; i < shade.length; i++) shade[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
            if (lastSample && index === lastIndex + 1) {
                let sum = 0; for (let i = 0; i < shade.length; i++) sum += Math.abs(shade[i] - lastSample[i]);
                samples.push([index, sum / shade.length]);
            }
            lastSample = shade; lastIndex = index;
            if (samples.length < CADENCE_SAMPLES) return {step: 1, phase: 0};
            const cadence = videoCadence(samples);
            if (key) cadences.set(key, cadence);
            sampler = null; samples = []; lastSample = null;
            return cadence;
        };
        c.cadence = () => cadences.get(key) || null;
        // Per drawn frame: where the steady clock stands between the frame before and the latest.
        c.blend = time => {
            if (!c.mesh || !c.prev) return;
            const strength = blend(), clock = c.clock;
            let mix = 1;
            if (strength > 0 && clock.to > clock.from && clock.lags.length) {
                // The clock runs one drawing behind the arrivals at their usual lag (the median: a late frame only holds the
                // crossfade's end a moment, an early one starts it a little in): at a new drawing it stands on the one before,
                // and it reaches the new one as the next arrives.
                const lags = [...clock.lags].sort((a, b) => a - b), lag = lags[lags.length >> 1];
                const span = clock.to - clock.from, along = ((time - lag) / 1000 - span - clock.from) / span, share = Math.min(1, strength);
                mix = Math.min(1, Math.max(0, (along - (1 - share)) / share));
            }
            c.mesh.material.uniforms.uMix = mix;
        };
        // from: play from the first frame (the still's pose) rather than where it was.
        c.start = from => {
            if (c.status !== 'ready' || (c.playing && !from && !video.ended)) return;
            c.playing = true;
            if (from || c.mix <= 0 || video.ended) { c.clock.jump = true; try { video.currentTime = 0; } catch (_) {} }
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
                () => { for (const at of [c.cur, c.prev]) if (at && !at.base.destroyed) at.base.destroy(); },
                () => read.release()
            ];
        };
        return c;
    }
    // sprite: the figure's PIXI sprite (its texture the still or the still's composed frame, anchor set);
    // motion: {source: the idle loop's 视频 projection, talk: the talking loop's or null, rect: [x, y, w, h] the still canvas
    // px both pictures cover, enter: {source, rect} the transition this picture enters through, or none}.
    function attach(sprite, motion) {
        if (closed) return null;
        let on = false, talking = false, quiet = Infinity, released = false, last = null, waited = 0;
        const placer = rect => mesh => {
            const [x, y, w, h] = rect, ax = sprite.anchor.x * sprite.texture.width, ay = sprite.anchor.y * sprite.texture.height;
            mesh.position.set(x - ax, y - ay); mesh.scale.set(w, h);
        };
        const place = placer(motion.rect);
        const idle = clip(sprite, motion.source, true, place);
        const talk = motion.talk ? clip(sprite, motion.talk, false, place) : null;
        const placeEnter = motion.enter ? placer(motion.enter.rect) : null;
        const enter = !motion.enter ? null : motion.enter.clip ? motion.enter.clip.adopt(sprite, placeEnter) : clip(sprite, motion.enter.source, false, placeEnter);
        const clips = [idle, talk, enter].filter(Boolean);
        // The transitions out of this picture load ahead (no figure yet), so a change of expression starts at once: the
        // next picture's handle takes its clip (lend) and the rest go with this one.
        const ahead = new Map(Object.entries(motion.into || {}).map(([image, out]) => [image, clip(null, out.source, false, null)]));
        const placeAll = () => { for (const c of clips) if (c.mesh) (c === enter ? placeEnter : place)(c.mesh); };
        let phase = enter ? 'enter' : 'idle';
        // The still draws itself only while no video covers it fully, and not while a transition is awaited.
        const drawStill = sprite._render;
        sprite._render = function (renderer) { if (phase !== 'enter' && !clips.some(c => c.mesh && c.mesh.visible && c.mix >= 1)) drawStill.call(this, renderer); };
        const talks = () => talk?.status === 'ready';
        // Leaves the transition: the clip stops and drops out of sight, the still is back.
        const dropEnter = () => { phase = 'idle'; enter.stop(); enter.mix = 0; if (enter.mesh) enter.mesh.visible = false; };
        const handle = {
            // on: the stage wants the motion now (on stage, not reduced motion, no tap still); talking: the figure's voice is
            // heard this frame (its mouth would be open).
            update({on: nextOn, talking: nextTalking = false}) { on = Boolean(nextOn); talking = Boolean(nextTalking); },
            // Whether a talking loop can show this figure's speech; without one the stage turns the motion off to speak.
            talks,
            // The transition this picture enters through: 'pending' while it is awaited (the still does not draw), 'on' once it
            // covers the picture, null without one or once it is over or dropped.
            entering: () => phase !== 'enter' ? null : enter.mix >= 1 ? 'on' : 'pending',
            // The loaded-ahead transition into IMAGE, handed to the picture that enters through it (motion.enter.clip).
            lend(image) { const c = ahead.get(image) || null; ahead.delete(image); return c; },
            // dt: ms since the last frame. Returns whether a video draws this frame (or a transition holds the still back).
            tick(dt) {
                if (released) return false;
                const time = now();
                for (const c of clips) c.blend(time);
                quiet = talking ? 0 : quiet + Math.max(0, dt);
                const speaking = quiet < VOICE_HOLD_MS;
                if (sprite.texture !== last) { last = sprite.texture; placeAll(); }
                if (phase === 'enter') {
                    waited += Math.max(0, dt);
                    if (!on || enter.status === 'failed' || enter.mix < 1 && waited > ENTER_WAIT_MS) dropEnter();
                    else if (enter.status === 'ready' && enter.playing && enter.video.ended) {
                        // Played out on this picture's pose: the loop that fits the voice now takes over from its first frame.
                        phase = speaking && talks() ? 'talk' : 'idle';
                        (phase === 'talk' ? talk : idle).start(true);
                    } else if (enter.status === 'ready') {
                        enter.start(false);
                        // Shown whole at once: its first frame is the previous picture, which fades out over it.
                        if (enter.playing && enter.video.readyState >= 2) { enter.mix = 1; enter.mesh.visible = true; enter.mesh.alpha = 1; }
                    }
                    if (phase === 'enter') return true;
                }
                if (idle.status === 'failed') {
                    for (const c of clips) if (c !== idle) { c.stop(); c.mix = 0; if (c.mesh) c.mesh.visible = false; }
                    return false;
                }
                if (phase === 'talk' && !talks()) phase = 'idle';
                if (on && phase === 'idle' && talking && talks()) { phase = 'talk'; talk.start(true); }
                if (phase === 'talk' && talk.video.ended) {
                    if (speaking && on) talk.start(true);
                    else { phase = 'idle'; if (on) idle.start(true); }
                }
                if (!on && phase === 'talk' && talk.mix <= 0) phase = 'idle';
                const active = phase === 'talk' ? talk : idle;
                if (on) active.start(false);
                // A hand-off between the clips fades the incoming one in over the outgoing one, which stays whole underneath
                // until the incoming one covers it, so the still never shows between them; it is quicker than the motion
                // fading in over the still.
                const outgoing = clips.find(c => c !== active && c.mix > 0);
                if (outgoing && active.mesh && outgoing.mesh) {
                    const at = sprite.children.indexOf(outgoing.mesh);
                    if (sprite.children.indexOf(active.mesh) < at) { sprite.removeChild(active.mesh); sprite.addChildAt(active.mesh, at); }
                }
                const ms = outgoing ? SWITCH_MS : FADE_MS;
                for (const c of clips) {
                    if (c === active) c.fade(on, dt, ms);
                    else if (!(on && active.status === 'ready' && active.mix < 1 && c.mix > 0)) c.fade(false, dt, ms);
                }
                return clips.some(c => c.mix > 0);
            },
            state: () => ({status: idle.status, talk: talk ? talk.status : null, enter: enter ? enter.status : null, phase, on, talking, mix: idle.mix, talkMix: talk ? talk.mix : 0, enterMix: enter ? enter.mix : 0,
                playing: idle.playing, time: idle.video.currentTime, size: [idle.video.videoWidth, idle.video.videoHeight], cadence: idle.cadence(), blending: Boolean(idle.prev) && blend() > 0,
                blendMix: idle.prev ? idle.mesh.material.uniforms.uMix : null}),
            destroy() {
                if (released) return;
                released = true; handles.delete(handle);
                const errors = [];
                const steps = [() => { if (sprite._render !== drawStill) sprite._render = drawStill; }];
                for (const c of [...clips, ...ahead.values()]) steps.push(...c.release());
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
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {createStageFigureVideos, videoCadence};
