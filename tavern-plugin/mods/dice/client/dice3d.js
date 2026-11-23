// The shared 3D dice of the dice mod (the base effect every roll uses: the d100 of tavern_roll, throw.js, and a card's
// rule checks, check-throw.js). Real solids for d4 / d6 / d8 / d10 / d12 / d20, a d100 as a tens d10 (00–90) beside a
// ones d10, d2 / d3 as a d6 numbered round twice / three times. Each die is painted from a look ({body, ink, mark (the
// values to stand out), markInk, font}) onto one texture per kind and look.
//
// The motion is keyframed, not simulated (no physics dependency): each die's spin decays onto the exact final
// orientation - its result up (a face, or a d4's vertex), the number upright toward the camera - while a hop curve
// carries it to its rest point, lifted every frame so its lowest vertex rests on the floor (it rolls over edges and
// corners on its own). The result comes from the engine before the throw; the dice only act it out. The contacts that
// drive the sound (diceContacts) are read off the same keyframes. Three.js is the vendored runtime asset the card stage
// already serves, imported on the first throw.

const DICE_THREE = "/api/dsh-tavern/vendor/runtime-assets/three/";
// [three, its RoomEnvironment addon], imported once (the first throw waits for them; a failure retries next time).
let diceThreeModule = null;
function diceLoadThree() {
    const url = path => import(new URL(DICE_THREE + path, document.baseURI).href);
    if (!diceThreeModule) diceThreeModule = Promise.all([url("build/three.module.js"), url("addons/environments/RoomEnvironment.js")]).catch(error => { diceThreeModule = null; throw error; });
    return diceThreeModule;
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
// A transient performance layer's fade (never a control surface).
function diceFade(node, value) { node.style.opacity = String(value); }

// The die (or dice) that show one rolled value of an n-sided die: [{kind, value}]. A d100 is a tens and a ones d10
// (00 + 0 is 100); d2 / d3 roll a d6. Sides with no solid (d5, d7, d30 …) are not thrown: [].
function diceForSides(sides, value) {
    if (sides === 100) { const v = Number(value); return v === 100 ? [{ kind: "d10t", value: 0 }, { kind: "d10z", value: 0 }] : [{ kind: "d10t", value: Math.floor(v / 10) }, { kind: "d10z", value: v % 10 }]; }
    if (sides === 2 || sides === 3) return [{ kind: "d6x" + sides, value }];
    return [4, 6, 8, 10, 12, 20].includes(sides) ? [{ kind: "d" + sides, value }] : [];
}

// Upper kites of the d10 (around the top apex) read these; each lower kite reads 9 minus its opposite, as on a real d10.
const D10_UPPER = [0, 4, 8, 2, 6];
// Size of each solid (its largest vertex distance) so the dice read about the same size side by side.
const DICE_RADIUS = { d4: 1.35, d6: 1.12, d8: 1.18, d12: 1.12, d20: 1.12 };
const DICE_PHI = (1 + Math.sqrt(5)) / 2;

// The convex faces of a solid from its vertices and its face normals: each face is the vertices furthest along its
// normal, ordered counter-clockwise seen from outside.
function diceFacesOf(THREE, verts, normals) {
    return normals.map(n => {
        const top = Math.max(...verts.map(v => v.dot(n)));
        const ring = verts.filter(v => v.dot(n) > top - 1e-6);
        const c = ring.reduce((sum, v) => sum.add(v), new THREE.Vector3()).multiplyScalar(1 / ring.length);
        const e1 = ring[0].clone().sub(c).normalize(), e2 = n.clone().cross(e1);
        ring.sort((a, b) => Math.atan2(a.clone().sub(c).dot(e2), a.clone().sub(c).dot(e1)) - Math.atan2(b.clone().sub(c).dot(e2), b.clone().sub(c).dot(e1)));
        return { n, c, poly: ring };
    });
}
// Number the faces 1..F so opposite faces add up to F + 1 (as on real dice).
function diceNumberOpposite(faces) {
    let next = 1;
    const F = faces.length;
    for (const face of faces) {
        if (face.value) continue;
        const other = faces.find(row => !row.value && row !== face && row.n.dot(face.n) < -0.999);
        face.value = next;
        if (other) other.value = F + 1 - next;
        next++;
    }
}

// A die model: { kind, geometry (with its atlas UVs), faces [{n, c, up, right, poly, labels [{text, value, x, y, angle}]}],
// vertices, reads [{value, dir (the local direction that points up when it shows value), ref (in-plane: the number's up)}],
// cols, rows (the atlas cells, one per face) }. Built once per kind and THREE.
const diceModels = new WeakMap();
function diceModel(THREE, kind) {
    let cache = diceModels.get(THREE);
    if (!cache) diceModels.set(THREE, cache = new Map());
    if (!cache.has(kind)) cache.set(kind, diceBuild(THREE, kind));
    return cache.get(kind);
}
function diceBuild(THREE, kind) {
    const V = (x, y, z) => new THREE.Vector3(x, y, z), p = DICE_PHI, q = 1 / DICE_PHI;
    const signs = (fn) => { const out = []; for (const a of [1, -1]) for (const b of [1, -1]) for (const c of [1, -1]) out.push(fn(a, b, c)); return out; };
    const cube = signs((a, b, c) => V(a, b, c));
    const axes = [V(1, 0, 0), V(-1, 0, 0), V(0, 1, 0), V(0, -1, 0), V(0, 0, 1), V(0, 0, -1)];
    const icosa = [];
    for (const a of [1, -1]) for (const b of [1, -1]) icosa.push(V(0, a, b * p), V(a, b * p, 0), V(a * p, 0, b));
    const dodeca = [...cube];
    // The dodecahedron dual to that icosahedron (each one's vertex directions are the other's face normals).
    for (const a of [1, -1]) for (const b of [1, -1]) dodeca.push(V(0, a * p, b * q), V(a * q, 0, b * p), V(a * p, b * q, 0));
    const base = kind.startsWith("d6") ? "d6" : kind.startsWith("d10") ? "d10" : kind;
    let faces, verts, read = "face";
    if (base === "d10") ({ faces, verts } = diceD10(THREE, kind));
    else {
        const solid = { d4: [[V(1, 1, 1), V(-1, -1, 1), V(-1, 1, -1), V(1, -1, -1)], null], d6: [cube, axes], d8: [axes, cube], d12: [dodeca, icosa], d20: [icosa, dodeca] }[base];
        const r = DICE_RADIUS[base], scale = r / solid[0][0].length();
        verts = solid[0].map(v => v.clone().multiplyScalar(scale));
        const normals = base === "d4" ? verts.map(v => v.clone().negate().normalize()) : solid[1].map(n => n.clone().normalize());
        faces = diceFacesOf(THREE, verts, normals);
        if (base === "d4") read = "vertex";
        faces.forEach(face => {
            const toward = base === "d6" ? face.poly[0].clone().add(face.poly[1]).multiplyScalar(0.5) : face.poly[0];
            face.up = toward.clone().sub(face.c).normalize();
            face.right = face.up.clone().cross(face.n);
        });
        if (base !== "d4") diceNumberOpposite(faces);
    }
    const at = (face, v) => [v.clone().sub(face.c).dot(face.right), v.clone().sub(face.c).dot(face.up)];
    // Labels: the number on each face (a d4 writes each vertex's number in the three corners that meet at it).
    if (read === "vertex") {
        faces.forEach(face => {
            face.labels = face.poly.map(v => { const [x, y] = at(face, v), value = verts.indexOf(v) + 1; return { text: String(value), value, x: x * 0.56, y: y * 0.56, angle: Math.atan2(x, y) }; });
        });
    } else faces.forEach(face => {
        const value = kind === "d6x2" ? (face.value - 1) % 2 + 1 : kind === "d6x3" ? (face.value - 1) % 3 + 1 : face.value;
        face.value = value;
        const text = kind === "d10t" ? String(face.label * 10).padStart(2, "0") : String(value);
        face.labels = [{ text, value, x: 0, y: face.labelY || 0, angle: 0, bar: base !== "d6" && kind !== "d10t" && (value === 6 || value === 9) }];
    });
    const reads = read === "vertex"
        ? verts.map((v, i) => { const face = faces.find(row => row.poly.includes(v)); return { value: i + 1, dir: v.clone().normalize(), ref: v.clone().sub(face.c) }; })
        : faces.map(face => ({ value: face.value, dir: face.n, ref: face.up }));
    // The atlas: one square cell per face; each face's outline is scaled into its cell around its centre.
    const cols = Math.ceil(Math.sqrt(faces.length)), rows = Math.ceil(faces.length / cols);
    let extent = 0;
    for (const face of faces) for (const v of face.poly) { const [x, y] = at(face, v); extent = Math.max(extent, Math.abs(x), Math.abs(y)); }
    const size = extent * 2 * 1.06;
    const positions = [], normals = [], uvs = [];
    faces.forEach((face, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        face.cell = [col, row];
        face.outline = face.poly.map(v => { const [x, y] = at(face, v); return [0.5 + x / size, 0.5 - y / size]; });
        face.labels.forEach(label => { label.fx = 0.5 + label.x / size; label.fy = 0.5 - label.y / size; });
        for (let k = 1; k + 1 < face.poly.length; k++) for (const j of [0, k, k + 1]) {
            const v = face.poly[j], [fx, fy] = face.outline[j];
            positions.push(v.x, v.y, v.z); normals.push(face.n.x, face.n.y, face.n.z); uvs.push((col + fx) / cols, 1 - (row + fy) / rows);
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    const model = { kind, base, geometry, faces, vertices: verts, reads, cols, rows, read, radius: Math.max(...verts.map(v => v.length())) };
    model.edges = diceEdges(model);
    return model;
}
// The pentagonal trapezohedron: 10 congruent planar kites, labelled 0–9 (a d10 shows 10 for 0, a d100's ones die 0).
function diceD10(THREE, kind) {
    const H = 1, r = 0.9, c36 = Math.cos(Math.PI / 5), u = H * (1 - c36) / (1 + c36); // u keeps every kite planar
    const ring = (deg, y) => new THREE.Vector3(r * Math.cos(deg * Math.PI / 180), y, r * Math.sin(deg * Math.PI / 180));
    const T = new THREE.Vector3(0, H, 0), B = new THREE.Vector3(0, -H, 0);
    const U = [0, 1, 2, 3, 4].map(k => ring(72 * k, u)), L = [0, 1, 2, 3, 4].map(k => ring(72 * k + 36, -u));
    const kites = [];
    for (let k = 0; k < 5; k++) kites.push([T, U[k], L[k], U[(k + 1) % 5]]);
    for (let k = 0; k < 5; k++) kites.push([B, L[k], U[(k + 1) % 5], L[(k + 1) % 5]]);
    const faces = kites.map(([apex, a, low, b]) => {
        const c = a.clone().add(b).multiplyScalar(0.5);
        const n = new THREE.Vector3().subVectors(a, apex).cross(new THREE.Vector3().subVectors(low, apex)).normalize();
        if (n.dot(c) < 0) n.negate();
        const up = apex.clone().sub(c).normalize(), right = up.clone().cross(n);
        // Counter-clockwise seen from outside.
        let poly = [apex, a, low, b];
        if (new THREE.Vector3().subVectors(a, apex).cross(new THREE.Vector3().subVectors(low, apex)).dot(n) < 0) poly = [apex, b, low, a];
        return { n, c, up, right, poly, labelY: apex.clone().sub(c).dot(up) * 0.26 };
    });
    faces.forEach((face, i) => {
        face.label = i < 5 ? D10_UPPER[i] : 9 - faces.slice(0, 5).reduce((best, other) => other.n.dot(face.n) < best.n.dot(face.n) ? other : best).label;
        face.value = kind === "d10" && face.label === 0 ? 10 : face.label;
    });
    return { faces, verts: [T, B, ...U, ...L] };
}
// The model's distinct edge directions (for the contact test).
function diceEdges(model) {
    const out = [];
    for (const face of model.faces) for (let i = 0; i < face.poly.length; i++) {
        const e = face.poly[(i + 1) % face.poly.length].clone().sub(face.poly[i]).normalize();
        if (!out.some(other => Math.abs(other.dot(e)) > 0.999)) out.push(e);
    }
    return out;
}
// Pictures a look paints with (a skin's dice texture and face pictures, by URL), loaded before the throw that uses them.
const diceImages = new Map();
function diceLoadImages(urls) {
    return Promise.all([...new Set(urls)].filter(url => !diceImages.has(url)).map(url => {
        const image = new Image();
        image.src = url;
        return image.decode().then(() => { diceImages.set(url, image); }, error => console.warn("[fork-dice] picture unavailable", url, error));
    }));
}
// One die's texture: every face cell in the body paint (under the look's texture picture, look.texture), its outline and
// its number(s) in the ink paint; a value the look marks (look.mark) in the mark ink, heavier; a value with a face
// picture (look.faces[value]) drawn as that picture instead of its number.
function dicePaint(THREE, model, look, cell, anisotropy) {
    const canvas = document.createElement("canvas");
    canvas.width = cell * model.cols; canvas.height = cell * model.rows;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = look.body;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const grain = look.texture && diceImages.get(look.texture);
    if (grain) for (let x = 0; x < model.cols; x++) for (let y = 0; y < model.rows; y++) ctx.drawImage(grain, x * cell, y * cell, cell, cell);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const marked = new Set(look.mark || []);
    const base = model.read === "vertex" ? 0.2 : model.base === "d20" ? 0.3 : model.base === "d12" ? 0.32 : 0.36;
    for (const face of model.faces) {
        const x0 = face.cell[0] * cell, y0 = face.cell[1] * cell;
        ctx.globalAlpha = 0.3; ctx.strokeStyle = look.ink; ctx.lineWidth = cell * 0.03; ctx.lineJoin = "round";
        ctx.beginPath();
        face.outline.forEach(([fx, fy], i) => ctx[i ? "lineTo" : "moveTo"](x0 + fx * cell, y0 + fy * cell));
        ctx.closePath(); ctx.stroke();
        ctx.globalAlpha = 1;
        for (const label of face.labels) {
            const mark = marked.has(label.value), size = cell * base * (label.text.length > 1 ? 0.82 : 1) * (mark ? 1.12 : 1);
            ctx.save();
            ctx.translate(x0 + label.fx * cell, y0 + label.fy * cell);
            ctx.rotate(label.angle);
            const picture = look.faces && diceImages.get(look.faces[label.text] || look.faces[label.value]);
            if (picture) { const s = size * 1.5; ctx.drawImage(picture, -s / 2, -s / 2, s, s); ctx.restore(); continue; }
            ctx.fillStyle = mark ? look.markInk || look.ink : look.ink;
            ctx.font = (mark ? "900 " : "700 ") + Math.round(size) + "px " + look.font;
            ctx.fillText(label.text, 0, 0);
            // 6 and 9 read the same upside down; a bar under them tells which way is up.
            if (label.bar) ctx.fillRect(-cell * 0.08, cell * 0.17, cell * 0.16, cell * 0.035);
            ctx.restore();
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    return texture;
}

// The renderer and the scene (lights, a shadow floor), built on the first throw and reused until dispose(). Dice meshes
// come from place(list): one mesh per die, its model by kind and its texture by kind and look (cached while painted the same).
function diceScene(THREE, RoomEnvironment) {
    const canvas = document.createElement("canvas");
    // The drawing buffer is band size x pixel ratio (renderer.setSize(w, h, false) leaves the style alone); its CSS size is the
    // band's, whatever the pixel ratio, so a high-DPI screen draws it sharper, not larger.
    canvas.style.cssText = "display:block;width:100%;height:100%";
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const scene = new THREE.Scene();
    // A soft studio room for image-based light.
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
    Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 6, bottom: -6, near: 1, far: 20 });
    sun.shadow.radius = 4;
    scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 12), new THREE.ShadowMaterial({ opacity: 0.34 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const meshes = [], textures = new Map();
    const anisotropy = () => Math.min(4, renderer.capabilities.getMaxAnisotropy());
    function texture(model, look, cell) {
        const key = JSON.stringify([model.kind, look, cell]);
        if (!textures.has(key)) textures.set(key, dicePaint(THREE, model, look, cell, anisotropy()));
        return textures.get(key);
    }
    return {
        THREE, renderer, canvas, scene, camera,
        // list [{kind, look}] → the meshes, posed later; the rest of the pool hidden.
        place(list, cell) {
            while (meshes.length < list.length) {
                const mesh = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.06 }));
                mesh.castShadow = true;
                scene.add(mesh);
                meshes.push(mesh);
            }
            meshes.forEach((mesh, i) => {
                mesh.visible = i < list.length;
                if (!mesh.visible) return;
                const model = diceModel(THREE, list[i].kind), map = texture(model, list[i].look, cell);
                mesh.geometry = model.geometry;
                mesh.userData.model = model;
                if (mesh.material.map !== map) { mesh.material.map = map; mesh.material.needsUpdate = true; }
            });
            return meshes.slice(0, list.length);
        },
        // Forget the painted textures (the next place() repaints): a theme or look change.
        repaint() { for (const map of textures.values()) map.dispose(); textures.clear(); },
        dispose() {
            for (const map of textures.values()) map.dispose();
            textures.clear();
            // Shared model geometries are only freed on the GPU here; the next scene uploads them again.
            scene.traverse(node => { node.geometry?.dispose(); node.material?.dispose(); });
            scene.environment.dispose();
            renderer.dispose();
            renderer.forceContextLoss();
            canvas.remove();
        }
    };
}

// A die's keyframed path to its rest pose: `value` up, its number toward the camera (screen-up), a little yaw.
function diePlan(THREE, model, value, from, to, rand, delay) {
    const read = model.reads.find(row => row.value === value) || model.reads[0];
    const tilt = new THREE.Quaternion().setFromUnitVectors(read.dir.clone().normalize(), new THREE.Vector3(0, 1, 0));
    const up = read.ref.clone().applyQuaternion(tilt).setY(0).normalize();
    const yaw = Math.atan2(up.x, -up.z) - (rand() - 0.5) * 0.4;
    const final = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(tilt);
    const travel = new THREE.Vector3().subVectors(to, from).setY(0).normalize();
    // Rolling along the travel direction, plus some sideways tumble.
    const axis = travel.clone().cross(new THREE.Vector3(0, 1, 0)).negate().add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.9)).normalize();
    const wobble = new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5).normalize();
    return { model, value, final, axis, wobble, from, to, delay, spin: (3 + rand() * 2) * Math.PI, height: 1.5 + rand() * 0.4 };
}
// The motion (ms): the spin decays by `land`; the fall and two hops; the die grows in over its first 90 ms.
const DICE_LAND = 880;
const DICE_HOPS = [[300, 560, 0.95], [560, 740, 0.36], [740, 840, 0.1]];
// Pose a die at dice-time td (ms). scratch: {q: Quaternion, v: Vector3}.
function diePose(mesh, plan, td, scale0, scratch) {
    const t = Math.max(0, td - plan.delay), s = diceClamp(t / DICE_LAND);
    const q = mesh.quaternion.setFromAxisAngle(plan.axis, plan.spin * Math.pow(1 - s, 3)).multiply(plan.final);
    if (t > DICE_LAND) { const k = t - DICE_LAND; q.premultiply(scratch.q.setFromAxisAngle(plan.wobble, 0.09 * Math.exp(-k / 45) * Math.sin(k / 16))); }
    let hop = 0;
    if (t < DICE_HOPS[0][0]) hop = plan.height * (1 - Math.pow(t / DICE_HOPS[0][0], 2));
    else for (const [a, b, peak] of DICE_HOPS) if (t >= a && t < b) { const p = (t - a) / (b - a); hop = peak * 4 * p * (1 - p); }
    const e = diceOut(s), scale = scale0 * (0.4 + 0.6 * diceOut(diceClamp(t / 90)));
    let low = Infinity;
    for (const v of plan.model.vertices) low = Math.min(low, scratch.v.copy(v).applyQuaternion(q).y);
    mesh.scale.setScalar(scale);
    mesh.position.set(plan.from.x + (plan.to.x - plan.from.x) * e, hop - low * scale, plan.from.z + (plan.to.z - plan.from.z) * e);
}
// The value a die shows now (read from the mesh, not from the plan).
function dieUp(mesh, scratch) {
    let best = null, height = -Infinity;
    for (const read of mesh.userData.model.reads) {
        const y = scratch.v.copy(read.dir).normalize().applyQuaternion(mesh.quaternion).y;
        if (y > height) { height = y; best = read; }
    }
    return best.value;
}
// The throw's contacts, read off the same keyframes that move the dice (no separate timeline). Floor: each die meets
// the floor at the end of its fall and of each hop (after its delay), as hard as the drop before it - impact speed goes
// with √height, so dB = 10·log10(drop / first drop). Skid: from the first die's last contact the dice slide to rest.
// Clack: the moments two posed dice start to touch, sampled every 8 ms - the solids are convex, so they touch when no
// separating axis exists (each face normal, then each edge x edge), tested only while their bounding spheres meet.
// Poses the meshes (the next frame re-poses them).
function diceContacts(meshes, plans, scale, scratch) {
    const floor = [], hops = DICE_HOPS;
    plans.forEach((plan, die) => {
        let drop = plan.height;
        for (const [at, , peak] of hops) { floor.push({ at: plan.delay + at, die, db: 10 * Math.log10(drop / plan.height) }); drop = peak; }
        floor.push({ at: plan.delay + hops[hops.length - 1][1], die, db: 10 * Math.log10(drop / plan.height) });
    });
    const skid = Math.min(...plans.map(plan => plan.delay + hops[hops.length - 1][1]));
    const clacks = [], v = scratch.v.clone();
    const world = plans.map(plan => ({ verts: new Float64Array(plan.model.vertices.length * 3), normals: new Float64Array(plan.model.faces.length * 3), edges: new Float64Array(plan.model.edges.length * 3) }));
    const put = (out, i, vec) => { out[i * 3] = vec.x; out[i * 3 + 1] = vec.y; out[i * 3 + 2] = vec.z; };
    const separates = (A, B, x, y, z) => {
        const len = Math.hypot(x, y, z);
        if (len < 1e-4) return false;
        let lo0 = Infinity, hi0 = -Infinity, lo1 = Infinity, hi1 = -Infinity;
        for (let i = 0; i < A.length; i += 3) { const d = A[i] * x + A[i + 1] * y + A[i + 2] * z; if (d < lo0) lo0 = d; if (d > hi0) hi0 = d; }
        for (let i = 0; i < B.length; i += 3) { const d = B[i] * x + B[i + 1] * y + B[i + 2] * z; if (d < lo1) lo1 = d; if (d > hi1) hi1 = d; }
        const gap = 0.01 * len;
        return hi0 < lo1 - gap || hi1 < lo0 - gap;
    };
    const apart = (a, b) => {
        const A = world[a], B = world[b];
        for (const n of [A.normals, B.normals]) for (let i = 0; i < n.length; i += 3) if (separates(A.verts, B.verts, n[i], n[i + 1], n[i + 2])) return true;
        const ea = A.edges, eb = B.edges;
        for (let i = 0; i < ea.length; i += 3) for (let j = 0; j < eb.length; j += 3)
            if (separates(A.verts, B.verts, ea[i + 1] * eb[j + 2] - ea[i + 2] * eb[j + 1], ea[i + 2] * eb[j] - ea[i] * eb[j + 2], ea[i] * eb[j + 1] - ea[i + 1] * eb[j])) return true;
        return false;
    };
    const touching = new Set(), end = Math.max(...plans.map(plan => plan.delay)) + DICE_LAND;
    for (let t = 0; t <= end; t += 8) {
        meshes.forEach((mesh, die) => diePose(mesh, plans[die], t, scale, scratch));
        const posed = new Set();
        for (let a = 0; a < meshes.length; a++) for (let b = a + 1; b < meshes.length; b++) {
            const key = a + ":" + b, ma = meshes[a], mb = meshes[b];
            let off = ma.position.distanceTo(mb.position) > plans[a].model.radius * ma.scale.x + plans[b].model.radius * mb.scale.x + 0.01;
            if (!off) {
                for (const die of [a, b]) if (!posed.has(die)) {
                    posed.add(die);
                    const mesh = meshes[die], model = plans[die].model, w = world[die];
                    model.vertices.forEach((p, i) => put(w.verts, i, v.copy(p).applyQuaternion(mesh.quaternion).multiplyScalar(mesh.scale.x).add(mesh.position)));
                    model.faces.forEach((face, i) => put(w.normals, i, v.copy(face.n).applyQuaternion(mesh.quaternion)));
                    model.edges.forEach((e, i) => put(w.edges, i, v.copy(e).applyQuaternion(mesh.quaternion)));
                }
                off = apart(a, b);
            }
            if (!off && !touching.has(key)) clacks.push(t);
            if (off) touching.delete(key); else touching.add(key);
        }
    }
    return { floor: floor.sort((a, b) => a.at - b.at), skid, clacks: [...new Set(clacks)].sort((a, b) => a - b) };
}
// The floor point under a band pixel [x, y px], through the camera.
function diceFloorAt(THREE, camera, w, h, sx, sy, y = 0) {
    const eye = camera.position;
    const dir = new THREE.Vector3(sx / w * 2 - 1, 1 - sy / h * 2, 0.5).unproject(camera).sub(eye).normalize();
    return eye.clone().addScaledVector(dir, (y - eye.y) / dir.y).setY(0);
}
// A die's box on the band at rest [left, top, width, height px]: its plan posed long after landing, every vertex projected.
function dieRestBox(camera, mesh, plan, scale, w, h, scratch) {
    diePose(mesh, plan, plan.delay + DICE_LAND + 1200, scale, scratch);
    mesh.updateMatrixWorld(true);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const v of plan.model.vertices) {
        const p = scratch.v.copy(v).applyMatrix4(mesh.matrixWorld).project(camera), x = (p.x + 1) / 2 * w, y = (1 - p.y) / 2 * h;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return [x0, y0, x1 - x0, y1 - y0];
}
