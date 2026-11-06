function createStageTextcard({React,window,players,fonts,clock,plan:planTextcard}) {
let disposed=false;const releases=new Set();
const TEXTCARD_KIND = /^dsh\.textcard(?:\.|$)/;
function textcardAccepts(performance) {
    return !!performance && TEXTCARD_KIND.test(String(performance.kind || '')) && !!performance.payload &&
        (typeof performance.payload.style === 'string' || performance.kind === 'dsh.textcard.compound' && performance.payload.version === 1);
}


function plan(payload,reduced,accent){const value=planTextcard(payload,{reduced});return value?{...value,accent:typeof accent==='string'?accent:''}:null;}
function useStage({sessionId,reducedMotion,blocked}) {
    const ctx=React.useRef({});ctx.current={reducedMotion:reducedMotion===true};
    const [family,setFamily]=React.useState(null),[state,setState]=React.useState({phase:'idle',sr:''});
    const slot=React.useMemo(()=>({player:null,node:null}),[sessionId]);
    React.useLayoutEffect(()=>{
        if(disposed)return;
        let live=true;
        const player=players.create({now:clock.now,raf:clock.requestAnimationFrame,caf:clock.cancelAnimationFrame,setInterval:clock.setInterval,clearInterval:clock.clearInterval,
            context:()=>ctx.current,onChange:value=>{if(live&&!disposed)setState(value);},fontsLoaded:fonts.loaded,
            fontsReady:value=>fonts.ensure().then(family=>{if(!live||disposed)return;if(family)setFamily(family);return fonts.ready(value,family);})});
        slot.player=player;player.attach(slot.node);setState(player.snapshot());
        const debug={play:(payload,accent)=>live&&!disposed?player.play(plan(payload,ctx.current.reducedMotion,accent)):Promise.resolve(false),skip:()=>live&&!disposed&&player.skip(),cancel:()=>{if(live&&!disposed)player.cancel();},state:player.snapshot,log:player.log,plan:payload=>planTextcard(payload,{reduced:ctx.current.reducedMotion})};
        window.forkTextcardDebug=debug;
        void fonts.ensure().then(value=>{if(live&&!disposed&&value)setFamily(value);});
        const release=()=>{if(!live)return;live=false;releases.delete(release);if(slot.player===player)slot.player=null;if(window.forkTextcardDebug===debug)delete window.forkTextcardDebug;player.dispose();};
        releases.add(release);return release;
    },[slot]);
    React.useEffect(()=>{if(blocked)slot.player?.cancel();},[blocked,slot]);
    const play=React.useCallback((effect,options={})=>{
        const performance=effect?.performance;
        if(disposed||!textcardAccepts(performance)||!slot.player)return Promise.resolve(false);
        return slot.player.play(plan(performance.payload,ctx.current.reducedMotion,options.accent));
    },[slot]);
    const attach=React.useCallback(node=>{slot.node=node;slot.player?.attach(node);},[slot]);
    const up=state.phase==='up',busy=state.phase!=='idle';
    const node=React.createElement('div',{className:'fork-tc-layer'+(up?' is-up':''),style:family?{'--tc-mincho':family}:undefined},
        React.createElement('div',{ref:attach,className:'fork-tc-host','aria-hidden':true}),
        React.createElement('span',{className:'fork-tc-sr','aria-live':'polite'},up?state.sr:''));
    return {accepts:textcardAccepts,play,skip:()=>!disposed&&!!slot.player?.skip(),cancel:()=>slot.player?.cancel(),up,busy,node};
}
return {useStage,dispose(){if(disposed)return;disposed=true;const errors=[];for(const release of [...releases]){try{release();}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'Textcard stage cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageTextcard};
