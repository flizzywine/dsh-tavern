// The stage performance a card's rules ask for on an outcome (outcomes[].show, check-engine.js CHECK_SHOWS; the record
// carries show: {effect, label}). One effect so far, `converge` (Triangle Agency's 三重升华): the picture
// is show-art.js (a canvas painted whole for any moment), its sound show-sound.js
// (synthesized in code, no audio file), both on one timeline (SHOW_T); this file is the player.
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

// The show's sound for one performance: the stems rendered in a worker, each started on the mixer at its cue on the
// show's clock. now(): ms since the show began. → { stop(cut) }; cut silences what sounds (a skip), else it rings out.
function showSoundPlay(layout, calm, now) {
    const prefs = forkStageAudio.get(), heard = layer => !prefs.muted[layer] && prefs[layer] > 0;
    if (!heard("master") || !heard("sfx") || !forkForeground.isAudible()) return { stop() {} };
    const route = forkStageAudio.bufferInput("sfx", { loudness: SHOW_SOUND_LOUDNESS, trace: { reason: "check-show", label: layout.record.show.label } });
    if (!route) return { stop() {} };
    const context = route.context, fade = context.createGain(), sources = new Set(), cues = showSoundCues(SHOW_T, calm);
    fade.connect(route.input);
    let left = cues.length, over = false;
    const end = () => { if (over) return; over = true; worker.terminate(); URL.revokeObjectURL(url); fade.disconnect(); route.release(); };
    const settle = () => { if (!left && !sources.size) end(); };
    const source = ["const SHOW_SOUND_RATE=" + SHOW_SOUND_RATE, "const SHOW_SOUND_ROOT=" + SHOW_SOUND_ROOT, "const SHOW_SOUND_GAIN=" + SHOW_SOUND_GAIN, showSynth, showEdgeAt, showSlamAt, showSoundStem,
        "onmessage=({data})=>{for(const name of data.stems){const pcm=showSoundStem(name,data.T,data.cast,data.rate);postMessage({name,left:pcm.left,right:pcm.right},[pcm.left.buffer,pcm.right.buffer])}}"].join(";\n");
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" })), worker = new Worker(url);
    worker.onmessage = ({ data }) => {
        left--;
        const cue = cues.find(cue => cue.stem === data.name), buffer = context.createBuffer(2, data.left.length, context.sampleRate), node = context.createBufferSource();
        buffer.copyToChannel(data.left, 0); buffer.copyToChannel(data.right, 1);
        node.buffer = buffer; node.connect(fade);
        // On the show's clock: ahead of its cue it waits; behind it, it starts that far in.
        const wait = (cue.at - now()) / 1000;
        if (-wait < buffer.duration) {
            sources.add(node);
            node.onended = () => { sources.delete(node); node.disconnect(); settle(); };
            node.start(context.currentTime + Math.max(0, wait), Math.max(0, -wait));
        }
        settle();
    };
    worker.postMessage({ stems: cues.map(cue => cue.stem), T: SHOW_T, cast: { dice: layout.dice.length, marked: layout.marked.length, corners: layout.corners, letters: layout.letters.length }, rate: context.sampleRate });
    return {
        stop(cut) {
            if (!cut || over) return;
            const at = context.currentTime;
            fade.gain.setValueAtTime(1, at); fade.gain.linearRampToValueAtTime(0, at + 0.04);
            worker.terminate(); left = 0;
            for (const node of sources) node.stop(at + 0.05);
            settle();
        }
    };
}

// The show's colours and type (computed; the canvas cannot read var()): paper, ink, the record's mark colour (the
// rules' markColor, else the theme accent) and the stage's display family.
function showLook(layer, layout) {
    const probe = document.createElement("i");
    probe.style.display = "none";
    layer.appendChild(probe);
    const read = css => { probe.style.color = css; return getComputedStyle(probe).color; };
    const mark = layout.marked[0]?.color || layout.dice.find(die => die.color)?.color;
    const look = { colors: { paper: read("var(--gal-check-show-paper)"), ink: read("var(--gal-check-show-ink)"), mark: read(mark || "var(--check-show-mark)") }, font: getComputedStyle(layer).fontFamily };
    probe.remove();
    return look;
}

