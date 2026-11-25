// the 3D throw of a NEW tavern_roll on
// the gal stage. Two d10s (tens 00–90 + ones 0–9; 00 + 0 = 100) are thrown into the centre-lower band of the stage, just
// above the text box, under the roll's check line (「潜行检定」), and land on the faces of the tool record; their
// values fly into the big d100 number and the result is stamped under it as a seal in the tier colour (大成功 gold burst,
// light rays and a hit-stop; 代价成功 a cracked, half-inked stamp; 大失败 a desaturating crack flash and shake), then the whole
// throw collapses into the round's static card (dice-roll.js), which waits hidden in place meanwhile. A hidden roll
// tumbles in, a lacquered dice cup (骰盅) with a paper talisman 「?」 slams down over it and nothing is shown (its dice land
// on arbitrary faces); the card's own peek reveals it.
//
// Once only: a roll plays when its tool result first appears in the chat snapshot while this stage is mounted, the reply
// is running, the roll belongs to the snapshot's latest turn and the reader follows live (not skipping - skip is silent -,
// history / film / an open overlay / the box hidden). Everything else — the rolls already there when the stage mounts
// (reload, reopen, history) — is consumed without playing, like the stage's mod one-shots
//. A clip export's replay of a round is the one exception: it throws
// that round's rolls again, in order, with their sound, as the replay starts. Click / tap anywhere or Esc ends it at once; 减少动态 (the
// stage CONFIG setting only — motion never follows the OS reduced-motion setting, ui-design R20) shows the end state,
// which is the card. Its sound effects play through the stage SE player on the performance's beats - the release, every
// table contact (quieter bounce by bounce), the skid to rest, a clack where the dice touch, the stamp / the
// cup with the dice rattling inside - timed off the motion's own keyframes (diceContacts / diceCues), so the
// player's SE volume and mute apply; a missing entry is simply silent.
//
// The dice, their keyframed motion and the contacts the sound follows are the mod's shared 3D dice (dice3d.js); this file
// is the d100 presentation over them. One renderer serves every throw while the stage is mounted and is disposed with it
// or after 20 s without a throw; the frame loop runs only while a throw plays.

// Timeline (ms). Open: the dice spin down by `land` and rest by `settle`; their values fly into the number for `combine`;
// the stamp falls for `stamp` and lands (a critical holds it `hitStop` before its burst), holds `hold`, then the throw
// collapses into the card for `fade` (≈2.2 s in all). Hidden: the cup falls from `cupDrop`, slams at `slam`, the throw
// ends at `hiddenEnd`.
const DICE_T = Object.freeze({ land: 880, settle: 1000, combine: 240, stamp: 120, hitStop: 100, hold: 540, fade: 260, cupDrop: 600, slam: 790, hiddenEnd: 1650 });
// The cup's fall: from `height` above the floor; after the slam it hops `hop` high and lands again `rebound` ms later.
const DICE_CUP = Object.freeze({ height: 4, hop: 0.16, rebound: 150 });
// The throw's area (CSS px, at most the text box's width) and camera zoom per device profile (stage plugin device profile): the
// band above the box, centred on it; phones get a shorter band, framed tighter so the dice stay legible.
const DICE_ZOOM = Object.freeze({ desktop: 1.3, "mobile-landscape": 1.1, "mobile-portrait": 1.15 });
const DICE_TRAY = Object.freeze({ desktop: [860, 330], "mobile-landscape": [560, 180], "mobile-portrait": [390, 240] });
const DICE_IDLE_MS = 20000;
// The dice sound effects: entries of the 通用SE pack.
const DICE_SE_PACK = "2f3f4666-0098-4a45-9d07-9ff0cc42d1b2";
// Beat → [entry, dB under its normal level]: each table contact (`hit`, quieter by its drop, diceContacts), the skid
// to rest (`roll`), the two dice touching (`clack`), the cup closing on the table (`slam`: a recorded dice cup set down
// on a wood table under a cup slammed on a steel table, so it reads on small speakers) and its rebound, the dice inside it
// (`rattle`, at full level: the two together sit clearly above the contacts); every tier's stamp reuses
// the old cup slam's wood thud, softer. `critical` / `fumble` are empty slots: the pack has no such entry (owner
// 2026-10-20: no tier sting for now), so they are silent like any missing entry; installing one gives that tier a sting
// on top of its stamp. The combine is silent: the pack's whoosh read as a sword draw.
const DICE_SE = Object.freeze({ throw: ["se-dice-throw", 0], hit: ["se-dice-hit", 0], roll: ["se-dice-roll", -9], clack: ["se-dice-clack", -5],
    slam: ["se-dice-cup-close", 0], rattle: ["se-dice-cup-rattle", 0], stamp: ["se-dice-cup-slam", -6], critical: ["se-dice-crit", 0], fumble: ["se-dice-fumble", 0] });
// A cue reached (a stalled frame) or whose media arrives later than this after its moment is dropped: a contact heard
// late is wrong, not late.
const DICE_SE_LATE = 250;

// The two dice faces that make a d100 value: [tens 0–9 (reads "00"–"90"), ones 0–9]; 00 + 0 is 100.
function diceFaces(value) {
    const v = Number(value);
    return v === 100 ? [0, 0] : [Math.floor(v / 10), v % 10];
}
function diceValue(tens, ones) { return tens === 0 && ones === 0 ? 100 : tens * 10 + ones; }
const diceLabel = (die, index) => die === 0 ? String(index * 10).padStart(2, "0") : String(index);

