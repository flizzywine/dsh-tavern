// The stage timeline of a card's rule check (tavern_check, check-tool.js) on the gal stage, the check design's ①–⑤:
//   ① declare  the check's line over the dice: 「专注 · 掷骰」 and the rules' tags (「难度 15」「优势」);
//   ② throw    the record's dice in the mod's shared 3D dice (dice3d.js) - each die its real solid (d4 / d6 / d8 / d10 /
//              d12 / d20; a d100 as a tens and a ones d10) - thrown into the band above the text box and landing in a
//              row on the record's faces;
//   ③ read     die by die: what counts glows (a die the rules mark, faces.mark, in the mark colour), what does not count
//              (faces.<group>.flags dropped: the lower of two d20s, a d4 that is no 3) dims; a die the player's choice
//              turned (flags changed, faces.after) hops onto its new face first; then the main number (report main) and
//              its target show under the dice;
//   ④ ask      a record that waits for the player's choices opens the result page (check-result.js) in the band, its
//              card on the text box waiting hidden; skipping the animation goes straight to the page, never past it;
//   ⑤ resolve  a settled record stamps its outcome in its tone's colour, lists what it changed, and shrinks into its card
//              on the text box, which waited hidden meanwhile (checkPerforming, check.js), so no result shows early.
// A settled record whose awaiting record (`of`) was thrown is not thrown again: its dice are at rest from the start,
// the turned ones turn, and it resolves. Every beat is an effect point (checkCues, check-result.js) for the skin's cues.
//
// Once only, like the d100 throw (throw.js): a record plays when it first appears in the chat snapshot while this stage
// is mounted, the reply runs and the reader follows live; the records already there when the stage mounts (reload,
// history) never play. A record with a stage show (show.js) has its dice in the show. Click / tap or Esc ends the
// animation at once; 减少动态 (the stage CONFIG setting) does not animate, a result page still opens. Its sound is the
// d100 throw's: the release, every table contact, the skid, a clack where dice touch (createDiceSounds, the stage SE
// player); the mod's `sound` option off silences it, its `rollSound` option (a skin asset) replaces it with one sound
// at the release.

// Timeline (ms): each die waits `stagger` more than the one before; all rest by DICE_LAND + the last delay + `settle`.
// Turned dice hop for `flip`. The read takes `step` per die (at most `steps` in all); the main number shows for
// `headline` before the outcome; a page opens `ask` after the outcome so far; a settled outcome's seal lands in `seal`,
// each change follows `change` later, all hold `hold`; then the throw shrinks into the card for `fade`.
const CHECK_THROW_T = Object.freeze({ stagger: 45, group: 520, settle: 140, flip: 520, step: 110, steps: 720, headline: 280, ask: 420, seal: 160, change: 160, hold: 900, plain: 620, fade: 260 });
// Dice per row on the band; more go to a second row behind.
const CHECK_THROW_ROW = 8;

// The dice to throw for a record: [{kind, value, after, look, marked, color, flag, die}] (a die with sides no solid
// shows is not thrown).
// A skin dresses each set of dice by its look (the rules' dice.<group>.look, default main): the dsh.dice option dice.<look>
// {body, ink, markInk (over the rules' markColor), texture, faces {value: picture}}; pictures are skin assets (media).
function checkThrowDice(record, colors, mod) {
    const out = [], skin = mod?.values?.dice || {}, media = mod?.media || {};
    for (const die of checkDiceFaces(record)) {
        const dress = skin[die.look] || {};
        const faces = dress.faces ? Object.fromEntries(Object.entries(dress.faces).filter(([, key]) => media[key]).map(([value, key]) => [value, media[key]])) : null;
        const paint = { body: dress.body || colors.body, ink: dress.ink || colors.ink, markInk: dress.markInk || die.color || colors.mark, ...(dress.texture && media[dress.texture] ? { texture: media[dress.texture] } : {}), ...(faces ? { faces } : {}) };
        // The texture marks the faces it shows that the rules mark: as rolled and, for a turned die, after the turn.
        const mark = [die.face, die.after].filter(face => face !== undefined && die.marks.includes(face));
        const solids = diceForSides(die.sides, die.face), after = die.after !== undefined ? diceForSides(die.sides, die.after) : null;
        solids.forEach((solid, k) => {
            out.push({ kind: solid.kind, value: solid.value, after: after && after[k].value !== solid.value ? after[k].value : undefined, die,
                look: { ...paint, mark: die.sides === 100 ? [] : mark, font: colors.font }, marked: die.marked, counts: checkDieCounts(die), color: paint.markInk, flag: die.flag });
        });
    }
    return out;
}
// The stage paints for the check dice (computed; Three.js cannot read var()).
function checkThrowColors(element) {
    const probe = document.createElement("i");
    probe.style.display = "none";
    element.appendChild(probe);
    const read = css => { probe.style.color = css; return getComputedStyle(probe).color; };
    const colors = { body: read("var(--gal-dice-b)"), ink: read("var(--gal-dice-b-ink)"), mark: read("var(--gal-ui-accent)") };
    probe.style.fontFamily = "var(--gal-ui-title-font)";
    colors.font = getComputedStyle(probe).fontFamily;
    probe.remove();
    return colors;
}
const checkThrowHead = record => [record.title && record.title !== record.label ? record.title + " · " + record.label : record.label || "检定", ...(record.tags || [])].join(" · ");
// Whether a record asks the player on the stage (its result page): it waits, and some choice is the player's.
const checkAsks = record => record.status === "awaiting" && checkOpenChoices(record).length > 0;

