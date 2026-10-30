// @include performance-keyframes.cjs
// @include performance-keyframe-gl.js
// plays a performance's keyframe layers on the runtime's
// tokens. A non-snap phase start (descriptor null) runs the clock from the same foreground time as the performance timeline;
// snaps, skips, history and remounts only show the resting frame (persistent entry end, else nothing). No frame state is
// stored anywhere: the resting frame is derived from the document.
const KEYFRAME_STILL_FADE_MS = 400;
function keyframeDependency(value) {
    const ref = value?.ref;
    return ref && value.dependencies?.find(item => item.ref?.kind === 'performances' && item.ref.packId === ref.packId && item.ref.assetId === ref.assetId && item.document?.keyframes) || null;
}
// The performance's own document (dsh.performance/1), keyframes or not: its presentation-only fields (shot, holdDialogue).
function performanceOwnDocument(value) {
    const ref = value?.ref;
    return ref && value.dependencies?.find(item => item.ref?.kind === 'performances' && item.ref.packId === ref.packId && item.ref.assetId === ref.assetId)?.document || null;
}
function keyframeFontFamily(id) {
    const font = typeof tavernFonts !== 'undefined' ? tavernFonts.get(id) : null;
    return (font ? JSON.stringify(font.family) + ', ' : '') + '"Noto Serif SC", "Noto Serif JP", serif';
}
// Text layers are typeset once at 2.5x the reference size (a 3840 px wide stage draws the 1600 px reference at 2.4x, so glyphs
// stay crisp at 4K); the compositor uses only glyph coverage, coloured by the tint.
function keyframeTextCanvas(layer, make = () => document.createElement('canvas')) {
    const k = Math.min(2.5, 4096 / Math.max(layer.width, layer.height)), canvas = make();
    canvas.width = Math.max(1, Math.ceil(layer.width * k)); canvas.height = Math.max(1, Math.ceil(layer.height * k));
    const context = canvas.getContext('2d'), text = layer.text, size = text.size * k, line = size * (text.lineHeight ?? 1.2);
    const rows = text.value.split('\n'), align = text.align || 'center';
    context.font = size + 'px ' + keyframeFontFamily(text.font);
    context.letterSpacing = (text.letterSpacing || 0) * k + 'px';
    context.textAlign = align; context.textBaseline = 'middle';
    const x = align === 'left' ? 0 : align === 'right' ? canvas.width : canvas.width / 2, top = canvas.height / 2 - line * (rows.length - 1) / 2;
    rows.forEach((row, index) => context.fillText(row, x, top + index * line));
    return canvas;
}
// Fonts are prepared before the performance group is accepted, i.e. before the clock starts.
function keyframeFonts(value) {
    const layers = (value?.dependencies || []).flatMap(item => item.document?.keyframes?.layers || []).filter(layer => layer.text);
    return Promise.all(layers.map(async layer => {
        if (typeof tavernFonts !== 'undefined') await tavernFonts.ensure(layer.text.font).catch(() => null);
        await document.fonts?.load(layer.text.size + 'px ' + keyframeFontFamily(layer.text.font), layer.text.value).catch(() => null);
    }));
}
// onPlayback: what the stage's presentation follows -
// {document, value, phase: 'entry' | 'exit' (a keyframe phase is playing) | 'rest' (the performance holds, nothing plays)}
// or null (no performance holds). Reported on change only; history, skip and remounts report 'rest' at once.
function createPerformanceKeyframeLayer({root, owner, foreground, rects, safety = () => ({}), onPresentation = () => {}, onPlayback = () => {}, canvas: makeCanvas = () => document.createElement('canvas')}) {
    const surfaces = {}, prepared = new Map();
    let shown = null, frame = null, disposed = false, policy = safety(), presentation = null, playbackKey = 'null';
    function playback(value, phase) {
        const document = value && performanceOwnDocument(value), next = document ? {document, value, phase} : null;
        const key = JSON.stringify(next && [next.value.instanceKey, next.value.ref, next.value.startedAt, next.value.topic, phase]);
        if (key !== playbackKey) { playbackKey = key; onPlayback(next); }
    }
    function present(entry) {
        const next = entry?.presentation || null;
        if (next !== presentation) { presentation = next; onPresentation(next); }
    }
    const tokenKey = token => JSON.stringify(token || null);
    function prepare(value, handles) {
        const dependency = keyframeDependency(value);
        if (!dependency) return null;
        if (prepared.has(dependency.identity)) { const entry=prepared.get(dependency.identity); entry.presentation=value; return entry; }
        const handle = handles.find(item => item.identity === dependency.identity);
        const model = compilePerformanceKeyframes(dependency.document), base = (dependency.entry || 'performance.json').replace(/[^/]*$/, '');
        const file = name => {
            const image = handle?.files[base + name]?.image;
            if (!image) throw new Error('Keyframe image is missing: ' + name);
            return image;
        };
        const texts = new Map(model.layers.filter(layer => layer.text).map(layer => [layer.id, keyframeTextCanvas(layer, makeCanvas)]));
        const images = {file, layer:layer => layer.kind === 'text' ? texts.get(layer.id) : file(layer.image)};
        const sources = new Map();
        for (const layer of model.layers) {
            if (layer.kind !== 'solid') sources.set(images.layer(layer), true);
            if (layer.dissolve) sources.set(file(layer.dissolve.image), sources.get(file(layer.dissolve.image)) || false);
        }
        let bytes = 0;
        for (const source of sources.keys()) bytes += Math.ceil((source.naturalWidth || source.width) * (source.naturalHeight || source.height) * 4 * 4 / 3);
        const entry = {identity:dependency.identity, presentation:value, document:dependency.document, model, images, sources, allocation:owner.reserveBytes(bytes), placements:new Set(model.layers.map(layer => layer.placement))};
        prepared.set(dependency.identity, entry);
        return entry;
    }
    function surface(placement) {
        if (surfaces[placement]) return surfaces[placement];
        const node = makeCanvas();
        node.className = 'fork-performance-keyframes ' + (placement === 'above-dialogue' ? 'is-above' : 'is-below');
        node.setAttribute('aria-hidden', 'true'); root.appendChild(node);
        return surfaces[placement] = {node, compositor:createKeyframeCompositor(node), allocation:null, uploaded:new Set()};
    }
    function view(target) {
        const screen = rects.getSnapshot().screen, ratio = galResolution("high");
        const width = Math.max(1, Math.round(screen.w * ratio)), height = Math.max(1, Math.round(screen.h * ratio));
        if (target.allocation?.bytes !== width * height * 4) { target.allocation?.release(); target.allocation = owner.reserveBytes(width * height * 4); }
        return {width, height};
    }
    function draw(entries, opacity = 1) {
        present(entries[0]?.entry);
        const used = new Set();
        for (const {entry, states} of entries) for (const placement of entry.placements) {
            const target = surface(placement);
            if (!target.uploaded.has(entry)) { target.compositor.prepare(entry.sources); target.uploaded.add(entry); }
            used.add(placement);
        }
        for (const [placement, target] of Object.entries(surfaces)) {
            if (!used.has(placement)) { target.compositor.clear(); continue; }
            const draws = entries.flatMap(({entry, states, still, t}) => keyframeDrawList(entry.model, states, placement, {still, t, photosensitive:policy.photosensitive !== false || !!policy.calm})
                .map(item => ({...item, alpha:item.alpha * opacity, images:entry.images})));
            target.compositor.draw(draws, view(target));
        }
    }
    // Drops GPU textures and allocations no longer needed by the shown performance (and its retiring exit).
    function retain(keep) {
        for (const [identity, entry] of prepared) {
            if (keep.has(entry)) continue;
            for (const target of Object.values(surfaces)) if (target.uploaded.delete(entry)) target.compositor.release(entry.sources.keys());
            entry.allocation.release(); prepared.delete(identity);
        }
        if (!prepared.size) for (const [placement, target] of Object.entries(surfaces)) {
            target.compositor.dispose(); target.allocation?.release(); target.node.remove(); delete surfaces[placement];
        }
    }
    function stopClock() { if (frame !== null) foreground.cancelAnimationFrame(frame); frame = null; }
    // Resting frame: a persistent performance outside its exit holds the entry end; everything else leaves no layer.
    function rest(value, entry) {
        stopClock();
        const holding = entry && entry.model.playback === 'persistent' && value.phase !== 'exit';
        // A performance without keyframes holds from its start to its exit (phase-free).
        playback(holding || !entry && value.phase !== 'exit' ? value : null, 'rest');
        shown = holding ? {entry, instanceKey:JSON.stringify(value.instanceKey), token:null} : null;
        retain(new Set(holding ? [entry] : []));
        if (holding) draw([{entry, states:entry.model.entryEnd}]);
        else present(null);
    }
    function tick() {
        frame = null;
        if (disposed || !shown?.segments) return;
        const t = foreground.now() - shown.startedAt, segment = shown.segments.find(item => t < item.from + item.duration);
        if (!segment) { rest(shown.value, shown.entry); return; }
        const local = Math.max(0, t - segment.from), still = !!policy.reducedMotion;
        playback(segment.entry === shown.entry ? shown.value : segment.entry.presentation, segment.phase);
        if (!still) { shown.still = null; draw([{entry:segment.entry, states:sampleKeyframePhase(segment.entry.model, segment.phase, local), t:local}]); }
        else {
            // 减少动态: one static composite (entry end for a persistent entry, else the phase midpoint), opacity-only fades.
            const persistentEntry = segment.phase === 'entry' && segment.entry.model.playback === 'persistent';
            const states = persistentEntry ? segment.entry.model.entryEnd : sampleKeyframePhase(segment.entry.model, segment.phase, segment.duration / 2);
            const fade = Math.min(KEYFRAME_STILL_FADE_MS, segment.duration / 2);
            const opacity = Math.min(1, local / fade, persistentEntry ? 1 : (segment.duration - local) / fade);
            // The held composite is drawn once; only the fades redraw.
            if (opacity < 1 || shown.still !== segment) draw([{entry:segment.entry, states, still:true, t:persistentEntry ? segment.duration : segment.duration / 2}], Math.max(0, opacity));
            shown.still = opacity < 1 ? null : segment;
        }
        frame = foreground.requestAnimationFrame(tick);
    }
    function start(intent, entry) {
        stopClock();
        const value = intent.value, segments = [], retiring = value.retiring;
        let offset = 0;
        if (retiring) {
            offset = retiring.plan?.durationMs || 0;
            const old = shown?.entry;
            if (old && old.model.exit && shown.instanceKey === JSON.stringify(retiring.instanceKey))
                segments.push({entry:old, phase:'exit', from:0, duration:old.model.exit.durationMs});
        }
        if (entry && value.phase === 'entry') segments.push({entry, phase:'entry', from:offset, duration:entry.model.entry.durationMs});
        if (entry && value.phase === 'exit' && entry.model.exit) segments.push({entry, phase:'exit', from:offset, duration:entry.model.exit.durationMs});
        if (!segments.length) { rest(value, entry); return; }
        retain(new Set(segments.map(item => item.entry)));
        for (const target of Object.values(surfaces)) root.appendChild(target.node); // stay after a re-created text box
        shown = {entry, value, instanceKey:JSON.stringify(value.instanceKey), token:tokenKey(intent.token), segments, startedAt:foreground.now()};
        tick();
    }
    return {
        apply(intent) {
            if (disposed) return;
            if (intent.type === 'clear') { stopClock(); shown = null; retain(new Set()); present(null); playback(null); return; }
            if (intent.type === 'cancel') {
                if (shown?.segments && shown.token === tokenKey(intent.token)) rest(shown.value, shown.entry);
                return;
            }
            if (intent.type !== 'layer') return;
            const playing = shown?.segments && shown.token === tokenKey(intent.token);
            if (intent.descriptor && intent.descriptor.do !== 'phase-end') return;
            if (playing && !intent.descriptor && intent.snap) return; // the same playback re-presented ('keep')
            let entry = null;
            try { entry = prepare(intent.value, intent.handles || []); }
            catch (error) { console.warn('Keyframe performance rejected', error); rest(intent.value, null); return; }
            if (!intent.snap && !intent.descriptor) {
                if (playing) return;
                start(intent, entry); return;
            }
            // Phase end or a snap (seek, skip, history, cancel): the resting frame for the accepted value.
            if (playing && intent.descriptor && !intent.snap && foreground.now() - shown.startedAt < shown.segments.at(-1).from + shown.segments.at(-1).duration) {
                shown.value = intent.value; return; // the clock ends the last frame itself
            }
            rest(intent.value, entry);
        },
        refreshPolicy() {
            policy = safety();
            if (shown && !shown.segments) draw([{entry:shown.entry, states:shown.entry.model.entryEnd}]);
        },
        redraw() { if (shown && !shown.segments) draw([{entry:shown.entry, states:shown.entry.model.entryEnd}]); },
        dispose() { if (disposed) return; disposed = true; stopClock(); shown = null; retain(new Set()); }
    };
}
