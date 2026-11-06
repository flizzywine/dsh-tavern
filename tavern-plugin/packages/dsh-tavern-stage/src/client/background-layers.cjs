function createStageBackgroundLayers({matrix,ease,clamp,cover,transitionFrame,wipeRect,irisSize}) {
let disposed=false;const layers=new Set();
function create({PIXI,screen,container,generated,tune,url,texture,plan,identity,scene,time,now,correction,grade,version}) {
    if(disposed)throw new Error('Background layers disposed');
    const sprite=new PIXI.Sprite(texture);
    const layer={identity,url,scene,time,texture,sprite,plan,start:now,mask:null,owned:url!=='',standIn:null,correction:null};
    let closed=false;
    function setCorrection(to,grade,version,now,duration) {
        if(closed)return;
        const from=layer.standIn?layer.standIn.current:to;
        layer.standIn={grade,from,to,start:now,duration,current:from,settled:false,version};
    }
    function paintStandIn(layer, now) {
        const s = layer.standIn;
        if (s.settled) return;
        const t = s.duration > 0 ? clamp((now - s.start) / s.duration) : 1;
        s.current = matrix.mix(s.from, s.to, ease.inOutSine(t));
        s.settled = t >= 1;
        if (matrix.isIdentity(s.current)) { if (layer.correction) { layer.sprite.filters = null; layer.correction.destroy(); layer.correction = null; } return; }
        if (!layer.correction) { layer.correction = tune(new PIXI.filters.ColorMatrixFilter()); layer.sprite.filters = [layer.correction]; }
        layer.correction.matrix = s.current.slice();
    }
    function paintLayer(layer, now) {
        const W = screen.width, H = screen.height;
        paintStandIn(layer, now);
        const texture = layer.sprite.texture;
        const settle = 1 + 0.03 * (1 - ease.outCubic(clamp((now - layer.start) / 8000)));
        const fit = cover(texture.width, texture.height, W, H, 1.04 * settle);
        layer.sprite.scale.set(fit.scale); layer.sprite.position.set(fit.x, fit.y);
        let frame = null;
        if (layer.plan) {
            frame = transitionFrame(layer.plan, layer.plan.duration ? (now - layer.start) / layer.plan.duration : 1);
            layer.sprite.alpha = frame.incoming;
            if (layer.mask && frame.mask >= 0) {
                if (layer.plan.kind === "wipe") {
                    const rect = wipeRect(frame.mask, W, 0.25, layer.plan.direction);
                    layer.mask.position.set(rect.x, -H * 0.1);
                    layer.mask.scale.set(rect.flip * rect.width / generated.wipe.width, H * 1.2 / generated.wipe.height);
                } else {
                    const cx = W / 2, cy = H * 0.42, size = Math.max(1, irisSize(frame.mask, W, H, cx, cy, 0.78));
                    layer.mask.position.set(cx, cy); layer.mask.width = size; layer.mask.height = size;
                }
            }
        } else layer.sprite.alpha = 1;
        return frame;
    }

    function finish(){if(closed)return;layer.plan=null;if(layer.mask){layer.sprite.mask=null;layer.mask.destroy();layer.mask=null;}}
    function destroy(){
        if(closed)return;closed=true;layers.delete(layer);const errors=[];
        for(const release of [()=>layer.mask?.destroy(),()=>layer.correction?.destroy(),()=>layer.sprite.destroy()])try{release();}catch(error){errors.push(error);}
        layer.mask=null;layer.correction=null;
        if(errors.length)throw new AggregateError(errors,'Background layer cleanup failed');
    }
    Object.assign(layer,{setCorrection,paint:now=>closed?null:paintLayer(layer,now),finish,destroy});
    try {
        setCorrection(correction,grade,version,now,0);
        if(plan.kind==='wipe'||plan.kind==='iris'){
            layer.mask=new PIXI.Sprite(plan.kind==='wipe'?generated.wipe:generated.iris);
            if(plan.kind==='iris')layer.mask.anchor.set(.5);
            container.addChild(layer.mask);sprite.mask=layer.mask;
        }
        container.addChild(sprite);layers.add(layer);return layer;
    }catch(error){try{destroy();}catch(cleanup){throw new AggregateError([error,cleanup],'Background layer setup failed');}throw error;}
}
return {create,dispose(){if(disposed)return;disposed=true;const errors=[];for(const layer of [...layers])try{layer.destroy();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Background layers cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageBackgroundLayers};
