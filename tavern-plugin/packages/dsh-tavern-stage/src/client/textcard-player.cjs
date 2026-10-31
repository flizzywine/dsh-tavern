function createStageTextcardPlayers({document,performance,requestAnimationFrame,cancelAnimationFrame,setInterval,clearInterval,setTimeout,clearTimeout,createGate:createTextcardGate,peak:textcardPeak,layout,center}) {
let closed=false;const players=new Set();
// ---------- player ----------
// One card at a time; cards that arrive while one is up queue behind it (one colour change between them, no scene).
// Frame-locked on requestAnimationFrame with a 250 ms watchdog, so a throttled frame clock never leaves a card up.
// Every full-screen colour change waits for the shared gate. skip() ends the current card; cancel() removes everything.
function createTextcardPlayer({doc = document, now = () => performance.now(), raf = fn => requestAnimationFrame(fn), caf = id => cancelAnimationFrame(id),
    setInterval: every = (fn, ms) => setInterval(fn, ms), clearInterval: stopEvery = id => clearInterval(id), gate = createTextcardGate(), fontsReady = () => Promise.resolve(),
    fontsLoaded = () => false,
    context = () => ({}), onChange = () => {}} = {}) {
    let layer = null, queue = [], current = null, phase = 'idle', frameId = 0, watchdog = 0, sceneKey = 'scene', disposed = false;
    const effects=new Set(),waits=new Map();
    function clearWait(entry){const wait=waits.get(entry);if(wait){waits.delete(entry);clearTimeout(wait.id);wait.done();}}
    const log = {changes: [], cards: []};
    let snapshot = {phase, style: null, id: null};
    function emit() {
        const next = {phase, style: current ? current.plan.style : null, id: current ? current.id : null, sr: current && phase === 'up' ? current.plan.sr : ''};
        if (next.phase === snapshot.phase && next.id === snapshot.id) return;
        snapshot = next; onChange(snapshot);
    }
    function schedule() {
        if (disposed || !current && !queue.length) return;
        if (!frameId) frameId = raf(tick);
        if (!watchdog) watchdog = every(() => tick(now(), true), 250);
    }
    function stopClock() {
        if (frameId) caf(frameId); frameId = 0;
        if (watchdog) stopEvery(watchdog); watchdog = 0;
    }
    function changeColour(key, t) {
        if (key === sceneKey) return;
        gate.mark(t); log.changes.push(t); if (log.changes.length > 64) log.changes.shift();
        sceneKey = key;
    }
    function mount(entry, index, t) {
        const frame = entry.plan.frames[index];
        const built = layout.textcardNode(doc, entry.plan, frame, context());
        if (layer) {
            layer.replaceChildren(built.card);
            layout.textcardReadable(built.card, frame, entry.plan);
            try { layout.textcardFit(built.card); center.center(built.card); } catch (_) { /* centring is cosmetic */ }
            if ((frame.layout || entry.plan.layout) === 'morph' && !frame.state.final && frame.state.converge) { const id=raf(()=>{effects.delete(id);if(!disposed&&entry.node===built.card&&layer?.firstChild===built.card)built.card.classList.add('is-converging');});effects.add(id); }
        }
        changeColour(built.key, t);
        entry.deadline = frame.layout && entry.plan.style === 'count' && index > 0 ? entry.deadline + frame.ms : t + frame.ms;
        entry.index = index; entry.shownAt = t; entry.node = built.card;
        entry.record.frames.push(Math.round(t - (entry.record.t0 ?? t)));
        entry.record.t0 ??= t;
    }
    function keyOf(entry, index) { return layout.textcardPaints(entry.plan.frames[index], entry.plan, context()).key; }
    function ready(entry, t) {
        // A colour change may paint only when the gate allows it; the previous state simply stays up.
        const key = entry.index < 0 ? keyOf(entry, 0) : keyOf(entry, entry.index);
        return key === sceneKey || gate.slot(t) <= t;
    }
    function finish(entry, skipped) {
        entry.finished=true;clearWait(entry);
        entry.record.skipped = skipped; entry.record.t1 = now();
        log.cards.push(entry.record); if (log.cards.length > 32) log.cards.shift();
        entry.resolve(skipped);
    }
    function exit(t) {
        if (sceneKey !== 'scene' && gate.slot(t) > t) return false;
        if (layer) layer.replaceChildren();
        if (sceneKey !== 'scene') { gate.mark(t); log.changes.push(t); }
        sceneKey = 'scene';
        return true;
    }
    function tick(t = now(), fromWatchdog = false) {
        if (!fromWatchdog) frameId = 0;
        if (disposed) return;
        t = fromWatchdog ? now() : t;
        if (!current && queue.length) { current = queue.shift(); current.index = -1; phase = 'pending'; emit(); }
        if (!current) {
            if (sceneKey !== 'scene' && !exit(t)) return schedule();
            phase = 'idle'; emit(); stopClock(); return;
        }
        const entry = current;
        if (entry.index < 0 && entry.skip) { finish(entry, true); current = null; return tick(t, fromWatchdog); }
        if (!entry.fontsReady) return schedule();
        if (entry.index < 0) {
            if (!ready(entry, t)) return schedule();
            mount(entry, 0, t); phase = 'up'; emit(); return schedule();
        }
        const frame = entry.plan.frames[entry.index];
        const due = entry.skip || t >= (frame.layout && entry.plan.style === 'count' ? entry.deadline : entry.shownAt + frame.ms - 8);
        if (!due) return schedule();
        const last = entry.index >= entry.plan.frames.length - 1;
        if (!last && !entry.skip) {
            const nextKey = keyOf(entry, entry.index + 1);
            if (nextKey !== sceneKey && gate.slot(t) > t) return schedule();
            mount(entry, entry.index + 1, t); return schedule();
        }
        // End of the card: straight into a queued card (one change), else back to the scene.
        const next = queue[0];
        if (next && next.fontsReady && !next.skip) {
            const key = keyOf(next, 0);
            if (key !== sceneKey && gate.slot(t) > t) return schedule();
            finish(entry, !!entry.skip); current = queue.shift(); current.index = -1;
            mount(current, 0, t); emit(); return schedule();
        }
        if (!exit(t)) return schedule();
        finish(entry, !!entry.skip); current = null; phase = queue.length ? 'pending' : 'idle'; emit();
        if (queue.length) return tick(t, fromWatchdog);
        stopClock();
    }
    return {
        attach(node) { layer = node; if (!node) cancelAll(true); },
        play(plan) {
            if (disposed || !plan || !plan.frames.length) return Promise.resolve(false);
            return new Promise(resolve => {
                // Fonts already in memory: the card mounts inside this call, in the same paint as the page turn.
                const entry = {id: Symbol('textcard'), plan, index: -1, skip: false, fontsReady: !!fontsLoaded(plan), resolve,
                    record: {style: plan.style, planned: plan.frames.map(frame => Math.round(frame.ms)), frames: [], skipped: false}};
                // Fonts get a bounded wait; a slow font never holds the story. Loaded fonts need neither the wait nor a
                // FontFaceSet.load per weight (a burst of queued cards would otherwise pay both for every card).
                if (!entry.fontsReady) Promise.race([Promise.resolve().then(()=>fontsReady(plan)).catch(() => {}), new Promise(done => {const id=setTimeout(done,600);waits.set(entry,{id,done});})]).then(() => {clearWait(entry);if(disposed||entry.finished)return;entry.fontsReady = true;schedule();});
                queue.push(entry); // Admission already bounds accepted cards by the per-turn cap.
                if (!current) { current = queue.shift(); current.index = -1; phase = 'pending'; emit(); }
                if (current === entry && entry.fontsReady) tick(now(), true); else schedule();
            });
        },
        // Click / Space / Enter / wheel during a card: jump to its end. Returns whether a card consumed the input.
        skip() {
            if (!current) return false;
            current.skip = true; schedule(); tick(now(), true);
            return true;
        },
        cancel: cancelAll,
        snapshot: () => snapshot,
        log: () => ({changes: log.changes.slice(), cards: log.cards.slice(), peak: textcardPeak(log.changes, 1000)}),
        dispose() { if(disposed)return;disposed=true;try{cancelAll(true);}finally{for(const id of effects)caf(id);effects.clear();for(const entry of [...waits.keys()])clearWait(entry);layer=null;} },
    };
    function cancelAll(detached = false) {
        for (const entry of queue) {entry.finished=true;clearWait(entry);entry.resolve(true);}
        queue = [];
        // Visible cancellation still changes the full-screen colour; only teardown bypasses the gate.
        if (current && !detached && layer) { current.skip = true; tick(now(), true); return; }
        if (current) { finish(current, true); current = null; }
        if (layer) layer.replaceChildren();
        if (sceneKey !== 'scene') { const t = now(); gate.mark(t); log.changes.push(t); }
        sceneKey = 'scene'; stopClock(); phase = 'idle'; emit();
    }
}

return {create(options){const player=createTextcardPlayer(options);const release=player.dispose;player.dispose=()=>{players.delete(player);release();};if(closed)player.dispose();else players.add(player);return player;},dispose(){if(closed)return;closed=true;const errors=[];for(const player of [...players]){try{player.dispose();}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'Textcard players cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageTextcardPlayers};
