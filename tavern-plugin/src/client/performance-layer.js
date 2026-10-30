// presentation-only layers borrow the session owner's handles; no leases or playback owner.
function createPerformanceSkinLayer({root,owner,foreground,rects,onChange,onCue=()=>{},onPresented=()=>{},onPresentation=()=>{},onPlayback=()=>{},safety=()=>({}),load=createSkinOverlayLoader()}) {
    let epoch=0,disposed=false,player=null,prepared=null,skinPin=null,skinKey='',phaseKey='',current=null,frame=null,flash=null,loading=null,phaseIntent=null,visibleSkin=null,loadingKey='';
    const under=document.createElement('canvas'),over=document.createElement('canvas'),pulse=document.createElement('div');
    under.className='fork-performance-under';over.className='fork-performance-over';pulse.className='fork-performance-flash';
    for(const node of [under,over,pulse]) {node.setAttribute('aria-hidden','true');root.appendChild(node);}
    // Keyframe layers (dsh.performance/1 `keyframes`) follow the same intents; their canvases exist only while shown.
    const keyframes=createPerformanceKeyframeLayer({root,owner,foreground,rects,safety,onPresentation,onPlayback}),stopRedraw=rects.subscribe(()=>keyframes.redraw()),stopRatio=galResolutionSubscribe(()=>keyframes.redraw());
    const key=ref=>JSON.stringify([ref?.packId,ref?.kind,ref?.assetId]);
    const empty=()=>({skin:null,look:null,ambience:null,widgets:[],snap:true,skinMode:null});
    function stopTransient() {
        foreground.cancelAnimationFrame(frame);foreground.cancelAnimationFrame(flash);frame=flash=null;
        pulse.style.opacity='0';root.style.removeProperty('--performance-shake-x');root.style.removeProperty('--performance-shake-y');
    }
    function clearSkin() {epoch++;player?.dispose();player=null;prepared?.dispose();prepared=null;skinPin?.release();skinPin=null;skinKey=phaseKey='';loading=null;}
    function event(descriptor) {
        if(!descriptor) return;
        // The stage's one safety policy (stage-effects.cjs): a timeline flash keeps its colour, passes the stage-wide
        // three-a-second gate and is softened under 光敏保护 (OS reduced motion counts as it); a shake waits for 减少动态 only.
        const policy=safety();
        if(descriptor.do==='flash') {
            const raw={color:descriptor.color,peak:descriptor.alpha ?? .5,in:0,hold:descriptor.ms/1000,out:0,tail:0,cycles:1};
            if(stageFlashDark(raw) || stageFlashGate.admit(policy)) {
                const spec=stageFlashSafe(raw,policy),start=foreground.now();
                pulse.style.background=spec.color;foreground.cancelAnimationFrame(flash);
                const step=()=>{const alpha=stageFlashAt(spec,foreground.now()-start);if(alpha<0){pulse.style.opacity='0';flash=null;return;}pulse.style.opacity=String(alpha);flash=foreground.requestAnimationFrame(step);};step();
            }
        }
        if(descriptor.do==='shake' && !policy.reducedMotion) {
            foreground.cancelAnimationFrame(frame);const start=foreground.now();
            const step=()=>{const t=(foreground.now()-start)/descriptor.ms;if(t>=1){root.style.removeProperty('--performance-shake-x');root.style.removeProperty('--performance-shake-y');frame=null;return;}
                root.style.setProperty('--performance-shake-x',Math.sin(t*51)*descriptor.amp*(1-t)+'px');root.style.setProperty('--performance-shake-y',Math.cos(t*37)*descriptor.amp*(1-t)+'px');frame=foreground.requestAnimationFrame(step);};step();
        }
    }
    let presentedKey='';
    function presented(intent) {
        const key=JSON.stringify([intent.value.instanceKey,intent.token?.phaseKey]);
        if(key===presentedKey)return;
        // Wait through a rendered frame; accepting a director prefix is not presentation.
        foreground.requestAnimationFrame(()=>foreground.requestAnimationFrame(()=>{
            if(!disposed && current===intent && root.isConnected && key!==presentedKey) {presentedKey=key;onPresented(intent);}
        }));
    }
    function output(intent) {
        const {value,layer,snap}=intent,dependency=ref=>value.dependencies.find(item=>key(item.ref)===key(ref));
        const skin=layer.skin && dependency(layer.skin.ref),look=layer.look && dependency(layer.look.ref),ambience=layer.ambience && dependency(layer.ambience.ref);
        const widgets=Object.entries(layer.widgets || {}).flatMap(([slot,widget],index)=>{
            const grant=value.executionDependencies?.find(item=>key(item.ref)===key(widget.ref));
            return grant?.definition ? [{widgetId:JSON.stringify([value.instanceKey,slot]),originKey:JSON.stringify(value.instanceKey),instanceId:grant.definition.revision,mediaPolicy:grant.mediaPolicy,
                ref:widget.ref,state:widget.state || grant.state,slot,slotExplicit:true,bornAt:0,order:index,definition:grant.definition,lifetime:{until:'explicit'}}] : [];
        });
        // skinMode: the mode the current performance's document declares - the stage skin's modes.<skinMode> (stage-skin-adv.md「modes」).
        const own=value.dependencies?.find(item => item.ref?.kind === 'performances' && item.ref.packId === value.ref?.packId && item.ref.assetId === value.ref?.assetId);
        return {skin:skin ? {...skin,level:layer.skin.level ?? value.level} : null,look,ambience:ambience ? {...ambience,gain:10**((layer.ambience.gainDb || 0)/20)} : null,widgets,snap:!!snap,skinMode:own?.document?.skinMode || null};
    }
    async function apply(intent) {
        if(disposed) return;
        keyframes.apply(intent);
        if(intent.type==='cancel') {stopTransient();return;}
        if(intent.type==='clear') {stopTransient();clearSkin();current=null;visibleSkin=null;onChange(empty());return;}
        current=intent;
        const next=output(intent),desired=next.skin;
        onChange({...next,skin:desired?.document.overlay && desired.identity!==skinKey ? visibleSkin : desired});event(intent.descriptor);
        if(intent.descriptor?.do==='skin-off' && player && !intent.snap) {
            visibleSkin=null;phaseIntent=intent;player.setPhase({phase:'exit',level:intent.value.level,ordinal:intent.descriptor.ordinal});return;
        }
        if(!desired?.document.overlay) {clearSkin();visibleSkin=desired;presented(intent);return;}
        const phase=intent.snap || intent.descriptor?.do === 'phase-end' ? 'idle' : intent.descriptor?.block === 'turn' ? 'turn' : intent.value.phase;
        const nextSkinKey=desired.identity, nextPhaseKey=JSON.stringify([intent.token?.phaseKey,desired.level,intent.snap,phase]);
        const setPhase=()=>{
            if(phaseKey===nextPhaseKey) return;
            phaseKey=nextPhaseKey;phaseIntent=intent;
            player.setPhase({phase,level:desired.level,snap:intent.snap,ordinal:intent.descriptor?.ordinal ?? 0});
        };
        if(player && skinKey===nextSkinKey) {if(intent.descriptor?.do === 'skin' || intent.descriptor?.do === 'phase-end' || intent.snap) setPhase();presented(intent);return;}
        if(loading && loadingKey===nextSkinKey) return loading;
        const version=++epoch;loadingKey=nextSkinKey;
        let candidate=null,candidatePin=null;
        try {
            loading=load(desired.document);
            const renderer=await loading;
            if(disposed || version!==epoch) return;
            const handle=intent.handles.find(item=>item.identity===desired.identity);
            if(!handle) throw new Error('Prepared performance skin handle is missing');
            candidate=prepareSkinOverlayTextures({definition:desired.document.overlay,handle,entry:desired.entry,owner,createScript:renderer.createDecorativeScript});
            const screen=rects.getSnapshot().screen;
            // Budget the new pair while the old pair is still held; refusal preserves last-good.
            const probe=owner.reserveBytes(Math.ceil(screen.w)*Math.ceil(screen.h)*8);probe.release();
            if(intent.authority!==undefined) {candidatePin=owner.retain(desired.identity,intent.authority);if(!candidatePin)throw new Error('Performance skin was revoked');}
            player?.dispose();prepared?.dispose();skinPin?.release();skinPin=candidatePin;candidatePin=null;prepared=candidate;candidate=null;
            skinKey=nextSkinKey;phaseKey='';visibleSkin=desired;onChange(next);
            player=renderer.createSkinOverlayPlayer({definition:{id:desired.document.id,...desired.document.overlay},intensity:desired.level,textures:prepared.textures,script:prepared.script,rects,foreground,owner,under,over,
                reducedMotion:!!safety().reducedMotion,calm:!!safety().calm,snap:intent.snap,
                onCue:cue=>onCue({...cue,atMs:(phaseIntent?.descriptor?.at || 0)+cue.atMs,token:phaseIntent?.token}),
                onSkinSwap:()=>{if(version===epoch && current) onChange({...output(current),snap:true});},onError:error=>console.warn('Performance overlay rejected',error)});
            setPhase();presented(intent);
        } catch(error) {candidate?.dispose();candidatePin?.release();if(version===epoch){onChange({...next,skin:visibleSkin});console.warn('Performance overlay rejected',error);}}
        finally {if(version===epoch){loading=null;loadingKey='';}}
    }
    return {apply,refreshPolicy(){keyframes.refreshPolicy();const policy=safety();player?.setSafety({reducedMotion:!!policy.reducedMotion,calm:!!policy.calm});if(policy.reducedMotion)stopTransient();},dispose(){if(disposed)return;disposed=true;stopRedraw();stopRatio();keyframes.dispose();stopTransient();clearSkin();for(const node of [under,over,pulse])node.remove();}};
}
// The one safety policy (stage-effects.cjs stageSafety); the name stays for the performance layer's callers.
function performanceSafety(reading,osReduced) {return stageSafety(reading,osReduced);}
function usePerformanceLayer(rootRef,sessionId,reading) {
    const [value,setValue]=React.useState({skin:null,look:null,ambience:null,widgets:[],snap:true,skinMode:null});
    const [performance,setPerformance]=React.useState(null),[playback,setPlayback]=React.useState(null);
    const ref=React.useRef(null),policy=React.useRef(reading),cue=React.useRef(null);policy.current=reading;
    const accept=React.useCallback(intent=>{if(intent.cue)cue.current=intent.cue;return ref.current?.apply(intent);},[]);
    React.useLayoutEffect(()=>{
        const root=rootRef.current;if(!root)return;
        setPerformance(null);setPlayback(null);
        const rects=createStageRects({root,schedule:fn=>forkForeground.requestAnimationFrame(fn),cancel:id=>forkForeground.cancelAnimationFrame(id)});
        ref.current=createPerformanceSkinLayer({root,rects,owner:stageSessions.resourceOwner,foreground:forkForeground,onChange:setValue,onPresentation:setPerformance,onPlayback:setPlayback,onCue:event=>cue.current?.(event),
            onPresented:intent=>stageSessions.notifyMod(sessionId,'performance.presented',stageSessions.get(sessionId)?.getSnapshot(),{performanceId:JSON.stringify(intent.value.instanceKey),phase:intent.value.phase || 'idle'}),
            // only the explicit CONFIG choice freezes; the OS preference (e.g. Windows
            // "show animations" off) is calm: rituals and idle stepping stay, softened.
            safety:()=>performanceSafety(policy.current,window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)});
        const media=window.matchMedia?.('(prefers-reduced-motion: reduce)'),changed=()=>ref.current?.refreshPolicy();
        media?.addEventListener?.('change',changed);
        return()=>{media?.removeEventListener?.('change',changed);ref.current?.dispose();ref.current=null;rects.dispose();cue.current=null;};
    },[sessionId]);
    React.useEffect(()=>{ref.current?.refreshPolicy();},[reading.reducedMotion,reading.photosensitive]);
    return {...value,performance,playback,accept,cue:event=>cue.current?.(event)};
}
