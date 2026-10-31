// Own stage figure preparation and lifetime; the shared rig also serves independent material previews.
function createStageSpineFigures({rig,bottomFade}) {
    let disposed=false;const figures=new Set();
    async function prepare({PIXI,url,config,identity,renderer,anatomy}) {
        if(disposed)return null;
        const loaded=await rig.spineLoadData(url);
        if(disposed){for(const texture of loaded.textures)texture.destroy();return null;}
        let figure,body,closed=false,owned;
        const destroy=()=>{
            if(closed)return;closed=true;figures.delete(owned);const errors=[];
            for(const release of [()=>{if(body&&!body.destroyed)body.destroy({children:true});},()=>{if(figure)figure.destroy();else for(const texture of loaded.textures)texture.destroy();}])try{release();}catch(error){errors.push(error);}
            if(errors.length)throw new AggregateError(errors,'Spine figure cleanup failed');
        };
        try {
            figure=rig.spineFigure(PIXI,loaded,config);
            const frame=rig.spineFrame(figure.spine,config.frame);
            const measured=anatomy?null:rig.spineMeasure(figure.spine,frame,identity,renderer,PIXI);
            const fade=bottomFade(config.bottomFade,anatomy,measured?.candidate.auto,frame[3]);
            if(fade)rig.spineBottomFade(PIXI,figure,frame,fade);
            body=rig.spineBody(PIXI,figure.spine,frame);
            body.forkHeadTop=anatomy?anatomy.headTop:measured.headTop;
            owned={spine:figure.spine,body,frame,measured,
                mood(...args){if(!closed)figure.mood(...args);},voice(...args){if(!closed)figure.voice(...args);},update(...args){if(!closed)figure.update(...args);},
                debug:()=>figure.debug(),destroy};
            figures.add(owned);return owned;
        }catch(error){try{destroy();}catch(cleanup){throw new AggregateError([error,cleanup],'Spine figure preparation failed');}throw error;}
    }
    return {prepare,dispose(){if(disposed)return;disposed=true;const errors=[];for(const figure of [...figures])try{figure.destroy();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Stage Spine cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageSpineFigures};
