// Prepares displayable figure assets; texture cache and source metrics are separate services.
function createStageFigureAssets({spineFigures,metrics}) {
    let disposed=false;const scopes=new Set(),headCentres=new Map();
    // Where a pack figure stands across the stage: the middle of the ink inside its head band (headTop..chin, canvas
    // fractions; the 10th-90th percentile, as live2dHeadBox centres the cast faces), in canvas px. The picture's support x
    // (the centre of its opaque bounds) moves with a tail, a raised arm or a prop on one side - a long tail put
    // one figure 4% of the stage width off her slot. undefined when unreadable or empty. Once per
    // picture and head band.
    function headCentre(document, key, texture, top, chin) {
        const id = key + ":head-x:" + top + ":" + chin;
        if (headCentres.has(id)) return headCentres.get(id);
        let result;
        try {
            const canvas = document.createElement("canvas"), ratio = Math.min(1, 512 / Math.max(texture.width, texture.height));
            canvas.width = Math.max(1, Math.round(texture.width * ratio)); canvas.height = Math.max(1, Math.round(texture.height * ratio));
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(texture.baseTexture.resource.source, 0, 0, canvas.width, canvas.height);
            const y0 = Math.max(0, Math.floor(top * canvas.height)), y1 = Math.min(canvas.height, Math.ceil(chin * canvas.height));
            if (y1 > y0) {
                const data = ctx.getImageData(0, y0, canvas.width, y1 - y0).data, columns = new Float64Array(canvas.width);
                let total = 0;
                for (let i = 3; i < data.length; i += 4) if (data[i] >= 64) { columns[((i - 3) / 4) % canvas.width]++; total++; }
                if (total >= 16) {
                    let seen = 0, low = -1, high = -1;
                    for (let x = 0; x < canvas.width; x++) { seen += columns[x]; if (low < 0 && seen >= total * 0.1) low = x; if (high < 0 && seen >= total * 0.9) high = x; }
                    result = (low + high + 1) / 2 / ratio;
                }
            }
        } catch (_) { result = undefined; }
        if (headCentres.size >= 256) headCentres.delete(headCentres.keys().next().value);
        headCentres.set(id, result);
        return result;
    }
    // centred: scene-math galCentredAnatomy (a pack picture stands on its head's centre).
    function create({PIXI,renderer,screen,textures,document,centred}) {
        if(disposed)throw new Error('Figure asset owner disposed');
        let closed=false;const assets=new Set();
        function own(sprite,candidate,spine=null){
            let dead=false;
            const asset={sprite,candidate,spine,destroy(){
                if(dead)return;dead=true;assets.delete(asset);
                if(spine)spine.destroy();else if(!sprite.destroyed)sprite.destroy({children:true});
            }};
            assets.add(asset);return asset;
        }
        async function picture({src,input}) {
            if(closed)return null;
            const texture=await textures.load(src);
            if(closed)return null;
            let sprite,candidate=null;
            try {
                sprite = new PIXI.Sprite(texture);
                sprite.anchor.set(0.5, 1);
                sprite.forkHeadTop = metrics.headTop(src, texture);
                // the old fading sprite keeps its own metric snapshot and pivot.
                sprite.figureInput = input;
                if (sprite.figureInput?.source && (sprite.figureInput.sourceUrl ? sprite.figureInput.sourceUrl === src : sprite.figureInput.source === metrics.source(src))) {
                    candidate = sprite.figureInput.pack && sprite.figureInput.anatomy ? null : metrics.measure(sprite.figureInput.source, texture);
                    if (sprite.figureInput.pack) {
                        // Sized by the picture's head (its crop) unless its anatomy really knows head and feet (metrics.anatomy).
                        const canvas = [texture.width, texture.height], anatomy = centred(metrics.anatomy(sprite.figureInput, canvas, candidate), canvas, anatomy => headCentre(document, src, texture, anatomy.headTop, anatomy.chin));
                        sprite.figureInput = { ...sprite.figureInput, anatomy, metrics: metrics.record({ ...sprite.figureInput, anatomy }, canvas, candidate) };
                    }
                    const sizing = metrics.resolve({ ...sprite.figureInput, W: screen.width, H: screen.height, canvas: [texture.width, texture.height] });
                    if (sizing.mode === "physical") sprite.anchor.set(sizing.supportX / texture.width, sizing.feet / texture.height);
                } else sprite.figureInput = null;
                // The body's centre across the picture (canvases are often off-centre), for the speaker anchor.
                sprite.forkBodyX = metrics.bodyX(sprite.figureInput?.metrics, sprite.figureInput ? candidate : null) ?? metrics.bodyCentre(src, texture) ?? texture.width / 2;

                return own(sprite,candidate);
            }catch(error){try{if(sprite&&!sprite.destroyed)sprite.destroy({children:true});}catch(cleanup){throw new AggregateError([error,cleanup],'Picture preparation failed');}throw error;}
        }
        async function spine({url,identity,config,input,animation}) {
            if(closed)return null;
            const figure=await spineFigures.prepare({PIXI,url,identity,config,renderer,anatomy:input?.pack&&input.anatomy});
            if(!figure)return null;
            if(closed){figure.destroy();return null;}
            let candidate=null;
            try {
                const {frame,measured,body}=figure,canvas=[frame[2],frame[3]];
                body.figureInput = null;
                if (input?.pack && input.source) {
                    candidate = measured ? measured.candidate : null;
                    body.figureInput = {...input,metrics:metrics.record(input,canvas,candidate)};
                    const sizing = metrics.resolve({ ...body.figureInput, W: screen.width, H: screen.height, canvas });
                    if (sizing.mode === "physical") body.anchor.set(sizing.supportX / canvas[0], sizing.feet / canvas[1]);
                }
                body.forkBodyX = metrics.bodyX(body.figureInput?.metrics, measured?.candidate) ?? canvas[0] / 2;

                figure.mood(animation);return own(body,candidate,figure);
            }catch(error){try{figure.destroy();}catch(cleanup){throw new AggregateError([error,cleanup],'Spine sizing failed');}throw error;}
        }
        const scope={picture,spine,dispose(){
            if(closed)return;closed=true;scopes.delete(scope);const errors=[];
            for(const asset of [...assets])try{asset.destroy();}catch(error){errors.push(error);}
            if(errors.length)throw new AggregateError(errors,'Figure asset cleanup failed');
        }};
        scopes.add(scope);return scope;
    }
    return {create,dispose(){if(disposed)return;disposed=true;headCentres.clear();const errors=[];for(const scope of [...scopes])try{scope.dispose();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Figure assets cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageFigureAssets};
