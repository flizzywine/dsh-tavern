function createStageBacklogPaging({React, hydrateText, hasOlder, loadOlder}) {
    let disposed=false;
    const controllers=new Set();
    function create(sessionId,publish) {
        let live=!disposed, state='idle', tried=null;
        const hydrated=new WeakSet();
        const update=value=>{state=value;if(live&&!disposed)publish(value);};
        const controller={
            hydrate(index,turns) {
                if(!live||disposed||!index)return;
                for(const turn of turns){
                    const row=index.get(turn);
                    if(!row?.unloaded||hydrated.has(row))continue;
                    hydrated.add(row);
                    void Promise.resolve().then(()=>{if(live&&!disposed)return hydrateText(sessionId,turn);}).catch(()=>{});
                }
            },
            async load(firstTurn,automatic=false) {
                if(!live||disposed||state==='loading'||automatic&&(state!=='idle'||tried===firstTurn)||!hasOlder(sessionId))return;
                tried=firstTurn;update('loading');
                try {await loadOlder(sessionId);if(live&&!disposed)update('idle');}
                catch {if(live&&!disposed)update('failed');}
            },
            dispose(){if(!live)return;live=false;controllers.delete(controller);}
        };
        if(live)controllers.add(controller);
        return controller;
    }
    function usePaging({sessionId,textIndex,visibleTurns,firstTurn,atTop}) {
        const ref=React.useRef(null),[older,setOlder]=React.useState('idle');
        React.useEffect(()=>{
            const controller=create(sessionId,setOlder);ref.current=controller;setOlder('idle');
            return()=>{controller.dispose();if(ref.current===controller)ref.current=null;};
        },[sessionId]);
        React.useEffect(()=>{ref.current?.hydrate(textIndex,JSON.parse(visibleTurns));},[sessionId,textIndex,visibleTurns]);
        React.useEffect(()=>{if(atTop)void ref.current?.load(firstTurn,true);},[sessionId,atTop,firstTurn,older]);
        return {older,loadOlder:()=>ref.current?.load(firstTurn)};
    }
    return {create,usePaging,dispose(){if(disposed)return;disposed=true;for(const controller of [...controllers])controller.dispose();}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageBacklogPaging};