// The pictures a record's dice are painted with (loaded before its throw).
const checkLookPictures = list => list.flatMap(die => [die.look.texture, ...Object.values(die.look.faces || {})]).filter(Boolean);
// A hidden roll (the rules' hidden): two of its dice tumble in on faces of no meaning and the d100 throw's cup (throw.js)
// slams over them; nothing is read. The rest of the record stays as it is: its card says 暗骰.
function checkHiddenDice(record, list) {
    const rand = diceRandom(record.callId + ":hidden"), first = list[0];
    return first ? [0, 1].map(() => { const [solid] = diceForSides(first.die.sides, 1 + Math.floor(rand() * first.die.sides)); return { ...first, kind: solid.kind, value: solid.value, after: undefined, marked: false, counts: false, flag: undefined }; }) : [];
}
// Each die's delay: the groups throw in their order (the rules' dice.<group>.order; the same number together, the
// smaller first), each group `group` after the one before; within a group `stagger` apart.
function checkDelays(list) {
    const orders = [...new Set(list.map(die => die.die.order))].sort((a, b) => a - b), seen = new Map();
    return list.map(die => { const turn = orders.indexOf(die.die.order), k = seen.get(turn) || 0; seen.set(turn, k + 1); return turn * CHECK_THROW_T.group + k * CHECK_THROW_T.stagger; });
}

// The beats of one record, timed: [{at, point, detail}] and the moments the pictures change. `resolving`: a settled
// record whose dice are already down (its awaiting record was thrown); `list`: the thrown dice.
function checkTimeline(record, list, resolving, at, delays) {
    const T = CHECK_THROW_T, n = list.length, points = [];
    if (record.hidden) {
        // Under the cup: thrown, covered, filed; nothing read.
        points.push({ at: 0, point: "declare", detail: { record } }, { at: 0, point: "throw", detail: { record, order: 1, dice: [] } }, { at: DICE_T.slam, point: "rest", detail: { record } }, { at: DICE_T.hiddenEnd, point: "file", detail: { record } });
        return { points, times: { landed: DICE_T.slam, flips: 0, readAt: DICE_T.slam, step: 0, headlineAt: Infinity, tierAt: Infinity, headline: null, outcome: null, tone: null, end: DICE_T.hiddenEnd, changes: [], hidden: true } };
    }
    const landed = DICE_LAND + Math.max(0, ...delays) + T.settle;
    const flips = list.some(die => die.after !== undefined) ? T.flip : 0;
    const read = list.some(die => die.flag || die.marked);
    const step = read ? Math.min(T.step, T.steps / Math.max(1, n)) : 0, readAt = landed + flips, readEnd = readAt + step * n;
    const headline = checkHeadline(record), outcome = checkOutcomeOf(record), tone = checkToneOf(record);
    if (!resolving) {
        points.push({ at: 0, point: "declare", detail: { record } });
        const orders = [...new Set(list.map(die => die.die.order))].sort((a, b) => a - b);
        orders.forEach((order, turn) => points.push({ at: turn * T.group, point: "throw", detail: { record, order, dice: list.filter(die => die.die.order === order).map(die => die.die) } }));
        list.forEach((die, i) => points.push({ at: DICE_LAND + delays[i], point: "land", detail: { record, index: i, die: die.die, at: at(i) } }));
        points.push({ at: landed, point: "rest", detail: { record } });
    }
    let count = 0;
    if (read) list.forEach((die, i) => {
        const counts = die.counts;
        if (counts) count++;
        if (counts || die.flag) points.push(counts ? { at: readAt + i * step, point: "count", detail: { record, index: i, die: die.die, n: count } } : { at: readAt + i * step, point: "drop", detail: { record, index: i, die: die.die } });
    });
    const headlineAt = readEnd, tierAt = readEnd + (headline ? T.headline : 0);
    if (headline) points.push({ at: headlineAt, point: "headline", detail: { record, headline } });
    const times = { landed, flips, readAt, step, headlineAt, tierAt, headline, outcome, tone };
    if (checkAsks(record)) {
        const now = checkOutcomeNow(record);
        if (now) points.push({ at: tierAt, point: "tier", detail: { record, outcome: now, tone: now.tone || null } });
        times.ask = tierAt + (now ? T.ask : T.ask / 2);
        times.end = times.ask;
        return { points: points.sort((a, b) => a.at - b.at), times };
    }
    const changes = record.hidden ? [] : checkShown(record, record.changes || []);
    if (outcome && !record.hidden) {
        points.push({ at: tierAt, point: "tier", detail: { record, outcome, tone } });
        points.push({ at: tierAt + T.seal, point: "resolve", detail: { record, outcome, tone } });
        changes.forEach((change, k) => points.push({ at: tierAt + T.seal + (k + 1) * T.change, point: "change", detail: { record, change } }));
        times.end = tierAt + T.seal + changes.length * T.change + T.hold;
    } else times.end = Math.max(readEnd + (headline ? T.hold : 0), landed + flips + T.plain);
    times.changes = changes;
    points.push({ at: times.end, point: "file", detail: { record } });
    return { points: points.sort((a, b) => a.at - b.at), times };
}