const diceThrowing = (function () {
    let held = new Set();
    const listeners = new Set();
    return {
        get: () => held,
        hold(ids) { held = new Set([...held, ...ids]); listeners.forEach(fn => fn()); },
        release(ids) { held = new Set([...held].filter(id => !ids.includes(id))); listeners.forEach(fn => fn()); },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
})();
function useDiceThrowing(callId) {
    return React.useSyncExternalStore(diceThrowing.subscribe, () => diceThrowing.get().has(callId), () => false);
}

// Chat selector: the snapshot's latest turn and its rolls; "" until the chat holds a node. The host's node store is not a
// Map (values() and get(), no size): emptiness is read from values(), as diceIndex reads it.
function diceLatestKey(snapshot) {
    const nodes = snapshot && snapshot.nodes;
    if (!nodes || nodes.values()[Symbol.iterator]().next().done) return "";
    const index = diceIndex(snapshot);
    const turn = Math.max(0, ...index.keys());
    return turn + "|" + (index.get(turn)?.rolls || "");
}
function diceKeyRolls(key) {
    const rolls = key.slice(key.indexOf("|") + 1);
    return rolls ? JSON.parse(rolls).map(row => Object.assign({ callId: row[0] }, JSON.parse(row[1]))) : [];
}

// The 骰盅, mouth down: one lathe-turned profile (inner wall, flared lip, a tapered body, a shoulder ring, a domed top) in
// red-black lacquered wood with a fine grain; brass bands at the lip, low on the body and round the shoulder, a brass knob;
// a paper talisman down its front with a cinnabar 「?」; a soft contact shadow that darkens and tightens as it lands. Lip
// radius about 1.55 (both dice rest well inside it).
function diceCup(THREE) {
    const V = (r, y) => new THREE.Vector2(r, y);
    const profile = [V(0, 2.12), V(1.22, 2.12), V(1.28, 0.2), V(1.32, 0.02), V(1.48, 0), V(1.55, 0.05), V(1.55, 0.13), V(1.45, 0.21), V(1.36, 0.32),
        V(1.24, 1.95), V(1.3, 2.02), V(1.33, 2.1), V(1.3, 2.18), V(1.18, 2.24), V(0.7, 2.3), V(0.22, 2.33), V(0, 2.33)];
    const lacquer = new THREE.MeshPhysicalMaterial({ roughness: 0.5, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.1, envMapIntensity: 0.2, side: THREE.DoubleSide });
    const brass = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.32 });
    const paper = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 64), lacquer);
    const band = (radius, y, tube) => { const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 72), brass); ring.rotation.x = Math.PI / 2; ring.position.y = y; return ring; };
    const knob = new THREE.Mesh(new THREE.LatheGeometry([V(0, 0), V(0.3, 0), V(0.3, 0.04), V(0.13, 0.09), V(0.11, 0.16), V(0.17, 0.24), V(0.16, 0.33), V(0.07, 0.4), V(0, 0.41)], 32), brass);
    knob.position.y = 2.31;
    // The talisman follows the body's taper 0.01 off it, facing the camera (+z), from just above the low band to the shoulder.
    const strip = new THREE.Mesh(new THREE.CylinderGeometry(1.257, 1.368, 1.5, 16, 1, true, -0.3, 0.6), paper);
    strip.position.y = 1.1;
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.004; shadow.renderOrder = -1;
    group.add(body, band(1.555, 0.09, 0.045), band(1.355, 0.4, 0.028), band(1.335, 2.06, 0.04), knob, strip);
    for (const mesh of group.children) mesh.castShadow = true;
    return { group, shadow, lacquer, brass, paper };
}
// The cup's painted textures: the lacquer grain and the talisman (aged paper, a cinnabar frame, a 封 seal stamp, the 「?」
// and brush strokes).
function diceCupPaint(THREE, cup, colors, size, anisotropy) {
    const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; };
    const texture = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy; return t; };
    const [grainCanvas, grain] = canvas(size * 2, size);
    grain.fillStyle = colors.lacquer; grain.fillRect(0, 0, size * 2, size);
    const rand = diceRandom("lacquer");
    grain.strokeStyle = colors.lacquerHi;
    for (let i = 0; i < 90; i++) {
        grain.globalAlpha = 0.05 + rand() * 0.12; grain.lineWidth = 0.6 + rand() * 2.4;
        const x = rand() * size * 2, sway = (rand() - 0.5) * size * 0.08;
        grain.beginPath(); grain.moveTo(x, 0); grain.bezierCurveTo(x + sway, size * 0.33, x - sway, size * 0.66, x + sway * 0.5, size); grain.stroke();
    }
    grain.globalAlpha = 1;
    const w = Math.round(size * 0.5), [paperCanvas, ctx] = canvas(w, Math.round(w * 1.9)), h = paperCanvas.height;
    ctx.fillStyle = colors.paper; ctx.fillRect(0, 0, w, h);
    const edge = ctx.createLinearGradient(0, 0, w, 0);
    edge.addColorStop(0, colors.paperEdge); edge.addColorStop(0.1, "transparent"); edge.addColorStop(0.9, "transparent"); edge.addColorStop(1, colors.paperEdge);
    ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = colors.cinnabar; ctx.lineWidth = w * 0.035; ctx.strokeRect(w * 0.07, w * 0.07, w * 0.86, h - w * 0.14);
    ctx.lineWidth = w * 0.012; ctx.strokeRect(w * 0.13, w * 0.13, w * 0.74, h - w * 0.26);
    ctx.fillStyle = colors.cinnabar; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillRect(w * 0.33, h * 0.1, w * 0.34, w * 0.34);
    ctx.font = "900 " + Math.round(w * 0.24) + "px " + colors.brush;
    ctx.fillStyle = colors.paper; ctx.fillText("封", w / 2, h * 0.1 + w * 0.175);
    ctx.fillStyle = colors.cinnabar; ctx.font = "900 " + Math.round(w * 0.82) + "px " + colors.brush;
    ctx.fillText("?", w / 2, h * 0.5);
    ctx.strokeStyle = colors.cinnabar; ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
        ctx.lineWidth = w * (0.05 - i * 0.012);
        ctx.beginPath(); ctx.moveTo(w * 0.5, h * (0.72 + i * 0.055)); ctx.quadraticCurveTo(w * (0.28 + i * 0.22), h * (0.75 + i * 0.055), w * 0.5, h * (0.78 + i * 0.055)); ctx.stroke();
    }
    const [shadowCanvas, shadowCtx] = canvas(128, 128);
    const blob = shadowCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    blob.addColorStop(0, colors.shadow); blob.addColorStop(0.55, colors.shadow); blob.addColorStop(1, "transparent");
    shadowCtx.fillStyle = blob; shadowCtx.fillRect(0, 0, 128, 128);
    const materials = [cup.lacquer, cup.paper, cup.shadow.material];
    materials.forEach((material, i) => { material.map?.dispose(); material.map = texture([grainCanvas, paperCanvas, shadowCanvas][i]); material.needsUpdate = true; });
    cup.brass.color.setRGB(...colors.brassRgb, THREE.SRGBColorSpace);
}

