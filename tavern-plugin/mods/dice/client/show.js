// The stage performance a card's rules ask for on an outcome (outcomes[].show, check-engine.js CHECK_SHOWS; the record
// carries show: {effect, label}). One effect so far, `converge` (Triangle Agency's 三重升华): the picture
// is show-art.js (a canvas painted whole for any moment), its sound show-sound.js
// (procedural 16-beat skeleton mixed with the packaged harmonic beds, with pure-code fallback), both on one timeline
// (SHOW_T); this file is the player.
//
// Once only, like the dice throw (throw.js): a record plays when it first appears in the chat snapshot while this stage
// is mounted, the reply runs and the reader follows live; the records already there when the stage mounts (reload,
// history) never play, nor does a replay. A settled record whose awaiting record (`of`) already performed does not
// perform again: an outcome fixed as the dice land performs on the roll, not again on its settle. Click / tap or Esc
// ends it and cuts its sound. 减少动态 (the stage CONFIG setting): nothing moves - the composition at its height fades
// in, holds and fades out, and the sound has no blow in it (show-sound.js calm). 光敏保护: see show-art.js.
//
// The sound plays on the stage mixer's sound-effect bus (stage-audio.js bufferInput "sfx": the 音效 slider, its mute,
// 总音量, ducking and the foreground rule apply; silent when either is at zero or muted). Its stems are rendered off the
// main thread as the show starts and join the show's clock as they arrive (a late stem starts part-way in).
// The records of the snapshot's latest turn: "" until the chat holds a node.
function showLatestKey(snapshot) {
    const nodes = snapshot && snapshot.nodes;
    if (!nodes || nodes.values()[Symbol.iterator]().next().done) return "";
    const index = checkIndex(snapshot), turn = Math.max(0, ...index.keys());
    return turn + "|" + (index.get(turn)?.checks || "");
}
function showKeyRecords(key) {
    const rows = key.slice(key.indexOf("|") + 1), records = [];
    for (const [callId, text] of rows ? JSON.parse(rows) : []) {
        try { const record = JSON.parse(text); if (record && typeof record === "object") records.push(Object.assign({ callId }, record)); } catch (_) { /* not a record */ }
    }
    return records;
}

const showSoundBedCache = new Map();
function loadShowSoundBed(name) {
    const file = SHOW_SOUND_BEDS[name];
    if (!file || typeof fetch !== "function") return Promise.resolve(null);
    if (!showSoundBedCache.has(name)) {
        const task = fetch(SHOW_SOUND_ASSET_BASE + file).then(res => {
            const type = res.headers?.get?.("content-type") || "";
            return res.ok && !/text\/html/i.test(type) ? res.arrayBuffer() : null;
        }).catch(() => null);
        showSoundBedCache.set(name, task);
    }
    return showSoundBedCache.get(name);
}
async function decodeShowSoundBed(name, rate) {
    const raw = await loadShowSoundBed(name);
    if (!raw || !raw.byteLength) return null;
    const Offline = typeof OfflineAudioContext !== "undefined" ? OfflineAudioContext : (typeof webkitOfflineAudioContext !== "undefined" ? webkitOfflineAudioContext : null);
    if (!Offline) return null;
    try {
        const decoded = await new Offline(2, 1, rate).decodeAudioData(raw.slice(0));
        const left = new Float32Array(decoded.getChannelData(0));
        const right = new Float32Array(decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left);
        return { left, right, rate: decoded.sampleRate };
    } catch (_) { return null; }
}

