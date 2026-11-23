// Prepares displayable figure assets; texture cache and source metrics are separate services.
function createStageFigureAssets({spineFigures,metrics}) {
    let disposed=false;const scopes=new Set(),headCentres=new Map();
    // Where a pack figure stands across the stage: the middle of the ink inside its head band (headTop..chin, canvas
    // fractions; the 10th-90th percentile, as live2dHeadBox centres the cast faces), in canvas px. The picture's support x
    // (the centre of its opaque bounds) moves with a tail, a raised arm or a prop on one side - a long tail put
    // one figure 4% of the stage width off her slot. undefined when unreadable or empty. Once per
    // picture and head band.
    // face: [left, right] canvas fractions where the pack framed the face (asset-pack-presentation packFaceSpan); only ink
    // inside it counts, so a hammer head or a scythe blade beside the head does not pull the centre over (a broad
    // figure stood on his hammer). Omitted = within three quarters of a head span (headTop..chin) of the body's middle: the
    // median column of the ink in the two head spans below the chin, where a weapon held aloft is only its shaft (a reaper
    // whose blade rose beside the hood stood on the blade, its body a third of a figure to the side).
    function headCentre(document, key, texture, top, chin, face) {
        const id = key + ":head-x:" + top + ":" + chin + ":" + (face ? face.join(",") : "");
        if (headCentres.has(id)) return headCentres.get(id);
        let result;
        try {
            const canvas = document.createElement("canvas"), ratio = Math.min(1, 512 / Math.max(texture.width, texture.height));
            canvas.width = Math.max(1, Math.round(texture.width * ratio)); canvas.height = Math.max(1, Math.round(texture.height * ratio));
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(texture.baseTexture.resource.source, 0, 0, canvas.width, canvas.height);
            const y0 = Math.max(0, Math.floor(top * canvas.height)), y1 = Math.min(canvas.height, Math.ceil(chin * canvas.height));
            const y2 = Math.min(canvas.height, Math.max(y1, Math.ceil((chin + 2 * (chin - top)) * canvas.height)));
            // The q-th and (1 - q)-th quantile columns of the ink in rows [from, to) and inside [x0, x1): [low, high + 1) or null.
            const span = (data, from, to, x0, x1, q = 0.1) => {
                const columns = new Float64Array(canvas.width);
                let total = 0;
                for (let y = from; y < to; y++) for (let x = x0; x < x1; x++) if (data[((y - y0) * canvas.width + x) * 4 + 3] >= 64) { columns[x]++; total++; }
                if (total < 16) return null;
                let seen = 0, low = -1, high = -1;
                for (let x = 0; x < canvas.width; x++) { seen += columns[x]; if (low < 0 && seen >= total * q) low = x; if (high < 0 && seen >= total * (1 - q)) high = x; }
                return [low, high + 1];
            };
            if (y1 > y0) {
                const data = ctx.getImageData(0, y0, canvas.width, y2 - y0).data;
                const middle = !face && span(data, y1, y2, 0, canvas.width, 0.5), reach = 0.75 * (y1 - y0);
                const within = face ? [Math.max(0, Math.floor(face[0] * canvas.width)), Math.min(canvas.width, Math.ceil(face[1] * canvas.width))]
                    : middle ? [Math.max(0, Math.floor(middle[0] + 0.5 - reach)), Math.min(canvas.width, Math.ceil(middle[0] + 0.5 + reach))] : [0, canvas.width];
                const head = span(data, y0, y1, within[0], within[1]);
                if (head) result = (head[0] + head[1]) / 2 / ratio;
            }
        } catch (_) { result = undefined; }
        if (headCentres.size >= 256) headCentres.delete(headCentres.keys().next().value);
        headCentres.set(id, result);
        return result;
    }
    // How far a picture's ink reaches across its canvas, in canvas px (alpha >= 64, read at 256 px), so the cast layout knows
    // a broad figure - plate armour, a hammer on the shoulder, wings - from a slim one: { x: [left, right] the farthest ink,
    // body: [left, right] the 5th-95th percentile of the ink by column - the mass the eye weighs when it judges the gaps (a
    // scythe's blade reaches far but weighs little) - and bands: [[top, bottom, left, right]] the farthest ink of each of 32
    // rows of the canvas that hold any, so a neighbour's face is kept clear only of what reaches across at its height (a
    // blade raised above a shorter neighbour's head does not push it away) }. undefined when unreadable or empty. Once
    // per picture.
    function inkSpan(document, key, texture) {
        const id = key + ":ink-x";
        if (headCentres.has(id)) return headCentres.get(id);
        let result;
        try {
            const canvas = document.createElement("canvas"), ratio = Math.min(1, 256 / Math.max(texture.width, texture.height));
            canvas.width = Math.max(1, Math.round(texture.width * ratio)); canvas.height = Math.max(1, Math.round(texture.height * ratio));
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(texture.baseTexture.resource.source, 0, 0, canvas.width, canvas.height);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            const columns = new Float64Array(canvas.width), rows = 32, bands = Array.from({ length: rows }, () => [canvas.width, -1]);
            let left = canvas.width, right = -1, total = 0;
            for (let i = 3; i < data.length; i += 4) if (data[i] >= 64) {
                const p = (i - 3) / 4, x = p % canvas.width, band = bands[Math.min(rows - 1, Math.floor((p - x) / canvas.width * rows / canvas.height))];
                columns[x]++; total++; if (x < left) left = x; if (x > right) right = x; if (x < band[0]) band[0] = x; if (x > band[1]) band[1] = x;
            }
            if (right >= left) {
                let seen = 0, low = -1, high = -1;
                for (let x = 0; x < canvas.width; x++) { seen += columns[x]; if (low < 0 && seen >= total * 0.05) low = x; if (high < 0 && seen >= total * 0.95) high = x; }
                const step = canvas.height / rows / ratio;
                result = { x: [left / ratio, (right + 1) / ratio], body: [low / ratio, (high + 1) / ratio],
                    bands: bands.flatMap(([l, r], i) => r >= l ? [[i * step, (i + 1) * step, l / ratio, (r + 1) / ratio]] : []) };
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
                        const canvas = [texture.width, texture.height], anatomy = centred(metrics.anatomy(sprite.figureInput, canvas, candidate), canvas, anatomy => headCentre(document, src, texture, anatomy.headTop, anatomy.chin, sprite.figureInput.face));
                        sprite.figureInput = { ...sprite.figureInput, anatomy, metrics: metrics.record({ ...sprite.figureInput, anatomy }, canvas, candidate) };
                    }
                    const sizing = metrics.resolve({ ...sprite.figureInput, W: screen.width, H: screen.height, canvas: [texture.width, texture.height] });
                    if (sizing.mode === "physical") sprite.anchor.set(sizing.supportX / texture.width, sizing.feet / texture.height);
                } else sprite.figureInput = null;
                // The body's centre across the picture (canvases are often off-centre), for the speaker anchor.
                sprite.forkBodyX = metrics.bodyX(sprite.figureInput?.metrics, sprite.figureInput ? candidate : null) ?? metrics.bodyCentre(src, texture) ?? texture.width / 2;
                if (sprite.figureInput) sprite.forkInkX = inkSpan(document, src, texture);

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
                const {frame,measured,body,head}=figure,canvas=[frame[2],frame[3]];
                body.figureInput = null;
                if (input?.pack && input.source) {
                    candidate = measured ? measured.candidate : null;
                    // Sized by the rig's own head (its head slot) unless its anatomy really knows head and feet, as a picture by its crop.
                    const sized = head ? {...input,head:{top:head.top,chin:head.chin}} : input;
                    const anatomy = centred(metrics.anatomy(sized, canvas, candidate), canvas, () => head?.x);
                    body.figureInput = {...sized,anatomy,metrics:metrics.record({...sized,anatomy},canvas,candidate)};
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