// The imperative player behind CheckThrow: a queue of records, one band, one renderer. options() are the mod's options
// (sound, rollSound); ask(record, box) opens the result page in the band's box and returns when it is open.
function createCheckThrower(tray, rootRef, device, paused, options, ask) {
    const parts = Object.fromEntries([...tray.querySelectorAll("[data-part]")].map(node => [node.dataset.part, node]));
    const scratch = {}, sounds = createDiceSounds();
    let gl = null, queue = [], current = null, frame = 0, idle = 0, loading = false, alive = true, listening = false;
    const onClick = event => { event.stopPropagation(); event.preventDefault(); skip(); };
    const onKey = event => { if (event.key !== "Escape") return; event.stopPropagation(); event.preventDefault(); skip(); };
    function listen(on) {
        const method = on ? "addEventListener" : "removeEventListener";
        window[method]("click", onClick, true);
        window[method]("keydown", onKey, true);
    }
    // records: [{record, resolving}] (resolving: a settled record whose dice are already down).
    function enqueue(items) {
        checkPerforming.hold(items.map(item => item.record.callId));
        queue.push(...items);
        if (!current && !loading) void next();
    }
    // The band's box on the stage: centred over the text box, as wide as it allows, up to its device profile's size.
    function band() {
        const root = rootRef.current, box = root.querySelector(".fork-gal-box");
        const sr = root.getBoundingClientRect(), br = box.getBoundingClientRect();
        const [tw, th] = DICE_TRAY[device()] || DICE_TRAY.desktop;
        const w = Math.round(Math.min(tw, br.width)), h = Math.round(Math.max(110, Math.min(th, br.top - sr.top - 48)));
        return { w, h, left: Math.round(br.left - sr.left + (br.width - w) / 2), bottom: Math.round(sr.bottom - br.top + 4), top: Math.round(br.top - sr.top - 4 - h) };
    }
    // The result page in place of the band; the card stays held until the page is done with.
    function askNow(record) {
        checkCues.emit("ask", { record });
        ask(record, band());
    }
    async function next() {
        if (!queue.length || paused()) return;
        if (!gl) {
            loading = true;
            try {
                const [THREE, room] = await diceLoadThree();
                if (!alive) return;
                gl = diceScene(THREE, room.RoomEnvironment);
                scratch.q = new THREE.Quaternion(); scratch.v = new THREE.Vector3();
            } catch (error) {
                console.error("[fork-check-throw]", error);
                skip();
                return;
            } finally { loading = false; }
            if (!queue.length || paused()) return;
        }
        // The skin's dice pictures are loaded before the throw that paints with them.
        const item = queue[0], mod = options();
        loading = true;
        try { await diceLoadImages(checkLookPictures(checkThrowDice(item.record, { body: "", ink: "", mark: "" }, mod))); } finally { loading = false; }
        if (!alive || queue[0] !== item || paused()) { if (alive && queue.length && !paused()) void next(); return; }
        start(queue.shift());
    }
    function start({ record, resolving }) {
        clearTimeout(idle);
        const { THREE } = gl;
        const { w, h, left, bottom, top } = band();
        tray.hidden = false;
        Object.assign(tray.style, { width: w + "px", height: h + "px", left: left + "px", bottom: bottom + "px", transform: "" });
        diceFade(tray, 1);
        tray.dataset.call = record.callId;
        tray.removeAttribute("data-faces");
        parts.line.textContent = checkThrowHead(record);
        diceFade(parts.line, resolving ? 1 : 0);
        parts.canvas.appendChild(gl.canvas);
        const mod = options(), thrown = checkThrowDice(record, checkThrowColors(tray), mod), hidden = record.hidden === true;
        const list = hidden ? checkHiddenDice(record, thrown) : thrown;
        if (hidden) parts.line.textContent = checkThrowHead(record) + " · 暗骰";
        const meshes = gl.place(list, device() === "desktop" ? 192 : 128);
        meshes.forEach(mesh => { mesh.material.emissive.setRGB(0, 0, 0); mesh.material.emissiveIntensity = 0; mesh.material.transparent = false; mesh.material.opacity = 1; });
        // The skin's tone colours (the dsh.dice option tones) over the stage's, on the band and the result page.
        for (const tone of CHECK_TONES) tray.style.setProperty("--gal-check-tone-" + tone, mod?.values?.tones?.[tone] || "");
        tray.dataset.seal = mod?.values?.result?.seal || "stamp";
        gl.cup ||= diceAddCup(THREE, gl);
        gl.cup.group.visible = gl.cup.shadow.visible = false;
        const zoom = DICE_ZOOM[device()] || 1;
        gl.renderer.setPixelRatio(galResolution("high"));
        gl.renderer.setSize(w, h, false);
        gl.camera.aspect = w / h;
        gl.camera.zoom = zoom;
        gl.camera.updateProjectionMatrix();
        // A hidden roll is seen lower, so the cup stands and its talisman faces you (as the d100's).
        const [eye, aim] = hidden ? [[0, 4.6, 7.4], [0, 0.9, 0.5]] : [[0, 6.7, 5.1], [0, 0, 0.4]];
        gl.camera.position.set(...eye); gl.camera.lookAt(...aim); gl.camera.updateMatrixWorld();
        // Many dice are drawn smaller, so a row of them fits the band.
        const n = list.length, scale = DICE_SCALE * Math.min(1, 5.2 / Math.min(n, CHECK_THROW_ROW));
        const rand = diceRandom(record.callId), jitter = () => (rand() - 0.5) * 0.3;
        const half = Math.tan(16 * Math.PI / 180) * gl.camera.position.distanceTo(new THREE.Vector3(...aim)) * (w / h) / zoom, from = -Math.min(6, Math.max(2.4, half * 0.8));
        // The rest row(s) on screen: centred under the line, evenly spaced, higher when the read row shows under them;
        // each die then nudged so its box sits on its spot.
        const reads = Boolean(checkHeadline(record) || checkOutcomeOf(record));
        tray.toggleAttribute("data-reads", reads);
        const lineBottom = parts.line.offsetTop + parts.line.offsetHeight, rows = Math.ceil(n / CHECK_THROW_ROW), room = reads ? 0.62 : 1;
        const spots = list.map((_, i) => {
            const row = Math.floor(i / CHECK_THROW_ROW), inRow = Math.min(CHECK_THROW_ROW, n - row * CHECK_THROW_ROW), k = i - row * CHECK_THROW_ROW;
            const step = Math.min(w * 0.86 / inRow, h * 0.42 * room);
            return [w / 2 + (k - (inRow - 1) / 2) * step, lineBottom + (h * room - lineBottom) * (rows === 1 ? 0.5 : 0.3 + row * 0.42)];
        });
        const delays = hidden ? [0, 60] : checkDelays(list);
        // Under the cup the two dice rest one behind the other, well inside its lip (as the d100's).
        let rest = hidden ? [new THREE.Vector3(-0.32, 0, 0.12), new THREE.Vector3(0.32, 0, 0.98)] : spots.map(([sx, sy]) => diceFloorAt(THREE, gl.camera, w, h, sx, sy));
        const plan = (i, to) => diePlan(THREE, meshes[i].userData.model, list[i].value, new THREE.Vector3(from - (i % 3) * 0.4 + jitter(), 0, (hidden ? 0.6 + i * 0.9 : -0.4 + (i % 4) * 0.5) + jitter()), to, diceRandom(record.callId + ":" + i), delays[i]);
        let plans = [];
        for (let pass = 0; pass < (hidden ? 1 : 2); pass++) {
            plans = rest.map((to, i) => plan(i, to));
            if (pass === 1) break;
            rest = rest.map((point, i) => {
                const box = dieRestBox(gl.camera, meshes[i], plans[i], scale, w, h, scratch), p = point.clone().project(gl.camera);
                const sx = (p.x + 1) / 2 * w, sy = (1 - p.y) / 2 * h;
                return diceFloorAt(THREE, gl.camera, w, h, sx + spots[i][0] - (box[0] + box[2] / 2), sy + spots[i][1] - (box[1] + box[3] / 2));
            });
        }
        // A turned die hops in place onto its face after the change (a low hop, a short spin).
        const flips = list.map((die, i) => die.after === undefined ? null : diePlan(THREE, meshes[i].userData.model, die.after, rest[i].clone(), rest[i].clone(), diceRandom(record.callId + ":turn:" + i), 0));
        const timeline = checkTimeline(record, list, resolving, i => [left + spots[i][0], top + spots[i][1]], delays), T = timeline.times;
        if (hidden) {
            // The dust ring at the cup's lip on the floor, sized from the projected lip.
            const project = v => { const p = v.clone().project(gl.camera); return [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h]; };
            const [dx, dy] = project(new THREE.Vector3(0, 0, 0.55)), lip = project(new THREE.Vector3(1.53, 0, 0.55))[0] - dx;
            Object.assign(parts.dust.style, { left: dx + "px", top: dy + "px", width: Math.round(lip * 3.4) + "px" });
        }
        diceFade(parts.dust, 0);
        // The read row: the main number and its target, the outcome's seal and the changes, filled now and shown on their beats.
        fillCheckRead(parts, record, T);
        tray.dataset.tone = T.tone || "";
        if (!gl.compiled) { gl.renderer.compile(gl.scene, gl.camera); gl.compiled = true; }
        const contacts = diceContacts(meshes, plans, scale, scratch);
        const cues = resolving ? [] : hidden ? diceCues({ hidden: true }, contacts, {}) : [...new Set(delays.map(delay => delay - delay % CHECK_THROW_T.group))].map(at => ({ at, beat: "throw", db: 0 })).concat(contacts.floor.map(c => ({ at: c.at, beat: "hit", db: c.db - 10 * Math.log10(Math.max(1, n / 2)) })), [{ at: contacts.skid, beat: "roll", db: 0 }], contacts.clacks.map(at => ({ at, beat: "clack", db: 0 }))).sort((a, b) => a.at - b.at);
        tray.dataset.cues = JSON.stringify(cues.map(cue => [Math.round(cue.at), cue.beat, Math.round(cue.db * 10) / 10]));
        tray.dataset.dice = list.map(die => die.kind).join(" ");
        current = { record, list, meshes, plans, flips, scale, w, h, T, hidden, points: timeline.points.slice(), offset: resolving ? T.landed : 0, t0: null, released: false, cues: [] };
        const c = current, values = options()?.values || {}, custom = values.rollSound && options()?.media?.[values.rollSound];
        const token = "check:" + record.callId;
        if (values.sound === false || resolving) current.sound = { play() {}, stop() {} };
        else if (custom) {
            current.sound = { play() {}, stop(cut) { if (cut) stageSfx.stopToken(token); } };
            void Promise.resolve(stageSfx.play(custom, "skin:" + values.rollSound, undefined, token, 1, { trace: { reason: "dice:check" } }));
        } else {
            current.cues = cues.slice();
            current.sound = sounds.prepare(current.cues, token, () => forkForeground.now() - c.t0);
        }
        if (!listening) { listening = true; listen(true); }
        stopFrame();
        frame = forkForeground.requestAnimationFrame(tick);
    }
    function stopFrame() { if (frame) forkForeground.cancelAnimationFrame(frame); frame = 0; }
    function tick() {
        frame = 0;
        const c = current;
        if (!c) return;
        const T = c.T, t = (c.t0 === null ? 0 : forkForeground.now() - c.t0) + c.offset;
        const flipAt = T.landed, k = diceClamp((t - flipAt) / CHECK_THROW_T.flip);
        c.meshes.forEach((mesh, i) => {
            if (c.flips[i] && t >= flipAt) checkTurnPose(mesh, c.plans[i], c.flips[i], k, c.scale, scratch);
            else diePose(mesh, c.plans[i], t, c.scale, scratch);
        });
        while (c.cues.length && c.cues[0].at <= t) { const cue = c.cues.shift(); if (t - cue.at <= DICE_SE_LATE) c.sound.play(cue); }
        const holds = [];
        while (c.points.length && c.points[0].at <= t) { const beat = c.points.shift(); holds.push(...checkCues.emit(beat.point, beat.detail)); }
        diceFade(parts.line, diceClamp(t / 180));
        tray.dataset.phase = t < T.landed ? "throw" : t < T.readAt ? "turn" : T.ask !== undefined && t >= T.ask ? "ask" : t < T.end ? "read" : "fade";
        if (t >= T.landed && !tray.hasAttribute("data-faces")) tray.dataset.faces = c.meshes.map(mesh => dieUp(mesh, scratch)).join(" ");
        if (t >= T.landed + T.flips && T.flips && !tray.hasAttribute("data-after")) tray.dataset.after = c.meshes.map(mesh => dieUp(mesh, scratch)).join(" ");
        checkReadPaint(c, t);
        drawCheckRead(parts, tray, c, t);
        if (c.hidden) { const pose = diceCupPose(gl.cup, t, parts.dust, diceJolt); if (t < T.end) tray.style.transform = pose.shake; if (pose.covered) tray.dataset.cup = "covered"; }
        if (T.ask !== undefined && t >= T.ask) {
            // ④: the page takes the band's place; the card stays held until the page is done with.
            gl.renderer.render(gl.scene, gl.camera);
            const record = c.record;
            c.sound.stop(false);
            hide();
            askNow(record);
            after();
            return;
        }
        if (t >= T.end) {
            // ⑤ ends: the throw shrinks into its card on the text box (or just fades when none shows), the card returns.
            if (!c.released) {
                c.released = true;
                const card = rootRef.current.querySelector('.fork-gal-box .fork-check[data-call="' + CSS.escape(c.record.callId) + '"]');
                const a = tray.getBoundingClientRect(), b = card?.getBoundingClientRect();
                c.into = b ? [b.left + b.width / 2 - (a.left + a.width / 2), b.top + b.height / 2 - (a.top + a.height / 2)] : [0, 0];
                checkPerforming.release([c.record.callId]);
            }
            const e = diceOut(diceClamp((t - T.end) / CHECK_THROW_T.fade));
            tray.style.transform = "translate(" + (c.into[0] * e).toFixed(1) + "px, " + (c.into[1] * e).toFixed(1) + "px) scale(" + (1 - 0.86 * e).toFixed(3) + ")";
            diceFade(tray, 1 - Math.pow(e, 1.6));
        }
        gl.renderer.render(gl.scene, gl.camera);
        // The clock starts on the second frame (the first render can stall on shaders and textures).
        if (c.t0 === null && c.drawn) c.t0 = forkForeground.now();
        c.drawn = true;
        if (t >= T.end + CHECK_THROW_T.fade) { finish(); return; }
        // A held cue (a show over the stage): the clock stops until it is over, then runs on from here.
        if (holds.length && c.t0 !== null) {
            const at = forkForeground.now();
            void Promise.all(holds).then(() => { if (current !== c) return; c.t0 += forkForeground.now() - at; frame = forkForeground.requestAnimationFrame(tick); });
            return;
        }
        frame = forkForeground.requestAnimationFrame(tick);
    }
    function hide() {
        tray.hidden = true;
        for (const name of ["data-phase", "data-after", "data-reads", "data-tone", "data-cup"]) tray.removeAttribute(name);
        if (gl?.cup) gl.cup.group.visible = gl.cup.shadow.visible = false;
        current = null;
    }
    function rest() {
        if (listening) { listening = false; listen(false); }
        stopFrame();
        clearTimeout(idle);
        sounds.reset();
        if (gl) idle = setTimeout(() => { gl?.dispose(); gl = null; }, DICE_IDLE_MS);
    }
    // The next record, or rest.
    function after() {
        if (queue.length && !paused()) { void next(); return; }
        rest();
    }
    function finish() {
        current.sound.stop(false);
        checkPerforming.release([current.record.callId]);
        hide();
        after();
    }
    // The end state at once: every queued and playing throw becomes its card, its sound is cut - except a record that
    // asks the player, which opens its result page (the page itself is never skipped).
    function skip() {
        const items = [...queue, ...(current ? [{ record: current.record }] : [])];
        queue = [];
        const asking = items.filter(item => checkAsks(item.record)).map(item => item.record);
        const ids = items.map(item => item.record.callId).filter(id => !asking.some(record => record.callId === id));
        if (ids.length) checkPerforming.release(ids);
        if (current) { current.sound.stop(true); hide(); rest(); }
        // One page at a time: the newest asking record (an earlier one was answered by the later ones or is moot).
        if (asking.length) { if (asking.length > 1) checkPerforming.release(asking.slice(0, -1).map(record => record.callId)); askNow(asking.at(-1)); }
    }
    function dispose() {
        alive = false;
        const ids = [...queue, ...(current ? [{ record: current.record }] : [])].map(item => item.record.callId);
        queue = [];
        if (ids.length) checkPerforming.release(ids);
        if (current) { current.sound.stop(true); hide(); }
        rest(); clearTimeout(idle); gl?.dispose(); gl = null;
    }
    return { enqueue, ask: askNow, resume() { if (!current && !loading) void next(); }, skip, dispose };
}

