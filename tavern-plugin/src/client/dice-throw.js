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
// The motion is keyframed, not simulated: each die's spin decays onto the exact final orientation (result face up, its
// number upright toward the camera) while a hop curve carries it to its rest point, lifted every frame so its lowest
// vertex rests on the floor (it rolls over edges and corners on its own). No physics dependency. Three.js is the vendored
// runtime asset the card stage already serves, imported on the first throw. One renderer serves every throw while the
// stage is mounted and is disposed with it or after 20 s without a throw; the frame loop runs only while a throw plays.

const DICE_THREE = "/api/dsh-tavern/vendor/runtime-assets/three/";
// Timeline (ms). Open: the dice spin down by `land` and rest by `settle`; their values fly into the number for `combine`;
// the stamp falls for `stamp` and lands (a critical holds it `hitStop` before its burst), holds `hold`, then the throw
// collapses into the card for `fade` (≈2.2 s in all). Hidden: the cup falls from `cupDrop`, slams at `slam`, the throw
// ends at `hiddenEnd`.
const DICE_T = Object.freeze({ land: 880, settle: 1000, combine: 240, stamp: 120, hitStop: 100, hold: 540, fade: 260, cupDrop: 600, slam: 790, hiddenEnd: 1650 });
// The cup's fall: from `height` above the floor; after the slam it hops `hop` high and lands again `rebound` ms later.
const DICE_CUP = Object.freeze({ height: 4, hop: 0.16, rebound: 150 });
// The throw's area (CSS px, at most the text box's width) and camera zoom per device profile (gal-device.js): the
// band above the box, centred on it; phones get a shorter band, framed tighter so the dice stay legible.
const DICE_ZOOM = Object.freeze({ desktop: 1.3, "mobile-landscape": 1.1, "mobile-portrait": 1.15 });
const DICE_TRAY = Object.freeze({ desktop: [860, 330], "mobile-landscape": [560, 180], "mobile-portrait": [390, 240] });
const DICE_IDLE_MS = 20000;
// Upper kites (around the top apex) read these; each lower kite reads 9 minus its opposite, as on a real d10.
const D10_UPPER = [0, 4, 8, 2, 6];
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

