function createSpineRig({window,loadPixi:loadPixiRuntime,loadScript:forkLoadScript,files:getStageBundleFiles,fetch,URL,Blob,location,measure}) {
const {cache:figureCached,head:galEstimateHeadTop,alpha:measureFigureAlpha}=measure;
// Spine figures on the galgame stage.
// Runtime: pixi-spine 3.1 on the stage's pixi 6 (binary 3.8/4.0/4.1, JSON 3.7–4.1). It is under the Spine Runtimes
// License, so it is loaded only when a Spine figure enters the stage and is absent from public builds (the host then
// reports no Spine capability and those outfits fall down the appearance ladder).
// A Spine figure becomes a sprite-like "body": a container whose `texture` is the figure's measured frame and whose
// `anchor` is honoured, so the scene places, sizes and frames it with the same code as static sprites.
const SPINE_RUNTIME = "/api/dsh-tavern/vendor/runtime-assets/spine/pixi-spine.js";
let forkSpineRuntime = null;
function loadSpineRuntime() {
    if (window.PIXI && window.PIXI.spine && window.PIXI.spine.Spine) return Promise.resolve(window.PIXI.spine);
    if (forkSpineRuntime) return forkSpineRuntime;
    forkSpineRuntime = loadPixiRuntime()
        .then(() => forkLoadScript(SPINE_RUNTIME).catch(() => {
            throw new Error("Spine 运行库未安装，可在 设置 › DSH Tavern › 运行库 导入；暂用静态立绘。");
        }))
        .then(() => {
            const spine = window.PIXI && window.PIXI.spine;
            if (!spine || !spine.Spine || !spine.SpineParser || !spine.TextureAtlas) throw new Error("Spine 运行库不可用");
            return spine;
        })
        .catch(error => { forkSpineRuntime = null; throw error; });
    return forkSpineRuntime;
}
// Same rule as the asset library (asset-packs/spine.js): exact slot names, a trailing `*` is a prefix.
function spineSlotHidden(patterns, slot) {
    return (patterns || []).some(pattern => pattern.endsWith("*") ? slot.startsWith(pattern.slice(0, -1)) : slot === pattern);
}
// Skeleton, atlas and pages: the stage resource owner's borrowed files (decoded once, never fetched twice), else the
// lease tree's relative URLs (previews that use a server lease URL directly).
function spineSources(url) {
    const files = typeof getStageBundleFiles === "function" ? getStageBundleFiles(url) : null;
    const entry = files && Object.keys(files).find(key => files[key].url === url);
    if (entry) {
        const dir = entry.slice(0, entry.lastIndexOf("/") + 1), atlas = files[entry.replace(/\.(skel|json)$/i, ".atlas")];
        return { skeleton: url, binary: !/\.json$/i.test(entry), atlas: atlas ? atlas.url : "", page: name => files[dir + name] || null };
    }
    const clean = String(url).split(/[?#]/)[0];
    return { skeleton: url, binary: !/\.json$/i.test(clean), atlas: clean.replace(/\.(skel|json)$/i, ".atlas"), page: name => ({ url: new URL(name, new URL(url, location.href)).href }) };
}
// Files picked in the 素材库 importer (name → bytes, the skeleton `entry` at the root) as object URLs; close() revokes them.
function forkSpineLocalSource(files, entry) {
    const urls = new Map(), dir = entry.slice(0, entry.lastIndexOf("/") + 1);
    const url = name => {
        if (!files.has(name)) return "";
        if (!urls.has(name)) urls.set(name, URL.createObjectURL(new Blob([files.get(name)], { type: /\.webp$/i.test(name) ? "image/webp" : /\.png$/i.test(name) ? "image/png" : /\.jpe?g$/i.test(name) ? "image/jpeg" : "application/octet-stream" })));
        return urls.get(name);
    };
    return { skeleton: url(entry), binary: !/\.json$/i.test(entry), atlas: url(entry.replace(/\.(skel|json)$/i, ".atlas")), page: name => files.has(dir + name) ? { url: url(dir + name) } : null,
        close() { urls.forEach(value => URL.revokeObjectURL(value)); urls.clear(); } };
}
async function spineFetch(url, kind) {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error("资源读取失败");
    return kind === "bytes" ? new Uint8Array(await response.arrayBuffer()) : response.text();
}
// Resolves {data, textures}; the caller owns the textures (destroyed with the figure).
async function spineLoadData(url, source = spineSources(url)) {
    const runtime = await loadSpineRuntime(), PIXI = window.PIXI;
    if (!source.atlas) throw new Error("缺少 Spine 图集");
    const [atlasText, skeleton] = await Promise.all([spineFetch(source.atlas, "text"), spineFetch(source.skeleton, source.binary ? "bytes" : "text")]);
    const textures = [];
    try {
        const atlas = await new Promise((resolve, reject) => {
            let failed = null;
            const value = new runtime.TextureAtlas(atlasText, (name, done) => {
                const file = source.page(name);
                if (!file) { failed = new Error("缺少 Spine 图集页：" + name); done(null); return; }
                // A decoded owner image uploads directly; pixi-spine applies the atlas `pma` flag itself.
                const texture = new PIXI.BaseTexture(file.image || file.url);
                textures.push(texture);
                done(texture);
            }, result => result && !failed ? resolve(result) : reject(failed || new Error("Spine 图集无效")));
            if (!value.pages.length) reject(new Error("Spine 图集无效"));
        });
        const parser = new runtime.SpineParser();
        let data;
        try {
            data = source.binary ? parser.createBinaryParser().readSkeletonData(atlas, skeleton) : parser.createJsonParser().readSkeletonData(atlas, JSON.parse(skeleton));
        } catch (error) { throw new Error("无法读取 Spine 骨骼（支持 3.8 / 4.0 / 4.1）：" + (error && error.message || error)); }
        if (!data) throw new Error("无法读取 Spine 骨骼");
        // Pages decode asynchronously only on the URL path; the first frame needs their real size.
        await Promise.all(textures.map(texture => texture.valid ? null : new Promise(resolve => { texture.once("loaded", resolve); texture.once("error", resolve); })));
        return { data, textures };
    } catch (error) { textures.forEach(texture => texture.destroy()); throw error; }
}
// One stage figure: track 0 loops the emotion's animation (or the rest animation); track 1 plays the talk animation
// while the voice is audible and clears after a short silence.
function spineFigure(PIXI, loaded, config) {
    const spine = new PIXI.spine.Spine(loaded.data), data = loaded.data;
    spine.autoUpdate = false;
    const names = new Set(data.animations.map(animation => animation.name)), warned = new Set();
    const pick = (name, fallback) => {
        if (typeof name === "string" && names.has(name)) return name;
        if (name && !warned.has(name)) { warned.add(name); console.warn("[fork-spine] missing animation", name); }
        return fallback;
    };
    if (config.skin) {
        try { spine.skeleton.setSkinByName(config.skin); spine.skeleton.setSlotsToSetupPose(); }
        catch (_) { console.warn("[fork-spine] missing skin", config.skin); }
    }
    // Hidden scenery stays out of rendering and of the bounds (calculateBounds skips non-renderable children).
    spine.skeleton.slots.forEach((slot, index) => { if (spineSlotHidden(config.hideSlots, slot.data.name)) spine.slotContainers[index].renderable = false; });
    spine.stateData.defaultMix = 0.25;
    const rest = pick(config.defaultAnimation, data.animations[0] ? data.animations[0].name : null);
    if (rest) spine.state.setAnimation(0, rest, true);
    spine.update(0);
    const figure = {
        spine, rest, version: data.version, base: rest, talking: false, talkName: null, quietAt: 0,
        mood(animation) {
            const next = pick(animation, rest);
            if (next && next !== figure.base) { figure.base = next; spine.state.setAnimation(0, next, true); }
        },
        // level: the shared lip-sync loudness (0 in pauses); hysteresis keeps a word's syllables on one take.
        voice(level, talk, now) {
            const name = pick(talk, null);
            if (name && level > 0) {
                figure.quietAt = now;
                if (!figure.talking || figure.talkName !== name) { spine.state.setAnimation(1, name, true); figure.talking = true; figure.talkName = name; }
            } else if (figure.talking && (!name || now - figure.quietAt > 220)) {
                spine.state.setEmptyAnimation(1, 0.15); figure.talking = false; figure.talkName = null;
            }
        },
        update(seconds) { spine.update(seconds); },
        // Read-only debug view (forkGalDebug.stats): the animation each track is playing.
        debug() {
            const track = index => { const entry = spine.state.tracks[index]; return entry && entry.animation && entry.animation.name !== "<empty>" ? entry.animation.name : null; };
            return { version: figure.version, animation: track(0), talk: track(1), fade: figure.fade || null };
        },
        destroy() {
            if (!spine.destroyed) spine.destroy({ children: true });
            if (figure.fadeTexture) figure.fadeTexture.destroy(true);
            loaded.textures.forEach(texture => texture.destroy());
        }
    };
    return figure;
}
// Bottom alpha fade for a body its frame cuts off: a sprite mask in skeleton units,
// opaque down to `fade.start` and clear at `fade.end` (frame fractions, packSpineBottomFade). Sideways and above the
// frame the mask stays opaque, so hair or props outside the frame still show. Applied after measuring the rest pose.
function spineBottomFade(PIXI, figure, frame, fade) {
    const [x, y, w, h] = frame, top = y - h, bottom = y + fade.end * h, rows = 512;
    const from = Math.min(1, Math.max(0, (y + fade.start * h - top) / (bottom - top)));
    // White with a falling alpha: the mask reads the same whether the upload premultiplies it or not.
    const pixels = new Uint8Array(rows * 4);
    for (let row = 0; row < rows; row++) {
        const t = row / (rows - 1), k = t <= from ? 1 : Math.max(0, 1 - (t - from) / Math.max(1e-6, 1 - from));
        pixels.set([255, 255, 255, Math.round(255 * k * k * (3 - 2 * k))], row * 4);
    }
    const texture = PIXI.Texture.fromBuffer(pixels, 1, rows), mask = new PIXI.Sprite(texture);
    mask.position.set(x - w, top); mask.width = 3 * w; mask.height = bottom - top;
    figure.spine.addChild(mask); figure.spine.mask = mask; figure.fadeTexture = texture; figure.fade = fade;
}
// Display frame [x, y, w, h] in the runtime's y-down skeleton units: authored, else the rest pose's visible bounds.
function spineFrame(spine, frame) {
    if (Array.isArray(frame) && frame.length === 4) return frame.slice();
    const bounds = spine.getLocalBounds();
    const x = Math.floor(bounds.x), y = Math.floor(bounds.y);
    return [x, y, Math.max(1, Math.ceil(bounds.x + bounds.width) - x), Math.max(1, Math.ceil(bounds.y + bounds.height) - y)];
}
// Rest-pose ink of the visible slots, rendered once (≤1024 px) like a pack Live2D rest pose. Cached by content identity.
function spineMeasure(spine, frame, identity, renderer, PIXI) {
    return figureCached(identity + ":spine-rest-alpha-v1", function () {
        let texture;
        try {
            texture = renderer.generateTexture(spine, { region: new PIXI.Rectangle(frame[0], frame[1], frame[2], frame[3]), resolution: Math.min(1, 1024 / Math.max(frame[2], frame[3])) });
            const pixels = renderer.plugins.extract.canvas(texture), ctx = pixels.getContext("2d");
            const rgba = ctx.getImageData(0, 0, pixels.width, pixels.height).data;
            return { headTop: galEstimateHeadTop(rgba, pixels.width, pixels.height), candidate: { sourceSha: identity, canvas: [frame[2], frame[3]], status: "pending",
                auto: measureFigureAlpha(rgba, pixels.width, pixels.height, [frame[2], frame[3]]) } };
        } catch (_) { return { headTop: 0, candidate: { sourceSha: identity, status: "pending", auto: { invalid: true, warnings: ["spine-rest-alpha-unavailable"] } } }; }
        finally { if (texture) texture.destroy(true); }
    });
}
// The sprite-like body: texture = frame size, anchor in frame fractions (same meaning as a PIXI.Sprite anchor).
function spineBody(PIXI, spine, frame) {
    const body = new PIXI.Container();
    body.texture = { width: frame[2], height: frame[3] };
    body.anchor = new PIXI.ObservablePoint(() => spine.position.set(-frame[0] - body.anchor.x * frame[2], -frame[1] - body.anchor.y * frame[3]), null, 0.5, 1);
    spine.position.set(-frame[0] - 0.5 * frame[2], -frame[1] - frame[3]);
    body.addChild(spine);
    return body;
}

return {loadSpineRuntime,spineSources,forkSpineLocalSource,spineLoadData,spineFigure,spineBottomFade,spineFrame,spineMeasure,spineBody};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createSpineRig};