// The shared dice scene (dice3d.js) with this throw's two d10s (tens, ones) and the cup, reused until dispose().
// The cup in a shared dice scene (also a hidden rule check's, check-throw.js), hidden until a hidden roll shows it.
function diceAddCup(THREE, gl) {
    const cup = diceCup(THREE);
    // Its own envMap, so its lower envMapIntensity holds (scene.environmentIntensity would replace it): deep lacquer, not grey.
    cup.lacquer.envMap = gl.scene.environment;
    gl.scene.add(cup.group, cup.shadow);
    cup.group.visible = cup.shadow.visible = false;
    return cup;
}
// The cup at throw-time t: it drops from DICE_T.cupDrop, accelerating, tilted a little; slams at DICE_T.slam (squash, a
// small rebound hop, a rock that dies away) at z, with a puff of dust (the dust node) and a short shake of the band.
// Returns the band's shake (a CSS translate, or "") and whether the cup is down.
function diceCupPose(cup, t, dust, jolt, z = 0.55) {
    const T = DICE_T, group = cup.group, fall = diceClamp((t - T.cupDrop) / (T.slam - T.cupDrop)), k = t - T.slam;
    let y = DICE_CUP.height * (1 - Math.pow(fall, 2.4)), squash = 0, rock = 0.12 * (1 - fall), shake = "";
    if (k >= 0) {
        y = k < DICE_CUP.rebound ? DICE_CUP.hop * Math.sin(Math.PI * k / DICE_CUP.rebound) : 0;
        squash = k < 110 ? 0.08 * Math.sin(Math.PI * k / 110) : 0;
        rock = 0.035 * Math.exp(-k / 140) * Math.sin(k / 34);
        shake = jolt(k, 240, 6);
    }
    group.visible = t >= T.cupDrop;
    group.position.set(0, y, z);
    group.rotation.set(rock, 0, rock * 0.6);
    group.scale.set(1 + squash / 2, 1 - squash, 1 + squash / 2);
    const near = 1 - Math.min(1, y / DICE_CUP.height);
    cup.shadow.visible = group.visible;
    cup.shadow.position.z = z;
    cup.shadow.scale.setScalar(1.35 - 0.35 * near);
    cup.shadow.material.opacity = 0.62 * near * near;
    const d = diceClamp(k / 420);
    diceFade(dust, k >= 0 ? 1 - d : 0);
    dust.style.transform = "scale(" + (0.55 + 1.1 * diceOut(d)) + ")";
    return { shake, covered: k >= 0 };
}
// A short decaying jitter (px) for shakes, stepped every 30 ms.
const diceJolt = (k, span, size) => { const a = size * Math.max(0, 1 - k / span), n = Math.floor(k / 30); return a ? "translate(" + (Math.sin(n * 12.9898) * a).toFixed(1) + "px, " + (Math.sin(n * 78.233) * a * 0.6).toFixed(1) + "px)" : ""; };
function diceGl(THREE, RoomEnvironment) {
    const gl = diceScene(THREE, RoomEnvironment);
    const cup = diceAddCup(THREE, gl);
    gl.models = [diceModel(THREE, "d10t"), diceModel(THREE, "d10z")];
    let paintKey = "";
    return Object.assign(gl, { cup,
        // Paint the dice (theme paints) and the cup (skipped when unchanged).
        paint(colors, cell) {
            gl.dice = gl.place([{ kind: "d10t", look: { body: colors.a, ink: colors.aInk, font: colors.font } }, { kind: "d10z", look: { body: colors.b, ink: colors.bInk, font: colors.font } }], cell);
            const key = JSON.stringify([colors, cell]);
            if (key === paintKey) return;
            paintKey = key;
            diceCupPaint(THREE, cup, colors, cell * 2, Math.min(4, gl.renderer.capabilities.getMaxAnisotropy()));
        }
    });
}

// The stage paints, resolved to computed colours (the canvas and Three.js cannot read var()).
function diceColors(element) {
    const probe = document.createElement("i");
    probe.style.display = "none";
    element.appendChild(probe);
    const read = name => { probe.style.color = "var(" + name + ")"; return getComputedStyle(probe).color; };
    const colors = { a: read("--gal-dice-a"), aInk: read("--gal-dice-a-ink"), b: read("--gal-dice-b"), bInk: read("--gal-dice-b-ink"),
        lacquer: read("--gal-dice-lacquer"), lacquerHi: read("--gal-dice-lacquer-grain"), brass: read("--gal-dice-brass"),
        paper: read("--gal-dice-paper"), paperEdge: read("--gal-dice-paper-edge"), cinnabar: read("--gal-dice-cinnabar"), shadow: read("--gal-dice-shadow") };
    probe.style.fontFamily = "var(--gal-ui-title-font)";
    colors.font = getComputedStyle(probe).fontFamily;
    probe.style.fontFamily = "var(--gal-tc-mincho)";
    colors.brush = getComputedStyle(probe).fontFamily;
    probe.remove();
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const rgb = css => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3), v => v / 255); };
    colors.brassRgb = rgb(colors.brass);
    return colors;
}

