// Scene cast membership and last-good replacement policy. Rendering resources are supplied by the figure owner.
function createStageCast() {
    let disposed=false;const casts=new Set();
    function create({build,release}) {
        if(disposed)throw new Error('Cast owner disposed');
        let closed=false;const current=new Map();
        function forget(entry){if(current.get(entry.key)===entry)current.delete(entry.key);}
        function cancel(entry){if(entry.replacement){const pending=entry.replacement;entry.replacement=null;pending.previous=null;release(pending);}}
        function update(figures,now){
            if(closed)return [];
            const wanted=new Map(figures.map(figure=>[figure.key,figure]));
            for(const entry of current.values())if(!wanted.has(entry.key)&&!entry.leaving){
                cancel(entry);const last=entry.figure;entry.leaving=true;entry.leavingSince=now;
                entry.figure={...last,visible:false,exit:last.visible===false?last.exit:'soft',speaking:false,talking:false,audio:null,act:null};
            }
            return figures.map(figure=>{
                let entry=current.get(figure.key);
                const replace=entry&&(figure.kind!==entry.kind||(['live2d','spine'].includes(figure.kind)&&figure.identity!==entry.identity));
                if(replace){
                    if(entry.replacement&&entry.replacement.identity!==figure.identity)cancel(entry);
                    if(!entry.replacement){const next=build(figure,true);next.previous=entry;entry.replacement=next;}
                    const candidate=entry.replacement;candidate.figure=figure;
                    if(figure.kind==='spine')candidate.url=figure.url||'';
                    return {entry:candidate,replacement:true};
                }
                if(!entry){entry=build(figure,false);current.set(figure.key,entry);}
                entry.leaving=false;cancel(entry);
                if(entry.sprite&&entry.figure.identity===figure.identity){const old=entry.figure;figure={...figure,src:old.src,spriteBundle:old.spriteBundle,blinkBundle:old.blinkBundle};}
                entry.figure=figure;if(!entry.model&&!entry.loading)entry.url=figure.url||'';
                return {entry,replacement:false};
            });
        }
        function commit(entry){
            if(closed){release(entry);return false;}
            const previous=entry.previous;
            if(!previous)return !entry.dead;
            if(current.get(entry.key)!==previous||previous.replacement!==entry){release(entry);return false;}
            previous.replacement=null;entry.previous=null;
            current.set(entry.key,entry);
            release(previous);return true;
        }
        // Consumers can inspect render entries, but membership mutations stay in this owner.
        const entries={get:key=>current.get(key),values:()=>current.values(),get size(){return current.size;},forEach:(fn,thisArg)=>current.forEach((value,key)=>fn.call(thisArg,value,key,entries)),[Symbol.iterator]:()=>current[Symbol.iterator]()};
        const cast={entries,update,commit,forget,dispose(){
            if(closed)return;closed=true;casts.delete(cast);const errors=[];
            for(const entry of [...current.values()]){
                try{cancel(entry);}catch(error){errors.push(error);}
                try{release(entry);}catch(error){errors.push(error);}
            }
            current.clear();if(errors.length)throw new AggregateError(errors,'Cast cleanup failed');
        }};
        casts.add(cast);return cast;
    }
    return {create,dispose(){if(disposed)return;disposed=true;const errors=[];for(const cast of [...casts])try{cast.dispose();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Casts cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageCast};
