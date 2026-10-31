function createStageSceneTextures({Image,now,keepBytes=256*1024*1024}) {
    let disposed=false;const caches=new Set();
    function create({PIXI,upload}) {
        if(disposed)throw new Error('Scene texture owner disposed');
        let closed=false,keepNow=null,keepBefore=null;const records=new Map();
        const cancelled=()=>new Error('cancelled');
        function release(record) {
            if(record.dead)return;record.dead=true;
            record.image.onload=null;record.image.onerror=null;
            record.reject(cancelled());
            if(record.texture)record.texture.destroy(true);
        }
        function load(url) {
            if(closed){const promise=Promise.reject(cancelled());promise.catch(()=>{});return promise;}
            if(records.has(url))return records.get(url).promise;
            const image=new Image(),record={url,image,texture:null,ready:false,dead:false};
            record.promise=new Promise((resolve,reject)=>{record.resolve=resolve;record.reject=reject;});
            record.promise.catch(()=>{});records.set(url,record);
            image.decoding='async';
            let decode;
            try {
                if(image.decode){image.src=url;decode=image.decode();}
                else {decode=new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;});image.src=url;}
            }catch(error){decode=Promise.reject(error);}
            Promise.resolve(decode).then(()=>{
                image.onload=null;image.onerror=null;
                if(record.dead||closed)throw cancelled();
                const base=new PIXI.BaseTexture(image);
                try{record.texture=new PIXI.Texture(base);}catch(error){base.destroy();throw error;}
                return upload?.(record.texture);
            }).then(()=>{
                if(record.dead||closed)throw cancelled();
                record.ready=true;record.resolve(record.texture);
            }).catch(error=>{
                if(records.get(url)===record)records.delete(url);
                record.reject(error);
                try{release(record);}catch(cleanup){console.warn('Scene texture cleanup failed',cleanup);}
            });
            return record.promise;
        }
        function prune(keep,visit) {
            if(closed)return;
            keep=new Set(keep);
            if(keepNow&&(keepNow.size!==keep.size||[...keep].some(url=>!keepNow.has(url))))keepBefore=keepNow;
            keepNow=keep;
            const retired=[],time=now();
            for(const record of records.values()){
                if(!record.texture)continue;
                if(keep.has(record.url)){record.used=time;record.visit=visit;}else retired.push(record);
            }
            let room=keepBytes;
            for(const record of retired.sort((a,b)=>(b.used||0)-(a.used||0))){
                const base=record.texture.baseTexture,bytes=(base?base.realWidth*base.realHeight:0)*4;
                if((record.visit===visit||keepBefore?.has(record.url))&&bytes<=room){room-=bytes;continue;}
                records.delete(record.url);release(record);
            }
        }
        const cache={load,prune,get(url){const record=records.get(url);return record?{texture:record.texture,ready:record.ready}:undefined;},
            get size(){return records.size;},keys:()=>records.keys(),dispose(){
                if(closed)return;closed=true;caches.delete(cache);const errors=[];
                for(const record of records.values())try{release(record);}catch(error){errors.push(error);}
                records.clear();keepNow=null;keepBefore=null;
                if(errors.length)throw new AggregateError(errors,'Scene texture cleanup failed');
            }};
        caches.add(cache);return cache;
    }
    return {create,dispose(){if(disposed)return;disposed=true;const errors=[];for(const cache of [...caches])try{cache.dispose();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Scene textures cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageSceneTextures};
