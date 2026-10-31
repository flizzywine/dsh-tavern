// Plugin-owned session/store assembly. Native session inputs remain supplied by the host adapter.
function createStageSessionRuntime({kernel,createStoreModule,createSessionModule}) {
    let disposed=false;const owners=new Set();
    // Construction is lazy: package activation does not create any session or subscribe to host inputs.
    let sessionModule=null;
    function createSessionOwner(inputs){
        if(disposed)throw new Error('Stage session runtime disposed');
        sessionModule ||= createSessionModule(createStoreModule(kernel));
        const owner=sessionModule.createStageSessionOwner(inputs),dispose=owner.dispose.bind(owner);
        let closed=false;
        owner.dispose=()=>{if(closed)return;closed=true;owners.delete(owner);dispose();};
        owners.add(owner);return owner;
    }
    return {createSessionOwner,dispose(){
        if(disposed)return;disposed=true;const errors=[];
        for(const owner of [...owners])try{owner.dispose();}catch(error){errors.push(error);}
        sessionModule=null;
        if(errors.length)throw new AggregateError(errors,'Stage session runtime cleanup failed');
    }};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageSessionRuntime};