// A turned die (k 0 → 1): a low hop in place while it rolls from its face as rolled onto its face after the turn.
function checkTurnPose(mesh, plan, turn, k, scale, scratch) {
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(2 - 2 * k, 2) / 2;
    mesh.quaternion.copy(plan.final).slerp(turn.final, e);
    let low = Infinity;
    for (const v of plan.model.vertices) low = Math.min(low, scratch.v.copy(v).applyQuaternion(mesh.quaternion).y);
    mesh.scale.setScalar(scale);
    mesh.position.set(plan.to.x, 3.2 * k * (1 - k) - low * scale, plan.to.z);
}

// The read row's words for one record (they show on their beats, drawCheckRead).
function fillCheckRead(parts, record, T) {
    for (const name of ["headline", "now", "seal", "changes"]) diceFade(parts[name], 0);
    const headline = T.headline;
    parts.label.textContent = headline ? headline.label : "";
    parts.number.textContent = headline ? String(headline.value) : "";
    parts.target.textContent = headline && headline.target ? checkTargetText(headline.target) : "";
    parts.seal.textContent = T.ask === undefined && T.outcome && !record.hidden ? T.outcome.label : "";
    const now = T.ask !== undefined ? checkOutcomeNow(record) : null;
    parts.now.textContent = now ? "现在 · " + now.label : "";
    parts.now.dataset.tone = now && now.tone || "";
    parts.changes.textContent = (T.changes || []).map(checkChangeText).join("，");
}
// The dice as the read goes: a counted die glows in its mark colour (or the ink), a dropped one dims.
function checkReadPaint(c, t) {
    const T = c.T;
    c.meshes.forEach((mesh, i) => {
        const die = c.list[i], at = T.readAt + i * T.step;
        if (!T.step || t < at) { mesh.material.emissiveIntensity = 0; return; }
        const k = diceClamp((t - at) / 220);
        if (die.flag && !die.counts) { mesh.material.transparent = true; mesh.material.opacity = 1 - 0.62 * k; mesh.material.emissiveIntensity = 0; return; }
        if (!die.counts) return;
        mesh.material.emissive.set(die.marked ? die.color : "#ffffff");
        // A pulse as it is counted, settling to a low glow while the check stays up.
        mesh.material.emissiveIntensity = (die.marked ? 0.55 : 0.22) * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, k * 1.4)));
    });
}
// The read row on its beats: the main number pops in, the outcome so far or the seal lands, the changes follow.
function drawCheckRead(parts, tray, c, t) {
    const T = c.T;
    const pop = (node, at, from) => {
        const k = diceClamp((t - at) / 200);
        diceFade(node, t < at ? 0 : Math.min(1, k * 1.5));
        node.style.transform = "scale(" + (t < at ? from : from + (1 - from) * diceOut(k)).toFixed(3) + ")";
    };
    pop(parts.headline, T.headline ? T.headlineAt : Infinity, 0.7);
    pop(parts.now, T.ask !== undefined ? T.tierAt : Infinity, 0.9);
    // The seal falls from large and tilted onto the row, like the d100 throw's stamp.
    const sealAt = T.ask === undefined && T.outcome ? T.tierAt : Infinity, f = diceClamp((t - sealAt) / CHECK_THROW_T.seal);
    diceFade(parts.seal, t < sealAt ? 0 : Math.min(1, f * 1.6));
    parts.seal.style.transform = "rotate(" + (-6 - 6 * (1 - f * f)).toFixed(1) + "deg) scale(" + (t < sealAt ? 1.5 : 1.5 - 0.5 * f * f).toFixed(3) + ")";
    const changesAt = sealAt + CHECK_THROW_T.seal;
    diceFade(parts.changes, t < changesAt ? 0 : diceClamp((t - changesAt) / 240));
}