function diceRandom(seed) {
    let a = 0x9e3779b9;
    for (const ch of String(seed)) a = Math.imul(a ^ ch.charCodeAt(0), 2654435761) >>> 0;
    return function () {
        a = a + 0x6d2b79f5 >>> 0;
        let t = Math.imul(a ^ a >>> 15, a | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
const diceClamp = value => value < 0 ? 0 : value > 1 ? 1 : value;
const diceOut = value => 1 - Math.pow(1 - value, 3);
// The throw's overlay parts (stake line, number, stamp, burst, rays, cracks, dust) and its fade: transient
// performance layers over the scene, never a control surface.
function diceFade(node, value) { node.style.opacity = String(value); }

// [three, its RoomEnvironment addon], imported once (the throw's first frame waits for them; a failure retries next time).
let diceThreeModule = null;
function diceLoadThree() {
    const url = path => import(new URL(DICE_THREE + path, document.baseURI).href);
    if (!diceThreeModule) diceThreeModule = Promise.all([url("build/three.module.js"), url("addons/environments/RoomEnvironment.js")]).catch(error => { diceThreeModule = null; throw error; });
    return diceThreeModule;
}

// The pentagonal trapezohedron: 10 congruent planar kites. Each face: outward normal, the in-plane direction toward its
// apex (the number's up), its label, and its outline in its texture cell (cells: 4 columns x 3 rows, by label).
function d10Model(THREE) {
    const H = 1, r = 0.9, c36 = Math.cos(Math.PI / 5), u = H * (1 - c36) / (1 + c36); // u keeps every kite planar
    const ring = (deg, y) => new THREE.Vector3(r * Math.cos(deg * Math.PI / 180), y, r * Math.sin(deg * Math.PI / 180));
    const T = new THREE.Vector3(0, H, 0), B = new THREE.Vector3(0, -H, 0);
    const U = [0, 1, 2, 3, 4].map(k => ring(72 * k, u)), L = [0, 1, 2, 3, 4].map(k => ring(72 * k + 36, -u));
    const kites = [];
    for (let k = 0; k < 5; k++) kites.push({ apex: T, a: U[k], low: L[k], b: U[(k + 1) % 5] });
    for (let k = 0; k < 5; k++) kites.push({ apex: B, a: L[k], low: U[(k + 1) % 5], b: L[(k + 1) % 5] });
    const faces = kites.map(kite => {
        const mid = kite.a.clone().add(kite.b).multiplyScalar(0.5);
        const n = new THREE.Vector3().subVectors(kite.a, kite.apex).cross(new THREE.Vector3().subVectors(kite.low, kite.apex)).normalize();
        if (n.dot(mid) < 0) n.negate();
        const up = kite.apex.clone().sub(mid).normalize(), right = up.clone().cross(n);
        return { kite, mid, n, up, right };
    });
    faces.forEach((face, i) => {
        face.label = i < 5 ? D10_UPPER[i] : 9 - faces.slice(0, 5).reduce((best, other) => other.n.dot(face.n) < best.n.dot(face.n) ? other : best).label;
    });
    const at = (face, v) => [v.clone().sub(face.mid).dot(face.right), v.clone().sub(face.mid).dot(face.up)];
    const top = at(faces[0], faces[0].kite.apex)[1], bottom = at(faces[0], faces[0].kite.low)[1], half = at(faces[0], faces[0].kite.b)[0];
    const size = Math.max(2 * Math.abs(half), top - bottom) * 1.06, middle = (top + bottom) / 2;
    const cell = ([x, y]) => [0.5 + x / size, 0.5 - (y - middle) / size]; // fractions of a cell, y down
    const positions = [], normals = [], uvs = [];
    for (const face of faces) {
        const col = face.label % 4, row = Math.floor(face.label / 4), k = face.kite;
        let tris = [[k.apex, k.a, k.low], [k.apex, k.low, k.b]];
        if (new THREE.Vector3().subVectors(k.a, k.apex).cross(new THREE.Vector3().subVectors(k.low, k.apex)).dot(face.n) < 0) tris = [[k.apex, k.low, k.a], [k.apex, k.b, k.low]];
        for (const v of tris.flat()) {
            const [fx, fy] = cell(at(face, v));
            positions.push(v.x, v.y, v.z); normals.push(face.n.x, face.n.y, face.n.z); uvs.push((col + fx) / 4, 1 - (row + fy) / 3);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    const k0 = faces[0].kite;
    return { geometry, faces, vertices: [T, B, ...U, ...L],
        outline: [k0.apex, k0.a, k0.low, k0.b].map(v => cell(at(faces[0], v))), labelAt: cell([0, top * 0.26])[1] };
}

// One die's texture: ten cells in its body paint, each with its kite outline and number in its ink paint.
function dicePaint(THREE, model, die, colors, cell, anisotropy) {
    const canvas = document.createElement("canvas");
    canvas.width = cell * 4; canvas.height = cell * 3;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = die === 0 ? colors.a : colors.b;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const ink = die === 0 ? colors.aInk : colors.bInk;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "700 " + Math.round(cell * (die === 0 ? 0.3 : 0.36)) + "px " + colors.font;
    for (let label = 0; label < 10; label++) {
        const x0 = (label % 4) * cell, y0 = Math.floor(label / 4) * cell;
        ctx.globalAlpha = 0.3; ctx.strokeStyle = ink; ctx.lineWidth = cell * 0.03; ctx.lineJoin = "round";
        ctx.beginPath();
        model.outline.forEach(([fx, fy], i) => ctx[i ? "lineTo" : "moveTo"](x0 + fx * cell, y0 + fy * cell));
        ctx.closePath(); ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = ink;
        const text = diceLabel(die, label), cx = x0 + cell / 2, cy = y0 + model.labelAt * cell;
        ctx.fillText(text, cx, cy);
        // 6 and 9 read the same upside down; a bar under them tells which way is up.
        if (die === 1 && (label === 6 || label === 9)) ctx.fillRect(cx - cell * 0.08, cy + cell * 0.17, cell * 0.16, cell * 0.035);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    return texture;
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

// The renderer and the scene, built on the first throw and reused until dispose().
function diceGl(THREE, RoomEnvironment) {
    const canvas = document.createElement("canvas");
    canvas.className = "fork-dice-throw-canvas";
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const scene = new THREE.Scene();
    // A soft studio room for image-based light: the lacquer's clearcoat and the brass need something to reflect.
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentIntensity = 0.55;
    room.traverse(node => { node.geometry?.dispose(); node.material?.dispose(); });
    pmrem.dispose();
    const camera = new THREE.PerspectiveCamera(32, 1.5, 0.1, 50);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3048, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2.5, 8, 3.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 20 });
    sun.shadow.radius = 4;
    scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 12), new THREE.ShadowMaterial({ opacity: 0.34 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const model = d10Model(THREE);
    const dice = [0, 1].map(() => {
        const mesh = new THREE.Mesh(model.geometry, new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.06 }));
        mesh.castShadow = true;
        scene.add(mesh);
        return mesh;
    });
    const cup = diceCup(THREE);
    // Its own envMap, so its lower envMapIntensity holds (scene.environmentIntensity would replace it): deep lacquer, not grey.
    cup.lacquer.envMap = scene.environment;
    scene.add(cup.group, cup.shadow);
    let paintKey = "";
    return {
        THREE, renderer, canvas, scene, camera, model, dice, cup,
        // Repaint the dice (theme paints) and the cup (skipped when unchanged).
        paint(colors, cell) {
            const key = JSON.stringify([colors, cell]);
            if (key === paintKey) return;
            paintKey = key;
            const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
            dice.forEach((mesh, die) => {
                mesh.material.map?.dispose();
                mesh.material.map = dicePaint(THREE, model, die, colors, cell, anisotropy);
                mesh.material.needsUpdate = true;
            });
            diceCupPaint(THREE, cup, colors, cell * 2, anisotropy);
        },
        dispose() {
            scene.traverse(node => { node.geometry?.dispose(); node.material?.map?.dispose(); node.material?.dispose(); });
            scene.environment.dispose();
            renderer.dispose();
            renderer.forceContextLoss();
            canvas.remove();
        }
    };
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

// A die's keyframed path to its rest pose: `face` up, its number toward the camera (screen-up), a little yaw.
function diePlan(gl, face, from, to, rand, delay) {
    const { THREE, model } = gl;
    const f = model.faces.find(row => row.label === face);
    const tilt = new THREE.Quaternion().setFromUnitVectors(f.n, new THREE.Vector3(0, 1, 0));
    const up = f.up.clone().applyQuaternion(tilt).setY(0).normalize();
    const yaw = Math.atan2(up.x, -up.z) - (rand() - 0.5) * 0.4;
    const final = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(tilt);
    const travel = new THREE.Vector3().subVectors(to, from).setY(0).normalize();
    // Rolling along the travel direction, plus some sideways tumble.
    const axis = travel.clone().cross(new THREE.Vector3(0, 1, 0)).negate().add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.9)).normalize();
    const wobble = new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5).normalize();
    return { final, axis, wobble, from, to, delay, spin: (3 + rand() * 2) * Math.PI, height: 1.5 + rand() * 0.4 };
}
const DICE_HOPS = [[300, 560, 0.95], [560, 740, 0.36], [740, 840, 0.1]];
// The stamp's tilt as it lands (°): 代价成功 more askew.
const DICE_TURN = tier => tier === "costly" ? -9 : -6;
const DICE_SCALE = 0.68;
// Pose a die at dice-time td (ms).
function diePose(gl, mesh, plan, td, scratch) {
    const t = Math.max(0, td - plan.delay), s = diceClamp(t / DICE_T.land);
    const q = mesh.quaternion.setFromAxisAngle(plan.axis, plan.spin * Math.pow(1 - s, 3)).multiply(plan.final);
    if (t > DICE_T.land) { const k = t - DICE_T.land; q.premultiply(scratch.q.setFromAxisAngle(plan.wobble, 0.09 * Math.exp(-k / 45) * Math.sin(k / 16))); }
    let hop = 0;
    if (t < DICE_HOPS[0][0]) hop = plan.height * (1 - Math.pow(t / DICE_HOPS[0][0], 2));
    else for (const [a, b, peak] of DICE_HOPS) if (t >= a && t < b) { const p = (t - a) / (b - a); hop = peak * 4 * p * (1 - p); }
    const e = diceOut(s), scale = DICE_SCALE * (0.4 + 0.6 * diceOut(diceClamp(t / 90)));
    let low = Infinity;
    for (const v of gl.model.vertices) low = Math.min(low, scratch.v.copy(v).applyQuaternion(q).y);
    mesh.scale.setScalar(scale);
    mesh.position.set(plan.from.x + (plan.to.x - plan.from.x) * e, hop - low * scale, plan.from.z + (plan.to.z - plan.from.z) * e);
}
// The throw's contacts, read off the same keyframes that move the dice (no separate timeline). Floor: each die meets the
// floor at the end of its fall and of each hop (DICE_HOPS, after its delay), as hard as the drop before it - impact
// speed goes with √height, so dB = 10·log10(drop / first drop): 0, about -2.5, -6.7, -12. Skid: from a die's last
// contact it slides and wobbles to rest (`land`). Clack: the moments the two posed meshes start to touch, sampled every
// 8 ms - the d10 is convex, so they touch when no separating axis exists (each face normal, then each edge x edge),
// tested only while their bounding spheres meet. Poses the meshes (the next frame re-poses them).
function diceContacts(gl, plans, scratch) {
    const floor = [], hops = DICE_HOPS;
    plans.forEach((plan, die) => {
        let drop = plan.height;
        for (const [at, , peak] of hops) { floor.push({ at: plan.delay + at, die, db: 10 * Math.log10(drop / plan.height) }); drop = peak; }
        floor.push({ at: plan.delay + hops[hops.length - 1][1], die, db: 10 * Math.log10(drop / plan.height) });
    });
    const skid = Math.min(...plans.map(plan => plan.delay + hops[hops.length - 1][1]));
    const clacks = [], { vertices, faces } = gl.model;
    // The d10's 20 edge directions (each kite edge is shared by two kites).
    const local = [];
    for (const { kite: k } of faces) for (const [p, q] of [[k.apex, k.a], [k.a, k.low], [k.low, k.b], [k.b, k.apex]]) {
        const e = q.clone().sub(p).normalize();
        if (!local.some(other => Math.abs(other.dot(e)) > 0.999)) local.push(e);
    }
    // Per die, flat world-space vertices / face normals / edges; an axis separates when the two spans miss by 0.01.
    const world = [new Float64Array(vertices.length * 3), new Float64Array(vertices.length * 3)];
    const normals = [new Float64Array(faces.length * 3), new Float64Array(faces.length * 3)], edges = [new Float64Array(local.length * 3), new Float64Array(local.length * 3)];
    const v = scratch.v.clone();
    const put = (out, i, vec) => { out[i * 3] = vec.x; out[i * 3 + 1] = vec.y; out[i * 3 + 2] = vec.z; };
    const separates = (x, y, z) => {
        const len = Math.hypot(x, y, z);
        if (len < 1e-4) return false;
        let lo0 = Infinity, hi0 = -Infinity, lo1 = Infinity, hi1 = -Infinity;
        for (let i = 0; i < world[0].length; i += 3) {
            const d0 = world[0][i] * x + world[0][i + 1] * y + world[0][i + 2] * z, d1 = world[1][i] * x + world[1][i + 1] * y + world[1][i + 2] * z;
            if (d0 < lo0) lo0 = d0; if (d0 > hi0) hi0 = d0; if (d1 < lo1) lo1 = d1; if (d1 > hi1) hi1 = d1;
        }
        const gap = 0.01 * len;
        return hi0 < lo1 - gap || hi1 < lo0 - gap;
    };
    const apartSat = () => {
        for (const n of normals) for (let i = 0; i < n.length; i += 3) if (separates(n[i], n[i + 1], n[i + 2])) return true;
        const [a, b] = edges;
        for (let i = 0; i < a.length; i += 3) for (let j = 0; j < b.length; j += 3)
            if (separates(a[i + 1] * b[j + 2] - a[i + 2] * b[j + 1], a[i + 2] * b[j] - a[i] * b[j + 2], a[i] * b[j + 1] - a[i + 1] * b[j])) return true;
        return false;
    };
    const [m0, m1] = gl.dice, radius = Math.max(...vertices.map(p => p.length()));
    let touching = false;
    for (let t = 0; t <= Math.max(...plans.map(plan => plan.delay)) + DICE_T.land; t += 8) {
        diePose(gl, m0, plans[0], t, scratch);
        diePose(gl, m1, plans[1], t, scratch);
        let apart = m0.position.distanceTo(m1.position) > radius * (m0.scale.x + m1.scale.x) + 0.01;
        if (!apart) {
            gl.dice.forEach((mesh, die) => {
                vertices.forEach((p, i) => put(world[die], i, v.copy(p).applyQuaternion(mesh.quaternion).multiplyScalar(mesh.scale.x).add(mesh.position)));
                faces.forEach((face, i) => put(normals[die], i, v.copy(face.n).applyQuaternion(mesh.quaternion)));
                local.forEach((e, i) => put(edges[die], i, v.copy(e).applyQuaternion(mesh.quaternion)));
            });
            apart = apartSat();
        }
        if (!apart && !touching) clacks.push(t);
        touching = !apart;
    }
    return { floor: floor.sort((a, b) => a.at - b.at), skid, clacks };
}
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
// The floor point (height y) under a band pixel [x, y px], through the camera.
function diceFloorAt(gl, w, h, sx, sy, y = 0) {
    const { THREE, camera } = gl, eye = camera.position;
    const dir = new THREE.Vector3(sx / w * 2 - 1, 1 - sy / h * 2, 0.5).unproject(camera).sub(eye).normalize();
    return eye.clone().addScaledVector(dir, (y - eye.y) / dir.y).setY(0);
}
// A die's box on the band at rest [left, top, width, height px]: its plan posed long after landing, every vertex projected.
function dieRestBox(gl, mesh, plan, w, h, scratch) {
    diePose(gl, mesh, plan, plan.delay + DICE_T.land + 1200, scratch);
    mesh.updateMatrixWorld(true);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const v of gl.model.vertices) {
        const p = scratch.v.copy(v).applyMatrix4(mesh.matrixWorld).project(gl.camera), x = (p.x + 1) / 2 * w, y = (1 - p.y) / 2 * h;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return [x0, y0, x1 - x0, y1 - y0];
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
    let rest = [diceFloorAt(gl, w, h, w / 2 - numW / 2 - side - h * 0.18, rowTop + h * 0.18), diceFloorAt(gl, w, h, w / 2 + numW / 2 + side + h * 0.18, rowTop + h * 0.18)];
    let plans = [], boxes = [], rowH = numH;
    for (let pass = 0; pass < 3; pass++) {
        plans = rest.map((to, die) => plan(die, to));
        boxes = plans.map((p, die) => dieRestBox(gl, gl.dice[die], p, w, h, scratch));
        rowH = Math.max(numH, ...boxes.map(box => box[3]));
        if (pass === 2) break;
        const cy = rowTop + rowH / 2, cx = [w / 2 - numW / 2 - side - boxes[0][2] / 2, w / 2 + numW / 2 + side + boxes[1][2] / 2];
        rest = rest.map((point, die) => {
            const p = point.clone().project(gl.camera), sx = (p.x + 1) / 2 * w, sy = (1 - p.y) / 2 * h, box = boxes[die];
            return diceFloorAt(gl, w, h, sx + cx[die] - (box[0] + box[2] / 2), sy + cy - (box[1] + box[3] / 2));
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
// Which label faces up now (read from the mesh, not from the plan).
function dieUp(gl, mesh, scratch) {
    let best = null, height = -Infinity;
    for (const face of gl.model.faces) {
        const y = scratch.v.copy(face.n).applyQuaternion(mesh.quaternion).y;
        if (y > height) { height = y; best = face; }
    }
    return best.label;
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
            current.plans = [0, 1].map(die => diePlan(gl, faces[die], throwFrom(die), rest[die], rand, die * 60));
            // The dust ring at the cup's lip on the floor, sized from the projected lip.
            const [dx, dy] = project(new THREE.Vector3(0, 0, 0.55)), lip = project(new THREE.Vector3(1.53, 0, 0.55))[0] - dx;
            Object.assign(parts.dust.style, { left: dx + "px", top: dy + "px", width: Math.round(lip * 3.4) + "px" });
        } else {
            const laid = diceLayout(gl, tray, parts, w, h, (die, to) => diePlan(gl, faces[die], throwFrom(die), to, diceRandom(roll.callId + ":" + die), die * 60), scratch, DICE_TURN(roll.tier));
            current.plans = laid.plans;
            current.fall = laid.fall;
            parts.tens.textContent = diceLabel(0, faces[0]);
            parts.ones.textContent = diceLabel(1, faces[1]);
        }
        // The sound follows the motion's own contacts; the cue list is on the band for the tests and the review render.
        current.cues = diceCues(roll, diceContacts(gl, current.plans, scratch), { landed, beat });
        tray.dataset.cues = JSON.stringify(current.cues.map(cue => [Math.round(cue.at), cue.beat, Math.round(cue.db * 10) / 10]));
        const c = current;
        current.sound = sounds.prepare(current.cues, "dice:" + roll.callId, () => forkForeground.now() - c.t0);
        if (!listening) { listening = true; listen(true); }
        stopFrame();
        frame = forkForeground.requestAnimationFrame(tick);
    }
    function stopFrame() { if (frame) forkForeground.cancelAnimationFrame(frame); frame = 0; }
    function phase(name) { if (current.phase !== name) { current.phase = name; tray.dataset.phase = name; } }

    // A short decaying jitter (px) for shakes, stepped every 30 ms.
    const jolt = (k, span, size) => { const a = size * Math.max(0, 1 - k / span), n = Math.floor(k / 30); return a ? "translate(" + (Math.sin(n * 12.9898) * a).toFixed(1) + "px, " + (Math.sin(n * 78.233) * a * 0.6).toFixed(1) + "px)" : ""; };
    function tick() {
        frame = 0;
        if (!current) return;
        const c = current, t = c.t0 === null ? 0 : forkForeground.now() - c.t0, T = DICE_T, s = parts;
        gl.dice.forEach((mesh, die) => diePose(gl, mesh, c.plans[die], t, scratch));
        // Each cue in the frame that reaches it; one a stalled frame skipped by more than DICE_SE_LATE is dropped.
        while (c.cues.length && c.cues[0].at <= t) { const cue = c.cues.shift(); if (t - cue.at <= DICE_SE_LATE) c.sound.play(cue); }
        diceFade(s.line, diceClamp(t / 180));
        if (t >= T.settle + 60 && !c.roll.hidden && !tray.hasAttribute("data-faces")) {
            const up = gl.dice.map(mesh => dieUp(gl, mesh, scratch));
            tray.dataset.faces = diceLabel(0, up[0]) + " " + diceLabel(1, up[1]);
            tray.dataset.value = String(diceValue(up[0], up[1]));
        }
        let shake = "";
        if (c.roll.hidden) {
            // The cup drops, accelerating, tilted a little; slams at T.slam (squash, a small rebound hop, a rock that
            // dies away), with a puff of dust and a short shake of the whole throw.
            const cup = gl.cup.group, fall = diceClamp((t - T.cupDrop) / (T.slam - T.cupDrop)), k = t - T.slam;
            let y = DICE_CUP.height * (1 - Math.pow(fall, 2.4)), squash = 0, rock = 0.12 * (1 - fall);
            if (k >= 0) {
                y = k < DICE_CUP.rebound ? DICE_CUP.hop * Math.sin(Math.PI * k / DICE_CUP.rebound) : 0;
                squash = k < 110 ? 0.08 * Math.sin(Math.PI * k / 110) : 0;
                rock = 0.035 * Math.exp(-k / 140) * Math.sin(k / 34);
                shake = jolt(k, 240, 6);
                tray.dataset.cup = "covered";
            }
            cup.visible = t >= T.cupDrop;
            cup.position.set(0, y, 0.55);
            cup.rotation.set(rock, 0, rock * 0.6);
            cup.scale.set(1 + squash / 2, 1 - squash, 1 + squash / 2);
            const near = 1 - Math.min(1, y / DICE_CUP.height);
            gl.cup.shadow.visible = cup.visible;
            gl.cup.shadow.position.z = 0.55;
            gl.cup.shadow.scale.setScalar(1.35 - 0.35 * near);
            gl.cup.shadow.material.opacity = 0.62 * near * near;
            const d = diceClamp(k / 420);
            diceFade(s.dust, k >= 0 ? 1 - d : 0);
            s.dust.style.transform = "scale(" + (0.55 + 1.1 * diceOut(d)) + ")";
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
// veiled (the first-entry veil covers the scene: a live arrival waits for the reveal) }.
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
    React.useEffect(() => {
        if (!seen.current || seen.current.session !== props.sessionId) { seen.current = { session: props.sessionId, ids: null }; diceStrip.reset(); }
        if (!key) return;
        const rolls = diceKeyRolls(key), ids = seen.current.ids;
        // The first snapshot this stage sees is history: its rolls never play or show.
        if (!ids) { seen.current.ids = new Set(rolls.map(roll => roll.callId)); return; }
        const fresh = rolls.filter(roll => !ids.has(roll.callId));
        fresh.forEach(roll => ids.add(roll.callId));
        const now = latest.current;
        if (!fresh.length || !now.running) return;
        // A live arrival the reader follows shows its strip (dice-roll.js) even when it is not thrown (skip, 减少动态, an
        // overlay); one that lands while the reader is in history is only its 履历 line.
        if (now.following) diceStrip.arrive(fresh.map(roll => roll.callId));
        if (now.live && !now.calm) thrower.current.enqueue(fresh);
    }, [key, props.sessionId]);
    // A clip export's replay: the replayed round's rolls are thrown (and shown) again, once per replay.
    const replayRolls = useDiceRolls(props.useChat, props.replay ? props.nativeTurn : 0), replayed = React.useRef(null);
    React.useEffect(() => {
        if (!props.replay || replayed.current === props.replay || !replayRolls.length) return;
        replayed.current = props.replay;
        diceStrip.arrive(replayRolls.map(roll => roll.callId));
        if (latest.current.live && !latest.current.calm) thrower.current.enqueue(replayRolls);
    }, [props.replay, replayRolls]);
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
