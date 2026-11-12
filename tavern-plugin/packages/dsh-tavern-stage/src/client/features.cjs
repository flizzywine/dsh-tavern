// Feature factories run once per view scope, after the scene and shared surfaces exist.
// Factories return named views; own() ties resources and CSS to the view's rollback/disposal.
function createStageFeatures() {
    const features=new Map();
    return {
        register(id,{views,css}){
            if(features.has(id))throw new Error('Stage feature already registered: '+id);
            const feature={views,css};features.set(id,feature);
            return ()=>{if(features.get(id)===feature)features.delete(id);};
        },
        mount(context){
            const {document,own,views}=context;
            for(const [id,feature] of features){
                if(feature.css){
                    const style=document.createElement('style');
                    own({dispose:()=>style.remove()});
                    style.dataset.stageFeature=id;style.textContent=feature.css;document.head.appendChild(style);
                }
                const additions=feature.views(context);
                for(const [key,value] of Object.entries(additions)){
                    if(Object.hasOwn(views,key))throw new Error('Occupied stage view: '+key);
                    views[key]=value;
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
