// Re-renders a borrowed stage figure into the skin portrait's own crop.
function createStageBust({ease:galEase,clamp:galClamp01,framedHead}) {
    // where a skin's bust portrait stands on a W x H stage.
    // The design screen (bust.screen tall, bust.width wide) is centred and stands on the stage's bottom edge, one design px
    // u = min(H / screen, W / fit) as the art's --art-u. head = the head box's centre x, top and height (stage px); clip = the
    // crop (head heights above the crown, to each side, below the chin), cut to the design screen and the stage.
    function galBustFrame(bust, W, H) {
        const u = Math.min(H / bust.screen, W / bust.fit), left = W / 2 - bust.width * u / 2, top = H - bust.screen * u;
        const [x, y, height] = bust.head, [above, side, below] = bust.crop, head = { x: left + x * u, top: top + y * u, height: height * u };
        const x0 = Math.max(0, left, head.x - side * head.height), x1 = Math.min(W, left + bust.width * u, head.x + side * head.height);
        const y0 = Math.max(0, top, head.top - above * head.height), y1 = Math.min(H, head.top + head.height * (1 + below));
        return { u, head, clip: { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) } };
    }
    // A new bust subject's pose t ms after it arrived: the skin's first pose (enter.dx design px, enter.alpha), held until ms
    // (hold, the default) or eased out to rest over ms (out); at rest afterwards and without an entrance.
    function galBustEnter(enter, t, u) {
        if (!enter || t >= enter.ms) return { dx: 0, alpha: 1 };
        const k = enter.curve === "out" ? galEase.outCubic(galClamp01(t / enter.ms)) : 0, alpha = enter.alpha ?? 1;
        return { dx: (enter.dx || 0) * u * (1 - k), alpha: alpha + (1 - alpha) * k };
    }
    let disposed=false;const instances=new Set();
    function create({PIXI,renderer}) {
        if(disposed)throw new Error('Bust owner disposed');
        let closed=false,arrival=null;
        const bust={sprite:new PIXI.Sprite(PIXI.Texture.EMPTY),texture:null,key:'',matrix:new PIXI.Matrix(),inverse:new PIXI.Matrix()};
        bust.sprite.visible=false;
        function tick({spec,subject,now,W,H,instant=false,rulerHead}) {
            if(closed)return;
            const entry=subject,head=entry?.head;
            const frame = spec && head && entry.container.visible ? galBustFrame(spec, W, H) : null, clip = frame && frame.clip;
            if (!clip || clip.width < 1 || clip.height < 1) { arrival = null; bust.sprite.visible = false; return; }
            if (arrival?.alias !== spec.alias) arrival = { alias: spec.alias, since: instant ? -Infinity : now };
            const pose = galBustEnter(spec.enter, now - arrival.since, frame.u), resolution = renderer.resolution;
            const width = Math.ceil(clip.width), height = Math.ceil(clip.height), key = width + "x" + height + "@" + resolution;
            if (bust.key !== key) {
                const texture=PIXI.RenderTexture.create({ width, height, resolution }),previous=bust.texture;
                bust.texture=texture;bust.sprite.texture=texture;bust.key=key;
                if(previous)previous.destroy(true);
            }
            // Projection = the bust framing after undoing the stage's own placement of the container.
            const container = entry.container, s = frame.head.height / framedHead(Math.max(1, head.chin - head.top), rulerHead);
            container.transform.updateLocalTransform();
            container.transform.localTransform.copyTo(bust.inverse).invert();
            bust.matrix.set(s, 0, 0, s, frame.head.x - head.x * s + pose.dx - clip.x, frame.head.top - head.top * s - clip.y).append(bust.inverse);
            // Without the figure's stage filters (scene grade, listener shade, entrance alpha, depth blur): the bust is the skin's
            // portrait, not part of the lit scene, and a filter pass would render it at stage size before the framing scales it.
            const filters = container.filters;
            container.filters = null;
            try {
                renderer.render(container, { renderTexture: bust.texture, clear: true, transform: bust.matrix, skipUpdateTransform: false });
            } finally {
                container.filters=filters;
                // Rendering uses a temporary parent; the next stage pass must recompute the transform.
                container.transform._parentID=-1;
            }
            bust.sprite.position.set(clip.x, clip.y);
            bust.sprite.alpha = pose.alpha;
            bust.sprite.visible = true;
        }

        const view={sprite:bust.sprite,tick,dispose(){
            if(closed)return;closed=true;instances.delete(view);arrival=null;bust.sprite.visible=false;
            const errors=[];
            try{if(!bust.sprite.destroyed)bust.sprite.destroy();}catch(error){errors.push(error);}
            try{bust.texture?.destroy(true);}catch(error){errors.push(error);}
            bust.texture=null;
            if(errors.length)throw new AggregateError(errors,'Bust cleanup failed');
        }};
        instances.add(view);return view;
    }
    return {create,dispose(){
        if(disposed)return;disposed=true;const errors=[];
        for(const view of [...instances])try{view.dispose();}catch(error){errors.push(error);}
        if(errors.length)throw new AggregateError(errors,'Bust owner cleanup failed');
    }};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageBust};
