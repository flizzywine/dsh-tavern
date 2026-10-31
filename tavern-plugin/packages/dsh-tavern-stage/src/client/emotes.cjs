function createStageEmotes({document,ease:galEase,clamp:galClamp01,canvasTexture:galCanvasTexture,colors}) {
let disposed=false;const runtimes=new Set();
const {mix:galColorMix,css:galCssColor,hex:galHex}=colors;
const GAL_EMOTES = ["!", "?", "...", "sweat", "anger", "heart", "note", "gloom", "sparkle", "tear"];
// Emotes: parts of each (relative offsets and sizes in emote units, staggered delays).
function galEmoteParts(kind) {
    if (kind === "...") return [{ art: "dot", x: -0.34, y: 0, size: 0.34, delay: 0 }, { art: "dot", x: 0, y: 0, size: 0.34, delay: 150 }, { art: "dot", x: 0.34, y: 0, size: 0.34, delay: 300 }];
    if (kind === "sparkle") return [{ art: "star", x: 0, y: 0, size: 1, delay: 0 }, { art: "star", x: 0.62, y: -0.42, size: 0.55, delay: 110 }, { art: "star", x: -0.5, y: 0.36, size: 0.42, delay: 220 }];
    if (kind === "note") return [{ art: "note", x: 0, y: 0, size: 1, delay: 0 }, { art: "note", x: 0.62, y: -0.38, size: 0.66, delay: 200 }];
    // The comic tear: a drop from the eye's corner, a smaller one after it.
    if (kind === "tear") return [{ art: "tear", x: 0, y: 0, size: 1, delay: 0 }, { art: "tear", x: 0.12, y: -0.08, size: 0.68, delay: 520 }];
    const art = { "!": "bang", "?": "question", sweat: "drop", anger: "vein", heart: "heart", gloom: "gloom" }[kind];
    return art ? [{ art, x: 0, y: 0, size: 1, delay: 0 }] : [];
}
// Where an emote sits for a head { x, top, chin, width } (pixels): { x, y, size, spread }; spread is the
// part offset unit.
function galEmoteAnchor(kind, head, W) {
    const hh = Math.max(1, head.chin - head.top), side = head.x > W * 0.78 ? -1 : 1;
    const at = (dx, dy, size) => ({ x: head.x + side * head.width * dx, y: head.top + hh * dy, size: hh * size, spread: hh * size, side });
    if (kind === "anger") return at(0.46, 0.14, 0.46);
    if (kind === "sweat") return at(0.52, 0.32, 0.4);
    // The tear starts at the outer corner of the eye on the open side and runs down the cheek.
    if (kind === "tear") return at(0.3, 0.5, 0.3);
    if (kind === "gloom") return Object.assign(at(0, 0.02, 0.78), { x: head.x });
    if (kind === "...") return at(0.5, -0.16, 0.62);
    return at(0.62, -0.04, 0.6);
}
// An emote part at ms (after its delay): scale, alpha, dy (emote units, + is down), rotation.
const GAL_EMOTE_MS = 1800;
function galEmoteAt(kind, ms) {
    const frame = { scale: 0, alpha: 0, dy: 0, rotation: 0, done: ms >= GAL_EMOTE_MS };
    if (ms < 0 || frame.done) return frame;
    const t = ms / 1000, E = galEase;
    // Springy pop: overshoots to ~1.2, settles by ~0.45 s.
    frame.scale = 1 - Math.exp(-t * 9) * Math.cos(t * 17);
    frame.alpha = ms < 1400 ? Math.min(1, t / 0.06) : 1 - E.inOutSine((ms - 1400) / 400);
    frame.dy = -0.22 * E.outCubic(Math.min(1, t / 1.8));
    if (kind === "sweat") { frame.scale = Math.min(1, frame.scale); frame.dy = 0.4 * E.inQuad(Math.min(1, t / 1.8)); }
    else if (kind === "tear") { frame.scale = Math.min(1, frame.scale); frame.dy = 1.1 * E.inQuad(Math.min(1, t / 1.3)); }
    else if (kind === "gloom") { frame.scale = 1; frame.alpha *= Math.min(1, t / 0.35); frame.dy = 0.12 * E.outCubic(Math.min(1, t / 1.8)); }
    else if (kind === "heart") { if (t > 0.45) frame.scale *= 1 + 0.09 * Math.max(0, Math.sin(2 * Math.PI * 2.2 * (t - 0.45))); }
    else if (kind === "anger") { if (t > 0.4) frame.scale *= 1 + 0.1 * Math.max(0, Math.sin(2 * Math.PI * 3 * (t - 0.4))); }
    else if (kind === "note") { frame.rotation = 0.2 * Math.sin(2 * Math.PI * 1.4 * t); frame.dy = -0.42 * Math.min(1, t / 1.8); }
    else if (kind === "sparkle") { frame.scale *= 0.82 + 0.18 * Math.sin(2 * Math.PI * 3 * t); frame.rotation = 0.3 * t; }
    else if (kind === "!") frame.rotation = 0.14 * Math.exp(-t * 7) * Math.sin(t * 42);
    else if (kind === "?") frame.rotation = -0.1 + 0.08 * Math.sin(2 * Math.PI * 0.8 * t);
    return frame;
}
function galEmotePlacement(kind, head, anchor, part, frame) {
    // Marks on the face (anger, sweat, tear) turn with the head.
    const attached = kind === "anger" || kind === "sweat" || kind === "tear";
    const rotation = attached ? head.rotation || 0 : 0, c = Math.cos(rotation), s = Math.sin(rotation);
    const cx = head.x, cy = (head.top + head.chin) / 2;
    const x = anchor.x + part.x * anchor.spread * anchor.side - cx;
    const y = anchor.y + part.y * anchor.spread + frame.dy * anchor.size - cy;
    return { x: cx + x * c - y * s, y: cy + x * s + y * c, rotation: rotation + frame.rotation * anchor.side };
}
// Canonical hue an emote leans towards when tinted with the character colour (sweat and tear stay watery,
// anger red); null: the character colour itself.
const GAL_EMOTE_HUES = { sweat: [0x6fb8ff, 0.7], tear: [0x7cc8ff, 0.82], anger: [0xff3048, 0.72], heart: [0xff5a8c, 0.45], gloom: [0x3c2c58, 0.7] };
function galEmoteColor(kind, color) {
    const hue = GAL_EMOTE_HUES[kind];
    const base = typeof color === "number" && isFinite(color) ? color : 0xf06aa0;
    return hue ? galColorMix(base, hue[0], hue[1]) : base;
}
// Emote art: sticker style (soft shadow, thick white outline, colour fill, highlight) on a square canvas
// of side S. color: 0xRRGGBB.
function galEmoteArt(ctx, art, color, S) {
    const fill = galHex(color);
    const deep = galHex(galColorMix(color, 0x000000, 0.35));
    const outline = S * 0.075;
    const sticker = function (path, options) {
        options = options || {};
        ctx.save();
        ctx.lineJoin = "round"; ctx.lineCap = "round";
        ctx.shadowColor = "rgba(20,10,30,.35)"; ctx.shadowBlur = S * 0.05; ctx.shadowOffsetY = S * 0.02;
        ctx.strokeStyle = "#fff"; ctx.lineWidth = outline * 2 + (options.stroke || 0);
        path(); ctx.stroke();
        ctx.shadowColor = "transparent";
        if (options.stroke) { ctx.strokeStyle = fill; ctx.lineWidth = options.stroke; path(); ctx.stroke(); }
        else {
            const g = ctx.createLinearGradient(0, S * 0.1, 0, S * 0.9);
            g.addColorStop(0, galHex(galColorMix(color, 0xffffff, 0.22))); g.addColorStop(1, deep);
            ctx.fillStyle = g; path(); ctx.fill();
        }
        ctx.restore();
    };
    if (art === "bang" || art === "question") {
        ctx.save();
        ctx.translate(S / 2, S / 2); ctx.rotate(art === "bang" ? -0.12 : 0.08); ctx.translate(-S / 2, -S / 2);
        ctx.font = "900 " + Math.round(S * 0.8) + "px \"Segoe UI Black\", \"Arial Black\", \"Microsoft YaHei\", sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const glyph = art === "bang" ? "!" : "?";
        ctx.lineJoin = "round";
        ctx.shadowColor = "rgba(20,10,30,.35)"; ctx.shadowBlur = S * 0.05; ctx.shadowOffsetY = S * 0.02;
        ctx.strokeStyle = "#fff"; ctx.lineWidth = outline * 2.2; ctx.strokeText(glyph, S / 2, S * 0.54);
        ctx.shadowColor = "transparent";
        const g = ctx.createLinearGradient(0, S * 0.15, 0, S * 0.9);
        g.addColorStop(0, galHex(galColorMix(color, 0xffffff, 0.2))); g.addColorStop(1, deep);
        ctx.fillStyle = g; ctx.fillText(glyph, S / 2, S * 0.54);
        ctx.restore();
    } else if (art === "dot") {
        sticker(() => { ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.26, 0, Math.PI * 2); });
    } else if (art === "drop") {
        sticker(function () {
            ctx.beginPath(); ctx.moveTo(S * 0.5, S * 0.12);
            ctx.bezierCurveTo(S * 0.56, S * 0.3, S * 0.76, S * 0.46, S * 0.76, S * 0.64);
            ctx.arc(S * 0.5, S * 0.64, S * 0.26, 0, Math.PI, false);
            ctx.bezierCurveTo(S * 0.24, S * 0.46, S * 0.44, S * 0.3, S * 0.5, S * 0.12);
            ctx.closePath();
        });
        ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.beginPath(); ctx.ellipse(S * 0.4, S * 0.62, S * 0.05, S * 0.1, -0.4, 0, Math.PI * 2); ctx.fill();
    } else if (art === "vein") {
        sticker(function () {
            ctx.beginPath();
            for (let q = 0; q < 4; q++) {
                const a = q * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
                const p = (x, y) => [S / 2 + (x * c - y * s) * S, S / 2 + (x * s + y * c) * S];
                const [x0, y0] = p(-0.38, -0.1), [cx, cy] = p(-0.1, -0.1), [x1, y1] = p(-0.1, -0.38);
                ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1);
            }
        }, { stroke: S * 0.11 });
    } else if (art === "heart") {
        sticker(function () {
            ctx.beginPath(); ctx.moveTo(S * 0.5, S * 0.84);
            ctx.bezierCurveTo(S * 0.12, S * 0.6, S * 0.08, S * 0.34, S * 0.22, S * 0.24);
            ctx.bezierCurveTo(S * 0.36, S * 0.14, S * 0.48, S * 0.22, S * 0.5, S * 0.34);
            ctx.bezierCurveTo(S * 0.52, S * 0.22, S * 0.64, S * 0.14, S * 0.78, S * 0.24);
            ctx.bezierCurveTo(S * 0.92, S * 0.34, S * 0.88, S * 0.6, S * 0.5, S * 0.84);
            ctx.closePath();
        });
        ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.beginPath(); ctx.ellipse(S * 0.3, S * 0.34, S * 0.06, S * 0.035, -0.6, 0, Math.PI * 2); ctx.fill();
    } else if (art === "note") {
        sticker(function () {
            ctx.beginPath();
            ctx.ellipse(S * 0.38, S * 0.72, S * 0.16, S * 0.115, -0.45, 0, Math.PI * 2);
            ctx.moveTo(S * 0.5, S * 0.7); ctx.lineTo(S * 0.52, S * 0.14);
            ctx.lineTo(S * 0.56, S * 0.14);
            ctx.bezierCurveTo(S * 0.6, S * 0.26, S * 0.82, S * 0.28, S * 0.74, S * 0.5);
            ctx.bezierCurveTo(S * 0.72, S * 0.36, S * 0.62, S * 0.32, S * 0.56, S * 0.3);
            ctx.lineTo(S * 0.55, S * 0.7); ctx.closePath();
        });
    } else if (art === "gloom") {
        ctx.save(); ctx.lineCap = "round";
        const lines = [[0.2, 0.52], [0.34, 0.74], [0.5, 0.86], [0.66, 0.72], [0.8, 0.5]];
        [["rgba(255,255,255,.55)", S * 0.075], [fill, S * 0.035]].forEach(function ([style, width]) {
            ctx.strokeStyle = style; ctx.lineWidth = width;
            lines.forEach(function ([x, len]) {
                ctx.beginPath(); ctx.moveTo(S * x, S * 0.08);
                for (let y = 0.08; y <= len; y += 0.04) ctx.lineTo(S * (x + 0.018 * Math.sin(y * 28)), S * y);
                ctx.stroke();
            });
        });
        ctx.restore();
    } else if (art === "star") {
        sticker(function () {
            ctx.beginPath(); ctx.moveTo(S * 0.5, S * 0.06);
            ctx.quadraticCurveTo(S * 0.56, S * 0.44, S * 0.94, S * 0.5);
            ctx.quadraticCurveTo(S * 0.56, S * 0.56, S * 0.5, S * 0.94);
            ctx.quadraticCurveTo(S * 0.44, S * 0.56, S * 0.06, S * 0.5);
            ctx.quadraticCurveTo(S * 0.44, S * 0.44, S * 0.5, S * 0.06);
            ctx.closePath();
        });
    } else if (art === "tear") {
        // A slim comic drop (narrower and longer than sweat) with a bright glint.
        sticker(function () {
            ctx.beginPath(); ctx.moveTo(S * 0.5, S * 0.08);
            ctx.bezierCurveTo(S * 0.54, S * 0.3, S * 0.68, S * 0.5, S * 0.68, S * 0.68);
            ctx.arc(S * 0.5, S * 0.68, S * 0.18, 0, Math.PI, false);
            ctx.bezierCurveTo(S * 0.32, S * 0.5, S * 0.46, S * 0.3, S * 0.5, S * 0.08);
            ctx.closePath();
        });
        ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.beginPath(); ctx.ellipse(S * 0.44, S * 0.66, S * 0.035, S * 0.075, -0.35, 0, Math.PI * 2); ctx.fill();
    }
}
// The whole emote composed on one canvas (face window, DOM): data URL, cached per kind and colour.
const galEmoteUrls = new Map();
function galEmoteDataUrl(kind, color) {
    if(disposed)return null;
    const key = kind + ":" + color;
    if (galEmoteUrls.has(key)) return galEmoteUrls.get(key);
    // 512 px: crisp in the face window at 4K (stage-effects.md §6).
    const S = 512, canvas = document.createElement("canvas");
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext("2d");
    const tint = galEmoteColor(kind, color);
    galEmoteParts(kind).forEach(function (part) {
        const size = S * 0.62 * part.size;
        const sub = document.createElement("canvas");
        sub.width = sub.height = Math.round(size);
        galEmoteArt(sub.getContext("2d"), part.art, tint, sub.width);
        const spread = S * 0.62;
        ctx.drawImage(sub, S / 2 + part.x * spread - size / 2, S / 2 + part.y * spread - size / 2, size, size);
    });
    const url = canvas.toDataURL("image/png");
    if (galEmoteUrls.size > 40) galEmoteUrls.clear();
    galEmoteUrls.set(key, url);
    return url;
}