// The imperative player behind CheckShow: a queue of records, one layer (its canvas).
function createCheckShower(layer, rootRef, device, safety, paused) {
    const canvas = layer.querySelector("canvas");
    let queue = [], current = null, frame = 0, listening = false;
    const onClick = event => { event.stopPropagation(); event.preventDefault(); skip(); };
    const onKey = event => { if (event.key !== "Escape") return; event.stopPropagation(); event.preventDefault(); skip(); };
    function listen(on) {
        const method = on ? "addEventListener" : "removeEventListener";
        window[method]("click", onClick, true);
        window[method]("keydown", onKey, true);
    }
    function enqueue(records, calm) {
        checkPerforming.hold(records.map(record => record.callId));
        queue.push(...records.map(record => ({ record, calm })));
        if (!current) next();
    }
    function next() {
        if (!queue.length || paused()) return;
        start(queue.shift());
    }
    function start({ record, calm }) {
        const sr = rootRef.current.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
        const layout = showLayout(record, sr.width, sr.height, device());
        layer.hidden = false;
        layer.dataset.call = record.callId;
        layer.dataset.effect = record.show.effect;
        layer.toggleAttribute("data-calm", calm);
        canvas.width = Math.round(layout.w * dpr); canvas.height = Math.round(layout.h * dpr);
        const t0 = forkForeground.now();
        current = { record, calm, layout, dpr, t0, released: false, ctx: canvas.getContext("2d"),
            look: Object.assign(showLook(layer, layout), { safe: safety()?.photosensitive === true, still: calm, into: null }),
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
        if (current) { release(current); current.sound.stop(cut); }
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
        queue = [];
        if (ids.length) checkPerforming.release(ids);
        if (current) hide(true);
        if (listening) { listening = false; listen(false); }
    }
    return { enqueue, resume() { if (!current) next(); }, skip, dispose: skip };
}

// Stage overlay props as DiceThrow's (mod-clients.js overlay). Records with show play as they arrive live.
function CheckShow(props) {
    const h = React.createElement;
    const layer = React.useRef(null), player = React.useRef(null), seen = React.useRef(null), latest = React.useRef(props);
    latest.current = props;
    const key = props.useChat(showLatestKey);
    React.useEffect(() => {
        const p = createCheckShower(layer.current, props.rootRef, () => latest.current.device, () => latest.current.safety, () => latest.current.veiled === true);
        player.current = p;
        return () => { p.dispose(); player.current = null; };
    }, []);
    React.useEffect(() => {
        if (!seen.current || seen.current.session !== props.sessionId) seen.current = { session: props.sessionId, ids: null, shown: new Set() };
        if (!key) return;
        const records = showKeyRecords(key), s = seen.current;
        const fresh = s.ids ? records.filter(record => !s.ids.has(record.callId)) : [];
        // The first snapshot this stage sees is history: nothing in it performs, and its performed records stay performed.
        const first = !s.ids;
        if (first) s.ids = new Set();
        const due = fresh.filter(record => record.show && !(record.of && s.shown.has(record.of)));
        for (const record of records) { s.ids.add(record.callId); if (record.show && record.id) s.shown.add(record.id); }
        const now = latest.current;
        if (first || !due.length || !now.running || !now.live) return;
        player.current.enqueue(due, now.calm === true);
    }, [key, props.sessionId]);
    React.useEffect(() => { if (!props.live) player.current?.skip(); }, [props.live]);
    React.useEffect(() => { if (!props.veiled) player.current?.resume(); }, [props.veiled]);
    return h("div", { ref: layer, className: "fork-check-show", "aria-hidden": true, hidden: true }, h("canvas", { className: "fork-check-show-field" }));
}