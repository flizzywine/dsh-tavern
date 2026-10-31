// Display instances and presentation waits have a shorter lifetime than sessions.
function createStageDisplays(){
    let disposed=false;const displays=new Map();
    const cancelled=reason=>({status:'cancelled',reason});
    function attach(id,sink){
        if(disposed)throw new Error('Stage displays disposed');
        displays.get(id)?.detach('replaced');
        let closed=false;const waits=new Set(),frames=new Map();
        function settle(wait,result){waits.delete(wait);wait(result);}
        function cancelWaits(reason){
            for(const resolve of waits)resolve(cancelled(reason));waits.clear();
            for(const list of frames.values())for(const resolve of list)resolve(cancelled(reason));frames.clear();
        }
        const connection={
            waitPresented(revision){
                if(closed)return Promise.resolve(cancelled('detached'));
                return new Promise(resolve=>{const list=frames.get(revision)||[];list.push(resolve);frames.set(revision,list);});
            },
            confirm(revision){
                if(closed)return;
                for(const [key,list] of frames)if(key<=revision){frames.delete(key);for(const resolve of list)resolve({status:'presented',revision:key});}
            },
            present(intent){
                if(closed)return Promise.resolve(cancelled('detached'));
                if(['release-presentation','revoke-presentation'].includes(intent.type))cancelWaits(intent.type);
                return new Promise(resolve=>{
                    waits.add(resolve);
                    try{Promise.resolve(sink.present(intent)).then(()=>settle(resolve,{status:'presented'}),error=>settle(resolve,{status:'failed',error}));}
                    catch(error){settle(resolve,{status:'failed',error});}
                });
            },
            invoke(method,...args){if(!closed)return sink[method]?.(...args);},
            detach(reason='detached'){
                if(closed)return;closed=true;
                if(displays.get(id)===connection)displays.delete(id);
                cancelWaits(reason);
            }
        };
        displays.set(id,connection);return connection;
    }
    return {attach,
        present:(id,intent)=>displays.get(id)?.present(intent)||Promise.resolve(cancelled('absent')),
        play:(id,...args)=>displays.get(id)?.invoke('play',...args),
        performance:(id,...args)=>displays.get(id)?.invoke('performance',...args),
        cancel:(id,...args)=>displays.get(id)?.invoke('cancel',...args),
        dispose(){if(disposed)return;disposed=true;for(const connection of displays.values())connection.detach('disabled');displays.clear();}
    };
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageDisplays};
