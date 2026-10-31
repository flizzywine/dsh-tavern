// Plugin-owned session/store assembly. Native session inputs remain supplied by the host adapter.
function createStageSessionRuntime({kernel,createStoreModule,createSessionModule,createDirectorModule,directorCommands}) {
    let disposed=false;const owners=new Set();
    // Construction is lazy: package activation does not create any session or subscribe to host inputs.
    let sessionModule=null,directorModule=null;
    function own(owner){
        const dispose=owner.dispose.bind(owner);let closed=false;
        owner.dispose=()=>{if(closed)return;closed=true;owners.delete(owner);dispose();};
        owners.add(owner);return owner;
    }
    function director(){return directorModule ||= createDirectorModule({directorCommands});}
    function createDirector(inputs){
        if(disposed)throw new Error('Stage session runtime disposed');
        return own(director().createStageDirectorSource(inputs));
    }
    async function projectDirection(...args){
        if(disposed)return null;
        const value=await director().projectStageDirection(...args);
        return disposed?null:value;
    }
    function createSessionOwner(inputs){
        if(disposed)throw new Error('Stage session runtime disposed');
        sessionModule ||= createSessionModule(createStoreModule(kernel));
        return own(sessionModule.createStageSessionOwner(inputs));
    }
    return {createSessionOwner,createDirector,projectDirection,dispose(){
        if(disposed)return;disposed=true;const errors=[];
        for(const owner of [...owners].reverse())try{owner.dispose();}catch(error){errors.push(error);}
        sessionModule=directorModule=null;
        if(errors.length)throw new AggregateError(errors,'Stage session runtime cleanup failed');
    }};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageSessionRuntime};
