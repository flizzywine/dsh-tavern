// Phone call composition owns its output textures; figures and background textures are borrowed.
function createStageCallViews({canvasTexture,cover:fitCover,subscribeFrames}) {
    let disposed=false;const instances=new Set();
    function create({PIXI,renderer,screen,canvas,tune}) {
        if(disposed)throw new Error('Call view owner disposed');
        let closed=false,covers=false,stopFrames=null;const resources=new Map();
        function own(value,deep=false){resources.set(value,deep);return value;}
        function release(value){if(!resources.has(value))return;const deep=resources.get(value);resources.delete(value);if(!value.destroyed)value.destroy(deep);}
        function releaseMany(values){const errors=[];for(const value of values)try{release(value);}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Call resource cleanup failed');}
        function allocate(build){
            const before=new Set(resources.keys());
            try{return build();}catch(error){
                try{releaseMany([...resources.keys()].filter(value=>!before.has(value)).reverse());}
                catch(cleanup){throw new AggregateError([error,cleanup],'Call allocation failed');}
                throw error;
            }
        }
        let callBox,callViews,callGlass,call;
        const output={get container(){return callBox;},get covers(){return covers;},tick,capture:captureCallFrame,
            snapshot(){return {alpha:call.alpha,views:[...call.views.keys()],framed:[...call.views.values()].map(view=>view.framed?{...view.framed}:null),glass:call.glass.pieces.filter(piece=>piece.sprite.visible).length};},
            dispose(){
                if(closed)return;closed=true;covers=false;instances.delete(output);if(callBox)callBox.visible=false;
                const errors=[];try{stopFrames?.();}catch(error){errors.push(error);}
                try{releaseMany([...resources.keys()].reverse());}catch(error){errors.push(error);}
                call?.views.clear();
                if(errors.length)throw new AggregateError(errors,'Call view cleanup failed');
            }};
        try {
            callBox=own(new PIXI.Container());callViews=own(new PIXI.Container());callGlass=own(new PIXI.Container());
            callBox.addChild(callViews,callGlass);
            call={views:new Map(),alpha:0,matrix:new PIXI.Matrix(),inverse:new PIXI.Matrix(),gradient:null,
                glass:{texture:null,key:'',drawn:'',source:null,blur:null,saturate:null,pieces:[]}};
            stopFrames=subscribeFrames?.(captureCallFrame);instances.add(output);
        } catch(error){try{output.dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Call view setup failed');}throw error;}
        // The screen box of a page view: the phone frame's place on the canvas (read every frame - the phone moves and zooms).
        function callRect(spec, view) {
            const frame = spec.frame;
            if (!frame || !frame.isConnected) return null;
            const f = frame.getBoundingClientRect(), c = canvas.getBoundingClientRect(), k = c.width ? screen.width / c.width : 1;
            if (!f.width || !f.height) return null;
            return { x: (f.left - c.left + view.rect.x * f.width) * k, y: (f.top - c.top + view.rect.y * f.height) * k,
                width: view.rect.width * f.width * k, height: view.rect.height * f.height * k, radius: view.radius * f.width * k };
        }
        function callGradient() {
            // §2.2: a light darkening at the top (25 %) and bottom (30 %) keeps the status bar, pill and keys readable.
            if(!resources.has(call.gradient))call.gradient = own(canvasTexture(PIXI, 4, 256, function (ctx, w, h) {
                const image = ctx.createImageData(w, h), data = image.data;
                for (let y = 0; y < h; y++) {
                    const t = y / (h - 1), a = t < 0.22 ? 0.25 * (1 - t / 0.22) : t > 0.7 ? 0.3 * (t - 0.7) / 0.3 : 0;
                    for (let x = 0; x < w; x++) data[(y * w + x) * 4 + 3] = Math.round(a * 255);
                }
                ctx.putImageData(image, 0, 0);
            }),true);
            return call.gradient;
        }
        function callViewOf(role) {
            let view = call.views.get(role);
            if (view) return view;
            return allocate(()=>{
                const sprite = own(new PIXI.Sprite(PIXI.Texture.EMPTY)), mask = own(new PIXI.Graphics()), back = own(new PIXI.Sprite(PIXI.Texture.EMPTY)), shade = own(new PIXI.Sprite(callGradient()));
                // Drawn once per picture and box size: enough passes that a 14 pt blur at 2-3x leaves no banding.
                const blur = own(new PIXI.filters.BlurFilter(8, 10)), saturate = own(new PIXI.filters.ColorMatrixFilter());
                blur.repeatEdgePixels = true;
                saturate.saturate(0.1);
                back.filters = [blur, saturate].map(tune);
                sprite.mask = mask;
                callViews.addChild(sprite, mask);
                view = { role, sprite, mask, back, shade, blur, saturate, texture: null, backTexture: null, key: "", backKey: "", version: 0 };
                call.views.set(role, view);
                return view;
            });
        }
        function dropCallView(view) {
            call.views.delete(view.role);
            releaseMany([view.sprite,view.mask,view.back,view.shade,view.blur,view.saturate,view.texture,view.backTexture]);
        }
        // §2.1-2.2: each box gets the stage's current background, cover-fitted and blurred (14 pt), then the party framed by the
        // rest head the mod declares (head = [centre x, top, height] of the box). Not graded, shaded or blurred with the scene. A frozen
        // call (hung up) keeps its last frame, dimmed.
        function tick({spec,dt,W,H,reducedMotion=false,background=null,subjects=new Map()}) {
            if(closed)return;
            call.alpha = spec ? Math.min(1, call.alpha + dt * 1000 / (reducedMotion ? 120 : 180)) : Math.max(0, call.alpha - dt * 1000 / 120);
            callBox.alpha = call.alpha;
            if (!spec && call.alpha <= 0) { call.views.forEach(dropCallView); tickCallGlass(null); callBox.visible = false; covers = false; return; }
            if (!spec) covers = false;
            callBox.visible = true;
            if (!spec) return;
            const resolution=renderer.resolution,backTexture=background && background!==PIXI.Texture.EMPTY ? background : null;
            const shown = new Set(), remoteSpec = spec.views.find(view => view.role === "remote"), remoteRect = remoteSpec && callRect(spec, remoteSpec);
            // One iOS point of the call screen (it is 393 pt wide) in screen px: the background blur is 14 pt.
            const point = (remoteRect ? remoteRect.width : W) / 393;
            spec.views.forEach(function (viewSpec) {
                const rect = callRect(spec, viewSpec), entry = viewSpec.figure ? subjects.get(viewSpec.figure.key) : null;
                if (!rect || rect.width < 2 || rect.height < 2 || !entry && viewSpec.role === "self") return;
                const view = callViewOf(viewSpec.role);
                shown.add(view.role);
                const width = Math.ceil(rect.width), height = Math.ceil(rect.height), key = width + "x" + height + "@" + resolution;
                view.sprite.position.set(rect.x, rect.y);
                view.mask.clear().beginFill(0xffffff).drawRoundedRect(rect.x, rect.y, rect.width, rect.height, rect.radius).endFill();
                view.sprite.tint = spec.frozen ? 0x8a8a8a : 0xffffff;
                if (spec.frozen && view.texture && view.key === key) return;
                if (view.key !== key) {
                    const previous=view.texture;
                    view.texture = own(PIXI.RenderTexture.create({ width, height, resolution }),true);
                    release(previous);
                    view.sprite.texture = view.texture; view.key = key;
                }
                // The blurred background is drawn once per picture and box size, then reused every frame.
                const backKey = key + ":" + (spec.backdrop === "stage" && backTexture ? backTexture.baseTexture.uid + ":" + backTexture.frame.width : "none");
                if (view.backKey !== backKey) {
                    if (!view.backTexture || view.backTexture.width !== width || view.backTexture.height !== height) { const previous=view.backTexture; view.backTexture = own(PIXI.RenderTexture.create({ width, height, resolution }),true); release(previous); }
                    const holder = own(new PIXI.Container()), fill = own(new PIXI.Graphics()).beginFill(0x0b0812).drawRect(0, 0, width, height).endFill();
                    holder.addChild(fill);
                    if (spec.backdrop === "stage" && backTexture) {
                        const cover = fitCover(backTexture.width, backTexture.height, width, height, 1.06);
                        view.back.texture = backTexture; view.back.anchor.set(0.5);
                        view.back.scale.set(cover.scale); view.back.position.set(width / 2, height / 2);
                        view.blur.blur = 14 * point;
                        holder.addChild(view.back);
                    }
                    try {renderer.render(holder, { renderTexture: view.backTexture, clear: true });view.backKey=backKey;}
                    finally {holder.removeChildren();releaseMany([fill,holder]);}
                }
                const base = own(new PIXI.Sprite(view.backTexture));
                try {renderer.render(base, { renderTexture: view.texture, clear: true });} finally {release(base);}
                const head = entry && entry.head;
                if (head && entry.container.visible !== false) {
                    const [hx, htop, hheight] = viewSpec.head, container = entry.container;
                    const s = hheight * height / Math.max(1, head.chin - head.top);
                    view.framed = { s, span: head.chin - head.top, hheight, height };
                    container.transform.updateLocalTransform();
                    container.transform.localTransform.copyTo(call.inverse).invert();
                    call.matrix.set(s, 0, 0, s, hx * width - head.x * s, htop * height - head.top * s).append(call.inverse);
                    const filters = container.filters;
                    container.filters = null;
                    try {renderer.render(container, { renderTexture: view.texture, clear: false, transform: call.matrix, skipUpdateTransform: false });}
                    finally {container.filters=filters;container.transform._parentID=-1;}
                }
                if (viewSpec.role === "remote") {
                    view.shade.width = width; view.shade.height = height;
                    renderer.render(view.shade, { renderTexture: view.texture, clear: false });
                }
                view.version++;
            });
            call.views.forEach(view => { if (!shown.has(view.role)) dropCallView(view); });
            tickCallGlass(spec, remoteRect);
            // §2.8: a call view over the whole stage (the phone full screen) leaves nothing of the world to draw.
            const rect = remoteRect;
            covers = Boolean(call.alpha >= 1 && rect && rect.x <= 0.5 && rect.y <= 0.5 && rect.x + rect.width >= W - 0.5 && rect.y + rect.height >= H - 0.5);
        }
        // The glass (iOS 26 Liquid Glass): her video, blurred and saturated as the page asks (`glass.blur` a fraction of the page
        // width, `glass.saturate`), drawn at half size once per new video frame and shown inside each shape the page reports
        // (rounded rects in page fractions, each with its opacity). The page draws the tint and rim over it; the page's layout
        // is the one authority for where glass is.
        function tickCallGlass(spec, rect) {
            const glass = call.glass, view = call.views.get("remote");
            const shapes = spec && spec.glass && view && view.texture && rect ? spec.glass.rects : [];
            while (glass.pieces.length < shapes.length) {
                const piece=allocate(()=>{const sprite=own(new PIXI.Sprite(PIXI.Texture.EMPTY)),mask=own(new PIXI.Graphics());sprite.mask=mask;callGlass.addChild(sprite,mask);return {sprite,mask};});
                glass.pieces.push(piece);
            }
            glass.pieces.forEach((piece, index) => { piece.sprite.visible = index < shapes.length; });
            if (!shapes.length) return;
            const scale = 0.5, width = Math.max(1, Math.ceil(rect.width * scale)), height = Math.max(1, Math.ceil(rect.height * scale)), key = width + "x" + height + "@" + renderer.resolution;
            if (glass.key !== key) {
                const previous=glass.texture;
                glass.texture = own(PIXI.RenderTexture.create({ width, height, resolution: renderer.resolution }),true);release(previous); glass.key = key; glass.drawn = "";
            }
            if (!glass.source) {
                Object.assign(glass,allocate(()=>{
                    const source=own(new PIXI.Sprite(PIXI.Texture.EMPTY)),blur=own(new PIXI.filters.BlurFilter(8,4)),saturate=own(new PIXI.filters.ColorMatrixFilter());
                    blur.repeatEdgePixels=true;source.filters=[blur,saturate].map(tune);
                    return {source,blur,saturate};
                }));
            }
            const pageWidth = rect.width / Math.max(1e-6, spec.views.find(row => row.role === "remote").rect.width);
            const drawn = view.version + ":" + view.key + ":" + spec.glass.blur + ":" + spec.glass.saturate;
            if (glass.drawn !== drawn) {
                glass.source.texture = view.texture; glass.source.scale.set(scale);
                glass.blur.blur = spec.glass.blur * pageWidth * scale;
                glass.saturate.saturate(spec.glass.saturate - 1);
                renderer.render(glass.source, { renderTexture: glass.texture, clear: true });
                glass.drawn=drawn;
            }
            shapes.forEach((shape, index) => {
                const piece = glass.pieces[index], box = callRect(spec, { rect: shape, radius: shape.radius });
                if (!box) { piece.sprite.visible = false; return; }
                piece.sprite.texture = glass.texture; piece.sprite.position.set(rect.x, rect.y);
                piece.sprite.width = rect.width; piece.sprite.height = rect.height;
                piece.sprite.alpha = shape.alpha; piece.sprite.tint = spec.frozen ? 0x8a8a8a : 0xffffff;
                piece.mask.clear().beginFill(0xffffff).drawRoundedRect(box.x, box.y, box.width, box.height, box.radius).endFill();
            });
        }
        // The shutter (§2.5): the remote picture as it stands (background and her), as iOS keeps the other party's video.
        function captureCallFrame() {
            const view = call.views.get("remote");
            if (closed || !view || !view.texture) return Promise.reject(Object.assign(new Error("没能拍下这一帧"), { code: "NO_FRAME" }));
            const canvas = renderer.plugins.extract.canvas(view.texture);
            return Promise.resolve(canvas.toDataURL("image/jpeg", 0.9));
        }

        return output;
    }
    return {create,dispose(){if(disposed)return;disposed=true;const errors=[];for(const view of [...instances])try{view.dispose();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Call views cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageCallViews};
