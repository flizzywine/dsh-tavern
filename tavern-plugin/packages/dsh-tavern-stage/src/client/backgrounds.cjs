function createStageBackgrounds({layers,matrix:galMatrix,ease:galEase,clamp:galClamp01,transition:galBackgroundTransition,correction:galLayerCorrection,timeGrade:galTimeGrade}) {
let disposed=false;const scenes=new Set();
function create({PIXI,screen,container,generated,tune,loadTexture,warn:recordAssetWarning}) {
    if(disposed)throw new Error('Background owner disposed');
    let latest={},currentRegistry={},sequence=0;
    const describe=()=>latest,registryOf=()=>currentRegistry;
    const state={layers:[],bg:{target:null,pending:''},grade:{name:null,start:0,duration:0,current:null,version:0},clock:0,destroyed:false};
    // ---- backdrop
    function startLayer(url, texture, kind, grade, now) {
        const desc = describe();
        const previous = state.layers[state.layers.length - 1];
        const plan = galBackgroundTransition(kind, desc, previous);
        const time=url&&desc.background?desc.background.time||'':'';
        const layer=layers.create({PIXI,screen:screen,container:container,generated,tune,url,texture,plan,
            identity:desc.background?.identity,scene:desc.background?.scene,time,now,grade,version:registryOf().version,
            correction:desc.packLayers?.backgroundGrade||galLayerCorrection(registryOf(),grade,time)});
        state.layers.push(layer);
        // The figures' grade travels with the picture: it changes during the transition, not before it.
        const duration = desc.snap ? 0 : describe().timeFadeMs === 2500 ? 2500 : plan.kind === "black" || plan.kind === "white" ? 0 : Math.max(plan.duration, 360);
        const gradeStart = plan.split ? now + plan.duration * plan.split[0] : plan.kind === "black" ? now + plan.duration * 0.42 : plan.kind === "white" ? now + plan.duration * 0.36 : now;
        setGrade(grade, gradeStart, state.layers.length === 1 ? 0 : duration);
        layer.paint(now);
        return layer;
    }
    function setStandIn(layer,grade,now,duration) {
        layer.setCorrection(describe().packLayers?.backgroundGrade||galLayerCorrection(registryOf(),grade,layer.time),grade,registryOf().version,now,duration);
    }
    function update(desc,registry,now) {
        if(state.destroyed)return;
        latest=desc;currentRegistry=registry;state.clock=now;
        const gradeMs = desc.snap ? 0 : desc.timeFadeMs === 2500 ? 2500 : 1200;
        const background = desc.background || null;
        const url = background && background.url || "", identity = background?.identity;
        // an initial scene.clear still needs the empty backdrop that releases figure entry.
        if (state.bg.target === null || background?.identity !== state.bg.identity || !background && state.bg.target) {
            const request=++sequence;
            state.bg.identity = background?.identity; state.bg.failed = false;
            state.bg.target = url;
            const kind = background && background.transition || "fade", grade = desc.grade || "";
            const top = state.layers[state.layers.length - 1];
            if (top && top.url && top.identity === background?.identity) { state.bg.pending = ""; top.time = background && background.time || ""; setGrade(grade, now, gradeMs); setStandIn(top, grade, now, gradeMs); }
            else if (!url) { state.bg.pending = ""; startLayer("", generated.empty, kind, grade, now); }
            else {
                state.bg.pending = url;
                loadTexture(url).then(function (texture) {
                    if (state.destroyed || request!==sequence || state.bg.identity !== identity) return;
                    state.bg.pending = "";
                    startLayer(url, texture, kind, describe().grade || "", state.clock);
                }, function (error) {
                    if (state.destroyed || String(error && error.message) === "cancelled") return;
                    if (request!==sequence || state.bg.identity !== identity) return;
                    state.bg.pending = ""; state.bg.failed = true;
                    if (typeof recordAssetWarning === "function") recordAssetWarning({ code: "missing-asset", module: "backgrounds", url });
                    // a failed candidate never removes the last-good background.
                });
            }
        } else if (!state.bg.pending && ((desc.grade || "") !== state.grade.name || registryOf().version !== state.grade.version0)) {
            setGrade(desc.grade || "", now, gradeMs);
            const top = state.layers[state.layers.length - 1];
            if (top) { top.time = background && background.time || ""; setStandIn(top, desc.grade || "", now, gradeMs); }
        }
    }
    function paint(now) {
        if(state.destroyed)return {coverAlpha:0,coverColor:0,lidsShut:0,barsIn:0,barsOut:false,pruned:false};
        let pruned=false;
        let coverAlpha = 0, coverColor = 0, lidsShut = 0, barsIn = 0, barsOut = false;
        for (let i = 0; i < state.layers.length; i++) {
            const layer = state.layers[i];
            const frame = layer.paint(now);
            if (!frame) continue;
            if (frame.cover > coverAlpha) { coverAlpha = frame.cover; coverColor = frame.color; }
            if (frame.lids > lidsShut) lidsShut = frame.lids;
            if (frame.bars > barsIn) { barsIn = frame.bars; barsOut = frame.out; }
            if (frame.done) {
                layer.finish();
                // Everything under a finished layer is hidden: release it.
                state.layers.splice(0, i).forEach(layer=>layer.destroy());
                i = 0;
                pruned=true;
            }
        }
        tickGrade(now);
        return {coverAlpha,coverColor,lidsShut,barsIn,barsOut,pruned};
    }
    // The figures' time grade blends from whatever is on screen now (also mid-blend) to the new one.
    // The looks arriving (or reloading) re-grade to the same name with the new matrices.
    function setGrade(name, start, duration) {
        const grade = state.grade, version = registryOf().version;
        if (grade.name === name && grade.version0 === version) return;
        grade.from = grade.current || galMatrix.identity(); grade.to = describe().packLayers?.figureGrade || galTimeGrade(registryOf(), name).grade; grade.start = start; grade.duration = duration; grade.name = name; grade.version0 = version;
    }
    function tickGrade(now) {
        const grade = state.grade;
        if (!grade.to) return;
        const t = grade.duration > 0 ? galClamp01((now - grade.start) / grade.duration) : now >= grade.start ? 1 : 0;
        const next = galMatrix.mix(grade.from, grade.to, galEase.inOutSine(t));
        if (!grade.current || next.some((value, i) => Math.abs(value - grade.current[i]) > 1e-4)) { grade.current = next; grade.version++; }
    }


    const api={update,paint,restart(layer,kind,grade,now){if(state.destroyed)return null;return startLayer(layer.url,layer.texture,kind,grade,now);},
        get layers(){return state.layers.slice();},get pending(){return state.bg.pending;},get grade(){return {...state.grade};},
        dispose(){if(state.destroyed)return;state.destroyed=true;sequence++;scenes.delete(api);const errors=[];for(const layer of state.layers.splice(0))try{layer.destroy();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Background cleanup failed');}};
    scenes.add(api);return api;
}
return {create,dispose(){if(disposed)return;disposed=true;const errors=[];for(const scene of [...scenes])try{scene.dispose();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Background scenes cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageBackgrounds};