// The result page as the skin dresses it: its tone colours (the dsh.dice option tones) and its frame picture (result.frame).
function checkSkinPage(mod) {
    const values = mod?.values || {}, frame = values.result?.frame && mod.media?.[values.result.frame];
    return Object.assign(Object.fromEntries(CHECK_TONES.filter(tone => values.tones?.[tone]).map(tone => ["--gal-check-tone-" + tone, values.tones[tone]])),
        frame ? { backgroundImage: "url(" + JSON.stringify(frame) + ")", backgroundSize: "cover", backgroundPosition: "center" } : {});
}

// Stage overlay props as DiceThrow's (mod-clients.js overlay), with input ({submit(text)}, the player's next message).
function CheckThrow(props) {
    const h = React.createElement;
    const tray = React.useRef(null), player = React.useRef(null), seen = React.useRef(null), latest = React.useRef(props);
    latest.current = props;
    const options = useModOptions(props.sessionId, "dsh.dice"), optionsRef = React.useRef(options);
    optionsRef.current = options;
    const key = props.useChat(showLatestKey);
    // The result page open now: { record, box } (the band's box on the stage).
    const [page, setPage] = React.useState(null);
    const latestTurn = key ? Number(key.slice(0, key.indexOf("|"))) : 0;
    const answerable = useCheckAnswerable(props.useChat, latestTurn) && Boolean(props.input);
    // The skin's cues hang on the timeline's effect points (check-result.js checkPlayCues).
    React.useEffect(() => checkCues.on((point, detail) => checkPlayCues(optionsRef.current, point, detail, { screen: latest.current.screen, calm: latest.current.calm === true })), []);
    React.useEffect(() => {
        const p = createCheckThrower(tray.current, props.rootRef, () => latest.current.device, () => latest.current.veiled === true, () => optionsRef.current,
            (record, box) => setPage({ record, box }));
        player.current = p;
        return () => { p.dispose(); player.current = null; };
    }, []);
    // Before the paint, so the card never shows its result first.
    React.useLayoutEffect(() => {
        if (!seen.current || seen.current.session !== props.sessionId) seen.current = { session: props.sessionId, ids: null, thrown: new Set() };
        if (!key) return;
        const records = showKeyRecords(key), s = seen.current, first = !s.ids;
        if (first) s.ids = new Set();
        const fresh = records.filter(record => !s.ids.has(record.callId));
        const due = fresh.filter(record => record.dice && !record.show && checkDiceFaces(record).some(die => diceForSides(die.sides, die.face).length))
            .map(record => ({ record, resolving: Boolean(record.of && s.thrown.has(record.of)) }));
        for (const record of records) { s.ids.add(record.callId); if (record.dice && record.id) s.thrown.add(record.id); }
        const now = latest.current;
        if (first || !due.length || !now.running || !now.live) return;
        // 减少动态: nothing moves; a record that asks the player still opens its page.
        if (now.calm) { const asking = due.filter(item => checkAsks(item.record)).at(-1); if (asking) { checkPerforming.hold([asking.record.callId]); player.current.ask(asking.record); } return; }
        player.current.enqueue(due);
    }, [key, props.sessionId]);
    React.useEffect(() => { if (!props.live || props.calm) player.current?.skip(); }, [props.live, props.calm]);
    React.useEffect(() => { if (!props.veiled) player.current?.resume(); }, [props.veiled]);
    // The page is done with once a newer round begins (the player answered or wrote something else).
    React.useEffect(() => { if (page && latestTurn && page.turn !== undefined && latestTurn !== page.turn) close(); }, [latestTurn]);
    React.useEffect(() => { if (page && page.turn === undefined) setPage(Object.assign({}, page, { turn: latestTurn })); }, [page]);
    function close() {
        if (!page) return;
        checkPerforming.release([page.record.callId]);
        checkCues.emit("file", { record: page.record });
        setPage(null);
    }
    const box = page && page.box;
    return h(React.Fragment, null,
        h("div", { ref: tray, className: "fork-check-throw", "aria-hidden": true, hidden: true },
            h("div", { className: "fork-dice-throw-dust", "data-part": "dust" }),
            h("div", { className: "fork-dice-throw-gl", "data-part": "canvas" }),
            h("div", { className: "fork-dice-throw-line", "data-part": "line" }),
            h("div", { className: "fork-check-read" },
                h("div", { className: "fork-check-read-headline", "data-part": "headline" },
                    h("span", { className: "fork-check-read-label", "data-part": "label" }),
                    h("span", { className: "fork-check-read-number", "data-part": "number" }),
                    h("span", { className: "fork-check-read-target", "data-part": "target" })),
                h("div", { className: "fork-check-read-now", "data-part": "now" }),
                h("div", { className: "fork-check-read-seal", "data-part": "seal" }),
                h("div", { className: "fork-check-read-changes", "data-part": "changes" }))),
        page ? h(CheckResultPage, { key: page.record.callId, record: page.record, input: props.input, answerable, look: options && options.values || null,
            style: Object.assign(box ? { left: box.left + "px", bottom: box.bottom + "px", width: box.w + "px", maxHeight: Math.max(box.h, box.top + box.h - 8) + "px" } : {}, checkSkinPage(options)),
            onSend: values => { checkCues.emit("choose", { record: page.record, choice: values }); close(); },
            onFold: close }) : null);
}