function create(env){
 if(disposed)throw new Error('Emote module is disposed');
 const {PIXI}=env,textures=new Map();let emotes=[],dead=false;
    function emoteTexture(art, color) {
        const key = art + ":" + color;
        let texture = textures.get(key);
        if (!texture) {
            // 512 px: a manpu stays crisp at 4K (stage-effects.md §6).
            texture = galCanvasTexture(PIXI, 512, 512, (ctx, w) => galEmoteArt(ctx, art, color, w));
            textures.set(key, texture);
        }
        return texture;
    }
    function addEmote(effect, now) {
        if(dead)return false;
        const kind = GAL_EMOTES.includes(effect.value) ? effect.value : "";
        if (!kind || !effect.id) return false;
        const head = env.headOf(effect.id);
        if (!head) return false;
        const color = galEmoteColor(kind, galCssColor(effect.color));
        const box = new PIXI.Container();
        let parts;
        try{parts = galEmoteParts(kind).map(function (part) {
            const item = new PIXI.Sprite(emoteTexture(part.art, color));
            item.anchor.set(0.5); item.alpha = 0;
            box.addChild(item);
            return Object.assign({ sprite: item }, part);
        });
        }catch(error){box.destroy({children:true});throw error;}
        // A second emote on the same figure replaces the first.
        emotes.filter(item => item.id === effect.id).forEach(item => { item.fadeFrom = now; });
        env.emotes.addChild(box);
        emotes.push({ id: effect.id, kind, start: now, box, parts, fadeFrom: null });
        return true;
    }
    function tickEmotes(now, W) {
        if(dead)return;
        emotes = emotes.filter(function (emote) {
            const head = env.headOf(emote.id);
            if (head) emote.head = head;
            if (!head && emote.fadeFrom == null) emote.fadeFrom = now;
            const fade = emote.fadeFrom != null ? 1 - galClamp01((now - emote.fadeFrom) / 180) : 1;
            if (!emote.head || fade <= 0) { emote.box.destroy({ children: true }); return false; }
            const anchor = galEmoteAnchor(emote.kind, emote.head, W);
            let done = true;
            emote.parts.forEach(function (part) {
                const f = galEmoteAt(emote.kind, now - emote.start - part.delay);
                if (!f.done) done = false;
                const size = anchor.size * part.size;
                const texture = part.sprite.texture;
                const placement = galEmotePlacement(emote.kind, emote.head, anchor, part, f);
                part.sprite.position.set(placement.x, placement.y);
                part.sprite.scale.set(size / texture.width * f.scale * (emote.kind === "note" && anchor.side < 0 ? -1 : 1), size / texture.height * f.scale);
                part.sprite.rotation = placement.rotation;
                part.sprite.alpha = f.alpha * fade;
            });
            if (done) { emote.box.destroy({ children: true }); return false; }
            return true;
        });
    }

const runtime={add:addEmote,tick:tickEmotes,stats:()=>({emotes:emotes.map(emote=>emote.id+':'+emote.kind),textures:textures.size}),dispose(){
 if(dead)return;dead=true;runtimes.delete(runtime);const errors=[];
 for(const cleanup of [...emotes.map(emote=>()=>emote.box.destroy({children:true})),...[...textures.values()].map(texture=>()=>texture.destroy(true))])try{cleanup();}catch(error){errors.push(error);}
 emotes=[];textures.clear();if(errors.length)throw new AggregateError(errors,'Emote runtime cleanup failed');
}};runtimes.add(runtime);return runtime;
}

return {parts:galEmoteParts,anchor:galEmoteAnchor,frame:galEmoteAt,placement:galEmotePlacement,color:galEmoteColor,dataUrl:galEmoteDataUrl,create,dispose(){if(disposed)return;disposed=true;galEmoteUrls.clear();const errors=[];for(const runtime of [...runtimes])try{runtime.dispose();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Emote module cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageEmotes};
