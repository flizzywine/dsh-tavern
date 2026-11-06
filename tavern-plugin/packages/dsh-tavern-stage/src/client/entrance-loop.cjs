function entranceLoop(contract, createRenderer, createFrames, host) {
    const doc = host.doc, options = host.options || {};
    let renderer;
    try { renderer = createRenderer(host.canvas, doc, options); } catch (error) { host.post({type: 'error', message: String(error && error.message || error)}); return {message() {}}; }

    let state = contract.stageEntranceStart(doc, options), input = {ready: false, skip: false, revealed: false, video: false}, last = null, stopped = false, started = false;
    let frameId=null,disposed=false;
    function dispose() {
        if(disposed)return;disposed=true;stopped=true;
        if(frameId!==null)host.cancel?.(frameId);
        host.canvas.removeEventListener?.('webglcontextlost',lost);
        renderer.dispose();
    }
    function lost(event) {event.preventDefault();dispose();host.post({type:'error',message:'WebGL context lost'});}
    host.canvas.addEventListener?.('webglcontextlost',lost);
    // The look is soft, so a frame that keeps arriving late draws fewer pixels rather than dropping motion.
    let size = host.size, cap = options.cap || 8294400, best = Infinity, late = 0;
    const stats = options.stats ? {intervals: [], caps: []} : null;
    function fit() {
        const scale = Math.min(1, Math.sqrt(cap / Math.max(1, size[0] * size[1])));
        renderer.size(Math.max(1, Math.round(size[0] * scale)), Math.max(1, Math.round(size[1] * scale)));
    }
    try {fit();}catch(error){dispose();throw error;}
    function frame(now) {
        if (stopped) return;
        if (last !== null) {
            const interval = now - last;
            best = Math.min(best, interval);
            if (stats) stats.intervals.push(Math.round(interval * 100) / 100);
            if (interval > best * 1.6 && interval < 250) { if (++late >= 12 && cap > 300000) { cap *= 0.75; late = 0; fit(); if (stats) stats.caps.push(Math.round(cap)); } } else late = Math.max(0, late - 1);
        }
        const dt = last === null ? 0 : Math.min(100, now - last);
        last = now;
        const result = contract.stageEntranceStep(doc, state, dt, input);
        input = {ready: input.ready, skip: false, revealed: input.revealed, video: input.video};
        state = result.state;
        // Skipped: nothing more is drawn or played (the canvas keeps its last frame, the video the frame it is on); the stage
        // covers it with black and stops the loop.
        if (state.skipped) return;
        const shown = contract.stageEntranceValues(doc, state);
        if (doc.layers.plate) shown.plateFrame = contract.stageEntrancePlateFrame(doc, shown.plate);
        // The video layer is a DOM player on the main thread (stage-video.js) over the canvas: it follows this clock (a still
        // holds). While it plays fully opaque the drawn layers are hidden under it and are not drawn; they are its fallback.
        const videoOpacity = doc.layers.video ? shown.values.video * shown.values.fade : 0;
        if (!(input.video && videoOpacity >= 0.999)) renderer.draw(shown);
        if (doc.layers.video) host.post({type: 'video', time: shown.video, rate: state.reduced ? 0 : shown.values.videoRate, alpha: videoOpacity});
        if (!started) { started = true; host.post({type: 'started'}); }
        for (const event of result.events) host.post(event);
        if (state.done) {
            stopped = true;
            if (stats) host.post({type: 'stats', intervals: stats.intervals, caps: stats.caps, size: [renderer.gl.drawingBufferWidth, renderer.gl.drawingBufferHeight]});
            dispose();
            return;
        }
        frameId=host.raf(frame);
    }
    frameId=host.raf(frame);
    return {message(data) {
        if(data.type==='stop'){dispose();return;}
        if(disposed)return;
        if (data.type === 'input') input = {ready: input.ready || !!data.ready, skip: input.skip || !!data.skip, revealed: input.revealed || !!data.revealed, video: input.video || !!data.video};
        else if (data.type === 'size') { size = data.size; if (!stopped) fit(); }
        else if (data.type === 'media' && !stopped) renderer.media(createFrames(data.files, 6));
        else if (data.type === 'stop' && !stopped) { stopped = true; renderer.dispose(); }
    }};
}


if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={entranceLoop};
