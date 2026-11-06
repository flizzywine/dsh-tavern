function createStageWeather({matrix:galMatrix,canvasTexture:galCanvasTexture}) {
let disposed=false;const runtimes=new Set();
const GAL_WEATHERS = ["rain", "storm", "snow", "sakura", "leaves", "sparkle"];
// Light presets are data now: stage looks (gal-looks.js, lib/vendor/runtime-assets/stage-looks/).
// Weather also darkens and cools the whole picture a little (rain, storm) or lifts it (snow).
function galWeatherMatrix(kind) {
    const M = galMatrix;
    if (kind === "rain") return M.chain(M.saturate(0.82), M.scale(0.9, 0.93, 0.98));
    if (kind === "storm") return M.chain(M.saturate(0.7), M.scale(0.74, 0.78, 0.88), M.contrast(1.05));
    if (kind === "snow") return M.chain(M.saturate(0.9), M.scale(0.98, 1.0, 1.03), M.offset(0.015, 0.02, 0.03));
    return M.identity();
}
// Weather layers: sizes and speeds in stage heights (per second), wind in stage heights per second.
// texture: generated particle picture; orient: aligned with its motion (rain streaks); thick: extra width of a streak; sway: sideways
// sine drift; spin: turns per second (±); flutter: 3-D tumble (scale.x); twinkle: alpha breathing.
const GAL_WEATHER = {
    rain: [
        { layer: "back", texture: "streak", count: 150, size: [0.04, 0.064], speed: [1.0, 1.35], wind: 0.1, alpha: [0.2, 0.36], orient: true, thick: 2.2 },
        { layer: "front", texture: "streak", count: 64, size: [0.1, 0.16], speed: [1.9, 2.5], wind: 0.18, alpha: [0.24, 0.42], orient: true, thick: 1.8 }],
    storm: [
        { layer: "back", texture: "streak", count: 250, size: [0.04, 0.062], speed: [1.35, 1.75], wind: 0.34, alpha: [0.2, 0.36], orient: true, thick: 2 },
        { layer: "front", texture: "streak", count: 110, size: [0.11, 0.17], speed: [2.4, 3.1], wind: 0.55, alpha: [0.24, 0.44], orient: true, thick: 1.7 }],
    snow: [
        { layer: "back", texture: "flake", count: 130, size: [0.004, 0.009], speed: [0.03, 0.07], wind: 0.012, sway: [0.008, 0.022], swayHz: [0.12, 0.3], alpha: [0.5, 0.85] },
        { layer: "front", texture: "flake", count: 36, size: [0.014, 0.026], speed: [0.08, 0.14], wind: 0.02, sway: [0.02, 0.04], swayHz: [0.1, 0.22], alpha: [0.6, 0.9] }],
    sakura: [
        { layer: "back", texture: "petal", count: 40, size: [0.011, 0.017], speed: [0.06, 0.1], wind: 0.06, sway: [0.01, 0.025], swayHz: [0.2, 0.4], spin: [0.2, 0.7], flutter: [0.5, 1.2], alpha: [0.75, 0.95], tints: [0xffffff, 0xfff2f6, 0xffe6ee] },
        { layer: "front", texture: "petal", count: 16, size: [0.024, 0.036], speed: [0.1, 0.16], wind: 0.09, sway: [0.02, 0.04], swayHz: [0.15, 0.3], spin: [0.2, 0.6], flutter: [0.4, 1.0], alpha: [0.85, 1], tints: [0xffffff, 0xfff2f6] }],
    leaves: [
        { layer: "back", texture: "leaf", count: 22, size: [0.015, 0.024], speed: [0.07, 0.12], wind: 0.07, sway: [0.015, 0.03], swayHz: [0.15, 0.3], spin: [0.2, 0.6], flutter: [0.3, 0.8], alpha: [0.8, 0.95], tints: [0xe0892f, 0xc4452a, 0xe8b24a, 0xa8642a] },
        { layer: "front", texture: "leaf", count: 9, size: [0.032, 0.046], speed: [0.12, 0.18], wind: 0.1, sway: [0.03, 0.05], swayHz: [0.12, 0.25], spin: [0.2, 0.5], flutter: [0.3, 0.7], alpha: [0.9, 1], tints: [0xe0892f, 0xc4452a, 0xe8b24a] }],
    sparkle: [
        { layer: "back", texture: "star", count: 26, size: [0.012, 0.022], speed: [-0.025, -0.006], wind: 0, drift: 0.006, twinkle: [0.5, 1.3], spin: [0.05, 0.2], alpha: [0.55, 1], tint: 0xfff6dc, blend: "add" },
        { layer: "front", texture: "star", count: 10, size: [0.024, 0.036], speed: [-0.03, -0.01], wind: 0, drift: 0.008, twinkle: [0.4, 1.0], spin: [0.05, 0.15], alpha: [0.6, 1], tint: 0xfff6dc, blend: "add" }],
    // Light motes of a look (motes: { kind: "bokeh" }, the dream look), not a weather.
    motes: [
        { layer: "back", texture: "mote", count: 14, size: [0.014, 0.03], speed: [-0.03, -0.012], wind: 0.004, drift: 0.01, sway: [0.01, 0.02], swayHz: [0.06, 0.14], twinkle: [0.15, 0.4], alpha: [0.25, 0.55], tints: [0xffe0f4, 0xf2e2ff, 0xfff4fb], blend: "add" },
        { layer: "front", texture: "mote", count: 8, size: [0.03, 0.055], speed: [-0.035, -0.015], wind: 0.004, drift: 0.01, sway: [0.015, 0.03], swayHz: [0.05, 0.1], twinkle: [0.1, 0.3], alpha: [0.18, 0.36], tints: [0xffe0f4, 0xf2e2ff], blend: "add" }]
};
// Layers of a weather at a quality: low keeps about a third of the particles.
function galWeatherLayers(kind, quality) {
    const layers = GAL_WEATHER[kind] || [];
    return layers.map(spec => Object.assign({}, spec, { count: quality === "low" ? Math.max(3, Math.round(spec.count / 3)) : spec.count }));
}
function galPick(range, rand) { return Array.isArray(range) ? range[0] + (range[1] - range[0]) * rand() : (range || 0); }
// (Re)spawns a particle. Coordinates in stage heights (x runs 0..aspect). fresh: anywhere on screen
// (a weather that starts already falls everywhere); otherwise just outside the edge it enters from.
function galParticleSeed(p, spec, rand, fresh, aspect) {
    p.size = galPick(spec.size, rand); p.speed = galPick(spec.speed, rand);
    p.wind = (spec.wind || 0) * (0.75 + 0.5 * rand()); p.drift = spec.drift ? (rand() * 2 - 1) * spec.drift : 0;
    p.alpha = galPick(spec.alpha, rand); p.phase = rand() * Math.PI * 2;
    p.sway = galPick(spec.sway, rand); p.swayHz = galPick(spec.swayHz, rand);
    p.spin = galPick(spec.spin, rand) * Math.PI * 2 * (rand() < 0.5 ? -1 : 1); p.rot = rand() * Math.PI * 2;
    p.flutterHz = galPick(spec.flutter, rand); p.twinkleHz = galPick(spec.twinkle, rand);
    p.tint = spec.tints ? spec.tints[Math.floor(rand() * spec.tints.length) % spec.tints.length] : spec.tint != null ? spec.tint : 0xffffff;
    const upwind = p.speed > 0.2 ? (p.wind + p.drift) / p.speed * 1.2 : 0;
    if (fresh) { p.x = -0.1 * aspect + rand() * 1.2 * aspect; p.y = -0.1 + rand() * 1.2; }
    else if (p.speed > 0.002) { p.y = -0.06 - p.size - rand() * 0.08; p.x = -0.1 * aspect - upwind + rand() * (1.2 * aspect + upwind); }
    else if (p.speed < -0.002) { p.y = 1.06 + p.size + rand() * 0.08; p.x = -0.1 * aspect + rand() * 1.2 * aspect; }
    else { p.x = -0.1 * aspect + rand() * 1.2 * aspect; p.y = -0.1 + rand() * 1.2; }
    return p;
}
function galParticleStep(p, spec, dt, rand, aspect) {
    p.y += p.speed * dt; p.x += (p.wind + p.drift) * dt; p.rot += p.spin * dt;
    if ((p.speed > 0.002 && p.y > 1.1 + p.size) || (p.speed < -0.002 && p.y < -0.1 - p.size)) galParticleSeed(p, spec, rand, false, aspect);
    else if (Math.abs(p.speed) <= 0.002) { if (p.y > 1.12) p.y -= 1.24; else if (p.y < -0.12) p.y += 1.24; }
    if (p.x > 1.14 * aspect) p.x -= 1.28 * aspect; else if (p.x < -0.14 * aspect) p.x += 1.28 * aspect;
    return p;
}
// What a particle looks like at time t (seconds): position (stage heights), rotation, scale factors, alpha.
function galParticleView(p, spec, t) {
    const view = { x: p.x, y: p.y, rotation: p.rot, sx: 1, sy: 1, alpha: p.alpha };
    if (p.sway) view.x += p.sway * Math.sin(2 * Math.PI * p.swayHz * t + p.phase);
    if (spec.orient) view.rotation = -Math.atan2(p.wind + p.drift, p.speed);
    else if (p.sway) view.rotation = p.rot + 0.35 * Math.cos(2 * Math.PI * p.swayHz * t + p.phase);
    if (p.flutterHz) view.sx = 0.22 + 0.78 * Math.abs(Math.cos(2 * Math.PI * p.flutterHz * t + p.phase));
    if (p.twinkleHz) {
        const k = 0.5 + 0.5 * Math.sin(2 * Math.PI * p.twinkleHz * t + p.phase);
        view.alpha = p.alpha * (0.3 + 0.7 * k);
        if (spec.texture === "star") { view.sx = view.sy = 0.55 + 0.45 * k; }
    }
    return view;
}
// Lightning (storm): a bright strike, a dark gap, a second flicker and a slow fade; ~0.9 s.
function galLightningAt(ms) {
    if (ms < 0 || ms >= 900) return 0;
    if (ms < 50) return 0.9 * ms / 50;
    if (ms < 110) return 0.9 - 0.75 * (ms - 50) / 60;
    if (ms < 150) return 0.15 + 0.6 * (ms - 110) / 40;
    return 0.75 * Math.pow(1 - (ms - 150) / 750, 2.2);
}

// Particle pictures, drawn once per weather (white or natural colours; tint varies them).
function galParticleArt(ctx, kind, w, h) {
    if (kind === "streak") {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "rgba(220,232,255,0)"); g.addColorStop(0.7, "rgba(230,240,255,.75)"); g.addColorStop(1, "rgba(255,255,255,.95)");
        ctx.fillStyle = g; ctx.fillRect(w / 2 - 1.5, 0, 3, h);
        ctx.globalAlpha = 0.35; ctx.fillRect(w / 2 - 3, h * 0.35, 6, h * 0.65);
    } else if (kind === "flake" || kind === "mote") {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        if (kind === "mote") { g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.18, "rgba(255,255,255,.85)"); g.addColorStop(0.45, "rgba(255,255,255,.28)"); g.addColorStop(1, "rgba(255,255,255,0)"); }
        else { g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, "rgba(255,255,255,.9)"); g.addColorStop(0.75, "rgba(255,255,255,.35)"); g.addColorStop(1, "rgba(255,255,255,0)"); }
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    } else if (kind === "petal") {
        ctx.translate(w / 2, h / 2);
        const g = ctx.createLinearGradient(0, -h * 0.42, 0, h * 0.42);
        g.addColorStop(0, "#ffd9e4"); g.addColorStop(0.6, "#ffc0d3"); g.addColorStop(1, "#f29ab8");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.42);
        ctx.bezierCurveTo(-w * 0.44, h * 0.12, -w * 0.36, -h * 0.34, -w * 0.08, -h * 0.4);
        ctx.lineTo(0, -h * 0.3);
        ctx.lineTo(w * 0.08, -h * 0.4);
        ctx.bezierCurveTo(w * 0.36, -h * 0.34, w * 0.44, h * 0.12, 0, h * 0.42);
        ctx.fill();
        ctx.strokeStyle = "rgba(230,120,160,.35)"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(0, h * 0.38); ctx.lineTo(0, -h * 0.1); ctx.stroke();
    } else if (kind === "leaf") {
        ctx.translate(w / 2, h / 2); ctx.rotate(-0.5);
        const g = ctx.createLinearGradient(-w * 0.3, 0, w * 0.3, 0);
        g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#c9c9c9");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(0, -h * 0.44);
        ctx.bezierCurveTo(w * 0.34, -h * 0.2, w * 0.3, h * 0.24, 0, h * 0.4);
        ctx.bezierCurveTo(-w * 0.3, h * 0.24, -w * 0.34, -h * 0.2, 0, -h * 0.44); ctx.fill();
        ctx.strokeStyle = "rgba(90,50,20,.45)"; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(0, -h * 0.4); ctx.lineTo(0, h * 0.46); ctx.stroke();
        ctx.lineWidth = 0.9;
        [-0.2, 0, 0.2].forEach(y => { ctx.beginPath(); ctx.moveTo(0, h * y); ctx.lineTo(w * 0.18, h * (y - 0.12)); ctx.moveTo(0, h * y); ctx.lineTo(-w * 0.18, h * (y - 0.12)); ctx.stroke(); });
    } else if (kind === "star") {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(0.2, "rgba(255,255,255,.25)"); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.translate(w / 2, h / 2); ctx.fillStyle = "#fff";
        [[w * 0.48, w * 0.05], [w * 0.05, w * 0.48]].forEach(function ([rx, ry]) { ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); });
        ctx.rotate(Math.PI / 4); ctx.globalAlpha = 0.6;
        [[w * 0.22, w * 0.03], [w * 0.03, w * 0.22]].forEach(function ([rx, ry]) { ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); });
    }
}
const GAL_PARTICLE_SIZE = { streak: [8, 160], flake: [48, 48], mote: [64, 64], petal: [48, 48], leaf: [56, 56], star: [64, 64] };

