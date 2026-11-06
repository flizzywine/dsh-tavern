// One decoded buffer per live track; the audio render thread owns every loop boundary.
function musicLoop(buffer, points = {}) {
    const rate = buffer.sampleRate, length = buffer.length;
    if (points.loopStart !== undefined && points.loopEnd <= buffer.duration && points.loopStart < points.loopEnd) {
        return {offset:0, start:points.loopStart, end:points.loopEnd, fallback:false};
    }
    const channels = Array.from({length:buffer.numberOfChannels}, (_, i) => buffer.getChannelData(i));
    const audible = i => channels.some(channel => Math.abs(channel[i]) > .001);
    let start = 0, end = length;
    while (start < end && !audible(start)) start++;
    while (end > start && !audible(end - 1)) end--;
    if (start === end) return {offset:0, start:0, end:buffer.duration, fallback:true};
    // Bake one equal-power overlap into the tail. Native looping then wraps to the
    // sample immediately after the overlapped head, with no timer or decode at the seam.
    const overlap = Math.min(Math.round(rate * .04), Math.floor((end - start) / 4));
    const tails = channels.map(channel => channel.slice(end - overlap, end));
    for (let i = 0; i < overlap; i++) {
        const phase = i / Math.max(1, overlap - 1) * Math.PI / 2;
        for (const channel of channels) channel[end - overlap + i] = channel[end - overlap + i] * Math.cos(phase) + channel[start + i] * Math.sin(phase);
    }
    return {offset:start / rate, start:(start + overlap) / rate, end:end / rate, fallback:true,
        restore() { channels.forEach((channel, i) => channel.set(tails[i], end - overlap)); }};
}
async function musicBytes(response) {
    const limit = 60 * 1024 * 1024, reader = response.body?.getReader();
    if (!reader) {
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > limit) throw new Error('Music exceeds decode limit');
        return bytes;
    }
    const chunks = []; let length = 0;
    try {
        for (;;) {
            const {done,value} = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > limit) { await reader.cancel(); throw new Error('Music exceeds decode limit'); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk,at); at += chunk.length; }
    return bytes.buffer;
}
function createStageMusic({audio:forkStageAudio, foreground:forkForeground, fetch, AbortController} = {}) {
    let disposed = false;
    const subscriptions = new Set();
    let a = null, b = null, current = '', currentIdentity = null, fade = 0, handoff = null, stopping = null, blocked = false, failure = null;
    const listeners = new Set();
    let decoding = Promise.resolve();
    const emit = () => listeners.forEach(fn => fn());
    const setBlocked = value => { if (blocked !== value) { blocked = value; emit(); } };
    const level = (track, value) => track?.voice ? track.voice.level(value) : 0;
    function position(track) {
        if (!track) return 0;
        let time = track.offset + (track.source ? track.context.currentTime - track.started : 0);
        if (track.loop && time >= track.loop.end) time = track.loop.start + (time - track.loop.start) % (track.loop.end - track.loop.start);
        return time;
    }
    function pause(track) {
        if (!track) return;
        track.offset = position(track); track.paused = true;
        if (track.source) { track.source.stop(); track.source.disconnect(); track.source.buffer = null; track.source = null; }
    }
    function release(track) {
        if (!track) return;
        track.cancel.abort(); pause(track); track.voice?.release(); track.voice = null; track.buffer = null; track.loop = null;
        track.context?.removeEventListener('statechange', track.statechange);
    }
    function start(track) {
        // The sound policy (foreground.js) holds a playing track at its position while DSH Tavern is not in front.
        if (!track || !track.buffer || track.source || track !== a || !forkForeground.isAudible()) return;
        const ctx = track.context, source = ctx.createBufferSource();
        source.buffer = track.buffer; source.loop = true; source.loopStart = track.loop.start; source.loopEnd = track.loop.end;
        source.connect(track.voice.input); source.start(0, track.offset);
        track.source = source; track.started = ctx.currentTime; track.paused = false;
        ctx.removeEventListener('statechange', track.statechange);
        track.statechange = () => { if (track === a) setBlocked(ctx.state === 'suspended' && !track.paused && forkForeground.isAudible()); };
        ctx.addEventListener('statechange', track.statechange);
        track.statechange();
        void ctx.resume().then(track.statechange, () => { if (track === a) setBlocked(true); });
    }
    // Leaving stops the source at its position without marking the track paused (the player still shows it playing);
    // a live call keeps the mixer running, so the context suspension alone would not hold the music. Subscribed with
    // the first track.
    let policy = null;
    const follow = () => policy ||= forkForeground.subscribeAudio(on => {
        if (!a) return;
        if (on) { if (!a.paused) start(a); return; }
        // A crossfade in flight lands on the incoming track.
        if (b) { settle(); level(a,1); }
        if (a.source) { pause(a); a.paused = false; }
        setBlocked(false);
    });
    function settle() {
        forkForeground.clearTimeout(fade);
        release(b); b = null;
        handoff?.(); handoff = null; stopping = null;
    }
    function configure(track, points) {
        if (!track || track.points.loopStart === points.loopStart && track.points.loopEnd === points.loopEnd) return;
        track.points = {loopStart:points.loopStart,loopEnd:points.loopEnd};
        if (!track.buffer) return;
        const wasPaused = track.paused;
        // Started sources acquire their PCM; a point edit must also replace any baked tail.
        pause(track); track.loop.restore?.(); track.loop = musicLoop(track.buffer, track.points);
        track.offset = position(track); track.paused = wasPaused;
        if (!wasPaused) start(track);
    }
    return {
        subscribe(fn) { if (disposed) return () => {}; listeners.add(fn); const off = forkStageAudio.subscribe(fn); const stop = () => { listeners.delete(fn); subscriptions.delete(stop); off(); }; subscriptions.add(stop); return stop; },
        subscribeBlocked(fn) { if (disposed) return () => {}; listeners.add(fn); return () => listeners.delete(fn); },
        blocked: () => blocked,
        ready: () => !!a?.buffer,
        get() { const prefs = forkStageAudio.get(); return {current,identity:currentIdentity,paused:!a || a.paused,volume:prefs.music,muted:!!prefs.muted.music,error:failure,position:position(a),loopStart:a?.loop?.start,loopEnd:a?.loop?.end}; },
        analyser: () => a?.voice?.analyser() || null,
        // trace: the source for the audio trace (audio-trace.cjs: reason, ref, label).
        play(url, snap = false, identity, {fadeMs = 1200, volume, loopStart, loopEnd, loudness, trace} = {}) {
            if (disposed) return;
            if (!url) return this.stop();
            identity ??= url;
            if (identity === currentIdentity && current && !failure) { this.trim(volume, {loopStart,loopEnd}); this.resume(); return; }
            follow();
            if (a && !a.buffer && b) { release(a); a = b; b = null; }
            settle();
            if (a && !a.buffer) { release(a); a = null; }
            b = a;
            const track = {cancel:new AbortController(),paused:false,offset:0,source:null,buffer:null,points:{loopStart,loopEnd}};
            a = track; current = url; currentIdentity = identity; failure = null;
            const complete = new Promise(resolve => { handoff = resolve; });
            // Decode is not abortable. Serialize loads so rapid selections cannot
            // accumulate full decoded buffers while an obsolete load is completing.
            decoding = decoding.then(async () => {
                if (track.cancel.signal.aborted) return;
                try {
                    const ctx = forkStageAudio.musicContext();
                    if (!ctx) throw new Error('Web Audio unavailable');
                    track.context = ctx;
                    const response = await fetch(url,{signal:track.cancel.signal});
                    if (!response.ok) throw new Error('Music fetch failed: ' + response.status);
                    const bytes = await musicBytes(response);
                    const buffer = await ctx.decodeAudioData(bytes);
                    if (track !== a || track.cancel.signal.aborted) return;
                    if (buffer.duration > 900 || buffer.numberOfChannels > 2 || buffer.length * buffer.numberOfChannels * 4 > 384 * 1024 * 1024) throw new Error('Unsupported music decode size');
                    track.buffer = buffer; track.loop = musicLoop(buffer, track.points); track.offset = track.loop.offset;
                    track.voice = forkStageAudio.musicVoice(url, volume, identity, loudness, trace, buffer.duration);
                    if (!track.paused) start(track);
                    const previous = b, from = level(previous);
                    if (snap || fadeMs === 0 || track.paused) { level(track,1); settle(); emit(); return; }
                    const at = forkForeground.now();
                    function step() {
                        if (disposed || track !== a) return;
                        const t = Math.min(1,(forkForeground.now() - at) / Math.max(1,fadeMs));
                        level(previous,from * (1 - t)); level(track,t);
                        if (t < 1) fade = forkForeground.setTimeout(step,16);
                        else { settle(); emit(); }
                    }
                    fade = forkForeground.setTimeout(step,16); emit();
                } catch (error) {
                    if (track !== a || track.cancel.signal.aborted) return;
                    failure = String(error.message || error); forkStageAudio.traceFailure('music', url, trace, failure); release(track); a = null; settle(); setBlocked(false); emit();
                }
            });
            emit(); return complete;
        },
        pause() { if (!current) return; settle(); level(a,1); if (a && !a.paused) a.voice?.mark('pause'); pause(a); emit(); },
        resume() { if (!a) return; if (a.paused) a.voice?.mark('resume'); a.paused = false; start(a); if (a.context?.state === 'suspended') { const track = a; void track.context.resume().then(() => { if (track === a) setBlocked(false); }, () => { if (track === a) setBlocked(true); }); } emit(); },
        trim(volume, points) { a?.voice?.trim(volume); if (points) configure(a,points); },
        stop(snap = true) {
            if (!snap && stopping) return stopping;
            forkForeground.clearTimeout(fade); handoff?.(); handoff = null; stopping = null;
            const tracks = [a,b].filter(Boolean), levels = tracks.map(track => level(track));
            tracks.forEach(track => track.cancel.abort());
            current = ''; currentIdentity = null; failure = null; setBlocked(false);
            const finish = () => { tracks.forEach(release); a = b = null; handoff?.(); handoff = null; stopping = null; emit(); };
            if (snap || tracks.every(track => !track.source)) { finish(); return; }
            stopping = new Promise(resolve => { handoff = resolve; });
            const at = forkForeground.now();
            function step() {
                if (disposed) return;
                const t = Math.min(1,(forkForeground.now() - at) / 1200);
                tracks.forEach((track,i) => level(track,levels[i] * (1 - t)));
                if (t < 1) fade = forkForeground.setTimeout(step,16); else finish();
            }
            fade = forkForeground.setTimeout(step,16); emit(); return stopping;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            const errors = [];
            const clean = fn => { try { fn(); } catch (error) { errors.push(error); } };
            clean(() => forkForeground?.clearTimeout(fade));
            const tracks = [a,b]; a = b = null;
            current = ''; currentIdentity = null; failure = null; blocked = false;
            clean(() => policy?.()); policy = null;
            for (const stop of subscriptions) clean(stop);
            subscriptions.clear(); listeners.clear();
            for (const track of tracks) if (track) {
                clean(() => track.cancel.abort());
                const source = track.source;
                if (source) {
                    clean(() => source.stop());
                    clean(() => source.disconnect());
                    clean(() => { source.buffer = null; });
                }
                clean(() => track.voice?.release());
                clean(() => track.context?.removeEventListener('statechange', track.statechange));
                track.source = track.voice = track.buffer = track.loop = null;
            }
            clean(() => handoff?.()); handoff = null; stopping = null;
            if (errors.length) throw new AggregateError(errors, 'Music cleanup failed');
        },
        setVolume(value) { if (disposed) return; forkStageAudio.setVolume('music',value); },
        toggleMute() { if (disposed) return; forkStageAudio.toggleMute('music'); }
    };
}
if (typeof module !== "undefined" && typeof window === "undefined") module.exports = {createStageMusic, musicLoop, musicBytes};
