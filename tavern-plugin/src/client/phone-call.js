// a voice call with one phone
// contact. The page owns the microphone and her voice; the host owns speech recognition, the model and the contact's own
// call history (one context window per contact). Her lines are synthesized with the contact figure's own voice and played
// as complete sentence/clause audio after a measured synthesis-deficit reserve; the stage figure lip-syncs to
// that voice (forkLipSync on the mixer's voice stream).
//
// Turn taking follows Eidolon-SC (AGPL-3.0, turn_taking.py) in a reduced form, with a confirmed barge-in: the player
// sounding while she thinks or speaks ducks her voice at once but does not cut her; words do (or sound long enough
// that recognition must be failing). A backchannel (phoneCallSpeech: 嗯、对对对、这样啊、原来如此、真的吗、哈哈…), noise
// (punctuation alone) or her own voice back through the microphone (an echo: the transcript is what she just said) lets
// her go on and never asks the model - except a backchannel over her last words, which answers them once she is done.
// A confirmed interruption stops her: what she had started saying stays in the record, the rest is dropped.
// Smart Turn v3 judges the audio (with the whole pause so far) at 120, 300 and 600 ms of silence; an open sentence
// waits up to 1.1 seconds. Her reply starts at the first pause whatever the judgement (first sound
// p50 4.7 s): the model and her voice work while the pause is still being judged, and nothing plays until the pause is
// judged a handoff; the player going on talking retracts the reply - and their line - unheard.
// While the player speaks, the words recognized so far show as a live line (the shared recognition session, re-decoded
// every 400 ms); that line never decides the turn and never enters the record - the pause snapshot does both.
// The call state the phone shows at a reading position: a call anchored past the page on screen ({turn, para} of where it was
// made) is not there yet, as a message after the page is not; a record from before calls kept their page (no para) shows from
// its round on. The same object back when nothing is held back, so the phone is not sent the state again on every page.
function phoneModCallsAt(state, turn, para) {
    const threads = state?.threads;
    if (!threads) return state;
    const shown = row => row.turn < turn || row.turn === turn && (row.para === undefined || row.para <= para);
    if (Object.values(threads).every(rows => rows.every(shown))) return state;
    return {...state, threads: Object.fromEntries(Object.entries(threads).map(([id, rows]) => [id, rows.filter(shown)]).filter(([, rows]) => rows.length))};
}
// Keep an unfinished averaging window and its fractional phase across microphone callbacks.
function callResampler(sampleRate) {
    const rate = 16000;
    let tail = new Float32Array(0), pos = 0;
    return chunk => {
        const data = new Float32Array(tail.length + chunk.length);
        data.set(tail); data.set(chunk, tail.length);
        const count = Math.max(0, Math.floor((data.length * rate - pos) / sampleRate)), out = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const from = Math.floor((pos + i * sampleRate) / rate), to = Math.max(from + 1, Math.floor((pos + (i + 1) * sampleRate) / rate));
            let sum = 0;
            for (let k = from; k < to; k++) sum += data[k];
            out[i] = sum / (to - from);
        }
        pos += count * sampleRate;
        const consumed = Math.floor(pos / rate);
        tail = data.slice(consumed);
        pos -= consumed * rate;
        return out;
    };
}
// What a transcript says in the player's own words (`words`): the transcript without punctuation, without the reactive
// tokens a listener makes at its head - continuers, agreements, news receipts, laughter: 嗯、对对对、这样啊、原来如此、真的吗、
// 哈哈、嗯其实… - and without the particles at its tail (啊吧呢吗…). Tokens are taken off the edges only: 是 and 对 inside
// a word (就是、但是、不对) are the word's. `floor(text, chars)`: the player wants the floor - that many own characters,
// or one floor-taking word alone (不、没、等、喂…), which a listener never says to a speaker just to show they are
// listening. Measured on real conversation through the phone's own recognizer: a lone
// ordinary character after a backchannel is what the recognizer makes of a breath or her voice (嗯→「嗯太」「嗯在」,
// laughter→「他」), so one is not yet the player's words; and when the rest of a backchannel is a connective (「嗯，然后」),
// it is her own next words leaking in - the echo test (phoneModCall) reads the own words, not the whole transcript.
const phoneCallSpeech = (function () {
    const PUNCTUATION = /[\s\p{P}\p{S}]/gu;
    const PHRASES = ['原来是这样', '原来如此', '这样子啊', '这样子', '这样啊', '这样', '真的假的', '真的吗', '真的呀', '真的', '是这样', '是吗', '是嘛', '是吧', '是呗', '是的', '是啊', '也是', '那是', '那倒是',
        '没错', '确实', '当然', '可以', '有道理', '有意思', '明白了', '明白', '懂了', '我懂', '我知道了', '知道了', '我知道', '了解', '好的', '好吧', '好啊', '好嘞', '好滴', '好了', '行吧', '行啊', '行了', '对的', '对啊', '对呀', '对吧',
        '不错', '厉害', '哇塞', '我的天', '天哪', '天啊', '哎呀', '哎哟', '哎呦', '嗯哼', '不会吧', '不是吧', '然后呢', '所以呢',
        'okay', 'ok', 'yeah', 'yes', 'sure', 'uhhuh', 'hmm', 'mm', 'uh', 'oh', 'wow'];
    const TOKENS = '嗯啊哦噢喔呃唔哈嘿诶欸哎唉呵哼对好行是哇咦嘻呗呐牛', PARTICLES = '啊哦呀嘛吧呢啦哟呦吗咯喽的';
    const HEAD = new RegExp('^(?:' + PHRASES.join('|') + '|[' + TOKENS + PARTICLES + '])+', 'u'), TAIL = new RegExp('(?:' + PHRASES.join('|') + '|[' + PARTICLES + '])+$', 'u');
    const FLOOR = /^[不没别等停错喂啥谁]$/u;
    const plain = text => (text || '').normalize('NFKC').replace(PUNCTUATION, '');
    const words = text => plain(text).toLowerCase().replace(HEAD, '').replace(TAIL, '');
    // `live`: the text is a prefix still being decoded - own words that may yet become a backchannel (原来→原来如此) wait.
    const floor = (text, chars, live) => { const own = words(text); return (own.length >= chars || FLOOR.test(own)) && !(live && PHRASES.some(phrase => phrase.startsWith(own))); };
    return {plain, words, floor};
})();
const phoneModCall = (function () {
    const listeners = new Set(), FRAME = 320, OWNER = 'phone-call';
    // 20 ms frames: a pause this long asks the recognizer how the words end (again at each later mark); an open
    // sentence waits this long at most.
    const PROBE_FRAMES = [6, 15, 30], OPEN_FRAMES = 55;
    // A pause judged at least this likely to be a handoff starts her reply early; a clearly unfinished sentence (held-out
    // clip 507: 0.27, 0.07 mid-sentence vs 0.85-0.95 before a handoff) is not paid for.
    const EARLY_START = 0.5;
    // The player sounding while she has a turn is a challenge, not yet an interruption: her voice ducks to this gain at once
    // and goes on while the words decide. The player's own words confirm it (phoneCallSpeech.floor: two characters, from the
    // live line or the pause snapshot, or one floor-taking word), as does voiced sound this many frames long without any
    // (recognition may be failing). A transcript whose character pairs are this much in what she said in this turn or
    // in the last moments is her own echo. A backchannel while she is saying her last words (the model done, this much
    // voice left) answers them - 「好」 to 「要去吗？」 - and is said once she has finished.
    const DUCK = 0.3, CONFIRM = 2, SUSTAIN_FRAMES = 75, ECHO_SHARE = 0.6, ECHO_TAIL_MS = 2000, ANSWER_TAIL_S = 1.2;
    const PUNCTUATION = /[\s\p{P}\p{S}]/gu;
    // The live line: new audio is sent every 20 frames (400 ms) while the player is talking, and read back this often.
    const PARTIAL_FRAMES = 20, PARTIAL_POLL_MS = 250;
    // An open call tells the host it is still on the line this often (the host ends it after 75 s without a request).
    const CALL_ALIVE_MS = 20000;
    const LEAD_SECONDS = 0.02, INITIAL_RTF = 1, RTF_ALPHA = 0.3;
    // Calling: her phone rings at least twice - and until the first words of
    // her greeting can sound, which the model is already writing - and she picks up by the last mark regardless. The tone is
    // Japan's ringback (NTT, ITU-T E.180): 400 Hz modulated at 16 Hz, 1 s on, 2 s off. 「通话结束」 holds this long after a
    // hang-up (iOS about 1-1.5 s) before the phone goes back to where the call was made.
    // level: 0.16 on the voice bus (slider default 1) is the former 0.2 on the sound-effect bus at its old 0.8 default.
    const RING = {hz:400, modHz:16, on:1, period:3, level:0.16}, ENDED_MS = 1500;
    // Duration prediction sizes only the audio reserve; it never advances captions.
    const SECONDS_PER_CHAR = 0.16;
    // Her voice cannot keep up: on a busy machine (a game holding the GPU) the local voice ran at 3.5x real time, so every
    // reply waited silently for its clause until the player spoke again and cut it - the call showed only the player.
    // Before any of her voice is scheduled, a turn goes on as text when no PCM came this long after its first synthesis
    // request, a clause streams slower than this real-time factor, the synthesis failed, or no voice is scheduled this
    // long after her first words (or the held reply's release). A healthy voice (first PCM 0.3-1 s, RTF 0.75-1) never does.
    const FIRST_PCM_LATE_MS = 1500, SLOW_RTF = 1.5, VOICE_LATE_MS = 6000, WATCH_MS = 250;
    // The dial cue (hidden, never the player's words): she picks up and speaks first; with her cached greeting (「喂？」,
    // played the moment she picks up) she has already said it and goes on from there.
    const CUE = '（电话接通了。你接起电话，先开口。）', GREETED_CUE = said => '（电话接通了。你接起电话，已经说了「' + said + '」，接着往下说。）';
    let state = {status:'idle'}, stageKey = '', call = null;
    // FaceTime: the stage's call view - her figure, the player's own when the camera is on,
    // where the phone page leaves the video area clear (`layout`) - and the frame source the stage registers for the shutter.
    // It outlives the call by its frozen hang-up until the page lets the screen go (layout null).
    const videoListeners = new Set();
    let screen = null, videoKey = 0, frameSource = null;
    const CAMERA_NOTE = {true:'（对方打开了摄像头，你能看到对方）', false:'（对方关闭了摄像头，你看不到对方了）'};
    const probe = globalThis.phoneModCallProbe = {turns:[], attempts:[], events:[], ring:{minMs:4200, maxMs:15000}};
    function emit() {
        const key = state.status !== 'idle' && state.status !== 'ended' && state.status !== 'error' ? [state.contactId, state.status === 'speaking'].join('|') : '';
        stageKey = key;
        for (const fn of [...listeners]) fn();
    }
    function set(patch) { state = {...state, ...patch}; emit(); }
    // Each subtitle clause has its own synthesized clip. Reveal it whole at that clip's audible start, never by a
    // guessed character/time proportion. `revealing` keeps the screen reader from reading an unfinished spoken line.
    // Her caption is the line as it reads in the story: a voice in another
    // language shows only its subtitle (`sub`), never the spoken words, and nothing until that subtitle has arrived.
    function shownLines(c) {
        const out = [], active = c.turn && !c.turn.over ? c.turn.id : undefined;
        for (const line of c.lines) {
            if (line.cue) continue;
            const previous = out.at(-1);
            if (line.role === 'contact' && previous?.parts && previous.parts.at(-1).part && previous.turn === line.turn) previous.parts.push(line);
            else out.push(line.role === 'contact' ? {turn:line.turn, parts:[line]} : {...line});
        }
        const foreign = Boolean(c.language && c.language !== 'zh');
        return out.filter(row => !row.parts || row.parts.some(line => line.started)).slice(-6).map(row => row.parts ? caption(row.parts, row.turn === active, foreign) : row).filter(row => row.text);
    }
    function caption(parts, active, foreign) {
        const last = parts.at(-1), played = parts.reduce((sum, line) => sum + (line.played || 0), 0), seconds = parts.reduce((sum, line) => sum + (line.seconds || 0), 0);
        const text = parts.filter(line => line.started).map(line => line.sub || '').join('');
        return {role:'contact', turn:last.turn, text, started:true, ...(active && (last.part || played < seconds) ? {revealing:true} : {})};
    }
    // The caption and persistence share the same audible-start gate, including a clause cut off mid-speech.
    function heard(c, turn) {
        return turn.segments.flatMap((line, index) => line?.started ? [index] : []);
    }
    // Numeric-only receipts: performance.now offsets, never transcript/probe text. Host clock alignment is
    // the RPC midpoint after subtracting host processing; retain its half-RTT uncertainty explicitly.
    function timingReceipt(turn) {
        const t = turn.timing, cue = turn.playerLine.cue;
        const base = cue ? t.pickupAt ?? t.said : t.stoppedAt ?? t.said;
        const out = {origin:cue ? (t.pickupAt === undefined ? 2 : 1) : 0, interruptions:turn.cut || turn.retractOnStart || turn.measure.outcome === 'retracted' ? 1 : 0,
            stalls:t.gaps || 0, backchannels:t.backchannels || 0, outcome:['pending','completed','interrupted','retracted','aborted','failed','no-speech'].indexOf(turn.measure.outcome)};
        if (!cue && t.stoppedAt !== undefined) out.speechEndMs = 0;
        for (const [key, field] of Object.entries({endpointMs:'decidedAt',asrFinalMs:'heardAt',rpcSentMs:'rpcSentAt',hostStartMs:'hostStartedAt',ttsRequestMs:'ttsRequestedAt',firstPcmMs:'firstChunk',scheduledMs:'firstScheduledAt',audibleMs:'audibleAt'}))
            if (Number.isFinite(t[field]) && !(key === 'endpointMs' && turn.held) && !(key === 'audibleMs' && !turn.started)) out[key] = Math.round((t[field] - base) * 10) / 10;
        if (cue && Number.isFinite(t.ringAt) && Number.isFinite(t.firstChunk)) out.ringToFirstPcmMs = Math.round((t.firstChunk - t.ringAt) * 10) / 10;
        if (Number.isFinite(t.clockErrorMs)) out.clockErrorMs = Math.round(t.clockErrorMs * 10) / 10;
        if (Number.isFinite(t.outputLatencyMs)) out.outputLatencyMs = Math.round(t.outputLatencyMs * 10) / 10;
        if (!cue && t.endpoint !== undefined) out.endpoint = t.endpoint;
        return out;
    }
    function report(c, method, args) {
        if (c.turn?.id === args.turnId && !args.timing) args = {...args, timing:timingReceipt(c.turn)};
        c.reporting = (c.reporting || Promise.resolve()).then(() => rpc(method, {callId:c.id, ...args}, c.sessionId)).catch(() => {
            if (call === c) sync(c, {notice:'通话内容没能保存'});
        });
        return c.reporting;
    }
    function sync(c, patch = {}) { if (call !== c) return; const lines = shownLines(c); c.shown = JSON.stringify(lines); set({...patch, lines}); }
    const note = (name, extra = {}) => { probe.events.push({name, at:performance.now(), ...extra}); if (probe.events.length > 400) probe.events.shift(); };

    // ---- microphone: 16 kHz mono frames and an energy voice-activity detector ----------------------------------------
    async function openMic(c) {
        const stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1}});
        const context = new AudioContext(), input = context.createMediaStreamSource(stream);
        const processor = context.createScriptProcessor(2048, 1, 1), sink = context.createGain();
        sink.gain.value = 0;
        input.connect(processor); processor.connect(sink); sink.connect(context.destination);
        const resample = callResampler(context.sampleRate);
        let pending = new Float32Array(0);
        processor.onaudioprocess = event => {
            if (call !== c || c.closed) return;
            const out = resample(event.inputBuffer.getChannelData(0));
            const merged = new Float32Array(pending.length + out.length); merged.set(pending); merged.set(out, pending.length);
            let at = 0;
            for (; at + FRAME <= merged.length; at += FRAME) vad(c, merged.slice(at, at + FRAME));
            pending = merged.slice(at);
        };
        c.mic = {stream, context, processor};
        if (context.state === 'suspended') await context.resume().catch(() => {});
    }
    function closeMic(c) {
        if (!c.mic) return;
        c.mic.processor.onaudioprocess = null;
        for (const track of c.mic.stream.getTracks()) track.stop();
        void c.mic.context.close().catch(() => {});
        c.mic = null;
    }
    // 20 ms frames. A frame is voiced above the tracked noise floor; 100 ms of a 160 ms window starts speech (with
    // 300 ms of pre-roll). While she speaks the bar is higher (echo guard). The end of the utterance: see `pause`.
    function vad(c, frame) {
        // Nothing is heard until she picks up.
        if (!c.connected) return;
        let sum = 0; for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
        const db = 10 * Math.log10(sum / frame.length + 1e-12), v = c.vad;
        if (!v.speech && db < v.noise + 6) v.noise = v.noise * 0.97 + db * 0.03;
        const voiced = db > Math.max(v.noise + 14, state.status === 'speaking' ? -38 : -50);
        v.recent.push(voiced); if (v.recent.length > 8) v.recent.shift();
        if (!v.speech) {
            v.preroll.push(frame); if (v.preroll.length > 15) v.preroll.shift();
            if (!state.muted && v.recent.filter(Boolean).length >= 5) { v.speech = true; v.frames = v.preroll.splice(0); v.silence = 0; v.asked = null; speechStarted(c); }
            return;
        }
        v.frames.push(frame);
        if (voiced) { v.silence = 0; v.asked = null; v.pauses++; if (c.turn?.held) retract(c); if (c.challenge && ++c.challenge.voiced >= SUSTAIN_FRAMES) interrupt(c, 'sustained'); } else v.silence++;
        if (v.silence < PROBE_FRAMES[0] && v.frames.length - (c.partial?.sent ?? v.frames.length) >= PARTIAL_FRAMES) partialAppend(c);
        if (v.frames.length >= 1000) { finish(c, null, 3); return; }
        if (PROBE_FRAMES.includes(v.silence)) pause(c);
        else if (v.silence >= OPEN_FRAMES && (!v.asked || v.asked.done)) finish(c, v.asked?.heard ?? null);
    }
    // The words spoken before a short pause, so far: the utterance up to the last voiced frame and 100 ms after it.
    function spoken(v) { return v.frames.slice(0, Math.max(1, v.frames.length - v.silence + 5)); }
    // A pause: ask how the words end, with the whole pause heard so far (the judge reads the silence too). The first
    // answer with words starts her reply at once, held until a pause is judged a handoff.
    function pause(c) {
        const v = c.vad, frames = v.frames.slice();
        if (spoken(v).length * FRAME < 16000 * 0.25) return;
        const asked = v.asked = {stoppedAt:performance.now() - v.silence * 20, heard:null, mark:v.silence * 20, pause:v.pauses};
        note('pause', {mark:asked.mark});
        void hear(c, frames).then(heard => {
            if (asked.pause !== v.pauses || !v.speech || call !== c) return; // the player went on talking
            asked.heard = heard; asked.done = true;
            note('ending', {ending:heard?.ending, text:heard?.text, mark:asked.mark, probability:heard?.endpoint?.probability, hearMs:heard ? heard.at - asked.stoppedAt - asked.mark : null});
            if (heard && c.challenge && substantive(c, heard.text)) interrupt(c, 'words');
            if (heard && heard.ending !== 'open') finish(c, heard);
            else if (plain(heard?.text) && !echoed(c, heard.text) && heard.endpoint?.probability >= EARLY_START && !(c.turn && !c.turn.over)) void say(c, heard.text.trim(), {stoppedAt:asked.stoppedAt, decidedAt:performance.now(), heardAt:heard.at, asrMs:heard.asrMs, hearMs:heard.roundTripMs, ending:heard.ending, early:true, speculative:true}, false, true);
        });
    }
    function finish(c, heard, endpoint = heard && heard.ending !== 'open' ? 1 : 2) {
        const v = c.vad, frames = spoken(v), stoppedAt = v.asked?.stoppedAt ?? performance.now() - v.silence * 20;
        v.speech = false; v.frames = []; v.recent = []; v.asked = null;
        // The live line stays on screen until her turn shows the player's words (or the utterance comes to nothing).
        const live = c.partial;
        partialClose(c, false);
        void utterance(c, frames, stoppedAt, heard, live, endpoint);
    }
    // The player went on talking over a held reply: it goes, and their line with it (the host forgets both).
    function retract(c) {
        const turn = c.turn;
        turn.over = true; turn.measure.outcome = 'retracted'; turn.measure.finishedAt = performance.now();
        note('retract', {turnId:turn.id});
        silence(c, turn);
        c.lines = c.lines.filter(line => line.turn !== turn.id && line !== turn.playerLine);
        c.turn = null;
        if (turn.id) void report(c, 'phoneCallInterrupt', {turnId:turn.id, heard:[], retract:true, timing:timingReceipt(turn)});
        else turn.retractOnStart = true;
    }
    function pcmBase64(frames) {
        const pcm = new Int16Array(frames.length * FRAME);
        frames.forEach((frame, n) => { for (let i = 0; i < FRAME; i++) pcm[n * FRAME + i] = Math.max(-32768, Math.min(32767, Math.round(frame[i] * 32767))); });
        const bytes = new Uint8Array(pcm.buffer); let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(binary);
    }
    // The language is the recognition service's setting (speech-recognition/settings.json), never the page's.
    async function hear(c, frames) {
        try { return {...await rpc('phoneCallHear', {audio:pcmBase64(frames)}, c.sessionId), at:performance.now()}; }
        catch (error) { if (call === c) sync(c, {notice:'通话暂时不顺畅，请稍后再试'}); return null; }
    }

    // ---- the live line: one recognition session per utterance (BACKEND-CONTRACT: start / append / poll / cancel) ----
    // A result only lands on the utterance that asked for it; a revision replaces the whole text (never appended).
    function partialOpen(c) {
        partialClose(c, false);
        const p = c.partial = {id:null, sequence:0, sent:0, revision:-1, closed:false, timer:null};
        p.chain = rpc('startSpeechRecognition', {}, c.sessionId).then(snapshot => { p.id = snapshot.id; }, error => partialFail(c, p, error));
    }
    function partialAppend(c) {
        const p = c.partial, frames = c.vad.frames.slice(p.sent);
        p.sent = c.vad.frames.length;
        p.chain = p.chain.then(() => {
            if (p.closed || !p.id) return;
            return rpc('appendSpeechRecognition', {id:p.id, sequence:++p.sequence, audio:pcmBase64(frames)}, c.sessionId).then(snapshot => {
                partialShow(c, p, snapshot);
                p.timer ||= setInterval(() => void partialPoll(c, p), PARTIAL_POLL_MS);
            }, error => partialFail(c, p, error));
        });
    }
    async function partialPoll(c, p) {
        if (p.closed || p.polling) return;
        p.polling = true;
        try { partialShow(c, p, await rpc('pollSpeechRecognition', {id:p.id}, c.sessionId)); }
        catch (error) { partialFail(c, p, error); }
        finally { p.polling = false; }
    }
    function partialShow(c, p, snapshot) {
        if (p.closed || c.partial !== p || call !== c || snapshot.revision <= p.revision) return;
        p.revision = snapshot.revision;
        if (snapshot.error) { partialFail(c, p, Object.assign(new Error(snapshot.error), {code:snapshot.error})); return; }
        if (state.partial !== snapshot.text) set({partial:snapshot.text});
        if (c.challenge && substantive(c, snapshot.text, true)) interrupt(c, 'words');
    }
    function partialFail(c, p, error) {
        if (p.closed || call !== c) return;
        partialClose(c, true);
        sync(c, {notice:'通话暂时不顺畅，请稍后再试'});
    }
    // Release the session; `clear` also takes the live line off the screen.
    function partialClose(c, clear) {
        const p = c.partial;
        if (p && !p.closed) {
            p.closed = true; clearInterval(p.timer);
            void p.chain.then(() => { if (p.id) return rpc('cancelSpeechRecognition', {id:p.id}, c.sessionId); }).catch(() => {});
        }
        if (clear && state.partial && call === c) set({partial:''});
    }
    // A finished utterance's live line leaves with it, unless the player has already started the next one.
    const partialGone = (c, live) => c.partial === live ? {partial:''} : {};

    // ---- turns -----------------------------------------------------------------------------------------------------
    function speechStarted(c) {
        note('speech-start');
        // Her turn under way (thinking or speaking): challenged, not cut. Her status stays as it is so her lips keep moving.
        const challenged = c.turn && !c.turn.over && !c.turn.held;
        if (challenged) { c.challenge = {turn:c.turn, voiced:0, done:false}; duck(c, true); }
        partialOpen(c);
        sync(c, challenged ? {partial:''} : {status:'hearing', partial:''});
    }
    // ---- the player's sound over her turn: words interrupt, the rest lets her go on -----------------------------------
    const plain = phoneCallSpeech.plain;
    // The player wants the floor: their own words (not a backchannel, not her echo).
    function substantive(c, text, live) {
        return phoneCallSpeech.floor(text, CONFIRM, live) && !echoed(c, text);
    }
    // She is saying her last words: the model is done and what is left of her voice is short.
    function closing(c, turn) {
        return Boolean(turn.done && c.out && turn.pieces.every(piece => piece.ended)) && c.playhead - c.out.context.currentTime <= ANSWER_TAIL_S;
    }
    // A backchannel over her last words is the answer to them: said once she has finished, unless the player went on.
    function answerLater(c, turn, text, timing) {
        const wait = Math.max(0, c.playhead - c.out.context.currentTime) * 1000 + 250;
        note('answer-later', {text, waitMs:Math.round(wait)});
        // Her voice leaves the output device a little after the playhead: look again a few times for the turn to complete.
        const check = tries => {
            if (call !== c || c.turn !== turn || c.vad.speech) return;
            if (turn.over) { if (turn.measure.outcome === 'completed') void say(c, text, timing); }
            else if (tries) setTimeout(() => check(tries - 1), 250);
        };
        setTimeout(() => check(4), wait);
    }
    // Her own voice through the microphone: the transcript's character pairs are mostly in what she has said in this turn,
    // or in the turn that ended moments ago (its tail still in the room).
    function echoed(c, text) {
        const chars = phoneCallSpeech.words(text) || plain(text);
        if (chars.length < 2) return false;
        const live = c.turn && !c.turn.over ? c.turn.id : null, tail = performance.now() - (c.spokeUntil || -Infinity) < ECHO_TAIL_MS ? c.spokeTurn : null;
        const greeting = c.greetingClip && performance.now() - c.greetingClip.endsAt < ECHO_TAIL_MS;
        const said = c.lines.filter(line => line.role === 'contact' && line.started && (line.greeting ? greeting : line.turn === live || line.turn === tail)).map(line => (line.say || '') + (line.sub || '')).join('').replace(PUNCTUATION, '');
        if (!said) return false;
        let hits = 0;
        for (let i = 0; i + 1 < chars.length; i++) if (said.includes(chars.slice(i, i + 2))) hits++;
        return hits / (chars.length - 1) >= ECHO_SHARE;
    }
    function interrupt(c, why) {
        const challenge = c.challenge;
        if (!challenge || challenge.done) return;
        challenge.done = true;
        note('confirmed', {why});
        if (c.turn === challenge.turn && !challenge.turn.over) { bargeIn(c); sync(c, {status:'hearing'}); }
    }
    // The challenge is over (the utterance ended or was dropped): her voice comes back up.
    function settle(c) { c.challenge = null; duck(c, false); }
    function duck(c, on) {
        const gain = c.out?.input?.gain;
        if (!gain?.setTargetAtTime || c.ducked === on) return;
        c.ducked = on;
        const now = c.out.context.currentTime;
        // Her greeting sounds whole; the duck starts after it.
        gain.cancelScheduledValues(now); gain.setTargetAtTime(on ? DUCK : 1, on ? Math.max(now, greetingUntil(c)) : now, on ? 0.02 : 0.05);
    }
    function bargeIn(c) {
        tick(c);
        const turn = c.turn; if (!turn || turn.over) return;
        duck(c, false);
        turn.over = true; turn.cut = true; turn.measure.outcome = 'interrupted'; turn.measure.finishedAt = performance.now();
        note('barge-in', {heard:turn.started});
        if (turn.started) { c.spokeUntil = performance.now(); c.spokeTurn = turn.id; }
        silence(c, turn);
        void report(c, 'phoneCallInterrupt', {turnId:turn.id, heard:heard(c, turn)});
        c.lines = c.lines.filter(line => line.turn !== turn.id || line.started || line.greeting);
    }
    async function utterance(c, frames, stoppedAt, known, live, endpoint) {
        if (call !== c || c.closed) return;
        const held = c.turn?.held ? c.turn : null, challenge = c.challenge;
        const idle = () => ({...partialGone(c, live), ...(!c.turn || c.turn.over ? {status:'listening'} : {})});
        if (frames.length * FRAME < 16000 * 0.25) { settle(c); sync(c, idle()); return; }
        const decidedAt = performance.now();
        note('utterance', {seconds:frames.length * FRAME / 16000, early:Boolean(known), held:Boolean(held)});
        if (!challenge) sync(c, {status:'thinking'});
        const heard = known || await hear(c, frames);
        if (call !== c || c.closed || !heard) { if (call === c && !heard) { settle(c); sync(c, {status:'listening', ...partialGone(c, live)}); } return; }
        // A pause snapshot can correct the early decode even without more voiced frames. Never release a reply
        // to superseded words: retract the unheard speculation and use the accepted final snapshot instead.
        if (held) {
            if (plain(held.playerLine.text) === plain(heard.text)) { held.timing.endpoint = endpoint; release(c, held, decidedAt, live); return; }
            retract(c);
        }
        note('heard', {text:heard.text, asrMs:heard.asrMs, ending:heard.ending});
        // Nothing said: punctuation alone (noise) never asks; over her turn, a backchannel or her echo lets her go on.
        const text = heard.text.trim(), over = challenge && c.turn === challenge.turn && !challenge.turn.over;
        const kind = !plain(text) ? 'noise' : echoed(c, text) ? 'echo' : over && !phoneCallSpeech.floor(text, CONFIRM) ? 'backchannel' : null;
        const timing = {stoppedAt, decidedAt, heardAt:heard.at, asrMs:heard.asrMs, hearMs:heard.roundTripMs, ending:heard.ending, endpoint, early:Boolean(known)};
        settle(c);
        if (kind) {
            note('ignored', {kind, text});
            if (kind === 'backchannel') {
                if (closing(c, challenge.turn)) answerLater(c, challenge.turn, text, timing);
                else challenge.turn.timing.backchannels = (challenge.turn.timing.backchannels || 0) + 1;
            }
            sync(c, idle()); return;
        }
        await say(c, text, timing, false, false, live);
    }
    // A held reply becomes hers to say: the player's words show, and whatever voice has arrived plays.
    function release(c, turn, decidedAt, live) {
        turn.held = false; if (turn.playerLine.cue) turn.timing.pickupAt = decidedAt; turn.timing.decidedAt = decidedAt; turn.timing.releasedAt = performance.now();
        c.lines.push(turn.playerLine, ...turn.segments.filter(Boolean));
        sync(c, {status:'thinking', ...partialGone(c, live)});
        if (turn.done && !turn.pieces.length) { turn.over = true; turn.measure.outcome = 'no-speech'; if (turn.id) void report(c, 'phoneCallHeard', {turnId:turn.id, heard:[]}); sync(c, {status:'listening'}); return; }
        if (turn.id) void report(c, 'phoneCallHeard', {turnId:turn.id, heard:heard(c, turn)});
        schedule(c, turn);
        watchVoice(c, turn);
    }
    // `held`: started at a pause not yet judged a handoff - the player's line and her voice wait for the judgement.
    async function say(c, text, timing = {}, cue = false, held = false, live = null) {
        const turn = {id:null, over:false, held, started:0, segments:[], pieces:[], sources:new Set(), abort:new AbortController(), subs:0, timing:{...timing, said:performance.now()}, playerLine:{role:'player', text, cue}};
        if (c.turn && !c.turn.over) bargeIn(c);
        c.turn = turn;
        turn.measure = {cue, timing:turn.timing, outcome:'pending', startedAt:performance.now()};
        probe.attempts.push(turn.measure); if (probe.attempts.length > 200) probe.attempts.shift();
        if (!held) { c.lines.push(turn.playerLine); sync(c, {status:'thinking', ...(live ? partialGone(c, live) : {})}); }
        await c.reporting;
        if (turn.over || call !== c) return;
        // The camera's quiet line (FaceTime): once, with the next words, whenever she does not yet know whether she sees the player.
        const v = c.video, cameraNote = v && !cue && v.camera !== v.told ? CAMERA_NOTE[v.camera] : '';
        if (cameraNote) v.told = v.camera;
        turn.timing.rpcSentAt = performance.now();
        try {
            const result = await rpc('phoneCallTurn', {callId:c.id, said:text, cue, timing:timingReceipt(turn), ...(cameraNote ? {note:cameraNote} : {})}, c.sessionId);
            turn.id = result.turnId;
            if (Number.isFinite(result.elapsedMs)) {
                turn.timing.clockErrorMs = Math.max(0, (performance.now() - turn.timing.rpcSentAt - result.elapsedMs) / 2);
                turn.timing.hostStartedAt = turn.timing.rpcSentAt + turn.timing.clockErrorMs;
            }
        }
        catch (error) { if (turn.over || call !== c) return; turn.over = true; turn.measure.outcome = 'failed'; if (!turn.held) sync(c, {status:'listening', notice:'通话暂时不顺畅，请稍后再试'}); return; }
        turn.measure.turnId = turn.id;
        if (turn.over || call !== c) { void rpc('phoneCallInterrupt', {callId:c.id, turnId:turn.id, heard:[], retract:turn.retractOnStart === true, timing:timingReceipt(turn)}, c.sessionId).catch(() => {}); return; }
        turn.timing.turnStarted = performance.now();
        if (!turn.held) watchVoice(c, turn);
        while (!turn.over && call === c) {
            let result;
            try { result = await rpc('phoneCallPoll', {callId:c.id, turnId:turn.id, says:turn.segments.length, subs:turn.subs, waitMs:8000}, c.sessionId); }
            catch (error) { if (turn.over || call !== c) break; turn.over = true; turn.measure.outcome = 'failed'; void report(c, 'phoneCallHeard', {turnId:turn.id, heard:heard(c, turn)}); sync(c, {status:'listening', notice:'通话暂时不顺畅，请稍后再试'}); break; }
            if (turn.over || call !== c) break;
            for (const segment of result.segments) {
                const known = turn.segments[segment.index];
                if (!known) {
                    const line = {role:'contact', turn:turn.id, say:segment.say, sub:segment.sub, mood:segment.mood, part:segment.part === true, started:false, seconds:segment.say.length * (c.rate || SECONDS_PER_CHAR), durationKnown:false};
                    turn.segments[segment.index] = line;
                    if (!turn.held) c.lines.push(line);
                    turn.timing.firstSegment ??= performance.now();
                    if (turn.textOnly) { reveal(c, turn, line); void report(c, 'phoneCallHeard', {turnId:turn.id, heard:heard(c, turn)}); }
                    else speak(c, turn, line);
                } else if (segment.sub !== null && known.sub !== segment.sub) known.sub = segment.sub;
            }
            turn.subs = result.segments.filter(row => row.sub !== null).length;
            sync(c);
            if (result.error) sync(c, {notice:'通话暂时不顺畅，请稍后再试'});
            if (result.done || result.superseded) { turn.done = true; turn.timing.model = result.timing || null; turn.timing.modelDoneMs = result.timing?.totalMs; turn.timing.firstSayModelMs = result.timing?.firstSayMs; break; }
        }
        if (!turn.done || turn.over || call !== c || turn.held) return;
        if (turn.textOnly) tick(c);
        else if (turn.pieces.length) schedule(c, turn);
        else { turn.over = true; turn.measure.outcome = 'no-speech'; void report(c, 'phoneCallHeard', {turnId:turn.id, heard:heard(c, turn)}); sync(c, {status:'listening'}); }
    }

    // ---- her voice: collect complete clauses; predict the first start, never stream a partial clause ------------------
    const descriptorOf = c => (c.descriptor ||= rpc('openAssetPackVoice', {alias:c.alias}, c.sessionId));
    function speak(c, turn, line) {
        const piece = {line, buffers:[], ended:false, startAt:null, requestedAt:performance.now(), arrivals:[], seconds:0, spans:[], scheduled:0};
        turn.pieces.push(piece);
        void synthesize(c, turn, piece).catch(error => {
            piece.buffers.length = 0;
            if (turn.over || call !== c) return;
            if (error?.name !== 'AbortError' && error?.code !== 'ABORTED') { piece.failed = true; voiceStatus(c, turn, {state:'error'}); }
        }).finally(() => { piece.ended = true; if (piece.failed && voiceLate(turn, performance.now())) textOnly(c, turn); else schedule(c, turn); });
    }
    // ---- her voice too slow or failed: the turn goes on as text (FIRST_PCM_LATE_MS) -------------------------------------
    function voiceLate(turn, now) {
        const t = turn.timing;
        if (turn.started || t.firstScheduledAt !== undefined || !turn.segments.length) return false;
        return turn.pieces.some(piece => piece.failed || piece.rtf > SLOW_RTF)
            || t.ttsRequestedAt !== undefined && t.firstChunk === undefined && now - t.ttsRequestedAt >= FIRST_PCM_LATE_MS
            || now - Math.max(t.firstSegment ?? now, t.releasedAt ?? -Infinity) >= VOICE_LATE_MS;
    }
    // Her voice for the stage's top-right notice (stage notices.cjs useVoiceStatus): {turn, state:'loading'} from the first
    // synthesis request until her first audio is scheduled (null then: a voice that keeps up shows nothing), 'text' when the
    // turn went on as text (failed: a synthesis failed rather than ran late), 'error' for a clause that failed.
    function voiceStatus(c, turn, value) {
        if (call !== c || turn.held) return;
        set({voice:value ? {turn:turn.id, ...value} : null});
    }
    function watchVoice(c, turn) {
        clearInterval(turn.watch);
        turn.watch = setInterval(() => {
            if (turn.over || turn.held || turn.textOnly || call !== c || turn.started || turn.timing.firstScheduledAt !== undefined) clearInterval(turn.watch);
            else if (voiceLate(turn, performance.now())) textOnly(c, turn);
        }, WATCH_MS);
    }
    // Her voice for this turn is let go; every clause she has, and each one still to come, is said as text.
    function textOnly(c, turn) {
        if (turn.over || turn.held || turn.textOnly || call !== c) return;
        turn.textOnly = true;
        note('text-only', {turnId:turn.id});
        voiceStatus(c, turn, {state:'text', failed:turn.pieces.some(piece => piece.failed)});
        silence(c, turn);
        turn.pieces.length = 0;
        for (const line of turn.segments) if (line) reveal(c, turn, line);
        void report(c, 'phoneCallHeard', {turnId:turn.id, heard:heard(c, turn)});
        tick(c);
    }
    function reveal(c, turn, line) {
        line.started = true; line.durationKnown = true; line.played = line.seconds; turn.started++;
        if (c.video) videoMood(c, line.mood);
    }
    async function synthesize(c, turn, piece) {
        const service = typeof forkTtsScope !== 'undefined' ? forkTtsScope?.get('ttsClient') : null, signal = turn.abort.signal;
        const descriptor = await descriptorOf(c);
        // Browser speech has no audio to stream into the call: the call is silent for her.
        if (!service?.available() || !descriptor?.available || descriptor.browser) throw Object.assign(new Error('voice-unavailable'), {code:'VOICE_UNAVAILABLE'});
        // Collect streamed PCM without playing it; each clause must finish before any of its samples are scheduled.
        let streamed;
        const streaming = new Promise(resolve => { streamed = resolve; });
        if (turn.timing.ttsRequestedAt === undefined) {
            turn.timing.ttsRequestedAt = performance.now();
            voiceStatus(c, turn, {state:'loading'});
            // Sample service state alongside the request, never on its audio critical path.
            void rpc('phoneCallTtsRequested', {callId:c.id, turnId:turn.id}, c.sessionId).catch(() => {});
        }
        const synthesis = service.synthesize({voice:descriptor.voice, text:piece.line.say, mood:piece.line.mood, language:descriptor.language}, {scope:descriptor.scope, signal, priority:'call',
            onStream:live => { turn.timing.ttsStream ??= performance.now(); piece.loudness = live.loudness; streamed({audio:stream(c, turn, piece, live.url, signal)}); }});
        const first = await Promise.race([synthesis.then(result => ({result})), streaming]);
        // her voice plays at its measured level like a stage line (the streamed line at its
        // voice's estimate, a complete line at its own), not the raw synthesis level.
        // Freeze this clip's level. Finishing or queued clips must not retarget a shared gain under the current voice.
        if (first.audio) return first.audio;
        const result = first.result;
        piece.loudness = result.loudness;
        const blob = await service.audio(result.ticket, {signal});
        piece.buffers.push(await output(c).context.decodeAudioData(await blob.arrayBuffer()));
        turn.timing.firstChunk ??= performance.now();
    }
    // The live line is a WAV of unknown length (dsh-tavern-tts live-audio.js: 32-bit float or 16-bit PCM, mono).
    async function stream(c, turn, piece, url, signal) {
        const response = await fetch(url, {credentials:'same-origin', signal});
        if (!response.ok) throw Object.assign(new Error('AUDIO_GONE'), {code:'AUDIO_GONE'});
        const reader = response.body.getReader(), context = output(c).context;
        let carry = new Uint8Array(0), format = null;
        for (;;) {
            const {value, done} = await reader.read();
            if (done || turn.over) break;
            let bytes = carry.length ? concat(carry, value) : value;
            if (!format) {
                if (bytes.length < 44) { carry = bytes.slice(); continue; }
                const head = new DataView(bytes.buffer, bytes.byteOffset, 44);
                format = {float:head.getUint16(20, true) === 3, rate:head.getUint32(24, true), size:head.getUint16(34, true) / 8};
                bytes = bytes.subarray(44);
            }
            const usable = bytes.length - bytes.length % format.size;
            carry = bytes.slice(usable);
            if (!usable) continue;
            const raw = bytes.slice(0, usable).buffer, samples = format.float ? new Float32Array(raw) : Float32Array.from(new Int16Array(raw), value => value / 32768);
            const buffer = context.createBuffer(1, samples.length, format.rate);
            buffer.copyToChannel(samples, 0);
            turn.timing.firstChunk ??= performance.now();
            piece.arrivals.push([performance.now(), piece.seconds]); piece.seconds += buffer.duration;
            learn(c, piece, performance.now());
            piece.buffers.push(buffer); schedule(c, turn);
        }
    }
    function learn(c, piece, now) {
        piece.firstSeconds ??= piece.seconds;
        const produced = piece.seconds - piece.firstSeconds, elapsed = (now - piece.arrivals[0][0]) / 1000;
        if (produced < 0.35 || elapsed < 0.05) return;
        // Reads in one burst refine the same sample, rather than repeatedly smoothing its incomplete first fragment.
        if (piece.estimateAt === undefined || now - piece.estimateAt > 50) piece.estimateBase = c.rtf;
        piece.estimateAt = now;
        piece.rtf = elapsed / produced;
        c.rtf = piece.estimateBase === undefined ? piece.rtf : piece.estimateBase + RTF_ALPHA * (piece.rtf - piece.estimateBase);
    }
    function concat(a, b) { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; }
    function output(c) {
        if (!c.out) { forkLipSync.wake(); c.out = forkStageAudio.voiceStream({gain:1}, {reason:'phone-call-voice'}); }
        if (c.out.context.state === 'suspended') void c.out.context.resume().catch(() => {});
        return c.out;
    }
    // Predict serialized synthesis conservatively (parallel completion can only help). Unknown future model clauses
    // cannot be predicted: use the clauses already received, without waiting for model completion.
    function startReady(c, turn) {
        if (!turn.pieces[0]?.ended) return false;
        const rtf = Math.max(c.rtf ?? INITIAL_RTF, ...turn.pieces.map(piece => piece.rtf || 0)) * 1.2;
        let work = 0, preceding = 0;
        for (const piece of turn.pieces) {
            const seconds = piece.ended ? piece.scheduled + piece.buffers.reduce((sum, buffer) => sum + buffer.duration, 0)
                : Math.max(piece.seconds, piece.line.say.length * (c.rate || SECONDS_PER_CHAR));
            if (!piece.ended) work += Math.max(0, seconds - piece.seconds) * rtf;
            if (work > preceding) return false;
            preceding += seconds;
        }
        return true;
    }
    // Once started, only complete clauses may join the playhead. A prediction miss is a pause BETWEEN clauses.
    function schedule(c, turn) {
        if (turn.over || turn.held || turn.textOnly || call !== c) return;
        if (turn.timing.firstScheduledAt === undefined && !startReady(c, turn)) { tick(c); return; }
        const out = output(c), context = out.context;
        for (const piece of turn.pieces) {
            if (!piece.ended) break;
            while (piece.buffers.length) {
                const buffer = piece.buffers.shift(), now = context.currentTime;
                const at = piece.scheduled ? c.playhead : Math.max(c.playhead || 0, now + LEAD_SECONDS);
                if (turn.timing.firstScheduledAt !== undefined && c.playhead && at > c.playhead) {
                    turn.timing.gaps = (turn.timing.gaps || 0) + 1;
                    turn.timing.gapMs = (turn.timing.gapMs || 0) + (at - c.playhead) * 1000;
                }
                const source = context.createBufferSource();
                if (!piece.input) {
                    piece.input = context.createGain(); piece.input.gain.value = piece.loudness?.gain ?? 1;
                    piece.input.connect(out.input);
                }
                source.buffer = buffer; source.connect(piece.input); source.start(at);
                if (turn.timing.firstScheduledAt === undefined) voiceStatus(c, turn, null);
                turn.timing.firstScheduledAt ??= performance.now() + (at - context.currentTime) * 1000;
                turn.sources.add(source); source.onended = () => { source.disconnect(); turn.sources.delete(source); tick(c); };
                piece.spans.push([at, buffer.duration]); piece.scheduled += buffer.duration;
                if (piece.startAt === null) {
                    piece.startAt = at;
                    turn.timing.startBufferSeconds ??= buffer.duration + piece.buffers.reduce((sum, next) => sum + next.duration, 0);
                    turn.timing.startRtf ??= Math.max(piece.rtf || 0, c.rtf ?? INITIAL_RTF);
                }
                if (piece.audibleAt === undefined) {
                    const first = buffer.getChannelData(0).findIndex(value => Math.abs(value) > 0.01);
                    if (first >= 0) {
                        piece.audibleAt = at + first / buffer.sampleRate;
                        piece.silentSeconds = piece.scheduled - buffer.duration + first / buffer.sampleRate;
                        if (turn.timing.audibleAt === undefined) audible(turn, buffer, at, context);
                    }
                }
                c.playhead = at + buffer.duration;
            }
            if (!piece.ended) break;
        }
        tick(c);
    }
    // Evidence of the first sound she makes: the first sample above -40 dBFS, on the page clock (with output latency).
    function audible(turn, buffer, at, context) {
        const data = buffer.getChannelData(0);
        let first = data.findIndex(value => Math.abs(value) > 0.01);
        if (first < 0) first = 0;
        const latency = (context.baseLatency || 0) + (context.outputLatency || 0);
        turn.timing.outputLatencyMs = latency * 1000;
        turn.timing.audioScheduled = performance.now() + (at - context.currentTime) * 1000;
        turn.timing.audibleAt = turn.timing.audioScheduled + (first / buffer.sampleRate + latency) * 1000;
    }
    // Which pieces she has started saying and how far into each she is (the captions), whether she is speaking, and the end
    // of her reply. Silent PCM is never permission to reveal a generated answer; a voice that failed or cannot keep up
    // turns the whole reply to text (textOnly) instead.
    function tick(c) {
        const turn = c.turn, out = c.out;
        if (!turn || turn.over || turn.held || call !== c || !out) return;
        // currentTime is the rendering clock; captions wait until those samples leave the output device.
        const now = out.context.currentTime - (out.context.baseLatency || 0) - (out.context.outputLatency || 0);
        turn.pieces.forEach(piece => {
            const line = piece.line, complete = piece.ended && !piece.buffers.length;
            line.durationKnown = complete;
            if (complete && piece.scheduled && !piece.rated) { piece.rated = true; c.rate = piece.scheduled / Math.max(1, line.say.length); }
            line.seconds = (complete ? piece.scheduled : Math.max(piece.scheduled, line.say.length * (c.rate || SECONDS_PER_CHAR))) - (piece.silentSeconds || 0);
            line.played = Math.max(0, piece.spans.reduce((sum, [at, seconds]) => sum + Math.min(seconds, Math.max(0, now - at)), 0) - (piece.silentSeconds || 0));
            if (line.started || piece.audibleAt === undefined || piece.audibleAt > now) return;
            line.started = true; turn.started++;
            // Her face follows the clause she has just begun to say, as her voice does (line.mood).
            if (c.video) videoMood(c, line.mood);
            if (turn.started === 1) { turn.timing.audioStarted = performance.now(); void report(c, 'phoneCallHeard', {turnId:turn.id, heard:heard(c, turn)}); note('audio-start', {latencyMs:turn.timing.stoppedAt ? turn.timing.audibleAt - turn.timing.stoppedAt : null}); }
        });
        const playing = (turn.started > 0 || c.greetingClip?.line.started && greetingUntil(c) > now) && c.playhead > now;
        out.paused = !playing; out.currentTime = now;
        forkStageAudio.voice(playing);
        // Audio scheduled but not yet sounding is still to come (a held reply's whole voice can arrive before its release).
        if (!(c.playhead > now) && turn.done && turn.pieces.every(piece => piece.ended && !piece.buffers.length)) { turn.over = true; for (const piece of turn.pieces) piece.input?.disconnect(); turn.measure.outcome = 'completed'; turn.measure.finishedAt = performance.now(); probe.turns.push(turn.timing); if (turn.started) { c.spokeUntil = performance.now(); c.spokeTurn = turn.id; } void report(c, 'phoneCallHeard', {turnId:turn.id, heard:heard(c, turn)}); sync(c, {status:'listening'}); return; }
        const status = playing ? 'speaking' : 'thinking';
        if (state.status !== status || JSON.stringify(shownLines(c)) !== c.shown) sync(c, state.status !== status ? {status} : {});
        if (c.playhead > now) c.ticker ||= setTimeout(() => { c.ticker = null; tick(c); }, 40);
    }
    function silence(c, turn) {
        turn.abort.abort(); clearInterval(turn.watch);
        for (const source of turn.sources) { try { source.stop(); } catch { /* not started */ } }
        // Her greeting is not this turn's to stop; whatever she says next waits for its end.
        turn.sources.clear(); for (const piece of turn.pieces) { clearTimeout(piece.startTimer); piece.input?.disconnect(); } c.playhead = greetingUntil(c);
        if (c.out) { c.out.paused = true; forkStageAudio.voice(false); }
    }


    // ---- ringback: synthesized on the mixer's sound-effect bus (its slider and mute apply); returns stop -------------
    function ringback() {
        const bus = forkStageAudio.callInput({reason:'phone-ringback'}); if (!bus) return () => {};
        const ctx = bus.context, carrier = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain(), am = ctx.createGain(), envelope = ctx.createGain();
        carrier.frequency.value = RING.hz; lfo.frequency.value = RING.modHz;
        // 0.5 + 0.5 x the 16 Hz wave: the full-depth flutter of the Japanese tone.
        am.gain.value = 0.5; depth.gain.value = 0.5; lfo.connect(depth); depth.connect(am.gain);
        carrier.connect(am); am.connect(envelope); envelope.connect(bus.input);
        const gain = envelope.gain, from = ctx.currentTime + 0.05, until = from + probe.ring.maxMs / 1000;
        gain.setValueAtTime(0, ctx.currentTime);
        for (let at = from; at < until; at += RING.period) {
            gain.setValueAtTime(0, at); gain.linearRampToValueAtTime(RING.level, at + 0.012);
            gain.setValueAtTime(RING.level, at + RING.on - 0.012); gain.linearRampToValueAtTime(0, at + RING.on);
        }
        carrier.start(from); lfo.start(from); carrier.stop(until); lfo.stop(until);
        carrier.onended = () => bus.input.disconnect();
        note('ring');
        return () => {
            const now = ctx.currentTime;
            gain.cancelScheduledValues(now); gain.setValueAtTime(gain.value, now); gain.linearRampToValueAtTime(0, now + 0.02);
            try { carrier.stop(now + 0.03); lfo.stop(now + 0.03); } catch { /* already stopped */ }
        };
    }
    // She picks up after the shortest ring once her greeting can sound (or came to nothing), and at the longest ring anyway.
    function answered(c, greeting, since) {
        const waited = performance.now() - since;
        // Her cached greeting can always sound: she picks up at the shortest ring.
        const ready = Boolean(c.greeting) || startReady(c, greeting);
        return waited >= probe.ring.maxMs || waited >= probe.ring.minMs && (greeting.over || ready);
    }
    // ---- her greeting: the cached clip, played the moment she picks up ---------------------------------------------
    // The host reads it from the voice cache at dial (never synthesized then: a busy machine made the live greeting
    // seconds late and the call silent). It is hers whatever happens next - a confirmed barge-in or her reply going to
    // text cuts what follows it, never the greeting; only hang-up stops it. Her reply's clauses join after it.
    async function greetingClip(c, greeting) {
        const bytes = Uint8Array.from(atob(greeting.audio), ch => ch.charCodeAt(0));
        try { return {say:greeting.say, sub:greeting.sub, mood:greeting.mood, loudness:greeting.loudness, buffer:await output(c).context.decodeAudioData(bytes.buffer)}; }
        catch { return null; }
    }
    function greet(c, turn, pickedUpAt) {
        const g = c.greeting, out = output(c), context = out.context, at = context.currentTime + LEAD_SECONDS;
        const source = context.createBufferSource(), input = context.createGain();
        input.gain.value = g.loudness?.gain ?? 1; input.connect(out.input);
        source.buffer = g.buffer; source.connect(input); source.start(at);
        const data = g.buffer.getChannelData(0), first = Math.max(0, data.findIndex(value => Math.abs(value) > 0.01));
        const latency = (context.baseLatency || 0) + (context.outputLatency || 0), until = at + g.buffer.duration;
        const audibleIn = (at - context.currentTime + first / g.buffer.sampleRate + latency) * 1000;
        const line = {role:'contact', turn:turn.id, say:g.say, sub:g.sub, mood:g.mood, greeting:true, started:false, seconds:g.buffer.duration, played:0, durationKnown:true};
        const clip = c.greetingClip = {source, line, until, endsAt:performance.now() + (until - context.currentTime) * 1000, over:false};
        c.lines.push(line);
        c.playhead = Math.max(c.playhead || 0, until);
        source.onended = () => {
            source.disconnect(); input.disconnect(); clip.over = true;
            if (call !== c) return;
            note('greeting-end', {cut:context.currentTime < until - 0.05});
            if (c.turn && !c.turn.over) tick(c); else if (state.status === 'speaking') sync(c, {status:'listening'});
        };
        c.greetingTimer = setTimeout(() => {
            if (call !== c) return;
            line.started = true; line.played = line.seconds;
            note('greeting', {latencyMs:Math.round(performance.now() - pickedUpAt)});
            void rpc('phoneCallGreeted', {callId:c.id}, c.sessionId).catch(() => {});
            if (c.video) videoMood(c, line.mood);
            if (c.turn && !c.turn.over && !clip.over) tick(c); else if (!clip.over) sync(c, {status:'speaking'});
        }, Math.max(0, audibleIn));
    }
    // The greeting still sounding (or its last moments): what the player hears may be its echo, and her voice waits after it.
    const greetingUntil = c => c.greetingClip && !c.greetingClip.over ? c.greetingClip.until : 0;

    // ---- the call ----------------------------------------------------------------------------------------------------
    // `voices`: the phone's 电话 app is open and also needs which contacts have a voice (`voices:{id:boolean}`); a failed read
    // is only shown there (`logFailed`), the rest of the phone works without its call log.
    async function threads(c, attempt = 0, voices = false) {
        let result;
        try { result = await rpc('phoneCallThreads', voices ? {voices:true} : {}, c.sessionId); }
        catch { if (voices && (call === c || !call)) set({logFailed:true}); return; }
        if (call === c || !call) set({threads:result.threads || {}, available:result.available === true, starting:result.starting === true && !result.available, logFailed:false, ...(result.voices ? {voices:result.voices} : {}),
            ...(result.videos ? {videos:result.videos, selfFigure:result.selfFigure === true} : {})});
        // Speech recognition is starting on this machine: look again until it answers.
        if (result.starting && !result.available && attempt < 20) setTimeout(() => { if (!call || call === c) void threads(c, attempt + 1); }, 2000);
    }
    // at {turn, para}: the page the reader is on - the call record stands there in the contact's conversation.
    // `video`: dialled as FaceTime (her card's video key, a FaceTime row's call back): the call screen is FaceTime from the first
    // ring - the stage's background blurred where her video will be - and her picture comes when she picks up.
    async function start({sessionId, contactId, name, at, video = false}) {
        if (call) await end();
        releaseScreen();
        const c = {id:null, sessionId, contactId, alias:contactId, at, lines:[], turn:null, closed:false, playhead:0, vad:{noise:-60, speech:false, recent:[], preroll:[], frames:[], silence:0, asked:null, pauses:0}};
        call = c;
        // From dialling to hang-up the call ducks the stage below her voice; a ringback shares the
        // call's voice output (output(c).input), the same bus.
        forkStageAudio.call(true);
        // A live call keeps its line in the background; every other sound still pauses (foreground.js).
        const keep = forkForeground.keepAudio();
        c.keepAudio = () => { keep(); c.keepAudio = () => {}; };
        set({status:'connecting', contactId, name:name || '', sessionId, startedAt:null, connected:false, elapsed:0, muted:false, video:false, camera:false, lines:[], partial:'', error:null, notice:null, voice:null});
        try {
            const opened = await rpc('phoneCallStart', {contactId, ...(at ? {at} : {})}, sessionId);
            if (call !== c) return;
            c.id = opened.callId; c.language = opened.language;
            // The host ends a call its page stopped answering for (a reload): this heartbeat says the line is still open.
            c.alive = setInterval(() => void rpc('phoneCallAlive', {callId:c.id}, c.sessionId).catch(() => {}), CALL_ALIVE_MS);
            if (opened.contact?.name) set({name:opened.contact.name});
            if (video) startVideo(c);
            void descriptorOf(c);
            output(c);
            // Her greeting from the voice cache (phoneCallStart): it plays the moment she picks up, whatever synthesis is doing.
            c.greeting = opened.greeting ? await greetingClip(c, opened.greeting) : null;
            if (call !== c) return;
            // The call has the line to itself: a stage voice playing or starting now stops.
            voicePlayer.stopPlayback();
            c.stageVoice = voicePlayer.subscribe(() => { const now = voicePlayer.get(); if (call === c && now?.audio && !now.audio.paused) voicePlayer.stopPlayback(); });
            // Her phone rings. She will pick up and speak first, as a call answered: her greeting is written and voiced while
            // it rings, held unheard (the cue never shows as the player's words).
            // The shortest ring counts from the ringback itself: opening its audio output can take a while on a busy machine.
            c.ring = ringback();
            const since = performance.now();
            void say(c, c.greeting ? GREETED_CUE(c.greeting.sub) : CUE, {ringAt:since}, true, true);
            const greeting = c.turn;
            try { await openMic(c); } catch { throw new Error('无法使用麦克风'); }
            if (call !== c) { closeMic(c); return; }
            await new Promise(resolve => { const check = () => { if (call !== c || answered(c, greeting, since)) resolve(); else c.waiting = setTimeout(check, 50); }; check(); });
            if (call !== c) return;
            c.ring(); c.ring = null;
            c.connected = true;
            const startedAt = Date.now();
            set({status:'listening', startedAt, connected:true, elapsed:0});
            if (c.video) remoteFigure(c);
            // The call clock (the phone page keeps no timers of its own).
            c.clock = setInterval(() => { if (call === c) set({elapsed:Math.floor((Date.now() - startedAt) / 1000)}); }, 1000);
            const pickedUpAt = performance.now();
            note('connected', {rangMs:Math.round(pickedUpAt - since)});
            if (c.greeting) greet(c, greeting, pickedUpAt);
            if (greeting.held && !greeting.over) release(c, greeting, pickedUpAt, null);
        } catch (error) {
            if (call !== c) return; // ended meanwhile: end() let it go
            call = null; hangUp(c);
            if (c.id) void rpc('phoneCallEnd', {callId:c.id}, c.sessionId).catch(() => {});
            set({status:'error', error:'暂时无法接通，请稍后再试', connected:false});
        }
    }
    // Everything a call holds: her reply, the ring, the clock, the microphone, the line's audio.
    function hangUp(c) {
        c.closed = true; forkStageAudio.call(false);
        partialClose(c, false);
        if (c.turn && !c.turn.over) { c.turn.over = true; c.turn.measure.outcome = 'aborted'; c.turn.measure.finishedAt = performance.now(); silence(c, c.turn); }
        clearTimeout(c.greetingTimer);
        if (c.greetingClip && !c.greetingClip.over) { try { c.greetingClip.source.stop(); } catch { /* not started */ } }
        c.ring?.(); c.ring = null;
        clearInterval(c.clock); clearInterval(c.alive); clearTimeout(c.ticker); clearTimeout(c.waiting); closeMic(c); c.stageVoice?.(); c.stageVoice = null; c.keepAudio();
        if (c.out) { forkStageAudio.release(c.out); c.out = null; }
    }
    async function end() {
        const c = call;
        if (!c) { if (state.status === 'error') set({status:'idle', error:null}); return; }
        const endedAt = performance.now();
        tick(c);
        call = null; hangUp(c);
        // FaceTime: her picture and the shown self view hold still, dimmed, until the page lets the screen go.
        if (screen?.c === c) { screen.frozen = true; videoChanged(); }
        set({status:'ended', partial:''});
        if (c.id) await report(c, 'phoneCallEnd', c.turn ? {turnId:c.turn.id, heard:heard(c, c.turn)} : {});
        await threads(c);
        setTimeout(() => { if (!call && state.status === 'ended') set({status:'idle'}); }, Math.max(0, ENDED_MS - (performance.now() - endedAt)));
    }
    // 静音 (iOS mute): she hears nothing from the player's microphone. Words being spoken go unheard, and a reply held for
    // them goes with them; the microphone stays open, so unmuting hears the next words at once.
    function mute(c, muted) {
        const v = c.vad;
        if (muted && v.speech) {
            v.speech = false; v.frames = []; v.recent = []; v.asked = null; v.pauses++;
            partialClose(c, true); settle(c);
            if (c.turn?.held) retract(c);
        }
        set({muted, ...(muted && state.status === 'hearing' ? {status:'listening'} : {})});
    }
    // ---- FaceTime: the same call, seen ----------------------------------------------------------------------------------
    function videoChanged() { videoKey++; for (const fn of [...videoListeners]) fn(); }
    // A party's stage figure, as the stage projects it (phoneCallFigure), leased for this call by the stage's resource owner.
    function figureOf(c, who, emotion) {
        const v = c.video, key = who + '|' + (emotion || '');
        if (!v.figures.has(key)) v.figures.set(key, (async () => {
            const {figure} = await rpc('phoneCallFigure', {who, ...(emotion ? {emotion} : {}), ...(c.at ? {at:c.at} : {})}, c.sessionId);
            const owner = stageSessions.resourceOwner, source = stageSessions.get(c.sessionId)?.getSnapshot().source;
            if (!figure || !owner || !source) return null;
            const prepared = await owner.prepare(figure, JSON.stringify([source.sessionId, source.authorityEpoch]));
            if (screen?.c !== c) { prepared.release(); return null; }
            v.pins.push(prepared);
            return prepared.value;
        })().catch(() => null));
        return v.figures.get(key);
    }
    function videoMood(c, mood) {
        const v = c.video;
        if (!mood || v.mood === mood) return;
        v.mood = mood;
        void figureOf(c, c.contactId, mood).then(figure => { if (figure && v.mood === mood && screen?.c === c && !screen.frozen) { screen.remote = figure; videoChanged(); } });
    }
    // The FaceTime key: this call, now on video. Every call starts with the camera off.
    function startVideo(c) {
        if (c.video || !c.id || c.closed) return;
        c.video = {figures:new Map(), pins:[], mood:null, camera:false, told:false};
        releaseScreen();
        screen = {c, alias:c.contactId, remote:null, self:null, layout:screen?.layout || null, frozen:false};
        set({video:true, camera:false});
        videoChanged();
        void rpc('phoneCallVideo', {callId:c.id}, c.sessionId).catch(() => {});
        if (c.connected) remoteFigure(c);
    }
    // Her picture, once she has picked up (a FaceTime still ringing shows only the blurred stage).
    function remoteFigure(c) {
        void figureOf(c, c.contactId, c.video.mood).then(figure => { if (figure && screen?.c === c && !screen.remote) { screen.remote = figure; videoChanged(); } });
    }
    // The camera: on shows the player's own figure (none: the page says it cannot open the camera); off draws nothing.
    function camera(c, on) {
        const v = c.video;
        if (!v || v.camera === on) return;
        v.camera = on;
        set({camera:on});
        screen.self = null;
        videoChanged();
        if (on && state.selfFigure) void figureOf(c, 'self').then(figure => { if (figure && v.camera && screen?.c === c && !screen.frozen) { screen.self = figure; videoChanged(); } });
    }
    function releaseScreen() {
        const old = screen;
        if (!old) return;
        screen = null; videoChanged();
        // The scene lets the picture go first (120 ms), then the leases follow.
        setTimeout(() => { for (const pin of old.c.video?.pins || []) pin.release(); }, 2000);
    }
    // The shutter: the frame the player sees (backdrop, her, the self view) goes into the phone's Photos.
    async function snapshot() {
        if (!screen || screen.frozen || !frameSource) throw Object.assign(new Error('没能拍下这一帧'), {code:'NO_FRAME'});
        return frameSource();
    }
    function command({sessionId, action, contactId, name, muted, voices, at, on, video}) {
        if (action === 'start' && typeof contactId === 'string') void start({sessionId, contactId, name, at, video:video === true});
        else if (action === 'end') void end();
        else if (action === 'mute' && call) mute(call, muted === true);
        else if (action === 'video' && call) startVideo(call);
        else if (action === 'camera' && call) camera(call, on === true);
        else if (action === 'threads' && sessionId) void threads({sessionId}, 0, voices === true);
    }
    // Measurement and acceptance: drive a call the way the phone page does.
    probe.command = command; probe.state = () => state;
    return Object.freeze({
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        get: () => state,
        stage: () => stageKey,
        command,
        /** Stage lip-sync: the contact on stage speaks with the call's voice. */
        speaking() { return call ? {alias:call.alias, audio:state.status === 'speaking' ? call.out : null} : null; },
        // FaceTime: the stage draws the call view where the page leaves it clear.
        videoSubscribe(fn) { videoListeners.add(fn); return () => videoListeners.delete(fn); },
        videoKey: () => videoKey,
        video: () => screen && screen.layout ? {alias:screen.alias, remote:screen.remote, self:screen.self, layout:screen.layout, frozen:screen.frozen,
            audio:!screen.frozen && call === screen.c && state.status === 'speaking' ? call.out : null} : null,
        /** The page's video area ({views, backdrop, frame}; null: the call screen is gone). */
        layout(value) {
            if (!screen) return;
            // The call screen gone for good lets the call view go; a phone put away mid-call only stops drawing it.
            if (!value) { if (screen.frozen || call !== screen.c) releaseScreen(); else { screen.layout = null; videoChanged(); } return; }
            screen.layout = value; videoChanged();
        },
        frames(source) { frameSource = source; return () => { if (frameSource === source) frameSource = null; }; },
        snapshot,
    });
})();