// The show's sound for one performance: the stems rendered in a worker, each started on the mixer at its cue on the
// show's clock. now(): ms since the show began. → { stop(cut) }; cut silences what sounds (a skip), else it rings out.
// The sound policy (foreground.js): the show holds its mixer route only while DSH Tavern may sound. A show that starts
// while another app has the focus (the stage visible beside it) is silent until the focus comes back, then its stems join
// where the show is; leaving mid-show cuts what sounds, as every other stage sound pauses.
function showSoundPlay(layout, calm, now) {
    const prefs = forkStageAudio.get(), heard = layer => !prefs.muted[layer] && prefs[layer] > 0;
    if (!heard("master") || !heard("sfx")) return { stop() {} };
    const cues = showSoundCues(SHOW_T, calm), stems = new Map(), sources = new Set();
    let route = null, fade = null, over = false, stopped = false, off = null;
    // A rendered stem on the show's clock: ahead of its cue it waits; behind it, it starts that far in; past its end, it is not heard.
    function join(cue) {
        const pcm = stems.get(cue.stem), context = route.context, buffer = context.createBuffer(2, pcm.left.length, SHOW_SOUND_RATE);
        buffer.copyToChannel(pcm.left, 0); buffer.copyToChannel(pcm.right, 1);
        const wait = (cue.at - now()) / 1000;
        if (-wait >= buffer.duration) return;
        const node = context.createBufferSource();
        node.buffer = buffer; node.connect(fade); sources.add(node);
        node.onended = () => { if (sources.delete(node)) { node.disconnect(); settle(); } };
        node.start(context.currentTime + Math.max(0, wait), Math.max(0, -wait));
    }
    function open() {
        route = forkStageAudio.bufferInput("sfx", { loudness: SHOW_SOUND_LOUDNESS, trace: { reason: "check-show", label: layout.record.show.label } });
        if (!route) return;
        fade = route.context.createGain(); fade.connect(route.input);
        for (const cue of cues) if (stems.has(cue.stem)) join(cue);
    }
    // Gives the route back; ramp: a 40 ms fade first (a skip), else at once (the focus left: the mixer is suspended).
    function close(ramp) {
        const was = route, gain = fade, nodes = [...sources], at = was.context.currentTime;
        route = null; fade = null; sources.clear();
        if (ramp) { gain.gain.setValueAtTime(1, at); gain.gain.linearRampToValueAtTime(0, at + 0.04); }
        let ringing = nodes.length;
        const release = () => { gain.disconnect(); was.release(); };
        for (const node of nodes) { node.onended = () => { node.disconnect(); if (!--ringing) release(); }; node.stop(at + (ramp ? 0.05 : 0)); }
        if (!ringing) release();
    }
    function end() {
        if (over) return;
        over = true; off?.(); worker.terminate(); URL.revokeObjectURL(url);
        if (route) close(false);
    }
    // Every stem rendered and joined, none sounding: done.
    const settle = () => { if (route && stems.size === cues.length && !sources.size) end(); };
    function hear(audible) {
        if (over) return;
        if (!audible) { if (route) close(false); if (stopped) end(); }
        else if (!route && !stopped) { open(); settle(); }
    }
    const source = ["const SHOW_SOUND_RATE=" + SHOW_SOUND_RATE, "const SHOW_SOUND_ROOT=" + SHOW_SOUND_ROOT, "const SHOW_SOUND_GAIN=" + SHOW_SOUND_GAIN, showSynth, showEdgeAt, showSlamAt, showSoundMixBed, showSoundStem,
        "onmessage=({data})=>{for(const job of data.jobs){const pcm=showSoundStem(job.name,data.T,data.cast,data.rate,job.bed||null);postMessage({name:job.name,left:pcm.left,right:pcm.right},[pcm.left.buffer,pcm.right.buffer])}}"].join(";\n");
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" })), worker = new Worker(url);
    worker.onmessage = ({ data }) => {
        stems.set(data.name, data);
        if (route) join(cues.find(cue => cue.stem === data.name));
        settle();
    };
    const cast = { dice: layout.dice.length, marked: layout.marked.length, corners: layout.corners, letters: layout.letters.length };
    const post = (jobs, transfer = []) => { if (!over) worker.postMessage({ jobs, T: SHOW_T, cast, rate: SHOW_SOUND_RATE }, transfer); };
    if (calm) {
        decodeShowSoundBed("calm", SHOW_SOUND_RATE).then(bed => post([{ name: "calm", bed }], bed ? [bed.left.buffer, bed.right.buffer] : []));
    } else {
        post([{ name: "open", bed: null }]);
        decodeShowSoundBed("bloom", SHOW_SOUND_RATE).then(bed => post([{ name: "bloom", bed }, { name: "exit", bed: null }], bed ? [bed.left.buffer, bed.right.buffer] : []));
    }
    off = forkForeground.subscribeAudio(hear);
    return {
        // The picture is over: a cut silences what sounds; else it rings out, and a show unheard so far stays so.
        stop(cut) {
            if (over) return;
            stopped = true;
            if (cut && route) close(true);
            if (cut || !route) end();
        }
    };
}

