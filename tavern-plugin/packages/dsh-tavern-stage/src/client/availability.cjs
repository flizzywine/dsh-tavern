// The server owns availability; wake signals only request a fresh authoritative read.
function watchStageAvailability({source,activate,report=error=>console.error('[dsh-tavern-stage] availability failed',error)}) {
    let closed=false,revision=0,release=null;
    function stop(){const old=release;release=null;if(old)try{old();}catch(error){report(error);}}
    async function refresh(){
        const expected=++revision;
        try {
            const value=await source.read();
            if(closed || expected!==revision)return;
            if(value?.status!=='ready'){stop();return;}
            if(!release)release=activate();
        }catch(error){if(!closed && expected===revision){stop();report(error);}}
    }
    const unsubscribe=source.subscribe(refresh);
    void refresh();
    return ()=>{if(closed)return;closed=true;revision++;unsubscribe();stop();};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={watchStageAvailability};
