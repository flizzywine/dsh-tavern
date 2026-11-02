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
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageFeatures};
