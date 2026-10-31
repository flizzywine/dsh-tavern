// Viewport cast arrangement, fit transitions, and parked-figure projection.
function createStageCastLayout({calculate,mix}) {
    let disposed=false;const instances=new Set();
    function create(){
        if(disposed)throw new Error('Cast layout owner disposed');
        let closed=false,layout=null,seen=null,transition=null,memo=null,shown=null;
        function fit(now){
            if(!transition)return {fit:1,drop:0};
            const {from,to,start}=transition,k=mix(0,1,now-start);
            if(k===1)return {...to};
            return {fit:from.fit+(to.fit-from.fit)*k,drop:from.drop+(to.drop-from.drop)*k,
                top:from.top+(to.top-from.top)*k,framed:to.framed,ruler:to.ruler,shrunk:to.shrunk,spread:to.spread};
        }
        function update({plan,figures,W,H,now,top,ruler,loaded,crops,instant}){
            if(closed)return {layout:null,report:null};
            if(!plan){layout=seen=transition=null;return {layout:null,report:null};}
            if(seen&&seen.plan===plan&&seen.figures===figures&&seen.W===W&&seen.H===H&&seen.top===top&&seen.ruler===ruler&&seen.loaded===loaded){
                if(instant)transition.from=transition.to;
                return {layout,report:null};
            }
            const key=[W,H,top,ruler?.to,ruler?.groundTo,plan.cast.join('\n'),plan.priority.join('\n'),JSON.stringify(crops),JSON.stringify(plan.slots||null),plan.max||0,JSON.stringify(plan.framing||null)].join('|');
            let report=null;
            if(layout?.key!==key){
                const next={key,W,H,...calculate({W,H,boxTop:top,hMax:ruler?.to,groundRatio:ruler?.groundTo,cast:plan.cast,priority:plan.priority,crops,slots:plan.slots,max:plan.max,framing:plan.framing})};
                const to={fit:next.fit,drop:next.drop,top:next.top,framed:next.framed,ruler:next.ruler,shrunk:next.shrunk,spread:next.spread};
                transition=!transition||instant||transition.to.ruler!==to.ruler||transition.to.spread!==to.spread?{from:to,to,start:now}:{from:fit(now),to,start:now};
                layout=next;
                const signature=JSON.stringify([layout.x,W]);
                if(signature!==shown){shown=signature;report={count:layout.count,x:layout.x,visible:layout.visible,width:W};}
            }else if(instant)transition.from=transition.to;
            seen={plan,figures,W,H,top,ruler,loaded};
            return {layout,report};
        }
        function project(source,arrangement=layout){
            if(closed)return [];
            if(memo&&memo.source===source&&memo.layout===arrangement)return memo.list;
            const figures=source.filter(figure=>figure&&figure.key&&(figure.kind==='static'||figure.kind==='spine'));
            const list=arrangement?figures.map(figure=>figure.alias in arrangement.x?(figure.x===arrangement.x[figure.alias]?figure:{...figure,x:arrangement.x[figure.alias]})
                :{...figure,visible:false,parked:true,speaking:false,talking:false,audio:null,act:null}):figures;
            memo={source,layout:arrangement,list};return list;
        }
        const view={update,fit,project,get layout(){return layout;},get target(){return transition?{...transition.to}:{fit:1,drop:0};},dispose(){if(closed)return;closed=true;instances.delete(view);layout=seen=transition=memo=shown=null;}};
        instances.add(view);return view;
    }
    return {create,dispose(){if(disposed)return;disposed=true;for(const view of [...instances])view.dispose();}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageCastLayout};