function create(env){
 if(disposed)throw new Error('Weather module is disposed');
 const {PIXI,app}=env,rand=Math.random,systems=new Set();let dead=false;
    function particleTexture(kind) {
        const [w, h] = GAL_PARTICLE_SIZE[kind];
        return galCanvasTexture(PIXI, w, h, (ctx, cw, ch) => galParticleArt(ctx, kind, cw, ch));
    }
    function createWeather(kind, quality) {
        if(dead)throw new Error('Weather renderer is disposed');
        const specs = galWeatherLayers(kind, quality);
        if (!specs.length) return null;
        const aspect = app.screen.width / Math.max(1, app.screen.height);
        const system = { kind, key: kind + ":" + quality, alpha: 0, target: 1, layers: [], textures: {} };
        systems.add(system);
        try{specs.forEach(function (spec) {
            const texture = system.textures[spec.texture] || (system.textures[spec.texture] = particleTexture(spec.texture));
            const box = new PIXI.ParticleContainer(spec.count, { vertices: true, position: true, rotation: true, tint: true, uvs: false });
            box.blendMode = spec.blend === "add" ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL;
            box.alpha = 0;
            (spec.layer === "front" ? env.frontFx : env.backFx).addChild(box);
            const items = [];
            system.layers.push({ spec, box, items, texture });
            for (let i = 0; i < spec.count; i++) {
                const item = new PIXI.Sprite(texture);
                item.anchor.set(0.5);
                const p = galParticleSeed({ sprite: item }, spec, rand, true, aspect);
                item.tint = p.tint;
                box.addChild(item); items.push(p);
            }
        });}catch(error){try{destroyWeather(system);}catch(cleanup){throw new AggregateError([error,cleanup],'Weather setup failed');}throw error;}
        return system;
    }
    function destroyWeather(system) {
        if(!systems.delete(system))return;const errors=[];
        for(const cleanup of [...system.layers.map(layer=>()=>layer.box.destroy({children:true})),...Object.values(system.textures).map(texture=>()=>texture.destroy(true))])try{cleanup();}catch(error){errors.push(error);}
        system.layers.length=0;system.textures={};if(errors.length)throw new AggregateError(errors,'Weather cleanup failed');
    }
    function stepWeather(system, now, dt, W, H) {
        if(dead||!systems.has(system))return 0;
        let count=0;
        system.alpha += (system.target - system.alpha) * (1 - Math.exp(-dt * (system.target ? 1.8 : 2.6)));
        if (system.target && Math.abs(system.target - system.alpha) < 0.005) system.alpha = system.target;
        const aspect = W / Math.max(1, H), t = now / 1000;
        system.layers.forEach(function (layer) {
            layer.box.alpha = system.alpha;
            const texH = layer.texture.height || 1, texW = layer.texture.width || 1;
            layer.items.forEach(function (p) {
                galParticleStep(p, layer.spec, dt, rand, aspect);
                const view = galParticleView(p, layer.spec, t);
                const s = p.size * H / (layer.spec.texture === "streak" ? texH : Math.max(texW, texH));
                p.sprite.position.set(view.x * H, view.y * H);
                p.sprite.rotation = view.rotation;
                p.sprite.scale.set(s * view.sx * (layer.spec.thick || 1), s * view.sy);
                p.sprite.alpha = view.alpha;
            });
            count += layer.items.length;
        });
        return count;
    }
const runtime={create:createWeather,destroy:destroyWeather,step:stepWeather,dispose(){if(dead)return;dead=true;runtimes.delete(runtime);const errors=[];for(const system of [...systems])try{destroyWeather(system);}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Weather runtime cleanup failed');}};runtimes.add(runtime);return runtime;
}

return {kinds:GAL_WEATHERS,matrix:galWeatherMatrix,layers:galWeatherLayers,seed:galParticleSeed,step:galParticleStep,view:galParticleView,lightning:galLightningAt,create,dispose(){if(disposed)return;disposed=true;const errors=[];for(const runtime of [...runtimes])try{runtime.dispose();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Weather module cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageWeather};
