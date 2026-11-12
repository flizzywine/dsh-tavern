// Feature factories run once per view scope, after the scene and shared surfaces exist.
// Factories return named views; own() ties resources and CSS to the view's rollback/disposal.
// backlog: optional 履历 row projections by the renderer name a performance declaration gives (backlog-rows.cjs).
// takeover: optional views => the feature's view that takes the stage over for its performances (useStage, controller.cjs
// useStageTakeovers); mount lists them in views.takeovers.
// hud: optional views => the feature's HUD view (useSlot(props) => {shown,element,onInputActivity,fallbackRef}, controller.cjs
// useStageHuds); mount lists them in views.huds.
// sourceDevice: optional views => the handheld source device the source widgets lay out and adjust ({modId, presentation,
// glyph, mark, group, threads(state), prefs, min, useAdjust}); at most one, in views.sourceDevice (null without one).
function createStageFeatures() {
    const features=new Map();
    return {
        register(id,{views,css,backlog,takeover,hud,sourceDevice,skipShows}){
            if(features.has(id))throw new Error('Stage feature already registered: '+id);
            const feature={views,css,backlog,takeover,hud,sourceDevice,skipShows};features.set(id,feature);
            return ()=>{if(features.get(id)===feature)features.delete(id);};
        },
        // whether a feature shows this performance kind of its own while skipping: page DOM alone (runtime-kernel.cjs stageSkipShows).
        skipShows(kind){
            for(const feature of features.values())if(feature.skipShows?.(kind))return true;
            return false;
        },
        backlogRenderers(){
            const renderers={};
            for(const feature of features.values())Object.assign(renderers,feature.backlog);
            return renderers;
        },
        mount(context){
            const {document,own,views}=context;
            if(Object.hasOwn(views,'takeovers'))throw new Error('Occupied stage view: takeovers');
            const takeovers=[],huds=[];views.takeovers=takeovers;
            if(Object.hasOwn(views,'huds'))throw new Error('Occupied stage view: huds');
            views.huds=huds;
            if(Object.hasOwn(views,'sourceDevice'))throw new Error('Occupied stage view: sourceDevice');
            views.sourceDevice=null;
            for(const [id,feature] of features){
                if(feature.css){
                    const style=document.createElement('style');
                    own({dispose:()=>style.remove()});
                    // named like the stage's own styles, so the module loader never claims it for another plugin.
                    style.dataset.plugin='dsh-tavern-stage';style.dataset.stageFeature=id;style.textContent=feature.css;document.head.appendChild(style);
                }
                const additions=feature.views(context);
                for(const [key,value] of Object.entries(additions)){
                    if(Object.hasOwn(views,key))throw new Error('Occupied stage view: '+key);
                    views[key]=value;
                }
                if(feature.takeover)takeovers.push(feature.takeover(views));
                if(feature.hud)huds.push(feature.hud(views));
                if(feature.sourceDevice){
                    if(views.sourceDevice)throw new Error('A second stage source device: '+id);
                    views.sourceDevice=feature.sourceDevice(views);
                }
            }
        }
    };
}
// A mod's stage client as the build bundles it (build.mjs modStageFeatures): its own CommonJS files, keyed by path in its
// folder, each with the paths its relative require() calls resolve to. The entry's exports are the feature ({views}).
function loadStageModFeature(files, entry, css) {
    const loaded=new Map();
    const load=key=>{
        if(loaded.has(key))return loaded.get(key).exports;
        const [requires,factory]=files[key],module={exports:{}};
        loaded.set(key,module);
        factory(module,module.exports,specifier=>load(requires[specifier]));
        return module.exports;
    };
    const feature=load(entry);
    return css?{...feature,css}:feature;
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageFeatures,loadStageModFeature};
