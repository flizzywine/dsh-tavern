// Plugin-owned session/store assembly. Native session inputs remain supplied by the host adapter.
function createStageSessionRuntime({kernel,createStoreModule,createSessionModule,createDirectorModule,directorCommands,createResourceModule,resourceDependencies,createModNotifications,displays,createObservation}) {
    let disposed=false;const owners=new Set(),connections=new Set();
    // Construction is lazy: package activation does not create any session or subscribe to host inputs.
    let sessionModule=null,directorModule=null;
    function own(owner){
        const dispose=owner.dispose.bind(owner);let closed=false;
        owner.dispose=()=>{if(closed)return;closed=true;owners.delete(owner);dispose();};
        owners.add(owner);return owner;
    }
    function createResources(inputs){
        if(disposed)throw new Error('Stage session runtime disposed');
        return own(createResourceModule(resourceDependencies).createStageResourceRunner(inputs));
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
    function createConnection({resources:resourceInputs,direction,session:sessionInputs,notifications:notificationInputs,observation:observationInputs,waitForEntry=async()=>{}}){
        if(disposed)throw new Error('Stage session runtime disposed');
        const acquired=[];let closed=false,started=false,owner,resources,notifications;
        function dispose(){
            if(closed)return;closed=true;connections.delete(owner);
            const errors=[];
            for(const item of acquired.reverse())try{item.dispose();}catch(error){errors.push(error);}
            if(errors.length)throw new AggregateError(errors,'Stage connection cleanup failed');
        }
        try{
            if(notificationInputs){
                notifications=createModNotifications({...notificationInputs,getSnapshot:id=>owner?.get(id)?.getSnapshot()});
                acquired.push(notifications);
            }
            resources=createResources({...resourceInputs,...(displays?{present:displays.present,play:displays.play,performance:displays.performance,cancelPlayback:displays.cancel}:{})});acquired.push(resources);
            const source=createDirector({...direction,watch:(origin,wake)=>direction.watch(origin,wake,()=>notifications?.reannounce(origin.sessionId)),onEffect:resources.onEffect});acquired.push(source);
            owner=createSessionOwner({...sessionInputs,
                runEffect:source.runEffect,
                observe:notifications?notifications.observe.bind(notifications):sessionInputs.observe,
                readHistory:(args,origin,text)=>closed?null:source.cached(origin,text)||direction.read(args),
                primeHistory:source.prime,
                async prefetchHistory(origin,envelope){
                    if(closed)return;
                    await waitForEntry(owner.get(origin.sessionId),origin);
                    if(!closed)return resources.prefetch(origin,envelope);
                },
                invalidateHistory(id){if(!closed){source.invalidate(id);resources.invalidate(id);}},
                invalidatePresentation:resources.invalidate
            });acquired.push(owner);
            // The connection now owns the chain as a unit, in reverse acquisition order.
            for(const item of acquired)owners.delete(item);
            return own({owner,resources,start(){
                if(closed)throw new Error('Stage connection disposed');
                if(started)return;started=true;
                try{
                    owner.start();
                    connections.add(owner);
                    if(observationInputs){
                        const observation=createObservation({...observationInputs,owner,resources});
                        acquired.push(observation);
                        observation.start();
                    }
                }catch(error){
                    try{dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Stage connection startup failed');}
                    throw error;
                }
            },dispose});
        }catch(error){
            try{dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Stage connection startup failed');}
            throw error;
        }
    }
    return {get(id){if(disposed)return null;for(const owner of connections){const store=owner.get(id);if(store)return store;}return null;},createSessionOwner,createDirector,createResources,projectDirection,createConnection,dispose(){
        if(disposed)return;disposed=true;const errors=[];
        for(const owner of [...owners].reverse())try{owner.dispose();}catch(error){errors.push(error);}
        sessionModule=directorModule=null;
        if(errors.length)throw new AggregateError(errors,'Stage session runtime cleanup failed');
    }};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageSessionRuntime};
