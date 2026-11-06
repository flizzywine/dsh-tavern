function createStageSceneGraphics({window,document,paintEmpty:stagePaintEmpty,emptyPalette:stageEmptyPalette}) {
// Ordered, named filter slots on one container: set(name, filter) adds or replaces (null removes);
// disabled filters (filter.enabled = false) are skipped; no filters at all means no render pass.
// order: slot names in render order (unlisted names go last, in insertion order).
// singleSample: the chain's filters render without MSAA (a figure's: see the scene's tune()).
function galFilterChain(container, area, order, singleSample) {
    const slots = [];
    let signature = "";
    const rank = name => { const at = order ? order.indexOf(name) : -1; return at < 0 ? 1e6 : at; };
    const chain = {
        container,
        set(name, filter, options) {
            const at = slots.findIndex(slot => slot.name === name);
            if (at >= 0) slots.splice(at, 1);
            if (filter) {
                if (singleSample) { filter.forkSingleSample = true; filter.multisample = window.PIXI.MSAA_QUALITY.NONE; }
                const before = options && options.before ? slots.findIndex(slot => slot.name === options.before) : slots.findIndex(slot => rank(slot.name) > rank(name));
                if (before >= 0) slots.splice(before, 0, { name, filter }); else slots.push({ name, filter });
            }
            chain.refresh(true);
            return filter;
        },
        get(name) { const slot = slots.find(item => item.name === name); return slot ? slot.filter : null; },
        all() { return slots.map(slot => slot.filter); },
        refresh(force) {
            const active = slots.filter(slot => slot.filter.enabled !== false);
            const next = active.map(slot => slot.name).join(",");
            if (!force && next === signature) return;
            signature = next;
            container.filters = active.length ? active.map(slot => slot.filter) : null;
            if (area) container.filterArea = active.length ? area : null;
        }
    };
    return chain;
}
// A filter created on first use (make), disabled while inactive and destroyed after 3 s idle, so effects
// that are off cost nothing. store: { [key]: slot }; returns the live filter or null.
function galUseFilter(store, chain, name, make, active, now, tune) {
    let slot = store[name];
    if (active) {
        if (!slot) {
            let filter = null;
            try { filter = make(); } catch (error) { console.warn("[fork-gal-scene] filter", name, error); }
            if (!filter) return null;
            try { tune(filter); }
            catch (error) { filter.destroy(); throw error; }
            slot = store[name] = { chain, name, filter, idle: now };
            chain.set(name, filter);
        }
        slot.idle = now;
        if (slot.filter.enabled === false) { slot.filter.enabled = true; chain.refresh(); }
        return slot.filter;
    }
    if (slot) {
        if (slot.filter.enabled !== false) { slot.filter.enabled = false; chain.refresh(); }
        if (now - slot.idle > 3000 || now < slot.idle) { chain.set(name, null); slot.filter.destroy(); delete store[name]; }
    }
    return null;
}

// Generated textures: vignette, the empty stage gradient and the transition mask shapes.
function galCanvasTexture(PIXI, width, height, paint) {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    paint(canvas.getContext("2d"), width, height);
    return PIXI.Texture.from(canvas);
}
function galMakeTextures(PIXI, host) {
    const made=[];
    const create=(...args)=>{const texture=galCanvasTexture(...args);made.push(texture);return texture;};
    try {return {
        vignette: create(PIXI, 640, 360, function (ctx, w, h) {
            ctx.save(); ctx.translate(w / 2, h * 0.4); ctx.scale(1.2, 1);
            const radial = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.hypot(w / 2, h * 0.6) / 1.2);
            radial.addColorStop(0, "rgba(0,0,0,0)"); radial.addColorStop(0.55, "rgba(0,0,0,0)"); radial.addColorStop(1, "rgba(0,0,0,.45)");
            ctx.fillStyle = radial; ctx.fillRect(-w, -h, w * 2, h * 2); ctx.restore();
            const floor = ctx.createLinearGradient(0, 0, 0, h);
            floor.addColorStop(0.58, "rgba(8,5,14,0)"); floor.addColorStop(1, "rgba(8,5,14,.55)");
            ctx.fillStyle = floor; ctx.fillRect(0, 0, w, h);
        }),
        empty: create(PIXI, 640, 360, function (ctx, w, h) {
            stagePaintEmpty(ctx, w, h, stageEmptyPalette(host));
        }),
        wipe: create(PIXI, 1024, 4, function (ctx, w, h) {
            const edge = ctx.createLinearGradient(0, 0, w, 0);
            edge.addColorStop(0, "rgba(255,255,255,1)"); edge.addColorStop(1 / 1.25, "rgba(255,255,255,1)"); edge.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h);
        }),
        iris: create(PIXI, 512, 512, function (ctx, w, h) {
            const disc = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
            disc.addColorStop(0, "rgba(255,255,255,1)"); disc.addColorStop(0.78, "rgba(255,255,255,1)"); disc.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = disc; ctx.fillRect(0, 0, w, h);
        })
    };}catch(error){
        const errors=[error];for(const texture of made)try{texture.destroy(true);}catch(cleanup){errors.push(cleanup);}
        if(errors.length>1)throw new AggregateError(errors,'Scene texture construction failed');throw error;
    }
}




return {filters:galFilterChain,useFilter:galUseFilter,canvasTexture:galCanvasTexture,textures:galMakeTextures};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageSceneGraphics};