// The show's colours and type (computed; the canvas cannot read var()): paper, ink, the record's mark colour (the
// rules' markColor, else the theme accent) and the stage's display family; a skin's colours for this show (the dsh.dice
// option shows.<name>: paper, ink, mark) over them.
function showLook(layer, layout, skin) {
    const probe = document.createElement("i");
    probe.style.display = "none";
    layer.appendChild(probe);
    const read = css => { probe.style.color = css; return getComputedStyle(probe).color; };
    const mark = layout.marked[0]?.color || layout.dice.find(die => die.color)?.color;
    const own = skin || {};
    const look = { colors: { paper: read(own.paper || "var(--gal-check-show-paper)"), ink: read(own.ink || "var(--gal-check-show-ink)"), mark: read(own.mark || mark || "var(--check-show-mark)") }, font: getComputedStyle(layer).fontFamily };
    probe.remove();
    return look;
}

// The imperative player behind CheckShow: a queue of records, one layer (its canvas).
function createCheckShower(layer, rootRef, device, safety, paused, options) {
    const canvas = layer.querySelector("canvas");
    let queue = [], current = null, frame = 0, listening = false;
    const onClick = event => { event.stopPropagation(); event.preventDefault(); skip(); };
    const onKey = event => { if (event.key !== "Escape") return; event.stopPropagation(); event.preventDefault(); skip(); };
    function listen(on) {
        const method = on ? "addEventListener" : "removeEventListener";
        window[method]("click", onClick, true);
        window[method]("keydown", onKey, true);
    }
    function enqueue(records, calm, done) {
        checkPerforming.hold(records.map(record => record.callId));
        queue.push(...records.map(record => ({ record, calm, done })));
        if (!current) next();
    }
    function next() {
        if (!queue.length || paused()) return;
        start(queue.shift());
    }
    function start({ record, calm, done }) {
        const sr = rootRef.current.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
        const layout = showLayout(record, sr.width, sr.height, device());
        layer.hidden = false;
        layer.dataset.call = record.callId;
        layer.dataset.effect = record.show.effect;
        layer.toggleAttribute("data-calm", calm);
        canvas.width = Math.round(layout.w * dpr); canvas.height = Math.round(layout.h * dpr);
        const t0 = forkForeground.now();
        current = { record, calm, done, layout, dpr, t0, released: false, ctx: canvas.getContext("2d"),
            look: Object.assign(showLook(layer, layout, options()?.values?.shows?.[record.show.effect]), { safe: safety()?.photosensitive === true, still: calm, into: null }),
            sound: showSoundPlay(layout, calm, () => forkForeground.now() - t0) };
        if (!listening) { listening = true; listen(true); }
        // The first frame is drawn before the first paint.
        tick();
    }
    function tick() {
        frame = 0;
        const c = current;
        if (!c) return;
        const T = SHOW_T, t = forkForeground.now() - c.t0;
        if (c.calm) {
            const end = T.calmIn + T.calmHold;
            if (t >= end) release(c);
            // The still is painted once; only its fade moves.
            if (!c.painted) { showPaint(c.ctx, c.layout, c.dpr, t, c.look); c.painted = true; }
            diceFade(canvas, t < T.calmIn ? showOut(t / T.calmIn) : t < end ? 1 : 1 - showOut(diceClamp((t - end) / T.calmOut)));
            layer.dataset.phase = t < end ? "hold" : "fade";
            if (t >= end + T.calmOut) { finish(); return; }
        } else {
            // The end: the field has drawn back into the figure; it is filed on the record's card on the text box (or
            // shrinks where it stands when none shows), and the card shows.
            if (t >= T.end + T.ebb && !c.released) {
                const card = rootRef.current?.querySelector('.fork-gal-box .fork-check[data-call="' + CSS.escape(c.record.callId) + '"]');
                const b = card?.getBoundingClientRect(), a = layer.getBoundingClientRect(), L = c.layout;
                c.look.into = b ? [b.left + b.width / 2 - (a.left + L.cx), b.top + b.height / 2 - (a.top + L.cy)] : [0, 0];
                release(c);
            }
            diceFade(canvas, 1);
            showPaint(c.ctx, c.layout, c.dpr, t, c.look);
            layer.dataset.phase = t < T.fly ? "dice" : t < T.fill ? "converge" : t < T.hit ? "figure" : t < T.end ? "show" : "fade";
            if (t >= T.end + T.ebb + T.exit) { finish(); return; }
        }
        frame = forkForeground.requestAnimationFrame(tick);
    }
    function release(c) { if (!c.released) { c.released = true; checkPerforming.release([c.record.callId]); } }
    // cut: a skip silences the sound; a show that ended lets it ring out.
    function hide(cut) {
        if (frame) forkForeground.cancelAnimationFrame(frame);
        frame = 0;
        if (current) { release(current); current.sound.stop(cut); current.done?.(); }
        current = null;
        layer.hidden = true;
        layer.removeAttribute("data-phase");
        // The canvas keeps no frame (and no memory) between shows.
        canvas.width = canvas.height = 0;
    }
    function finish() {
        hide(false);
        if (queue.length) { start(queue.shift()); return; }
        if (listening) { listening = false; listen(false); }
    }
    function skip() {
        const ids = queue.map(item => item.record.callId);
        queue.forEach(item => item.done?.());
        queue = [];
        if (ids.length) checkPerforming.release(ids);
        if (current) hide(true);
        if (listening) { listening = false; listen(false); }
    }
    return { enqueue, resume() { if (!current) next(); }, skip, dispose: skip };
}
// The mounted stage's show player, for a skin cue that names a show (check-result.js): play(record, effect, label, calm)
// performs that show over the record and resolves when it is over (or skipped).
const checkShowStage = { player: null, play(record, effect, label, calm) {
    const player = this.player;
    return player ? new Promise(done => player.enqueue([Object.assign({}, record, { show: { effect, label } })], calm, done)) : Promise.resolve();
} };

