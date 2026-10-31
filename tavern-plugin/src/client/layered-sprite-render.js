// The base remains immutable. The same compositor drives PIXI and the full GAL dialogue portrait.
function layeredSpriteBundle(model, requested, view = 'stage', fallback = '') {
    const pack = model && model.spritePack, state = layeredSpriteState(pack, requested, fallback);
    return state ? { pack, state, view: state[view], key: model.id + ':' + state.id + ':' + view, revision: JSON.stringify([model.id, state.id, state[view], layeredSpriteAtlas(pack, state), state.mouthFrames, state.initialPhoneme]) } : null;
}
function layeredSpriteUrls(bundle) {
    return bundle ? [bundle.view.src, layeredSpriteAtlas(bundle.pack, bundle.state)?.src, bundle.view.mouthOcclusionMask, ...(bundle.view.blink?.blend === 'replace' ? [bundle.view.blink.closed, bundle.view.blink.half] : [])].filter(Boolean) : [];
}
// Scaling straight from the atlas lets bilinear filtering sample neighbouring frames at the
// patch edges. Isolate each frame first (1:1 copy, cached per atlas image) and scale that.
const layeredSpriteFramePatches = new WeakMap();
function layeredSpriteFramePatch(atlas, f) {
    let patches = layeredSpriteFramePatches.get(atlas);
    if (!patches) { patches = new Map(); layeredSpriteFramePatches.set(atlas, patches); }
    const key = f.x + ',' + f.y + ',' + f.w + ',' + f.h;
    let patch = patches.get(key);
    if (!patch) {
        patch = document.createElement('canvas'); patch.width = f.w; patch.height = f.h;
        patch.getContext('2d').drawImage(atlas, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
        patches.set(key, patch);
    }
    return patch;
}
// Replacement masks store straight RGBA, not opacity to stack over the same coverage.
// Cache the small decoded mask; transparent pixels (including tear exclusions) keep the base.
const blinkPixels = new WeakMap();
function layeredSpriteReplacePatch(ctx, image, rect) {
    let patch = blinkPixels.get(image);
    if (!patch) {
        const work = document.createElement('canvas'); work.width = image.width; work.height = image.height;
        const source = work.getContext('2d'); source.drawImage(image, 0, 0);
        patch = source.getImageData(0, 0, image.width, image.height); blinkPixels.set(image, patch);
    }
    const [x, y, w, h] = rect, target = ctx.getImageData(x, y, w, h);
    for (let i = 0; i < patch.data.length; i += 4) if (patch.data[i + 3]) target.data.set(patch.data.subarray(i, i + 4), i);
    ctx.putImageData(target, x, y);
}
function layeredSpritePaint(canvas, bundle, images, event, blink) {
    const v = bundle.view, a = layeredSpriteAtlas(bundle.pack, bundle.state), base = images.get(v.src), atlas = images.get(a?.src);
    if (!base || base.width !== v.width || base.height !== v.height) throw new Error('分层底图尺寸不匹配');
    if (canvas.width !== v.width) canvas.width = v.width;
    if (canvas.height !== v.height) canvas.height = v.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, v.width, v.height); ctx.drawImage(base, 0, 0);
    const eyes = v.blink;
    if (eyes?.blend === 'replace' && (blink === 'closed' || blink === 'half') && eyes[blink]) layeredSpriteReplacePatch(ctx, images.get(eyes[blink]), eyes.rect);
    const frame = layeredSpriteFrame(bundle.pack, bundle.state, event, v);
    if (!frame) return;
    if (!atlas || atlas.width !== a.width || atlas.height !== a.height) throw new Error('分层 atlas 尺寸不匹配');
    const f = frame.rect, r = v.mouthByFrame?.[frame.id] || v.mouth;
    const before = v.mouthOcclusionMask ? ctx.getImageData(r.x, r.y, r.w, r.h) : null;
    // clear only explicitly authored replacement patches.
    if (f.replace) ctx.clearRect(r.x, r.y, r.w, r.h);
    if (f.w === r.w && f.h === r.h) ctx.drawImage(atlas, f.x, f.y, f.w, f.h, r.x, r.y, r.w, r.h);
    else ctx.drawImage(layeredSpriteFramePatch(atlas, f), 0, 0, f.w, f.h, r.x, r.y, r.w, r.h);
    if (before) {
        const mask = images.get(v.mouthOcclusionMask);
        if (!mask || mask.width !== v.width || mask.height !== v.height) throw new Error('分层遮挡 mask 尺寸不匹配');
        // Luminance is the mask, not alpha. Composite(base, patched, grayscale) like the asset tool.
        const work = document.createElement('canvas'); work.width = r.w; work.height = r.h;
        const mctx = work.getContext('2d'); mctx.drawImage(mask, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        const m = mctx.getImageData(0, 0, r.w, r.h).data, after = ctx.getImageData(r.x, r.y, r.w, r.h);
        for (let i = 0; i < m.length; i += 4) {
            const alpha = (m[i] * 0.299 + m[i + 1] * 0.587 + m[i + 2] * 0.114) / 255;
            for (let channel = 0; channel < 4; channel++) after.data[i + channel] = Math.round(before.data[i + channel] * alpha + after.data[i + channel] * (1 - alpha));
        }
        ctx.putImageData(after, r.x, r.y);
    }
}
const layeredSpriteVoice = (() => {
    const samples = new Map();
    return (key, audio, enabled, now = forkForeground.now()) => {
        const old = samples.get(key);
        if (old && old.audio === audio && old.enabled === enabled && old.paused === audio?.paused && old.ended === audio?.ended && (!audio || audio.currentTime + 0.02 >= old.time) && now >= old.at && now - old.at < 12) return old.event;
        // an editor voice preview is heard whatever the stage mutes (forkStageAudio.preview).
        const audible = typeof forkStageAudio === 'undefined' || !audio || forkStageAudio.audible(audio);
        const active = Boolean(enabled && audible && !document.hidden);
        const value = layeredSpriteVoiceStep(old, audio, active && audio ? forkLipSync.level(audio) : 0, active, now);
        value.enabled = enabled; value.paused = audio?.paused; value.ended = audio?.ended; samples.delete(key); samples.set(key, value);
        while (samples.size > 64) samples.delete(samples.keys().next().value);
        return value.event;
    };
})();
function SpriteImage(props) {
    const h = React.createElement, ref = React.useRef(null), live = React.useRef(props);
    live.current = props;
    const [ready, setReady] = React.useState('');
    const held = React.useRef(null), [,retry] = React.useState(0);
    if (!held.current || held.current.bundle.revision !== props.bundle.revision || held.current.failed && held.current.bundle !== props.bundle) held.current = {bundle:props.bundle,failed:false};
    const bundle = held.current.bundle, identity = bundle.revision;
    React.useEffect(() => {
        let cancelled = false, raf = 0, previous = '', loaded = [];
        const canvas = ref.current; setReady('');
        Promise.all(layeredSpriteUrls(bundle).map(async src => {
            const image = new Image(); image.src = src; await image.decode(); return [src, image];
        })).then(records => {
            if (cancelled) return;
            loaded = records; const images = new Map(records);
            function tick() {
                if (cancelled) return;
                const latest = live.current;
                const event = layeredSpriteVoice(latest.voiceKey, latest.audio, latest.enabled);
                if (event !== previous) {
                    try { layeredSpritePaint(canvas, bundle, images, event); previous = event; setReady(identity); }
                    catch (error) { setReady(''); console.warn('[layered-sprite] portrait retained base', error); return; }
                }
                raf = forkForeground.requestAnimationFrame(tick);
            }
            raf = forkForeground.requestAnimationFrame(tick);
        }).catch(error => { if (!cancelled) {
            held.current.failed = true;
            if (live.current.bundle !== bundle) retry(n => n + 1);
            console.warn('[layered-sprite] portrait retained base', error);
        } });
        return () => { cancelled = true; forkForeground.cancelAnimationFrame(raf); loaded = []; };
    }, [bundle]);
    // keep face orientation on the shared base/canvas wrapper.
    return h('span', { className: (props.className || '') + ' fork-sprite-surface', 'data-enter': props.enter, 'data-out': props.out || undefined, 'data-sprite-state': bundle.state.id, 'data-face-actor': props.faceActor },
        h(PackImage, { identity, src: props.bundle.view.src, alt: '', draggable: false, style: { visibility: ready === identity ? 'hidden' : 'visible' } }),
        h('canvas', { ref, width: bundle.view.width, height: bundle.view.height, 'aria-hidden': true, style: { visibility: ready === identity ? 'visible' : 'hidden' } }));
}
