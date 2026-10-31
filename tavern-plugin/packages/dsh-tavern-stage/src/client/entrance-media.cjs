// One optional-plugin cache per entrance bundle revision. A lease spans all frame reads.
function createStageEntranceMedia({getService,fetch,AbortController,files}) {
    let disposed=false;const reads=new Map(),pending=new Set();
    const cancelled=()=>Object.assign(new Error('Entrance media disposed'),{name:'AbortError'});
    function read(run) {
        if(disposed)return Promise.reject(cancelled());
        const {packId,bundleKey,hash}=run.media,key=JSON.stringify([packId,bundleKey,hash]);
        if(reads.has(key))return reads.get(key);
        const controller=new AbortController();pending.add(controller);
        const promise=(async()=>{
            const service=getService(),lease=await service.leaseBundle({packId,bundleKey});
            try {
                if(disposed)throw cancelled();
                const marker='/lease/'+encodeURIComponent(lease.ticket)+'/',base=lease.url.slice(0,lease.url.indexOf(marker)+marker.length);
                // Settle every sibling before releasing the shared lease, including when one read fails.
                const results=await Promise.allSettled(files(run.doc).map(async name=>{
                    const response=await fetch(base+name.split('/').map(encodeURIComponent).join('/'),{credentials:'same-origin',priority:'high',signal:controller.signal});
                    if(!response.ok)throw new Error('RESOURCE_READ_FAILED '+response.status);
                    return response.blob();
                }));
                if(disposed)throw cancelled();
                const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
                const blobs=results.map(result=>result.value),plate=run.doc.layers.plate;
                return {color:blobs.slice(0,plate.frames),shift:plate.shift!==undefined?blobs.slice(plate.frames):null};
            }finally{await service.releaseLease(lease.ticket);}
        })();
        reads.set(key,promise);
        promise.then(()=>pending.delete(controller),()=>{pending.delete(controller);if(reads.get(key)===promise)reads.delete(key);});
        return promise;
    }
    return {read,dispose(){if(disposed)return;disposed=true;reads.clear();for(const controller of pending)controller.abort();pending.clear();}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageEntranceMedia};