// The dice sound effects through the stage SE player (stage-sfx.js: the SE bus, its volume and mute). Each run of
// throws resolves the pack's entries once; each throw leases the ones its cues (diceCues) need when it starts, holds
// each lease until the throw ends and its plays of it have rung out; a cue plays only while its throw is on screen, and a
// skip cuts it. The dice entries' lamp is off (asset-disabled: never recalled by
// the text) - this cue is their one trigger. An unavailable pack, a missing entry or one without media is silent.
function createDiceSounds() {
    let entries = null, service = null;
    function resolve() {
        service = packClient();
        if (!service) return Promise.resolve(new Map());
        if (!entries) entries = service.resolveAssets({ refs: [...new Set(Object.values(DICE_SE).map(([assetId]) => assetId))].map(assetId => ({ packId: DICE_SE_PACK, kind: "sfx", assetId })) })
            .then(rows => new Map(rows.filter(row => row.value?.media && row.value.pendingMedia !== true && row.diagnostics.every(code => code === "asset-disabled")).map(row => [row.ref.assetId, row])), () => new Map());
        return entries;
    }
    // cues ({ at, beat, db }) → { play(cue), stop(cut) } for one throw; now() is the throw's clock (ms since its start).
    function prepare(cues, token, now) {
        const leases = new Map(), waiting = [];
        let stopped = false;
        const asset = cue => DICE_SE[cue.beat][0];
        const release = entry => { if (!entry.released && !entry.plays) { entry.released = true; void service.releaseLease(entry.lease.ticket); } };
        void resolve().then(found => Promise.all([...new Set(cues.map(asset))].map(async id => {
            const row = found.get(id);
            if (!row) return;
            const lease = await service.leaseMedia({ packId: DICE_SE_PACK, hash: row.value.media }).catch(() => null);
            if (!lease) return;
            if (stopped) { void service.releaseLease(lease.ticket); return; }
            leases.set(id, { lease, row, plays: 0, released: false });
            // A cue whose lease was still on its way plays as it arrives, unless its moment has passed.
            for (const cue of waiting.filter(cue => asset(cue) === id)) { waiting.splice(waiting.indexOf(cue), 1); if (now() - cue.at <= DICE_SE_LATE) start(cue); }
        })));
        function start(cue) {
            const entry = leases.get(asset(cue));
            const value = entry.row.value, gainDb = value.gainDb ?? 0;
            const authored = { ref: entry.row.ref, identity: JSON.stringify([DICE_SE_PACK, value.media]), gainDb, ...(typeof value.volume === "number" ? { volume: value.volume } : {}), ...(value.loudness ? { loudness: value.loudness } : {}) };
            entry.plays++;
            void Promise.resolve(stageSfx.play(entry.lease.url, authored.identity, authored.ref, token, Math.min(1, 10 ** (gainDb / 20)) * 10 ** ((DICE_SE[cue.beat][1] + (cue.db || 0)) / 20), {...authored, trace: {reason: 'dice:' + cue.beat}}))
                .finally(() => { entry.plays--; if (stopped) release(entry); });
        }
        return {
            play(cue) { if (stopped) return; if (leases.has(asset(cue))) start(cue); else waiting.push(cue); },
            // cut: a skip silences what is still ringing; a throw that ended normally lets it ring out.
            stop(cut) {
                stopped = true;
                waiting.length = 0;
                if (cut) stageSfx.stopToken(token);
                for (const entry of leases.values()) release(entry);
            }
        };
    }
    return { prepare, reset() { entries = null; } };
}

