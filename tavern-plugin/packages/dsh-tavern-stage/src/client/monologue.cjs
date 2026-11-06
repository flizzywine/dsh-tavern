// Screen-fixed inner-monologue backdrop, below figures and above scene backgrounds.
function createStageMonologue({canvasTexture}) {
    let disposed=false;const instances=new Set();
    function create({PIXI,world}) {
        if(disposed)throw new Error('Monologue owner disposed');
        let closed=false;
        const thinking={sprite:new PIXI.Sprite(PIXI.Texture.EMPTY),image:null,texture:null,alpha:0};
        thinking.sprite.anchor.set(.5);thinking.sprite.visible=false;
        function thinkingDim(spec) {
            const key = spec.dim + ":" + spec.vignette;
            if (thinking.dimKey !== key) {
                const texture = canvasTexture(PIXI, 960, 540, function (ctx, w, h) {
                    const image = ctx.createImageData(w, h), data = image.data;
                    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                        const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2), r = Math.min(1, Math.hypot(dx * 0.82, dy));
                        const a = Math.min(1, spec.dim + spec.vignette * Math.pow(Math.max(0, (r - 0.45) / 0.55), 1.6)), at = (y * w + x) * 4;
                        data[at] = data[at + 1] = data[at + 2] = 0; data[at + 3] = Math.max(0, Math.min(255, Math.round(a * 255 + Math.random() - 0.5)));
                    }
                    ctx.putImageData(image, 0, 0);
                });
                const previous=thinking.dimTexture;
                thinking.dimTexture=texture;thinking.dimKey=key;
                if(previous)previous.destroy(true);
            }
            return thinking.dimTexture;
        }
        function tick(desc, dt, W, H) {
            if(closed)return;
            const spec = desc.thinking || null;
            if (spec && spec.image && spec.image !== thinking.image) {
                const texture=PIXI.Texture.from(spec.image),previous=thinking.texture;
                thinking.image=spec.image;thinking.texture=texture;
                if(previous)previous.destroy(true);
            }
            if (spec) thinking.source = spec.image ? thinking.texture : thinkingDim(spec);
            if (thinking.source && thinking.sprite.texture !== thinking.source) thinking.sprite.texture = thinking.source;
            const target = spec && thinking.source ? 1 : 0, fade = spec?.fade || thinking.fade || [0.15, 0.25];
            if (spec) thinking.fade = fade;
            const ms = desc.reducedMotion ? 120 : 1000 * (target > thinking.alpha ? fade[0] : fade[1]);
            thinking.alpha = desc.snap || desc.skipping || ms <= 0 ? target : target > thinking.alpha ? Math.min(target, thinking.alpha + dt * 1000 / ms) : Math.max(target, thinking.alpha - dt * 1000 / ms);
            const sprite = thinking.sprite;
            sprite.visible = thinking.alpha > 0.001 && Boolean(thinking.source);
            if (!sprite.visible) return;
            const over = spec?.over || thinking.over || 1;
            if (spec) thinking.over = over;
            const center = world.toLocal(new PIXI.Point(W / 2, H / 2)), zoom = world.scale.x || 1, texture = sprite.texture;
            sprite.position.set(center.x, center.y); sprite.rotation = -world.rotation;
            sprite.scale.set(W / (texture.width || 1) * over / zoom, H / (texture.height || 1) * over / zoom);
            sprite.alpha = thinking.alpha;
        }

        const view={sprite:thinking.sprite,get alpha(){return thinking.alpha;},tick,dispose(){
            if(closed)return;closed=true;instances.delete(view);thinking.alpha=0;
            const errors=[];
            thinking.sprite.visible=false;
            for(const release of [()=>{if(!thinking.sprite.destroyed)thinking.sprite.destroy();},()=>thinking.texture?.destroy(true),()=>thinking.dimTexture?.destroy(true)]){
                try{release();}catch(error){errors.push(error);}
            }
            thinking.source=null;thinking.texture=null;thinking.dimTexture=null;
            if(errors.length)throw new AggregateError(errors,'Monologue cleanup failed');
        }};
        instances.add(view);return view;
    }
    return {create,dispose(){
        if(disposed)return;disposed=true;const errors=[];
        for(const view of [...instances])try{view.dispose();}catch(error){errors.push(error);}
        if(errors.length)throw new AggregateError(errors,'Monologue owner cleanup failed');
    }};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageMonologue};