// Stage overlay props as DiceThrow's (mod-clients.js overlay). Records with show play live: one the
// reply called for partway through when the reader comes to that place in the text (place.js), any other as it arrives.
function CheckShow(props) {
    const h = React.createElement;
    const layer = React.useRef(null), player = React.useRef(null), seen = React.useRef(null), latest = React.useRef(props);
    latest.current = props;
    const key = props.useChat(showLatestKey), mod = useModOptions(props.sessionId, "dsh.dice"), optionsRef = React.useRef(mod);
    optionsRef.current = mod;
    React.useEffect(() => {
        const p = createCheckShower(layer.current, props.rootRef, () => latest.current.device, () => latest.current.safety, () => latest.current.veiled === true, () => optionsRef.current);
        player.current = p;
        checkShowStage.player = p;
        return () => { p.dispose(); player.current = null; if (checkShowStage.player === p) checkShowStage.player = null; };
    }, []);
    const placeKey = dicePlaceKey(props.place);
    // Before the paint, so the card never shows its result first.
    React.useLayoutEffect(() => {
        if (!seen.current || seen.current.session !== props.sessionId) seen.current = { session: props.sessionId, ids: null, shown: new Set(), queue: dicePlaceQueue() };
        if (!key) return;
        const records = showKeyRecords(key), s = seen.current;
        const fresh = s.ids ? records.filter(record => !s.ids.has(record.callId)) : [];
        // The first snapshot this stage sees is history: nothing in it performs, and its performed records stay performed.
        const first = !s.ids;
        if (first) s.ids = new Set();
        const arrived = fresh.filter(record => record.show && !(record.of && s.shown.has(record.of)));
        for (const record of records) { s.ids.add(record.callId); if (record.show && record.id) s.shown.add(record.id); }
        const now = latest.current, turn = Number(key.slice(0, key.indexOf("|")));
        if (!first && arrived.length && now.running) s.queue.add(arrived, turn);
        // A show whose place the reader passed while the stage was not live (skipping, the backlog, a menu or page open,
        // the box hidden) waits until it is live again, within its round: a newer round drops it.
        s.queue.drop(item => item.turn < turn);
        if (!now.live) return;
        const due = s.queue.take(now.place);
        if (!due.length) return;
        player.current.enqueue(due, now.calm === true);
    }, [key, props.sessionId, placeKey, props.live]);
    React.useEffect(() => { if (!props.live) player.current?.skip(); }, [props.live]);
    React.useEffect(() => { if (!props.veiled) player.current?.resume(); }, [props.veiled]);
    return h("div", { ref: layer, className: "fork-check-show", "aria-hidden": true, hidden: true }, h("canvas", { className: "fork-check-show-field" }));
}