// The stamp's tilt as it lands (°): 代价成功 more askew.
const DICE_TURN = tier => tier === "costly" ? -9 : -6;
const DICE_SCALE = 0.68;
// The throw's sound cues [{ at ms, beat (DICE_SE), db }], in time order: the release, every contact, the skid and
// any clack (diceContacts); then an open roll's stamp, the same for every tier, with a critical / fumble's tier cue
// at the same moment (an empty slot, DICE_SE) (the combine is silent), or a hidden roll's cup: its slam with the dice
// rattling inside, and its rebound landing (as much quieter as its hop is lower than its fall). Under the cup the dice's
// own later contacts are that rattle.
function diceCues(roll, contacts, times) {
    const cues = [{ at: 0, beat: "throw", db: 0 }, ...contacts.floor.map(c => ({ at: c.at, beat: "hit", db: c.db })), { at: contacts.skid, beat: "roll", db: 0 }, ...contacts.clacks.map(at => ({ at, beat: "clack", db: 0 }))];
    if (!roll.hidden) {
        cues.push({ at: times.landed, beat: "stamp", db: 0 });
        if (times.beat !== "stamp") cues.push({ at: times.landed, beat: times.beat, db: 0 });
    }
    else {
        const T = DICE_T, cup = DICE_CUP;
        cues.splice(0, cues.length, ...cues.filter(cue => cue.at < T.slam));
        cues.push({ at: T.slam, beat: "slam", db: 0 }, { at: T.slam, beat: "rattle", db: 0 }, { at: T.slam + cup.rebound, beat: "slam", db: 10 * Math.log10(cup.hop / cup.height) });
    }
    return cues.sort((a, b) => a.at - b.at);
}
// The open roll's layout on the band (the number sat on the dice): nothing crosses.
// Top to bottom: the stake line; a row with the tens die, the number, the ones die (each value flies inward into its
// half of the number); the seal row - the stamp in its seal box (the box the critical's burst spreads out to). The seal fits
// the room left under the row (the stamp's size and its fall scale shrink when the band is short). Sets the parts'
// places (CSS custom properties on the band) and returns the dice's rest points and boxes.
function diceLayout(gl, tray, parts, w, h, plan, scratch, turn) {
    const gap = Math.max(6, Math.round(h * 0.03)), side = Math.max(gap, Math.round(w * 0.025));
    tray.style.setProperty("--dice-seal-k", "1");
    const lineBottom = parts.line.offsetTop + parts.line.offsetHeight, rowTop = lineBottom + gap;
    const numW = parts.num.offsetWidth, numH = parts.num.offsetHeight;
    // Dice first at a guess, then moved (twice, the perspective changes their size) beside the number, centred on its row.
    let rest = [diceFloorAt(gl.THREE, gl.camera, w, h, w / 2 - numW / 2 - side - h * 0.18, rowTop + h * 0.18), diceFloorAt(gl.THREE, gl.camera, w, h, w / 2 + numW / 2 + side + h * 0.18, rowTop + h * 0.18)];
    let plans = [], boxes = [], rowH = numH;
    for (let pass = 0; pass < 3; pass++) {
        plans = rest.map((to, die) => plan(die, to));
        boxes = plans.map((p, die) => dieRestBox(gl.camera, gl.dice[die], p, DICE_SCALE, w, h, scratch));
        rowH = Math.max(numH, ...boxes.map(box => box[3]));
        if (pass === 2) break;
        const cy = rowTop + rowH / 2, cx = [w / 2 - numW / 2 - side - boxes[0][2] / 2, w / 2 + numW / 2 + side + boxes[1][2] / 2];
        rest = rest.map((point, die) => {
            const p = point.clone().project(gl.camera), sx = (p.x + 1) / 2 * w, sy = (1 - p.y) / 2 * h, box = boxes[die];
            return diceFloorAt(gl.THREE, gl.camera, w, h, sx + cx[die] - (box[0] + box[2] / 2), sy + cy - (box[1] + box[3] / 2));
        });
    }
    const rowBottom = rowTop + rowH;
    // The seal box: the stamp turned and at its settle overshoot (1.1), with room around it for the critical's burst.
    const a = Math.abs(turn) * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
    const seal = k => { const sw = parts.stamp.offsetWidth * k, sh = parts.stamp.offsetHeight * k;
        return [(sw * cos + sh * sin) * 1.1 + sh * 0.5, (sw * sin + sh * cos) * 1.1 * 1.1, sw, sh]; };
    const room = h - rowBottom - gap - 2;
    let [rw, rh] = seal(1);
    const k = Math.min(1, room / rh, (w - 4) / rw);
    if (k < 1) { tray.style.setProperty("--dice-seal-k", k.toFixed(3)); [rw, rh] = seal(1); }
    const sealY = rowBottom + gap + rh / 2;
    // The fall starts as large as the seal's room allows (at most 1.6x), tilted 6° more.
    const fa = a + 6 * Math.PI / 180, sw = parts.stamp.offsetWidth, sh = parts.stamp.offsetHeight;
    const fall = Math.max(1, Math.min(1.6, (w - 4) / (sw * Math.cos(fa) + sh * Math.sin(fa)), 2 * Math.min(sealY - rowBottom - gap, h - sealY) / (sw * Math.sin(fa) + sh * Math.cos(fa))));
    for (const [name, value] of [["--dice-num-y", rowTop + (rowH - numH) / 2], ["--dice-seal-y", sealY], ["--dice-seal-w", rw], ["--dice-seal-h", rh], ["--dice-fade", rowTop]])
        tray.style.setProperty(name, value.toFixed(1) + "px");
    tray.dataset.diceBoxes = JSON.stringify(boxes.map(box => box.map(Math.round)));
    return { plans, fall };
}
// The imperative player behind DiceThrow: a queue of rolls, one throw area, one renderer.
// safety: the stage's one policy (stage-effects.cjs stageSafety) - the critical burst and the fumble's crack flash
// are flashes: under 光敏保护 they count in the stage-wide three-a-second gate and draw at half strength (none when refused).
// paused: the stage's first-entry veil still covers the scene (gal-entry.js) - arrivals are held (their cards wait hidden)
// and queued, and the queue starts on resume() once the scene shows: a live arrival is deferred, never lost or played unseen.
function createDiceThrower(tray, rootRef, device, safety = () => null, paused = () => false) {
    const parts = Object.fromEntries([...tray.querySelectorAll("[data-part]")].map(node => [node.dataset.part, node]));
    const scratch = {}, sounds = createDiceSounds();
    let gl = null, queue = [], current = null, frame = 0, idle = 0, loading = false, alive = true, listening = false;
    function onClick(event) { event.stopPropagation(); event.preventDefault(); skip(); }
    function onKey(event) { if (event.key !== "Escape") return; event.stopPropagation(); event.preventDefault(); skip(); }
    function listen(on) {
        const method = on ? "addEventListener" : "removeEventListener";
        window[method]("click", onClick, true);
        window[method]("keydown", onKey, true);
    }
    function enqueue(rolls) {
        diceThrowing.hold(rolls.map(roll => roll.callId));
        queue.push(...rolls);
        if (!current && !loading) void next();
    }
    function resume() { if (!current && !loading) void next(); }
    async function next() {
        if (!queue.length || paused()) return;
        if (!gl) {
            loading = true;
            try {
                const [THREE, room] = await diceLoadThree();
                if (!alive) return;
                gl = diceGl(THREE, room.RoomEnvironment);
                scratch.q = new THREE.Quaternion(); scratch.v = new THREE.Vector3();
            } catch (error) {
                console.error("[fork-dice-throw]", error);
                skip();
                return;
            } finally { loading = false; }
            if (!queue.length || paused()) return;
        }
        start(queue.shift());
    }
    function start(roll) {
        clearTimeout(idle);
        const { THREE } = gl, root = rootRef.current;
        // The band just above the text box, centred on it (the box itself is never touched).
        const box = root.querySelector(".fork-gal-box");
        const sr = root.getBoundingClientRect(), br = box.getBoundingClientRect();
        const [tw, th] = DICE_TRAY[device()] || DICE_TRAY.desktop;
        const w = Math.round(Math.min(tw, br.width)), h = Math.round(Math.max(110, Math.min(th, br.top - sr.top - 48)));
        tray.hidden = false;
        Object.assign(tray.style, { width: w + "px", height: h + "px", left: Math.round(br.left - sr.left + (br.width - w) / 2) + "px", bottom: Math.round(sr.bottom - br.top + 4) + "px", transform: "" });
        diceFade(tray, 1);
        tray.dataset.tier = roll.hidden ? "" : roll.tier;
        tray.dataset.call = roll.callId;
        tray.toggleAttribute("data-hidden", roll.hidden === true);
        tray.removeAttribute("data-faces"); tray.removeAttribute("data-value");
        for (const node of Object.values(parts)) if (node !== parts.canvas && node !== parts.word) { diceFade(node, 0); node.style.transform = ""; }
        parts.canvas.style.filter = parts.num.style.filter = "";
        diceFade(parts.canvas, 1);
        for (const name of ["num", "tens", "ones", "word", "line"]) parts[name].textContent = "";
        parts.canvas.appendChild(gl.canvas);
        const colors = diceColors(tray);
        const zoom = DICE_ZOOM[device()] || 1;
        gl.paint(colors, device() === "desktop" ? 256 : 128);
        gl.renderer.setPixelRatio(galResolution("high"));
        gl.renderer.setSize(w, h, false);
        gl.camera.aspect = w / h;
        gl.camera.zoom = zoom;
        gl.camera.updateProjectionMatrix();
        // Open rolls are seen from high (the faces read); a hidden roll lower, so the cup stands and its talisman faces you.
        const [eye, aim] = roll.hidden ? [[0, 4.6, 7.4], [0, 0.9, 0.5]] : [[0, 6.7, 5.1], [0, 0, 0.4]];
        gl.camera.position.set(...eye); gl.camera.lookAt(...aim); gl.camera.updateMatrixWorld();
        const rand = diceRandom(roll.callId);
        const faces = roll.hidden ? [Math.floor(rand() * 10), Math.floor(rand() * 10)] : diceFaces(roll.roll);
        const jitter = () => (rand() - 0.5) * 0.3;
        // Thrown in from the left of the band (its half-width at the floor's centre, by the camera's framing).
        const half = Math.tan(16 * Math.PI / 180) * gl.camera.position.distanceTo(new THREE.Vector3(...aim)) * (w / h) / zoom, from = -Math.min(5.5, Math.max(2.4, half * 0.72));
        // Hidden: one behind the other, both well inside the cup's lip (centred at z 0.55). Open: beside the number
        // (diceLayout).
        const rest = [new THREE.Vector3(-0.32, 0, 0.12), new THREE.Vector3(0.32, 0, 0.98)];
        const starts = [0, 1].map(die => new THREE.Vector3(from - die * 0.35 + jitter(), 0, 0.6 + die * 0.9)), throwFrom = die => starts[die];
        gl.cup.group.visible = gl.cup.shadow.visible = roll.hidden === true;
        // Compile the shaders before the clock starts, so the first frame of the first throw does not hitch.
        if (!gl.compiled) { gl.cup.group.visible = gl.cup.shadow.visible = true; gl.renderer.compile(gl.scene, gl.camera); gl.cup.group.visible = gl.cup.shadow.visible = roll.hidden === true; gl.compiled = true; }
        const project = v => { const p = v.clone().project(gl.camera); return [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h]; };
        const T = DICE_T, combine = T.settle, stamp = combine + T.combine, landed = stamp + T.stamp;
        const end = roll.hidden ? T.hiddenEnd : landed + T.hold;
        const beat = roll.tier === "critical" || roll.tier === "fumble" ? roll.tier : "stamp";
        current = { roll, plans: null, faces, w, h, combine, stamp, landed, end, beat, t0: null, project, released: false, phase: "", cues: [] };
        // The stake, read from the start: which check it is (a hidden roll says only that it is one).
        parts.line.textContent = roll.hidden ? "暗骰" : diceCheckName(roll);
        if (!roll.hidden) {
            parts.num.textContent = String(roll.roll);
            parts.word.textContent = diceTierWord(roll);
        }
        if (roll.hidden) {
            current.plans = [0, 1].map(die => diePlan(gl.THREE, gl.models[die], faces[die], throwFrom(die), rest[die], rand, die * 60));
            // The dust ring at the cup's lip on the floor, sized from the projected lip.
            const [dx, dy] = project(new THREE.Vector3(0, 0, 0.55)), lip = project(new THREE.Vector3(1.53, 0, 0.55))[0] - dx;
            Object.assign(parts.dust.style, { left: dx + "px", top: dy + "px", width: Math.round(lip * 3.4) + "px" });
        } else {
            const laid = diceLayout(gl, tray, parts, w, h, (die, to) => diePlan(gl.THREE, gl.models[die], faces[die], throwFrom(die), to, diceRandom(roll.callId + ":" + die), die * 60), scratch, DICE_TURN(roll.tier));
            current.plans = laid.plans;
            current.fall = laid.fall;
            parts.tens.textContent = diceLabel(0, faces[0]);
            parts.ones.textContent = diceLabel(1, faces[1]);
        }
        // The sound follows the motion's own contacts; the cue list is on the band for the tests and the review render.
        current.cues = diceCues(roll, diceContacts(gl.dice, current.plans, DICE_SCALE, scratch), { landed, beat });
        tray.dataset.cues = JSON.stringify(current.cues.map(cue => [Math.round(cue.at), cue.beat, Math.round(cue.db * 10) / 10]));
        const c = current;
        current.sound = sounds.prepare(current.cues, "dice:" + roll.callId, () => forkForeground.now() - c.t0);
        if (!listening) { listening = true; listen(true); }
        stopFrame();
        frame = forkForeground.requestAnimationFrame(tick);
    }
    function stopFrame() { if (frame) forkForeground.cancelAnimationFrame(frame); frame = 0; }
    function phase(name) { if (current.phase !== name) { current.phase = name; tray.dataset.phase = name; } }

    const jolt = diceJolt;
    function tick() {
        frame = 0;
        if (!current) return;
        const c = current, t = c.t0 === null ? 0 : forkForeground.now() - c.t0, T = DICE_T, s = parts;
        gl.dice.forEach((mesh, die) => diePose(mesh, c.plans[die], t, DICE_SCALE, scratch));
        // Each cue in the frame that reaches it; one a stalled frame skipped by more than DICE_SE_LATE is dropped.
        while (c.cues.length && c.cues[0].at <= t) { const cue = c.cues.shift(); if (t - cue.at <= DICE_SE_LATE) c.sound.play(cue); }
        diceFade(s.line, diceClamp(t / 180));
        if (t >= T.settle + 60 && !c.roll.hidden && !tray.hasAttribute("data-faces")) {
            const up = gl.dice.map(mesh => dieUp(mesh, scratch));
            tray.dataset.faces = diceLabel(0, up[0]) + " " + diceLabel(1, up[1]);
            tray.dataset.value = String(diceValue(up[0], up[1]));
        }
        let shake = "";
        if (c.roll.hidden) {
            const pose = diceCupPose(gl.cup, t, s.dust, jolt);
            shake = pose.shake;
            if (pose.covered) tray.dataset.cup = "covered";
            phase(t < T.slam ? "throw" : t < c.end ? "seal" : "fade");
        } else {
            // The values fly into the number (silently) while the dice step back.
            const p = diceClamp((t - c.combine) / T.combine);
            diceFade(s.canvas, 1 - 0.7 * diceOut(p));
            if (t >= c.combine && !c.from) {
                c.from = gl.dice.map(mesh => c.project(mesh.position.clone().setY(mesh.position.y + 0.9)));
                // Each value lands on its own half of the number (tens left, ones right).
                const y = s.num.offsetTop + s.num.offsetHeight / 2, left = s.num.offsetLeft, width = s.num.offsetWidth;
                c.to = [[left + width * 0.3, y], [left + width * 0.75, y]];
            }
            if (c.from) [s.tens, s.ones].forEach((node, die) => {
                const e = diceOut(p), x = c.from[die][0] + (c.to[die][0] - c.from[die][0]) * e, y = c.from[die][1] + (c.to[die][1] - c.from[die][1]) * e;
                diceFade(node, Math.min(1, p / 0.15) * (1 - diceClamp((p - 0.7) / 0.3)));
                node.style.transform = "translate(" + x.toFixed(1) + "px, " + y.toFixed(1) + "px)";
            });
            const q = diceClamp((t - c.combine - T.combine * 0.55) / (T.combine * 0.45));
            diceFade(s.num, q);
            s.num.style.transform = "scale(" + (0.6 + 0.4 * (1 + 2.2 * Math.pow(q - 1, 3) + 1.2 * Math.pow(q - 1, 2))) + ")";
            // The stamp: falls from large and tilted, lands at c.landed with a squash and the tier's beat.
            const k = t - c.landed, crit = c.roll.tier === "critical";
            if ((crit || c.roll.tier === "fumble") && k >= 0 && c.flash === undefined) { const policy = safety(); c.flash = !policy?.photosensitive ? 1 : stageFlashGate.admit(policy) ? 0.5 : 0; }
            const held = crit && k >= 0 && k < T.hitStop; // the critical's hit-stop: the stamp holds its impact
            const f = diceClamp((t - c.stamp) / T.stamp), fall = f * f;
            const settle = k < 0 ? 1 : held ? 0.9 : 1 - 0.1 * Math.exp(-(k - (crit ? T.hitStop : 0)) / 60) * Math.cos((k - (crit ? T.hitStop : 0)) / 26);
            // It falls from as large as its row allows (diceLayout).
            const scale = k < 0 ? c.fall - (c.fall - 1) * fall : settle;
            const turn = DICE_TURN(c.roll.tier);
            diceFade(s.stamp, t < c.stamp ? 0 : Math.min(1, f * 1.6));
            s.stamp.style.transform = "rotate(" + (k < 0 ? turn - 6 * (1 - fall) : turn).toFixed(1) + "deg) scale(" + scale.toFixed(3) + ")";
            if (crit) {
                // After the hit-stop: the gold burst and the light rays behind the stamp, the dice glowing gold.
                const g = diceClamp((k - T.hitStop) / 520);
                diceFade(s.burst, k < T.hitStop ? 0 : (1 - g) * c.flash);
                s.burst.style.transform = "scale(" + (0.35 + 0.65 * diceOut(g)) + ")";
                diceFade(s.rays, k < T.hitStop ? 0 : Math.min(1, (k - T.hitStop) / 90) * (1 - diceClamp((k - 500) / 300)) * c.flash);
                s.rays.style.transform = "rotate(" + (Math.max(0, k) * 0.03).toFixed(2) + "deg) scale(" + (0.6 + 0.5 * diceOut(g)) + ")";
                s.canvas.style.filter = k >= T.hitStop ? "drop-shadow(0 0 " + (16 * (1 - 0.6 * g)).toFixed(1) + "px var(--gal-dice-gold))" : "";
            }
            if (c.roll.tier === "fumble" && k >= 0) {
                // The fumble: the colour drains out of the dice and the number, a crack flash, a heavy shake.
                const d = diceClamp(k / 160);
                s.canvas.style.filter = "grayscale(" + d.toFixed(2) + ") brightness(" + (1 - 0.3 * d).toFixed(2) + ")";
                s.num.style.filter = "grayscale(" + d.toFixed(2) + ")";
                diceFade(s.cracks, (k < 60 ? 1 : 1 - diceClamp((k - 60) / 260)) * c.flash);
                shake = jolt(k, 320, 9);
            }
            phase(t < c.combine ? "throw" : t < c.stamp ? "combine" : t < c.end ? "stamp" : "fade");
        }
        if (t < c.end) tray.style.transform = shake;
        else {
            // The end: the throw shrinks into its card on the text box (or just fades when the card is not on screen),
            // while the card fades in.
            if (!c.released) {
                c.released = true;
                tray.style.transform = "";
                const card = root().querySelector('.fork-gal-box .fork-roll[data-call="' + CSS.escape(c.roll.callId) + '"]');
                const a = tray.getBoundingClientRect(), b = card?.getBoundingClientRect();
                c.into = b ? [b.left + b.width / 2 - (a.left + a.width / 2), b.top + b.height / 2 - (a.top + a.height / 2)] : [0, 0];
                diceThrowing.release([c.roll.callId]);
            }
            const k = diceOut(diceClamp((t - c.end) / T.fade));
            tray.style.transform = "translate(" + (c.into[0] * k).toFixed(1) + "px, " + (c.into[1] * k).toFixed(1) + "px) scale(" + (1 - 0.86 * k).toFixed(3) + ")";
            diceFade(tray, 1 - Math.pow(k, 1.6));
        }
        gl.renderer.render(gl.scene, gl.camera);
        // The clock starts on the second frame: the first render (shaders, the environment map, textures) can hold up the next
        // frame by most of a second on a busy or software GPU, and the throw is then shown whole rather than joined midway.
        if (c.t0 === null && c.drawn) c.t0 = forkForeground.now();
        c.drawn = true;
        if (t >= c.end + T.fade) { finish(); return; }
        frame = forkForeground.requestAnimationFrame(tick);
    }
    const root = () => rootRef.current;
    function hide() {
        tray.hidden = true;
        tray.removeAttribute("data-phase"); tray.removeAttribute("data-cup");
        current = null;
    }
    function rest() {
        if (listening) { listening = false; listen(false); }
        stopFrame();
        clearTimeout(idle);
        // Pack edits (a newly installed sound) are picked up by the next run of throws.
        sounds.reset();
        if (gl) idle = setTimeout(() => { gl?.dispose(); gl = null; }, DICE_IDLE_MS);
    }
    function finish() {
        current.sound.stop(false);
        diceThrowing.release([current.roll.callId]);
        hide();
        if (queue.length) { start(queue.shift()); return; }
        rest();
    }
    // The end state at once: every queued and playing throw becomes its card, its sound is cut.
    function skip() {
        const ids = [...queue.map(roll => roll.callId), ...(current ? [current.roll.callId] : [])];
        queue = [];
        if (ids.length) diceThrowing.release(ids);
        if (!current) return;
        current.sound.stop(true);
        hide();
        rest();
    }
    function dispose() {
        alive = false;
        skip();
        clearTimeout(idle);
        gl?.dispose();
        gl = null;
    }
    return { enqueue, resume, skip, dispose };
}

