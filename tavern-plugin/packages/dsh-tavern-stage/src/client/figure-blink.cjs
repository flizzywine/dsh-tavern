// Authored blink overlays borrow cached textures and own only their sprites and scheduler.
function createStageFigureBlink({clock,clockwork,warn=(...args)=>console.warn(...args)}) {
    let disposed=false,unsubscribe=null;const instances=new Set();
    const {blinkUrls,blinkPlacement,blinkTimingFor,createBlinkScheduler}=clockwork;
    function create({PIXI,textures,allowed}) {
        if(disposed)throw new Error('Figure blink owner disposed');
        let closed=false,scheduler=null,key='',fault='',phase='open',closedSprite=null,halfSprite=null;
        function reset(){
            const old=scheduler;scheduler=null;key='';phase='open';const errors=[];
            try{old?.stop();}catch(error){errors.push(error);}
            for(const sprite of [closedSprite,halfSprite])try{if(sprite&&!sprite.destroyed)sprite.destroy();}catch(error){errors.push(error);}
            closedSprite=null;halfSprite=null;
            if(errors.length)throw new AggregateError(errors,'Blink cleanup failed');
        }
        function update({bundle,sprite,baseTexture,ready,rhythm}) {
            if(closed)return;
            if(!bundle||!sprite||!ready){if(key)reset();return;}
            if(key===bundle.key&&(bundle.blend==='replace'||closedSprite?.parent===sprite))return;
            const records=blinkUrls(bundle).map(url=>textures.get(url));
            if(!records.every(record=>record&&record.ready&&record.texture)){if(key)reset();return;}
            const [shut,half]=records.map(record=>record.texture);
            const at=blinkPlacement(bundle,baseTexture.width,baseTexture.height,sprite.anchor);
            if(!at||!shut||shut.width!==at.w||shut.height!==at.h||half&&(half.width!==at.w||half.height!==at.h)){
                if(fault!==bundle.key)warn('[fork-gal-scene] blink patch ignored',bundle.rect);
                fault=bundle.key;if(key)reset();return;
            }
            reset();
            try {
                const overlay=texture=>{const child=new PIXI.Sprite(texture);try{child.position.set(at.x,at.y);child.visible=false;sprite.addChild(child);return child;}catch(error){child.destroy();throw error;}};
                if(bundle.blend!=='replace'){closedSprite=overlay(shut);halfSprite=half?overlay(half):null;}
                scheduler=createBlinkScheduler({setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,
                    timing:blinkTimingFor(rhythm),hasHalf:Boolean(half),allowed:()=>!closed&&allowed(),
                    apply:next=>{if(closed)return;phase=next;if(closedSprite)closedSprite.visible=next==='closed';if(halfSprite)halfSprite.visible=next==='half';}});
                scheduler.start();key=bundle.key;
            } catch(error){try{reset();}catch(cleanup){throw new AggregateError([error,cleanup],'Blink setup failed');}throw error;}
        }
        const view={update,reset,phase:()=>phase,get active(){return Boolean(key);},get hasHalf(){return Boolean(halfSprite);},
            restart(){if(!closed)scheduler?.restart();},dispose(){if(closed)return;closed=true;instances.delete(view);reset();}};
        if(!unsubscribe)unsubscribe=clock.subscribe(active=>{if(!active)for(const instance of instances)instance.restart();});
        instances.add(view);return view;
    }
    return {create,urls:blinkUrls,dispose(){
        if(disposed)return;disposed=true;const errors=[];
        try{unsubscribe?.();}catch(error){errors.push(error);}unsubscribe=null;
        for(const view of [...instances])try{view.dispose();}catch(error){errors.push(error);}
        if(errors.length)throw new AggregateError(errors,'Figure blinks cleanup failed');
    }};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageFigureBlink};