// Stage props: { sessionId, useChat, running (a reply is being written), following (the reader is not in history: a live
// arrival shows its strip), live (the reader follows the latest turn or
// replays a round and nothing covers the stage: not history, film, an overlay or the box hidden), calm (减少动态),
// replay (a key per clip-export replay of the round shown, else null), nativeTurn (that round), device, rootRef, safety (the stage policy),
// veiled (the first-entry veil covers the scene: a live arrival waits for the reveal), place (where the reader stands in the
// round: a live roll called for partway through the reply waits for that place in the text, place.js) }.
function DiceThrow(props) {
    const h = React.createElement;
    const tray = React.useRef(null), thrower = React.useRef(null), seen = React.useRef(null), latest = React.useRef(props);
    latest.current = props;
    const key = props.useChat(diceLatestKey);
    React.useEffect(() => {
        const player = createDiceThrower(tray.current, props.rootRef, () => latest.current.device, () => latest.current.safety, () => latest.current.veiled === true);
        thrower.current = player;
        return () => { player.dispose(); thrower.current = null; diceStrip.reset(); };
    }, []);
    const placeKey = dicePlaceKey(props.place);
    React.useEffect(() => {
        if (!seen.current || seen.current.session !== props.sessionId) { seen.current = { session: props.sessionId, ids: null, queue: dicePlaceQueue() }; diceStrip.reset(); }
        if (!key) return;
        const rolls = diceKeyRolls(key), s = seen.current, ids = s.ids;
        // The first snapshot this stage sees is history: its rolls never play or show.
        if (!ids) { s.ids = new Set(rolls.map(roll => roll.callId)); return; }
        const fresh = rolls.filter(roll => !ids.has(roll.callId));
        fresh.forEach(roll => ids.add(roll.callId));
        const now = latest.current;
        // A live arrival waits for its place in the text (place.js): where the reply goes on after its call.
        if (fresh.length && now.running) s.queue.add(fresh, Number(key.slice(0, key.indexOf("|"))));
        const due = s.queue.take(now.place);
        if (!due.length) return;
        // A live arrival the reader follows shows its strip (dice-roll.js) even when it is not thrown (skip, 减少动态, an
        // overlay); one that lands while the reader is in history is only its 履历 line.
        if (now.following) diceStrip.arrive(due.map(roll => roll.callId));
        if (now.live && !now.calm) thrower.current.enqueue(due);
    }, [key, props.sessionId, placeKey]);
    // The settled history page's or a clip export's replay: the round's rolls whose place is the page shown are thrown (and
    // shown) again, once per replay (diceReplayHere: a roll called for partway through on its place's page, the others on the first page).
    const replayRolls = useDiceRolls(props.useChat, props.replay ? props.nativeTurn : 0), replayed = React.useRef({ key: null, ids: new Set() });
    React.useEffect(() => {
        if (!props.replay || !replayRolls.length) return;
        if (replayed.current.key !== props.replay) replayed.current = { key: props.replay, ids: new Set() };
        const done = replayed.current.ids, due = diceReplayHere(replayRolls, latest.current.place, props.nativeTurn).filter(roll => !done.has(roll.callId));
        if (!due.length) return;
        due.forEach(roll => done.add(roll.callId));
        diceStrip.arrive(due.map(roll => roll.callId));
        if (latest.current.live && !latest.current.calm) thrower.current.enqueue(due);
    }, [props.replay, replayRolls, placeKey]);
    React.useEffect(() => { if (!props.live || props.calm) thrower.current?.skip(); }, [props.live, props.calm]);
    React.useEffect(() => { if (!props.veiled) thrower.current?.resume(); }, [props.veiled]);
    const svg = (className, paths) => h("svg", { className, viewBox: "0 0 100 100", preserveAspectRatio: "none" }, paths.map(d => h("path", { key: d, d })));
    return h("div", { ref: tray, className: "fork-dice-throw", "aria-hidden": true, hidden: true },
        // Behind the stamp: the critical's gold burst and light rays; behind the scene: the cup's dust.
        h("div", { className: "fork-dice-throw-burst", "data-part": "burst" }),
        h("div", { className: "fork-dice-throw-rays", "data-part": "rays" }),
        h("div", { className: "fork-dice-throw-dust", "data-part": "dust" }),
        h("div", { className: "fork-dice-throw-gl", "data-part": "canvas" }),
        // The fumble's crack flash, out from the stamp.
        h("div", { className: "fork-dice-throw-cracks", "data-part": "cracks" }, svg("fork-dice-throw-crack", DICE_CRACKS)),
        h("div", { className: "fork-dice-throw-line", "data-part": "line" }),
        h("span", { className: "fork-dice-throw-part", "data-part": "tens" }),
        h("span", { className: "fork-dice-throw-part", "data-part": "ones" }),
        h("div", { className: "fork-dice-throw-num", "data-part": "num" }),
        // The result seal; 代价成功 and 大失败 land cracked through.
        h("div", { className: "fork-dice-throw-stamp", "data-part": "stamp" },
            h("span", { className: "fork-dice-throw-word", "data-part": "word" }),
            svg("fork-dice-throw-crack", ["M57 -2 L53 18 L60 34 L52 52 L58 70 L50 86 L55 102"])));
}
// Jagged cracks from the stamp's centre (50% / 64% of the band) out across it.
const DICE_CRACKS = ["M50 64 L44 58 L46 49 L38 40 L40 30 L31 18", "M50 64 L58 57 L57 47 L66 41 L69 28 L78 20", "M50 64 L41 69 L30 66 L22 73 L10 70",
    "M50 64 L60 71 L71 68 L80 76 L92 74", "M50 64 L52 76 L47 86 L51 98"];
